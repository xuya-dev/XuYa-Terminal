import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useEffect, useRef, useCallback, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { useThemeStore } from "../stores/themeStore";
import { useSettingsStore, zoomToFontSize } from "../stores/settingsStore";
import {
  useSessionStore,
  type ShellKind,
} from "../stores/sessionStore";
import {
  claimAgentSession,
  getExcludedAgentSessionIds,
  getStoredAgentSessionId,
  rememberAgentSession,
} from "../lib/agentSessions";
import {
  agentDisplayName,
  getAgentCommandName,
  parseAgentCommand,
} from "../lib/agentCommand";
import ContextMenu, { type MenuEntry } from "./ContextMenu";

interface TerminalViewParams {
  shellKind: ShellKind;
  cwd?: string;
  agentCommand?: string;
  agentSessionId?: string;
  launchCommand?: string;
  startupCommand?: string;
  resumeOnRestore?: boolean;
  /** Pre-set label (used by sidebar / status bar). */
  label?: string;
}

type AgentLaunchState = "idle" | "starting" | "ready" | "failed";

/**
 * Registry of mounted terminals keyed by Dockview panel id. Lets the
 * header-action toolbar reach into a panel and call .clear() without
 * a heavy ref-passing dance.
 */
const REGISTRY = new Map<string, Terminal>();
const ALT_V = [27, 118];
const CTRL_V = [22];
const LAYOUT_KEY = "xuya-layout";
const TERMINAL_INITIAL_FIT_FRAMES = 2;
const TERMINAL_RESIZE_SETTLE_MS = 80;
let agentSessionLookupQueue: Promise<void> = Promise.resolve();

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
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const agentCommandRef = useRef<string | undefined>(props.params?.agentCommand);
  const terminalOpenRef = useRef(false);
  const lastTerminalSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const outputCursorRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputCursorHiddenRef = useRef(false);
  const codexCursorVisibleUntilRef = useRef(0);

  const shellKind = (props.params?.shellKind ?? "powerShell") as ShellKind;
  const cwd = props.params?.cwd;
  const agentCommand = props.params?.agentCommand;
  agentCommandRef.current = agentCommand;
  const label =
    props.params?.label ??
    (agentCommand
      ? agentLabel(agentCommand)
      : shellLabelFor(shellKind));
  const [agentLaunchState, setAgentLaunchState] =
    useState<AgentLaunchState>(agentCommand ? "starting" : "idle");
  const [agentLaunchMessage, setAgentLaunchMessage] = useState(
    agentCommand ? `正在启动 ${label}` : "",
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const palette = useThemeStore((s) => s.palette);
  const zoom = useSettingsStore((s) => s.zoom);
  const cursorStyle = useSettingsStore((s) => s.cursorStyle);
  const cursorBlink = useSettingsStore((s) => s.cursorBlink);
  const addSession = useSessionStore((s) => s.add);
  const updateSession = useSessionStore((s) => s.update);
  const removeSession = useSessionStore((s) => s.remove);
  const setActive = useSessionStore((s) => s.setActive);

  const hideCodexCursor = useCallback((force = false) => {
    const term = termRef.current;
    if (!term || agentCommandRef.current !== "codex") return;
    if (!force && Date.now() < codexCursorVisibleUntilRef.current) return;

    if (outputCursorRestoreTimerRef.current) {
      clearTimeout(outputCursorRestoreTimerRef.current);
      outputCursorRestoreTimerRef.current = null;
    }

    codexCursorVisibleUntilRef.current = 0;
    if (outputCursorHiddenRef.current) return;

    outputCursorHiddenRef.current = true;
    const terminalPalette = useThemeStore.getState().palette.terminal;
    term.options.cursorBlink = false;
    term.options.theme = {
      ...terminalPalette,
      cursor: "transparent",
      cursorAccent: "transparent",
    };
  }, []);

  const showCodexInputCursorBriefly = useCallback(() => {
    const term = termRef.current;
    if (!term || agentCommandRef.current !== "codex") return;

    if (outputCursorRestoreTimerRef.current) {
      clearTimeout(outputCursorRestoreTimerRef.current);
      outputCursorRestoreTimerRef.current = null;
    }

    codexCursorVisibleUntilRef.current = Date.now() + 1200;
    outputCursorHiddenRef.current = false;
    term.options.theme = useThemeStore.getState().palette.terminal;
    term.options.cursorBlink = useSettingsStore.getState().cursorBlink;

    outputCursorRestoreTimerRef.current = setTimeout(() => {
      outputCursorRestoreTimerRef.current = null;
      hideCodexCursor(true);
    }, 1200);
  }, [hideCodexCursor]);

  const resizePtyIfNeeded = useCallback((term: Terminal) => {
    const size = { rows: term.rows, cols: term.cols };
    const last = lastTerminalSizeRef.current;
    if (last && last.rows === size.rows && last.cols === size.cols) return;

    lastTerminalSizeRef.current = size;
    const sid = sessionIdRef.current;
    if (!sid) return;

    invoke("pty_resize", {
      id: sid,
      rows: size.rows,
      cols: size.cols,
    }).catch(() => {});
  }, []);

  const restoreActiveTerminal = useCallback(
    (
      opts: { focus?: boolean; scrollToBottom?: boolean } = {},
    ) => {
      const { focus = false, scrollToBottom = true } = opts;
      const term = termRef.current;
      const fit = fitAddonRef.current;
      if (!term || !terminalOpenRef.current) return;

      const fitted = fitTerminal(
        term,
        fit,
        terminalHostRef.current,
        terminalOpenRef.current,
      );
      if (scrollToBottom) {
        term.scrollToBottom();
        syncViewportScrollToBottom(terminalHostRef.current);
      }
      if (focus) term.focus();

      if (fitted) {
        resizePtyIfNeeded(term);
      }

      if (scrollToBottom) {
        requestAnimationFrame(() => {
          term.scrollToBottom();
          syncViewportScrollToBottom(terminalHostRef.current);
        });
      }
    },
    [resizePtyIfNeeded],
  );

  // Mount xterm + spawn PTY once. Settings are read from the store at
  // mount; live changes are applied by the effects further down.
  useEffect(() => {
    if (!containerRef.current || !terminalHostRef.current) return;

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
      minimumContrastRatio: 4.5,
    });

    // Let the browser raise paste events for terminal text/image paste.
    term.attachCustomKeyEventHandler((e) => {
      const isAgentImagePaste =
        e.type === "keydown" &&
        getAgentCommandName(agentCommandRef.current) === "claude" &&
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

      const isCopy =
        e.type === "keydown" &&
        ((e.ctrlKey && (e.key?.toLowerCase() === "c" || e.code === "KeyC")) ||
         (e.ctrlKey && e.shiftKey && (e.key?.toLowerCase() === "c" || e.code === "KeyC")) ||
         (e.metaKey && (e.key?.toLowerCase() === "c" || e.code === "KeyC")));

      if (isCopy) {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {});
          return false;
        }
        return true;
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
    termRef.current = term;
    fitAddonRef.current = fitAddon;
    REGISTRY.set(props.api.id, term);

    let id = "";
    let dataDisposable: { dispose: () => void } | null = null;
    let unlisten: (() => void) | null = null;
    let sessionLookupTimer: ReturnType<typeof setTimeout> | null = null;
    let layoutPersistTimer: ReturnType<typeof setTimeout> | null = null;
    let agentReadyTimer: ReturnType<typeof setTimeout> | null = null;
    let agentSlowTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let isOpen = false;
    let agentLaunchSettled = !props.params?.agentCommand;
    let agentStartupOutput = "";
    const agentOutputDecoder = new TextDecoder();
    let openObserver: ResizeObserver | null = null;
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    const openWaiters: Array<() => void> = [];
    const ptyId = createPtyId();

    const resolveOpenWaiters = (): void => {
      while (openWaiters.length > 0) {
        openWaiters.shift()?.();
      }
    };

    const waitForTerminalOpen = async (): Promise<void> => {
      if (!isOpen) {
        await new Promise<void>((resolve) => openWaiters.push(resolve));
      }

      for (let i = 0; i < TERMINAL_INITIAL_FIT_FRAMES && !disposed; i += 1) {
        await nextAnimationFrame();
        safeFit(false);
      }
    };

    const safeFit = (resizePty = false): boolean => {
      const fitted = fitTerminal(
        term,
        fitAddon,
        terminalHostRef.current,
        isOpen && !disposed,
      );
      if (!fitted || !resizePty) return fitted;
      resizePtyIfNeeded(term);
      return true;
    };

    const markAgentReady = (): void => {
      if (disposed || agentLaunchSettled) return;
      agentLaunchSettled = true;
      if (agentReadyTimer) clearTimeout(agentReadyTimer);
      if (agentSlowTimer) clearTimeout(agentSlowTimer);
      setAgentLaunchState("ready");
      setAgentLaunchMessage("");
    };

    const markAgentFailed = (message: string): void => {
      if (disposed || agentLaunchSettled) return;
      agentLaunchSettled = true;
      if (agentReadyTimer) clearTimeout(agentReadyTimer);
      if (agentSlowTimer) clearTimeout(agentSlowTimer);
      setAgentLaunchState("failed");
      setAgentLaunchMessage(message);
    };

    const scheduleAgentReady = (): void => {
      if (agentLaunchSettled || agentReadyTimer) return;
      agentReadyTimer = setTimeout(() => {
        agentReadyTimer = null;
        if (hasAgentStartupError(agentStartupOutput)) {
          markAgentFailed(`${label} 启动失败`);
          return;
        }
        markAgentReady();
      }, 1500);
    };

    const tryOpenTerminal = (): void => {
      if (disposed || isOpen) return;
      const el = terminalHostRef.current;
      if (!hasRenderableSize(el)) return;

      try {
        term.open(el);
        isOpen = true;
        terminalOpenRef.current = true;
        safeFit();
        hideCodexCursor(true);
        resolveOpenWaiters();
      } catch {
        // xterm can fail while Dockview is still settling panel dimensions.
      }
    };

    openObserver = new ResizeObserver(() => {
      tryOpenTerminal();
      if (isOpen) {
        openObserver?.disconnect();
        openObserver = null;
        safeFit(true);
      }
    });
    openObserver.observe(terminalHostRef.current);
    tryOpenTerminal();
    openTimer = setTimeout(tryOpenTerminal, 100);
    if (props.params?.agentCommand) {
      agentSlowTimer = setTimeout(() => {
        if (!disposed && !agentLaunchSettled) {
          setAgentLaunchMessage(`${label} 启动时间较长，仍在等待输出`);
        }
      }, 12000);
    }

    const lookupAgentSession = async (
      agentCmd: string,
      sinceMs: number,
    ): Promise<string | undefined> => {
      const agentSessionId = await queueAgentSessionLookup(async () => {
        const agentName = getAgentCommandName(agentCmd);
        if (!agentName) return null;
        const nextAgentSessionId = await invoke<string | null>(
          "find_latest_agent_session",
          {
            agentCommand: agentName,
            cwd: cwd ?? null,
            sinceMs,
            excludeIds: getExcludedAgentSessionIds(props.api.id),
          },
        );
        if (nextAgentSessionId) {
          claimAgentSession(props.api.id, nextAgentSessionId);
        }

        return nextAgentSessionId;
      });

      return agentSessionId ?? undefined;
    };

    const rememberPanelAgentSession = (
      sessionId: string | undefined,
      persistLayout = true,
    ): void => {
      if (!sessionId) return;
      rememberAgentSession(props.api.id, sessionId);
      if (props.api.getParameters<TerminalViewParams>().agentSessionId !== sessionId) {
        props.api.updateParameters({ agentSessionId: sessionId });
      }
      if (persistLayout) {
        if (layoutPersistTimer) clearTimeout(layoutPersistTimer);
        layoutPersistTimer = setTimeout(() => {
          persistLayoutSnapshot(props.containerApi);
        }, 1200);
      }
    };

    const scheduleAgentSessionLookup = (
      agentCmd: string,
      sinceMs: number,
      attempt = 0,
      onFound?: (sessionId: string) => void,
    ) => {
      if (disposed || attempt >= 24) return;

      sessionLookupTimer = setTimeout(async () => {
        if (disposed) return;

        try {
          const agentSessionId = await lookupAgentSession(
            agentCmd,
            sinceMs,
          );
          if (agentSessionId) {
            rememberPanelAgentSession(agentSessionId);
            onFound?.(agentSessionId);
            return;
          }
        } catch {
          /* ignore lookup failures */
        }

        scheduleAgentSessionLookup(agentCmd, sinceMs, attempt + 1, onFound);
      }, attempt === 0 ? 1500 : 3000);
    };

    (async () => {
      await waitForTerminalOpen();
      if (disposed) return;

      const agentCmd = props.params?.agentCommand;
      const storedAgentSessionId =
        props.params?.agentSessionId ?? getStoredAgentSessionId(props.api.id);
      let resolvedAgentSessionId = storedAgentSessionId;
      const startup = await resolveAgentStartupCommand(
        agentCmd,
        props.params?.resumeOnRestore,
        storedAgentSessionId,
        lookupAgentSession,
      );
      resolvedAgentSessionId = startup.agentSessionId;
      const isExistingBinding =
        Boolean(startup.agentSessionId) &&
        startup.agentSessionId === storedAgentSessionId;
      rememberPanelAgentSession(startup.agentSessionId, !isExistingBinding);

      if (startup.error) {
        markAgentFailed(startup.error);
        term.writeln(`\x1b[31m[Agent Error] ${startup.error}\x1b[0m`);
        return;
      }

      const openPty = async () => {
        const startupCommand =
          startup.command ?? props.params?.startupCommand ?? null;
        const commandStartedAt = Date.now();
        unlisten = await listen<{
          type: string;
          data?: number[];
          code?: number;
        }>(`pty-chunk-${ptyId}`, (event) => {
          if (disposed) return;
          const p = event.payload;
          if (p.type === "Data" && p.data) {
            const bytes = new Uint8Array(p.data);
            if (!agentLaunchSettled) {
              agentStartupOutput = (
                agentStartupOutput + agentOutputDecoder.decode(bytes, { stream: true })
              ).slice(-4000);
              if (hasAgentStartupError(agentStartupOutput)) {
                markAgentFailed(`${label} 启动失败`);
              }
              scheduleAgentReady();
            }
            hideCodexCursor();
            term.write(bytes);
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
            if (!agentLaunchSettled) {
              markAgentFailed(`${label} 启动失败`);
            }
          }
        });
        if (disposed) {
          unlisten();
          unlisten = null;
          return undefined;
        }

        try {
          lastTerminalSizeRef.current = { rows: term.rows, cols: term.cols };
          id = await invoke("pty_open", {
            spec: {
              id: ptyId,
              shellKind,
              cwd: cwd ?? null,
              rows: term.rows,
              cols: term.cols,
              launchCommand: props.params?.launchCommand ?? null,
              startupCommand,
            },
          });
        } catch (err) {
          if (disposed) return undefined;
          markAgentFailed(`${label} 启动失败`);
          term.writeln(`\x1b[31m[PTY Error] ${err}\x1b[0m`);
          return undefined;
        }
        if (disposed) {
          invoke("pty_close", { id }).catch(() => {});
          return undefined;
        }

        return commandStartedAt;
      };

      const agentCmdToBind =
        agentCmd && !resolvedAgentSessionId ? agentCmd : undefined;
      const commandStartedAt = await openPty();

      if (!commandStartedAt || disposed || !id) return;

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

      if (agentCmdToBind && !sessionLookupTimer) {
        scheduleAgentSessionLookup(agentCmdToBind, commandStartedAt, 0, () => {
          markAgentReady();
        });
      }

      // Wire keyboard input.
      dataDisposable = term.onData((data) => {
        if (agentCommandRef.current === "codex") {
          if (/[\r\n]/.test(data)) {
            hideCodexCursor(true);
          } else {
            showCodexInputCursorBriefly();
          }
        }
        invoke("pty_write", {
          id,
          data: Array.from(new TextEncoder().encode(data)),
        }).catch(() => {});
      });

      if (props.api.isActive) term.focus();
    })();

    return () => {
      disposed = true;
      terminalOpenRef.current = false;
      if (openTimer) clearTimeout(openTimer);
      if (agentReadyTimer) clearTimeout(agentReadyTimer);
      if (agentSlowTimer) clearTimeout(agentSlowTimer);
      if (outputCursorRestoreTimerRef.current) {
        clearTimeout(outputCursorRestoreTimerRef.current);
        outputCursorRestoreTimerRef.current = null;
      }
      openObserver?.disconnect();
      resolveOpenWaiters();
      if (sessionLookupTimer) clearTimeout(sessionLookupTimer);
      if (layoutPersistTimer) clearTimeout(layoutPersistTimer);
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
    term.options.theme = outputCursorHiddenRef.current
      ? {
          ...palette.terminal,
          cursor: "transparent",
          cursorAccent: "transparent",
        }
      : palette.terminal;
  }, [palette]);

  // Live-update font size when zoom changes, then refit + resize PTY.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitAddonRef.current;
    if (!term) return;
    term.options.fontSize = zoomToFontSize(zoom);
    const fitted = fitTerminal(
      term,
      fit,
      terminalHostRef.current,
      terminalOpenRef.current,
    );
    if (!fitted) return;
    resizePtyIfNeeded(term);
  }, [zoom, resizePtyIfNeeded]);

  // Live-update cursor preferences.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.cursorStyle = cursorStyle;
    term.options.cursorBlink = outputCursorHiddenRef.current ? false : cursorBlink;
  }, [cursorStyle, cursorBlink]);

  // Mark active when this panel becomes visible/focused.
  useEffect(() => {
    const dispose = props.api.onDidActiveChange((e) => {
      if (e.isActive) {
        setActive(props.api.id);
        requestAnimationFrame(() => restoreActiveTerminal());
      }
    });
    if (props.api.isActive) {
      setActive(props.api.id);
      requestAnimationFrame(() => restoreActiveTerminal());
    }
    return () => dispose.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreActiveTerminal]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && props.api.isActive) {
        requestAnimationFrame(() => restoreActiveTerminal());
      }
    };

    const handleWindowFocus = () => {
      if (props.api.isActive) {
        requestAnimationFrame(() => restoreActiveTerminal());
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreActiveTerminal]);

  // Resize handler.
  const handleResize = useCallback(() => {
    const term = termRef.current;
    const fit = fitAddonRef.current;
    const fitted = fitTerminal(
      term,
      fit,
      terminalHostRef.current,
      terminalOpenRef.current,
    );
    if (!term || !fitted) return;
    resizePtyIfNeeded(term);
  }, [resizePtyIfNeeded]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let resizeFrame: number | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleResize = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      if (resizeTimer) clearTimeout(resizeTimer);

      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        resizeTimer = setTimeout(() => {
          resizeTimer = null;
          handleResize();
        }, TERMINAL_RESIZE_SETTLE_MS);
      });
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
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

  // Intercept native copy events to copy selected terminal text.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleCopy = (e: ClipboardEvent) => {
      const term = termRef.current;
      if (term && term.hasSelection()) {
        e.clipboardData?.setData("text/plain", term.getSelection());
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener("copy", handleCopy, true);
    return () => {
      el.removeEventListener("copy", handleCopy, true);
    };
  }, []);

  // Handle file drag and drop from Tauri OS window
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Prevent default browser dragover/drop behaviors to avoid navigation
    const preventDefault = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener("dragover", preventDefault, true);
    el.addEventListener("drop", preventDefault, true);

    const unlistenPromise = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const container = containerRef.current;
      if (!container) return;

      const { x, y } = event.payload.position;
      const dpr = window.devicePixelRatio || 1;
      const logicalX = x / dpr;
      const logicalY = y / dpr;

      const rect = container.getBoundingClientRect();
      const isInside =
        logicalX >= rect.left &&
        logicalX <= rect.right &&
        logicalY >= rect.top &&
        logicalY <= rect.bottom;

      if (isInside) {
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          const pathTexts = paths.map((path) => quotePath(path));
          termRef.current?.focus();
          const sid = sessionIdRef.current;
          if (sid) {
            const encoded = Array.from(
              new TextEncoder().encode(pathTexts.join(" ")),
            );
            invoke("pty_write", { id: sid, data: encoded }).catch(() => {});
          }
        }
      }
    });

    return () => {
      el.removeEventListener("dragover", preventDefault, true);
      el.removeEventListener("drop", preventDefault, true);
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  // Ctrl + mouse-wheel zoom, scoped to this panel's container.
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const { zoomIn, zoomOut } = useSettingsStore.getState();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  }, []);

  const term = termRef.current;
  const hasSel = term ? term.hasSelection() : false;

  const contextMenuItems: MenuEntry[] = [
    {
      id: "copy",
      label: "复制",
      disabled: !hasSel,
      onClick: () => {
        if (term) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        }
      },
    },
    {
      id: "paste",
      label: "粘贴",
      onClick: async () => {
        if (!term) return;
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            const sid = sessionIdRef.current;
            if (sid) {
              await invoke("pty_write", {
                id: sid,
                data: Array.from(new TextEncoder().encode(text)),
              });
            }
          }
        } catch (err) {
          console.error("Clipboard paste failed:", err);
        }
      },
    },
    "separator",
    {
      id: "select-all",
      label: "全选",
      onClick: () => {
        term?.selectAll();
      },
    },
    {
      id: "clear-selection",
      label: "清除选择",
      disabled: !hasSel,
      onClick: () => {
        term?.clearSelection();
      },
    },
  ];

  return (
    <div
      ref={containerRef}
      className="xy-terminal-container"
      onClick={() => {
        if (!terminalOpenRef.current) return;
        termRef.current?.focus();
        showCodexInputCursorBriefly();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onWheel={handleWheel}
    >
      <div ref={terminalHostRef} className="xy-terminal-host" />
      {agentLaunchState === "starting" && (
        <div className="xy-agent-launch" aria-live="polite">
          <span className="xy-agent-launch__spinner" />
          <span>{agentLaunchMessage}</span>
        </div>
      )}
      {agentLaunchState === "failed" && (
        <div
          className="xy-agent-launch xy-agent-launch--failed"
          aria-live="assertive"
        >
          <span className="xy-agent-launch__mark">!</span>
          <span>{agentLaunchMessage}</span>
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={contextMenuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function hasRenderableSize(el: HTMLElement | null): el is HTMLElement {
  if (!el || el.clientWidth <= 0 || el.clientHeight <= 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function fitTerminal(
  term: Terminal | null,
  fit: FitAddon | null,
  container: HTMLElement | null,
  isOpen: boolean,
): boolean {
  if (!term || !fit || !isOpen || !hasRenderableSize(container)) return false;

  try {
    fit.fit();
    return true;
  } catch {
    return false;
  }
}

function syncViewportScrollToBottom(container: HTMLElement | null): void {
  const viewport = container?.querySelector<HTMLElement>(".xterm-viewport");
  if (!viewport) return;

  viewport.scrollTop = viewport.scrollHeight;
}

function hasAgentStartupError(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "not recognized as",
    "is not recognized",
    "commandnotfoundexception",
    "running scripts is disabled",
    "cannot be loaded because running scripts is disabled",
    "command not found",
    "no such file or directory",
    "error: unknown option",
    "error: unexpected argument",
    "无法将",
    "无法加载文件",
    "未被识别",
    "不是内部或外部命令",
  ].some((pattern) => normalized.includes(pattern.toLowerCase()));
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
  const agentName = getAgentCommandName(cmd);
  return agentName === "claude" || agentName === "codex" || agentName === "opencode";
}

function imagePasteSequence(cmd: string | undefined): number[] {
  return getAgentCommandName(cmd) === "claude" ? ALT_V : CTRL_V;
}

type AgentSessionLookup = (
  agentCmd: string,
  sinceMs: number,
) => Promise<string | undefined>;

interface AgentStartupResolution {
  command: string | undefined;
  agentSessionId: string | undefined;
  error?: string;
}

function quotePath(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`;
}

function persistLayoutSnapshot(containerApi: { toJSON: () => unknown }): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(containerApi.toJSON()));
  } catch {
    /* ignore */
  }
}

async function resolveAgentStartupCommand(
  cmd: string | undefined,
  resumeOnRestore: boolean | undefined,
  agentSessionId: string | undefined,
  lookupAgentSession: AgentSessionLookup,
): Promise<AgentStartupResolution> {
  let resolvedAgentSessionId = agentSessionId;
  const agentName = getAgentCommandName(cmd);

  if (
    resumeOnRestore &&
    !resolvedAgentSessionId &&
    agentName !== "opencode" &&
    agentName !== "codex" &&
    cmd
  ) {
    try {
      resolvedAgentSessionId = await lookupAgentSession(cmd, 0);
    } catch {
      /* fall back to the agent's default resume behavior */
    }
  }

  return {
    command: getAgentStartupCommand(
      cmd,
      resumeOnRestore,
      resolvedAgentSessionId,
    ),
    agentSessionId: resolvedAgentSessionId,
  };
}

function getAgentStartupCommand(
  cmd: string | undefined,
  resumeOnRestore: boolean | undefined,
  agentSessionId: string | undefined,
): string | undefined {
  if (!cmd) return undefined;
  const parsed = parseAgentCommand(cmd);
  if (!parsed) return undefined;
  const executable = agentExecutable(parsed.name, parsed.token);
  const invocation = [executable, parsed.args].filter(Boolean).join(" ");

  if (!resumeOnRestore) {
    if (parsed.name === "claude" && agentSessionId) {
      return `${invocation} --session-id ${quoteArg(agentSessionId)}`;
    }
    return invocation;
  }

  if (agentSessionId) {
    return (
      {
        claude: `${invocation} --resume ${quoteArg(agentSessionId)}`,
        codex: `${invocation} resume ${quoteArg(agentSessionId)}`,
        opencode: `${invocation} -s ${quoteArg(agentSessionId)}`,
      }[parsed.name] ?? `${invocation} --resume ${quoteArg(agentSessionId)}`
    );
  }

  if (parsed.name === "opencode" || parsed.name === "codex") return invocation;

  return (
    {
      claude: `${invocation} --continue`,
    }[parsed.name] ?? `${invocation} --resume`
  );
}

function agentExecutable(name: string, token: string): string {
  return (
    {
      codex: "codex.cmd",
      opencode: "opencode.cmd",
    }[name] ?? quoteExecutable(token)
  );
}

function quoteExecutable(value: string): string {
  return /\s/.test(value) ? quoteArg(value) : value;
}

function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function queueAgentSessionLookup<T>(task: () => Promise<T>): Promise<T> {
  const next = agentSessionLookupQueue.then(task, task);
  agentSessionLookupQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function createPtyId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `pty-${Date.now()}-${Math.random()}`;
}

function agentLabel(cmd: string): string {
  return agentDisplayName(cmd);
}
