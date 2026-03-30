import { Sandbox } from "@e2b/desktop";
import Anthropic from "@anthropic-ai/sdk";
import {
  SSEEventType,
  SSEEvent,
  Plan,
  SubTask,
  CLAUDE_MODEL,
} from "./config.js";
import { ClaudeComputerStreamer } from "./claude-streamer.js";
import { logger } from "../middleware/logger.js";

const PLANNER_SYSTEM_PROMPT = `You are a task planner for ELAV Computer. Given a user's goal, decompose it into concrete subtasks that can each be executed by an AI agent with computer access (browser, terminal, code editor, file system).

Rules:
- Each subtask must be independently executable with clear instructions
- Subtasks can depend on other subtasks (use dependsOn with task IDs)
- Keep subtasks to 3-7 (avoid over-decomposition)
- Each subtask title should be short (< 60 chars)
- Task IDs should be simple strings like "task-1", "task-2", etc.
- Output valid JSON matching this schema:

{
  "goal": "the user's goal",
  "subtasks": [
    {
      "id": "task-1",
      "title": "Short title",
      "description": "Detailed instructions for the agent",
      "dependsOn": []
    }
  ]
}

Only output JSON, no other text.`;

interface OrchestratorConfig {
  maxSubtasks: number;
  maxRetries: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxSubtasks: 10,
  maxRetries: 2,
};

export class OrchestratorStreamer {
  private desktop: Sandbox;
  private resolution: [number, number];
  private anthropic: Anthropic;
  private config: OrchestratorConfig;
  private systemPrompt?: string;

  constructor(
    desktop: Sandbox,
    resolution: [number, number],
    config?: Partial<OrchestratorConfig>,
    systemPrompt?: string,
  ) {
    this.desktop = desktop;
    this.resolution = resolution;
    this.anthropic = new Anthropic();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.systemPrompt = systemPrompt;
  }

  private async createPlan(goal: string): Promise<Plan> {
    const response = await this.anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: PLANNER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: goal }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Parse JSON from response (may be wrapped in markdown code block)
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const plan: Plan = JSON.parse(jsonMatch[1]!.trim());

    // Safety cap
    if (plan.subtasks.length > this.config.maxSubtasks) {
      plan.subtasks = plan.subtasks.slice(0, this.config.maxSubtasks);
    }

    // Ensure all subtasks start as pending
    for (const st of plan.subtasks) {
      st.status = "pending";
    }

    return plan;
  }

  private getReadyTasks(plan: Plan): SubTask[] {
    return plan.subtasks.filter((st) => {
      if (st.status !== "pending") return false;
      return st.dependsOn.every((depId) => {
        const dep = plan.subtasks.find((d) => d.id === depId);
        return dep?.status === "completed";
      });
    });
  }

  private skipDependents(plan: Plan, failedId: string): string[] {
    const skipped: string[] = [];
    const toSkip = [failedId];
    while (toSkip.length > 0) {
      const currentId = toSkip.pop()!;
      for (const st of plan.subtasks) {
        if (st.status === "pending" && st.dependsOn.includes(currentId)) {
          st.status = "skipped";
          skipped.push(st.id);
          toSkip.push(st.id);
        }
      }
    }
    return skipped;
  }

  async *stream(goal: string, signal: AbortSignal): AsyncGenerator<SSEEvent> {
    const traceId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    logger.info({ traceId, goal }, "ORCHESTRATOR_START");

    // Step 1: Create plan
    let plan: Plan;
    try {
      plan = await this.createPlan(goal);
    } catch (error) {
      logger.error({ err: error, traceId }, "ORCHESTRATOR_PLAN_FAILED");
      yield { type: SSEEventType.ERROR, content: "Failed to create task plan. Please try again." };
      return;
    }

    yield { type: SSEEventType.PLAN_CREATED, plan } as SSEEvent;

    // Step 2: Execute subtasks respecting dependency order
    while (true) {
      if (signal.aborted) {
        yield { type: SSEEventType.DONE, content: "Orchestration cancelled by user" };
        return;
      }

      const readyTasks = this.getReadyTasks(plan);
      if (readyTasks.length === 0) {
        // Check if all done
        const allDone = plan.subtasks.every(
          (st) => st.status === "completed" || st.status === "failed" || st.status === "skipped"
        );
        if (allDone) break;

        // Deadlock — shouldn't happen with valid DAG
        logger.warn({ traceId, plan }, "ORCHESTRATOR_DEADLOCK");
        yield { type: SSEEventType.ERROR, content: "Task dependency deadlock detected." };
        break;
      }

      // Execute ready tasks sequentially (sharing same sandbox)
      for (const subtask of readyTasks) {
        if (signal.aborted) break;

        subtask.status = "running";
        yield {
          type: SSEEventType.SUBTASK_STARTED,
          subtaskId: subtask.id,
          title: subtask.title,
        } as SSEEvent;

        let succeeded = false;
        let lastError = "";

        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
          if (signal.aborted) break;

          try {
            const streamer = new ClaudeComputerStreamer(
              this.desktop,
              this.resolution,
              this.systemPrompt,
            );

            const messages = [
              {
                role: "user" as const,
                content: `Task: ${subtask.title}\n\nInstructions: ${subtask.description}`,
              },
            ];

            for await (const innerEvent of streamer.stream({ messages, signal })) {
              if (signal.aborted) break;

              yield {
                type: SSEEventType.SUBTASK_UPDATE,
                subtaskId: subtask.id,
                inner: innerEvent,
              } as SSEEvent;

              // Check if inner streamer errored
              if (innerEvent.type === SSEEventType.ERROR) {
                lastError = (innerEvent as { content: string }).content;
              }
            }

            // If we got an error from the inner streamer, treat as failure for retry
            if (lastError && attempt < this.config.maxRetries) {
              logger.warn({ traceId, subtaskId: subtask.id, attempt, error: lastError }, "SUBTASK_RETRY");
              continue;
            }

            succeeded = !lastError;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error.message : "Unknown execution error";
            logger.error({ err: error, traceId, subtaskId: subtask.id, attempt }, "SUBTASK_EXEC_ERROR");
            if (attempt >= this.config.maxRetries) break;
          }
        }

        if (signal.aborted) break;

        if (succeeded) {
          subtask.status = "completed";
          subtask.result = "Completed successfully";
          yield {
            type: SSEEventType.SUBTASK_COMPLETED,
            subtaskId: subtask.id,
            result: subtask.result,
          } as SSEEvent;
        } else {
          subtask.status = "failed";
          subtask.error = lastError || "Subtask failed after retries";
          yield {
            type: SSEEventType.SUBTASK_FAILED,
            subtaskId: subtask.id,
            error: subtask.error,
          } as SSEEvent;

          // Skip dependents
          const skipped = this.skipDependents(plan, subtask.id);
          if (skipped.length > 0) {
            logger.info({ traceId, skipped }, "SUBTASK_DEPENDENTS_SKIPPED");
          }
        }
      }
    }

    // Step 3: Summary
    const completed = plan.subtasks.filter((st) => st.status === "completed").length;
    const failed = plan.subtasks.filter((st) => st.status === "failed").length;
    const skipped = plan.subtasks.filter((st) => st.status === "skipped").length;
    const summary = `Orchestration complete: ${completed} completed, ${failed} failed, ${skipped} skipped out of ${plan.subtasks.length} tasks.`;

    logger.info({ traceId, summary }, "ORCHESTRATOR_DONE");

    yield {
      type: SSEEventType.ORCHESTRATOR_DONE,
      summary,
      plan,
    } as SSEEvent;
  }
}
