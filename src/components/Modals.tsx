import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useEffect, useCallback, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  RotateCcw,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useModalStore } from "../stores/modalStore";
import { useSettingsStore, type CursorStyle } from "../stores/settingsStore";
import {
  useSessionMenuStore,
  type SessionMenuItem,
} from "../stores/sessionMenuStore";
import { useThemeStore, applyThemeToDOM } from "../stores/themeStore";
import { FAMILIES } from "../themes";
import type { ShellKind } from "../stores/sessionStore";
import type { ThemeFamily } from "../themes";

const SHELL_OPTIONS: { value: ShellKind; label: string }[] = [
  { value: "powerShell", label: "PowerShell" },
  { value: "pwsh", label: "PowerShell 7" },
  { value: "cmd", label: "CMD" },
  { value: "wsl", label: "WSL" },
  { value: "gitBash", label: "Git Bash" },
];

const CURSOR_OPTIONS: { value: CursorStyle; label: string }[] = [
  { value: "bar", label: "竖线" },
  { value: "block", label: "方块" },
  { value: "underline", label: "下划线" },
];

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "none"
  | "error";

interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

type SettingsTab = "appearance" | "terminal" | "sessions";

const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: "appearance", label: "外观" },
  { value: "terminal", label: "终端" },
  { value: "sessions", label: "会话菜单" },
];

/** Shared centered-modal shell with overlay + Esc-to-close. */
function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="xy-modal-overlay" onClick={onClose}>
      <div
        className="xy-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="xy-modal-head">
          <span className="xy-modal-title">{title}</span>
          <button className="xy-icon-btn" onClick={onClose} title="关闭">
            <X size={16} strokeWidth={1.7} />
          </button>
        </div>
        <div className="xy-modal-body">{children}</div>
        {footer && <div className="xy-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** A labelled settings row: title + optional hint on the left, control on the right. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="xy-set-row">
      <div className="xy-set-row-text">
        <span className="xy-set-row-label">{label}</span>
        {hint && <span className="xy-set-row-hint">{hint}</span>}
      </div>
      <div className="xy-set-row-control">{children}</div>
    </div>
  );
}

/** Segmented control — a row of mutually-exclusive pills. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="xy-segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={`xy-seg-item ${o.value === value ? "is-active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────── */
/*  Theme modal with live preview              */
/* ──────────────────────────────────────────── */

function ThemeModal() {
  const closeModal = useModalStore((s) => s.closeModal);
  const { family, mode, setFamily, setMode, palette } = useThemeStore();

  /** Re-apply the committed theme when the modal closes / unmounts. */
  const reapplyCommitted = useCallback(() => {
    applyThemeToDOM(palette, mode);
  }, [palette, mode]);

  useEffect(() => () => reapplyCommitted(), [reapplyCommitted]);

  const handlePreview = (f: ThemeFamily) => {
    applyThemeToDOM(f[mode], mode);
  };

  const handleLeave = () => {
    applyThemeToDOM(palette, mode);
  };

  const handleSelect = (id: string) => {
    setFamily(id);
  };

  return (
    <ModalShell title="主题与外观" onClose={closeModal}>
      <section className="xy-set-section">
        <Row label="显示模式">
          <Segmented
            value={mode}
            options={[
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ]}
            onChange={setMode}
          />
        </Row>
      </section>

      <section className="xy-set-section">
        <h3 className="xy-set-section-title">主题风格</h3>
        <p className="xy-set-section-hint">悬停卡片实时预览，点击应用</p>
        <div className="xy-family-grid">
          {FAMILIES.map((f) => {
            const isActive = f.id === family.id;
            const p = f[mode];
            return (
              <button
                key={f.id}
                className={`xy-family-card ${isActive ? "is-active" : ""}`}
                onMouseEnter={() => handlePreview(f)}
                onMouseLeave={handleLeave}
                onClick={() => handleSelect(f.id)}
              >
                <span className="xy-family-card-name">{f.name.split(" / ")[0]}</span>
                <div className="xy-family-card-colors">
                  <span className="xy-family-dot" style={{ background: p.chrome.accent }} />
                  <span className="xy-family-dot" style={{ background: p.chrome.success }} />
                  <span className="xy-family-dot" style={{ background: p.chrome.warning }} />
                  <span className="xy-family-dot" style={{ background: p.chrome.danger }} />
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </ModalShell>
  );
}

/* ──────────────────────────────────────────── */
/*  Settings modal (trimmed)                   */
/* ──────────────────────────────────────────── */

function SettingsModal() {
  const closeModal = useModalStore((s) => s.closeModal);
  const openModal = useModalStore((s) => s.openModal);
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
  const {
    zoom,
    defaultShell,
    cursorStyle,
    cursorBlink,
    setZoom,
    zoomIn,
    zoomOut,
    setDefaultShell,
    setCursorStyle,
    setCursorBlink,
  } = useSettingsStore();

  return (
    <ModalShell title="设置" onClose={closeModal}>
      <div className="xy-settings-tabs" role="tablist" aria-label="设置分类">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.value}
            className={`xy-settings-tab ${
              activeTab === tab.value ? "is-active" : ""
            }`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="xy-settings-panel" role="tabpanel">
        {activeTab === "appearance" && (
          <section className="xy-set-section">
            <h3 className="xy-set-section-title">外观</h3>

            <Row label="主题与外观" hint="配色家族、浅色/深色切换">
              <button
                className="xy-set-link-btn"
                onClick={() => openModal("theme")}
              >
                打开主题设置 →
              </button>
            </Row>

            <Row
              label="终端字号"
              hint={`${zoom}% · ${Math.round((14 * zoom) / 100)}px`}
            >
              <div className="xy-zoom-control">
                <button className="xy-zoom-btn" onClick={zoomOut} title="缩小">
                  －
                </button>
                <input
                  className="xy-zoom-slider"
                  type="range"
                  min={50}
                  max={200}
                  step={10}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
                <button className="xy-zoom-btn" onClick={zoomIn} title="放大">
                  ＋
                </button>
              </div>
            </Row>
          </section>
        )}

        {activeTab === "terminal" && (
          <section className="xy-set-section">
            <h3 className="xy-set-section-title">终端</h3>

            <Row label="默认 Shell" hint="新建会话 / 新建标签使用">
              <Segmented
                value={defaultShell}
                options={SHELL_OPTIONS}
                onChange={setDefaultShell}
              />
            </Row>

            <Row label="光标样式">
              <Segmented
                value={cursorStyle}
                options={CURSOR_OPTIONS}
                onChange={setCursorStyle}
              />
            </Row>

            <Row label="光标闪烁">
              <button
                className={`xy-switch ${cursorBlink ? "is-on" : ""}`}
                role="switch"
                aria-checked={cursorBlink}
                onClick={() => setCursorBlink(!cursorBlink)}
              >
                <span className="xy-switch-knob" />
              </button>
            </Row>
          </section>
        )}

        {activeTab === "sessions" && <SessionMenuSettings />}
      </div>
    </ModalShell>
  );
}

function AutoUpdatePanel() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [message, setMessage] = useState("从 GitHub Releases 获取最新版本");
  const [progress, setProgress] = useState<number | null>(null);

  const busy = status === "checking" || status === "downloading";

  const statusIcon =
    status === "error" ? (
      <AlertCircle size={15} strokeWidth={1.8} />
    ) : status === "ready" || status === "none" ? (
      <CheckCircle2 size={15} strokeWidth={1.8} />
    ) : busy ? (
      <Loader2 className="xy-spin" size={15} strokeWidth={1.8} />
    ) : (
      <RefreshCw size={15} strokeWidth={1.8} />
    );

  const handleCheck = async () => {
    setStatus("checking");
    setUpdateInfo(null);
    setProgress(null);
    setMessage("正在检查 GitHub Releases...");

    try {
      const update = await check();

      if (!update) {
        setStatus("none");
        setMessage("当前已是最新版本");
        return;
      }

      setStatus("available");
      setUpdateInfo({
        version: update.version,
        date: update.date,
        body: update.body,
      });
      setMessage(`发现新版本 ${update.version}`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "检查更新失败");
    }
  };

  const handleInstall = async () => {
    setStatus("downloading");
    setProgress(0);
    setMessage("正在下载安装包...");

    try {
      const update = await check();

      if (!update) {
        setStatus("none");
        setProgress(null);
        setMessage("当前已是最新版本");
        return;
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          downloaded = 0;
          setProgress(0);
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setProgress(Math.round((downloaded / contentLength) * 100));
          }
        }

        if (event.event === "Finished") {
          setProgress(100);
        }
      });

      setStatus("ready");
      setMessage("更新已安装，正在重启应用...");
      await relaunch();
    } catch (error) {
      setStatus("error");
      setProgress(null);
      setMessage(error instanceof Error ? error.message : "安装更新失败");
    }
  };

  return (
    <section className="xy-about-section">
      <h3 className="xy-set-section-title">自动更新</h3>

      <div className="xy-update-card xy-update-card--about" data-status={status}>
        <div className="xy-update-status">
          <span className="xy-update-status-icon">{statusIcon}</span>
          <div className="xy-update-copy">
            <span className="xy-update-title">自动更新</span>
            <span className="xy-update-message">{message}</span>
            {updateInfo && (
              <span className="xy-update-meta">
                {updateInfo.date ? `${updateInfo.date} · ` : ""}
                版本 {updateInfo.version}
              </span>
            )}
          </div>
        </div>

        {typeof progress === "number" && (
          <div className="xy-update-progress" aria-label={`下载进度 ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
        )}

        {updateInfo?.body && (
          <div className="xy-update-notes">{updateInfo.body}</div>
        )}

        <div className="xy-update-actions">
          <button
            className="xy-mini-btn"
            type="button"
            disabled={busy}
            onClick={handleCheck}
          >
            <RefreshCw size={13} strokeWidth={1.8} />
            检查更新
          </button>
          <button
            className="xy-mini-btn xy-mini-btn--accent"
            type="button"
            disabled={status !== "available"}
            onClick={handleInstall}
          >
            <Download size={13} strokeWidth={1.8} />
            安装并重启
          </button>
        </div>
      </div>
    </section>
  );
}

function SessionMenuSettings() {
  const items = useSessionMenuStore((s) => s.items);
  const addItem = useSessionMenuStore((s) => s.addItem);
  const updateItem = useSessionMenuStore((s) => s.updateItem);
  const removeItem = useSessionMenuStore((s) => s.removeItem);
  const moveItem = useSessionMenuStore((s) => s.moveItem);
  const resetItems = useSessionMenuStore((s) => s.resetItems);
  const shellItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "shell");
  const codingItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "agent");

  return (
    <section className="xy-set-section">
      <div className="xy-set-section-head">
        <div>
          <h3 className="xy-set-section-title">会话菜单</h3>
          <p className="xy-set-section-hint">
            控制新建会话菜单的显示、排序和启动命令
          </p>
        </div>
        <div className="xy-session-menu-actions">
          <button
            className="xy-mini-btn"
            type="button"
            title="添加 Shell 会话"
            onClick={() =>
              addItem({
                label: "新 Shell",
                kind: "shell",
                shellKind: "powerShell",
              })
            }
          >
            <Plus size={13} strokeWidth={1.8} />
            Shell
          </button>
          <button
            className="xy-mini-btn"
            type="button"
            title="添加 Coding 会话"
            onClick={() =>
              addItem({
                label: "新 Coding",
                kind: "agent",
                shellKind: "powerShell",
                agentCommand: "codex --yolo",
              })
            }
          >
            <Plus size={13} strokeWidth={1.8} />
            Coding
          </button>
          <button
            className="xy-mini-btn"
            type="button"
            title="恢复默认菜单"
            onClick={resetItems}
          >
            <RotateCcw size={13} strokeWidth={1.8} />
            默认
          </button>
        </div>
      </div>

      <div className="xy-session-menu-list">
        <SessionMenuGroup
          title="Shell"
          entries={shellItems}
          updateItem={updateItem}
          removeItem={removeItem}
          moveItem={moveItem}
        />
        <SessionMenuGroup
          title="Coding"
          entries={codingItems}
          updateItem={updateItem}
          removeItem={removeItem}
          moveItem={moveItem}
        />
      </div>
    </section>
  );
}

function SessionMenuGroup({
  title,
  entries,
  updateItem,
  removeItem,
  moveItem,
}: {
  title: string;
  entries: Array<{ item: SessionMenuItem; index: number }>;
  updateItem: (id: string, patch: Partial<SessionMenuItem>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, direction: "up" | "down") => void;
}) {
  return (
    <div className="xy-session-menu-group">
      <div className="xy-session-menu-group-title">{title}</div>
      {entries.length === 0 ? (
        <div className="xy-session-menu-empty">暂无菜单项</div>
      ) : (
        entries.map(({ item }, groupIndex) => (
          <SessionMenuEditor
            key={item.id}
            item={item}
            groupIndex={groupIndex}
            groupCount={entries.length}
            updateItem={updateItem}
            removeItem={removeItem}
            moveItem={moveItem}
          />
        ))
      )}
    </div>
  );
}

function SessionMenuEditor({
  item,
  groupIndex,
  groupCount,
  updateItem,
  removeItem,
  moveItem,
}: {
  item: SessionMenuItem;
  groupIndex: number;
  groupCount: number;
  updateItem: (id: string, patch: Partial<SessionMenuItem>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, direction: "up" | "down") => void;
}) {
  return (
    <div className={`xy-session-menu-card ${!item.visible ? "is-muted" : ""}`}>
      <div className="xy-session-menu-card-main">
        <label className="xy-field">
          <span>名称</span>
          <input
            value={item.label}
            onChange={(e) => updateItem(item.id, { label: e.target.value })}
          />
        </label>

        <label className="xy-field">
          <span>Shell</span>
          <select
            value={item.shellKind}
            onChange={(e) =>
              updateItem(item.id, { shellKind: e.target.value as ShellKind })
            }
          >
            {SHELL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {item.kind === "agent" ? (
          <label className="xy-field xy-field--wide">
            <span>启动命令</span>
            <input
              value={item.agentCommand ?? ""}
              placeholder="claude / codex --yolo / opencode"
              onChange={(e) =>
                updateItem(item.id, { agentCommand: e.target.value })
              }
            />
          </label>
        ) : (
          <label className="xy-field xy-field--wide">
            <span>启动命令</span>
            <input
              value={item.startupCommand ?? ""}
              placeholder="例如: cmd /k /t:0a"
              onChange={(e) =>
                updateItem(item.id, { startupCommand: e.target.value })
              }
            />
          </label>
        )}
      </div>

      <div className="xy-session-menu-card-tools">
        <button
          className={`xy-switch xy-switch--small ${item.visible ? "is-on" : ""}`}
          role="switch"
          aria-checked={item.visible}
          title={item.visible ? "隐藏" : "显示"}
          onClick={() => updateItem(item.id, { visible: !item.visible })}
        >
          <span className="xy-switch-knob" />
        </button>
        <button
          className="xy-icon-btn"
          title="上移"
          disabled={groupIndex === 0}
          onClick={() => moveItem(item.id, "up")}
        >
          <ArrowUp size={14} strokeWidth={1.8} />
        </button>
        <button
          className="xy-icon-btn"
          title="下移"
          disabled={groupIndex === groupCount - 1}
          onClick={() => moveItem(item.id, "down")}
        >
          <ArrowDown size={14} strokeWidth={1.8} />
        </button>
        <button
          className="xy-icon-btn is-danger"
          title="删除"
          onClick={() => removeItem(item.id)}
        >
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

function AboutModal() {
  const closeModal = useModalStore((s) => s.closeModal);
  return (
    <ModalShell title="关于 XuYa Terminal" onClose={closeModal}>
      <div className="xy-about-layout">
        <div className="xy-about">
          <div className="xy-about-glyph">
            <img src="/logo.png" alt="XuYa Terminal" width="48" height="48" />
          </div>
          <div className="xy-about-name">XuYa Terminal</div>
          <div className="xy-about-tag">面向 AI Agent 工程师的终端管理器</div>
          <div className="xy-about-version">版本 0.1.1 · Tauri v2 · React 19</div>
          <div className="xy-about-hint">按 Ctrl+Shift+P 打开命令面板</div>
        </div>

        <AutoUpdatePanel />
      </div>
    </ModalShell>
  );
}

/** Single mount point — renders whichever modal is active. */
export default function Modals() {
  const modal = useModalStore((s) => s.modal);
  if (modal === "settings") return <SettingsModal />;
  if (modal === "about") return <AboutModal />;
  if (modal === "theme") return <ThemeModal />;
  return null;
}
