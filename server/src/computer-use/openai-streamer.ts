import { Sandbox } from "@e2b/desktop";
import OpenAI from "openai";
import type {
  ResponseComputerToolCall,
  ResponseInput,
  Tool,
} from "openai/resources/responses/responses.mjs";
import {
  SSEEventType,
  SSEEvent,
  sleep,
  ActionResponse,
  ComputerStreamerFacade,
  StreamProps,
  OPENAI_MODEL,
} from "./config.js";
import { logger } from "../middleware/logger.js";

const INSTRUCTIONS = `
You are ELAV Computer, a helpful assistant that can use a computer to help the user with their tasks.
You can use the computer to search the web, write code, and more.

ELAV Computer is built by ELAV, which provides an isolated virtual computer in the cloud made for AI use cases.
This application integrates E2B's desktop sandbox with OpenAI's API to create an AI agent that can perform tasks
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
const ASYNC_BATCH_FALLBACK_DELAY_MS = 100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenAIComputerAction = any;

type OpenAIComputerCall = Omit<ResponseComputerToolCall, "action"> & {
  action?: OpenAIComputerAction;
  actions?: OpenAIComputerAction[];
};

type NormalizedOpenAIComputerCall = Omit<OpenAIComputerCall, "action" | "actions"> & {
  actions: OpenAIComputerAction[];
};

type OpenAIComputerCallOutput = {
  call_id: string;
  type: "computer_call_output";
  output: {
    type: "computer_screenshot";
    image_url: string;
    detail: "original";
  };
};

type CapturedScreenshot = {
  base64: string;
  byteLength: number;
  captureDurationMs: number;
};

function previewText(value: string, maxLength = 160): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function getTrailingWaitCount(actions: OpenAIComputerAction[]): number {
  let count = 0;
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    if (actions[index]?.type !== "wait") break;
    count += 1;
  }
  return count;
}

function isAsyncKeypress(action: { keys: string[] }) {
  const normalizedKeys = action.keys.map((key: string) => key.toUpperCase());
  return normalizedKeys.some((key: string) => ["ENTER", "RETURN", "TAB", "ESCAPE"].includes(key));
}

function shouldApplyFallbackDelay(actions: OpenAIComputerAction[]): boolean {
  if (getTrailingWaitCount(actions) > 0) return false;
  return actions.some((action) => {
    switch (action.type) {
      case "click":
      case "double_click":
      case "drag":
      case "scroll":
        return true;
      case "keypress":
        return isAsyncKeypress(action);
      default:
        return false;
    }
  });
}

export class OpenAIComputerStreamer extends ComputerStreamerFacade {
  public instructions: string;
  public desktop: Sandbox;
  public resolution: [number, number];

  private openai: OpenAI;

  constructor(desktop: Sandbox, resolution: [number, number], customSystemPrompt?: string) {
    super();
    this.desktop = desktop;
    this.resolution = resolution;
    this.openai = new OpenAI();
    this.instructions = customSystemPrompt
      ? `${INSTRUCTIONS}\n\nAdditional instructions from user:\n${customSystemPrompt}`
      : INSTRUCTIONS;
  }

  private normalizeComputerCall(computerCall: OpenAIComputerCall): NormalizedOpenAIComputerCall {
    const actions = Array.isArray(computerCall.actions)
      ? computerCall.actions
      : computerCall.action
        ? [computerCall.action]
        : [];
    return { ...computerCall, actions };
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

  private async captureBatchScreenshot(context: {
    actions: OpenAIComputerAction[];
    callId: string;
  }): Promise<CapturedScreenshot> {
    const fallbackDelayMs = shouldApplyFallbackDelay(context.actions)
      ? ASYNC_BATCH_FALLBACK_DELAY_MS
      : 0;
    if (fallbackDelayMs > 0) await sleep(fallbackDelayMs);
    return this.captureScreenshot();
  }

  async executeAction(action: OpenAIComputerAction): Promise<ActionResponse | void> {
    const desktop = this.desktop;
    switch (action.type) {
      case "screenshot":
        break;
      case "double_click":
        await desktop.doubleClick(action.x, action.y);
        break;
      case "click":
        if (action.button === "left") await desktop.leftClick(action.x, action.y);
        else if (action.button === "right") await desktop.rightClick(action.x, action.y);
        else if (action.button === "wheel") await desktop.middleClick(action.x, action.y);
        break;
      case "type":
        await desktop.write(action.text, {
          chunkSize: TYPE_ACTION_CHUNK_SIZE,
          delayInMs: TYPE_ACTION_DELAY_MS,
        });
        break;
      case "keypress":
        await desktop.press(action.keys);
        break;
      case "move":
        await desktop.moveMouse(action.x, action.y);
        break;
      case "scroll":
        if (action.scroll_y < 0) await desktop.scroll("up", Math.abs(action.scroll_y));
        else if (action.scroll_y > 0) await desktop.scroll("down", action.scroll_y);
        break;
      case "wait":
        await sleep(INTERSTITIAL_WAIT_DELAY_MS);
        break;
      case "drag": {
        const start: [number, number] = [action.path[0].x, action.path[0].y];
        const end: [number, number] = [action.path[1].x, action.path[1].y];
        await desktop.drag(start, end);
        break;
      }
      default:
        logger.warn({ action }, "Unknown OpenAI action type");
    }
  }

  async *stream(props: StreamProps): AsyncGenerator<SSEEvent> {
    const { messages, signal } = props;
    const traceId = `openai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let turnIndex = 0;

    try {
      const computerTool = { type: "computer" as const } as unknown as Tool;

      logger.debug({ traceId, model: OPENAI_MODEL, resolution: this.resolution, message_count: messages.length }, "OPENAI_COMPUTER_STREAM_START");

      let response = await this.openai.responses.create({
        model: OPENAI_MODEL,
        tools: [computerTool],
        input: [...(messages as ResponseInput)],
        truncation: "auto",
        instructions: this.instructions,
        reasoning: { effort: "medium" },
      });

      while (true) {
        if (signal.aborted) {
          yield { type: SSEEventType.DONE, content: "Generation stopped by user" };
          break;
        }

        turnIndex += 1;

        const computerCalls = response.output
          .filter((item): item is ResponseComputerToolCall => item.type === "computer_call")
          .map((computerCall) => this.normalizeComputerCall(computerCall as OpenAIComputerCall));

        if (computerCalls.length === 0) {
          yield { type: SSEEventType.REASONING, content: response.output_text };
          yield { type: SSEEventType.DONE };
          break;
        }

        // Emit reasoning before actions
        const reasoningItems = response.output.filter(
          (item) => item.type === "message" && "content" in item
        );
        if (reasoningItems.length > 0 && "content" in reasoningItems[0]) {
          yield {
            type: SSEEventType.REASONING,
            content:
              (reasoningItems[0] as any).content[0]?.type === "output_text"
                ? (reasoningItems[0] as any).content[0].text
                : JSON.stringify((reasoningItems[0] as any).content),
          };
        }

        const callOutputs: OpenAIComputerCallOutput[] = [];

        for (const computerCall of computerCalls) {
          const callId = computerCall.call_id;
          const trailingWaitCount = getTrailingWaitCount(computerCall.actions);
          const firstTrailingWaitIndex =
            trailingWaitCount > 0
              ? computerCall.actions.length - trailingWaitCount
              : Number.POSITIVE_INFINITY;

          for (const [actionIndex, action] of computerCall.actions.entries()) {
            if (!action) continue;

            yield { type: SSEEventType.ACTION, action: action as unknown as Record<string, unknown> } as SSEEvent;

            if (action.type === "wait" && actionIndex >= firstTrailingWaitIndex) {
              yield { type: SSEEventType.ACTION_COMPLETED };
              continue;
            }

            await this.executeAction(action);
            yield { type: SSEEventType.ACTION_COMPLETED };
          }

          const screenshot = await this.captureBatchScreenshot({
            actions: computerCall.actions,
            callId,
          });

          callOutputs.push({
            call_id: callId,
            type: "computer_call_output",
            output: {
              type: "computer_screenshot",
              image_url: `data:image/png;base64,${screenshot.base64}`,
              detail: "original",
            },
          });
        }

        response = await this.openai.responses.create({
          model: OPENAI_MODEL,
          previous_response_id: response.id,
          instructions: this.instructions,
          tools: [computerTool],
          input: callOutputs as unknown as ResponseInput,
          truncation: "auto",
          reasoning: { effort: "medium" },
        });
      }
    } catch (error) {
      logger.error({ err: error }, "OPENAI_STREAMER error");
      if (error instanceof OpenAI.APIError && error.status === 429) {
        yield { type: SSEEventType.ERROR, content: "Rate limit exceeded. Please wait a moment and try again." };
        yield { type: SSEEventType.DONE };
        return;
      }
      yield { type: SSEEventType.ERROR, content: "An error occurred with the AI service. Please try again." };
    }
  }
}
