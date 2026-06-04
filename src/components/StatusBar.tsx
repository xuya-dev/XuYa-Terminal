import { invoke } from "@tauri-apps/api/core";
import { open as openShellPath } from "@tauri-apps/plugin-shell";
import {
  Anthropic,
  DeepSeek,
  Kimi,
  Minimax,
  NewAPI,
  OpenAI,
  XiaomiMiMo,
  Zhipu,
} from "@lobehub/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  Check,
  ChevronDown,
  Clock,
  FolderOpen,
  Gauge,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  Server,
} from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";
import { getAgentCommandName } from "../lib/agentCommand";
import { restartAgentTerminal } from "./TerminalView";

type AgentTool = "claude" | "codex";
type AgentQuotaProviderType = "" | "newapi" | "sub2api";

interface AgentCustomProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  endpoint: string;
  apiKey?: string | null;
  model?: string | null;
  quotaProviderType?: AgentQuotaProviderType | null;
  quotaAccessToken?: string | null;
  quotaUserId?: string | null;
  tokenConfigured: boolean;
}

interface AgentBuiltInProviderSummary {
  id: string;
  baseUrl: string;
  endpoint?: string | null;
  apiKey?: string | null;
  model?: string | null;
  tokenConfigured: boolean;
}

interface AgentToolConfigState {
  activeProvider?: string | null;
  baseUrl?: string | null;
  builtInProviders: AgentBuiltInProviderSummary[];
  customProviders: AgentCustomProviderSummary[];
}

interface AgentConfigState {
  claude: AgentToolConfigState;
  codex: AgentToolConfigState;
}

interface AgentQuotaTier {
  name: string;
  utilization?: number | null;
  total?: number | null;
  used?: number | null;
  remaining?: number | null;
  unit?: string | null;
  resetsAt?: string | null;
}

interface AgentProviderQuotaResult {
  tool: AgentTool;
  providerId: string;
  providerName: string;
  quotaProviderType?: AgentQuotaProviderType | null;
  configured: boolean;
  success: boolean;
  planName?: string | null;
  total?: number | null;
  used?: number | null;
  remaining?: number | null;
  unit?: string | null;
  tiers?: AgentQuotaTier[] | null;
  queriedAt: number;
  error?: string | null;
}

interface ProviderOption {
  id: string;
  label: string;
  icon: ReactNode;
}

const BUILT_IN_PROVIDER_LABELS: Record<AgentTool, Record<string, string>> = {
  claude: {
    official: "官方",
    zhipu: "ZhiPu GLM",
    minimax: "MiniMax",
    kimi: "Kimi",
    deepseek: "DeepSeek",
    xiaomimimo: "XiaoMi MiMo",
  },
  codex: {
    official: "官方",
  },
};

const BUILT_IN_PROVIDER_ORDER: Record<AgentTool, string[]> = {
  claude: ["official", "zhipu", "minimax", "kimi", "deepseek", "xiaomimimo"],
  codex: ["official"],
};
const QUOTA_REFRESH_INTERVAL_MS = 60_000;

function agentToolFromCommand(command?: string): AgentTool | null {
  const name = getAgentCommandName(command);
  return name === "claude" || name === "codex" ? name : null;
}

function customProviderSelector(id: string) {
  return `custom:${id}`;
}

function isCustomProviderId(providerId: string) {
  return providerId.startsWith("custom:");
}

function resolveActiveProvider(state?: AgentToolConfigState | null) {
  return state?.activeProvider?.trim() || "official";
}

function providerLabel(tool: AgentTool, providerId: string) {
  return BUILT_IN_PROVIDER_LABELS[tool][providerId] ?? providerId;
}

function providerIcon(tool: AgentTool, providerId: string): ReactNode {
  if (isCustomProviderId(providerId)) return <NewAPI size={12} />;
  if (tool === "codex") return <OpenAI size={12} />;
  const icons: Record<string, ReactNode> = {
    official: <Anthropic size={12} />,
    zhipu: <Zhipu size={12} />,
    minimax: <Minimax size={12} />,
    kimi: <Kimi size={12} />,
    deepseek: <DeepSeek size={12} />,
    xiaomimimo: <XiaomiMiMo size={12} />,
  };
  return icons[providerId] ?? <Server size={12} strokeWidth={1.7} />;
}

function buildProviderOptions(
  tool: AgentTool,
  state?: AgentToolConfigState | null,
): ProviderOption[] {
  const ids = new Set(["official"]);
  for (const provider of state?.builtInProviders ?? []) {
    ids.add(provider.id);
  }
  const activeProvider = resolveActiveProvider(state);
  if (!isCustomProviderId(activeProvider)) ids.add(activeProvider);

  const orderedBuiltInIds = [
    ...BUILT_IN_PROVIDER_ORDER[tool].filter((id) => ids.has(id)),
    ...[...ids].filter((id) => !BUILT_IN_PROVIDER_ORDER[tool].includes(id)),
  ];
  const builtIns = orderedBuiltInIds.map((id) => ({
    id,
    label: providerLabel(tool, id),
    icon: providerIcon(tool, id),
  }));
  const custom = (state?.customProviders ?? []).map((provider) => ({
    id: customProviderSelector(provider.id),
    label: provider.name,
    icon: providerIcon(tool, customProviderSelector(provider.id)),
  }));
  return [...builtIns, ...custom];
}

function findCustomProvider(
  providerId: string,
  providers: AgentCustomProviderSummary[],
) {
  const id = providerId.startsWith("custom:")
    ? providerId.slice("custom:".length)
    : providerId;
  return providers.find((provider) => provider.id === id);
}

function formatQuotaValue(value?: number | null, unit?: string | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value < 0) return "无限";
  const digits = Math.abs(value) >= 100 ? 0 : 2;
  const formatted = value
    .toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    })
    .replace(/\.00$/, "");
  if (unit === "USD") return `$${formatted}`;
  if (unit === "CNY") return `¥${formatted}`;
  if (unit === "%") return `${formatted}%`;
  return unit ? `${formatted} ${unit}` : formatted;
}

function hasQuotaNumber(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value);
}

function weeklyQuotaTier(quota?: AgentProviderQuotaResult | null) {
  return quota?.tiers?.find((tier) => {
    const name = tier.name.toLowerCase();
    return (
      name === "weekly_limit" ||
      name === "seven_day" ||
      name.includes("weekly") ||
      name.includes("week") ||
      name.includes("7_day")
    );
  });
}

function quotaTierLabel(name: string) {
  const normalized = name.toLowerCase();
  if (normalized === "five_hour") return "5 小时";
  if (normalized === "weekly_limit") return "周限";
  if (normalized === "seven_day") return "7 天";
  return name;
}

function formatQuotaTierRemaining(tier?: AgentQuotaTier | null) {
  if (!tier) return "";
  if (typeof tier.remaining === "number") {
    return formatQuotaValue(tier.remaining, tier.unit);
  }
  if (typeof tier.utilization === "number") {
    return formatQuotaValue(Math.max(0, 100 - tier.utilization), "%");
  }
  return "";
}

function formatQuotaTierUsed(tier?: AgentQuotaTier | null) {
  if (!tier) return "";
  if (typeof tier.used === "number") {
    return formatQuotaValue(tier.used, tier.unit);
  }
  if (typeof tier.utilization === "number") {
    return formatQuotaValue(tier.utilization, "%");
  }
  return "";
}

function formatQuotaTierTitle(tier: AgentQuotaTier) {
  const parts = [
    quotaTierLabel(tier.name),
    formatQuotaTierRemaining(tier)
      ? `剩余 ${formatQuotaTierRemaining(tier)}`
      : "",
    formatQuotaTierUsed(tier) ? `已用 ${formatQuotaTierUsed(tier)}` : "",
    tier.total != null ? `总额 ${formatQuotaValue(tier.total, tier.unit)}` : "",
    tier.resetsAt ? `重置 ${tier.resetsAt}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatUptime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
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

/** POSIX-y shells default to LF; Windows shells to CRLF. */
function eolFor(kind?: string): string {
  return kind === "wsl" || kind === "gitBash" ? "LF" : "CRLF";
}

function AgentProviderStatus({ tool }: { tool: AgentTool }) {
  const [configState, setConfigState] = useState<AgentConfigState | null>(null);
  const [providerValue, setProviderValue] = useState("official");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [quota, setQuota] = useState<AgentProviderQuotaResult | null>(null);
  const [loadingQuota, setLoadingQuota] = useState(false);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const providerMenuRef = useRef<HTMLSpanElement | null>(null);

  const loadConfigState = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const next = await invoke<AgentConfigState>("get_agent_config_state");
      const toolState = next[tool];
      setConfigState(next);
      setProviderValue(resolveActiveProvider(toolState));
      return next;
    } finally {
      setLoadingConfig(false);
    }
  }, [tool]);

  useEffect(() => {
    setConfigState(null);
    setQuota(null);
    setSwitchError(null);
    setProviderMenuOpen(false);
    void loadConfigState().catch((error) => {
      setSwitchError(error instanceof Error ? error.message : String(error));
    });
  }, [loadConfigState]);

  useEffect(() => {
    if (!providerMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        providerMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      setProviderMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProviderMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [providerMenuOpen]);

  const toolState = configState?.[tool];
  const providerOptions = useMemo(
    () => buildProviderOptions(tool, toolState),
    [tool, toolState],
  );
  const providerIsCustom = isCustomProviderId(providerValue);
  const selectedCustom = useMemo(
    () =>
      providerIsCustom
        ? findCustomProvider(providerValue, toolState?.customProviders ?? [])
        : undefined,
    [providerIsCustom, providerValue, toolState],
  );
  const selectedProviderOption = providerOptions.find(
    (provider) => provider.id === providerValue,
  );
  const selectedProviderLabel =
    selectedProviderOption?.label ?? selectedCustom?.name ?? providerValue;
  const canQueryQuota =
    providerValue !== "official" &&
    (!providerIsCustom || Boolean(selectedCustom?.quotaProviderType));

  const fetchQuota = useCallback(async () => {
    if (!canQueryQuota) {
      setQuota(null);
      setLoadingQuota(false);
      return;
    }

    setLoadingQuota(true);
    try {
      const result = await invoke<AgentProviderQuotaResult>(
        "fetch_agent_provider_quota",
        {
          request: {
            tool,
            providerId: providerValue,
          },
        },
      );
      setQuota(result);
    } catch (error) {
      setQuota({
        tool,
        providerId: providerValue,
        providerName: selectedProviderLabel,
        quotaProviderType: selectedCustom?.quotaProviderType,
        configured: true,
        success: false,
        queriedAt: Math.floor(Date.now() / 1000),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoadingQuota(false);
    }
  }, [canQueryQuota, providerValue, selectedCustom, selectedProviderLabel, tool]);

  useEffect(() => {
    if (!canQueryQuota) {
      setQuota(null);
      return;
    }

    void fetchQuota();
    const id = window.setInterval(
      () => void fetchQuota(),
      QUOTA_REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [canQueryQuota, fetchQuota]);

  const handleProviderChange = async (nextProvider: string) => {
    setProviderMenuOpen(false);
    if (nextProvider === providerValue || switchingProvider) return;

    setProviderValue(nextProvider);
    setQuota(null);
    setSwitchError(null);
    setSwitchingProvider(true);
    try {
      await invoke("apply_agent_provider_config", {
        request: {
          tool,
          providerId: nextProvider,
        },
      });
      await loadConfigState();
      const activeId = useSessionStore.getState().activeId;
      if (activeId) restartAgentTerminal(activeId);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : String(error));
      setProviderValue(resolveActiveProvider(toolState));
    } finally {
      setSwitchingProvider(false);
    }
  };

  const quotaTone =
    switchError || quota?.success === false
      ? "error"
      : quota?.success
        ? "ready"
        : "muted";
  const primaryTier = quota?.tiers?.[0];
  const weeklyTier = weeklyQuotaTier(quota);
  const weeklyText =
    weeklyTier && weeklyTier !== primaryTier
      ? formatQuotaTierRemaining(weeklyTier)
      : "";
  const quotaText = (() => {
    if (switchingProvider) return "切换中";
    if (switchError) return "切换失败";
    if (!canQueryQuota) return providerIsCustom ? "未配置额度" : "官方额度";
    if (loadingQuota && !quota) return "查询额度";
    if (quota?.success) {
      const primaryParts = [
        `剩 ${formatQuotaValue(quota.remaining, quota.unit)}`,
        hasQuotaNumber(quota.used)
          ? `用 ${formatQuotaValue(quota.used, quota.unit)}`
          : "",
      ].filter(Boolean);
      const primary = primaryParts.join(" · ");
      return weeklyText ? `${primary} · 周 ${weeklyText}` : primary;
    }
    if (quota && !quota.configured) return "未配置额度";
    if (quota?.error) return "额度失败";
    return "等待额度";
  })();
  const quotaTitle = (() => {
    if (switchError) return switchError;
    if (!canQueryQuota) {
      return providerIsCustom
        ? "自定义代理商未配置额度查询"
        : "官方代理商不查询余额";
    }
    if (quota?.error) return quota.error;
    if (!quota?.success) return selectedProviderLabel;
    const parts = [
      quota.providerName,
      quota.planName ? `套餐 ${quota.planName}` : "",
      `剩余 ${formatQuotaValue(quota.remaining, quota.unit)}`,
      hasQuotaNumber(quota.used)
        ? `已用 ${formatQuotaValue(quota.used, quota.unit)}`
        : "",
      quota.total != null ? `总额 ${formatQuotaValue(quota.total, quota.unit)}` : "",
      ...(quota.tiers ?? []).map(formatQuotaTierTitle),
      quota.queriedAt
        ? `查询 ${new Date(quota.queriedAt * 1000).toLocaleTimeString()}`
        : "",
    ].filter(Boolean);
    return parts.join("\n");
  })();

  return (
    <span className="xy-status-agent">
      <span className="xy-status-provider-control" ref={providerMenuRef}>
        <button
          className="xy-status-provider-trigger"
          type="button"
          disabled={loadingConfig || switchingProvider}
          aria-haspopup="listbox"
          aria-expanded={providerMenuOpen}
          title={tool === "claude" ? "切换 Claude Code 代理商" : "切换 Codex 代理商"}
          onClick={() => setProviderMenuOpen((open) => !open)}
        >
          <span className="xy-status-provider-icon" aria-hidden="true">
            {selectedProviderOption?.icon ?? providerIcon(tool, providerValue)}
          </span>
          <span className="xy-status-provider-label">
            {selectedProviderLabel}
          </span>
          <ChevronDown size={11} strokeWidth={1.8} aria-hidden="true" />
        </button>
        {providerMenuOpen && (
          <span className="xy-status-provider-menu" role="listbox">
            {providerOptions.map((provider) => {
              const selected = provider.id === providerValue;
              return (
                <button
                  key={provider.id}
                  className="xy-status-provider-option"
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-active={selected}
                  onClick={() => void handleProviderChange(provider.id)}
                >
                  <span
                    className="xy-status-provider-option-icon"
                    aria-hidden="true"
                  >
                    {provider.icon}
                  </span>
                  <span className="xy-status-provider-option-label">
                    {provider.label}
                  </span>
                  {selected && (
                    <Check size={12} strokeWidth={1.9} aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </span>
        )}
      </span>
      <span
        className="xy-status-quota"
        data-tone={quotaTone}
        title={quotaTitle}
      >
        {loadingQuota || switchingProvider ? (
          <Loader2 className="xy-spin" size={11} strokeWidth={1.8} />
        ) : (
          <Gauge size={11} strokeWidth={1.8} />
        )}
        <span>{quotaText}</span>
      </span>
      <button
        className="xy-status-quota-refresh"
        type="button"
        disabled={!canQueryQuota || loadingQuota || switchingProvider}
        title="刷新额度"
        aria-label="刷新额度"
        onClick={() => void fetchQuota()}
      >
        <RefreshCw size={10} strokeWidth={1.8} />
      </button>
    </span>
  );
}

export default function StatusBar() {
  const active = useSessionStore((s) =>
    s.sessions.find((x) => x.id === s.activeId) ?? null,
  );
  const zoom = useSettingsStore((s) => s.zoom);
  const zoomIn = useSettingsStore((s) => s.zoomIn);
  const zoomOut = useSettingsStore((s) => s.zoomOut);
  const resetZoom = useSettingsStore((s) => s.resetZoom);
  const [, setTick] = useState(0);

  // One-second tick — forces uptime to re-render.
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const uptime = active ? formatUptime(Date.now() - active.startTime) : "—";
  const shell = active ? shellLabelFor(active.shellKind) : "无活跃会话";
  const cwd = active?.cwd ?? "—";
  const agentTool = agentToolFromCommand(active?.agentCommand);
  const canOpenCwd = Boolean(active?.cwd);

  const openCwd = useCallback(() => {
    if (!active?.cwd) return;
    void openShellPath(active.cwd).catch((error) => {
      console.error("Failed to open current folder", error);
    });
  }, [active?.cwd]);

  return (
    <footer className="xy-statusbar">
      <div className="xy-status-left">
        <span
          className="xy-status-chip"
          data-tone={active?.status ?? "idle"}
        >
          <Activity size={12} strokeWidth={2} />
          <span>{shell}</span>
        </span>
        <span className="xy-status-chip xy-status-chip--ghost">
          <Clock size={12} strokeWidth={1.7} />
          <span>
            运行时间 <span className="xy-status-uptime">{uptime}</span>
          </span>
        </span>
        <button
          className="xy-status-chip xy-status-chip--ghost xy-status-cwd-btn"
          type="button"
          disabled={!canOpenCwd}
          title={canOpenCwd ? `在文件资源管理器中打开 ${cwd}` : cwd}
          onClick={openCwd}
        >
          <FolderOpen size={12} strokeWidth={1.7} />
          <span className="xy-status-cwd" title={cwd}>
            {cwd}
          </span>
        </button>
      </div>

      <div className="xy-status-right">
        {agentTool && <AgentProviderStatus tool={agentTool} />}
        <span className="xy-status-pill">UTF-8</span>
        <span className="xy-status-pill">{eolFor(active?.shellKind)}</span>
        <div className="xy-status-zoom" aria-label="终端字号缩放">
          <button
            className="xy-status-zoom-btn"
            onClick={zoomOut}
            title="缩小终端字号"
            aria-label="缩小终端字号"
          >
            <Minus size={10} strokeWidth={2} />
          </button>
          <button
            className="xy-status-pill xy-status-pill--btn"
            onClick={resetZoom}
            title={zoom === 100 ? "终端字号 100%" : "重置终端字号为 100%"}
          >
            <Maximize2 size={11} strokeWidth={1.7} />
            {zoom}%
          </button>
          <button
            className="xy-status-zoom-btn"
            onClick={zoomIn}
            title="放大终端字号"
            aria-label="放大终端字号"
          >
            <Plus size={10} strokeWidth={2} />
          </button>
        </div>
      </div>
    </footer>
  );
}
