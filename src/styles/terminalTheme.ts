import { readTerminalTokens } from "@/styles/tokens";
import type { ITheme } from "@xterm/xterm";

export type TerminalColorScheme = "light" | "dark";

export type TerminalAppearance = {
  colorScheme: TerminalColorScheme;
  foreground: string;
  background: string;
  cursor: string;
};

export function buildTerminalTheme(): ITheme {
  const t = readTerminalTokens();
  return {
    background: t.background,
    foreground: t.foreground,
    cursor: t.cursor,
    cursorAccent: t.cursorAccent,
    selectionBackground: t.selection,
    black: t.ansiBlack,
    red: t.ansiRed,
    green: t.ansiGreen,
    yellow: t.ansiYellow,
    blue: t.ansiBlue,
    magenta: t.ansiMagenta,
    cyan: t.ansiCyan,
    white: t.ansiWhite,
    brightBlack: t.ansiBrightBlack,
    brightRed: t.ansiBrightRed,
    brightGreen: t.ansiBrightGreen,
    brightYellow: t.ansiBrightYellow,
    brightBlue: t.ansiBrightBlue,
    brightMagenta: t.ansiBrightMagenta,
    brightCyan: t.ansiBrightCyan,
    brightWhite: t.ansiBrightWhite,
  };
}

export function currentTerminalAppearance(): TerminalAppearance {
  const t = readTerminalTokens();
  return {
    colorScheme: "dark",
    foreground: cssColorToHex(t.foreground, "#f6f8fa"),
    background: cssColorToHex(t.background, "#0d1117"),
    cursor: cssColorToHex(t.cursor, "#f6f8fa"),
  };
}

function cssColorToHex(value: string, fallback: string): string {
  const color = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(color);
  if (hex) {
    const raw =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : hex[1];
    return `#${raw}`;
  }

  const rgb = /^rgba?\((.+)\)$/.exec(color);
  if (!rgb) return fallback;
  const parts = rgb[1]
    .replace(/\s*\/\s*/, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3) return fallback;
  return `#${parts.slice(0, 3).map(cssChannelToHex).join("")}`;
}

function cssChannelToHex(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return "00";
  const v = value.endsWith("%") ? (n / 100) * 255 : n;
  return Math.round(Math.max(0, Math.min(255, v)))
    .toString(16)
    .padStart(2, "0");
}
