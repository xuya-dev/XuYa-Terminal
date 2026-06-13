import { invoke } from "@tauri-apps/api/core";
import type { AgentType } from "./agentResume";

const FIRST_DELAY_MS = 1500;
const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 24;

/**
 * Poll the backend for the agent's most-recent session file written since
 * `sinceMs`. Calls `onFound` with the session id once located, or gives up
 * silently after MAX_ATTEMPTS. Returns a cancel function.
 *
 * Agents write their session file shortly after start (e.g. Claude Code drops
 * `~/.claude/projects/<key>/<uuid>.jsonl`), so we poll until it appears. The
 * ~70s window covers first-run startup latency.
 */
export function captureAgentSession(
  agent: AgentType,
  cwd: string | null,
  sinceMs: number,
  excludeIds: string[],
  onFound: (sessionId: string) => void,
): () => void {
  let attempt = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const poll = async () => {
    if (cancelled) return;
    try {
      const id = await invoke<string | null>("find_latest_agent_session", {
        agentCommand: agent,
        cwd,
        sinceMs,
        excludeIds,
      });
      if (cancelled) return;
      if (id) {
        onFound(id);
        return;
      }
    } catch {
      /* ignore transient lookup failures — retry until the window closes */
    }
    attempt += 1;
    if (attempt >= MAX_ATTEMPTS) return;
    timer = setTimeout(poll, POLL_INTERVAL_MS);
  };

  timer = setTimeout(poll, FIRST_DELAY_MS);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
