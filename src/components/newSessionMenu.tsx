import type { DockviewApi } from "dockview-react";
import { ClaudeCode, Codex, OpenCode } from "@lobehub/icons";
import { SquareTerminal, TerminalSquare } from "lucide-react";
import { openTerminal } from "../lib/panels";
import type { MenuEntry } from "./ContextMenu";

interface NewSessionOptions {
  referenceGroup?: string;
  direction?: "right" | "left" | "above" | "below" | "within";
}

export function buildNewSessionItems(
  api: DockviewApi | null,
  opts: NewSessionOptions = {},
): MenuEntry[] {
  const base = {
    referenceGroup: opts.referenceGroup,
    direction: opts.direction ?? "within",
  };

  return [
    {
      id: "ps",
      label: "PowerShell",
      icon: <TerminalSquare size={14} />,
      onClick: () =>
        api &&
        openTerminal(api, {
          ...base,
          shellKind: "powerShell",
          label: "PowerShell",
        }),
    },
    {
      id: "cmd",
      label: "CMD",
      icon: <SquareTerminal size={14} />,
      onClick: () =>
        api &&
        openTerminal(api, { ...base, shellKind: "cmd", label: "CMD" }),
    },
    "separator",
    { header: "Coding" },
    {
      id: "claude",
      label: "Claude Code",
      icon: <ClaudeCode size={14} />,
      onClick: () =>
        api &&
        openTerminal(api, {
          ...base,
          shellKind: "powerShell",
          agentCommand: "claude",
          label: "Claude Code",
        }),
    },
    {
      id: "codex",
      label: "Codex",
      icon: <Codex size={14} />,
      onClick: () =>
        api &&
        openTerminal(api, {
          ...base,
          shellKind: "powerShell",
          agentCommand: "codex",
          label: "Codex",
        }),
    },
    {
      id: "opencode",
      label: "OpenCode",
      icon: <OpenCode size={14} />,
      onClick: () =>
        api &&
        openTerminal(api, {
          ...base,
          shellKind: "powerShell",
          agentCommand: "opencode",
          label: "OpenCode",
        }),
    },
  ];
}
