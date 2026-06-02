import { create } from "zustand";
import {
  detectInitialMode,
  FAMILIES,
  getFamily,
  getPalette,
  type ThemeFamily,
  type ThemeMode,
  type ThemePalette,
} from "../themes";

interface ThemeStore {
  /** Currently active family id (e.g. "catppuccin"). */
  familyId: string;
  /** Current family object. */
  family: ThemeFamily;
  /** Current mode — light or dark. */
  mode: ThemeMode;
  /** Active palette = family[mode] (read-mostly convenience). */
  palette: ThemePalette;

  setFamily: (id: string) => void;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const FAMILY_KEY = "xuya-theme-family";
const MODE_KEY = "xuya-theme-mode";
const DEFAULT_FAMILY = "auroraGlacier";

/**
 * Map a palette to CSS custom properties. Called whenever family or
 * mode changes. Also bridges the chrome palette into Dockview's own
 * CSS-var namespace so the tab strip restyles in lockstep.
 */
export function applyThemeToDOM(palette: ThemePalette, mode: ThemeMode) {
  const root = document.documentElement;
  const c = palette.chrome;
  const t = palette.terminal;

  root.dataset.theme = mode;
  root.style.colorScheme = mode;

  const set = (k: string, v: string) => root.style.setProperty(k, v);

  // Terminal background.
  set("--xy-terminal-bg", t.background);

  // Surfaces.
  set("--xy-surface", c.surface);
  set("--xy-surface-sunken", c.surfaceSunken);
  set("--xy-surface-sidebar", c.surfaceSidebar);
  set("--xy-surface-tabbar", c.surfaceTabBar);
  set("--xy-surface-panel", c.surfacePanel);
  set("--xy-surface-hover", c.surfaceHover);
  set("--xy-surface-active", c.surfaceActive);

  // Text.
  set("--xy-fg", c.foreground);
  set("--xy-fg-muted", c.foregroundMuted);
  set("--xy-fg-faint", c.foregroundFaint);

  // Borders.
  set("--xy-border", c.border);
  set("--xy-border-soft", c.borderSoft);

  // Accent + status.
  set("--xy-accent", c.accent);
  set("--xy-accent-hover", c.accentHover);
  set("--xy-accent-soft", c.accentSoft);
  set("--xy-accent-soft-fg", c.accentSoftFg);
  set("--xy-success", c.success);
  set("--xy-warning", c.warning);
  set("--xy-danger", c.danger);
  set("--xy-info", c.info);

  // Shadow tuned per mode.
  set(
    "--xy-shadow",
    mode === "light"
      ? "0 8px 24px rgba(15, 17, 32, 0.08), 0 1px 2px rgba(15, 17, 32, 0.04)"
      : "0 8px 32px rgba(0, 0, 0, 0.5)",
  );
  set(
    "--xy-shadow-soft",
    mode === "light"
      ? "0 1px 2px rgba(15, 17, 32, 0.04), 0 8px 18px rgba(15, 17, 32, 0.045)"
      : "0 1px 0 rgba(255, 255, 255, 0.03), 0 14px 28px rgba(0, 0, 0, 0.26)",
  );
  set(
    "--xy-shadow-menu",
    mode === "light"
      ? "0 14px 34px rgba(15, 17, 32, 0.14), 0 2px 8px rgba(15, 17, 32, 0.08)"
      : "0 18px 44px rgba(0, 0, 0, 0.46), 0 0 0 1px rgba(255, 255, 255, 0.035)",
  );

  // Bridge to Dockview. The element may not exist at first call (theme
  // applies before React mounts) so we retry once after paint.
  const bridgeDockview = () => {
    const dv = document.querySelector<HTMLElement>(".dockview-theme-xuya");
    if (!dv) return false;
    const s = dv.style;
    s.setProperty("--dv-group-view-background-color", t.background);
    s.setProperty("--dv-tabs-and-actions-container-background-color", c.surfaceTabBar);
    s.setProperty("--dv-activegroup-visiblepanel-tab-background-color", c.surfacePanel);
    s.setProperty("--dv-activegroup-hiddenpanel-tab-background-color", c.surfaceTabBar);
    s.setProperty("--dv-inactivegroup-visiblepanel-tab-background-color", c.surfacePanel);
    s.setProperty("--dv-inactivegroup-hiddenpanel-tab-background-color", c.surfaceTabBar);
    s.setProperty("--dv-separator-border", c.border);
    s.setProperty("--dv-activegroup-visiblepanel-tab-color", c.foreground);
    s.setProperty("--dv-activegroup-hiddenpanel-tab-color", c.foregroundMuted);
    s.setProperty("--dv-inactivegroup-visiblepanel-tab-color", c.foregroundMuted);
    s.setProperty("--dv-inactivegroup-hiddenpanel-tab-color", c.foregroundMuted);
    s.setProperty("--dv-tab-divider-color", c.borderSoft);
    s.setProperty("--dv-context-menu-background-color", c.surface);
    s.setProperty("--dv-context-menu-color", c.foreground);
    s.setProperty("--dv-icon-hover-background-color", c.surfaceHover);
    return true;
  };

  if (!bridgeDockview()) requestAnimationFrame(bridgeDockview);
}

function loadInitial(): { familyId: string; mode: ThemeMode } {
  const savedFamily = localStorage.getItem(FAMILY_KEY);
  const familyId =
    savedFamily && FAMILIES.some((f) => f.id === savedFamily)
      ? savedFamily
      : DEFAULT_FAMILY;
  const savedMode = localStorage.getItem(MODE_KEY) as ThemeMode | null;
  const mode: ThemeMode =
    savedMode === "light" || savedMode === "dark" ? savedMode : detectInitialMode();
  return { familyId, mode };
}

export const useThemeStore = create<ThemeStore>((set, get) => {
  const { familyId, mode } = loadInitial();
  const family = getFamily(familyId);
  const palette = family[mode];

  // Apply on store creation so first paint already has the right colours.
  applyThemeToDOM(palette, mode);

  return {
    familyId,
    family,
    mode,
    palette,

    setFamily: (id) => {
      const family = getFamily(id);
      const { mode } = get();
      const palette = family[mode];
      localStorage.setItem(FAMILY_KEY, family.id);
      applyThemeToDOM(palette, mode);
      set({ familyId: family.id, family, palette });
    },

    setMode: (mode) => {
      const { familyId } = get();
      const palette = getPalette(familyId, mode);
      localStorage.setItem(MODE_KEY, mode);
      applyThemeToDOM(palette, mode);
      set({ mode, palette });
    },

    toggleMode: () => {
      const next: ThemeMode = get().mode === "light" ? "dark" : "light";
      get().setMode(next);
    },
  };
});
