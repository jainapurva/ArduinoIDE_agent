/**
 * AgentServiceImpl — Backend orchestrator for the agentic loop.
 *
 * Flow:
 *   user message → build system prompt → call Claude → parse response
 *   → if tool_use: execute tool → append result → loop
 *   → else: stream final text to frontend → done
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  AgentService,
  AgentServiceClient,
  AgentContext,
  AgentSession,
  AgentMessage,
} from '../../common/protocol/agent-service';
import { ClaudeClient, ClaudeMessage } from './claude-client';
import { AgentToolRegistry } from './agent-tools';

const MAX_ITERATIONS = 12;

function uid(): string {
  return crypto.randomUUID();
}

@injectable()
export class AgentServiceImpl implements AgentService {
  @inject(ILogger)
  private readonly logger: ILogger;

  @inject(ClaudeClient)
  private readonly claude: ClaudeClient;

  @inject(AgentToolRegistry)
  private readonly toolRegistry: AgentToolRegistry;

  /** Frontend notification client — set by RPC connection handler */
  private client: AgentServiceClient | undefined;

  private readonly sessions: Map<string, AgentSession> = new Map();
  private readonly abortFlags: Map<string, boolean> = new Map();

  @postConstruct()
  init(): void {
    this.logger.info(
      '[AgentService] Initialized with tools:',
      this.toolRegistry.getAll().map((t) => t.name)
    );
  }

  setClient(client: AgentServiceClient | undefined): void {
    this.client = client;
  }

  async createSession(): Promise<string> {
    const sessionId = uid();
    this.sessions.set(sessionId, {
      sessionId,
      messages: [],
      isRunning: false,
      iterationCount: 0,
    });
    return sessionId;
  }

  async getSession(sessionId: string): Promise<AgentSession | undefined> {
    return this.sessions.get(sessionId);
  }

  async clearSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages = [];
      session.iterationCount = 0;
      session.isRunning = false;
    }
  }

  async abort(sessionId: string): Promise<void> {
    this.abortFlags.set(sessionId, true);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isRunning = false;
    }
  }

  async chat(
    sessionId: string,
    userMessage: string,
    context: AgentContext
  ): Promise<void> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { sessionId, messages: [], isRunning: false, iterationCount: 0 };
      this.sessions.set(sessionId, session);
    }

    if (session.isRunning) {
      this.logger.warn('[AgentService] Session already running, ignoring message.');
      return;
    }

    this.abortFlags.set(sessionId, false);
    session.isRunning = true;
    session.iterationCount = 0;

    // Enrich context: read sketch code from disk if path provided
    const enrichedContext = this.enrichContext(context);

    // Add user message
    const userMsg: AgentMessage = {
      id: uid(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    session.messages.push(userMsg);
    this.client?.onMessage(sessionId, userMsg);

    // Build conversation history for Claude (user/assistant only)
    const history: ClaudeMessage[] = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const systemPrompt = this.buildSystemPrompt(enrichedContext);
    const tools = this.toolRegistry.toClaudeTools();

    // ── Agentic loop ─────────────────────────────────────────────────────────
    try {
      while (session.iterationCount < MAX_ITERATIONS) {
        if (this.abortFlags.get(sessionId)) {
          this.client?.onError(sessionId, 'Aborted by user.');
          break;
        }

        session.iterationCount++;
        this.logger.debug(`[AgentService] Iteration ${session.iterationCount}`);

        let streamedText = '';
        const response = await this.claude.chat(
          systemPrompt,
          history,
          tools,
          (token) => {
            streamedText += token;
            this.client?.onToken(sessionId, token);
          }
        );

        if (response.type === 'tool_use' && response.toolCalls?.length) {
          for (const toolCall of response.toolCalls) {
            this.client?.onToolStart(
              sessionId,
              toolCall.name,
              toolCall.input as Record<string, unknown>
            );

            const result = await this.toolRegistry.execute(
              toolCall.name,
              toolCall.input as Record<string, unknown>,
              enrichedContext
            );

            this.client?.onToolEnd(sessionId, toolCall.name, result.output, result.success);

            // Append tool result to history
            const toolMsg = `Tool [${toolCall.name}] ${result.success ? 'result' : 'ERROR'}:\n${result.output}`;
            history.push({ role: 'user', content: toolMsg });

            session.messages.push({
              id: uid(),
              role: 'tool',
              content: result.output,
              timestamp: new Date().toISOString(),
              toolName: toolCall.name,
              toolStatus: result.success ? 'success' : 'error',
            });

            // After write_file, refresh sketch code in context
            if (toolCall.name === 'write_file') {
              enrichedContext.sketchCode = this.readSketchCode(enrichedContext.sketchPath);
            }
          }
          continue; // Let Claude respond to tool results
        }

        // Final text response
        const assistantText = response.text || streamedText;
        if (assistantText) {
          const assistantMsg: AgentMessage = {
            id: uid(),
            role: 'assistant',
            content: assistantText,
            timestamp: new Date().toISOString(),
          };
          session.messages.push(assistantMsg);
          this.client?.onMessage(sessionId, assistantMsg);
          history.push({ role: 'assistant', content: assistantText });
        }
        break;
      }

      if (session.iterationCount >= MAX_ITERATIONS) {
        this.client?.onError(
          sessionId,
          `Reached maximum iterations (${MAX_ITERATIONS}). Review progress and continue manually if needed.`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('[AgentService] Loop error:', msg);
      this.client?.onError(sessionId, msg);
    } finally {
      session.isRunning = false;
      this.client?.onDone(sessionId);
    }
  }

  // ─── Context enrichment ───────────────────────────────────────────────────

  private enrichContext(context: AgentContext): AgentContext {
    const enriched = { ...context };
    // Read sketch code from disk (frontend only passes the path)
    if (enriched.sketchPath && !enriched.sketchCode) {
      enriched.sketchCode = this.readSketchCode(enriched.sketchPath);
    }
    return enriched;
  }

  private readSketchCode(sketchPath: string): string {
    if (!sketchPath) return '';
    try {
      // Find the .ino file in the sketch directory
      const sketchName = path.basename(sketchPath);
      const inoPath = path.join(sketchPath, `${sketchName}.ino`);
      if (fs.existsSync(inoPath)) {
        return fs.readFileSync(inoPath, 'utf-8');
      }
      // Fallback: read first .ino file
      const files = fs.readdirSync(sketchPath).filter((f) => f.endsWith('.ino'));
      if (files.length > 0) {
        return fs.readFileSync(path.join(sketchPath, files[0]), 'utf-8');
      }
    } catch {
      // ignore read errors
    }
    return '';
  }

  // ─── System Prompt ─────────────────────────────────────────────────────────

  private buildSystemPrompt(ctx: AgentContext): string {
    const boardInfo = ctx.boardName
      ? `${ctx.boardName} (FQBN: ${ctx.boardFqbn})`
      : ctx.boardFqbn || 'not selected';

    return `You are an expert embedded systems and Arduino engineer working inside ArduinoIDE Agent — an agentic IDE with full control to compile, flash, and monitor real hardware.

## Current Hardware Setup
- **Board:** ${boardInfo}
- **Port:** ${ctx.port || 'not connected — ask user to plug in board'}

## Current Sketch (${ctx.sketchPath ? path.basename(ctx.sketchPath) : 'none open'})
\`\`\`cpp
${ctx.sketchCode || '// No sketch code yet'}
\`\`\`
${ctx.sketchPath ? `Path: ${ctx.sketchPath}` : ''}

## Last Build
${ctx.lastBuildErrors ? `**Errors:**\n\`\`\`\n${ctx.lastBuildErrors}\n\`\`\`` : ctx.lastBuildOutput ? `**Output:**\n\`\`\`\n${ctx.lastBuildOutput}\n\`\`\`` : '(no build yet)'}

## Serial Monitor
\`\`\`
${ctx.serialBuffer || '(no serial data yet)'}
\`\`\`

## Your Mission
Work autonomously to help the user. When given a task:
1. Write the code using \`write_file\`
2. Compile it using \`compile\` — fix any errors
3. Upload using \`upload\` once it compiles
4. Check output using \`read_serial\`
5. Iterate until the task is complete

## Rules
- Always write complete, valid Arduino C++ code
- Never leave out essential includes, setup(), or loop()
- When the board or port is not set, tell the user clearly and guide them to select it
- Keep code minimal and focused on the task
- If compilation fails, fix the exact error shown — don't guess
- When the task is done, confirm what was achieved

## Tool Call Format
When calling a tool, respond ONLY with valid JSON (no markdown, no other text):
{"tool_use": true, "name": "<tool_name>", "input": {<params>}}`;
  }
}
