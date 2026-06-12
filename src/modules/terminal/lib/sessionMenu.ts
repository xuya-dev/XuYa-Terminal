/**
 * Session menu configuration for quick-launching AI agents and shells.
 *
 * This module defines the default session presets that appear in the
 * "New Session" menu, allowing users to quickly start Claude Code,
 * Codex, Open Code, or standard shells.
 */

export type SessionPreset = {
  id: string;
  label: string;
  description: string;
  icon: string;
  command: string;
  /** Whether this is an AI agent session */
  isAgent?: boolean;
  /** Agent type for special handling */
  agentType?: "claude" | "codex" | "opencode";
};

/**
 * Default session presets available in the new-session menu.
 * These are displayed when the user clicks "+" or uses the command palette.
 */
export const SESSION_PRESETS: SessionPreset[] = [
  {
    id: "powershell",
    label: "PowerShell",
    description: "Windows PowerShell",
    icon: "terminal",
    command: "powershell.exe",
  },
  {
    id: "cmd",
    label: "CMD",
    description: "Windows 命令提示符",
    icon: "terminal",
    command: "cmd.exe",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Anthropic Claude Code AI 编程助手",
    icon: "claude",
    command: "claude",
    isAgent: true,
    agentType: "claude",
  },
  {
    id: "codex",
    label: "Codex",
    description: "OpenAI Codex CLI 编程助手",
    icon: "openai",
    command: "codex",
    isAgent: true,
    agentType: "codex",
  },
  {
    id: "opencode",
    label: "Open Code",
    description: "开源 AI 编程助手",
    icon: "sparkles",
    command: "opencode",
    isAgent: true,
    agentType: "opencode",
  },
];

/**
 * Get a session preset by its ID.
 */
export function getSessionPreset(id: string): SessionPreset | undefined {
  return SESSION_PRESETS.find((p) => p.id === id);
}

/**
 * Get all agent session presets.
 */
export function getAgentPresets(): SessionPreset[] {
  return SESSION_PRESETS.filter((p) => p.isAgent);
}

/**
 * Get all shell session presets (non-agent).
 */
export function getShellPresets(): SessionPreset[] {
  return SESSION_PRESETS.filter((p) => !p.isAgent);
}

/**
 * Check if a command is a known AI agent.
 */
export function isAgentCommand(command: string): boolean {
  const cmd = command.trim().toLowerCase();
  return cmd === "claude" || cmd === "codex" || cmd === "opencode";
}

/**
 * Get the agent type from a command string.
 */
export function getAgentType(
  command: string,
): "claude" | "codex" | "opencode" | null {
  const cmd = command.trim().toLowerCase();
  if (cmd === "claude") return "claude";
  if (cmd === "codex") return "codex";
  if (cmd === "opencode") return "opencode";
  return null;
}
