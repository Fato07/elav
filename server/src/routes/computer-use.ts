import { Router } from "express";
import { Sandbox } from "@e2b/desktop";
import {
  SANDBOX_TIMEOUT_MS,
  DEFAULT_PROVIDER,
  formatSSE,
  SSEEventType,
  type ModelProvider,
  type SSEEvent,
} from "../computer-use/config.js";
import { ClaudeComputerStreamer } from "../computer-use/claude-streamer.js";
import { OpenAIComputerStreamer } from "../computer-use/openai-streamer.js";
import { OrchestratorStreamer } from "../computer-use/orchestrator-streamer.js";
import { UsageTracker } from "../computer-use/usage-tracker.js";
import { sessionStore } from "../computer-use/session-store.js";
import { logger } from "../middleware/logger.js";

export function computerUseRoutes() {
  const router = Router();

  /* ── POST /computer-use/chat — SSE streaming endpoint ── */
  router.post("/computer-use/chat", async (req, res) => {
    const abortController = new AbortController();
    const { signal } = abortController;

    req.on("close", () => abortController.abort());

    const {
      messages,
      sandboxId,
      resolution,
      provider = DEFAULT_PROVIDER,
      systemPrompt,
      sessionId: clientSessionId,
    }: {
      messages: { role: "user" | "assistant"; content: string }[];
      sandboxId?: string;
      resolution: [number, number];
      provider?: ModelProvider;
      systemPrompt?: string;
      sessionId?: string;
    } = req.body;

    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "E2B API key not found" });
      return;
    }

    let desktop: Sandbox | undefined;
    let activeSandboxId = sandboxId;
    let vncUrl: string | undefined;

    // Session tracking
    const sessionId = clientSessionId || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session = sessionStore.getOrCreate(sessionId);
    const usageTracker = new UsageTracker(sessionId);

    try {
      if (!activeSandboxId) {
        const newSandbox = await Sandbox.create({ resolution, dpi: 96, timeoutMs: SANDBOX_TIMEOUT_MS });
        await newSandbox.stream.start();
        activeSandboxId = newSandbox.sandboxId;
        vncUrl = newSandbox.stream.getUrl();
        desktop = newSandbox;
        session.sandboxId = activeSandboxId;
        session.sandboxStartedAt = Date.now();
      } else {
        desktop = await Sandbox.connect(activeSandboxId);
      }

      if (!desktop) {
        res.status(500).json({ error: "Failed to connect to sandbox" });
        return;
      }

      desktop.setTimeout(SANDBOX_TIMEOUT_MS);

      const streamer =
        provider === "anthropic"
          ? new ClaudeComputerStreamer(desktop, resolution, systemPrompt)
          : new OpenAIComputerStreamer(desktop, resolution, systemPrompt);

      // Attach usage tracker for Claude streamer
      if (streamer instanceof ClaudeComputerStreamer) {
        streamer.setUsageTracker(usageTracker);
      }

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // If new sandbox was created, emit sandbox_created first
      if (!sandboxId && activeSandboxId && vncUrl) {
        res.write(
          formatSSE({
            type: SSEEventType.SANDBOX_CREATED,
            sandboxId: activeSandboxId,
            vncUrl,
          })
        );
        if (typeof (res as any).flush === "function") (res as any).flush();
      }

      // Stream events
      for await (const event of streamer.stream({ messages, signal })) {
        if (signal.aborted) break;
        res.write(formatSSE(event));
        if (typeof (res as any).flush === "function") (res as any).flush();
      }

      // Emit final usage update
      const finalUsage = usageTracker.maybeCreateUsageEvent(true);
      if (finalUsage) {
        res.write(formatSSE(finalUsage));
        if (typeof (res as any).flush === "function") (res as any).flush();
      }

      res.end();
    } catch (error) {
      logger.error({ err: error }, "Computer use streaming error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to connect to sandbox" });
      } else {
        res.end();
      }
    }
  });

  /* ── POST /computer-use/orchestrate — Orchestrator SSE streaming endpoint ── */
  router.post("/computer-use/orchestrate", async (req, res) => {
    const abortController = new AbortController();
    const { signal } = abortController;

    req.on("close", () => abortController.abort());

    const {
      goal,
      sandboxId,
      resolution,
      systemPrompt,
      sessionId: clientSessionId,
    }: {
      goal: string;
      sandboxId?: string;
      resolution: [number, number];
      systemPrompt?: string;
      sessionId?: string;
    } = req.body;

    if (!goal?.trim()) {
      res.status(400).json({ error: "Goal is required" });
      return;
    }

    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "E2B API key not found" });
      return;
    }

    let desktop: Sandbox | undefined;
    let activeSandboxId = sandboxId;
    let vncUrl: string | undefined;

    // Session tracking
    const sessionId = clientSessionId || `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session = sessionStore.getOrCreate(sessionId);

    try {
      if (!activeSandboxId) {
        const newSandbox = await Sandbox.create({ resolution, dpi: 96, timeoutMs: SANDBOX_TIMEOUT_MS });
        await newSandbox.stream.start();
        activeSandboxId = newSandbox.sandboxId;
        vncUrl = newSandbox.stream.getUrl();
        desktop = newSandbox;
        session.sandboxId = activeSandboxId;
        session.sandboxStartedAt = Date.now();
      } else {
        desktop = await Sandbox.connect(activeSandboxId);
      }

      if (!desktop) {
        res.status(500).json({ error: "Failed to connect to sandbox" });
        return;
      }

      desktop.setTimeout(SANDBOX_TIMEOUT_MS);

      const orchestrator = new OrchestratorStreamer(desktop, resolution, undefined, systemPrompt);
      orchestrator.setSessionId(sessionId);

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // If new sandbox was created, emit sandbox_created first
      if (!sandboxId && activeSandboxId && vncUrl) {
        res.write(
          formatSSE({
            type: SSEEventType.SANDBOX_CREATED,
            sandboxId: activeSandboxId,
            vncUrl,
          })
        );
        if (typeof (res as any).flush === "function") (res as any).flush();
      }

      // Stream orchestrator events
      for await (const event of orchestrator.stream(goal, signal)) {
        if (signal.aborted) break;
        res.write(formatSSE(event));
        if (typeof (res as any).flush === "function") (res as any).flush();
      }

      res.end();
    } catch (error) {
      logger.error({ err: error }, "Orchestrator streaming error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to run orchestration" });
      } else {
        res.end();
      }
    }
  });

  /* ── POST /computer-use/approve — Approve or deny a subtask ── */
  router.post("/computer-use/approve", (req, res) => {
    const { sessionId, subtaskId, approved } = req.body as {
      sessionId: string;
      subtaskId: string;
      approved: boolean;
    };

    if (!sessionId || !subtaskId || typeof approved !== "boolean") {
      res.status(400).json({ error: "sessionId, subtaskId, and approved (boolean) are required" });
      return;
    }

    const resolved = sessionStore.resolveApproval(sessionId, subtaskId, approved);
    if (!resolved) {
      res.status(404).json({ error: "No pending approval found for this session/subtask" });
      return;
    }

    res.json({ ok: true });
  });

  /* ── POST /computer-use/retry-subtask — Retry a failed subtask ── */
  router.post("/computer-use/retry-subtask", async (req, res) => {
    const { sessionId, subtaskId } = req.body as {
      sessionId: string;
      subtaskId: string;
    };

    if (!sessionId || !subtaskId) {
      res.status(400).json({ error: "sessionId and subtaskId are required" });
      return;
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (!session.plan) {
      res.status(400).json({ error: "No plan found for this session" });
      return;
    }

    const subtask = session.plan.subtasks.find((st) => st.id === subtaskId);
    if (!subtask) {
      res.status(404).json({ error: "Subtask not found" });
      return;
    }

    if (subtask.status !== "failed") {
      res.status(400).json({ error: "Subtask is not in failed state" });
      return;
    }

    // Reset subtask to pending so the orchestrator can pick it up
    subtask.status = "pending";
    subtask.error = undefined;

    // Also un-skip any dependents that were skipped due to this failure
    for (const st of session.plan.subtasks) {
      if (st.status === "skipped" && st.dependsOn.includes(subtaskId)) {
        st.status = "pending";
      }
    }

    res.json({ ok: true, plan: session.plan });
  });

  /* ── GET /computer-use/sessions — List active sessions ── */
  router.get("/computer-use/sessions", (_req, res) => {
    const sessions = sessionStore.listAll().map((s) => ({
      sessionId: s.sessionId,
      sandboxId: s.sandboxId,
      status: s.status,
      createdAt: s.createdAt,
      usage: s.usage,
    }));
    res.json({ sessions });
  });

  /* ── POST /computer-use/sandbox/timeout — Extend sandbox timeout ── */
  router.post("/computer-use/sandbox/timeout", async (req, res) => {
    const { sandboxId } = req.body as { sandboxId: string };
    try {
      const desktop = await Sandbox.connect(sandboxId);
      await desktop.setTimeout(SANDBOX_TIMEOUT_MS);
      res.json({ ok: true });
    } catch (error) {
      logger.error({ err: error }, "Failed to increase sandbox timeout");
      res.status(500).json({ error: "Failed to increase timeout" });
    }
  });

  /* ── POST /computer-use/sandbox/stop — Kill sandbox ── */
  router.post("/computer-use/sandbox/stop", async (req, res) => {
    const { sandboxId } = req.body as { sandboxId: string };
    try {
      const desktop = await Sandbox.connect(sandboxId);
      await desktop.kill();
      res.json({ ok: true });
    } catch (error) {
      logger.error({ err: error }, "Failed to stop sandbox");
      res.status(500).json({ error: "Failed to stop sandbox" });
    }
  });

  return router;
}
