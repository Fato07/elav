import { ChatMessage } from "@/types/chat";
import { ModelProvider } from "@/lib/config";

export type SessionStatus = "active" | "completed" | "stopped" | "error";

export interface SessionAction {
  type: string;
  timestamp: number;
  details?: Record<string, unknown>;
  screenshotUrl?: string;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt?: number;
  status: SessionStatus;
  provider: ModelProvider;
  sandboxId?: string;
  messages: ChatMessage[];
  actions: SessionAction[];
  taskSummary?: string;
  usage: SessionUsage;
  systemPrompt?: string;
}
