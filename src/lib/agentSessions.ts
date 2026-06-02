const AGENT_SESSION_KEY = "xuya-agent-sessions";

type AgentSessionMap = Record<string, string>;

function readAgentSessions(): AgentSessionMap {
  try {
    const raw = localStorage.getItem(AGENT_SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as AgentSessionMap)
      : {};
  } catch {
    return {};
  }
}

function writeAgentSessions(sessions: AgentSessionMap): void {
  try {
    localStorage.setItem(AGENT_SESSION_KEY, JSON.stringify(sessions));
  } catch {
    /* ignore */
  }
}

export function getStoredAgentSessionId(panelId: string): string | undefined {
  return readAgentSessions()[panelId];
}

export function rememberAgentSession(
  panelId: string,
  sessionId: string | undefined,
): void {
  if (!sessionId) return;
  writeAgentSessions({ ...readAgentSessions(), [panelId]: sessionId });
}

export function forgetAgentSession(panelId: string): void {
  const sessions = readAgentSessions();
  if (!(panelId in sessions)) return;
  delete sessions[panelId];
  writeAgentSessions(sessions);
}

export function createAgentSessionId(agentCommand: string | undefined): string | undefined {
  if (agentCommand !== "claude") return undefined;
  return globalThis.crypto?.randomUUID?.();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function prepareAgentPanelsForRestore(value: unknown): void {
  const sessions = readAgentSessions();
  visitLayout(value, sessions);
}

function visitLayout(value: unknown, sessions: AgentSessionMap): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitLayout(item, sessions));
    return;
  }

  if (!isRecord(value)) return;

  if (isRecord(value.params) && typeof value.params.agentCommand === "string") {
    value.params.resumeOnRestore = true;
    if (typeof value.id === "string") {
      const sessionId = sessions[value.id];
      if (sessionId) {
        value.params.agentSessionId = sessionId;
      }
    }
  }

  Object.values(value).forEach((item) => visitLayout(item, sessions));
}
