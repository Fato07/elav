import React, { useState, useEffect, useCallback } from "react";
import { Monitor, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatProvider, useChat } from "@/components/computer-use/chat-context";
import { SessionProvider, useSession } from "@/components/computer-use/session-context";
import { ChatList, ChatInput, ExamplePrompts, ChatLoader } from "@/components/computer-use/ChatPanel";
import { SessionTabs, UsageBadge } from "@/components/computer-use/SessionPanel";
import { SystemPrompt } from "@/components/computer-use/SystemPrompt";
import { Surfing } from "@/components/computer-use/Surfing";
import { DEFAULT_RESOLUTION, DEFAULT_PROVIDER, type ModelProvider } from "@/components/computer-use/types";

function ComputerUseInner() {
  const chat = useChat();
  const session = useSession();
  const [systemPrompt, setSystemPrompt] = useState("");
  const [provider, setProvider] = useState<ModelProvider>(DEFAULT_PROVIDER);

  // When sandbox is created, update the active tab
  useEffect(() => {
    chat.onSandboxCreated((sandboxId, vncUrl) => {
      if (session.activeTabId) {
        session.updateTab(session.activeTabId, { sandboxId, vncUrl, status: "running" });
      }
    });
  }, [session.activeTabId]);

  const handleCreateSession = useCallback(
    (selectedProvider: ModelProvider = provider) => {
      setProvider(selectedProvider);
      session.createTab(selectedProvider);
      chat.clearMessages();
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

      chat.sendMessage({
        content,
        sandboxId: session.activeTab?.sandboxId ?? undefined,
        resolution: DEFAULT_RESOLUTION,
        provider: session.activeTab?.provider ?? provider,
        systemPrompt: systemPrompt || undefined,
      });
    },
    [chat, session, provider, systemPrompt]
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

  const activeTab = session.activeTab;
  const hasMessages = chat.messages.length > 0;

  return (
    <div className="flex h-full min-h-0">
      {/* VNC Frame Panel */}
      <div className="flex-1 flex flex-col min-w-0 border-r">
        <div className="flex items-center gap-2 px-4 h-12 border-b shrink-0">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Desktop</span>
          {activeTab?.status === "running" && (
            <span className="w-2 h-2 rounded-full bg-green-500" />
          )}
          {activeTab && (
            <UsageBadge
              inputTokens={activeTab.usage.inputTokens}
              outputTokens={activeTab.usage.outputTokens}
              estimatedCost={activeTab.usage.estimatedCost}
              className="ml-auto"
            />
          )}
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

        {/* Provider toggle + New session */}
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ModelProvider)}
            className="text-xs border rounded px-2 py-1 bg-background"
          >
            <option value="openai">GPT-5.4</option>
            <option value="anthropic">Claude</option>
          </select>
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
          {hasMessages ? (
            <ChatList messages={chat.messages} className="flex-1" />
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
          />
        </div>
      </div>
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
