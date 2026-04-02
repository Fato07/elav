import {
  SessionRecord,
  SessionStatus,
  SessionAction,
  SessionUsage,
} from "./types";
import { ChatMessage } from "@/types/chat";
import { ModelProvider } from "@/lib/config";

// In-memory session store (server-side)
let sessions: SessionRecord[] = [];

export function createSession(
  provider: ModelProvider,
  sandboxId?: string,
  systemPrompt?: string
): SessionRecord {
  const session: SessionRecord = {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
    status: "active",
    provider,
    sandboxId,
    messages: [],
    actions: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
    systemPrompt,
  };
  sessions.push(session);
  return session;
}

export function getSession(id: string): SessionRecord | undefined {
  return sessions.find((s) => s.id === id);
}

export function getAllSessions(): SessionRecord[] {
  return [...sessions].toSorted((a, b) => b.startedAt - a.startedAt);
}

export function updateSessionMessages(
  id: string,
  messages: ChatMessage[]
): void {
  const session = sessions.find((s) => s.id === id);
  if (session) {
    session.messages = messages;
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (firstUserMsg && "content" in firstUserMsg) {
      session.taskSummary = (firstUserMsg as { content: string }).content.slice(
        0,
        120
      );
    }
  }
}

export function addSessionAction(id: string, action: SessionAction): void {
  const session = sessions.find((s) => s.id === id);
  if (session) {
    session.actions.push(action);
  }
}

export function updateSessionStatus(
  id: string,
  status: SessionStatus
): void {
  const session = sessions.find((s) => s.id === id);
  if (session) {
    session.status = status;
    if (
      status === "completed" ||
      status === "stopped" ||
      status === "error"
    ) {
      session.endedAt = Date.now();
    }
  }
}

export function updateSessionUsage(
  id: string,
  usage: Partial<SessionUsage>
): void {
  const session = sessions.find((s) => s.id === id);
  if (session) {
    if (usage.inputTokens !== undefined)
      {session.usage.inputTokens += usage.inputTokens;}
    if (usage.outputTokens !== undefined)
      {session.usage.outputTokens += usage.outputTokens;}
    if (usage.estimatedCost !== undefined)
      {session.usage.estimatedCost += usage.estimatedCost;}
  }
}

export function updateSessionSandboxId(
  id: string,
  sandboxId: string
): void {
  const session = sessions.find((s) => s.id === id);
  if (session) {
    session.sandboxId = sandboxId;
  }
}

export function getTotalSpend(): number {
  return sessions.reduce((total, s) => total + s.usage.estimatedCost, 0);
}

export function deleteSession(id: string): boolean {
  const index = sessions.findIndex((s) => s.id === id);
  if (index !== -1) {
    sessions.splice(index, 1);
    return true;
  }
  return false;
}
