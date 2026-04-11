/**
 * AgentPanelWidget — Cursor-style AI chat panel.
 * Wires real IDE context: board FQBN, port, sketch path, serial buffer.
 */

import * as React from '@theia/core/shared/react';
import {
  injectable,
  inject,
  postConstruct,
} from '@theia/core/shared/inversify';
import { ReactWidget, Message } from '@theia/core/lib/browser';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging/ws-connection-provider';
import {
  AgentService,
  AgentServicePath,
  AgentServiceClient,
  AgentMessage,
  AgentContext,
} from '../../common/protocol/agent-service';
import { BoardsServiceProvider } from '../boards/boards-service-provider';
import { SketchesServiceClientImpl } from '../sketches-service-client-impl';
import { MonitorModel } from '../monitor-model';

export const AGENT_PANEL_WIDGET_ID = 'arduino-agent-panel';
export const AGENT_PANEL_WIDGET_LABEL = 'AI Agent';

interface ChatState {
  messages: AgentMessage[];
  input: string;
  isRunning: boolean;
  streamingText: string;
  activeToolName: string | null;
  sessionId: string | null;
  error: string | null;
}

@injectable()
export class AgentPanelWidget extends ReactWidget implements AgentServiceClient {
  static readonly ID = AGENT_PANEL_WIDGET_ID;
  static readonly LABEL = AGENT_PANEL_WIDGET_LABEL;

  @inject(WebSocketConnectionProvider)
  private readonly connectionProvider: WebSocketConnectionProvider;

  @inject(BoardsServiceProvider)
  private readonly boardsServiceProvider: BoardsServiceProvider;

  @inject(SketchesServiceClientImpl)
  private readonly sketchesClient: SketchesServiceClientImpl;

  @inject(MonitorModel)
  private readonly monitorModel: MonitorModel;

  private agentService!: AgentService;

  private state: ChatState = {
    messages: [],
    input: '',
    isRunning: false,
    streamingText: '',
    activeToolName: null,
    sessionId: null,
    error: null,
  };

  @postConstruct()
  protected init(): void {
    this.id = AGENT_PANEL_WIDGET_ID;
    this.title.label = AGENT_PANEL_WIDGET_LABEL;
    this.title.caption = 'ArduinoIDE Agent — AI-powered embedded development';
    this.title.iconClass = 'codicon codicon-robot';
    this.title.closable = true;
    this.addClass('agent-panel-widget');

    // Connect to backend via JSON-RPC (this widget IS the notification client)
    this.agentService = this.connectionProvider.createProxy<AgentService>(
      AgentServicePath,
      this as AgentServiceClient
    );

    // Create initial session
    this.agentService.createSession().then((sessionId) => {
      this.setState({ sessionId });
    });

    this.update();
  }

  // ── AgentServiceClient callbacks (called by backend) ─────────────────────

  onToken(_sessionId: string, token: string): void {
    this.setState({ streamingText: this.state.streamingText + token });
  }

  onToolStart(_sessionId: string, toolName: string, _params: Record<string, unknown>): void {
    this.setState({ activeToolName: toolName });
  }

  onToolEnd(
    _sessionId: string,
    _toolName: string,
    _result: string,
    _success: boolean
  ): void {
    this.setState({ activeToolName: null });
  }

  onMessage(_sessionId: string, message: AgentMessage): void {
    this.setState({
      messages: [...this.state.messages, message],
      streamingText: '',
    });
  }

  onDone(_sessionId: string): void {
    this.setState({ isRunning: false, streamingText: '', activeToolName: null });
  }

  onError(_sessionId: string, error: string): void {
    this.setState({ isRunning: false, error, streamingText: '', activeToolName: null });
  }

  // ── State management ──────────────────────────────────────────────────────

  private setState(partial: Partial<ChatState>): void {
    this.state = { ...this.state, ...partial };
    this.update();
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  private readonly handleInputChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    this.setState({ input: e.target.value, error: null });
  };

  private readonly handleKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
    }
  };

  private readonly sendMessage = async () => {
    const { input, isRunning, sessionId } = this.state;
    if (!input.trim() || isRunning || !sessionId) return;

    this.setState({ input: '', isRunning: true, error: null });

    try {
      const context = await this.buildContext();
      await this.agentService.chat(sessionId, input.trim(), context);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ isRunning: false, error: msg });
    }
  };

  private readonly handleAbort = async () => {
    if (this.state.sessionId) {
      await this.agentService.abort(this.state.sessionId);
    }
    this.setState({ isRunning: false });
  };

  private readonly handleClear = async () => {
    if (this.state.sessionId) {
      await this.agentService.clearSession(this.state.sessionId);
    }
    this.setState({ messages: [], streamingText: '', error: null });
  };

  /**
   * Build AgentContext from live IDE state.
   * Board + port come from BoardsServiceProvider.
   * Sketch path comes from SketchesServiceClientImpl.
   * Serial buffer comes from MonitorModel.
   * Actual sketch code is read server-side from the path.
   */
  private async buildContext(): Promise<AgentContext> {
    // Board + port
    const { selectedBoard, selectedPort } = this.boardsServiceProvider.boardsConfig;

    // Sketch path
    let sketchPath = '';
    try {
      const currentSketch = await this.sketchesClient.currentSketch();
      // CurrentSketch is Sketch | 'invalid'
      if (currentSketch !== 'invalid' && typeof currentSketch === 'object') {
        const uri: string = currentSketch.uri;
        sketchPath = uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri;
      }
    } catch {
      // Not critical — agent will prompt user
    }

    // Serial buffer from MonitorModel (last 200 lines)
    const serialBuffer = this.getSerialBuffer();

    return {
      sketchCode: '', // filled server-side from sketchPath
      sketchPath,
      boardFqbn: selectedBoard?.fqbn ?? '',
      boardName: selectedBoard?.name ?? '',
      port: selectedPort?.address ?? '',
      lastBuildOutput: '',
      lastBuildErrors: '',
      serialBuffer,
    };
  }

  private getSerialBuffer(): string {
    // MonitorModel stores messages — extract last 200 lines of text
    try {
      const state = (this.monitorModel as unknown as { messages?: Array<{ message: string }> });
      if (state.messages) {
        return state.messages
          .slice(-200)
          .map((m) => m.message)
          .join('');
      }
    } catch {
      // fallback
    }
    return '';
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  protected override onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    this.update();
  }

  protected render(): React.ReactNode {
    const { messages, input, isRunning, streamingText, activeToolName, error } =
      this.state;

    const { selectedBoard, selectedPort } = this.boardsServiceProvider.boardsConfig;
    const boardLabel = selectedBoard?.name ?? null;
    const portLabel = selectedPort?.address ?? null;

    return (
      <div className="agent-panel">
        {/* Header */}
        <div className="agent-panel__header">
          <span className="agent-panel__title">
            <span className="codicon codicon-robot" />
            {' '}AI Agent
          </span>
          <div className="agent-panel__header-actions">
            {isRunning && (
              <button
                className="agent-btn agent-btn--abort"
                onClick={this.handleAbort}
                title="Stop agent"
              >
                <span className="codicon codicon-stop-circle" /> Stop
              </button>
            )}
            <button
              className="agent-btn agent-btn--ghost"
              onClick={this.handleClear}
              title="Clear conversation"
            >
              <span className="codicon codicon-clear-all" />
            </button>
          </div>
        </div>

        {/* Board + Port status bar */}
        <div className="agent-panel__context-bar">
          <span className={`agent-ctx-badge ${boardLabel ? '' : 'agent-ctx-badge--warn'}`}>
            <span className="codicon codicon-circuit-board" />
            {' '}{boardLabel ?? 'No board selected'}
          </span>
          <span className={`agent-ctx-badge ${portLabel ? '' : 'agent-ctx-badge--warn'}`}>
            <span className="codicon codicon-plug" />
            {' '}{portLabel ?? 'No port'}
          </span>
        </div>

        {/* Messages */}
        <div className="agent-panel__messages" ref={this.scrollToBottom}>
          {messages.length === 0 && !isRunning && (
            <div className="agent-panel__welcome">
              <div className="agent-welcome__icon">🤖</div>
              <div className="agent-welcome__title">ArduinoIDE Agent</div>
              <div className="agent-welcome__subtitle">
                Plug in your board, select it from the toolbar, then describe what you want to build.
                I'll write the code, compile it, flash it, and verify it works.
              </div>
              <div className="agent-welcome__examples">
                <div className="agent-welcome__example-label">Try asking:</div>
                {EXAMPLE_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    className="agent-welcome__chip"
                    onClick={() => this.setState({ input: p })}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => this.renderMessage(msg))}

          {/* Streaming in-progress text */}
          {streamingText && (
            <div className="agent-message agent-message--assistant agent-message--streaming">
              <div className="agent-message__avatar">AI</div>
              <div className="agent-message__content">
                <pre className="agent-message__text">{streamingText}</pre>
                <span className="agent-message__cursor" />
              </div>
            </div>
          )}

          {/* Active tool call indicator */}
          {activeToolName && (
            <div className="agent-tool-call">
              <span className="agent-tool-call__spinner" />
              <span className="agent-tool-call__name">
                Running: <code>{activeToolName}</code>
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="agent-error">
              <span className="codicon codicon-error" /> {error}
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="agent-panel__input-area">
          <textarea
            className="agent-panel__input"
            value={input}
            onChange={this.handleInputChange}
            onKeyDown={this.handleKeyDown}
            placeholder={
              isRunning
                ? 'Agent is working...'
                : 'Describe what you want to build... (Enter to send, Shift+Enter for newline)'
            }
            disabled={isRunning}
            rows={3}
          />
          <button
            className={`agent-btn agent-btn--send${isRunning || !input.trim() ? ' agent-btn--disabled' : ''}`}
            onClick={this.sendMessage}
            disabled={isRunning || !input.trim()}
            title="Send (Enter)"
          >
            <span className="codicon codicon-send" />
          </button>
        </div>
      </div>
    );
  }

  private readonly scrollToBottom = (el: HTMLDivElement | null) => {
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  private renderMessage(msg: AgentMessage): React.ReactNode {
    if (msg.role === 'tool') {
      return (
        <div key={msg.id} className="agent-tool-result">
          <div
            className={`agent-tool-result__header${
              msg.toolStatus === 'error' ? ' agent-tool-result--error' : ''
            }`}
          >
            <span
              className={`codicon ${
                msg.toolStatus === 'error' ? 'codicon-error' : 'codicon-check'
              }`}
            />
            {' '}
            <code>{msg.toolName}</code>
          </div>
          <pre className="agent-tool-result__output">{msg.content}</pre>
        </div>
      );
    }

    return (
      <div key={msg.id} className={`agent-message agent-message--${msg.role}`}>
        <div className="agent-message__avatar">
          {msg.role === 'user' ? 'You' : 'AI'}
        </div>
        <div className="agent-message__content">
          <pre className="agent-message__text">{msg.content}</pre>
          <div className="agent-message__time">
            {new Date(msg.timestamp).toLocaleTimeString()}
          </div>
        </div>
      </div>
    );
  }
}

const EXAMPLE_PROMPTS = [
  'Build me a temperature and humidity monitor with a display',
  'I want a motion-activated alarm system',
  'Create a WiFi weather station that logs to serial',
  'Build a servo-controlled door lock with a button',
  'I want to control NeoPixel LEDs with a potentiometer',
];
