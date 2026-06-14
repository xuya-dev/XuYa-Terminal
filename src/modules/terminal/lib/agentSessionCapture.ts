import { invoke } from "@tauri-apps/api/core";
import type { AgentType } from "./agentResume";

const FIRST_DELAY_MS = 1500;
const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 24;

// Session ids already owned by a leaf — either bound (restored / resumed) or
// just captured by an in-flight poll. Every capture excludes these so two
// agents started in the SAME cwd can't both latch onto the most-recent session
// file. Without it, both terminals captured the latest id and, on reopen, both
// resumed the same conversation. Claims persist for the app's lifetime: a
// closed agent's session must not be re-grabbed by a freshly launched one.
const claimedSessions = new Set<string>();

/**
 * Mark a session id as owned by a leaf so concurrent/later captures skip it.
 * Called on resume/restore (the id is already this leaf's) and internally when
 * a fresh capture succeeds.
 */
export function claimAgentSession(id: string | null | undefined): void {
  if (id) claimedSessions.add(id);
}

/**
 * Poll the backend for the agent's most-recent session file written since
 * `sinceMs` that isn't already owned by another leaf. Calls `onFound` with the
 * session id once located, or gives up silently after MAX_ATTEMPTS. Returns a
 * cancel function.
 *
 * Agents write their session file shortly after start (e.g. Claude Code drops
 * `~/.claude/projects/<key>/<uuid>.jsonl`), so we poll until it appears. The
 * ~70s window covers first-run startup latency. The claimed-session registry
 * binds each leaf to its OWN session even when several run in the same cwd.
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
      // Re-read the claim set every poll: sibling captures (and resumes) keep
      // adding to it while we wait.
      const exclude = [...new Set([...excludeIds, ...claimedSessions])];
      const id = await invoke<string | null>("find_latest_agent_session", {
        agentCommand: agent,
        cwd,
        sinceMs,
        excludeIds: exclude,
      });
      if (cancelled) return;
      // Re-check the registry: a sibling capture may have claimed this id
      // between our request and this resolution. If so, fall through and retry
      // — the next poll excludes it and finds the next-newest session instead.
      if (id && !claimedSessions.has(id)) {
        claimedSessions.add(id);
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
