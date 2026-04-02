"use client";

import React from "react";
import { X, Clock, DollarSign, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session-context";
import { cn } from "@/lib/utils";

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60_000) {return "Just now";}
  if (diff < 3600_000) {return `${Math.floor(diff / 60_000)}m ago`;}
  if (diff < 86400_000) {return `${Math.floor(diff / 3600_000)}h ago`;}

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(start: number, end?: number): string {
  const ms = (end ?? Date.now()) - start;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {return `${seconds}s`;}
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {return `${minutes}m ${seconds % 60}s`;}
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const statusColors: Record<string, string> = {
  active: "bg-green-500",
  completed: "bg-blue-500",
  stopped: "bg-fg-400",
  error: "bg-red-500",
};

interface SessionSidebarProps {
  onReplay?: (sessionId: string) => void;
}

export function SessionSidebar({ onReplay }: SessionSidebarProps) {
  const { pastSessions, totalSpend, sidebarOpen, setSidebarOpen, formatCost } =
    useSession();

  if (!sidebarOpen) {return null;}

  return (
    <div className="absolute inset-y-0 right-0 w-80 bg-bg border-l z-50 flex flex-col shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h2 className="font-semibold text-sm">Session History</h2>
          <p className="text-xs text-fg-400 mt-0.5">
            Total spend: {formatCost(totalSpend)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {pastSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-fg-400 px-4">
            <Clock className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm text-center">
              No sessions yet. Start a conversation to see history here.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {pastSessions.map((session) => (
              <div
                key={session.id}
                className="px-4 py-3 hover:bg-fg-50 dark:hover:bg-fg-900 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full flex-shrink-0",
                          statusColors[session.status] ?? "bg-fg-400"
                        )}
                      />
                      <span className="text-xs text-fg-400 truncate">
                        {session.provider === "anthropic"
                          ? "Claude"
                          : "GPT-5.4"}
                      </span>
                    </div>
                    <p className="text-sm mt-1 line-clamp-2">
                      {session.taskSummary ?? "No messages"}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-fg-400">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTime(session.startedAt)}
                      </span>
                      <span>
                        {formatDuration(session.startedAt, session.endedAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        {formatCost(session.usage.estimatedCost)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {onReplay && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Replay session"
                        onClick={() => onReplay(session.id)}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-fg-400 hover:text-red-500"
                      title="Delete session"
                      onClick={async () => {
                        await fetch(`/api/sessions/${session.id}`, {
                          method: "DELETE",
                        });
                        // Trigger refresh via context
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
