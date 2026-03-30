import { sessionStore, type ComputerUseUsage } from "./session-store.js";
import { SSEEventType, type SSEEvent } from "./config.js";

const COST_PER_INPUT_TOKEN = 3 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 15 / 1_000_000;
const COST_PER_SANDBOX_MINUTE = 0.002;
const USAGE_EMIT_INTERVAL_MS = 30_000;

export class UsageTracker {
  private sessionId: string;
  private lastEmitTime = 0;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /** Record token usage from an Anthropic API response */
  recordTokens(inputTokens: number, outputTokens: number): void {
    const session = sessionStore.get(this.sessionId);
    if (!session) return;

    session.usage.inputTokens += inputTokens;
    session.usage.outputTokens += outputTokens;
    session.usage.estimatedCostUsd = this.computeCost(session.usage);
  }

  /** Update sandbox minutes based on elapsed time */
  updateSandboxTime(): void {
    const session = sessionStore.get(this.sessionId);
    if (!session || !session.sandboxStartedAt) return;

    session.usage.sandboxMinutes = (Date.now() - session.sandboxStartedAt) / 60_000;
    session.usage.estimatedCostUsd = this.computeCost(session.usage);
  }

  /** Check if it's time to emit a usage update (every 30s or forced) */
  shouldEmit(force = false): boolean {
    if (force) return true;
    const now = Date.now();
    if (now - this.lastEmitTime >= USAGE_EMIT_INTERVAL_MS) {
      return true;
    }
    return false;
  }

  /** Create a USAGE_UPDATE SSE event if enough time has passed */
  maybeCreateUsageEvent(force = false): SSEEvent | null {
    if (!this.shouldEmit(force)) return null;

    this.updateSandboxTime();
    this.lastEmitTime = Date.now();

    const session = sessionStore.get(this.sessionId);
    if (!session) return null;

    return {
      type: SSEEventType.USAGE_UPDATE,
      usage: { ...session.usage },
    } as SSEEvent;
  }

  /** Get current usage snapshot */
  getUsage(): ComputerUseUsage | null {
    const session = sessionStore.get(this.sessionId);
    return session ? { ...session.usage } : null;
  }

  private computeCost(usage: ComputerUseUsage): number {
    return (
      usage.inputTokens * COST_PER_INPUT_TOKEN +
      usage.outputTokens * COST_PER_OUTPUT_TOKEN +
      usage.sandboxMinutes * COST_PER_SANDBOX_MINUTE
    );
  }
}
