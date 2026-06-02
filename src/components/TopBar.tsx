import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  PanelLeft,
  Settings,
  SunMedium,
  MoonStar,
  FolderOpen,
  Plus,
  X,
} from "lucide-react";
import { useThemeStore } from "../stores/themeStore";
import { useUIStore } from "../stores/uiStore";
import { useModalStore } from "../stores/modalStore";
import { useProjectStore } from "../stores/projectStore";
import { FAMILIES } from "../themes";
import WindowControls from "./WindowControls";
import { pickDirectory } from "../lib/dialog";

export default function TopBar() {
  const { family, mode, setFamily, toggleMode } = useThemeStore();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const openModal = useModalStore((s) => s.openModal);
  const projects = useProjectStore((s) => s.projects);
  const activeId = useProjectStore((s) => s.activeId);
  const addProject = useProjectStore((s) => s.addProject);
  const removeProject = useProjectStore((s) => s.removeProject);
  const setActive = useProjectStore((s) => s.setActive);

  const [projOpen, setProjOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const projRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find((p) => p.id === activeId);

  // Close dropdowns on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (projRef.current && !projRef.current.contains(e.target as Node)) {
        setProjOpen(false);
      }
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpenProject = async () => {
    setProjOpen(false);
    const path = await pickDirectory();
    if (path) addProject(path);
  };

  return (
    <div className="xy-topbar" data-tauri-drag-region>
      {/* ── Brand ── */}
      <div className="xy-brand" data-tauri-drag-region>
        <span className="xy-brand-glyph" aria-hidden>
          <img src="/logo.png" alt="" width="20" height="20" />
        </span>
        <span className="xy-brand-name">XuYa Terminal</span>
      </div>

      {/* ── Project switcher ── */}
      <div className="xy-project-picker" ref={projRef}>
        <button
          className="xy-project-trigger"
          onClick={() => setProjOpen((v) => !v)}
        >
          <FolderOpen size={14} strokeWidth={1.7} />
          <span className="xy-project-name">
            {activeProject?.name ?? "选择项目"}
          </span>
          <ChevronDown size={14} strokeWidth={1.6} />
        </button>
        {projOpen && (
          <div className="xy-project-menu">
            <button className="xy-project-menu-item xy-project-add" onClick={handleOpenProject}>
              <Plus size={14} strokeWidth={1.7} />
              <span>打开项目…</span>
            </button>
            {projects.length > 0 && <div className="xy-project-menu-sep" />}
            {projects.map((p) => (
              <div
                key={p.id}
                className={`xy-project-menu-item ${p.id === activeId ? "is-active" : ""}`}
              >
                <button
                  className="xy-project-menu-label"
                  onClick={() => {
                    setActive(p.id);
                    setProjOpen(false);
                  }}
                >
                  <FolderOpen size={13} strokeWidth={1.6} />
                  <span>{p.name}</span>
                  <span className="xy-project-menu-path">{p.path}</span>
                </button>
                <button
                  className="xy-project-menu-remove"
                  title="移除项目"
                  onClick={() => removeProject(p.id)}
                >
                  <X size={12} strokeWidth={1.7} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="xy-spacer" data-tauri-drag-region />

      {/* ── Right cluster ── */}
      <div className="xy-topbar-actions">
        <button
          className="xy-icon-btn"
          title="设置"
          onClick={() => openModal("settings")}
        >
          <Settings size={16} strokeWidth={1.6} />
        </button>
        <button
          className="xy-icon-btn"
          title="折叠/展开侧栏"
          onClick={toggleSidebar}
        >
          <PanelLeft size={16} strokeWidth={1.6} />
        </button>
        <button
          className="xy-icon-btn"
          title={mode === "light" ? "切换到深色" : "切换到浅色"}
          onClick={toggleMode}
        >
          {mode === "light" ? (
            <MoonStar size={16} strokeWidth={1.6} />
          ) : (
            <SunMedium size={16} strokeWidth={1.6} />
          )}
        </button>

        {/* Theme dropdown — quick family switch */}
        <div className="xy-theme-picker" ref={themeRef}>
          <button
            className="xy-theme-trigger"
            onClick={() => setThemeOpen((v) => !v)}
          >
            <span className="xy-avatar" aria-hidden>
              <span className="xy-avatar-dot" />
            </span>
            <span>{family.name.split(" / ")[0]}</span>
            <ChevronDown size={14} strokeWidth={1.6} />
          </button>
          {themeOpen && (
            <div className="xy-theme-menu">
              <div className="xy-theme-menu-title">主题风格</div>
              {FAMILIES.map((f) => (
                <button
                  key={f.id}
                  className={`xy-theme-menu-item ${
                    f.id === family.id ? "is-active" : ""
                  }`}
                  onClick={() => {
                    setFamily(f.id);
                    setThemeOpen(false);
                  }}
                >
                  <span
                    className="xy-theme-swatch"
                    style={{ background: f[mode].chrome.accent }}
                  />
                  <span className="xy-theme-label">{f.name.split(" / ")[0]}</span>
                  {f.id === family.id && (
                    <span className="xy-theme-check">●</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <WindowControls />
      </div>
    </div>
  );
}
