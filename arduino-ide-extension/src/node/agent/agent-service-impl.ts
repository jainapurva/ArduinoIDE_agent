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
  SketchFile,
  FileChange,
} from '../../common/protocol/agent-service';
import { ClaudeClient, ClaudeMessage } from './claude-client';
import { AgentToolRegistry } from './agent-tools';

const MAX_ITERATIONS = 20;

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
  private readonly pendingFileChanges: Map<
    string,
    { resolve: (accepted: boolean) => void }
  > = new Map();

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

  async resolveFileChange(changeId: string, accepted: boolean): Promise<void> {
    const pending = this.pendingFileChanges.get(changeId);
    if (pending) {
      pending.resolve(accepted);
      this.pendingFileChanges.delete(changeId);
    } else {
      this.logger.warn(
        `[AgentService] resolveFileChange called for unknown changeId: ${changeId}`
      );
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

            // ── Intercept write_file: show diff and wait for user approval ──
            if (toolCall.name === 'write_file' && enrichedContext.sketchPath) {
              const params = toolCall.input as Record<string, unknown>;
              const filename = params['filename'] as string;
              const newContent = params['content'] as string;
              const filepath = path.join(enrichedContext.sketchPath, filename);

              // Read old content (empty string if new file)
              let oldContent = '';
              try {
                if (fs.existsSync(filepath)) {
                  oldContent = fs.readFileSync(filepath, 'utf-8');
                }
              } catch {
                // treat as new file
              }

              const changeId = uid();
              const fileChange: FileChange = {
                sessionId,
                changeId,
                filename,
                oldContent,
                newContent,
                sketchPath: enrichedContext.sketchPath,
              };

              // Send diff to frontend so user sees what was written.
              // Agent is autonomous: auto-accept after a short visual pause
              // (~1.2s) — long enough to read, short enough to keep the flow
              // running. Manual Accept/Reject still works during that window.
              this.client?.onFileChange(fileChange);

              const accepted = await new Promise<boolean>((resolve) => {
                this.pendingFileChanges.set(changeId, { resolve });
                // Auto-accept timer
                setTimeout(() => {
                  if (this.pendingFileChanges.has(changeId)) {
                    this.pendingFileChanges.delete(changeId);
                    resolve(true);
                  }
                }, 1200);
              });

              let toolOutput: string;
              let toolSuccess: boolean;

              if (accepted) {
                fs.mkdirSync(path.dirname(filepath), { recursive: true });
                fs.writeFileSync(filepath, newContent, 'utf-8');
                toolOutput = `Written ${filename} (${newContent.length} chars)`;
                toolSuccess = true;
              } else {
                toolOutput = `User rejected the changes to ${filename}`;
                toolSuccess = false;
              }

              this.client?.onToolEnd(sessionId, toolCall.name, toolOutput, toolSuccess);

              const toolMsg = `Tool [${toolCall.name}] ${toolSuccess ? 'result' : 'ERROR'}:\n${toolOutput}`;
              history.push({ role: 'user', content: toolMsg });
              session.messages.push({
                id: uid(),
                role: 'tool',
                content: toolOutput,
                timestamp: new Date().toISOString(),
                toolName: toolCall.name,
                toolStatus: toolSuccess ? 'success' : 'error',
              });

              if (accepted) {
                enrichedContext.sketchCode = this.readSketchCode(enrichedContext.sketchPath);
                enrichedContext.sketchFiles = this.readSketchFiles(enrichedContext.sketchPath);
              }
            } else {
              // All other tools: execute normally
              const result = await this.toolRegistry.execute(
                toolCall.name,
                toolCall.input as Record<string, unknown>,
                enrichedContext
              );

              this.client?.onToolEnd(sessionId, toolCall.name, result.output, result.success);

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
    const enriched = { ...context, sketchFiles: [] as SketchFile[] };
    if (enriched.sketchPath) {
      if (!enriched.sketchCode) {
        enriched.sketchCode = this.readSketchCode(enriched.sketchPath);
      }
      enriched.sketchFiles = this.readSketchFiles(enriched.sketchPath);
    }
    return enriched;
  }

  private readSketchCode(sketchPath: string): string {
    if (!sketchPath) return '';
    try {
      const sketchName = path.basename(sketchPath);
      const inoPath = path.join(sketchPath, `${sketchName}.ino`);
      if (fs.existsSync(inoPath)) {
        return fs.readFileSync(inoPath, 'utf-8');
      }
      const files = fs.readdirSync(sketchPath).filter((f) => f.endsWith('.ino'));
      if (files.length > 0) {
        return fs.readFileSync(path.join(sketchPath, files[0]), 'utf-8');
      }
    } catch {
      // ignore read errors
    }
    return '';
  }

  private readSketchFiles(sketchPath: string): SketchFile[] {
    if (!sketchPath) return [];
    try {
      const extensions = ['.ino', '.cpp', '.c', '.h', '.hpp', '.S'];
      const files = fs.readdirSync(sketchPath)
        .filter((f) => extensions.some((ext) => f.endsWith(ext)));
      return files.map((filename) => ({
        filename,
        content: fs.readFileSync(path.join(sketchPath, filename), 'utf-8'),
      }));
    } catch {
      return [];
    }
  }

  // ─── System Prompt ─────────────────────────────────────────────────────────

  private buildSystemPrompt(ctx: AgentContext): string {
    const boardInfo = ctx.boardName
      ? `${ctx.boardName} (FQBN: ${ctx.boardFqbn})`
      : ctx.boardFqbn || 'not selected';

    // Build sketch files section — show all files, truncate large ones.
    let sketchSection: string;
    if (ctx.sketchFiles && ctx.sketchFiles.length > 0) {
      const fileBlocks = ctx.sketchFiles.map((f) => {
        const lines = f.content.split('\n');
        const truncated = lines.length > 200;
        const shown = truncated
          ? lines.slice(0, 200).join('\n') + `\n// ... (${lines.length - 200} more lines)`
          : f.content;
        return `### ${f.filename}\n\`\`\`cpp\n${shown}\n\`\`\``;
      });
      sketchSection = fileBlocks.join('\n\n');
    } else if (ctx.sketchCode) {
      sketchSection = `\`\`\`cpp\n${ctx.sketchCode}\n\`\`\``;
    } else {
      sketchSection = '// No sketch code yet';
    }

    return `You are Agent AKI — an AI that builds complete Arduino/ESP32 hardware projects autonomously.

## How You Work
The user describes what they want to build. You handle EVERYTHING:
- Choosing the right board (if they didn't specify one)
- Selecting the right components
- Designing the circuit with correct pin assignments
- Validating the design for errors
- Generating step-by-step wiring instructions
- Writing the complete Arduino code
- Compiling the code
- Uploading to the board
- Verifying it works via serial output
- Optionally verifying wiring via camera

The user's ONLY job is physical: gathering components, wiring the breadboard, and plugging in USB.

## Your Autonomous Workflow
When the user describes a project (e.g., "build me a motion-activated alarm"):

**Phase 1: Design (you do this immediately, no user input needed)**
1. Call suggest_design with their description → get board, components, pins, libraries
2. Call validate_design → ensure no errors
3. Present the design: what board to use (and why), what components to buy, estimated cost

**Phase 2: Wiring (guide the user step by step)**
4. Call generate_wiring → get step-by-step breadboard instructions
5. Walk the user through wiring ONE component at a time
6. After each component, ask "Done? Ready for the next one?"
7. When all wired, offer to verify with camera: call capture_photo + verify_wiring

**Phase 3: Code (fully autonomous)**
8. Write the complete Arduino sketch using write_file — include ALL code, not just a skeleton
9. Compile using compile — if errors, fix them yourself and recompile (loop until it works)
10. Never ask the user to fix code — that's YOUR job

**Phase 4: Deploy & Test**
11. Ask user to connect board via USB
12. Upload using upload
13. Read serial output using read_serial to verify it works
14. If something's wrong, diagnose and fix — write new code, recompile, re-upload

## Rules
- NEVER ask the user to write code — you write ALL the code
- NEVER ask the user to pick a board or component — you pick (unless they specified one)
- NEVER give partial code — always write complete, compilable sketches
- If you're unsure between options, pick the most beginner-friendly one and explain why
- If compilation fails, fix the error yourself — don't ask the user
- Always explain your choices briefly ("I chose ESP32 because your project needs WiFi")
- When presenting wiring, be specific: "Connect the red wire from the DHT22 VCC pin to the 3.3V rail"
- Always write complete, valid Arduino C++ code with includes, setup(), and loop()
- When the board or port is not set, guide the user to select it from the toolbar

## Current Hardware Context
- **Board:** ${boardInfo}
- **Port:** ${ctx.port || 'not connected — ask user to plug in board'}

## Current Sketch (${ctx.sketchPath ? path.basename(ctx.sketchPath) : 'none open'})
${sketchSection}
${ctx.sketchPath ? `Path: ${ctx.sketchPath}` : ''}

## Last Build
${ctx.lastBuildErrors ? `**Errors:**\n\`\`\`\n${ctx.lastBuildErrors}\n\`\`\`` : ctx.lastBuildOutput ? `**Output:**\n\`\`\`\n${ctx.lastBuildOutput}\n\`\`\`` : '(no build yet)'}

## Serial Monitor
\`\`\`
${ctx.serialBuffer || '(no serial data yet)'}
\`\`\`

## Handling missing libraries (CRITICAL — must be autonomous)

**RULE: If a \`Tool [compile] ERROR\` message contains the substring "fatal error" and ".h: No such file or directory", your NEXT response MUST be a single \`install_library\` tool call. You are NOT permitted to respond with text. You are NOT permitted to call \`compile\` again until you have called \`install_library\`. You are NOT permitted to claim success — the compile FAILED.**

Header-to-library mapping (memorize these):
- \`DHT.h\` → install \`DHT sensor library\`
- \`Adafruit_Sensor.h\` → install \`Adafruit Unified Sensor\`
- \`Adafruit_SSD1306.h\` → install \`Adafruit SSD1306\`
- \`Adafruit_GFX.h\` → install \`Adafruit GFX Library\`
- \`ArduinoJson.h\` → install \`ArduinoJson\`
- \`Servo.h\`, \`Wire.h\`, \`SPI.h\`, \`EEPROM.h\`, \`SoftwareSerial.h\` → built-in, do NOT install

Workflow for "DHT.h: No such file or directory":
1. Tool result shows: \`Tool [compile] ERROR: ...fatal error: DHT.h: No such file...\`
2. Your next response: \`{"tool_use": true, "name": "install_library", "input": {"name": "DHT sensor library"}}\`
3. Tool result: \`Tool [install_library] result: Installed library "DHT sensor library" ✓\`
4. Your next response: \`{"tool_use": true, "name": "compile", "input": {}}\`
5. If compile fails again with \`Adafruit_Sensor.h: No such file\`, install \`Adafruit Unified Sensor\` and recompile.
6. Keep going until compile prints \`Sketch uses N bytes\` — only THEN may you respond with a success summary.

**Never** use \`suggest_library\` for this — that tool only returns advice text. **Never** claim "compiled successfully" or "libraries installed automatically" unless you actually saw \`Sketch uses N bytes\` in a recent tool result.

## Tool Call Format
When calling a tool, respond ONLY with valid JSON (no markdown, no other text):
{"tool_use": true, "name": "<tool_name>", "input": {<params>}}`;
  }
}
