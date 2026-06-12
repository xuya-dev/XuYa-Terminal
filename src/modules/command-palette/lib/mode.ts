import type { PaletteMode } from "../types";

export type ParsedQuery = {
  mode: PaletteMode;
  term: string;
  raw: string;
};

const PREFIXES: ReadonlyArray<{ sigil: string; mode: PaletteMode }> = [
  { sigil: ">", mode: "history" },
  { sigil: "#", mode: "content" },
  { sigil: "?", mode: "help" },
];

export function parseQuery(raw: string): ParsedQuery {
  for (const { sigil, mode } of PREFIXES) {
    if (raw.startsWith(sigil)) {
      return { mode, term: raw.slice(sigil.length).trim(), raw };
    }
  }
  return { mode: "commands", term: raw.trim(), raw };
}

export const MODE_HINTS: ReadonlyArray<{ sigil: string; label: string }> = [
  { sigil: ">", label: "搜索命令历史" },
  { sigil: "#", label: "在文件中查找文本" },
];
