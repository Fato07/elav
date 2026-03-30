import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
} from "react";
import {
  type ChatMessage,
  type ChatState,
  type ParsedSSEEvent,
  type SendMessageOptions,
  type ActionChatMessage,
  type UserChatMessage,
  type AssistantChatMessage,
  type SystemChatMessage,
  type Plan,
  type UsageData,
  type ApprovalRequest,
  SSEEventType,
} from "./types";

interface OrchestrateOptions {
  goal: string;
  sandboxId?: string;
  resolution: [number, number];
  systemPrompt?: string;
}

interface ChatContextType extends ChatState {
  sendMessage: (options: SendMessageOptions) => Promise<void>;
  sendOrchestrate: (options: OrchestrateOptions) => Promise<void>;
  stopGeneration: () => void;
  clearMessages: () => void;
  setInput: (input: string) => void;
  input: string;
  handleSubmit: (e: React.FormEvent) => string | undefined;
  onSandboxCreated: (callback: (sandboxId: string, vncUrl: string) => void) => void;
  plan: Plan | null;
  selectedSubtaskId: string | null;
  setSelectedSubtaskId: (id: string | null) => void;
  subtaskMessages: Record<string, ChatMessage[]>;
  onPlanUpdated: (callback: (plan: Plan) => void) => void;
  usage: UsageData | null;
  pendingApproval: ApprovalRequest | null;
  approveSubtask: (subtaskId: string) => void;
  denySubtask: (subtaskId: string) => void;
  retrySubtask: (sessionId: string, subtaskId: string) => Promise<void>;
  skipSubtask: (subtaskId: string) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null);
  const [subtaskMessages, setSubtaskMessages] = useState<Record<string, ChatMessage[]>>({});
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const onSandboxCreatedRef = useRef<
    ((sandboxId: string, vncUrl: string) => void) | undefined
  >(undefined);
  const onPlanUpdatedRef = useRef<
    ((plan: Plan) => void) | undefined
  >(undefined);

  const parseSSEEvent = (data: string): ParsedSSEEvent | null => {
    try {
      if (!data || data.trim() === "") return null;
      if (data.startsWith("data: ")) {
        const jsonStr = data.substring(6).trim();
        if (!jsonStr) return null;
        return JSON.parse(jsonStr);
      }
      const match = data.match(/data: ({.*})/);
      if (match && match[1]) return JSON.parse(match[1]);
      return JSON.parse(data);
    } catch {
      return null;
    }
  };

  const approveSubtask = useCallback(async (subtaskId: string) => {
    if (!sessionIdRef.current) return;
    setPendingApproval(null);
    try {
      await fetch("/api/computer-use/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          subtaskId,
          approved: true,
        }),
      });
    } catch (err) {
      console.error("Failed to approve subtask:", err);
    }
  }, []);

  const denySubtask = useCallback(async (subtaskId: string) => {
    if (!sessionIdRef.current) return;
    setPendingApproval(null);
    try {
      await fetch("/api/computer-use/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          subtaskId,
          approved: false,
        }),
      });
    } catch (err) {
      console.error("Failed to deny subtask:", err);
    }
  }, []);

  const retrySubtask = useCallback(async (sessionId: string, subtaskId: string) => {
    try {
      const res = await fetch("/api/computer-use/retry-subtask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, subtaskId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.plan) {
          setPlan(data.plan);
        }
      }
    } catch (err) {
      console.error("Failed to retry subtask:", err);
    }
  }, []);

  const skipSubtask = useCallback((subtaskId: string) => {
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        subtasks: prev.subtasks.map((st) =>
          st.id === subtaskId
            ? { ...st, status: "skipped" as const }
            : st.dependsOn.includes(subtaskId) && st.status === "pending"
              ? { ...st, status: "skipped" as const }
              : st
        ),
      };
    });
  }, []);

  const sendMessage = async ({
    content,
    sandboxId,
    environment,
    resolution,
    provider,
    systemPrompt,
  }: SendMessageOptions) => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    const userMessage: ChatMessage = {
      role: "user",
      content,
      id: Date.now().toString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    abortControllerRef.current = new AbortController();

    try {
      const apiMessages = messages
        .concat(userMessage)
        .filter((msg) => msg.role === "user" || msg.role === "assistant")
        .map((msg) => {
          const typedMsg = msg as UserChatMessage | AssistantChatMessage;
          return { role: typedMsg.role, content: typedMsg.content };
        });

      const response = await fetch("/api/computer-use/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          sandboxId,
          environment,
          resolution,
          provider,
          systemPrompt,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Response body is null");

      setMessages((prev) => [
        ...prev,
        { role: "system", id: `system-message-${Date.now()}`, content: "Task started" },
      ]);

      const decoder = new TextDecoder();
      let assistantMessage = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim()) {
            const parsedEvent = parseSSEEvent(buffer);
            if (parsedEvent?.type === SSEEventType.DONE) {
              setMessages((prev) => [
                ...prev,
                { role: "system", id: `system-${Date.now()}`, content: "Task completed" },
              ]);
              setIsLoading(false);
            }
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          if (!event.trim()) continue;
          const parsedEvent = parseSSEEvent(event);
          if (!parsedEvent) continue;

          switch (parsedEvent.type) {
            case SSEEventType.ACTION:
              if (parsedEvent.action) {
                const incomingAction = parsedEvent.action;
                const actionMessage: ActionChatMessage = {
                  role: "action",
                  id: `action-${Date.now()}`,
                  action: incomingAction,
                  repeatCount: 1,
                  status: "pending",
                };
                setMessages((prev) => {
                  const isWait = incomingAction.type === "wait";
                  if (!isWait) return [...prev, actionMessage];
                  const lastMessage = prev.at(-1);
                  if (!lastMessage || lastMessage.role !== "action") return [...prev, actionMessage];
                  const last = lastMessage as ActionChatMessage;
                  if (last.action.type !== "wait") return [...prev, actionMessage];
                  return [
                    ...prev.slice(0, -1),
                    { ...last, repeatCount: (last.repeatCount ?? 1) + 1, status: "pending" as const },
                  ];
                });
              }
              break;

            case SSEEventType.REASONING:
              if (typeof parsedEvent.content === "string") {
                assistantMessage = parsedEvent.content;
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", id: `assistant-${Date.now()}-${messages.length}`, content: assistantMessage },
                ]);
              }
              break;

            case SSEEventType.DONE:
              setMessages((prev) => [
                ...prev,
                { role: "system", id: `system-${Date.now()}`, content: parsedEvent.content || "Task completed" },
              ]);
              setIsLoading(false);
              break;

            case SSEEventType.ERROR:
              setError(parsedEvent.content ?? "Unknown error");
              setMessages((prev) => [
                ...prev,
                { role: "system", id: `system-${Date.now()}`, content: parsedEvent.content ?? "Error", isError: true },
              ]);
              setIsLoading(false);
              break;

            case SSEEventType.SANDBOX_CREATED:
              if (parsedEvent.sandboxId && parsedEvent.vncUrl && onSandboxCreatedRef.current) {
                onSandboxCreatedRef.current(parsedEvent.sandboxId, parsedEvent.vncUrl);
              }
              break;

            case SSEEventType.ACTION_COMPLETED:
              setMessages((prev) => {
                const lastActionIndex = [...prev].reverse().findIndex((msg) => msg.role === "action");
                if (lastActionIndex !== -1) {
                  const actualIndex = prev.length - 1 - lastActionIndex;
                  return prev.map((msg, index) =>
                    index === actualIndex ? { ...msg, status: "completed" } : msg
                  );
                }
                return prev;
              });
              break;

            case SSEEventType.USAGE_UPDATE:
              if (parsedEvent.usage) {
                setUsage(parsedEvent.usage);
              }
              break;
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setIsLoading(false);
        return;
      }
      setError(error instanceof Error ? error.message : "An error occurred");
      setIsLoading(false);
    }
  };

  const sendOrchestrate = async ({
    goal,
    sandboxId,
    resolution,
    systemPrompt,
  }: OrchestrateOptions) => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    setPlan(null);
    setSubtaskMessages({});
    setSelectedSubtaskId(null);
    setUsage(null);
    setPendingApproval(null);

    // Generate a session ID for this orchestration
    const orchSessionId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionIdRef.current = orchSessionId;

    const userMessage: ChatMessage = {
      role: "user",
      content: goal,
      id: Date.now().toString(),
    };
    setMessages([userMessage]);

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/computer-use/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, sandboxId, resolution, systemPrompt, sessionId: orchSessionId }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Response body is null");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          if (!event.trim()) continue;
          const parsedEvent = parseSSEEvent(event);
          if (!parsedEvent) continue;

          switch (parsedEvent.type) {
            case SSEEventType.SANDBOX_CREATED:
              if (parsedEvent.sandboxId && parsedEvent.vncUrl && onSandboxCreatedRef.current) {
                onSandboxCreatedRef.current(parsedEvent.sandboxId, parsedEvent.vncUrl);
              }
              break;

            case SSEEventType.PLAN_CREATED:
              if (parsedEvent.plan) {
                setPlan(parsedEvent.plan);
                if (onPlanUpdatedRef.current) onPlanUpdatedRef.current(parsedEvent.plan);
                setMessages((prev) => [
                  ...prev,
                  { role: "system", id: `system-plan-${Date.now()}`, content: `Plan created: ${parsedEvent.plan!.subtasks.length} tasks` },
                ]);
              }
              break;

            case SSEEventType.SUBTASK_STARTED:
              if (parsedEvent.subtaskId) {
                setSelectedSubtaskId(parsedEvent.subtaskId);
                setPlan((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    subtasks: prev.subtasks.map((st) =>
                      st.id === parsedEvent.subtaskId ? { ...st, status: "running" as const } : st
                    ),
                  };
                });
                setSubtaskMessages((prev) => ({
                  ...prev,
                  [parsedEvent.subtaskId!]: [
                    { role: "system", id: `start-${parsedEvent.subtaskId}`, content: `Started: ${parsedEvent.title || parsedEvent.subtaskId}` },
                  ],
                }));
              }
              break;

            case SSEEventType.SUBTASK_UPDATE:
              if (parsedEvent.subtaskId && parsedEvent.inner) {
                const inner = parsedEvent.inner;
                const stId = parsedEvent.subtaskId;

                if (inner.type === SSEEventType.REASONING && typeof inner.content === "string") {
                  setSubtaskMessages((prev) => ({
                    ...prev,
                    [stId]: [
                      ...(prev[stId] || []),
                      { role: "assistant", id: `ast-${stId}-${Date.now()}`, content: inner.content! },
                    ],
                  }));
                } else if (inner.type === SSEEventType.ACTION && inner.action) {
                  setSubtaskMessages((prev) => ({
                    ...prev,
                    [stId]: [
                      ...(prev[stId] || []),
                      { role: "action", id: `act-${stId}-${Date.now()}`, action: inner.action!, repeatCount: 1, status: "pending" as const },
                    ],
                  }));
                } else if (inner.type === SSEEventType.ACTION_COMPLETED) {
                  setSubtaskMessages((prev) => {
                    const msgs = prev[stId] || [];
                    const lastActionIndex = [...msgs].reverse().findIndex((m) => m.role === "action");
                    if (lastActionIndex === -1) return prev;
                    const actualIndex = msgs.length - 1 - lastActionIndex;
                    return {
                      ...prev,
                      [stId]: msgs.map((msg, idx) =>
                        idx === actualIndex ? { ...msg, status: "completed" } : msg
                      ),
                    };
                  });
                } else if (inner.type === SSEEventType.ERROR) {
                  setSubtaskMessages((prev) => ({
                    ...prev,
                    [stId]: [
                      ...(prev[stId] || []),
                      { role: "system", id: `err-${stId}-${Date.now()}`, content: inner.content || "Error", isError: true },
                    ],
                  }));
                }
              }
              break;

            case SSEEventType.SUBTASK_COMPLETED:
              if (parsedEvent.subtaskId) {
                setPlan((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    subtasks: prev.subtasks.map((st) =>
                      st.id === parsedEvent.subtaskId
                        ? { ...st, status: "completed" as const, result: parsedEvent.result }
                        : st
                    ),
                  };
                });
                setSubtaskMessages((prev) => ({
                  ...prev,
                  [parsedEvent.subtaskId!]: [
                    ...(prev[parsedEvent.subtaskId!] || []),
                    { role: "system", id: `done-${parsedEvent.subtaskId}`, content: "Task completed" },
                  ],
                }));
              }
              break;

            case SSEEventType.SUBTASK_FAILED:
              if (parsedEvent.subtaskId) {
                setPlan((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    subtasks: prev.subtasks.map((st) =>
                      st.id === parsedEvent.subtaskId
                        ? { ...st, status: "failed" as const, error: parsedEvent.error }
                        : st.dependsOn.includes(parsedEvent.subtaskId!) && st.status === "pending"
                          ? { ...st, status: "skipped" as const }
                          : st
                    ),
                  };
                });
              }
              break;

            case SSEEventType.ORCHESTRATOR_DONE:
              if (parsedEvent.plan) {
                setPlan(parsedEvent.plan);
              }
              setMessages((prev) => [
                ...prev,
                { role: "system", id: `orch-done-${Date.now()}`, content: parsedEvent.summary || "Orchestration complete" },
              ]);
              setIsLoading(false);
              break;

            case SSEEventType.ERROR:
              setError(parsedEvent.content ?? "Unknown error");
              setMessages((prev) => [
                ...prev,
                { role: "system", id: `system-${Date.now()}`, content: parsedEvent.content ?? "Error", isError: true },
              ]);
              setIsLoading(false);
              break;

            case SSEEventType.USAGE_UPDATE:
              if (parsedEvent.usage) {
                setUsage(parsedEvent.usage);
              }
              break;

            case SSEEventType.APPROVAL_REQUIRED:
              if (parsedEvent.subtaskId) {
                setPendingApproval({
                  subtaskId: parsedEvent.subtaskId,
                  action: String(parsedEvent.action ?? "unknown"),
                  description: parsedEvent.description ?? "",
                  risk: parsedEvent.risk ?? "medium",
                });
              }
              break;
          }
        }
      }

      // If stream ended without ORCHESTRATOR_DONE
      setIsLoading(false);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setIsLoading(false);
        return;
      }
      setError(error instanceof Error ? error.message : "An error occurred");
      setIsLoading(false);
    }
  };

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort(new DOMException("Generation stopped by user", "AbortError"));
        setIsLoading(false);
      } catch {
        setIsLoading(false);
      }
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setPlan(null);
    setSubtaskMessages({});
    setSelectedSubtaskId(null);
    setUsage(null);
    setPendingApproval(null);
    sessionIdRef.current = null;
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent): string | undefined => {
      e.preventDefault();
      if (!input.trim()) return;
      const content = input.trim();
      setInput("");
      return content;
    },
    [input]
  );

  const value = {
    messages,
    isLoading,
    error,
    input,
    setInput,
    sendMessage,
    sendOrchestrate,
    stopGeneration,
    clearMessages,
    handleSubmit,
    onSandboxCreated: (callback: (sandboxId: string, vncUrl: string) => void) => {
      onSandboxCreatedRef.current = callback;
    },
    plan,
    selectedSubtaskId,
    setSelectedSubtaskId,
    subtaskMessages,
    onPlanUpdated: (callback: (plan: Plan) => void) => {
      onPlanUpdatedRef.current = callback;
    },
    usage,
    pendingApproval,
    approveSubtask,
    denySubtask,
    retrySubtask,
    skipSubtask,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
