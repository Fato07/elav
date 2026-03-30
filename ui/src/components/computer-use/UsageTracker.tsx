import React from "react";
import { DollarSign, Clock, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCost, formatTokens, type UsageData } from "./types";

interface UsageTrackerProps {
  usage: UsageData | null;
  sandboxStartedAt: number | null;
  className?: string;
}

function costColor(cost: number): string {
  if (cost > 5) return "text-red-500";
  if (cost > 1) return "text-amber-500";
  return "text-green-500";
}

function formatDuration(startedAt: number | null): string {
  if (!startedAt) return "0m 0s";
  const elapsed = Math.max(0, Date.now() - startedAt);
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function UsageTracker({ usage, sandboxStartedAt, className }: UsageTrackerProps) {
  const [, setTick] = React.useState(0);

  // Tick every second to update the duration display
  React.useEffect(() => {
    if (!sandboxStartedAt) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [sandboxStartedAt]);

  const cost = usage?.estimatedCostUsd ?? 0;
  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-1.5 rounded-md bg-muted/50 text-xs font-medium",
        className,
      )}
    >
      <span className={cn("flex items-center gap-1", costColor(cost))}>
        <DollarSign className="h-3 w-3" />
        {formatCost(cost)}
      </span>
      <span className="text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {formatDuration(sandboxStartedAt)}
      </span>
      <span className="text-muted-foreground flex items-center gap-1">
        <BarChart3 className="h-3 w-3" />
        {formatTokens(totalTokens)} tokens
      </span>
    </div>
  );
}
