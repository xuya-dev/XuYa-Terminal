import { quoteShellArg } from "@/lib/shellQuote";

export type AgentType = "claude" | "codex" | "opencode";

/** Bare invocation used to start a brand-new agent session. */
export function agentBareCommand(agent: AgentType): string {
  return agent;
}

/**
 * Resume command for reopening an agent tab. With a captured session id the
 * exact conversation is restored; without one we fall back to the agent's
 * own "resume most recent" behavior.
 *
 * Flags verified against current CLIs: `claude --resume <id>` / `--continue`,
 * `codex resume <id>` / `resume --last`, `opencode --session <id>` / `--continue`.
 */
export function agentResumeCommand(
  agent: AgentType,
  sessionId?: string,
): string {
  const id = sessionId ? quoteShellArg(sessionId) : "";
  switch (agent) {
    case "claude":
      return sessionId ? `claude --resume ${id}` : "claude --continue";
    case "codex":
      return sessionId ? `codex resume ${id}` : "codex resume --last";
    case "opencode":
      return sessionId ? `opencode --session ${id}` : "opencode --continue";
  }
}
