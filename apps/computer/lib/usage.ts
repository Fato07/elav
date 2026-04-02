import { ModelProvider } from "@/lib/config";

// Cost per million tokens
export const MODEL_COSTS: Record<
  ModelProvider,
  { input: number; output: number }
> = {
  anthropic: { input: 3.0, output: 15.0 }, // Claude Sonnet 4
  openai: { input: 2.5, output: 10.0 }, // GPT-5.4
};

/**
 * Estimate token count from text (rough: 1 token ≈ 4 chars).
 * For images/screenshots, use a fixed estimate.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a base64 screenshot.
 * Claude charges ~1,600 tokens per 1024x768 image.
 * OpenAI charges ~800 tokens per image tile.
 */
export function estimateScreenshotTokens(
  provider: ModelProvider,
  _width?: number,
  _height?: number
): number {
  return provider === "anthropic" ? 1600 : 800;
}

/**
 * Calculate cost from token counts.
 */
export function calculateCost(
  provider: ModelProvider,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = MODEL_COSTS[provider];
  return (
    (inputTokens / 1_000_000) * costs.input +
    (outputTokens / 1_000_000) * costs.output
  );
}

/**
 * Format cost for display.
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {return `$${cost.toFixed(4)}`;}
  if (cost < 1) {return `$${cost.toFixed(3)}`;}
  return `$${cost.toFixed(2)}`;
}

/**
 * Format token count for display.
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) {return `${tokens}`;}
  if (tokens < 1_000_000) {return `${(tokens / 1000).toFixed(1)}K`;}
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}
