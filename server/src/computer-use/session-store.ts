import type { Plan } from "./config.js";

export interface ComputerUseUsage {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  sandboxMinutes: number;
  estimatedCostUsd: number;
}

export interface SessionState {
  sessionId: string;
  sandboxId: string | null;
  createdAt: number;
  sandboxStartedAt: number | null;
  usage: ComputerUseUsage;
  plan: Plan | null;
  pendingApprovals: Map<string, PendingApproval>;
  status: "active" | "completed" | "error";
}

export interface PendingApproval {
  subtaskId: string;
  action: string;
  description: string;
  risk: "low" | "medium" | "high";
  createdAt: number;
  resolve: (approved: boolean) => void;
}

class SessionStore {
  private sessions = new Map<string, SessionState>();

  create(sessionId: string): SessionState {
    const state: SessionState = {
      sessionId,
      sandboxId: null,
      createdAt: Date.now(),
      sandboxStartedAt: null,
      usage: {
        sessionId,
        inputTokens: 0,
        outputTokens: 0,
        sandboxMinutes: 0,
        estimatedCostUsd: 0,
      },
      plan: null,
      pendingApprovals: new Map(),
      status: "active",
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  getOrCreate(sessionId: string): SessionState {
    return this.sessions.get(sessionId) ?? this.create(sessionId);
  }

  update(sessionId: string, updates: Partial<Omit<SessionState, "sessionId">>): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    Object.assign(session, updates);
    return session;
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  listActive(): SessionState[] {
    return [...this.sessions.values()].filter((s) => s.status === "active");
  }

  listAll(): SessionState[] {
    return [...this.sessions.values()];
  }

  addApproval(sessionId: string, approval: PendingApproval): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.pendingApprovals.set(approval.subtaskId, approval);
    return true;
  }

  resolveApproval(sessionId: string, subtaskId: string, approved: boolean): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    const approval = session.pendingApprovals.get(subtaskId);
    if (!approval) return false;
    approval.resolve(approved);
    session.pendingApprovals.delete(subtaskId);
    return true;
  }
}

export const sessionStore = new SessionStore();
