import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  ArrowReloadHorizontalIcon,
  CircleGaugeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AgentQuotaTool = "claude" | "codex";

type AgentToolConfigState = {
  activeProvider?: string | null;
};

type AgentConfigState = {
  claude: AgentToolConfigState;
  codex: AgentToolConfigState;
};

type AgentProviderQuotaTier = {
  name: string;
  utilization?: number | null;
  total?: number | null;
  used?: number | null;
  remaining?: number | null;
  unit?: string | null;
  resetsAt?: string | null;
};

type AgentProviderQuotaResult = {
  tool: AgentQuotaTool;
  providerId: string;
  providerName: string;
  quotaProviderType?: string | null;
  configured: boolean;
  success: boolean;
  planName?: string | null;
  total?: number | null;
  used?: number | null;
  remaining?: number | null;
  unit?: string | null;
  tiers: AgentProviderQuotaTier[];
  queriedAt: number;
  error?: string | null;
};

const QUOTA_REFRESH_INTERVAL_MS = 60_000;
const UNSUPPORTED_PROVIDER_IDS = new Set(["official"]);

function formatQuotaValue(value?: number | null, unit?: string | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value < 0) return "无限";
  const formatted = value
    .toLocaleString(undefined, {
      maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
      minimumFractionDigits: 0,
    })
    .replace(/\.00$/, "");
  if (unit === "USD") return `$${formatted}`;
  if (unit === "CNY") return `¥${formatted}`;
  if (unit === "%") return `${formatted}%`;
  return unit ? `${formatted} ${unit}` : formatted;
}

function hasQuotaValue(value?: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function tierLabel(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized === "five_hour") return "5 小时";
  if (normalized === "weekly_limit") return "周限";
  if (normalized === "seven_day") return "7 天";
  return name;
}

function tierSummary(tier: AgentProviderQuotaTier): string {
  const parts = [
    tierLabel(tier.name),
    hasQuotaValue(tier.remaining)
      ? `剩余 ${formatQuotaValue(tier.remaining, tier.unit)}`
      : "",
    hasQuotaValue(tier.used) ? `已用 ${formatQuotaValue(tier.used, tier.unit)}` : "",
    hasQuotaValue(tier.total) ? `总额 ${formatQuotaValue(tier.total, tier.unit)}` : "",
    tier.resetsAt ? `重置 ${tier.resetsAt}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function primaryQuotaText(quota: AgentProviderQuotaResult | null): string {
  if (!quota) return "查询额度";
  if (!quota.success) {
    return quota.configured ? "额度失败" : "未配置额度";
  }
  if (hasQuotaValue(quota.remaining)) {
    return `剩 ${formatQuotaValue(quota.remaining, quota.unit)}`;
  }
  const primaryTier = quota.tiers[0];
  if (primaryTier && hasQuotaValue(primaryTier.remaining)) {
    return `剩 ${formatQuotaValue(primaryTier.remaining, primaryTier.unit)}`;
  }
  if (primaryTier && hasQuotaValue(primaryTier.utilization)) {
    return `剩 ${formatQuotaValue(100 - primaryTier.utilization, "%")}`;
  }
  return "额度正常";
}

function quotaTitle(
  tool: AgentQuotaTool,
  providerId: string | null,
  quota: AgentProviderQuotaResult | null,
  error: string | null,
): string {
  const title = tool === "claude" ? "Claude Code 额度" : "Codex 额度";
  if (error) return `${title}\n${error}`;
  if (!providerId) return `${title}\n未找到当前服务商`;
  if (!quota) return `${title}\n正在查询`;
  if (!quota.success) return `${title}\n${quota.error || "查询失败"}`;
  const parts = [
    title,
    quota.providerName,
    quota.planName ? `套餐 ${quota.planName}` : "",
    hasQuotaValue(quota.remaining)
      ? `剩余 ${formatQuotaValue(quota.remaining, quota.unit)}`
      : "",
    hasQuotaValue(quota.used) ? `已用 ${formatQuotaValue(quota.used, quota.unit)}` : "",
    hasQuotaValue(quota.total) ? `总额 ${formatQuotaValue(quota.total, quota.unit)}` : "",
    ...quota.tiers.map(tierSummary),
    quota.queriedAt
      ? `查询 ${new Date(quota.queriedAt * 1000).toLocaleTimeString()}`
      : "",
  ].filter(Boolean);
  return parts.join("\n");
}

export function AgentQuotaStatus({
  tool,
}: {
  tool: AgentQuotaTool | null;
}) {
  const [providerId, setProviderId] = useState<string | null>(null);
  const [quota, setQuota] = useState<AgentProviderQuotaResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadQuota = useCallback(async () => {
    if (!tool) {
      setProviderId(null);
      setQuota(null);
      setError(null);
      setLoading(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);

    try {
      const config = await invoke<AgentConfigState>("get_agent_config_state");
      if (requestIdRef.current !== requestId) return;
      const nextProviderId = config[tool].activeProvider?.trim() || null;
      setProviderId(nextProviderId);

      if (!nextProviderId) {
        setQuota(null);
        setError(null);
        return;
      }
      if (UNSUPPORTED_PROVIDER_IDS.has(nextProviderId)) {
        setQuota(null);
        setError(null);
        return;
      }

      const result = await invoke<AgentProviderQuotaResult>(
        "fetch_agent_provider_quota",
        {
          request: {
            tool,
            providerId: nextProviderId,
          },
        },
      );
      if (requestIdRef.current !== requestId) return;
      setQuota(result);
      setError(null);
    } catch (loadError) {
      if (requestIdRef.current !== requestId) return;
      setQuota(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [tool]);

  useEffect(() => {
    requestIdRef.current += 1;
    setProviderId(null);
    setQuota(null);
    setError(null);
    setLoading(false);

    if (!tool) return;
    void loadQuota();

    const intervalId = window.setInterval(
      () => void loadQuota(),
      QUOTA_REFRESH_INTERVAL_MS,
    );
    const handleFocus = () => void loadQuota();
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadQuota, tool]);

  const title = useMemo(
    () => (tool ? quotaTitle(tool, providerId, quota, error) : ""),
    [error, providerId, quota, tool],
  );

  if (!tool) return null;
  if (!providerId && !quota && !loading && !error) return null;
  if (providerId && UNSUPPORTED_PROVIDER_IDS.has(providerId)) return null;

  const failed = Boolean(error || quota?.success === false);
  const label = loading && !quota ? "查询额度" : primaryQuotaText(quota);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 text-[10.5px]",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {loading && !quota ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={CircleGaugeIcon} size={12} strokeWidth={1.8} />
          )}
          <span className="max-w-28 truncate font-medium">{label}</span>
          <button
            type="button"
            className="ml-0.5 inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="刷新额度"
            disabled={loading}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void loadQuota();
            }}
          >
            <HugeiconsIcon
              icon={ArrowReloadHorizontalIcon}
              size={10}
              strokeWidth={1.8}
            />
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-80 whitespace-pre-line text-[11px] leading-relaxed">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}
