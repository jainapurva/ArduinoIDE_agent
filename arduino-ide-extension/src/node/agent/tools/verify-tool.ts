import { AgentTool, ToolResult } from '../agent-tools';
import { AgentContext } from '../../../common/protocol/agent-service';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function makeVerifyTool(): AgentTool {
  return {
    name: 'verify_wiring',
    description:
      'Use AI vision to verify that a breadboard photo matches the expected wiring design. Requires ANTHROPIC_API_KEY env var or Claude CLI.',
    parameters: {
      image_base64: {
        type: 'string',
        description: 'Base64-encoded JPEG image from capture_photo',
      },
      design: {
        type: 'string',
        description: 'The expected wiring — either DesignSpec JSON or wiring instructions text',
      },
    },
    required: ['image_base64', 'design'],
    async execute(params: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> {
      try {
        const imageBase64 = params['image_base64'] as string;
        const design = params['design'] as string;

        if (!imageBase64) {
          return { success: false, output: 'No image provided. Call capture_photo first.' };
        }

        const prompt = buildVerificationPrompt(design);

        // Write image to temp file for Claude CLI
        const tmpImagePath = path.join(os.tmpdir(), 'agent-aki-verify.jpg');
        fs.writeFileSync(tmpImagePath, Buffer.from(imageBase64, 'base64'));

        // Try Claude CLI with image
        const claudePath = process.env['CLAUDE_PATH'] || path.join(os.homedir(), '.local', 'bin', 'claude');

        const fullPrompt = `${prompt}\n\nAnalyze the attached image of a breadboard and verify the wiring.`;

        const result = await runClaude(claudePath, fullPrompt, tmpImagePath);

        // Clean up
        try { fs.unlinkSync(tmpImagePath); } catch { /* ignore */ }

        if (result.success) {
          return { success: true, output: `## Wiring Verification\n\n${result.text}` };
        }

        // Fallback: Try Anthropic API
        const apiKey = process.env['ANTHROPIC_API_KEY'];
        if (!apiKey) {
          return {
            success: false,
            output:
              'Could not verify wiring. Either:\n' +
              '1. Install Claude CLI: https://docs.anthropic.com/en/docs/claude-code\n' +
              '2. Set ANTHROPIC_API_KEY environment variable',
          };
        }

        return { success: false, output: 'Vision verification via API not yet implemented. Use Claude CLI.' };
      } catch (err) {
        return {
          success: false,
          output: `Verify error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

function buildVerificationPrompt(design: string): string {
  return `You are verifying a breadboard wiring job for an Arduino/ESP32 project.

Expected wiring:
${design}

Analyze the photo and report:
1. Which components can you identify on the breadboard?
2. For each expected wire, can you confirm it's connected correctly?
3. Are there any unexpected or incorrect connections?
4. Any obvious issues (wrong row, missing ground, loose wires)?

Format your response as:
## Verified Connections
- List each confirmed connection

## Missing Connections
- List any expected connections you can't see

## Issues Found
- List any problems

## Confidence
Rate your confidence (low/medium/high) and explain why.`;
}

function runClaude(claudePath: string, prompt: string, imagePath: string): Promise<{ success: boolean; text: string }> {
  return new Promise((resolve) => {
    const proc = spawn(claudePath, ['-p', prompt, '--image', imagePath], {
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve({ success: true, text: stdout.trim() });
      } else {
        resolve({ success: false, text: stderr || 'Claude CLI failed' });
      }
    });

    proc.on('error', () => {
      resolve({ success: false, text: 'Claude CLI not found' });
    });

    setTimeout(() => {
      proc.kill();
      resolve({ success: false, text: 'Claude CLI timed out' });
    }, 60_000);
  });
}
