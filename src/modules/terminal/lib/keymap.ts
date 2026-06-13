export type TerminalKeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "key" | "code"
>;

export type PlatformOpts = { isMac: boolean };

export function terminalWordNavigationSequence(event: TerminalKeyEvent): string | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowLeft" || event.code === "ArrowLeft") return "\x1bb";
  if (event.key === "ArrowRight" || event.code === "ArrowRight") return "\x1bf";
  return null;
}

/** Cmd+Left/Right → readline line-start (Ctrl+A) / line-end (Ctrl+E).
 * macOS-only — Cmd doesn't exist as a navigation modifier elsewhere. */
export function terminalLineNavigationSequence(
  event: TerminalKeyEvent,
  opts: PlatformOpts,
): string | null {
  if (!opts.isMac) return null;
  if (!event.metaKey || event.altKey || event.ctrlKey) return null;
  if (event.key === "ArrowLeft" || event.code === "ArrowLeft") return "\x01";
  if (event.key === "ArrowRight" || event.code === "ArrowRight") return "\x05";
  return null;
}

/** Modifier+Backspace deletion:
 *   macOS  Cmd+Backspace    → Ctrl+U (kill-to-line-start)
 *   macOS  Option+Backspace → Ctrl+W (kill-word-backward)
 *   Other  Ctrl+Backspace   → Ctrl+W (kill-word-backward)
 */
export function terminalDeleteSequence(
  event: TerminalKeyEvent,
  opts: PlatformOpts,
): string | null {
  if (event.key !== "Backspace" && event.code !== "Backspace") return null;
  if (opts.isMac) {
    if (event.metaKey && !event.altKey && !event.ctrlKey) return "\x15";
    if (event.altKey && !event.metaKey && !event.ctrlKey) return "\x17";
    return null;
  }
  if (event.ctrlKey && !event.altKey && !event.metaKey) return "\x17";
  return null;
}

export function isTerminalCopyShortcut(
  event: TerminalKeyEvent,
  opts: PlatformOpts,
): boolean {
  const isCopyKey = event.code === "KeyC" || event.key === "c" || event.key === "C";
  if (!isCopyKey || event.altKey) return false;
  if (opts.isMac) return event.metaKey && !event.ctrlKey && !event.shiftKey;
  return !!event.ctrlKey && !!event.shiftKey && !event.metaKey;
}

export function isTerminalPasteShortcut(
  event: TerminalKeyEvent,
  opts: PlatformOpts,
): boolean {
  const isPasteKey = event.code === "KeyV" || event.key === "v" || event.key === "V";
  if (!isPasteKey || event.altKey) return false;
  if (opts.isMac) return event.metaKey && !event.ctrlKey && !event.shiftKey;
  return !!event.ctrlKey && !!event.shiftKey && !event.metaKey;
}
