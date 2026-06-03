import type { DockviewApi } from "dockview-react";
import type { ReactNode } from "react";
import { ClaudeCode, Codex, OpenCode } from "@lobehub/icons";
import { SquareTerminal, TerminalSquare } from "lucide-react";
import { openTerminal } from "../lib/panels";
import type { MenuEntry } from "./ContextMenu";
import type { SessionMenuItem } from "../stores/sessionMenuStore";
import { getAgentCommandName } from "../lib/agentCommand";

interface NewSessionOptions {
  referenceGroup?: string;
  direction?: "right" | "left" | "above" | "below" | "within";
}

const AGENT_ICONS: Record<string, ReactNode> = {
  claude: <ClaudeCode size={14} />,
  codex: <Codex size={14} />,
  opencode: <OpenCode size={14} />,
};

function iconFor(item: SessionMenuItem) {
  const agentName = getAgentCommandName(item.agentCommand);
  if (item.kind === "agent" && agentName) {
    return AGENT_ICONS[agentName] ?? <TerminalSquare size={14} />;
  }
  return item.shellKind === "cmd" ? (
    <SquareTerminal size={14} />
  ) : (
    <TerminalSquare size={14} />
  );
}

export function buildNewSessionItems(
  api: DockviewApi | null,
  items: SessionMenuItem[],
  opts: NewSessionOptions = {},
): MenuEntry[] {
  const base = {
    referenceGroup: opts.referenceGroup,
    direction: opts.direction ?? "within",
  };
  const visible = items.filter((item) => item.visible);
  const shellItems = visible.filter((item) => item.kind !== "agent");
  const agentItems = visible.filter((item) => item.kind === "agent");

  const toMenuItem = (item: SessionMenuItem): MenuEntry => ({
    id: item.id,
    label: item.label,
    icon: iconFor(item),
    onClick: () =>
      api &&
      openTerminal(api, {
        ...base,
        shellKind: item.shellKind,
        label: item.label,
        agentCommand: item.kind === "agent" ? item.agentCommand : undefined,
        launchCommand: item.kind === "shell" ? item.startupCommand : undefined,
      }),
  });

  const entries: MenuEntry[] = [];
  if (shellItems.length > 0) {
    entries.push({ header: "Shell" }, ...shellItems.map(toMenuItem));
  }
  if (shellItems.length > 0 && agentItems.length > 0) {
    entries.push("separator");
  }
  if (agentItems.length > 0) {
    entries.push({ header: "Coding" }, ...agentItems.map(toMenuItem));
  }
  if (entries.length === 0) {
    entries.push({
      id: "new-session-empty",
      label: "没有可用会话菜单",
      disabled: true,
      onClick: () => {},
    });
  }
  return entries;
}
