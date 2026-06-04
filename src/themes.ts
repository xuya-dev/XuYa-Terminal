/**
 * Theme system for XuYa.
 *
 * Fully redesigned from scratch with 9 production terminal color styles:
 * 1. 极光冰川 / Aurora Glacier (Arctic blue & cool gray)
 * 2. 赤焰霞光 / Crimson Sunset (Warm amber, red & coral)
 * 3. 青木幽谷 / Forest Moss (Restful earthy tones & forest greens)
 * 4. 紫黛漫步 / Lavender Mist (Romantic violet & sakura pink)
 * 5. 水墨丹青 / Ink Brush (Traditional ink wash & jade highlights)
 * 6. 钛灰晨雾 / Titanium Fog (Quiet graphite, cobalt & steel)
 * 7. 孔雀港湾 / Peacock Harbor (Deep teal, coral & marine light)
 * 8. 曜石玫瑰 / Obsidian Rose (Obsidian shell with rose signal)
 * 9. 电萤矩阵 / Volt Matrix (Technical black, lime & cyan)
 */

export type ThemeMode = "light" | "dark";

export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface ChromePalette {
  surface: string;
  surfaceSunken: string;
  surfaceSidebar: string;
  surfaceTabBar: string;
  surfacePanel: string;
  surfaceHover: string;
  surfaceActive: string;

  foreground: string;
  foregroundMuted: string;
  foregroundFaint: string;

  border: string;
  borderSoft: string;

  accent: string;
  accentHover: string;
  accentSoft: string;
  accentSoftFg: string;

  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface ThemePalette {
  terminal: TerminalPalette;
  chrome: ChromePalette;
}

export interface ThemeFamily {
  id: string;
  name: string;
  light: ThemePalette;
  dark: ThemePalette;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. 极光冰川 (Aurora Glacier)
// ────────────────────────────────────────────────────────────────────────────

const auroraGlacier: ThemeFamily = {
  id: "auroraGlacier",
  name: "极光冰川 / Aurora Glacier",
  light: {
    terminal: {
      background: "#f0f4f8",
      foreground: "#0f172a",
      cursor: "#0284c7",
      cursorAccent: "#ffffff",
      selectionBackground: "#bfdbfe80",
      black: "#1e293b",
      red: "#e11d48",
      green: "#059669",
      yellow: "#d97706",
      blue: "#0284c7",
      magenta: "#7c3aed",
      cyan: "#0891b2",
      white: "#475569",
      brightBlack: "#475569",
      brightRed: "#f43f5e",
      brightGreen: "#10b981",
      brightYellow: "#f59e0b",
      brightBlue: "#38bdf8",
      brightMagenta: "#a855f7",
      brightCyan: "#22d3ee",
      brightWhite: "#0f172a",
    },
    chrome: {
      surface: "#ffffff",
      surfaceSunken: "#e2ebf0",
      surfaceSidebar: "#eaf0f6",
      surfaceTabBar: "#e2ebf0",
      surfacePanel: "#ffffff",
      surfaceHover: "#dbeafe",
      surfaceActive: "#bfdbfe",
      foreground: "#0f172a",
      foregroundMuted: "#475569",
      foregroundFaint: "#5e6e82",
      border: "#cbd5e1",
      borderSoft: "#e2e8f0",
      accent: "#0284c7",
      accentHover: "#0369a1",
      accentSoft: "#e0f2fe",
      accentSoftFg: "#0369a1",
      success: "#10b981",
      warning: "#f59e0b",
      danger: "#ef4444",
      info: "#0284c7",
    },
  },
  dark: {
    terminal: {
      background: "#0f1422",
      foreground: "#e2e8f0",
      cursor: "#38bdf8",
      cursorAccent: "#0b0f19",
      selectionBackground: "#33467c",
      black: "#0b0f19",
      red: "#f87171",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#e2e8f0",
      brightBlack: "#475569",
      brightRed: "#fca5a5",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#ffffff",
    },
    chrome: {
      surface: "#0b0f19",
      surfaceSunken: "#080a10",
      surfaceSidebar: "#090d16",
      surfaceTabBar: "#080a10",
      surfacePanel: "#0f1422",
      surfaceHover: "#1b2438",
      surfaceActive: "#24314c",
      foreground: "#e2e8f0",
      foregroundMuted: "#94a3b8",
      foregroundFaint: "#64748b",
      border: "#1e293b",
      borderSoft: "#1b2438",
      accent: "#38bdf8",
      accentHover: "#0ea5e9",
      accentSoft: "#0c2f47",
      accentSoftFg: "#7dd3fc",
      success: "#34d399",
      warning: "#fbbf24",
      danger: "#f87171",
      info: "#38bdf8",
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 2. 赤焰霞光 (Crimson Sunset)
// ────────────────────────────────────────────────────────────────────────────

const crimsonSunset: ThemeFamily = {
  id: "crimsonSunset",
  name: "赤焰霞光 / Crimson Sunset",
  light: {
    terminal: {
      background: "#fffaf5",
      foreground: "#431407",
      cursor: "#ea580c",
      cursorAccent: "#ffffff",
      selectionBackground: "#fed7aa80",
      black: "#431407",
      red: "#dc2626",
      green: "#16a34a",
      yellow: "#ca8a04",
      blue: "#2563eb",
      magenta: "#db2777",
      cyan: "#0d9488",
      white: "#7c2d12",
      brightBlack: "#7c2d12",
      brightRed: "#ef4444",
      brightGreen: "#22c55e",
      brightYellow: "#eab308",
      brightBlue: "#3b82f6",
      brightMagenta: "#ec4899",
      brightCyan: "#14b8a6",
      brightWhite: "#3f1508",
    },
    chrome: {
      surface: "#ffffff",
      surfaceSunken: "#f8ebe0",
      surfaceSidebar: "#fdf3e7",
      surfaceTabBar: "#f8ebe0",
      surfacePanel: "#ffffff",
      surfaceHover: "#ffedd5",
      surfaceActive: "#fed7aa",
      foreground: "#431407",
      foregroundMuted: "#7c2d12",
      foregroundFaint: "#9a3412",
      border: "#edd6c4",
      borderSoft: "#f6e5d8",
      accent: "#ea580c",
      accentHover: "#c2410c",
      accentSoft: "#ffedd5",
      accentSoftFg: "#9a3412",
      success: "#16a34a",
      warning: "#d97706",
      danger: "#dc2626",
      info: "#ea580c",
    },
  },
  dark: {
    terminal: {
      background: "#1e1717",
      foreground: "#f5ecec",
      cursor: "#f97316",
      cursorAccent: "#120d0d",
      selectionBackground: "#4c1d0f80",
      black: "#120d0d",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#f472b6",
      cyan: "#2dd4bf",
      white: "#f5ecec",
      brightBlack: "#806c6c",
      brightRed: "#fca5a5",
      brightGreen: "#86efac",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#fbcfe8",
      brightCyan: "#99f6e4",
      brightWhite: "#ffffff",
    },
    chrome: {
      surface: "#181212",
      surfaceSunken: "#120d0d",
      surfaceSidebar: "#151010",
      surfaceTabBar: "#120d0d",
      surfacePanel: "#1e1717",
      surfaceHover: "#2c2020",
      surfaceActive: "#3b2a2a",
      foreground: "#f5ecec",
      foregroundMuted: "#cabaaa",
      foregroundFaint: "#968080",
      border: "#2c2020",
      borderSoft: "#1e1717",
      accent: "#f97316",
      accentHover: "#ea580c",
      accentSoft: "#4c1d0f",
      accentSoftFg: "#ffedd5",
      success: "#4ade80",
      warning: "#fbbf24",
      danger: "#f87171",
      info: "#f97316",
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 3. 青木幽谷 (Forest Moss)
// ────────────────────────────────────────────────────────────────────────────

const forestMoss: ThemeFamily = {
  id: "forestMoss",
  name: "青木幽谷 / Forest Moss",
  light: {
    terminal: {
      background: "#f4f8f5",
      foreground: "#062c1c",
      cursor: "#059669",
      cursorAccent: "#ffffff",
      selectionBackground: "#a3cfbb80",
      black: "#062c1c",
      red: "#be123c",
      green: "#047857",
      yellow: "#b45309",
      blue: "#1d4ed8",
      magenta: "#6d28d9",
      cyan: "#0f766e",
      white: "#355e3b",
      brightBlack: "#14532d",
      brightRed: "#e11d48",
      brightGreen: "#059669",
      brightYellow: "#d97706",
      brightBlue: "#2563eb",
      brightMagenta: "#8b5cf6",
      brightCyan: "#0d9488",
      brightWhite: "#0f2c1b",
    },
    chrome: {
      surface: "#ffffff",
      surfaceSunken: "#e5eedf",
      surfaceSidebar: "#ecf3e8",
      surfaceTabBar: "#e5eedf",
      surfacePanel: "#ffffff",
      surfaceHover: "#d1e7dd",
      surfaceActive: "#a3cfbb",
      foreground: "#062c1c",
      foregroundMuted: "#14532d",
      foregroundFaint: "#355e3b",
      border: "#c7dcd0",
      borderSoft: "#e1ece6",
      accent: "#059669",
      accentHover: "#047857",
      accentSoft: "#d1fae5",
      accentSoftFg: "#065f46",
      success: "#059669",
      warning: "#d97706",
      danger: "#be123c",
      info: "#059669",
    },
  },
  dark: {
    terminal: {
      background: "#141a16",
      foreground: "#ecf2ee",
      cursor: "#10b981",
      cursorAccent: "#0a0d0b",
      selectionBackground: "#2d3e3380",
      black: "#0a0d0b",
      red: "#f87171",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#2dd4bf",
      white: "#ecf2ee",
      brightBlack: "#627568",
      brightRed: "#fca5a5",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#99f6e4",
      brightWhite: "#ffffff",
    },
    chrome: {
      surface: "#0f1411",
      surfaceSunken: "#0a0d0b",
      surfaceSidebar: "#0c100e",
      surfaceTabBar: "#0a0d0b",
      surfacePanel: "#141a16",
      surfaceHover: "#202c25",
      surfaceActive: "#2d3e33",
      foreground: "#ecf2ee",
      foregroundMuted: "#a3b8aa",
      foregroundFaint: "#7a9081",
      border: "#202c25",
      borderSoft: "#141a16",
      accent: "#10b981",
      accentHover: "#059669",
      accentSoft: "#064e3b",
      accentSoftFg: "#d1fae5",
      success: "#34d399",
      warning: "#fbbf24",
      danger: "#f87171",
      info: "#10b981",
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 4. 紫黛漫步 (Lavender Mist)
// ────────────────────────────────────────────────────────────────────────────

const lavenderMist: ThemeFamily = {
  id: "lavenderMist",
  name: "紫黛漫步 / Lavender Mist",
  light: {
    terminal: {
      background: "#faf7fd",
      foreground: "#3b0764",
      cursor: "#8b5cf6",
      cursorAccent: "#ffffff",
      selectionBackground: "#e9d5ff80",
      black: "#3b0764",
      red: "#b91c1c",
      green: "#047857",
      yellow: "#a21caf",
      blue: "#4338ca",
      magenta: "#701a75",
      cyan: "#0369a1",
      white: "#5b21b6",
      brightBlack: "#6b21a8",
      brightRed: "#ef4444",
      brightGreen: "#10b981",
      brightYellow: "#d946ef",
      brightBlue: "#6366f1",
      brightMagenta: "#d946ef",
      brightCyan: "#0ea5e9",
      brightWhite: "#3b0764",
    },
    chrome: {
      surface: "#ffffff",
      surfaceSunken: "#ece5f6",
      surfaceSidebar: "#f4eefa",
      surfaceTabBar: "#ece5f6",
      surfacePanel: "#ffffff",
      surfaceHover: "#f3e8ff",
      surfaceActive: "#e9d5ff",
      foreground: "#3b0764",
      foregroundMuted: "#6b21a8",
      foregroundFaint: "#7c3aed",
      border: "#e1d4f2",
      borderSoft: "#f1ebfa",
      accent: "#8b5cf6",
      accentHover: "#7c3aed",
      accentSoft: "#f3e8ff",
      accentSoftFg: "#5b21b6",
      success: "#10b981",
      warning: "#d946ef",
      danger: "#b91c1c",
      info: "#8b5cf6",
    },
  },
  dark: {
    terminal: {
      background: "#181324",
      foreground: "#f1ebfa",
      cursor: "#a855f7",
      cursorAccent: "#0b0911",
      selectionBackground: "#34274e80",
      black: "#0b0911",
      red: "#f87171",
      green: "#34d399",
      yellow: "#fb7185",
      blue: "#818cf8",
      magenta: "#f472b6",
      cyan: "#38bdf8",
      white: "#f1ebfa",
      brightBlack: "#73658a",
      brightRed: "#fca5a5",
      brightGreen: "#6ee7b7",
      brightYellow: "#fda4af",
      brightBlue: "#a5b4fc",
      brightMagenta: "#fbcfe8",
      brightCyan: "#7dd3fc",
      brightWhite: "#ffffff",
    },
    chrome: {
      surface: "#120e1a",
      surfaceSunken: "#0b0911",
      surfaceSidebar: "#0f0c16",
      surfaceTabBar: "#0b0911",
      surfacePanel: "#181324",
      surfaceHover: "#251c38",
      surfaceActive: "#34274e",
      foreground: "#f1ebfa",
      foregroundMuted: "#bdaecf",
      foregroundFaint: "#8c7ba8",
      border: "#2d2242",
      borderSoft: "#181324",
      accent: "#a855f7",
      accentHover: "#9333ea",
      accentSoft: "#3b0764",
      accentSoftFg: "#f3e8ff",
      success: "#34d399",
      warning: "#f472b6",
      danger: "#f87171",
      info: "#a855f7",
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 5. 水墨丹青 (Ink Brush)
// ────────────────────────────────────────────────────────────────────────────

const inkBrush: ThemeFamily = {
  id: "inkBrush",
  name: "水墨丹青 / Ink Brush",
  light: {
    terminal: {
      background: "#fcfaf2",
      foreground: "#1a1a1a",
      cursor: "#0f766e",
      cursorAccent: "#ffffff",
      selectionBackground: "#ddd5c480",
      black: "#1a1a1a",
      red: "#991b1b",
      green: "#115e59",
      yellow: "#854d0e",
      blue: "#1e3a8a",
      magenta: "#581c87",
      cyan: "#134e4a",
      white: "#404040",
      brightBlack: "#404040",
      brightRed: "#ef4444",
      brightGreen: "#0f766e",
      brightYellow: "#ca8a04",
      brightBlue: "#2563eb",
      brightMagenta: "#7c3aed",
      brightCyan: "#0d9488",
      brightWhite: "#1a1a1a",
    },
    chrome: {
      surface: "#ffffff",
      surfaceSunken: "#f2ece0",
      surfaceSidebar: "#f7f4eb",
      surfaceTabBar: "#f2ece0",
      surfacePanel: "#ffffff",
      surfaceHover: "#ebe5d8",
      surfaceActive: "#ddd5c4",
      foreground: "#1a1a1a",
      foregroundMuted: "#5c5c5c",
      foregroundFaint: "#666666",
      border: "#dcd4c5",
      borderSoft: "#ebe5d8",
      accent: "#0f766e",
      accentHover: "#0d5c56",
      accentSoft: "#ccfbf1",
      accentSoftFg: "#115e59",
      success: "#115e59",
      warning: "#d97706",
      danger: "#991b1b",
      info: "#0f766e",
    },
  },
  dark: {
    terminal: {
      background: "#1e1e1e",
      foreground: "#e5e5e5",
      cursor: "#10b981",
      cursorAccent: "#121212",
      selectionBackground: "#38383880",
      black: "#121212",
      red: "#f87171",
      green: "#34d399",
      yellow: "#eab308",
      blue: "#60a5fa",
      magenta: "#a78bfa",
      cyan: "#2dd4bf",
      white: "#e5e5e5",
      brightBlack: "#525252",
      brightRed: "#fca5a5",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#c4b5fd",
      brightCyan: "#99f6e4",
      brightWhite: "#ffffff",
    },
    chrome: {
      surface: "#181818",
      surfaceSunken: "#121212",
      surfaceSidebar: "#151515",
      surfaceTabBar: "#121212",
      surfacePanel: "#1e1e1e",
      surfaceHover: "#2a2a2a",
      surfaceActive: "#383838",
      foreground: "#e5e5e5",
      foregroundMuted: "#a3a3a3",
      foregroundFaint: "#808080",
      border: "#2c2c2c",
      borderSoft: "#1e1e1e",
      accent: "#10b981",
      accentHover: "#059669",
      accentSoft: "#0f2d24",
      accentSoftFg: "#a7f3d0",
      success: "#34d399",
      warning: "#fbbf24",
      danger: "#f87171",
      info: "#10b981",
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 6. 钛灰晨雾 (Titanium Fog)
// ────────────────────────────────────────────────────────────────────────────

const titaniumFog: ThemeFamily = {
  id: "titaniumFog",
  name: "钛灰晨雾 / Titanium Fog",
  light: {
    terminal: {
      background: "#f6f8fb",
      foreground: "#171a21",
      cursor: "#2563eb",
      cursorAccent: "#ffffff",
      selectionBackground: "#c7d7f280",
      black: "#171a21",
      red: "#c2414b",
      green: "#0f766e",
      yellow: "#a16207",
      blue: "#2563eb",
      magenta: "#7c3aed",
      cyan: "#0891b2",
      white: "#4b5563",
      brightBlack: "#4b5563",
      brightRed: "#ef4444",
      brightGreen: "#14b8a6",
      brightYellow: "#d97706",
      brightBlue: "#3b82f6",
      brightMagenta: "#8b5cf6",
      brightCyan: "#06b6d4",
      brightWhite: "#111827",
    },
    chrome: {
      surface: "#ffffff",
      surfaceSunken: "#e9edf3",
      surfaceSidebar: "#eef2f6",
      surfaceTabBar: "#e9edf3",
      surfacePanel: "#ffffff",
      surfaceHover: "#dfe7f3",
      surfaceActive: "#c7d7f2",
      foreground: "#171a21",
      foregroundMuted: "#4b5563",
      foregroundFaint: "#9aa3af",
      border: "#cfd7e3",
      borderSoft: "#e4e9f0",
      accent: "#2563eb",
      accentHover: "#1d4ed8",
      accentSoft: "#dbeafe",
      accentSoftFg: "#1e40af",
      success: "#0f766e",
      warning: "#d97706",
      danger: "#c2414b",
      info: "#2563eb",
    },
  },
  dark: {
    terminal: {
      background: "#111318",
      foreground: "#e8ecf2",
      cursor: "#7aa2ff",
      cursorAccent: "#0b0d11",
      selectionBackground: "#2d3a5380",
      black: "#0b0d11",
      red: "#fb7185",
      green: "#4ade80",
      yellow: "#facc15",
      blue: "#7aa2ff",
      magenta: "#c084fc",
      cyan: "#38bdf8",
      white: "#e8ecf2",
      brightBlack: "#687384",
      brightRed: "#fda4af",
      brightGreen: "#86efac",
      brightYellow: "#fde047",
      brightBlue: "#a5b4fc",
      brightMagenta: "#d8b4fe",
      brightCyan: "#7dd3fc",
      brightWhite: "#ffffff",
    },
    chrome: {
      surface: "#0e1015",
      surfaceSunken: "#0b0d11",
      surfaceSidebar: "#0c0f14",
      surfaceTabBar: "#0b0d11",
      surfacePanel: "#111318",
      surfaceHover: "#1d2430",
      surfaceActive: "#2d3a53",
      foreground: "#e8ecf2",
      foregroundMuted: "#a9b2c1",
      foregroundFaint: "#687384",
      border: "#242b37",
      borderSoft: "#171b22",
      accent: "#7aa2ff",
      accentHover: "#60a5fa",
      accentSoft: "#172d57",
      accentSoftFg: "#dbeafe",
      success: "#4ade80",
      warning: "#facc15",
      danger: "#fb7185",
      info: "#7aa2ff",
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 7. 孔雀港湾 (Peacock Harbor)
// ────────────────────────────────────────────────────────────────────────────

const peacockHarbor: ThemeFamily = {
  id: "peacockHarbor",
  name: "孔雀港湾 / Peacock Harbor",
  light: {
    terminal: {
      background: "#f2fbfa",
      foreground: "#062b31",
      cursor: "#0d9488",
      cursorAccent: "#ffffff",
      selectionBackground: "#99f6e480",
      black: "#062b31",
      red: "#e11d48",
      green: "#047857",
      yellow: "#b7791f",
      blue: "#2563eb",
      magenta: "#be185d",
      cyan: "#0891b2",
      white: "#2b4e54",
      brightBlack: "#335b62",
      brightRed: "#fb7185",
      brightGreen: "#10b981",
      brightYellow: "#f59e0b",
      brightBlue: "#38bdf8",
      brightMagenta: "#f472b6",
      brightCyan: "#2dd4bf",
      brightWhite: "#062b31",
    },
    chrome: {
      surface: "#ffffff",
      surfaceSunken: "#dcefed",
      surfaceSidebar: "#e9f6f4",
      surfaceTabBar: "#dcefed",
      surfacePanel: "#ffffff",
      surfaceHover: "#ccfbf1",
      surfaceActive: "#99f6e4",
      foreground: "#062b31",
      foregroundMuted: "#335b62",
      foregroundFaint: "#4d6c70",
      border: "#bddbd8",
      borderSoft: "#e2f0ee",
      accent: "#0d9488",
      accentHover: "#0f766e",
      accentSoft: "#ccfbf1",
      accentSoftFg: "#115e59",
      success: "#10b981",
      warning: "#f59e0b",
      danger: "#e11d48",
      info: "#0891b2",
    },
  },
  dark: {
    terminal: {
      background: "#071a1d",
      foreground: "#e5fbf8",
      cursor: "#2dd4bf",
      cursorAccent: "#031013",
      selectionBackground: "#164e5380",
      black: "#031013",
      red: "#fb7185",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#f472b6",
      cyan: "#22d3ee",
      white: "#e5fbf8",
      brightBlack: "#5d7f84",
      brightRed: "#fda4af",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#fbcfe8",
      brightCyan: "#67e8f9",
      brightWhite: "#ffffff",
    },
    chrome: {
      surface: "#061316",
      surfaceSunken: "#031013",
      surfaceSidebar: "#041114",
      surfaceTabBar: "#031013",
      surfacePanel: "#071a1d",
      surfaceHover: "#123036",
      surfaceActive: "#164e53",
      foreground: "#e5fbf8",
      foregroundMuted: "#9cc9c7",
      foregroundFaint: "#799fa5",
      border: "#123036",
      borderSoft: "#0b2226",
      accent: "#2dd4bf",
      accentHover: "#14b8a6",
      accentSoft: "#134e4a",
      accentSoftFg: "#ccfbf1",
      success: "#34d399",
      warning: "#fbbf24",
      danger: "#fb7185",
      info: "#22d3ee",
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 8. 曜石玫瑰 (Obsidian Rose)
// ────────────────────────────────────────────────────────────────────────────

const obsidianRose: ThemeFamily = {
  id: "obsidianRose",
  name: "曜石玫瑰 / Obsidian Rose",
  light: {
    terminal: {
      background: "#fff7f9",
      foreground: "#3f111d",
      cursor: "#e11d48",
      cursorAccent: "#ffffff",
      selectionBackground: "#fecdd380",
      black: "#3f111d",
      red: "#e11d48",
      green: "#047857",
      yellow: "#a16207",
      blue: "#2563eb",
      magenta: "#be185d",
      cyan: "#0891b2",
      white: "#7f3548",
      brightBlack: "#7f3548",
      brightRed: "#f43f5e",
      brightGreen: "#10b981",
      brightYellow: "#eab308",
      brightBlue: "#3b82f6",
      brightMagenta: "#ec4899",
      brightCyan: "#06b6d4",
      brightWhite: "#3f111d",
    },
    chrome: {
      surface: "#ffffff",
      surfaceSunken: "#f6e7eb",
      surfaceSidebar: "#fcedf1",
      surfaceTabBar: "#f6e7eb",
      surfacePanel: "#ffffff",
      surfaceHover: "#ffe4e6",
      surfaceActive: "#fecdd3",
      foreground: "#3f111d",
      foregroundMuted: "#7f3548",
      foregroundFaint: "#8c5362",
      border: "#e6c9d1",
      borderSoft: "#f5e4e8",
      accent: "#e11d48",
      accentHover: "#be123c",
      accentSoft: "#ffe4e6",
      accentSoftFg: "#9f1239",
      success: "#047857",
      warning: "#d97706",
      danger: "#e11d48",
      info: "#0891b2",
    },
  },
  dark: {
    terminal: {
      background: "#171014",
      foreground: "#f7e8ee",
      cursor: "#fb7185",
      cursorAccent: "#0d080b",
      selectionBackground: "#4a182880",
      black: "#0d080b",
      red: "#fb7185",
      green: "#86efac",
      yellow: "#facc15",
      blue: "#60a5fa",
      magenta: "#f472b6",
      cyan: "#22d3ee",
      white: "#f7e8ee",
      brightBlack: "#765865",
      brightRed: "#fda4af",
      brightGreen: "#bbf7d0",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#fbcfe8",
      brightCyan: "#67e8f9",
      brightWhite: "#ffffff",
    },
    chrome: {
      surface: "#120c10",
      surfaceSunken: "#0d080b",
      surfaceSidebar: "#100a0e",
      surfaceTabBar: "#0d080b",
      surfacePanel: "#171014",
      surfaceHover: "#281923",
      surfaceActive: "#4a1828",
      foreground: "#f7e8ee",
      foregroundMuted: "#d7b8c4",
      foregroundFaint: "#9b7a89",
      border: "#2b1a23",
      borderSoft: "#1b1217",
      accent: "#fb7185",
      accentHover: "#f43f5e",
      accentSoft: "#4a1828",
      accentSoftFg: "#ffe4e6",
      success: "#86efac",
      warning: "#facc15",
      danger: "#fb7185",
      info: "#22d3ee",
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 9. 电萤矩阵 (Volt Matrix)
// ────────────────────────────────────────────────────────────────────────────

const voltMatrix: ThemeFamily = {
  id: "voltMatrix",
  name: "电萤矩阵 / Volt Matrix",
  light: {
    terminal: {
      background: "#f8fbf2",
      foreground: "#142107",
      cursor: "#65a30d",
      cursorAccent: "#ffffff",
      selectionBackground: "#d9f99d80",
      black: "#142107",
      red: "#dc2626",
      green: "#4d7c0f",
      yellow: "#ca8a04",
      blue: "#2563eb",
      magenta: "#7e22ce",
      cyan: "#0891b2",
      white: "#3f6212",
      brightBlack: "#3f6212",
      brightRed: "#ef4444",
      brightGreen: "#84cc16",
      brightYellow: "#eab308",
      brightBlue: "#3b82f6",
      brightMagenta: "#a855f7",
      brightCyan: "#06b6d4",
      brightWhite: "#142107",
    },
    chrome: {
      surface: "#ffffff",
      surfaceSunken: "#ecf3df",
      surfaceSidebar: "#f2f8e9",
      surfaceTabBar: "#ecf3df",
      surfacePanel: "#ffffff",
      surfaceHover: "#e6f6c6",
      surfaceActive: "#d9f99d",
      foreground: "#142107",
      foregroundMuted: "#3f6212",
      foregroundFaint: "#5f7047",
      border: "#d1dfbb",
      borderSoft: "#edf4e1",
      accent: "#65a30d",
      accentHover: "#4d7c0f",
      accentSoft: "#ecfccb",
      accentSoftFg: "#365314",
      success: "#65a30d",
      warning: "#ca8a04",
      danger: "#dc2626",
      info: "#0891b2",
    },
  },
  dark: {
    terminal: {
      background: "#0b0f08",
      foreground: "#e9fbd0",
      cursor: "#a3e635",
      cursorAccent: "#050704",
      selectionBackground: "#2f4f1180",
      black: "#050704",
      red: "#f87171",
      green: "#a3e635",
      yellow: "#facc15",
      blue: "#60a5fa",
      magenta: "#d946ef",
      cyan: "#22d3ee",
      white: "#e9fbd0",
      brightBlack: "#68804d",
      brightRed: "#fca5a5",
      brightGreen: "#bef264",
      brightYellow: "#fde047",
      brightBlue: "#93c5fd",
      brightMagenta: "#f0abfc",
      brightCyan: "#67e8f9",
      brightWhite: "#ffffff",
    },
    chrome: {
      surface: "#080c06",
      surfaceSunken: "#050704",
      surfaceSidebar: "#070a05",
      surfaceTabBar: "#050704",
      surfacePanel: "#0b0f08",
      surfaceHover: "#18220e",
      surfaceActive: "#2f4f11",
      foreground: "#e9fbd0",
      foregroundMuted: "#bcd79a",
      foregroundFaint: "#89a567",
      border: "#1f2b15",
      borderSoft: "#10170b",
      accent: "#a3e635",
      accentHover: "#84cc16",
      accentSoft: "#2f4f11",
      accentSoftFg: "#ecfccb",
      success: "#a3e635",
      warning: "#facc15",
      danger: "#f87171",
      info: "#22d3ee",
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Registry + helpers
// ────────────────────────────────────────────────────────────────────────────

export const FAMILIES: ThemeFamily[] = [
  auroraGlacier,
  crimsonSunset,
  forestMoss,
  lavenderMist,
  inkBrush,
  titaniumFog,
  peacockHarbor,
  obsidianRose,
  voltMatrix,
];

export function getFamily(id: string): ThemeFamily {
  return FAMILIES.find((f) => f.id === id) ?? FAMILIES[0];
}

export function getPalette(familyId: string, mode: ThemeMode): ThemePalette {
  return getFamily(familyId)[mode];
}

/** Detect the OS preference once on boot. */
export function detectInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}
