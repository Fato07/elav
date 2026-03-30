import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Monitor, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatProvider, useChat } from "@/components/computer-use/chat-context";
import { SessionProvider, useSession } from "@/components/computer-use/session-context";
import { ChatList, ChatInput, ExamplePrompts, ChatLoader } from "@/components/computer-use/ChatPanel";
import { SessionTabs, UsageBadge } from "@/components/computer-use/SessionPanel";
import { SystemPrompt } from "@/components/computer-use/SystemPrompt";
import { Surfing } from "@/components/computer-use/Surfing";
import { TaskDAG } from "@/components/computer-use/TaskDAG";
import { ModeToggle, type ComputerUseMode } from "@/components/computer-use/ModeToggle";
import { UsageTracker } from "@/components/computer-use/UsageTracker";
import { ApprovalDialog } from "@/components/computer-use/ApprovalDialog";
import { SystemPromptPresets } from "@/components/computer-use/SystemPromptPresets";
import { DEFAULT_RESOLUTION, DEFAULT_PROVIDER, type ModelProvider } from "@/components/computer-use/types";
import { useCompany } from "../context/CompanyContext";

function ComputerUseInner() {
  const chat = useChat();
  const session = useSession();
  const { selectedCompanyId } = useCompany();
  const [systemPrompt, setSystemPrompt] = useState("");
  const [provider, setProvider] = useState<ModelProvider>(DEFAULT_PROVIDER);
  const [mode, setMode] = useState<ComputerUseMode>("chat");
  const [sandboxStartedAt, setSandboxStartedAt] = useState<number | null>(null);

  // When sandbox is created, update the active tab
  useEffect(() => {
    chat.onSandboxCreated((sandboxId, vncUrl) => {
      if (session.activeTabId) {
        session.updateTab(session.activeTabId, { sandboxId, vncUrl, status: "running" });
        setSandboxStartedAt(Date.now());
      }
    });
  }, [session.activeTabId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+Shift+O: toggle orchestrate mode
      if (isMeta && e.shiftKey && e.key === "o") {
        e.preventDefault();
        setMode((prev) => (prev === "chat" ? "orchestrate" : "chat"));
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleCreateSession = useCallback(
    (selectedProvider: ModelProvider = provider) => {
      setProvider(selectedProvider);
      session.createTab(selectedProvider);
      chat.clearMessages();
      setSandboxStartedAt(null);
    },
    [provider, session, chat]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      const content = chat.handleSubmit(e);
      if (!content) return;

      // Auto-create a session tab if none exists
      if (!session.activeTabId) {
        session.createTab(provider);
      }

      if (!selectedCompanyId) return;

      if (mode === "orchestrate") {
        chat.sendOrchestrate({
          goal: content,
          sandboxId: session.activeTab?.sandboxId ?? undefined,
          resolution: DEFAULT_RESOLUTION,
          systemPrompt: systemPrompt || undefined,
          companyId: selectedCompanyId,
        });
      } else {
        chat.sendMessage({
          content,
          sandboxId: session.activeTab?.sandboxId ?? undefined,
          resolution: DEFAULT_RESOLUTION,
          provider: session.activeTab?.provider ?? provider,
          systemPrompt: systemPrompt || undefined,
          companyId: selectedCompanyId,
        });
      }
    },
    [chat, session, provider, systemPrompt, mode, selectedCompanyId]
  );

  const handlePromptClick = useCallback(
    (prompt: string) => {
      if (!session.activeTabId) {
        session.createTab(provider);
      }
      chat.setInput(prompt);
    },
    [chat, session, provider]
  );

  const handleRetrySubtask = useCallback(
    (subtaskId: string) => {
      // We need the sessionId — stored internally in chat context
      // Use a placeholder; the retrySubtask handler will use the stored sessionId
      chat.retrySubtask("", subtaskId);
    },
    [chat]
  );

  const activeTab = session.activeTab;
  const isOrchestrate = mode === "orchestrate";

  // In orchestrate mode, show subtask messages when a subtask is selected
  const displayMessages = useMemo(() => {
    if (isOrchestrate && chat.selectedSubtaskId && chat.subtaskMessages[chat.selectedSubtaskId]) {
      return chat.subtaskMessages[chat.selectedSubtaskId];
    }
    return chat.messages;
  }, [isOrchestrate, chat.selectedSubtaskId, chat.subtaskMessages, chat.messages]);

  return (
    <div className="flex h-full min-h-0">
      {/* Task DAG Sidebar — only in orchestrate mode */}
      {isOrchestrate && (
        <div className="w-[280px] flex flex-col min-h-0 shrink-0 border-r">
          <TaskDAG
            plan={chat.plan}
            selectedSubtaskId={chat.selectedSubtaskId}
            onSelectSubtask={chat.setSelectedSubtaskId}
            onRetrySubtask={handleRetrySubtask}
            onSkipSubtask={chat.skipSubtask}
            isGeneratingPlan={chat.isLoading && !chat.plan}
            className="flex-1"
          />
        </div>
      )}

      {/* VNC Frame Panel */}
      <div className="flex-1 flex flex-col min-w-0 border-r">
        <div className="flex items-center gap-2 px-4 h-12 border-b shrink-0">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Desktop</span>
          {activeTab?.status === "running" && (
            <span className="w-2 h-2 rounded-full bg-green-500" />
          )}
          <div className="ml-auto flex items-center gap-2">
            {(chat.usage || sandboxStartedAt) && (
              <UsageTracker
                usage={chat.usage}
                sandboxStartedAt={sandboxStartedAt}
              />
            )}
            {activeTab && !chat.usage && (
              <UsageBadge
                inputTokens={activeTab.usage.inputTokens}
                outputTokens={activeTab.usage.outputTokens}
                estimatedCost={activeTab.usage.estimatedCost}
              />
            )}
          </div>
        </div>
        <div className="flex-1 bg-muted flex items-center justify-center min-h-0 relative">
          {activeTab?.vncUrl ? (
            <iframe
              src={activeTab.vncUrl}
              className="w-full h-full border-0"
              title="Desktop sandbox"
              allow="clipboard-read; clipboard-write"
            />
          ) : (
            <div className="flex flex-col items-center gap-4 text-muted-foreground">
              <Surfing className="text-xs opacity-40 font-mono" />
              <p className="text-sm">Start a session to connect to a desktop</p>
            </div>
          )}
        </div>
      </div>

      {/* Chat Panel */}
      <div className="w-[400px] flex flex-col min-h-0 shrink-0">
        <SessionTabs />
        <SystemPrompt value={systemPrompt} onChange={setSystemPrompt} />

        {/* Mode toggle + Provider + Presets + New session */}
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <ModeToggle mode={mode} onModeChange={setMode} />
          {mode === "chat" && (
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ModelProvider)}
              className="text-xs border rounded px-2 py-1 bg-background"
            >
              <option value="openai">GPT-5.4</option>
              <option value="anthropic">Claude</option>
            </select>
          )}
          <SystemPromptPresets onSelect={setSystemPrompt} />
          <Button
            variant="outline"
            size="xs"
            onClick={() => handleCreateSession()}
            className="ml-auto"
          >
            <Plus className="h-3 w-3" />
            New Session
          </Button>
        </div>

        {/* Messages area */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {displayMessages.length > 0 ? (
            <ChatList messages={displayMessages} className="flex-1" />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center">
              <ExamplePrompts onPromptClick={handlePromptClick} disabled={chat.isLoading} />
            </div>
          )}
        </div>

        {/* Loading indicator */}
        {chat.isLoading && (
          <div className="px-4 py-1">
            <ChatLoader className="text-muted-foreground" />
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t">
          <ChatInput
            input={chat.input}
            setInput={chat.setInput}
            onSubmit={handleSubmit}
            isLoading={chat.isLoading}
            onStop={chat.stopGeneration}
            disabled={false}
            placeholder={isOrchestrate ? "Describe your goal..." : "What are we surfing today?"}
          />
          <p className="text-[10px] text-muted-foreground mt-1 text-center">
            {isOrchestrate ? "Cmd+Shift+O to switch to Chat" : "Cmd+Shift+O to switch to Orchestrate"} · Cmd+Enter to send
          </p>
        </div>
      </div>

      {/* Approval Dialog */}
      <ApprovalDialog
        approval={chat.pendingApproval}
        onApprove={chat.approveSubtask}
        onDeny={chat.denySubtask}
      />
    </div>
  );
}

export function ComputerUse() {
  return (
    <SessionProvider>
      <ChatProvider>
        <ComputerUseInner />
      </ChatProvider>
    </SessionProvider>
  );
}
