import { Sandbox } from "@e2b/desktop";
import Anthropic from "@anthropic-ai/sdk";
import { SSEEventType, SSEEvent, sleep } from "@/types/api";
import {
  ComputerInteractionStreamerFacade,
  ComputerInteractionStreamerFacadeStreamProps,
} from "@/lib/streaming";
import { ActionResponse } from "@/types/api";
import { logDebug, logError, logWarning } from "../logger";
import { CLAUDE_MODEL } from "../config";

const INSTRUCTIONS = `
You are ELAV Computer, a helpful assistant that can use a computer to help the user with their tasks.
You can use the computer to search the web, write code, and more.

ELAV Computer is built by ELAV, which provides an isolated virtual computer in the cloud made for AI use cases.
This application integrates E2B's desktop sandbox with Anthropic's API to create an AI agent that can perform tasks
on a virtual computer through natural language instructions.

The screenshots that you receive are from a running sandbox instance, allowing you to see and interact with a real
virtual computer environment in real-time.

Since you are operating in a secure, isolated sandbox micro VM, you can execute most commands and operations without
worrying about security concerns. This environment is specifically designed for AI experimentation and task execution.

The sandbox is based on Ubuntu 22.04 and comes with many pre-installed applications including:
- Firefox browser
- Visual Studio Code
- LibreOffice suite
- Python 3 with common libraries
- Terminal with standard Linux utilities
- File manager (PCManFM)
- Text editor (Gedit)
- Calculator and other basic utilities`;

const TYPE_ACTION_CHUNK_SIZE = 50;
const TYPE_ACTION_DELAY_MS = 25;
const INTERSTITIAL_WAIT_DELAY_MS = 800;
const POST_ACTION_DELAY_MS = 100;

type CapturedScreenshot = {
  base64: string;
  byteLength: number;
  captureDurationMs: number;
};

interface ClaudeAction {
  type: string;
  coordinate?: [number, number];
  text?: string;
  start_coordinate?: [number, number];
  end_coordinate?: [number, number];
  button?: "left" | "right" | "middle";
  scroll_direction?: "up" | "down" | "left" | "right";
  scroll_amount?: number;
  key?: string;
  duration?: number;
}

export class ClaudeComputerStreamer
  implements ComputerInteractionStreamerFacade
{
  public instructions: string;
  public desktop: Sandbox;
  public resolution: [number, number];

  private anthropic: Anthropic;

  constructor(desktop: Sandbox, resolution: [number, number], customSystemPrompt?: string) {
    this.desktop = desktop;
    this.resolution = resolution;
    this.anthropic = new Anthropic();
    this.instructions = customSystemPrompt
      ? `${INSTRUCTIONS}\n\nAdditional instructions from user:\n${customSystemPrompt}`
      : INSTRUCTIONS;
  }

  private async captureScreenshot(): Promise<CapturedScreenshot> {
    const captureStartedAt = Date.now();
    const screenshotData = Buffer.from(await this.desktop.screenshot());

    return {
      base64: screenshotData.toString("base64"),
      byteLength: screenshotData.length,
      captureDurationMs: Date.now() - captureStartedAt,
    };
  }

  private claudeActionToSSEAction(action: ClaudeAction): Record<string, unknown> {
    switch (action.type) {
      case "left_click":
        return {
          type: "click",
          button: "left",
          x: action.coordinate?.[0] ?? 0,
          y: action.coordinate?.[1] ?? 0,
        };
      case "right_click":
        return {
          type: "click",
          button: "right",
          x: action.coordinate?.[0] ?? 0,
          y: action.coordinate?.[1] ?? 0,
        };
      case "middle_click":
        return {
          type: "click",
          button: "wheel",
          x: action.coordinate?.[0] ?? 0,
          y: action.coordinate?.[1] ?? 0,
        };
      case "double_click":
        return {
          type: "double_click",
          x: action.coordinate?.[0] ?? 0,
          y: action.coordinate?.[1] ?? 0,
        };
      case "type":
        return { type: "type", text: action.text ?? "" };
      case "key":
        return { type: "keypress", keys: [action.key ?? ""] };
      case "scroll":
        return {
          type: "scroll",
          x: action.coordinate?.[0] ?? 0,
          y: action.coordinate?.[1] ?? 0,
          scroll_x: 0,
          scroll_y:
            action.scroll_direction === "up"
              ? -(action.scroll_amount ?? 3)
              : action.scroll_direction === "down"
                ? (action.scroll_amount ?? 3)
                : 0,
        };
      case "mouse_move":
        return {
          type: "move",
          x: action.coordinate?.[0] ?? 0,
          y: action.coordinate?.[1] ?? 0,
        };
      case "drag":
        return {
          type: "drag",
          path: [
            {
              x: action.start_coordinate?.[0] ?? 0,
              y: action.start_coordinate?.[1] ?? 0,
            },
            {
              x: action.end_coordinate?.[0] ?? 0,
              y: action.end_coordinate?.[1] ?? 0,
            },
          ],
        };
      case "wait":
        return { type: "wait" };
      case "screenshot":
        return { type: "screenshot" };
      default:
        return { type: action.type };
    }
  }

  async executeAction(action: ClaudeAction): Promise<ActionResponse | void> {
    const desktop = this.desktop;

    switch (action.type) {
      case "screenshot":
        break;
      case "left_click": {
        const [x, y] = action.coordinate ?? [0, 0];
        await desktop.leftClick(x, y);
        break;
      }
      case "right_click": {
        const [x, y] = action.coordinate ?? [0, 0];
        await desktop.rightClick(x, y);
        break;
      }
      case "middle_click": {
        const [x, y] = action.coordinate ?? [0, 0];
        await desktop.middleClick(x, y);
        break;
      }
      case "double_click": {
        const [x, y] = action.coordinate ?? [0, 0];
        await desktop.doubleClick(x, y);
        break;
      }
      case "type": {
        if (action.text) {
          await desktop.write(action.text, {
            chunkSize: TYPE_ACTION_CHUNK_SIZE,
            delayInMs: TYPE_ACTION_DELAY_MS,
          });
        }
        break;
      }
      case "key": {
        if (action.key) {
          await desktop.press(action.key.split("+"));
        }
        break;
      }
      case "mouse_move": {
        const [x, y] = action.coordinate ?? [0, 0];
        await desktop.moveMouse(x, y);
        break;
      }
      case "scroll": {
        const amount = action.scroll_amount ?? 3;
        if (action.scroll_direction === "up") {
          await desktop.scroll("up", amount);
        } else if (action.scroll_direction === "down") {
          await desktop.scroll("down", amount);
        }
        break;
      }
      case "drag": {
        const start: [number, number] = [
          action.start_coordinate?.[0] ?? 0,
          action.start_coordinate?.[1] ?? 0,
        ];
        const end: [number, number] = [
          action.end_coordinate?.[0] ?? 0,
          action.end_coordinate?.[1] ?? 0,
        ];
        await desktop.drag(start, end);
        break;
      }
      case "wait": {
        await sleep(INTERSTITIAL_WAIT_DELAY_MS);
        break;
      }
      default: {
        logWarning("Unknown Claude action type:", action);
      }
    }
  }

  async *stream(
    props: ComputerInteractionStreamerFacadeStreamProps
  ): AsyncGenerator<SSEEvent> {
    const { messages, signal } = props;
    const traceId = `claude-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    let turnIndex = 0;

    try {
      logDebug("CLAUDE_COMPUTER_STREAM_START", {
        traceId,
        model: CLAUDE_MODEL,
        resolution: this.resolution,
        message_count: messages.length,
      });

      // Take initial screenshot
      const initialScreenshot = await this.captureScreenshot();

      // Build initial messages for Claude
      const claudeMessages: Anthropic.MessageParam[] = messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

      // Append initial screenshot to the last user message
      const lastUserIndex = claudeMessages.length - 1;
      if (lastUserIndex >= 0 && claudeMessages[lastUserIndex].role === "user") {
        claudeMessages[lastUserIndex] = {
          role: "user",
          content: [
            {
              type: "text",
              text: claudeMessages[lastUserIndex].content as string,
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: initialScreenshot.base64,
              },
            },
          ],
        };
      }

      let response = await this.anthropic.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: this.instructions,
        tools: [
          {
            type: "computer_20250124",
            name: "computer",
            display_width_px: this.resolution[0],
            display_height_px: this.resolution[1],
            display_number: 1,
          },
        ],
        messages: claudeMessages,
        betas: ["computer-use-2025-01-24"],
      });

      while (true) {
        if (signal.aborted) {
          logDebug("CLAUDE_COMPUTER_STREAM_ABORTED", { traceId, turnIndex });
          yield { type: SSEEventType.DONE, content: "Generation stopped by user" };
          break;
        }

        turnIndex += 1;

        // Extract text blocks as reasoning
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text"
        );

        if (textBlocks.length > 0) {
          const reasoningText = textBlocks.map((b) => b.text).join("\n");
          if (reasoningText.trim()) {
            yield { type: SSEEventType.REASONING, content: reasoningText };
          }
        }

        // Extract tool_use blocks
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        if (toolUseBlocks.length === 0) {
          logDebug("CLAUDE_RESPONSE_FINAL", {
            traceId,
            turnIndex,
            stop_reason: response.stop_reason,
          });
          yield { type: SSEEventType.DONE };
          break;
        }

        // Process each tool use
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          const action = toolUse.input as ClaudeAction;

          logDebug("CLAUDE_ACTION_EXECUTION", {
            traceId,
            turnIndex,
            tool_use_id: toolUse.id,
            action_type: action.type,
          });

          // Emit the action as an SSE event (mapped to OpenAI-compatible format for the UI)
          yield {
            type: SSEEventType.ACTION,
            action: this.claudeActionToSSEAction(action),
          } as unknown as SSEEvent;

          // Execute the action
          await this.executeAction(action);

          yield { type: SSEEventType.ACTION_COMPLETED } as SSEEvent;

          // Small delay for UI to settle after certain actions
          if (
            ["left_click", "right_click", "double_click", "key", "scroll", "drag"].includes(
              action.type
            )
          ) {
            await sleep(POST_ACTION_DELAY_MS);
          }

          // Take screenshot after action
          const screenshot = await this.captureScreenshot();

          logDebug("CLAUDE_SCREENSHOT_CAPTURED", {
            traceId,
            turnIndex,
            tool_use_id: toolUse.id,
            capture_duration_ms: screenshot.captureDurationMs,
            screenshot_bytes: screenshot.byteLength,
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: screenshot.base64,
                },
              },
            ],
          });
        }

        // Send tool results back to Claude
        claudeMessages.push(
          { role: "assistant", content: response.content as unknown as Anthropic.ContentBlockParam[] },
          { role: "user", content: toolResults }
        );

        logDebug("CLAUDE_TOOL_RESULTS_SENT", {
          traceId,
          turnIndex,
          result_count: toolResults.length,
        });

        response = await this.anthropic.beta.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: this.instructions,
          tools: [
            {
              type: "computer_20250124",
              name: "computer",
              display_width_px: this.resolution[0],
              display_height_px: this.resolution[1],
              display_number: 1,
            },
          ],
          messages: claudeMessages,
          betas: ["computer-use-2025-01-24"],
        });
      }
    } catch (error) {
      logError("CLAUDE_STREAMER", error);
      if (
        error instanceof Anthropic.APIError &&
        error.status === 429
      ) {
        yield {
          type: SSEEventType.ERROR,
          content:
            "Rate limit exceeded. Please wait a moment and try again.",
        };
        yield { type: SSEEventType.DONE };
        return;
      }
      yield {
        type: SSEEventType.ERROR,
        content: "An error occurred with the AI service. Please try again.",
      };
    }
  }
}
