import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useEffect, useRef, useCallback } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { useThemeStore } from "../stores/themeStore";
import { useSettingsStore, zoomToFontSize } from "../stores/settingsStore";
import {
  useSessionStore,
  type ShellKind,
} from "../stores/sessionStore";

interface TerminalViewParams {
  shellKind: ShellKind;
  cwd?: string;
  agentCommand?: string;
  /** Pre-set label (used by sidebar / status bar). */
  label?: string;
}

/**
 * Registry of mounted terminals keyed by Dockview panel id. Lets the
 * header-action toolbar reach into a panel and call .clear() without
 * a heavy ref-passing dance.
 */
const REGISTRY = new Map<string, Terminal>();
const ALT_V = [27, 118];
const CTRL_V = [22];

export function clearTerminal(panelId: string): void {
  REGISTRY.get(panelId)?.clear();
}

function shellLabelFor(kind: string): string {
  return (
    {
      powerShell: "PowerShell",
      pwsh: "pwsh",
      cmd: "CMD",
      wsl: "WSL",
      gitBash: "Git Bash",
    }[kind] ?? kind
  );
}

export default function TerminalView(
  props: IDockviewPanelProps<TerminalViewParams>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const agentCommandRef = useRef<string | undefined>(props.params?.agentCommand);

  const shellKind = (props.params?.shellKind ?? "powerShell") as ShellKind;
  const cwd = props.params?.cwd;
  const agentCommand = props.params?.agentCommand;
  agentCommandRef.current = agentCommand;
  const label =
    props.params?.label ??
    (agentCommand
      ? agentLabel(agentCommand)
      : shellLabelFor(shellKind));

  const palette = useThemeStore((s) => s.palette);
  const zoom = useSettingsStore((s) => s.zoom);
  const cursorStyle = useSettingsStore((s) => s.cursorStyle);
  const cursorBlink = useSettingsStore((s) => s.cursorBlink);
  const addSession = useSessionStore((s) => s.add);
  const updateSession = useSessionStore((s) => s.update);
  const removeSession = useSessionStore((s) => s.remove);
  const setActive = useSessionStore((s) => s.setActive);

  // Mount xterm + spawn PTY once. Settings are read from the store at
  // mount; live changes are applied by the effects further down.
  useEffect(() => {
    if (!containerRef.current) return;

    const { zoom, cursorStyle, cursorBlink } = useSettingsStore.getState();

    const term = new Terminal({
      fontSize: zoomToFontSize(zoom),
      lineHeight: 1.2,
      fontFamily:
        "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      theme: palette.terminal,
      cursorBlink,
      cursorStyle,
      scrollback: 10000,
      allowProposedApi: true,
      allowTransparency: false,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
    });

    // Let the browser raise paste events for terminal text/image paste.
    term.attachCustomKeyEventHandler((e) => {
      const isAgentImagePaste =
        e.type === "keydown" &&
        agentCommandRef.current === "claude" &&
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (e.key?.toLowerCase() === "v" || e.code === "KeyV");
      if (isAgentImagePaste) {
        const sid = sessionIdRef.current;
        if (sid) {
          invoke("pty_write", { id: sid, data: ALT_V }).catch(() => {});
        }
        return false;
      }

      const isPaste =
        (e.ctrlKey && (e.key?.toLowerCase() === "v" || e.code === "KeyV")) ||
        (e.ctrlKey && e.shiftKey && (e.key?.toLowerCase() === "v" || e.code === "KeyV"));

      if (isPaste) {
        return false;
      }
      return true;
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      // Canvas fallback is automatic.
    }

    term.open(containerRef.current);
    if (containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
      fitAddon.fit();
    }
    const fitTimer = setTimeout(() => {
      if (containerRef.current && containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
        fitAddon.fit();
      }
    }, 100);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    REGISTRY.set(props.api.id, term);

    let id = "";
    let dataDisposable: { dispose: () => void } | null = null;
    let unlisten: (() => void) | null = null;

    (async () => {
      try {
        id = await invoke("pty_open", {
          spec: {
            shellKind,
            cwd: cwd ?? null,
            rows: term.rows,
            cols: term.cols,
          },
        });
      } catch (err) {
        term.writeln(`\x1b[31m[PTY Error] ${err}\x1b[0m`);
        return;
      }

      sessionIdRef.current = id;

      // Prefer an explicit label — falls back to shell / agent label.
      props.api.setTitle?.(label);

      // Register in the session store now that we have the PTY id.
      addSession({
        id: props.api.id,
        label,
        shellKind,
        agentCommand: props.params?.agentCommand,
        cwd: cwd ?? "—",
        startTime: Date.now(),
        status: "running",
      });

      const agentCmd = props.params?.agentCommand;
      let firstOutput = true;
      unlisten = await listen<{
        type: string;
        data?: number[];
        code?: number;
      }>(`pty-chunk-${id}`, (event) => {
        const p = event.payload;
        if (p.type === "Data" && p.data) {
          term.write(new Uint8Array(p.data));
          if (firstOutput && agentCmd) {
            firstOutput = false;
            setTimeout(() => {
              const encoded = Array.from(
                new TextEncoder().encode(`${agentCmd}\r\n`),
              );
              invoke("pty_write", { id, data: encoded }).catch(() => {});
            }, 800);
          }
        } else if (p.type === "Exit") {
          term.writeln(
            `\r\n\x1b[90m[Process exited${
              p.code != null ? ` code ${p.code}` : ""
            }]\x1b[0m`,
          );
          updateSession(props.api.id, {
            status: "exited",
            exitCode: p.code ?? undefined,
          });
        }
      });

      // Wire keyboard input.
      dataDisposable = term.onData((data) => {
        invoke("pty_write", {
          id,
          data: Array.from(new TextEncoder().encode(data)),
        }).catch(() => {});
      });

      term.focus();
    })();

    return () => {
      clearTimeout(fitTimer);
      dataDisposable?.dispose();
      unlisten?.();
      if (id) invoke("pty_close", { id }).catch(() => {});
      term.dispose();
      REGISTRY.delete(props.api.id);
      removeSession(props.api.id);
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-update terminal colours when family/mode changes.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = palette.terminal;
  }, [palette]);

  // Live-update font size when zoom changes, then refit + resize PTY.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitAddonRef.current;
    if (!term) return;
    term.options.fontSize = zoomToFontSize(zoom);
    fit?.fit();
    const sid = sessionIdRef.current;
    if (sid) {
      invoke("pty_resize", {
        id: sid,
        rows: term.rows,
        cols: term.cols,
      }).catch(() => {});
    }
  }, [zoom]);

  // Live-update cursor preferences.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.cursorStyle = cursorStyle;
    term.options.cursorBlink = cursorBlink;
  }, [cursorStyle, cursorBlink]);

  // Mark active when this panel becomes visible/focused.
  useEffect(() => {
    const dispose = props.api.onDidActiveChange((e) => {
      if (e.isActive) setActive(props.api.id);
    });
    if (props.api.isActive) setActive(props.api.id);
    return () => dispose.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize handler.
  const handleResize = useCallback(() => {
    const term = termRef.current;
    const fit = fitAddonRef.current;
    if (!term || !fit) return;
    const el = containerRef.current;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
    fit.fit();
    const sid = sessionIdRef.current;
    if (sid) {
      invoke("pty_resize", {
        id: sid,
        rows: term.rows,
        cols: term.cols,
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => handleResize());
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleResize]);

  // Intercept paste events to handle clipboard images and files.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const sid = sessionIdRef.current;
      if (!sid) return;

      const files = getClipboardFiles(e.clipboardData);
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const isTextOnlyAgent = agentCommand !== undefined && !isImagePasteAgent(agentCommand);

      const shouldCheckNativeImage =
        isImagePasteAgent(agentCommand) &&
        (text.length === 0 || files.some((file) => isImageFile(file)));
      const hasInterceptableFiles = files.some((file) => {
        const filePath = (file as File & { path?: string }).path;
        return Boolean(filePath) || (isImageFile(file) && !isTextOnlyAgent);
      });

      if (!shouldCheckNativeImage && !hasInterceptableFiles) return;

      e.preventDefault();
      e.stopPropagation();

      if (shouldCheckNativeImage) {
        const hasNativeImage = await invoke<boolean>("clipboard_has_image").catch(
          () => false,
        );
        if (hasNativeImage) {
          await invoke("pty_write", {
            id: sid,
            data: imagePasteSequence(agentCommand),
          });
          return;
        }
      }

      if (files.length === 0) return;

      const pathTexts: string[] = [];
      for (const file of files) {
        const filePath = (file as File & { path?: string }).path;

        if (filePath) {
          pathTexts.push(quotePath(filePath));
          continue;
        }

        if (!isImageFile(file) || isTextOnlyAgent) continue;

        try {
          const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
          const tempFilePath: string = await invoke("save_temp_image", {
            name: file.name || "clipboard_image.png",
            data: bytes,
          });
          pathTexts.push(quotePath(tempFilePath));
        } catch (err) {
          console.error("[TerminalView] Failed to save clipboard image:", err);
        }
      }

      if (pathTexts.length === 0) return;

      const encoded = Array.from(
        new TextEncoder().encode(pathTexts.join(" ")),
      );
      await invoke("pty_write", { id: sid, data: encoded });
    };

    // Use capturing phase so we intercept before xterm.js hears it
    el.addEventListener("paste", handlePaste, true);
    return () => {
      el.removeEventListener("paste", handlePaste, true);
    };
  }, [agentCommand]);

  // Ctrl + mouse-wheel zoom, scoped to this panel's container.
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const { zoomIn, zoomOut } = useSettingsStore.getState();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  }, []);

  return (
    <div
      ref={containerRef}
      className="xy-terminal-container"
      onClick={() => termRef.current?.focus()}
      onWheel={handleWheel}
    />
  );
}

function getClipboardFiles(data: DataTransfer | null): File[] {
  if (!data) return [];

  const files = Array.from(data.files ?? []);
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && !files.includes(file)) {
      files.push(file);
    }
  }

  return files;
}

function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name)
  );
}

function isImagePasteAgent(cmd: string | undefined): boolean {
  return cmd === "claude" || cmd === "codex" || cmd === "opencode";
}

function imagePasteSequence(cmd: string | undefined): number[] {
  return cmd === "claude" ? ALT_V : CTRL_V;
}

function quotePath(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`;
}

function agentLabel(cmd: string): string {
  return (
    { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" }[cmd] ?? cmd
  );
}
