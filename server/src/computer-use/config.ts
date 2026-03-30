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
  PLAN_CREATED = "plan_created",
  SUBTASK_STARTED = "subtask_started",
  SUBTASK_UPDATE = "subtask_update",
  SUBTASK_COMPLETED = "subtask_completed",
  SUBTASK_FAILED = "subtask_failed",
  ORCHESTRATOR_DONE = "orchestrator_done",
  USAGE_UPDATE = "usage_update",
  APPROVAL_REQUIRED = "approval_required",
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

/* ── Orchestrator types ── */

export interface SubTask {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: string;
  error?: string;
}

export interface Plan {
  goal: string;
  subtasks: SubTask[];
}

export interface PlanCreatedEvent extends BaseSSEEvent {
  type: SSEEventType.PLAN_CREATED;
  plan: Plan;
}

export interface SubtaskStartedEvent extends BaseSSEEvent {
  type: SSEEventType.SUBTASK_STARTED;
  subtaskId: string;
  title: string;
}

export interface SubtaskUpdateEvent extends BaseSSEEvent {
  type: SSEEventType.SUBTASK_UPDATE;
  subtaskId: string;
  inner: SSEEvent;
}

export interface SubtaskCompletedEvent extends BaseSSEEvent {
  type: SSEEventType.SUBTASK_COMPLETED;
  subtaskId: string;
  result: string;
}

export interface SubtaskFailedEvent extends BaseSSEEvent {
  type: SSEEventType.SUBTASK_FAILED;
  subtaskId: string;
  error: string;
}

export interface OrchestratorDoneEvent extends BaseSSEEvent {
  type: SSEEventType.ORCHESTRATOR_DONE;
  summary: string;
  plan: Plan;
}

export interface UsageUpdateEvent extends BaseSSEEvent {
  type: SSEEventType.USAGE_UPDATE;
  usage: {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    sandboxMinutes: number;
    estimatedCostUsd: number;
  };
}

export interface ApprovalRequiredEvent extends BaseSSEEvent {
  type: SSEEventType.APPROVAL_REQUIRED;
  subtaskId: string;
  action: string;
  description: string;
  risk: "low" | "medium" | "high";
}

export type SSEEvent =
  | ActionEvent
  | ReasoningEvent
  | DoneEvent
  | ErrorEvent
  | SandboxCreatedEvent
  | ActionCompletedEvent
  | PlanCreatedEvent
  | SubtaskStartedEvent
  | SubtaskUpdateEvent
  | SubtaskCompletedEvent
  | SubtaskFailedEvent
  | OrchestratorDoneEvent
  | UsageUpdateEvent
  | ApprovalRequiredEvent;

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
