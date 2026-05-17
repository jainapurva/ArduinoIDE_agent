/**
 * ClaudeClient — Calls the `claude -p` CLI subprocess.
 * Uses the user's existing Claude Code subscription (no API key needed).
 */

import { injectable } from '@theia/core/shared/inversify';
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface ClaudeToolCall {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeResponse {
  type: 'text' | 'tool_use';
  text?: string;
  toolCalls?: ClaudeToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

@injectable()
export class ClaudeClient {
  private readonly claudePath: string;

  constructor() {
    // Resolve claude CLI path
    this.claudePath =
      process.env['CLAUDE_PATH'] ||
      path.join(os.homedir(), '.local', 'bin', 'claude');
  }

  /**
   * Send a prompt with conversation history and tools to Claude.
   * Streams tokens via onToken callback.
   */
  async chat(
    systemPrompt: string,
    messages: ClaudeMessage[],
    tools: ClaudeTool[],
    onToken: (token: string) => void
  ): Promise<ClaudeResponse> {
    // System prompt goes via --system-prompt flag (replaces Claude Code's default,
    // avoiding its anti-injection filtering of our tool-calling wrapper).
    const toolsSection =
      tools.length > 0
        ? `\n\n=== TOOLS ===\nYou have access to these tools (and ONLY these tools — you cannot use Read/Write/Edit/Bash directly):\n${JSON.stringify(tools, null, 2)}\n\n=== RESPONSE FORMAT ===\nEvery response MUST be in exactly ONE of two forms:\n\n(A) A tool call — a single JSON object, nothing else. No greeting, no plan, no markdown:\n{"tool_use": true, "name": "<tool_name>", "input": {<params>}}\n\n(B) A plain-text final answer to the user, when no tool is needed AND your work is complete.\n\nNEVER mix prose with JSON. NEVER wrap JSON in code fences. NEVER explain your tool call — just emit the JSON.\nThe orchestrator will execute the tool and feed the result back; you will then issue the next tool call or finish.`
        : '';
    const fullSystemPrompt = `${systemPrompt}${toolsSection}`;

    const conversationText = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        CLAUDECODE: '',
        NO_COLOR: '1',
        TERM: 'dumb',
      };

      const proc = spawn(
        this.claudePath,
        [
          '-p',
          '--output-format', 'stream-json',
          '--verbose',
          '--tools', '',
          '--system-prompt', fullSystemPrompt,
          '--model', 'claude-sonnet-4-6',
          conversationText,
        ],
        { env, stdio: ['pipe', 'pipe', 'pipe'] }
      );

      let resultText = '';
      let buffer = '';

      // We DON'T stream tokens during reception — we wait for the full result.
      // This prevents raw tool-call JSON from being shown to the user.
      // The trade-off is no real-time streaming, but correct tool call handling.

      proc.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('error')) {
          console.error('[ClaudeClient] stderr:', msg);
        }
      });

      proc.on('close', (code) => {
        // Parse all buffered stream-json lines to extract the result
        const lines = buffer.split('\n');
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          try {
            const parsed = JSON.parse(trimmedLine);
            if (parsed.type === 'result' && parsed.result) {
              resultText = parsed.result;
            }
          } catch {
            // Not valid JSON line — skip
          }
        }

        if (code !== 0 && !resultText) {
          reject(new Error(`Claude CLI exited with code ${code}`));
          return;
        }

        const finalText = resultText.trim();

        // Detect tool call — robust extractor handles prose-wrapped JSON,
        // code fences, and braces inside string literals.
        const toolJson = extractToolCallJson(finalText);
        console.log(
          `[ClaudeClient] response len=${finalText.length} | toolJson detected=${
            toolJson ? toolJson.name : 'no'
          } | head=${finalText.slice(0, 200).replace(/\n/g, '⏎')}`
        );
        if (toolJson && toolJson.tool_use === true && toolJson.name) {
          resolve({
            type: 'tool_use',
            toolCalls: [
              {
                type: 'tool_use',
                id: `tool_${Date.now()}`,
                name: toolJson.name,
                input: toolJson.input || {},
              },
            ],
            stopReason: 'tool_use',
          });
          return;
        }

        // Stream the final text to the UI now that we know it's not a tool call
        if (finalText) {
          onToken(finalText);
        }

        resolve({
          type: 'text',
          text: finalText,
          stopReason: 'end_turn',
        });
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
      });
    });
  }
}

/**
 * Extract the first valid {"tool_use":true,...} JSON object from text.
 * Robust against prose around the JSON, code fences, embedded JSON strings,
 * and unbalanced braces inside string literals (uses a state machine
 * that respects JSON string boundaries and escape sequences).
 */
function extractToolCallJson(
  text: string
): { tool_use?: boolean; name?: string; input?: Record<string, unknown> } | null {
  if (!text) return null;
  let s = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  // Whole-string fast path
  try {
    const j = JSON.parse(s);
    if (j && j.tool_use) return j;
  } catch {
    /* fall through */
  }
  // Walk the text; at every `{` start a state-machine scan that respects
  // JSON string boundaries (so braces inside "...content..." don't unbalance).
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const candidate = s.slice(start, end + 1);
    if (!candidate.includes('tool_use')) continue;
    try {
      const obj = JSON.parse(candidate);
      if (obj && obj.tool_use) return obj;
    } catch {
      /* try next */
    }
  }
  return null;
}
