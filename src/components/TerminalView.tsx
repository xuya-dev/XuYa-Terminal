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

  const shellKind = (props.params?.shellKind ?? "powerShell") as ShellKind;
  const cwd = props.params?.cwd;
  const label =
    props.params?.label ??
    (props.params?.agentCommand
      ? agentLabel(props.params.agentCommand)
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
    fitAddon.fit();
    const fitTimer = setTimeout(() => fitAddon.fit(), 100);

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

function agentLabel(cmd: string): string {
  return (
    { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" }[cmd] ?? cmd
  );
}
