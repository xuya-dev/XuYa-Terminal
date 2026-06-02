import type { DockviewApi } from "dockview-react";
import { useSettingsStore } from "../stores/settingsStore";
import { useProjectStore } from "../stores/projectStore";
import type { ShellKind } from "../stores/sessionStore";
import { createAgentSessionId, rememberAgentSession } from "./agentSessions";

const SHELL_LABEL: Record<ShellKind, string> = {
  powerShell: "PowerShell",
  pwsh: "pwsh",
  cmd: "CMD",
  wsl: "WSL",
  gitBash: "Git Bash",
};

export function shellLabel(kind: ShellKind): string {
  return SHELL_LABEL[kind] ?? kind;
}

interface OpenOpts {
  shellKind?: ShellKind;
  label?: string;
  agentCommand?: string;
  /** Working directory for the new terminal session. */
  cwd?: string;
  /** Place relative to a group (split) or inside it (tab). */
  referenceGroup?: string;
  direction?: "right" | "left" | "above" | "below" | "within";
}

/**
 * Single entry point for spawning terminal panels. Defaults the shell to
 * the user's configured `defaultShell` so "new tab", "+", the sidebar
 * button and the header all stay consistent.
 */
export function openTerminal(api: DockviewApi, opts: OpenOpts = {}) {
  const defaultShell = useSettingsStore.getState().defaultShell;
  const shellKind = opts.shellKind ?? defaultShell;
  const label =
    opts.label ?? (opts.agentCommand ? opts.agentCommand : shellLabel(shellKind));
  const idPrefix = opts.agentCommand ? "agent" : "terminal";
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const id = `${idPrefix}-${suffix}`;
  const cwd = opts.cwd ?? useProjectStore.getState().getActivePath() ?? undefined;
  const agentSessionId = createAgentSessionId(opts.agentCommand);
  rememberAgentSession(id, agentSessionId);

  return api.addPanel({
    id,
    component: "terminal",
    title: label,
    params: {
      shellKind,
      label,
      agentCommand: opts.agentCommand,
      agentSessionId,
      cwd,
    },
    position: opts.referenceGroup
      ? {
          referenceGroup: opts.referenceGroup,
          direction: opts.direction ?? "within",
        }
      : undefined,
  });
}
