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
import { v4 as uuidv4 } from 'uuid';
import {
  AgentService,
  AgentServiceClient,
  AgentContext,
  AgentSession,
  AgentMessage,
} from '../../common/protocol/agent-service';
import { ClaudeClient, ClaudeMessage } from './claude-client';
import { AgentToolRegistry } from './agent-tools';
import { CoreServiceImpl } from '../core-service-impl';
import { MonitorManagerProxyImpl } from '../monitor-manager-proxy-impl';

const MAX_ITERATIONS = 12;

@injectable()
export class AgentServiceImpl implements AgentService {
  @inject(ILogger)
  private readonly logger: ILogger;

  @inject(ClaudeClient)
  private readonly claude: ClaudeClient;

  @inject(AgentToolRegistry)
  private readonly toolRegistry: AgentToolRegistry;

  @inject(CoreServiceImpl)
  private readonly coreService: CoreServiceImpl;

  @inject(MonitorManagerProxyImpl)
  private readonly monitorProxy: MonitorManagerProxyImpl;

  /** Frontend notification client — set by RPC connection handler */
  private client: AgentServiceClient | undefined;

  private sessions: Map<string, AgentSession> = new Map();
  private abortFlags: Map<string, boolean> = new Map();

  @postConstruct()
  init(): void {
    this.toolRegistry.registerBuiltins(this.coreService, this.monitorProxy);
    this.logger.info('[AgentService] Initialized with tools:', this.toolRegistry.getAll().map((t) => t.name));
  }

  setClient(client: AgentServiceClient | undefined): void {
    this.client = client;
  }

  async createSession(): Promise<string> {
    const sessionId = uuidv4();
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

  async chat(sessionId: string, userMessage: string, context: AgentContext): Promise<void> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        messages: [],
        isRunning: false,
        iterationCount: 0,
      };
      this.sessions.set(sessionId, session);
    }

    if (session.isRunning) {
      this.logger.warn('[AgentService] Session already running, ignoring new message.');
      return;
    }

    // Reset abort flag
    this.abortFlags.set(sessionId, false);
    session.isRunning = true;
    session.iterationCount = 0;

    // Add user message to history
    const userMsg: AgentMessage = {
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    session.messages.push(userMsg);
    this.client?.onMessage(sessionId, userMsg);

    // Build conversation history for Claude
    const history: ClaudeMessage[] = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const systemPrompt = this.buildSystemPrompt(context);
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
          // Handle each tool call
          for (const toolCall of response.toolCalls) {
            this.client?.onToolStart(sessionId, toolCall.name, toolCall.input as Record<string, unknown>);

            const result = await this.toolRegistry.execute(
              toolCall.name,
              toolCall.input as Record<string, unknown>,
              context
            );

            this.client?.onToolEnd(sessionId, toolCall.name, result.output, result.success);

            // Add tool result to history so Claude can continue
            const toolMsg = `Tool [${toolCall.name}] result:\n${result.output}`;
            history.push({ role: 'user', content: toolMsg });

            const toolResultMsg: AgentMessage = {
              id: uuidv4(),
              role: 'tool',
              content: result.output,
              timestamp: new Date().toISOString(),
              toolName: toolCall.name,
              toolStatus: result.success ? 'success' : 'error',
            };
            session.messages.push(toolResultMsg);
          }
          // Continue loop — Claude will respond to tool results
          continue;
        }

        // Final text response
        const assistantText = response.text || streamedText;
        if (assistantText) {
          const assistantMsg: AgentMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: assistantText,
            timestamp: new Date().toISOString(),
          };
          session.messages.push(assistantMsg);
          this.client?.onMessage(sessionId, assistantMsg);
          history.push({ role: 'assistant', content: assistantText });
        }

        // Done
        break;
      }

      if (session.iterationCount >= MAX_ITERATIONS) {
        this.client?.onError(sessionId, `Reached maximum iterations (${MAX_ITERATIONS}). Please review and continue manually.`);
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

  // ─── System Prompt ─────────────────────────────────────────────────────────

  private buildSystemPrompt(ctx: AgentContext): string {
    return `You are an expert embedded systems and Arduino engineer. You are operating inside ArduinoIDE Agent — an agentic IDE that gives you full control to compile, flash, and monitor real hardware.

## Hardware Context
- **Board:** ${ctx.boardName || 'Unknown'} (FQBN: ${ctx.boardFqbn || 'not selected'})
- **Port:** ${ctx.port || 'not connected'}

## Current Sketch
\`\`\`cpp
${ctx.sketchCode || '// (empty sketch)'}
\`\`\`
**Sketch path:** ${ctx.sketchPath}

## Last Build Output
${ctx.lastBuildOutput ? `\`\`\`\n${ctx.lastBuildOutput}\n\`\`\`` : '(no build yet)'}

## Last Build Errors
${ctx.lastBuildErrors ? `\`\`\`\n${ctx.lastBuildErrors}\n\`\`\`` : '(no errors)'}

## Recent Serial Output
\`\`\`
${ctx.serialBuffer || '(no serial data)'}
\`\`\`

## Your Capabilities
You have tools to: read/write sketch files, compile, upload to board, read serial output, and suggest libraries.

## Agentic Mode
Work autonomously: analyze the task → write code → compile → fix errors → upload → verify via serial output → repeat.
Keep the user informed of each step. Always write complete, correct Arduino C++ code.
Prefer minimal, focused changes. Never delete working code unless replacing it with a better version.

When you call a tool, respond ONLY with the tool call JSON. After getting the tool result, continue with your next action or final explanation.`;
  }
}
