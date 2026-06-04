const AGENT_NAME_ALIASES: Record<string, string> = {
  "codex.cmd": "codex",
  "codex.exe": "codex",
  "opencode.cmd": "opencode",
  "opencode.exe": "opencode",
  "claude.cmd": "claude",
  "claude.exe": "claude",
};

export interface ParsedAgentCommand {
  raw: string;
  token: string;
  args: string;
  name: string;
}

export function parseAgentCommand(command: string | undefined): ParsedAgentCommand | null {
  const raw = command?.trim();
  if (!raw) return null;

  const first = readFirstToken(raw);
  if (!first) return null;
  const token = first.token;
  const args = raw.slice(first.end).trim();
  const name = normalizeAgentName(token);

  return { raw, token, args, name };
}

export function getAgentCommandName(command: string | undefined): string | undefined {
  return parseAgentCommand(command)?.name;
}

export function agentDisplayName(command: string): string {
  const parsed = parseAgentCommand(command);
  const name = parsed?.name ?? command;
  return { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" }[name] ?? command;
}

function readFirstToken(value: string): { token: string; end: number } | null {
  const quote = value[0];
  if (quote === `"` || quote === `'`) {
    let token = "";
    for (let i = 1; i < value.length; i += 1) {
      const char = value[i];
      if (char === quote) return { token, end: i + 1 };
      token += char;
    }
    return { token, end: value.length };
  }

  const match = value.match(/^\S+/);
  if (!match) return null;
  return { token: match[0], end: match[0].length };
}

function normalizeAgentName(token: string): string {
  const normalizedPath = token.replace(/\\/g, "/");
  const base = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1).toLowerCase();
  return AGENT_NAME_ALIASES[base] ?? base;
}
