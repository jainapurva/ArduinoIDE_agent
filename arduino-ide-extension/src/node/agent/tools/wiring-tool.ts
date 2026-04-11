import { AgentTool, ToolResult } from '../agent-tools';
import { AgentContext } from '../../../common/protocol/agent-service';
import { getComponent } from '../knowledge/components';
import { getBoard } from '../knowledge/boards';
import { DesignSpec, PinAssignment } from '../knowledge/types';

const WIRE_COLORS: Record<string, string> = {
  '5V': 'red',
  'VIN': 'red',
  '3.3V': 'orange',
  'GND': 'black',
};

const SIGNAL_COLORS = ['yellow', 'green', 'blue', 'white', 'purple', 'brown', 'gray'];

export function makeWiringTool(): AgentTool {
  return {
    name: 'generate_wiring',
    description:
      'Generate step-by-step breadboard wiring instructions from a DesignSpec. Returns numbered steps with wire colors, organized by component.',
    parameters: {
      design: {
        type: 'string',
        description: 'JSON string of a DesignSpec (from suggest_design)',
      },
    },
    required: ['design'],
    async execute(params: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> {
      try {
        const designStr = params['design'] as string;
        let design: DesignSpec;
        try {
          design = JSON.parse(designStr);
        } catch {
          return { success: false, output: 'Invalid JSON. Pass the DesignSpec JSON from suggest_design.' };
        }

        const board = getBoard(design.boardId);
        if (!board) {
          return { success: false, output: `Unknown board: ${design.boardId}` };
        }

        let output = `# Wiring Instructions — ${board.name}\n\n`;
        let stepNum = 1;
        let signalColorIdx = 0;

        // Power Rails
        output += '## Power Rails\n';
        if (board.voltage <= 3.3) {
          output += `${stepNum++}. ${board.name} 3V3 → 3.3V rail (orange wire)\n`;
        }
        output += `${stepNum++}. ${board.name} GND → GND rail (black wire)\n`;
        const needs5v = design.pinAssignments.some((a) => a.boardPin === '5V');
        if (needs5v || board.voltage === 5.0) {
          output += `${stepNum++}. ${board.name} 5V/VIN → 5V rail (red wire)\n`;
        }
        output += '\n';

        // Group assignments by component
        const byComponent = new Map<string, PinAssignment[]>();
        for (const a of design.pinAssignments) {
          const existing = byComponent.get(a.component) || [];
          existing.push(a);
          byComponent.set(a.component, existing);
        }

        // Component-by-component wiring
        for (const [compId, assignments] of byComponent.entries()) {
          const comp = getComponent(compId);
          const compName = comp?.name || compId;
          const wireCount = assignments.filter((a) =>
            !['3.3V', '5V', 'GND', 'VIN'].includes(a.boardPin) || true
          ).length;

          output += `## ${compName} (${wireCount} wires)\n`;

          for (const a of assignments) {
            let wireColor: string;
            if (WIRE_COLORS[a.boardPin]) {
              wireColor = WIRE_COLORS[a.boardPin];
            } else if (a.boardPin === '3.3V') {
              wireColor = 'orange';
            } else {
              wireColor = SIGNAL_COLORS[signalColorIdx % SIGNAL_COLORS.length];
              signalColorIdx++;
            }

            const target = ['3.3V', '5V', 'GND'].includes(a.boardPin)
              ? `${a.boardPin} rail`
              : a.boardPin;

            output += `${stepNum++}. ${a.componentPin} → ${target} (${wireColor} wire)`;
            if (a.notes) output += ` — ${a.notes}`;
            output += '\n';
          }
          output += '\n';
        }

        // Bus Summary
        output += '## Bus Summary\n';
        output += '| Bus | Components | Pins |\n';
        output += '|-----|-----------|------|\n';

        const busGroups = new Map<string, { components: Set<string>; pins: string[] }>();
        for (const [compId, assignments] of byComponent.entries()) {
          const comp = getComponent(compId);
          if (!comp) continue;
          const busType = comp.bus.toUpperCase();
          if (!busGroups.has(busType)) {
            busGroups.set(busType, { components: new Set(), pins: [] });
          }
          const group = busGroups.get(busType)!;
          group.components.add(comp.name);
          for (const a of assignments) {
            if (!['3.3V', '5V', 'GND', 'VIN'].includes(a.boardPin)) {
              group.pins.push(`${a.componentPin}=${a.boardPin}`);
            }
          }
        }

        for (const [bus, group] of busGroups.entries()) {
          output += `| ${bus} | ${Array.from(group.components).join(', ')} | ${group.pins.join(', ')} |\n`;
        }

        return { success: true, output };
      } catch (err) {
        return { success: false, output: `Wiring error: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
