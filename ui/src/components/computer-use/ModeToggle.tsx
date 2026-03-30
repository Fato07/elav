import { MessageSquare, Target } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComputerUseMode = "chat" | "orchestrate";

interface ModeToggleProps {
  mode: ComputerUseMode;
  onModeChange: (mode: ComputerUseMode) => void;
  className?: string;
}

export function ModeToggle({ mode, onModeChange, className }: ModeToggleProps) {
  return (
    <div className={cn("flex items-center gap-1 p-1 bg-muted rounded-md", className)}>
      <button
        onClick={() => onModeChange("chat")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors",
          mode === "chat"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Chat
      </button>
      <button
        onClick={() => onModeChange("orchestrate")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors",
          mode === "orchestrate"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Target className="h-3.5 w-3.5" />
        Orchestrate
      </button>
    </div>
  );
}
