import { useEffect, useCallback, type ReactNode } from "react";
import { X } from "lucide-react";
import { useModalStore } from "../stores/modalStore";
import { useSettingsStore, type CursorStyle } from "../stores/settingsStore";
import { useThemeStore, applyThemeToDOM } from "../stores/themeStore";
import { FAMILIES } from "../themes";
import type { ShellKind } from "../stores/sessionStore";
import type { ThemeFamily } from "../themes";

const SHELL_OPTIONS: { value: ShellKind; label: string }[] = [
  { value: "powerShell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "wsl", label: "WSL" },
  { value: "gitBash", label: "Git Bash" },
];

const CURSOR_OPTIONS: { value: CursorStyle; label: string }[] = [
  { value: "bar", label: "竖线" },
  { value: "block", label: "方块" },
  { value: "underline", label: "下划线" },
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

        <Row label="终端字号" hint={`${zoom}% · ${Math.round((14 * zoom) / 100)}px`}>
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
    </ModalShell>
  );
}

function AboutModal() {
  const closeModal = useModalStore((s) => s.closeModal);
  return (
    <ModalShell title="关于 XuYa Terminal" onClose={closeModal}>
      <div className="xy-about">
        <div className="xy-about-glyph">
          <img src="/logo.png" alt="XuYa Terminal" width="48" height="48" />
        </div>
        <div className="xy-about-name">XuYa Terminal</div>
        <div className="xy-about-tag">面向 AI Agent 工程师的终端管理器</div>
        <div className="xy-about-version">版本 0.1.0 · Tauri v2 · React 19</div>
        <div className="xy-about-hint">按 Ctrl+Shift+P 打开命令面板</div>
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
