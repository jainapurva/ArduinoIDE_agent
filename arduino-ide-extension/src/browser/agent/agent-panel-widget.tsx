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
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import URI from '@theia/core/lib/common/uri';
import {
  AgentService,
  AgentServicePath,
  AgentServiceClient,
  AgentMessage,
  AgentContext,
  FileChange,
} from '../../common/protocol/agent-service';
import { BoardsServiceProvider } from '../boards/boards-service-provider';
import { SketchesServiceClientImpl } from '../sketches-service-client-impl';
import { MonitorModel } from '../monitor-model';
import { BuildStateService } from '../../common/protocol/build-state-service';
import { OutputChannelManager } from '../theia/output/output-channel';

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
  pendingChanges: FileChange[];
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

  @inject(BuildStateService)
  private readonly buildStateService: BuildStateService;

  @inject(OpenerService)
  private readonly openerService: OpenerService;

  @inject(OutputChannelManager)
  private readonly outputChannelManager: OutputChannelManager;

  private agentService!: AgentService;

  private state: ChatState = {
    messages: [],
    input: '',
    isRunning: false,
    streamingText: '',
    activeToolName: null,
    sessionId: null,
    error: null,
    pendingChanges: [],
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
    if (toolName === 'compile' || toolName === 'upload') {
      const channel = this.outputChannelManager.getChannel('Arduino');
      channel.show({ preserveFocus: true });
      channel.appendLine(`\n── agent: ${toolName} starting ──`);
    }
  }

  onToolEnd(
    _sessionId: string,
    toolName: string,
    result: string,
    success: boolean
  ): void {
    this.setState({ activeToolName: null });
    if (toolName === 'compile' || toolName === 'upload') {
      const channel = this.outputChannelManager.getChannel('Arduino');
      channel.appendLine(result || '(no output)');
      channel.appendLine(`── ${toolName} ${success ? 'succeeded ✓' : 'failed ✗'} ──`);
    }
    // After auto-accept on the backend, the diff has served its purpose.
    // Clear pending diffs once write_file finishes so the UI moves on.
    if (toolName === 'write_file' && this.state.pendingChanges.length > 0) {
      // Open the file in the editor first so the user sees what was applied.
      const lastChange = this.state.pendingChanges[this.state.pendingChanges.length - 1];
      this.openSketchFile(lastChange.sketchPath, lastChange.filename).catch(() => {});
      this.setState({ pendingChanges: [] });
    }
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

  onFileChange(change: FileChange): void {
    this.setState({
      pendingChanges: [...this.state.pendingChanges, change],
    });
    // Pre-open the target file in the editor so the user sees what the agent is about to modify.
    this.openSketchFile(change.sketchPath, change.filename).catch(() => {
      /* file may not exist yet — that's fine, will open after Accept */
    });
  }

  private async openSketchFile(sketchPath: string, filename: string): Promise<void> {
    if (!sketchPath || !filename) return;
    const fullPath = sketchPath.endsWith('/')
      ? `${sketchPath}${filename}`
      : `${sketchPath}/${filename}`;
    const uri = new URI(`file://${fullPath}`);
    await open(this.openerService, uri, { mode: 'reveal' });
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
    this.setState({ messages: [], streamingText: '', error: null, pendingChanges: [] });
  };

  private readonly handleAcceptChange = async (changeId: string) => {
    const change = this.state.pendingChanges.find((c) => c.changeId === changeId);
    await this.agentService.resolveFileChange(changeId, true);
    this.setState({
      pendingChanges: this.state.pendingChanges.filter((c) => c.changeId !== changeId),
    });
    // After backend writes the file, open/reveal it in the editor so the user sees the new content.
    if (change) {
      // small delay lets Theia's file watcher pick up the change before we reveal
      setTimeout(() => {
        this.openSketchFile(change.sketchPath, change.filename).catch(() => {});
      }, 150);
    }
  };

  private readonly handleRejectChange = async (changeId: string) => {
    await this.agentService.resolveFileChange(changeId, false);
    this.setState({
      pendingChanges: this.state.pendingChanges.filter((c) => c.changeId !== changeId),
    });
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

    // Fetch latest build state
    let lastBuildOutput = '';
    let lastBuildErrors = '';
    try {
      const lastBuild = await this.buildStateService.getLastBuild();
      if (lastBuild) {
        lastBuildOutput = lastBuild.output;
        lastBuildErrors = lastBuild.errors;
      }
    } catch {
      // Not critical — agent works without build context
    }

    return {
      sketchCode: '', // filled server-side from sketchPath
      sketchFiles: [], // filled server-side from sketchPath
      sketchPath,
      boardFqbn: selectedBoard?.fqbn ?? '',
      boardName: selectedBoard?.name ?? '',
      port: selectedPort?.address ?? '',
      lastBuildOutput,
      lastBuildErrors,
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

          {/* Pending file change diffs */}
          {this.state.pendingChanges.map((change) =>
            this.renderDiffView(change)
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

  private renderDiffView(change: FileChange): React.ReactNode {
    const isNew = change.oldContent === '';
    const label = isNew ? '(new file)' : '(modified)';
    const diffLines = this.computeDiff(change.oldContent, change.newContent);

    return (
      <div key={change.changeId} className="agent-diff">
        <div className="agent-diff__header">
          <span className="codicon codicon-diff" />{' '}
          {change.filename} {label}
        </div>
        <div className="agent-diff__body">
          {diffLines.map((line, i) => (
            <div
              key={i}
              className={`agent-diff__line agent-diff__line--${line.type}`}
            >
              <span className="agent-diff__line-prefix">
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
              </span>
              <span className="agent-diff__line-text">{line.text}</span>
            </div>
          ))}
        </div>
        <div className="agent-diff__actions">
          <button
            className="agent-btn agent-btn--accept"
            onClick={() => this.handleAcceptChange(change.changeId)}
          >
            <span className="codicon codicon-check" /> Accept
          </button>
          <button
            className="agent-btn agent-btn--reject"
            onClick={() => this.handleRejectChange(change.changeId)}
          >
            <span className="codicon codicon-close" /> Reject
          </button>
        </div>
      </div>
    );
  }

  private computeDiff(
    oldContent: string,
    newContent: string
  ): Array<{ type: 'added' | 'removed' | 'context'; text: string }> {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    // Simple LCS-based line diff
    const m = oldLines.length;
    const n = newLines.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      new Array(n + 1).fill(0)
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to produce diff
    const diff: Array<{ type: 'added' | 'removed' | 'context'; text: string }> = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        diff.push({ type: 'context', text: oldLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        diff.push({ type: 'added', text: newLines[j - 1] });
        j--;
      } else {
        diff.push({ type: 'removed', text: oldLines[i - 1] });
        i--;
      }
    }

    diff.reverse();
    return diff;
  }
}

const EXAMPLE_PROMPTS = [
  'Build me a temperature and humidity monitor with a display',
  'I want a motion-activated alarm system',
  'Create a WiFi weather station that logs to serial',
  'Build a servo-controlled door lock with a button',
  'I want to control NeoPixel LEDs with a potentiometer',
];
