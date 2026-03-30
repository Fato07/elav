import React from "react";
import {
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  SkipForward,
  ChevronDown,
  ChevronRight,
  Target,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Plan, SubTask, ChatMessage } from "./types";

function StatusIcon({ status }: { status: SubTask["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />;
    case "skipped":
      return <SkipForward className="h-4 w-4 text-muted-foreground shrink-0" />;
    case "pending":
    default:
      return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function statusLabel(status: SubTask["status"]): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "running":
      return "Running";
    case "skipped":
      return "Skipped";
    case "pending":
    default:
      return "Pending";
  }
}

function statusVariant(status: SubTask["status"]): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "failed":
      return "destructive";
    case "running":
      return "secondary";
    default:
      return "outline";
  }
}

interface SubtaskItemProps {
  subtask: SubTask;
  isSelected: boolean;
  onSelect: (id: string) => void;
  hasNonLinearDeps: boolean;
  allSubtasks: SubTask[];
}

function SubtaskItem({ subtask, isSelected, onSelect, hasNonLinearDeps, allSubtasks }: SubtaskItemProps) {
  const [expanded, setExpanded] = React.useState(false);
  const depNames = subtask.dependsOn
    .map((depId) => allSubtasks.find((st) => st.id === depId)?.title)
    .filter(Boolean);

  return (
    <div className="relative">
      <button
        onClick={() => onSelect(subtask.id)}
        className={cn(
          "w-full text-left rounded-md border p-3 transition-colors",
          "hover:bg-accent/50",
          isSelected
            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
            : "border-border bg-card",
          subtask.status === "running" && "border-blue-500/50",
        )}
      >
        <div className="flex items-center gap-2">
          <StatusIcon status={subtask.status} />
          <span className="text-sm font-medium truncate flex-1">{subtask.title}</span>
          <Badge variant={statusVariant(subtask.status)} className="text-[10px] px-1.5 py-0">
            {statusLabel(subtask.status)}
          </Badge>
          {subtask.description && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="p-0.5 rounded hover:bg-foreground/10"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          )}
        </div>

        {hasNonLinearDeps && depNames.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            <span>depends on:</span>
            {depNames.map((name, i) => (
              <Badge key={i} variant="outline" className="text-[10px] px-1 py-0">
                {name}
              </Badge>
            ))}
          </div>
        )}

        {subtask.error && (
          <p className="mt-1.5 text-xs text-red-500 truncate">{subtask.error}</p>
        )}
      </button>

      {expanded && subtask.description && (
        <div className="mt-1 ml-6 p-2 rounded bg-muted text-xs text-muted-foreground">
          {subtask.description}
        </div>
      )}
    </div>
  );
}

interface TaskDAGProps {
  plan: Plan | null;
  selectedSubtaskId: string | null;
  onSelectSubtask: (id: string) => void;
  className?: string;
}

export function TaskDAG({ plan, selectedSubtaskId, onSelectSubtask, className }: TaskDAGProps) {
  if (!plan) {
    return (
      <div className={cn("flex flex-col items-center justify-center text-muted-foreground p-6", className)}>
        <Target className="h-8 w-8 mb-3 opacity-40" />
        <p className="text-sm">Describe a goal to get started</p>
        <p className="text-xs mt-1 opacity-60">The AI will break it into subtasks</p>
      </div>
    );
  }

  // Detect if any task has non-linear (non-previous-task) dependencies
  const hasNonLinearDeps = plan.subtasks.some((st, i) => {
    if (st.dependsOn.length === 0) return false;
    if (i === 0) return st.dependsOn.length > 0;
    const prevId = plan.subtasks[i - 1].id;
    return !(st.dependsOn.length === 1 && st.dependsOn[0] === prevId);
  });

  const completed = plan.subtasks.filter((st) => st.status === "completed").length;
  const total = plan.subtasks.length;

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Task Plan</span>
          <Badge variant="secondary" className="ml-auto text-xs">
            {completed}/{total}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{plan.goal}</p>
        {/* Progress bar */}
        <div className="mt-2 h-1 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {plan.subtasks.map((subtask, index) => (
          <React.Fragment key={subtask.id}>
            {/* Connector line between tasks */}
            {index > 0 && (
              <div className="flex justify-center py-0.5">
                <div className="w-px h-3 bg-border" />
              </div>
            )}
            <SubtaskItem
              subtask={subtask}
              isSelected={selectedSubtaskId === subtask.id}
              onSelect={onSelectSubtask}
              hasNonLinearDeps={hasNonLinearDeps}
              allSubtasks={plan.subtasks}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
