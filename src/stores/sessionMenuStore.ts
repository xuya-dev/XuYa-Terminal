import { create } from "zustand";
import type { ShellKind } from "./sessionStore";

export type SessionMenuKind = "shell" | "agent";

export interface SessionMenuItem {
  id: string;
  label: string;
  shellKind: ShellKind;
  kind: SessionMenuKind;
  visible: boolean;
  startupCommand?: string;
  agentCommand?: string;
}

interface SessionMenuStore {
  items: SessionMenuItem[];
  addItem: (item?: Partial<SessionMenuItem>) => void;
  updateItem: (id: string, patch: Partial<SessionMenuItem>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, direction: "up" | "down") => void;
  resetItems: () => void;
}

const KEY = "xuya-session-menu";

export const DEFAULT_SESSION_MENU: SessionMenuItem[] = [
  {
    id: "builtin-powershell",
    label: "PowerShell",
    shellKind: "powerShell",
    kind: "shell",
    visible: true,
  },
  {
    id: "builtin-cmd",
    label: "CMD",
    shellKind: "cmd",
    kind: "shell",
    visible: true,
  },
  {
    id: "builtin-claude",
    label: "Claude Code",
    shellKind: "powerShell",
    kind: "agent",
    agentCommand: "claude",
    visible: true,
  },
  {
    id: "builtin-codex",
    label: "Codex",
    shellKind: "powerShell",
    kind: "agent",
    agentCommand: "codex",
    visible: true,
  },
  {
    id: "builtin-opencode",
    label: "OpenCode",
    shellKind: "powerShell",
    kind: "agent",
    agentCommand: "opencode",
    visible: true,
  },
];

function createId(): string {
  return `session-menu-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

function normalizeItem(item: Partial<SessionMenuItem>, index: number): SessionMenuItem {
  const shellKind = item.shellKind ?? "powerShell";
  const kind = item.kind ?? (item.agentCommand ? "agent" : "shell");
  const label =
    typeof item.label === "string" && item.label.trim()
      ? item.label.trim()
      : kind === "agent"
        ? item.agentCommand ?? "Agent"
        : shellKind;

  return {
    id: typeof item.id === "string" && item.id ? item.id : `session-menu-${index}`,
    label,
    shellKind,
    kind,
    visible: item.visible !== false,
    startupCommand:
      typeof item.startupCommand === "string" && item.startupCommand.trim()
        ? item.startupCommand
        : undefined,
    agentCommand:
      typeof item.agentCommand === "string" && item.agentCommand.trim()
        ? item.agentCommand.trim()
        : undefined,
  };
}

function loadItems(): SessionMenuItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SESSION_MENU;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SESSION_MENU;
    const items = parsed.map(normalizeItem);
    return items.length > 0 ? items : DEFAULT_SESSION_MENU;
  } catch {
    return DEFAULT_SESSION_MENU;
  }
}

function saveItems(items: SessionMenuItem[]): void {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export const useSessionMenuStore = create<SessionMenuStore>((set, get) => ({
  items: loadItems(),

  addItem: (item) => {
    const nextItem = normalizeItem(
      {
        id: createId(),
        label: "新会话",
        shellKind: "powerShell",
        kind: "shell",
        visible: true,
        ...item,
      },
      get().items.length,
    );
    set((state) => {
      const items = [...state.items, nextItem];
      saveItems(items);
      return { items };
    });
  },

  updateItem: (id, patch) =>
    set((state) => {
      const items = state.items.map((item, index) =>
        item.id === id ? normalizeItem({ ...item, ...patch, id }, index) : item,
      );
      saveItems(items);
      return { items };
    }),

  removeItem: (id) =>
    set((state) => {
      const items = state.items.filter((item) => item.id !== id);
      saveItems(items);
      return { items };
    }),

  moveItem: (id, direction) =>
    set((state) => {
      const index = state.items.findIndex((item) => item.id === id);
      if (index < 0) {
        return state;
      }
      const current = state.items[index];
      const target =
        direction === "up"
          ? state.items
              .slice(0, index)
              .map((item, offset) => ({ item, index: offset }))
              .reverse()
              .find(({ item }) => item.kind === current.kind)?.index
          : state.items.findIndex(
              (item, itemIndex) => itemIndex > index && item.kind === current.kind,
            );
      if (target == null || target < 0) return state;

      const items = [...state.items];
      [items[index], items[target]] = [items[target], items[index]];
      saveItems(items);
      return { items };
    }),

  resetItems: () => {
    saveItems(DEFAULT_SESSION_MENU);
    set({ items: DEFAULT_SESSION_MENU });
  },
}));
