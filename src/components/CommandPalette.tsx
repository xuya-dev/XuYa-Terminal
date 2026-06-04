import { useEffect, useState, useCallback, useRef } from "react";
import type { DockviewApi } from "dockview-react";
import { useThemeStore } from "../stores/themeStore";
import { useUIStore } from "../stores/uiStore";
import { useModalStore } from "../stores/modalStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSessionMenuStore } from "../stores/sessionMenuStore";
import { FAMILIES } from "../themes";
import { openTerminal } from "../lib/panels";

interface CommandPaletteProps {
  api: DockviewApi | null;
}

interface Command {
  id: string;
  label: string;
  icon: string;
  category: string;
  action: () => void;
}

export default function CommandPalette({ api }: CommandPaletteProps) {
  const open = useModalStore((s) => s.paletteOpen);
  const setOpen = useModalStore((s) => s.setPaletteOpen);
  const togglePalette = useModalStore((s) => s.togglePalette);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const setFamily = useThemeStore((s) => s.setFamily);
  const toggleMode = useThemeStore((s) => s.toggleMode);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const openModal = useModalStore((s) => s.openModal);
  const zoomIn = useSettingsStore((s) => s.zoomIn);
  const zoomOut = useSettingsStore((s) => s.zoomOut);
  const resetZoom = useSettingsStore((s) => s.resetZoom);
  const sessionMenuItems = useSessionMenuStore((s) => s.items);

  const sessionCommands: Command[] = sessionMenuItems
    .filter((item) => item.visible)
    .map((item) => ({
      id: `session:${item.id}`,
      label: `打开 ${item.label}`,
      icon: item.kind === "agent" ? "◎" : "▸",
      category: item.kind === "agent" ? "Coding" : "Shell",
      action: () => {
        if (!api) return;
        openTerminal(api, {
          shellKind: item.shellKind,
          label: item.label,
          agentCommand: item.kind === "agent" ? item.agentCommand : undefined,
          launchCommand: item.kind === "shell" ? item.startupCommand : undefined,
        });
      },
    }));

  const commands: Command[] = [
    ...sessionCommands,
    // Mode toggle
    { id: "mode:toggle", label: "切换深色 / 浅色模式", icon: "◐", category: "外观", action: toggleMode },
    // Family selection
    ...FAMILIES.map((f) => ({
      id: `family:${f.id}`,
      label: `主题家族:${f.name}`,
      icon: "🎨",
      category: "外观",
      action: () => setFamily(f.id),
    })),
    // Zoom
    { id: "zoom:in", label: "放大终端字号", icon: "＋", category: "外观", action: zoomIn },
    { id: "zoom:out", label: "缩小终端字号", icon: "－", category: "外观", action: zoomOut },
    { id: "zoom:reset", label: "重置终端字号 (100%)", icon: "⊙", category: "外观", action: resetZoom },
    // UI
    { id: "ui:sidebar", label: "切换侧栏", icon: "▤", category: "界面", action: toggleSidebar },
    { id: "ui:settings", label: "打开设置", icon: "⚙", category: "界面", action: () => openModal("settings") },
    { id: "ui:about", label: "关于 XuYa", icon: "ⓘ", category: "界面", action: () => openModal("about") },
    // Layout commands
    { id: "layout:reset", label: "重置布局", icon: "↺", category: "布局", action: () => { localStorage.removeItem("xuya-layout"); location.reload(); } },
  ];

  // Filter by query.
  const filtered = query
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.category.toLowerCase().includes(query.toLowerCase()),
      )
    : commands;

  // Reset selection when query changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Keyboard shortcut: Ctrl+Shift+P.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "P") {
        e.preventDefault();
        togglePalette();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePalette, setOpen]);

  // Reset query + selection each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const executeCommand = useCallback(
    (cmd: Command) => {
      cmd.action();
      setOpen(false);
      setQuery("");
    },
    [setOpen],
  );

  if (!open) return null;

  return (
    <div className="xy-palette-overlay" onClick={() => setOpen(false)}>
      <div className="xy-palette" onClick={(e) => e.stopPropagation()}>
        <div className="xy-palette-input-area">
          <input
            ref={inputRef}
            className="xy-palette-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入命令..."
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && filtered.length > 0) {
                executeCommand(filtered[selectedIndex]);
              }
            }}
          />
        </div>

        <div className="xy-palette-list">
          {filtered.length === 0 && (
            <div className="xy-palette-empty">没有匹配的命令</div>
          )}
          {filtered.map((cmd, idx) => (
            <button
              key={cmd.id}
              ref={idx === selectedIndex ? selectedRef : undefined}
              className={`xy-palette-item ${idx === selectedIndex ? "xy-palette-item--selected" : ""}`}
              onClick={() => executeCommand(cmd)}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <span className="xy-palette-item-icon">{cmd.icon}</span>
              <span className="xy-palette-item-label">{cmd.label}</span>
              <span className="xy-palette-item-category">{cmd.category}</span>
            </button>
          ))}
        </div>

        <div className="xy-palette-footer">
          ↑↓ 移动 · ↵ 选择 · Esc 关闭
        </div>
      </div>
    </div>
  );
}
