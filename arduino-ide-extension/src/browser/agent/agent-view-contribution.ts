/**
 * AgentViewContribution — Registers the AI Agent panel as the MAIN view.
 * Chat-first UI: the agent panel takes center stage.
 * Code editor opens on-demand when user clicks a file name.
 */

import { injectable } from '@theia/core/shared/inversify';
import {
  AbstractViewContribution,
  FrontendApplicationContribution,
  FrontendApplication,
  KeybindingRegistry,
} from '@theia/core/lib/browser';
import { Command, CommandRegistry, MenuModelRegistry } from '@theia/core';
import { AgentPanelWidget } from './agent-panel-widget';
import { ArduinoMenus } from '../menu/arduino-menus';
import { ApplicationShell } from '../theia/core/application-shell';

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
        area: 'main',  // CENTER — not sidebar. This is the primary view.
      },
      toggleCommandId: AgentCommands.TOGGLE_AGENT_PANEL.id,
    });
  }

  async initializeLayout(app: FrontendApplication): Promise<void> {
    // Open the agent panel as the primary view on startup
    await this.openView({ activate: true, reveal: true });

    // Collapse sidebars and bottom panel — chat-first UI
    const shell = app.shell as ApplicationShell;
    if (shell.collapseSecondaryPanels) {
      // Small delay to ensure layout is initialized first
      setTimeout(() => shell.collapseSecondaryPanels(), 500);
    }
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
