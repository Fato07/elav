/* ── SSE event types (mirror server) ── */

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

/* ── Chat message types ── */

export type MessageRole = "user" | "assistant" | "system" | "action";

export interface BaseChatMessage {
  id: string;
  role: MessageRole;
}

export interface UserChatMessage extends BaseChatMessage {
  role: "user";
  content: string;
}

export interface AssistantChatMessage extends BaseChatMessage {
  role: "assistant";
  content: string;
}

export interface SystemChatMessage extends BaseChatMessage {
  role: "system";
  content: string;
  isError?: boolean;
}

export interface ActionChatMessage extends BaseChatMessage {
  role: "action";
  action: Record<string, unknown>;
  repeatCount?: number;
  status?: "pending" | "completed" | "failed";
}

export type ChatMessage =
  | UserChatMessage
  | AssistantChatMessage
  | SystemChatMessage
  | ActionChatMessage;

export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
}

export interface UsageData {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  sandboxMinutes: number;
  estimatedCostUsd: number;
}

export interface ApprovalRequest {
  subtaskId: string;
  action: string;
  description: string;
  risk: "low" | "medium" | "high";
}

export interface ParsedSSEEvent {
  type: SSEEventType;
  content?: string;
  action?: Record<string, unknown>;
  callId?: string;
  sandboxId?: string;
  vncUrl?: string;
  plan?: Plan;
  subtaskId?: string;
  title?: string;
  result?: string;
  error?: string;
  summary?: string;
  inner?: ParsedSSEEvent;
  usage?: UsageData;
  description?: string;
  risk?: "low" | "medium" | "high";
}

export interface SendMessageOptions {
  content: string;
  sandboxId?: string;
  environment?: string;
  resolution: [number, number];
  provider?: "openai" | "anthropic";
  systemPrompt?: string;
  companyId: string;
}

/* ── Config ── */

export const DEFAULT_RESOLUTION: [number, number] = [1024, 720];
export type ModelProvider = "openai" | "anthropic";
export const DEFAULT_PROVIDER: ModelProvider = "openai";

/* ── Usage utilities ── */

const MODEL_COSTS: Record<ModelProvider, { input: number; output: number }> = {
  anthropic: { input: 3.0, output: 15.0 },
  openai: { input: 2.5, output: 10.0 },
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateScreenshotTokens(provider: ModelProvider): number {
  return provider === "anthropic" ? 1600 : 800;
}

export function calculateCost(provider: ModelProvider, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[provider];
  return (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output;
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}
