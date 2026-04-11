import { AgentTool, ToolResult } from '../agent-tools';
import { AgentContext } from '../../../common/protocol/agent-service';
import { recommendBoard } from '../knowledge/boards';
import { recommendComponents, getComponent, loadComponents } from '../knowledge/components';
import { assignPins, validatePins, checkPowerBudget } from '../knowledge/pins';
import { DesignSpec, BoardRequirements } from '../knowledge/types';

export function makeDesignTool(): AgentTool {
  return {
    name: 'suggest_design',
    description:
      'From a natural language project description, pick the best board, select components, assign pins, and validate. Returns a complete DesignSpec. The user only needs to describe what they want — this tool figures out everything.',
    parameters: {
      description: {
        type: 'string',
        description: 'What the user wants to build, e.g. "motion-activated alarm"',
      },
      board: {
        type: 'string',
        description: 'Optional: board ID if user specified one (e.g. "arduino_uno"). Leave empty to auto-select.',
      },
      constraints: {
        type: 'string',
        description: 'Optional: user constraints like "I already have a DHT22"',
      },
    },
    required: ['description'],
    async execute(params: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
      try {
        const description = (params['description'] as string || '').toLowerCase();
        const boardOverride = params['board'] as string | undefined;
        const constraints = (params['constraints'] as string || '').toLowerCase();

        // 1. Analyze requirements from description
        const requirements = analyzeRequirements(description);

        // 2. Select board
        let boardId: string;
        let alternativeBoards: Array<{ id: string; name: string; reasoning: string }> = [];

        if (boardOverride) {
          boardId = boardOverride;
        } else {
          // Use context board if available
          if (context.boardFqbn) {
            const allBoards = require('../knowledge/boards').loadBoards();
            const contextBoard = allBoards.find((b: { fqbn: string }) => b.fqbn === context.boardFqbn);
            if (contextBoard) {
              boardId = contextBoard.id;
            } else {
              const rec = recommendBoard(requirements);
              boardId = rec.primary.id;
              alternativeBoards = rec.alternatives.map((b) => ({
                id: b.id,
                name: b.name,
                reasoning: `Alternative: ${b.name} ($${b.price})`,
              }));
            }
          } else {
            const rec = recommendBoard(requirements);
            boardId = rec.primary.id;
            alternativeBoards = rec.alternatives.map((b) => ({
              id: b.id,
              name: b.name,
              reasoning: `Alternative: ${b.name} ($${b.price})`,
            }));
          }
        }

        // 3. Select components
        const needs = extractNeeds(description);
        let componentIds: string[];

        // If constraints mention specific components, use them
        const constraintComponents = parseConstraints(constraints);
        if (constraintComponents.length > 0) {
          componentIds = [...constraintComponents];
          // Add any additional needs not covered by constraints
          const recommended = recommendComponents(needs);
          for (const rec of recommended) {
            if (!componentIds.includes(rec.id)) {
              // Check if constraint already covers this need
              const constraintCoversNeed = constraintComponents.some((cId) => {
                const c = getComponent(cId);
                return c && needs.some((n) => c.keywords.includes(n));
              });
              if (!constraintCoversNeed) {
                componentIds.push(rec.id);
              }
            }
          }
        } else {
          componentIds = recommendComponents(needs).map((c) => c.id);
        }

        if (componentIds.length === 0) {
          return {
            success: false,
            output: 'Could not determine what components are needed. Please be more specific about what you want to build.',
          };
        }

        // 4. Assign pins
        const pinAssignments = assignPins(boardId, componentIds);

        // 5. Validate
        const validationIssues = validatePins(boardId, pinAssignments);

        // 6. Power budget
        const powerReport = checkPowerBudget(boardId, componentIds);

        // 7. Collect libraries
        const libraries = new Set<string>();
        for (const compId of componentIds) {
          const comp = getComponent(compId);
          if (comp) {
            comp.libraries.forEach((lib) => libraries.add(lib));
          }
        }

        // 8. Get board info
        const { getBoard } = require('../knowledge/boards');
        const board = getBoard(boardId);

        // 9. Build summary
        const componentNames = componentIds
          .map((id) => getComponent(id)?.name || id)
          .join(', ');
        const summary = `Design for "${params['description']}": Using ${board?.name || boardId} with ${componentNames}. ${validationIssues.filter((i) => i.severity === 'error').length} errors, ${validationIssues.filter((i) => i.severity === 'warning').length} warnings.`;

        const designSpec: DesignSpec = {
          boardId,
          boardName: board?.name || boardId,
          boardFqbn: board?.fqbn || '',
          components: componentIds,
          pinAssignments,
          libraries: Array.from(libraries),
          powerReport,
          validationIssues,
          alternativeBoards,
          summary,
        };

        return {
          success: true,
          output: JSON.stringify(designSpec, null, 2),
        };
      } catch (err) {
        return {
          success: false,
          output: `Design error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

function analyzeRequirements(description: string): BoardRequirements {
  const req: BoardRequirements = {};
  if (/wifi|wireless|iot|web|http|mqtt|cloud|weather station/i.test(description)) {
    req.needsWifi = true;
  }
  if (/bluetooth|ble|wireless/i.test(description)) {
    req.needsBluetooth = true;
  }
  if (/camera|photo|image|vision|see|doorbell/i.test(description)) {
    req.needsCamera = true;
  }
  if (/sd card|storage|log|record/i.test(description)) {
    req.needsSdCard = true;
  }
  if (/5v|five volt/i.test(description)) {
    req.needs5vLogic = true;
  }
  return req;
}

function extractNeeds(description: string): string[] {
  const needs: string[] = [];
  const keywordMap: Record<string, string> = {
    'temperature': 'temperature', 'temp': 'temperature', 'heat': 'temperature', 'thermometer': 'temperature',
    'humidity': 'humidity', 'moisture': 'humidity',
    'display': 'display', 'screen': 'display', 'show': 'display', 'monitor': 'display', 'lcd': 'lcd', 'oled': 'oled',
    'distance': 'distance', 'ultrasonic': 'distance', 'proximity': 'proximity', 'sonar': 'distance',
    'motion': 'motion', 'movement': 'motion', 'detect': 'motion',
    'alarm': 'alarm', 'alert': 'alarm', 'warning': 'alarm', 'siren': 'alarm',
    'sound': 'sound', 'noise': 'sound', 'audio': 'audio', 'speaker': 'speaker', 'music': 'speaker',
    'light': 'light', 'led': 'led', 'blink': 'blink', 'lamp': 'light',
    'button': 'button', 'press': 'button', 'switch': 'switch', 'click': 'button',
    'servo': 'servo', 'motor': 'motor', 'actuator': 'servo', 'lock': 'lock', 'door': 'lock',
    'touch': 'touch', 'tap': 'touch',
    'relay': 'relay', 'power': 'relay', 'fan': 'relay',
    'neopixel': 'neopixel', 'rgb': 'rgb', 'led strip': 'led strip', 'rainbow': 'neopixel',
    'potentiometer': 'potentiometer', 'dial': 'dial', 'knob': 'knob', 'volume': 'volume',
    'microphone': 'microphone', 'mic': 'microphone', 'voice': 'voice',
    'camera': 'camera', 'photo': 'camera', 'doorbell': 'camera',
  };

  for (const [keyword, need] of Object.entries(keywordMap)) {
    if (description.includes(keyword) && !needs.includes(need)) {
      needs.push(need);
    }
  }
  return needs;
}

function parseConstraints(constraints: string): string[] {
  if (!constraints) return [];
  const components = loadComponents();
  const found: string[] = [];
  for (const comp of components) {
    if (constraints.includes(comp.id) || constraints.includes(comp.name.toLowerCase())) {
      found.push(comp.id);
    }
    // Check for partial matches like "dht22"
    for (const kw of comp.keywords) {
      if (constraints.includes(kw) && !found.includes(comp.id)) {
        // Only match if it's clearly a component reference
        if (comp.id.includes(kw) || comp.name.toLowerCase().includes(kw)) {
          found.push(comp.id);
        }
      }
    }
  }
  return found;
}
