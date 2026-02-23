/**
 * AgentTools — All tools available to the AI agent.
 * Each tool wraps existing Arduino IDE backend services.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { CoreServiceImpl } from '../core-service-impl';
import { MonitorManagerProxyImpl } from '../monitor-manager-proxy-impl';
import { ILogger } from '@theia/core/lib/common/logger';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeTool } from './claude-client';
import { AgentContext } from '../../common/protocol/agent-service';

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
  @inject(ILogger)
  private readonly logger: ILogger;

  private tools: Map<string, AgentTool> = new Map();

  /** Register built-in tools. Call after all services are ready. */
  registerBuiltins(
    coreService: CoreServiceImpl,
    monitorProxy: MonitorManagerProxyImpl
  ): void {
    this.register(this.makeReadFileTool());
    this.register(this.makeWriteFileTool());
    this.register(this.makeListFilesTool());
    this.register(this.makeCompileTool(coreService));
    this.register(this.makeUploadTool(coreService));
    this.register(this.makeReadSerialTool(monitorProxy));
    this.register(this.makeInstallLibraryHintTool());
  }

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
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
      this.logger.error(`[AgentTool:${name}] ${msg}`);
      return { success: false, output: `Tool error: ${msg}` };
    }
  }

  // ─── Tool Factories ──────────────────────────────────────────────────────

  private makeReadFileTool(): AgentTool {
    return {
      name: 'read_file',
      description: 'Read the contents of a file in the current sketch directory.',
      parameters: {
        filename: { type: 'string', description: 'File name relative to sketch directory (e.g. "sketch.ino" or "config.h")' },
      },
      required: ['filename'],
      async execute(params, context) {
        const filepath = path.join(context.sketchPath, params['filename'] as string);
        if (!fs.existsSync(filepath)) {
          return { success: false, output: `File not found: ${params['filename']}` };
        }
        const content = fs.readFileSync(filepath, 'utf-8');
        return { success: true, output: content };
      },
    };
  }

  private makeWriteFileTool(): AgentTool {
    return {
      name: 'write_file',
      description:
        'Write or overwrite a file in the current sketch directory. Use this to modify the sketch code.',
      parameters: {
        filename: { type: 'string', description: 'File name (e.g. "sketch.ino")' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['filename', 'content'],
      async execute(params, context) {
        const filepath = path.join(context.sketchPath, params['filename'] as string);
        fs.writeFileSync(filepath, params['content'] as string, 'utf-8');
        return { success: true, output: `Written ${params['filename']}` };
      },
    };
  }

  private makeListFilesTool(): AgentTool {
    return {
      name: 'list_files',
      description: 'List all files in the current sketch directory.',
      parameters: {},
      async execute(_params, context) {
        if (!fs.existsSync(context.sketchPath)) {
          return { success: false, output: 'Sketch path does not exist.' };
        }
        const files = fs.readdirSync(context.sketchPath);
        return { success: true, output: files.join('\n') };
      },
    };
  }

  private makeCompileTool(coreService: CoreServiceImpl): AgentTool {
    return {
      name: 'compile',
      description:
        'Compile the current Arduino sketch. Returns build output and any errors.',
      parameters: {},
      async execute(_params, context) {
        try {
          const output: string[] = [];
          await coreService.compile({
            sketch: { name: path.basename(context.sketchPath), uri: `file://${context.sketchPath}` } as any,
            fqbn: context.boardFqbn,
            optimizeForDebug: false,
            sourceOverride: {},
            exportBinaries: false,
            verbose: false,
            warnings: 'None',
          }, {
            onData: (data: string) => output.push(data),
          } as any);
          return { success: true, output: output.join('\n') || 'Compilation successful.' };
        } catch (err: any) {
          return { success: false, output: `Compilation failed: ${err?.message || err}` };
        }
      },
    };
  }

  private makeUploadTool(coreService: CoreServiceImpl): AgentTool {
    return {
      name: 'upload',
      description:
        'Compile and upload the current sketch to the connected board.',
      parameters: {},
      async execute(_params, context) {
        if (!context.port) {
          return { success: false, output: 'No port selected. Connect a board first.' };
        }
        try {
          const output: string[] = [];
          await coreService.upload({
            sketch: { name: path.basename(context.sketchPath), uri: `file://${context.sketchPath}` } as any,
            fqbn: context.boardFqbn,
            port: { address: context.port, protocol: 'serial' },
            verbose: false,
            verify: false,
            userFields: [],
            programmer: undefined,
          } as any, {
            onData: (data: string) => output.push(data),
          } as any);
          return { success: true, output: output.join('\n') || 'Upload successful.' };
        } catch (err: any) {
          return { success: false, output: `Upload failed: ${err?.message || err}` };
        }
      },
    };
  }

  private makeReadSerialTool(_monitorProxy: MonitorManagerProxyImpl): AgentTool {
    return {
      name: 'read_serial',
      description:
        'Read recent output from the serial monitor. Returns the latest buffered data from the board.',
      parameters: {
        lines: {
          type: 'number',
          description: 'Number of recent lines to return (default: 20)',
        },
      },
      async execute(_params, context) {
        // Return the serial buffer that was captured in context
        if (!context.serialBuffer) {
          return { success: true, output: '(no serial data available yet)' };
        }
        const lines = ((_params['lines'] as number) || 20);
        const all = context.serialBuffer.split('\n');
        return { success: true, output: all.slice(-lines).join('\n') };
      },
    };
  }

  private makeInstallLibraryHintTool(): AgentTool {
    return {
      name: 'suggest_library',
      description:
        'Suggest an Arduino library to install for a specific functionality (sensor, protocol, display, etc.). Returns the library name and install command.',
      parameters: {
        functionality: {
          type: 'string',
          description: 'What you need (e.g. "I2C temperature sensor", "OLED display", "WiFi HTTP client")',
        },
      },
      required: ['functionality'],
      async execute(params) {
        // Static mapping for common needs — extend over time
        const need = ((params['functionality'] as string) || '').toLowerCase();
        const suggestions: Record<string, string> = {
          'temperature': 'Adafruit_Unified_Sensor + Adafruit_BME280 (for BME280) or Adafruit_DHT (for DHT11/22)',
          'oled': 'Adafruit_SSD1306 + Adafruit_GFX',
          'wifi': 'WiFi (built-in for ESP32/MKR) or WiFiNINA (for Nano 33 IoT)',
          'http': 'ArduinoHttpClient or HTTPClient (ESP32 built-in)',
          'mqtt': 'PubSubClient by Nick O\'Leary',
          'servo': 'Servo (built-in)',
          'neopixel': 'Adafruit NeoPixel',
          'i2c': 'Wire (built-in)',
          'spi': 'SPI (built-in)',
          'json': 'ArduinoJson by Benoit Blanchon',
          'lcd': 'LiquidCrystal (built-in) or LiquidCrystal_I2C',
          'imu': 'Adafruit_MPU6050 or SparkFun MPU-9250',
          'gps': 'TinyGPS++ by Mikal Hart',
          'stepper': 'Stepper (built-in) or AccelStepper',
          'bluetooth': 'ArduinoBLE (built-in for Nano 33 BLE) or BluetoothSerial (ESP32)',
          'ir': 'IRremote by shirriff',
          'rfid': 'MFRC522 by miguelbalboa',
          'ultrasonic': 'NewPing by Tim Eckel',
          'sd': 'SD (built-in)',
          'rtc': 'RTClib by Adafruit',
        };
        for (const [key, lib] of Object.entries(suggestions)) {
          if (need.includes(key)) {
            return {
              success: true,
              output: `Recommended library: ${lib}\nInstall via Arduino Library Manager (Ctrl+Shift+I) or Sketch > Include Library > Manage Libraries`,
            };
          }
        }
        return {
          success: true,
          output: `Search the Arduino Library Manager for: "${params['functionality']}"`,
        };
      },
    };
  }
}
