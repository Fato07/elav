import React, {
  createContext,
  useContext,
  useState,
  useCallback,
} from "react";
import { formatCost } from "./types";

interface SessionTab {
  id: string;
  sandboxId: string | null;
  vncUrl: string | null;
  provider: "openai" | "anthropic";
  status: "idle" | "running" | "stopped";
  label: string;
  usage: { inputTokens: number; outputTokens: number; estimatedCost: number };
}

interface SessionContextType {
  tabs: SessionTab[];
  activeTabId: string | null;
  activeTab: SessionTab | null;
  createTab: (provider: "openai" | "anthropic") => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<SessionTab>) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  formatCost: (cost: number) => string;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const createTab = useCallback(
    (provider: "openai" | "anthropic") => {
      const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const tab: SessionTab = {
        id,
        sandboxId: null,
        vncUrl: null,
        provider,
        status: "idle",
        label: `Session ${tabs.length + 1}`,
        usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(id);
      return id;
    },
    [tabs.length]
  );

  const removeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeTabId === id && next.length > 0) {
          setActiveTabId(next[next.length - 1].id);
        } else if (next.length === 0) {
          setActiveTabId(null);
        }
        return next;
      });
    },
    [activeTabId]
  );

  const updateTab = useCallback(
    (id: string, updates: Partial<SessionTab>) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
      );
    },
    []
  );

  return (
    <SessionContext.Provider
      value={{
        tabs,
        activeTabId,
        activeTab,
        createTab,
        removeTab,
        setActiveTab: setActiveTabId,
        updateTab,
        sidebarOpen,
        setSidebarOpen,
        formatCost,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used within a SessionProvider");
  return context;
}
