import { AgentTool, ToolResult } from '../agent-tools';
import { AgentContext } from '../../../common/protocol/agent-service';
import { spawnSync } from 'child_process';
import * as fs from 'fs';

const CAPTURE_PATH = '/tmp/agent-aki-capture.jpg';

export function makeCameraTool(): AgentTool {
  return {
    name: 'capture_photo',
    description:
      'Capture a photo from the developer\'s webcam. Returns a base64-encoded JPEG image that can be used with verify_wiring.',
    parameters: {
      camera_index: {
        type: 'number',
        description: 'Camera index (default: 0 for built-in webcam)',
      },
    },
    async execute(params: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> {
      try {
        // Clean up previous capture
        if (fs.existsSync(CAPTURE_PATH)) {
          fs.unlinkSync(CAPTURE_PATH);
        }

        // Try imagesnap (macOS)
        let result = spawnSync('imagesnap', ['-w', '1', CAPTURE_PATH], {
          encoding: 'utf-8',
          timeout: 10_000,
        });

        if (result.status !== 0) {
          // Fallback: ffmpeg
          const camIdx = String(params['camera_index'] || 0);
          result = spawnSync(
            'ffmpeg',
            ['-f', 'avfoundation', '-i', camIdx, '-frames:v', '1', '-y', CAPTURE_PATH],
            { encoding: 'utf-8', timeout: 10_000 }
          );
        }

        if (!fs.existsSync(CAPTURE_PATH)) {
          return {
            success: false,
            output:
              'Could not capture photo. Install imagesnap: `brew install imagesnap`\n' +
              'Or install ffmpeg: `brew install ffmpeg`',
          };
        }

        const imageBuffer = fs.readFileSync(CAPTURE_PATH);
        const base64 = imageBuffer.toString('base64');

        return {
          success: true,
          output: JSON.stringify({
            image_base64: base64,
            path: CAPTURE_PATH,
            size_bytes: imageBuffer.length,
          }),
        };
      } catch (err) {
        return {
          success: false,
          output: `Camera error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
