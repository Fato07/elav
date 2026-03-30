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
    }: {
      messages: { role: "user" | "assistant"; content: string }[];
      sandboxId?: string;
      resolution: [number, number];
      provider?: ModelProvider;
      systemPrompt?: string;
    } = req.body;

    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "E2B API key not found" });
      return;
    }

    let desktop: Sandbox | undefined;
    let activeSandboxId = sandboxId;
    let vncUrl: string | undefined;

    try {
      if (!activeSandboxId) {
        const newSandbox = await Sandbox.create({ resolution, dpi: 96, timeoutMs: SANDBOX_TIMEOUT_MS });
        await newSandbox.stream.start();
        activeSandboxId = newSandbox.sandboxId;
        vncUrl = newSandbox.stream.getUrl();
        desktop = newSandbox;
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
