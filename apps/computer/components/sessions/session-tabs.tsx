"use client";

import React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session-context";
import { cn } from "@/lib/utils";

export function SessionTabs() {
  const { tabs, activeTabId, setActiveTab, createTab, removeTab, formatCost } =
    useSession();

  if (tabs.length <= 1) {return null;}

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b bg-bg overflow-x-auto scrollbar-thin">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs cursor-pointer transition-colors min-w-0 flex-shrink-0",
            tab.id === activeTabId
              ? "bg-accent/10 text-accent border border-accent/20"
              : "hover:bg-fg-50 dark:hover:bg-fg-900 text-fg-400"
          )}
          onClick={() => setActiveTab(tab.id)}
        >
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full flex-shrink-0",
              tab.status === "running"
                ? "bg-green-500"
                : tab.status === "stopped"
                  ? "bg-fg-400"
                  : "bg-fg-300"
            )}
          />
          <span className="truncate max-w-[100px]">{tab.label}</span>
          {tab.usage.estimatedCost > 0 && (
            <span className="text-[10px] text-fg-400 flex-shrink-0">
              {formatCost(tab.usage.estimatedCost)}
            </span>
          )}
          <button
            className="ml-1 hover:text-red-500 transition-colors flex-shrink-0"
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
        size="icon"
        className="h-7 w-7 flex-shrink-0"
        title="New session"
        onClick={() => createTab("anthropic")}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
