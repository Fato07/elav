import React from "react";
import { Plus, X, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "./session-context";
import { cn } from "@/lib/utils";
import { formatCost as fmtCost, formatTokens } from "./types";

/* ── SessionTabs ── */

export function SessionTabs() {
  const { tabs, activeTabId, setActiveTab, createTab, removeTab, formatCost } =
    useSession();

  if (tabs.length <= 1) return null;

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b bg-background overflow-x-auto">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs cursor-pointer transition-colors min-w-0 flex-shrink-0",
            tab.id === activeTabId
              ? "bg-primary/10 text-primary border border-primary/20"
              : "hover:bg-accent text-muted-foreground"
          )}
          onClick={() => setActiveTab(tab.id)}
        >
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full flex-shrink-0",
              tab.status === "running"
                ? "bg-green-500"
                : tab.status === "stopped"
                  ? "bg-muted-foreground"
                  : "bg-muted-foreground/60"
            )}
          />
          <span className="truncate max-w-[100px]">{tab.label}</span>
          {tab.usage.estimatedCost > 0 && (
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              {formatCost(tab.usage.estimatedCost)}
            </span>
          )}
          <button
            className="ml-1 hover:text-destructive transition-colors flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              removeTab(tab.id);
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      <Button
        variant="ghost"
        size="icon-xs"
        className="flex-shrink-0"
        title="New session"
        onClick={() => createTab("anthropic")}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* ── UsageBadge ── */

export function UsageBadge({
  inputTokens,
  outputTokens,
  estimatedCost,
  className,
}: {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  className?: string;
}) {
  if (inputTokens === 0 && outputTokens === 0) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-xs text-muted-foreground",
        className
      )}
      title={`Input: ${formatTokens(inputTokens)} | Output: ${formatTokens(outputTokens)}`}
    >
      <DollarSign className="h-3 w-3" />
      <span>{fmtCost(estimatedCost)}</span>
    </div>
  );
}
