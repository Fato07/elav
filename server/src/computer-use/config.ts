export const SANDBOX_TIMEOUT_MS = 300_000; // 5 minutes

export const MAX_RESOLUTION_WIDTH = 1024;
export const MAX_RESOLUTION_HEIGHT = 768;
export const MIN_RESOLUTION_WIDTH = 640;
export const MIN_RESOLUTION_HEIGHT = 480;
export const DEFAULT_RESOLUTION: [number, number] = [1024, 720];

export const OPENAI_MODEL = "gpt-5.4";
export const CLAUDE_MODEL = "claude-sonnet-4-20250514";

export type ModelProvider = "openai" | "anthropic";
export const DEFAULT_PROVIDER: ModelProvider = "openai";

/* ── SSE types shared between streamers and route ── */

export enum SSEEventType {
  UPDATE = "update",
  ACTION = "action",
  REASONING = "reasoning",
  DONE = "done",
  ERROR = "error",
  SANDBOX_CREATED = "sandbox_created",
  ACTION_COMPLETED = "action_completed",
}

export interface BaseSSEEvent {
  type: SSEEventType;
}

export interface ActionEvent extends BaseSSEEvent {
  type: SSEEventType.ACTION;
  action: Record<string, unknown>;
}

export interface ReasoningEvent extends BaseSSEEvent {
  type: SSEEventType.REASONING;
  content: string;
}

export interface DoneEvent extends BaseSSEEvent {
  type: SSEEventType.DONE;
  content?: string;
}

export interface ErrorEvent extends BaseSSEEvent {
  type: SSEEventType.ERROR;
  content: string;
}

export interface SandboxCreatedEvent extends BaseSSEEvent {
  type: SSEEventType.SANDBOX_CREATED;
  sandboxId: string;
  vncUrl: string;
}

export interface ActionCompletedEvent extends BaseSSEEvent {
  type: SSEEventType.ACTION_COMPLETED;
}

export type SSEEvent =
  | ActionEvent
  | ReasoningEvent
  | DoneEvent
  | ErrorEvent
  | SandboxCreatedEvent
  | ActionCompletedEvent;

export type ActionResponse = {
  action: string;
  data: unknown;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/* ── Streaming facade ── */

export interface StreamProps {
  signal: AbortSignal;
  messages: { role: "user" | "assistant"; content: string }[];
}

export abstract class ComputerStreamerFacade {
  abstract instructions: string;
  abstract desktop: import("@e2b/desktop").Sandbox;
  abstract resolution: [number, number];
  abstract stream(props: StreamProps): AsyncGenerator<SSEEvent>;
  abstract executeAction(action: unknown): Promise<ActionResponse | void>;
}
