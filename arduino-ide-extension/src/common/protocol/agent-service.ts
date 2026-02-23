/**
 * ArduinoIDE Agent — Shared protocol between frontend and backend.
 * The frontend sends chat messages; the backend runs the agentic loop
 * (LLM → tool calls → compile/flash/serial feedback → loop).
 */

export const AgentServicePath = '/services/agent-service';
export const AgentService = Symbol('AgentService');

// ─── Message types ────────────────────────────────────────────────────────────

export type AgentRole = 'user' | 'assistant' | 'tool';

export interface AgentMessage {
  id: string;
  role: AgentRole;
  content: string;
  /** ISO timestamp */
  timestamp: string;
  /** If this message is a tool-call result */
  toolName?: string;
  toolStatus?: 'running' | 'success' | 'error';
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface AgentSession {
  sessionId: string;
  messages: AgentMessage[];
  isRunning: boolean;
  iterationCount: number;
}

// ─── Context snapshot (injected into system prompt) ──────────────────────────

export interface AgentContext {
  sketchCode: string;
  sketchPath: string;
  boardFqbn: string;
  boardName: string;
  port: string;
  lastBuildOutput: string;
  lastBuildErrors: string;
  serialBuffer: string;
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface AgentService {
  /**
   * Send a user message and start (or continue) the agentic loop.
   * The backend streams responses back via the notification client.
   */
  chat(sessionId: string, userMessage: string, context: AgentContext): Promise<void>;

  /** Abort the currently running agent loop */
  abort(sessionId: string): Promise<void>;

  /** Create a new session, returns sessionId */
  createSession(): Promise<string>;

  /** Get full session history */
  getSession(sessionId: string): Promise<AgentSession | undefined>;

  /** Clear session history */
  clearSession(sessionId: string): Promise<void>;
}

// ─── Notification client (backend → frontend streaming) ──────────────────────

export const AgentServiceClientPath = '/services/agent-service-client';
export const AgentServiceClient = Symbol('AgentServiceClient');

export interface AgentServiceClient {
  /** Streamed token from LLM */
  onToken(sessionId: string, token: string): void;

  /** Tool call started */
  onToolStart(sessionId: string, toolName: string, params: Record<string, unknown>): void;

  /** Tool call completed */
  onToolEnd(sessionId: string, toolName: string, result: string, success: boolean): void;

  /** Full message appended to session */
  onMessage(sessionId: string, message: AgentMessage): void;

  /** Agent loop finished */
  onDone(sessionId: string): void;

  /** Agent loop error */
  onError(sessionId: string, error: string): void;
}
