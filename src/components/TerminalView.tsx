import { invoke, Channel } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SearchAddon } from "@xterm/addon-search";
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
import {
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";

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
const RESTART_REGISTRY = new Map<string, () => Promise<void> | void>();
const ALT_V = [27, 118];
const CTRL_V = [22];
const LAYOUT_KEY = "xuya-layout";
const TERMINAL_INITIAL_FIT_FRAMES = 2;
const TERMINAL_RESIZE_SETTLE_MS = 80;
let agentSessionLookupQueue: Promise<void> = Promise.resolve();

export function clearTerminal(panelId: string): void {
  REGISTRY.get(panelId)?.clear();
}

export function restartAgentTerminal(panelId: string): boolean {
  const restart = RESTART_REGISTRY.get(panelId);
  if (!restart) return false;
  void restart();
  return true;
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
  const searchAddonRef = useRef<SearchAddon | null>(null);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    index: number;
    count: number;
  }>({ index: -1, count: 0 });
  const searchInputRef = useRef<HTMLInputElement>(null);

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
        "'JetBrains Maple Mono', 'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
      // Ligatures stay off: xterm renders glyph-by-glyph and only forms
      // ligatures with the (unused) ligatures addon, so Maple Mono's built-in
      // ligatures never trigger. This keeps cell/cursor column alignment exact
      // for agent TUIs (Claude Code / Codex).
      theme: palette.terminal,
      cursorBlink,
      cursorStyle,
      scrollback: 10000,
      allowProposedApi: true,
      allowTransparency: false,
      drawBoldTextInBrightColors: true,
      // 1 = no contrast rewriting. Agents (Claude Code / Codex) ship carefully
      // tuned truecolor syntax highlighting; forcing a 4.5 ratio washed it out.
      minimumContrastRatio: 1,
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

      // Ctrl+F opens the search overlay. This intentionally overrides the
      // readline forward-char binding in agent CLIs (Claude Code / Codex /
      // OpenCode) — per user preference, Ctrl+F always means "find".
      const isFind =
        e.type === "keydown" &&
        e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key?.toLowerCase() === "f" || e.code === "KeyF");
      if (isFind) {
        // xterm returning false only stops PTY dispatch — it does NOT stop the
        // WebView's native Ctrl+F find bar. preventDefault suppresses it.
        e.preventDefault();
        setSearchOpen(true);
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
    // Unicode 11 widths must be active before any PTY output is written so
    // CJK / box-drawing / emoji columns line up (Claude Code & Codex TUIs).
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    REGISTRY.set(props.api.id, term);

    let id = "";
    let dataDisposable: { dispose: () => void } | null = null;
    let channelGeneration = 0;
    let sessionLookupTimer: ReturnType<typeof setTimeout> | null = null;
    let layoutPersistTimer: ReturnType<typeof setTimeout> | null = null;
    let agentReadyTimer: ReturnType<typeof setTimeout> | null = null;
    let agentSlowTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let isOpen = false;
    let disposeWebgl: (() => void) | null = null;
    let restartingAgent = false;
    let suppressExitUntil = 0;
    let agentLaunchSettled = !props.params?.agentCommand;
    let agentStartupOutput = "";
    const agentOutputDecoder = new TextDecoder();
    let openObserver: ResizeObserver | null = null;
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    const openWaiters: Array<() => void> = [];
    let ptyId = createPtyId();

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

    const clearAgentLaunchTimers = (): void => {
      if (agentReadyTimer) clearTimeout(agentReadyTimer);
      if (agentSlowTimer) clearTimeout(agentSlowTimer);
      agentReadyTimer = null;
      agentSlowTimer = null;
    };

    const startAgentSlowTimer = (): void => {
      if (!props.params?.agentCommand) return;
      if (agentSlowTimer) clearTimeout(agentSlowTimer);
      agentSlowTimer = setTimeout(() => {
        if (!disposed && !agentLaunchSettled) {
          setAgentLaunchMessage(`${label} 启动时间较长，仍在等待输出`);
        }
      }, 12000);
    };

    const markAgentReady = (): void => {
      if (disposed || agentLaunchSettled) return;
      agentLaunchSettled = true;
      clearAgentLaunchTimers();
      setAgentLaunchState("ready");
      setAgentLaunchMessage("");
    };

    const markAgentFailed = (message: string): void => {
      if (disposed || agentLaunchSettled) return;
      agentLaunchSettled = true;
      clearAgentLaunchTimers();
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
        disposeWebgl = attachWebglRenderer(term);
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
      startAgentSlowTimer();
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
      acceptSessionId: (sessionId: string) => boolean = () => true,
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
            if (acceptSessionId(agentSessionId)) {
              rememberPanelAgentSession(agentSessionId);
              onFound?.(agentSessionId);
              return;
            }
          }
        } catch {
          /* ignore lookup failures */
        }

        scheduleAgentSessionLookup(
          agentCmd,
          sinceMs,
          attempt + 1,
          onFound,
          acceptSessionId,
        );
      }, attempt === 0 ? 1500 : 3000);
    };

    // Binary IPC frames: first byte is the marker (0x00 Data / 0x01 Exit).
    // Data carries raw PTY bytes after the marker; Exit carries
    // [has_code, i32_le×4]. Channel delivers these as ArrayBuffer.
    const FRAME_DATA = 0x00;
    const FRAME_EXIT = 0x01;

    const handlePtyChunk = (generation: number, message: ArrayBuffer) => {
      if (disposed || generation !== channelGeneration) return;
      const frame = new Uint8Array(message);
      if (frame.length === 0) return;
      const marker = frame[0];

      if (marker === FRAME_DATA) {
        const bytes = frame.subarray(1);
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
      } else if (marker === FRAME_EXIT) {
        const hasCode = frame[1] === 1;
        const code = hasCode
          ? new DataView(
              frame.buffer,
              frame.byteOffset + 2,
              4,
            ).getInt32(0, true)
          : null;
        if (Date.now() < suppressExitUntil) {
          suppressExitUntil = 0;
          return;
        }
        term.writeln(
          `\r\n\x1b[90m[Process exited${
            code != null ? ` code ${code}` : ""
          }]\x1b[0m`,
        );
        updateSession(props.api.id, {
          status: "exited",
          exitCode: code ?? undefined,
        });
        if (!agentLaunchSettled) {
          markAgentFailed(`${label} 启动失败`);
        }
      }
    };

    const ensurePtyChannel = (): Channel<ArrayBuffer> => {
      // Bump the generation so any in-flight messages from a previous channel
      // (e.g. after an agent restart) are ignored by the handler.
      channelGeneration += 1;
      const generation = channelGeneration;
      const next = new Channel<ArrayBuffer>();
      next.onmessage = (message) => handlePtyChunk(generation, message);
      return next;
    };

    const openPty = async (
      startupCommand: string | null | undefined,
    ): Promise<number | undefined> => {
      const commandStartedAt = Date.now();
      ptyId = createPtyId();
      const onChunk = ensurePtyChannel();
      if (disposed) return undefined;

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
          onChunk,
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

    const wireTerminalInput = (): void => {
      if (dataDisposable) return;
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
    };

    const launchPanelPty = async (initial: boolean): Promise<boolean> => {
      const agentCmd = props.params?.agentCommand;
      const storedAgentSessionId =
        props.params?.agentSessionId ?? getStoredAgentSessionId(props.api.id);
      let resolvedAgentSessionId = storedAgentSessionId;
      const agentName = getAgentCommandName(agentCmd);
      const forkClaudeSession = !initial && agentName === "claude";
      const resumeExistingAgentSession =
        !initial &&
        (forkClaudeSession ||
          (agentName === "codex" && Boolean(storedAgentSessionId)));
      const startup = await resolveAgentStartupCommand(
        agentCmd,
        props.params?.resumeOnRestore || resumeExistingAgentSession,
        storedAgentSessionId,
        lookupAgentSession,
        { forkClaudeSession },
      );
      resolvedAgentSessionId = startup.agentSessionId;
      const isExistingBinding =
        Boolean(startup.agentSessionId) &&
        startup.agentSessionId === storedAgentSessionId;
      rememberPanelAgentSession(startup.agentSessionId, !isExistingBinding);

      if (startup.error) {
        markAgentFailed(startup.error);
        term.writeln(`\x1b[31m[Agent Error] ${startup.error}\x1b[0m`);
        return false;
      }

      const agentCmdToBind =
        agentCmd && (!resolvedAgentSessionId || forkClaudeSession)
          ? agentCmd
          : undefined;
      const commandStartedAt = await openPty(
        startup.command ?? props.params?.startupCommand ?? null,
      );

      if (!commandStartedAt || disposed || !id) return false;

      sessionIdRef.current = id;

      // Prefer an explicit label — falls back to shell / agent label.
      props.api.setTitle?.(label);

      if (initial) {
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
      } else {
        updateSession(props.api.id, {
          startTime: Date.now(),
          status: "running",
          exitCode: undefined,
        });
      }

      if (agentCmdToBind && !sessionLookupTimer) {
        scheduleAgentSessionLookup(agentCmdToBind, commandStartedAt, 0, () => {
          markAgentReady();
        }, forkClaudeSession && storedAgentSessionId
          ? (sessionId) => sessionId !== storedAgentSessionId
          : undefined);
      }

      wireTerminalInput();

      if (props.api.isActive) term.focus();
      return true;
    };

    const restartCurrentAgent = async (): Promise<void> => {
      if (disposed || restartingAgent || !props.params?.agentCommand) return;

      restartingAgent = true;
      try {
        if (sessionLookupTimer) {
          clearTimeout(sessionLookupTimer);
          sessionLookupTimer = null;
        }
        clearAgentLaunchTimers();
        agentLaunchSettled = false;
        agentStartupOutput = "";
        setAgentLaunchState("starting");
        setAgentLaunchMessage(`正在重新启动 ${label}`);
        term.clear();
        term.writeln(`\x1b[90m[Reloading ${label}]\x1b[0m`);

        if (id) {
          const previousId = id;
          suppressExitUntil = Date.now() + 3000;
          // Detach the old PTY's channel: bump the generation so any trailing
          // messages from the dying PTY are ignored by the handler.
          channelGeneration += 1;
          id = "";
          sessionIdRef.current = null;
          await invoke("pty_close", { id: previousId }).catch(() => {});
        }

        await waitForTerminalOpen();
        if (disposed) return;
        startAgentSlowTimer();
        await launchPanelPty(false);
      } finally {
        restartingAgent = false;
      }
    };

    RESTART_REGISTRY.set(props.api.id, restartCurrentAgent);

    (async () => {
      await waitForTerminalOpen();
      if (disposed) return;

      await launchPanelPty(true);
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
      // Bump the generation so the channel handler ignores any trailing
      // messages while the terminal tears down (`disposed` also gates it).
      channelGeneration += 1;
      if (id) invoke("pty_close", { id }).catch(() => {});
      // Dispose WebGL before the terminal so its safe-dispose guard runs
      // while the terminal core is still intact.
      disposeWebgl?.();
      term.dispose();
      REGISTRY.delete(props.api.id);
      RESTART_REGISTRY.delete(props.api.id);
      removeSession(props.api.id);
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
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

  // ── Terminal search (Ctrl+Shift+F) ──────────────────────────────────────
  const buildSearchOptions = useCallback(() => {
    const t = useThemeStore.getState().palette.terminal;
    return {
      caseSensitive: searchCaseSensitive,
      decorations: {
        matchBackground: t.yellow,
        matchOverviewRuler: t.yellow,
        activeMatchBackground: t.brightYellow,
        activeMatchColorOverviewRuler: t.brightYellow,
      },
    };
  }, [searchCaseSensitive]);

  const runFind = useCallback(
    (direction: "next" | "prev", query: string) => {
      const search = searchAddonRef.current;
      if (!search) return;
      const options = buildSearchOptions();
      if (!query) {
        search.clearDecorations();
        setSearchResult({ index: -1, count: 0 });
        return;
      }
      if (direction === "next") search.findNext(query, options);
      else search.findPrevious(query, options);
    },
    [buildSearchOptions],
  );

  // Subscribe to result-count changes for the "n / total" readout.
  useEffect(() => {
    const search = searchAddonRef.current;
    if (!search) return;
    const dispose = search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setSearchResult({ index: resultIndex, count: resultCount });
    });
    return () => dispose.dispose();
  }, []);

  // Focus the input when the overlay opens; clear highlights when it closes.
  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
      if (searchQuery) runFind("next", searchQuery);
    } else {
      searchAddonRef.current?.clearDecorations();
      setSearchResult({ index: -1, count: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen]);

  // Re-run search when the query or case-sensitivity changes while open.
  useEffect(() => {
    if (!searchOpen) return;
    runFind("next", searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchCaseSensitive]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    requestAnimationFrame(() => termRef.current?.focus());
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
      id: "search",
      label: "搜索 (Ctrl+F)",
      onClick: () => {
        if (term?.hasSelection()) {
          const sel = term.getSelection();
          // Only seed single-line selections; multi-line makes a poor query.
          if (sel && !sel.includes("\n")) setSearchQuery(sel);
        }
        setSearchOpen(true);
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
      {searchOpen && (
        <div className="xy-term-search" onClick={(e) => e.stopPropagation()}>
          <input
            ref={searchInputRef}
            className="xy-term-search-input"
            type="text"
            placeholder="搜索终端…"
            value={searchQuery}
            spellCheck={false}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runFind(e.shiftKey ? "prev" : "next", searchQuery);
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              } else if (
                e.ctrlKey &&
                !e.shiftKey &&
                !e.altKey &&
                e.key.toLowerCase() === "f"
              ) {
                // Suppress the WebView find bar when the box already has focus.
                e.preventDefault();
                e.currentTarget.select();
              }
            }}
          />
          <span className="xy-term-search-count">
            {searchResult.count > 0
              ? `${searchResult.index + 1}/${searchResult.count}`
              : searchQuery
                ? "无结果"
                : ""}
          </span>
          <button
            className={`xy-term-search-btn${searchCaseSensitive ? " is-active" : ""}`}
            title="区分大小写"
            onClick={() => setSearchCaseSensitive((v) => !v)}
          >
            <CaseSensitive size={15} />
          </button>
          <button
            className="xy-term-search-btn"
            title="上一个 (Shift+Enter)"
            disabled={searchResult.count === 0}
            onClick={() => runFind("prev", searchQuery)}
          >
            <ChevronUp size={15} />
          </button>
          <button
            className="xy-term-search-btn"
            title="下一个 (Enter)"
            disabled={searchResult.count === 0}
            onClick={() => runFind("next", searchQuery)}
          >
            <ChevronDown size={15} />
          </button>
          <button
            className="xy-term-search-btn"
            title="关闭 (Esc)"
            onClick={closeSearch}
          >
            <X size={15} />
          </button>
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

/**
 * Attach the WebGL renderer after the terminal DOM is mounted. xterm's
 * default renderer is the DOM one (slowest); WebGL keeps high-throughput
 * agent output (Claude Code / Codex streaming, big diffs) smooth.
 *
 * Returns a disposer that must run *before* `term.dispose()`. WebglAddon
 * throws `Cannot read properties of undefined (reading '_isDisposed')` if it
 * is disposed before it has rendered a frame — which happens under React
 * StrictMode's mount/unmount/mount cycle and when Dockview tears a panel down
 * immediately. We guard every dispose path so that crash can never bubble.
 *
 * On GPU context loss (driver reset, some backgrounded-tab GPUs) the addon is
 * disposed so xterm transparently falls back to the DOM renderer. Construction
 * failure (no WebGL2 in this WebView2) is swallowed for the same fallback.
 */
function attachWebglRenderer(term: Terminal): () => void {
  let addon: WebglAddon;
  try {
    addon = new WebglAddon();
  } catch {
    return () => {}; // No WebGL2 available — stay on the DOM renderer.
  }

  let disposed = false;
  const safeDispose = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      addon.dispose();
    } catch {
      // WebglAddon can throw if disposed before its first render; the
      // renderer is being torn down anyway, so swallow it.
    }
  };

  addon.onContextLoss(safeDispose);

  try {
    term.loadAddon(addon);
  } catch {
    safeDispose();
  }

  return safeDispose;
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
  opts: { forkClaudeSession?: boolean } = {},
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
      opts,
    ),
    agentSessionId: resolvedAgentSessionId,
  };
}

function getAgentStartupCommand(
  cmd: string | undefined,
  resumeOnRestore: boolean | undefined,
  agentSessionId: string | undefined,
  opts: { forkClaudeSession?: boolean } = {},
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
    const claudeForkArg = opts.forkClaudeSession ? " --fork-session" : "";
    return (
      {
        claude: `${invocation} --resume ${quoteArg(agentSessionId)}${claudeForkArg}`,
        codex: `${invocation} resume ${quoteArg(agentSessionId)}`,
        opencode: `${invocation} -s ${quoteArg(agentSessionId)}`,
      }[parsed.name] ?? `${invocation} --resume ${quoteArg(agentSessionId)}`
    );
  }

  if (parsed.name === "opencode" || parsed.name === "codex") return invocation;

  return (
    {
      claude: `${invocation} --continue${opts.forkClaudeSession ? " --fork-session" : ""}`,
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
