"use client";

import React from "react";
import { DollarSign } from "lucide-react";
import { formatCost, formatTokens } from "@/lib/usage";

interface UsageBadgeProps {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  className?: string;
}

export function UsageBadge({
  inputTokens,
  outputTokens,
  estimatedCost,
  className,
}: UsageBadgeProps) {
  if (inputTokens === 0 && outputTokens === 0) {return null;}

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 rounded-md bg-fg-50 dark:bg-fg-900 text-xs text-fg-400 ${className ?? ""}`}
      title={`Input: ${formatTokens(inputTokens)} | Output: ${formatTokens(outputTokens)}`}
    >
      <DollarSign className="h-3 w-3" />
      <span>{formatCost(estimatedCost)}</span>
    </div>
  );
}
