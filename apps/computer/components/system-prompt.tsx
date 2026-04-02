"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SystemPromptProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SystemPrompt({ value, onChange, className }: SystemPromptProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("border-b", className)}>
      <button
        className="flex items-center gap-2 px-3 py-2 text-xs text-fg-400 hover:text-fg transition-colors w-full"
        onClick={() => setExpanded(!expanded)}
      >
        <Settings2 className="h-3.5 w-3.5" />
        <span>System Prompt</span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 ml-auto" />
        ) : (
          <ChevronRight className="h-3 w-3 ml-auto" />
        )}
        {value && !expanded && (
          <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded ml-1">
            Custom
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Customize the agent's behavior... (leave empty for default)"
            className="w-full h-24 p-2 text-xs rounded-md border bg-bg resize-none focus:outline-none focus:ring-1 focus:ring-accent font-mono"
          />
        </div>
      )}
    </div>
  );
}
