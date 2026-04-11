import { AgentTool, ToolResult } from '../agent-tools';
import { AgentContext } from '../../../common/protocol/agent-service';
import { validatePins, checkPowerBudget } from '../knowledge/pins';
import { DesignSpec } from '../knowledge/types';

export function makeValidateTool(): AgentTool {
  return {
    name: 'validate_design',
    description:
      'Check a hardware design for errors — pin conflicts, power budget issues, voltage mismatches, strapping pin warnings. Input is a DesignSpec JSON string.',
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

        const issues = validatePins(design.boardId, design.pinAssignments);
        const power = checkPowerBudget(design.boardId, design.components);

        const errors = issues.filter((i) => i.severity === 'error');
        const warnings = issues.filter((i) => i.severity === 'warning');

        let report = '## Validation Report\n\n';

        if (errors.length === 0 && warnings.length === 0 && !power.overBudget) {
          report += '**All checks passed.** No errors or warnings.\n';
        }

        if (errors.length > 0) {
          report += `### Errors (${errors.length})\n`;
          for (const e of errors) {
            report += `- **${e.component}**: ${e.message}\n`;
          }
          report += '\n';
        }

        if (warnings.length > 0) {
          report += `### Warnings (${warnings.length})\n`;
          for (const w of warnings) {
            report += `- ${w.component}: ${w.message}\n`;
          }
          report += '\n';
        }

        report += '### Power Budget\n';
        report += `- Total draw: ${power.totalCurrentMa}mA\n`;
        report += `- Board max (3.3V rail): ${power.maxCurrentMa}mA\n`;
        report += `- Margin: ${power.marginMa}mA\n`;
        report += power.overBudget
          ? '- **OVER BUDGET** — consider external power supply\n'
          : '- **OK** — within power budget\n';

        return { success: errors.length === 0, output: report };
      } catch (err) {
        return { success: false, output: `Validation error: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
