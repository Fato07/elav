import React, { useRef, useEffect, useState, useMemo } from "react";
import {
  ChevronsRight,
  StopCircle,
  Terminal,
  AlertCircle,
  CheckCircle,
  Clock,
  User,
  Bot,
  Info,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType, ActionChatMessage } from "./types";

/* ── ChatLoader ── */

function ChatLoader({
  text = "surfing",
  className,
}: {
  text?: React.ReactNode;
  className?: string;
}) {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => setDots((prev) => (prev % 3) + 1), 200);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className={cn("flex items-center font-mono text-xs", className)}>
      <span>{text}</span>
      <span className="inline-flex ml-1">
        {".".repeat(dots)}
        <span className="invisible">{".".repeat(3 - dots)}</span>
      </span>
    </div>
  );
}

/* ── ActionMessageDisplay ── */

function ActionMessageDisplay({
  message,
  className,
}: {
  message: ActionChatMessage;
  className?: string;
}) {
  const { action, repeatCount, status } = message;

  const formatAction = (action: Record<string, unknown>, repeats?: number): string => {
    if (!action) return "No action details";
    if (action.type === "wait") return repeats && repeats > 1 ? `wait x${repeats}` : "wait";
    try {
      return JSON.stringify(action, null, 2);
    } catch {
      return "Unable to display action details";
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-3 w-3 text-green-500" />;
      case "failed":
        return <AlertCircle className="h-3 w-3 text-destructive" />;
      case "pending":
        return <Clock className="h-3 w-3 text-yellow-500 animate-pulse" />;
      default:
        return null;
    }
  };

  return (
    <div className={cn("flex justify-start", className)}>
      <Card className="max-w-[85%] overflow-hidden border bg-muted">
        <CardContent className="p-3">
          <div className="text-xs mb-2 font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Terminal className="h-3 w-3" />
            <span>Action</span>
            {status && (
              <div className="ml-2 flex items-center gap-1">
                {getStatusIcon()}
                <span className="text-xs capitalize">{status}</span>
              </div>
            )}
          </div>
          <div className="bg-background p-2 rounded font-mono text-xs tracking-wide text-foreground/80 overflow-x-auto mb-3">
            <code>{formatAction(action, repeatCount)}</code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── ChatMessage ── */

function ChatMessage({
  message,
  className,
}: {
  message: ChatMessageType;
  className?: string;
}) {
  const role = message.role;
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  const isAction = role === "action";
  const isSystem = role === "system";
  const isError = "isError" in message && message.isError;

  if (isSystem) {
    return (
      <div className={cn("w-full flex justify-center", className)}>
        <Badge variant={isError ? "destructive" : "secondary"}>
          {(message as { content: string }).content}
        </Badge>
      </div>
    );
  }

  if (isAction) {
    return <ActionMessageDisplay message={message as ActionChatMessage} className={className} />;
  }

  const getRoleIcon = () => {
    if (isUser) return <User className="h-3 w-3" />;
    if (isAssistant) return <Bot className="h-3 w-3" />;
    return <Info className="h-3 w-3" />;
  };

  const roleLabel = isUser ? "You" : isAssistant ? "Assistant" : "System";

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if ("content" in message) {
      navigator.clipboard.writeText((message as { content: string }).content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start", className)}>
      <Card
        className={cn(
          "max-w-[85%] overflow-hidden border relative group",
          isUser
            ? "bg-primary/10 text-foreground border-primary/30"
            : "bg-muted text-foreground border-border"
        )}
      >
        <CardContent className="p-3">
          <div className="text-xs mb-2 font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            {getRoleIcon()}
            <span>{roleLabel}</span>
            {isAssistant && (
              <button
                onClick={handleCopy}
                className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-foreground/10"
                title="Copy to clipboard"
              >
                {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              </button>
            )}
          </div>
          <div className="whitespace-pre-wrap break-words font-sans text-sm tracking-wide">
            {(message as { content: string }).content}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── ChatList ── */

export function ChatList({
  messages,
  className,
}: {
  messages: ChatMessageType[];
  className?: string;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div ref={containerRef} className={cn("overflow-y-auto p-4 pb-22 space-y-4", className)}>
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}

/* ── ChatInput ── */

export function ChatInput({
  input,
  setInput,
  onSubmit,
  isLoading,
  onStop,
  disabled = false,
  placeholder = "What are we surfing today?",
  className,
}: {
  input: string;
  setInput: (input: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  onStop: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const isInputEmpty = useMemo(() => input.trim() === "", [input]);

  return (
    <form onSubmit={onSubmit} className={cn(className)}>
      <div className="flex items-center">
        <div className="relative flex-1 flex items-center gap-2">
          <Input
            placeholder={placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (!isInputEmpty && !disabled && !isLoading) {
                  onSubmit(e as unknown as React.FormEvent);
                }
              }
            }}
            autoFocus
            required
            disabled={disabled}
            className="w-full pr-16"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {isLoading ? (
              <Button
                type="button"
                onClick={onStop}
                variant="destructive"
                size="icon-sm"
                disabled={disabled}
                title="Stop generating"
              >
                <StopCircle className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon-sm"
                disabled={disabled || isInputEmpty}
                title="Send message"
              >
                <ChevronsRight
                  className="w-4 h-4 transition-transform"
                  style={{ transform: isInputEmpty ? "rotate(0deg)" : "rotate(-90deg)" }}
                />
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

/* ── ExamplePrompts ── */

const DEFAULT_PROMPTS = [
  {
    text: "Set up a Python project",
    prompt:
      "Create a Python project with a virtual environment, install pytest, write a simple calculator module with tests, and run the test suite",
  },
  {
    text: "Research competitors on the web",
    prompt:
      "Open Firefox and research the top 5 AI agent platforms. Create a comparison table in a text file with their pricing, features, and target market",
  },
  {
    text: "Analyze a CSV with pandas",
    prompt:
      "Create a sample sales CSV file with 50 rows, then write a Python script using pandas to analyze it — show top products, monthly trends, and save a summary report",
  },
  {
    text: "Build and preview a website",
    prompt:
      "Create a simple landing page with HTML, CSS, and JavaScript. Include a hero section, features grid, and a contact form. Open it in Firefox to preview",
  },
];

export function ExamplePrompts({
  onPromptClick,
  prompts = DEFAULT_PROMPTS,
  disabled = false,
  className,
}: {
  onPromptClick: (prompt: string) => void;
  prompts?: Array<{ text: string; prompt: string }>;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 mx-auto my-4 w-full max-w-[600px] px-4", className)}>
      <div className="flex items-center gap-2 text-primary">
        <Terminal className="w-4 h-4" />
        <span className="text-sm font-mono">Try these examples</span>
      </div>
      <div className="flex flex-wrap gap-2 justify-center w-full px-2 pb-2">
        {prompts.map((item, index) => (
          <Button
            key={index}
            onClick={() => onPromptClick(item.prompt)}
            variant="outline"
            size="lg"
            className="text-left whitespace-normal text-sm h-auto py-2 px-3"
            disabled={disabled}
          >
            {item.text}
          </Button>
        ))}
      </div>
    </div>
  );
}

export { ChatLoader };
