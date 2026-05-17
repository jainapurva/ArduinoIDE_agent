/**
 * AgentTools — All tools available to the AI agent.
 *
 * Tools use arduino-cli subprocess directly (not gRPC services)
 * so AgentToolRegistry stays a singleton with no per-connection DI deps.
 */

import { injectable } from '@theia/core/shared/inversify';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeTool } from './claude-client';
import { AgentContext } from '../../common/protocol/agent-service';
import { arduinoCliPath } from '../resources';
import { makeDesignTool } from './tools/design-tool';
import { makeValidateTool } from './tools/validate-tool';
import { makeWiringTool } from './tools/wiring-tool';
import { makeCameraTool } from './tools/camera-tool';
import { makeVerifyTool } from './tools/verify-tool';

export interface ToolResult {
  success: boolean;
  output: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  required?: string[];
  execute(params: Record<string, unknown>, context: AgentContext): Promise<ToolResult>;
}

@injectable()
export class AgentToolRegistry {
  private readonly tools: Map<string, AgentTool> = new Map();

  constructor() {
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    this.register(makeReadFileTool());
    this.register(makeWriteFileTool());
    this.register(makeListFilesTool());
    this.register(makeCompileTool());
    this.register(makeUploadTool());
    this.register(makeReadSerialTool());
    this.register(makeSuggestLibraryTool());
    this.register(makeInstallLibraryTool());
    this.register(makeDesignTool());
    this.register(makeValidateTool());
    this.register(makeWiringTool());
    this.register(makeCameraTool());
    this.register(makeVerifyTool());
  }

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  toClaudeTools(): ClaudeTool[] {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        properties: t.parameters,
        required: t.required,
      },
    }));
  }

  async execute(
    name: string,
    params: Record<string, unknown>,
    context: AgentContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: `Unknown tool: ${name}` };
    }
    try {
      return await tool.execute(params, context);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Tool error: ${msg}` };
    }
  }
}

// ─── Tool Factories ──────────────────────────────────────────────────────────

function makeReadFileTool(): AgentTool {
  return {
    name: 'read_file',
    description: 'Read the contents of a file in the current sketch directory.',
    parameters: {
      filename: {
        type: 'string',
        description: 'File name relative to sketch directory (e.g. "sketch.ino" or "config.h")',
      },
    },
    required: ['filename'],
    async execute(params, context) {
      if (!context.sketchPath) {
        return { success: false, output: 'No sketch path available. Open a sketch first.' };
      }
      const filepath = path.join(context.sketchPath, params['filename'] as string);
      if (!fs.existsSync(filepath)) {
        return { success: false, output: `File not found: ${params['filename']}` };
      }
      return { success: true, output: fs.readFileSync(filepath, 'utf-8') };
    },
  };
}

function makeWriteFileTool(): AgentTool {
  return {
    name: 'write_file',
    description:
      'Write or overwrite a file in the current sketch directory. Use this to create or modify sketch code.',
    parameters: {
      filename: { type: 'string', description: 'File name (e.g. "sketch.ino" or "helpers.h")' },
      content: { type: 'string', description: 'Full file content to write' },
    },
    required: ['filename', 'content'],
    async execute(params, context) {
      if (!context.sketchPath) {
        return { success: false, output: 'No sketch path available. Open a sketch first.' };
      }
      const filepath = path.join(context.sketchPath, params['filename'] as string);
      fs.mkdirSync(path.dirname(filepath), { recursive: true });
      fs.writeFileSync(filepath, params['content'] as string, 'utf-8');
      return {
        success: true,
        output: `Written ${params['filename']} (${(params['content'] as string).length} chars)`,
      };
    },
  };
}

function makeListFilesTool(): AgentTool {
  return {
    name: 'list_files',
    description: 'List all files in the current sketch directory with sizes and types.',
    parameters: {},
    async execute(_params, context) {
      if (!context.sketchPath || !fs.existsSync(context.sketchPath)) {
        return { success: false, output: 'No sketch directory found. Open a sketch first.' };
      }
      const files = fs.readdirSync(context.sketchPath);
      const lines = files.map((f) => {
        try {
          const stat = fs.statSync(path.join(context.sketchPath, f));
          const size = stat.isDirectory() ? 'dir' : `${stat.size} bytes`;
          const ext = path.extname(f).toLowerCase();
          const typeMap: Record<string, string> = {
            '.ino': 'source', '.cpp': 'source', '.c': 'source',
            '.h': 'header', '.hpp': 'header',
            '.S': 'assembly', '.json': 'config', '.txt': 'text',
          };
          const type = typeMap[ext] || '';
          return type ? `${f} (${size}, ${type})` : `${f} (${size})`;
        } catch {
          return f;
        }
      });
      return { success: true, output: lines.join('\n') };
    },
  };
}

function makeCompileTool(): AgentTool {
  return {
    name: 'compile',
    description:
      'Compile the current Arduino sketch. Returns build output, errors, and binary size. If the IDE has no board selected, you MUST pass the `fqbn` parameter (e.g. "arduino:avr:uno" for an UNO, "arduino:avr:nano" for a Nano, "esp32:esp32:esp32" for a generic ESP32) — infer it from the user request and do NOT ask them to pick a board.',
    parameters: {
      fqbn: {
        type: 'string',
        description:
          'Optional Arduino FQBN to compile for. Overrides the IDE\'s board selection. Pass this whenever the IDE has no board selected, so the agent can compile autonomously.',
      },
    },
    execute(params, context) {
      const fqbnOverride = ((params['fqbn'] as string) || '').trim();
      const ctx = fqbnOverride ? { ...context, boardFqbn: fqbnOverride } : context;
      return Promise.resolve(runCompile(ctx));
    },
  };
}

function makeUploadTool(): AgentTool {
  return {
    name: 'upload',
    description:
      'Compile and upload the current sketch to the connected board. Board must be plugged in.',
    parameters: {},
    execute(_params, context) {
      return Promise.resolve(runUpload(context));
    },
  };
}

function makeReadSerialTool(): AgentTool {
  return {
    name: 'read_serial',
    description:
      'Read recent output from the serial monitor buffer. Returns latest data received from the board.',
    parameters: {
      lines: { type: 'number', description: 'Number of recent lines to return (default: 30)' },
    },
    async execute(params, context) {
      if (!context.serialBuffer) {
        return {
          success: true,
          output:
            '(no serial data yet — upload the sketch and wait a moment, then call read_serial again)',
        };
      }
      const count = (params['lines'] as number) || 30;
      const allLines = context.serialBuffer.split('\n');
      return { success: true, output: allLines.slice(-count).join('\n') };
    },
  };
}

function makeSuggestLibraryTool(): AgentTool {
  return {
    name: 'suggest_library',
    description:
      'Suggest an Arduino library for a specific functionality. Returns library name and install instructions.',
    parameters: {
      functionality: {
        type: 'string',
        description:
          'What you need (e.g. "I2C temperature sensor", "OLED display", "WiFi HTTP GET")',
      },
    },
    required: ['functionality'],
    async execute(params) {
      const need = ((params['functionality'] as string) || '').toLowerCase();
      const map: Array<[string, string]> = [
        ['temperature', 'Adafruit_BME280 (BME280) or DHT (DHT11/22)'],
        ['humidity', 'DHT sensor library by Adafruit'],
        ['pressure', 'Adafruit_BMP280 or Adafruit_BME280'],
        ['oled', 'Adafruit_SSD1306 + Adafruit_GFX'],
        ['lcd', 'LiquidCrystal (built-in) or LiquidCrystal_I2C'],
        ['tft', 'Adafruit_ILI9341 + Adafruit_GFX'],
        ['wifi', 'WiFi (ESP32/MKR built-in) or WiFiNINA (Nano 33 IoT)'],
        ['http', 'ArduinoHttpClient or HTTPClient (ESP32 built-in)'],
        ['mqtt', 'PubSubClient by Nick O\'Leary'],
        ['bluetooth', 'ArduinoBLE (Nano 33 BLE) or BluetoothSerial (ESP32)'],
        ['servo', 'Servo (built-in Arduino library)'],
        ['stepper', 'Stepper (built-in) or AccelStepper'],
        ['neopixel', 'Adafruit NeoPixel'],
        ['json', 'ArduinoJson by Benoit Blanchon'],
        ['gps', 'TinyGPS++ by Mikal Hart'],
        ['imu', 'Adafruit_MPU6050 or SparkFun MPU-9250'],
        ['ir', 'IRremote by Arduino-IRremote'],
        ['rfid', 'MFRC522 by miguelbalboa'],
        ['ultrasonic', 'NewPing by Tim Eckel'],
        ['sd', 'SD (built-in Arduino library)'],
        ['rtc', 'RTClib by Adafruit'],
        ['i2c', 'Wire (built-in — no install needed)'],
        ['spi', 'SPI (built-in — no install needed)'],
        ['uart', 'HardwareSerial (built-in — use Serial.begin())'],
      ];
      for (const [key, lib] of map) {
        if (need.includes(key)) {
          return {
            success: true,
            output: `Recommended: ${lib}\nInstall via: Sketch > Include Library > Manage Libraries`,
          };
        }
      }
      return {
        success: true,
        output: `Search the Library Manager for: "${params['functionality']}"`,
      };
    },
  };
}

function makeInstallLibraryTool(): AgentTool {
  return {
    name: 'install_library',
    description:
      'Install an Arduino library by exact name from the Library Manager. Call this when compilation fails with "fatal error: <Header.h>: No such file or directory" — pick the library name that provides that header (e.g. "DHT sensor library" for DHT.h, "Adafruit SSD1306" for Adafruit_SSD1306.h, "ArduinoJson" for ArduinoJson.h). After install succeeds, retry compile.',
    parameters: {
      name: {
        type: 'string',
        description:
          'Exact library name as registered in the Arduino Library Manager (e.g. "DHT sensor library", "Adafruit GFX Library").',
      },
    },
    required: ['name'],
    async execute(params) {
      const libName = (params['name'] as string) || '';
      if (!libName.trim()) {
        return { success: false, output: 'install_library: name parameter is required.' };
      }
      const cli = fs.existsSync(arduinoCliPath) ? arduinoCliPath : 'arduino-cli';
      const result = spawnSync(cli, ['lib', 'install', libName], {
        encoding: 'utf-8',
        timeout: 120_000,
      });
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      if (result.status === 0) {
        return {
          success: true,
          output: output || `Installed library "${libName}" ✓ — now retry compile.`,
        };
      }
      return {
        success: false,
        output: output || `Library install failed for "${libName}" (exit ${result.status})`,
      };
    },
  };
}

// ─── CLI subprocess helpers ──────────────────────────────────────────────────

function runCompile(context: AgentContext): ToolResult {
  if (!context.sketchPath) {
    return { success: false, output: 'No sketch open. Open or create a sketch first.' };
  }
  if (!context.boardFqbn) {
    return {
      success: false,
      output:
        'No board selected in the IDE. Retry this compile call with an `fqbn` parameter — for an Arduino UNO use "arduino:avr:uno", for a Nano use "arduino:avr:nano", for an ESP32 dev board use "esp32:esp32:esp32". Do not stop and ask the user; pick the FQBN from their original request and call compile again.',
    };
  }
  const cli = fs.existsSync(arduinoCliPath) ? arduinoCliPath : 'arduino-cli';
  const result = spawnSync(
    cli,
    ['compile', '--fqbn', context.boardFqbn, context.sketchPath],
    { encoding: 'utf-8', timeout: 60_000 }
  );
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (result.status === 0) {
    return { success: true, output: output || 'Compilation successful ✓' };
  }
  return { success: false, output: output || `Compilation failed (exit code ${result.status})` };
}

function runUpload(context: AgentContext): ToolResult {
  if (!context.sketchPath) return { success: false, output: 'No sketch open.' };
  if (!context.boardFqbn) return { success: false, output: 'No board selected.' };
  if (!context.port) {
    return {
      success: false,
      output:
        'No port selected. Connect the board via USB and select the port in the IDE toolbar.',
    };
  }
  const cli = fs.existsSync(arduinoCliPath) ? arduinoCliPath : 'arduino-cli';

  // Compile first
  const compileResult = spawnSync(
    cli,
    ['compile', '--fqbn', context.boardFqbn, context.sketchPath],
    { encoding: 'utf-8', timeout: 60_000 }
  );
  if (compileResult.status !== 0) {
    const err = [compileResult.stdout, compileResult.stderr].filter(Boolean).join('\n').trim();
    return { success: false, output: `Compile failed:\n${err}` };
  }

  // Upload
  const uploadResult = spawnSync(
    cli,
    ['upload', '--fqbn', context.boardFqbn, '--port', context.port, context.sketchPath],
    { encoding: 'utf-8', timeout: 60_000 }
  );
  const output = [uploadResult.stdout, uploadResult.stderr].filter(Boolean).join('\n').trim();
  if (uploadResult.status === 0) {
    return { success: true, output: output || 'Upload successful ✓ — sketch is running on the board.' };
  }
  return { success: false, output: output || `Upload failed (exit code ${uploadResult.status})` };
}
