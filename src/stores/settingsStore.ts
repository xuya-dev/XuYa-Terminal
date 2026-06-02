import { create } from "zustand";
import type { ShellKind } from "./sessionStore";

export type CursorStyle = "bar" | "block" | "underline";

interface SettingsStore {
  /** Terminal zoom as a percentage (50–200, step 10). 100% = 14px. */
  zoom: number;
  /** Shell used by "+ 新建会话" / "新建标签" / default panel. */
  defaultShell: ShellKind;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;

  setZoom: (z: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setDefaultShell: (s: ShellKind) => void;
  setCursorStyle: (s: CursorStyle) => void;
  setCursorBlink: (b: boolean) => void;
}

const BASE_FONT = 14;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

/** Map a zoom percentage to an xterm font size in px. */
export function zoomToFontSize(zoom: number): number {
  return Math.max(8, Math.round((BASE_FONT * zoom) / 100));
}

const clampZoom = (z: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z / ZOOM_STEP) * ZOOM_STEP));

function load<T>(key: string, fallback: T, parse: (raw: string) => T): T {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try {
    return parse(raw);
  } catch {
    return fallback;
  }
}

const KEYS = {
  zoom: "xuya-zoom",
  shell: "xuya-default-shell",
  cursor: "xuya-cursor-style",
  blink: "xuya-cursor-blink",
};

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  zoom: load(KEYS.zoom, 100, (r) => clampZoom(Number(r))),
  defaultShell: load(KEYS.shell, "powerShell", (r) => r as ShellKind),
  cursorStyle: load(KEYS.cursor, "bar", (r) => r as CursorStyle),
  cursorBlink: load(KEYS.blink, true, (r) => r === "true"),

  setZoom: (z) => {
    const zoom = clampZoom(z);
    localStorage.setItem(KEYS.zoom, String(zoom));
    set({ zoom });
  },
  zoomIn: () => get().setZoom(get().zoom + ZOOM_STEP),
  zoomOut: () => get().setZoom(get().zoom - ZOOM_STEP),
  resetZoom: () => get().setZoom(100),

  setDefaultShell: (s) => {
    localStorage.setItem(KEYS.shell, s);
    set({ defaultShell: s });
  },
  setCursorStyle: (s) => {
    localStorage.setItem(KEYS.cursor, s);
    set({ cursorStyle: s });
  },
  setCursorBlink: (b) => {
    localStorage.setItem(KEYS.blink, String(b));
    set({ cursorBlink: b });
  },
}));
