import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; prompt: string }[] = [
  {
    label: "Web Developer",
    prompt:
      "You are an expert web developer. Focus on using the browser and code editor to build, test, and debug web applications. Prefer using the terminal for npm commands and file operations.",
  },
  {
    label: "Data Analyst",
    prompt:
      "You are a data analyst. Focus on using Python, Jupyter notebooks, and data visualization tools. Use pandas, matplotlib, and other data libraries to analyze datasets and create charts.",
  },
  {
    label: "DevOps",
    prompt:
      "You are a DevOps engineer. Focus on system administration, Docker, CI/CD pipelines, and infrastructure management. Use the terminal for configuration and deployment tasks.",
  },
  {
    label: "QA Tester",
    prompt:
      "You are a QA tester. Focus on testing web applications by navigating through user flows, filling forms, clicking buttons, and verifying expected behavior. Report any bugs found.",
  },
  {
    label: "Research Assistant",
    prompt:
      "You are a research assistant. Use the browser to search for information, read articles, and compile findings. Organize results in text files or documents.",
  },
];

interface SystemPromptPresetsProps {
  onSelect: (prompt: string) => void;
  className?: string;
}

export function SystemPromptPresets({ onSelect, className }: SystemPromptPresetsProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border bg-background"
      >
        Presets
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-48 rounded-md border bg-popover shadow-md z-50">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                onSelect(preset.prompt);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors first:rounded-t-md last:rounded-b-md"
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
