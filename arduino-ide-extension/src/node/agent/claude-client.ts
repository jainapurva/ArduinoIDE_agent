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
    // Build a structured prompt that includes tools schema
    const toolsSection =
      tools.length > 0
        ? `\n\nAvailable tools (respond with JSON when using a tool):\n${JSON.stringify(tools, null, 2)}\n\nTo call a tool, respond ONLY with valid JSON:\n{"tool_use": true, "name": "<tool_name>", "input": {<params>}}\n\nOtherwise respond normally.`
        : '';

    const conversationText = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const fullPrompt = `${systemPrompt}${toolsSection}\n\n---\n\n${conversationText}\n\nAssistant:`;

    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        CLAUDECODE: '',          // suppress interactive mode
        NO_COLOR: '1',
        TERM: 'dumb',
      };

      const proc = spawn(
        this.claudePath,
        ['-p', '--output-format', 'stream-json', '--model', 'claude-sonnet-4-6', fullPrompt],
        { env, stdio: ['pipe', 'pipe', 'pipe'] }
      );

      let fullText = '';
      let rawOutput = '';

      proc.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        rawOutput += chunk;

        // Parse stream-json lines
        const lines = chunk.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'assistant' && parsed.message?.content) {
              for (const block of parsed.message.content) {
                if (block.type === 'text') {
                  onToken(block.text || '');
                  fullText += block.text || '';
                }
              }
            } else if (parsed.type === 'result') {
              fullText = parsed.result || fullText;
            }
          } catch {
            // Non-JSON line, likely a token
            onToken(chunk);
            fullText += chunk;
          }
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        // Ignore stderr (debug logs from claude CLI)
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('error')) {
          console.error('[ClaudeClient] stderr:', msg);
        }
      });

      proc.on('close', (code) => {
        if (code !== 0 && !fullText) {
          reject(new Error(`Claude CLI exited with code ${code}`));
          return;
        }

        // Detect tool call in response
        const trimmed = fullText.trim();
        try {
          const json = JSON.parse(trimmed);
          if (json.tool_use === true && json.name) {
            resolve({
              type: 'tool_use',
              toolCalls: [
                {
                  type: 'tool_use',
                  id: `tool_${Date.now()}`,
                  name: json.name,
                  input: json.input || {},
                },
              ],
              stopReason: 'tool_use',
            });
            return;
          }
        } catch {
          // Not a tool call JSON
        }

        resolve({
          type: 'text',
          text: fullText,
          stopReason: 'end_turn',
        });
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
      });
    });
  }
}
