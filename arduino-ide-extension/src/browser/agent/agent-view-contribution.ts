/**
 * AgentViewContribution — Registers the AI Agent panel in the Theia shell.
 * Opens it on the right side, accessible via Ctrl+Shift+A and the View menu.
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  AbstractViewContribution,
  FrontendApplicationContribution,
  KeybindingRegistry,
} from '@theia/core/lib/browser';
import { Command, CommandRegistry, MenuModelRegistry } from '@theia/core';
import { AgentPanelWidget } from './agent-panel-widget';
import { ArduinoMenus } from '../menu/arduino-menus';

export namespace AgentCommands {
  export const TOGGLE_AGENT_PANEL: Command = {
    id: 'arduino-agent:toggle-panel',
    label: 'Toggle AI Agent Panel',
    iconClass: 'codicon codicon-robot',
  };

  export const OPEN_AGENT_PANEL: Command = {
    id: 'arduino-agent:open-panel',
    label: 'Open AI Agent',
    iconClass: 'codicon codicon-robot',
  };
}

@injectable()
export class AgentViewContribution
  extends AbstractViewContribution<AgentPanelWidget>
  implements FrontendApplicationContribution
{
  constructor() {
    super({
      widgetId: AgentPanelWidget.ID,
      widgetName: AgentPanelWidget.LABEL,
      defaultWidgetOptions: {
        area: 'right',
        rank: 100,
      },
      toggleCommandId: AgentCommands.TOGGLE_AGENT_PANEL.id,
    });
  }

  async initializeLayout(): Promise<void> {
    // Auto-open on first launch
    await this.openView({ activate: false, reveal: false });
  }

  override registerCommands(registry: CommandRegistry): void {
    super.registerCommands(registry);
    registry.registerCommand(AgentCommands.OPEN_AGENT_PANEL, {
      execute: () => this.openView({ activate: true }),
    });
  }

  override registerMenus(menus: MenuModelRegistry): void {
    super.registerMenus(menus);
    // Add to Tools menu
    menus.registerMenuAction(ArduinoMenus.TOOLS__MAIN_GROUP, {
      commandId: AgentCommands.OPEN_AGENT_PANEL.id,
      label: 'AI Agent Panel',
      order: '0',
    });
  }

  override registerKeybindings(registry: KeybindingRegistry): void {
    super.registerKeybindings(registry);
    registry.registerKeybinding({
      command: AgentCommands.TOGGLE_AGENT_PANEL.id,
      keybinding: 'ctrlcmd+shift+a',
    });
  }
}
