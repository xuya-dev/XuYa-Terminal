import type { DockviewApi } from "dockview-react";
import { ClaudeCode, Codex, OpenCode } from "@lobehub/icons";
import {
  Plus,
  Settings,
  Palette,
  HelpCircle,
  TerminalSquare,
  SquareTerminal,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";
import { useSessionStore, type SessionMeta } from "../stores/sessionStore";
import { useUIStore } from "../stores/uiStore";
import { useModalStore } from "../stores/modalStore";
import ContextMenu from "./ContextMenu";
import { buildNewSessionItems } from "./newSessionMenu";

interface Props {
  api: DockviewApi | null;
}

/** Map a session to the icon shown at the left of its row. */
function sessionIcon(s: SessionMeta) {
  if (s.agentCommand === "claude")
    return <ClaudeCode size={20} />;
  if (s.agentCommand === "codex") return <Codex size={20} />;
  if (s.agentCommand === "opencode") return <OpenCode size={20} />;
  switch (s.shellKind) {
    case "cmd":
      return <SquareTerminal size={18} />;
    case "wsl":
      return <TerminalSquare size={18} />;
    case "powerShell":
    case "pwsh":
    default:
      return <TerminalSquare size={18} />;
  }
}

function statusColor(status: SessionMeta["status"]) {
  if (status === "running") return "var(--xy-success)";
  if (status === "exited") return "var(--xy-danger)";
  return "var(--xy-warning)";
}

export default function Sidebar({ api }: Props) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const openModal = useModalStore((s) => s.openModal);
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);

  const focusPanel = (id: string) => {
    api?.getPanel(id)?.focus();
  };

  const newSessionItems = buildNewSessionItems(api);

  /** Open new-session dropdown at the button position. */
  const openNewMenu = (e: React.MouseEvent<HTMLElement>) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setNewMenu({ x: r.left, y: r.bottom + 4 });
  };

  if (collapsed) {
    return (
      <aside className="xy-sidebar xy-sidebar--collapsed">
        <button
          className="xy-sidebar-rail-btn"
          onClick={openNewMenu}
          title="新建会话"
        >
          <Plus size={18} strokeWidth={1.8} />
        </button>
        <div className="xy-sidebar-rail-divider" />
        <div className="xy-sidebar-rail-list">
          {sessions.map((s) => {
            const isActive = s.id === activeId;
            return (
              <button
                key={s.id}
                className={`xy-sidebar-rail-item ${
                  isActive ? "is-active" : ""
                }`}
                onClick={() => focusPanel(s.id)}
                title={`${s.label} · ${s.cwd}`}
              >
                {sessionIcon(s)}
                <span
                  className="xy-status-dot"
                  style={{ background: statusColor(s.status) }}
                />
              </button>
            );
          })}
        </div>

        {newMenu && (
          <ContextMenu
            x={newMenu.x}
            y={newMenu.y}
            items={newSessionItems}
            onClose={() => setNewMenu(null)}
          />
        )}
      </aside>
    );
  }

  return (
    <aside className="xy-sidebar">
      <div className="xy-sidebar-header">
        <span className="xy-sidebar-title">会话管理</span>
      </div>

      <div className="xy-sidebar-actions">
        <button className="xy-sidebar-new-btn" onClick={openNewMenu}>
          <Plus size={16} strokeWidth={1.8} />
          <span>新建会话</span>
          <ChevronDown size={13} strokeWidth={1.6} className="xy-sidebar-new-chevron" />
        </button>
      </div>

      {newMenu && (
        <ContextMenu
          x={newMenu.x}
          y={newMenu.y}
          items={newSessionItems}
          onClose={() => setNewMenu(null)}
        />
      )}

      <div className="xy-sidebar-list">
        {sessions.length === 0 && (
          <div className="xy-sidebar-empty">尚未打开会话</div>
        )}
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              className={`xy-sidebar-item ${isActive ? "is-active" : ""}`}
              onClick={() => focusPanel(s.id)}
            >
              <span className="xy-sidebar-item-icon">{sessionIcon(s)}</span>
              <span className="xy-sidebar-item-text">
                <span className="xy-sidebar-item-name">{s.label}</span>
                <span className="xy-sidebar-item-sub">{s.cwd}</span>
              </span>
              <span
                className="xy-status-dot"
                style={{ background: statusColor(s.status) }}
              />
            </button>
          );
        })}
      </div>

      <div className="xy-sidebar-footer">
        <button
          className="xy-sidebar-foot-btn"
          title="设置"
          onClick={() => openModal("settings")}
        >
          <Settings size={14} strokeWidth={1.6} />
          <span>设置</span>
        </button>
        <button
          className="xy-sidebar-foot-btn"
          title="主题"
          onClick={() => openModal("theme")}
        >
          <Palette size={14} strokeWidth={1.6} />
          <span>主题</span>
        </button>
        <button
          className="xy-sidebar-foot-btn"
          title="帮助"
          onClick={() => openModal("about")}
        >
          <HelpCircle size={14} strokeWidth={1.6} />
          <span>帮助</span>
        </button>
      </div>
    </aside>
  );
}
