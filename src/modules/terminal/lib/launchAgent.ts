import { submitToLeaf, whenSessionReady } from "./useTerminalSession";
import { agentBareCommand, agentResumeCommand, type AgentType } from "./agentResume";
import { captureAgentSession } from "./agentSessionCapture";

export type LaunchAgentOpts = {
  /** When set, resume this exact session instead of starting fresh. */
  sessionId?: string;
  cwd?: string | null;
  /** Other sessions in the same tab (splits) to exclude when capturing. */
  excludeIds?: string[];
  /** Called when a (new) session id is discovered — on fresh launch to bind it,
   * and on resume to track a forked/branched session. */
  onSessionCaptured?: (sessionId: string) => void;
};

async function submitWhenWritable(
  leafId: number,
  command: string,
  timeoutMs = 7000,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (submitToLeaf(leafId, command)) return true;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return submitToLeaf(leafId, command);
}

/**
 * Launch (or resume) an agent inside a terminal leaf. Waits for the PTY to be
 * ready, writes the startup command, then polls for the live session id.
 *
 * Capturing runs on BOTH paths: a fresh launch binds the new id, and a resume
 * re-checks so a forked/branched session (Claude Code / Codex often start a new
 * session when resuming) is tracked. The current id is excluded, so a session
 * that simply continues stays put while a fork is picked up.
 */
export async function launchAgentInLeaf(
  leafId: number,
  agent: AgentType,
  opts: LaunchAgentOpts = {},
): Promise<void> {
  await whenSessionReady(leafId);
  const command = opts.sessionId
    ? agentResumeCommand(agent, opts.sessionId)
    : agentBareCommand(agent);
  const submitted = await submitWhenWritable(leafId, command);
  if (!submitted) {
    console.warn("[terax] agent launch command could not be submitted", leafId);
    return;
  }

  if (opts.onSessionCaptured) {
    const excludeIds = opts.sessionId
      ? [opts.sessionId, ...(opts.excludeIds ?? [])]
      : (opts.excludeIds ?? []);
    captureAgentSession(
      agent,
      opts.cwd ?? null,
      Date.now(),
      excludeIds,
      opts.onSessionCaptured,
    );
  }
}
