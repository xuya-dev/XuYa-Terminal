import { create } from "zustand";

export type ShellKind = "powerShell" | "pwsh" | "cmd" | "wsl" | "gitBash";
export type SessionStatus = "running" | "idle" | "exited";

/**
 * Full metadata for one terminal session — kept in sync with the
 * matching Dockview panel by the same id. The sidebar reads this list,
 * and the status bar reads `sessions[activeId]`.
 */
export interface SessionMeta {
  id: string;
  /** User-facing label (e.g. "PowerShell", "Claude Code"). */
  label: string;
  shellKind: ShellKind;
  /** Agent CLI command if this session is running an agent. */
  agentCommand?: string;
  /** Backing agent conversation/session id when the CLI exposes one. */
  agentSessionId?: string;
  /** Spawn working directory. Updated later if we wire OSC-7. */
  cwd: string;
  /** ms since epoch — drives the uptime display in the status bar. */
  startTime: number;
  status: SessionStatus;
  /** Last detected exit code (for `status === 'exited'`). */
  exitCode?: number;
}

interface SessionStore {
  sessions: SessionMeta[];
  activeId: string | null;

  /** Register a session when its panel mounts. */
  add: (session: SessionMeta) => void;
  /** Patch one or more fields. */
  update: (id: string, patch: Partial<SessionMeta>) => void;
  /** Remove when its panel unmounts. */
  remove: (id: string) => void;
  /** Set focused session (driven by Dockview active-panel events). */
  setActive: (id: string | null) => void;
  /** Convenience selector. */
  getActive: () => SessionMeta | null;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeId: null,

  add: (session) =>
    set((s) => {
      // Replace if id collides (re-mount from layout restore).
      const without = s.sessions.filter((x) => x.id !== session.id);
      return {
        sessions: [...without, session],
        activeId: s.activeId ?? session.id,
      };
    }),

  update: (id, patch) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),

  remove: (id) =>
    set((s) => {
      const next = s.sessions.filter((x) => x.id !== id);
      const activeId =
        s.activeId === id ? next[next.length - 1]?.id ?? null : s.activeId;
      return { sessions: next, activeId };
    }),

  setActive: (id) => set({ activeId: id }),

  getActive: () => {
    const { sessions, activeId } = get();
    return sessions.find((x) => x.id === activeId) ?? null;
  },
}));
