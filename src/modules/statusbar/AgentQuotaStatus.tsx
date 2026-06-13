import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  ArrowReloadHorizontalIcon,
  CircleGaugeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

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

// 后端 value_reset_time_path 对重置时间只做「数字→字符串」透传,智谱等返回的
// nextResetTime 会以时间戳字符串到达。这里按量级判断秒/毫秒并格式化为本地时间;
// ISO / 可解析日期字符串也会被统一格式化,无法解析则原样返回。
function formatResetTime(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const render = (d: Date) =>
    d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    const ms = n >= 1e11 ? n : n * 1000; // ≥1e11(13 位)视为毫秒,否则秒
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return render(d);
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return render(parsed);
  return trimmed;
}

function tierLabel(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized === "five_hour") return "5 小时窗口";
  if (normalized === "weekly_limit") return "周限制";
  if (normalized === "seven_day") return "7 天窗口";
  if (normalized === "monthly" || normalized === "monthly_limit") return "月限制";
  return name;
}

function toolLabel(tool: AgentQuotaTool): string {
  return tool === "claude" ? "Claude Code 额度" : "Codex 额度";
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

// 非「成功且有数据」时给出的提示文案;返回 null 表示进入详情展示。
function statusMessage(
  providerId: string | null,
  quota: AgentProviderQuotaResult | null,
  error: string | null,
): string | null {
  if (error) return error;
  if (!providerId) return "未找到当前服务商";
  if (!quota) return "正在查询…";
  if (!quota.success) return quota.error || "查询失败";
  return null;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

// 已用百分比(0-100):优先 utilization,其次 used/total,再次 (total-remaining)/total。
function tierUsedPercent(tier: AgentProviderQuotaTier): number | null {
  if (hasQuotaValue(tier.utilization)) return tier.utilization;
  if (hasQuotaValue(tier.used) && hasQuotaValue(tier.total) && tier.total > 0) {
    return (tier.used / tier.total) * 100;
  }
  if (
    hasQuotaValue(tier.remaining) &&
    hasQuotaValue(tier.total) &&
    tier.total > 0
  ) {
    return ((tier.total - tier.remaining) / tier.total) * 100;
  }
  return null;
}

// 接近上限时变色:≥90% 危险(红)、≥70% 警告(黄)、其余主题色。
function tierBarColor(pct: number): string {
  if (pct >= 90) return "bg-destructive";
  if (pct >= 70) return "bg-amber-500";
  return "bg-primary";
}

function QuotaTier({ tier }: { tier: AgentProviderQuotaTier }) {
  const reset = formatResetTime(tier.resetsAt);
  const usedPct = tierUsedPercent(tier);
  const headline =
    usedPct !== null
      ? `已用 ${formatQuotaValue(usedPct, "%")}`
      : hasQuotaValue(tier.remaining)
        ? `剩 ${formatQuotaValue(tier.remaining, tier.unit)}`
        : "—";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{tierLabel(tier.name)}</span>
        <span className="font-medium tabular-nums">{headline}</span>
      </div>
      {usedPct !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", tierBarColor(usedPct))}
            style={{ width: `${Math.min(100, Math.max(0, usedPct))}%` }}
          />
        </div>
      ) : null}
      {reset ? (
        <div className="text-muted-foreground">重置 {reset}</div>
      ) : null}
    </div>
  );
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

  if (!tool) return null;
  if (!providerId && !quota && !loading && !error) return null;
  if (providerId && UNSUPPORTED_PROVIDER_IDS.has(providerId)) return null;

  const failed = Boolean(error || quota?.success === false);
  const label = loading && !quota ? "查询额度" : primaryQuotaText(quota);
  const message = statusMessage(providerId, quota, error);

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
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
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="end"
        className="w-72 divide-y overflow-hidden p-0 text-xs leading-relaxed"
      >
        {/* 头部:工具 + 服务商 + 套餐 */}
        <div className="space-y-0.5 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{toolLabel(tool)}</span>
            {quota ? (
              <span className="truncate text-muted-foreground">
                {quota.providerName}
              </span>
            ) : null}
          </div>
          {quota?.planName ? (
            <p className="text-muted-foreground">套餐 {quota.planName}</p>
          ) : null}
        </div>

        {/* 主体:错误/加载提示 或 额度详情 */}
        <div className="space-y-1.5 p-3">
          {message ? (
            <p className={cn(failed ? "text-destructive" : "text-muted-foreground")}>
              {message}
            </p>
          ) : (
            quota && (
              <>
                {hasQuotaValue(quota.remaining) ||
                hasQuotaValue(quota.used) ||
                hasQuotaValue(quota.total) ? (
                  <div className="space-y-0.5">
                    {hasQuotaValue(quota.remaining) ? (
                      <DetailRow
                        label="剩余"
                        value={formatQuotaValue(quota.remaining, quota.unit)}
                      />
                    ) : null}
                    {hasQuotaValue(quota.used) ? (
                      <DetailRow
                        label="已用"
                        value={formatQuotaValue(quota.used, quota.unit)}
                      />
                    ) : null}
                    {hasQuotaValue(quota.total) ? (
                      <DetailRow
                        label="总额"
                        value={formatQuotaValue(quota.total, quota.unit)}
                      />
                    ) : null}
                  </div>
                ) : null}

                {quota.tiers.length > 0 ? (
                  <div className="space-y-1.5">
                    {quota.tiers.map((tier) => (
                      <QuotaTier key={tier.name} tier={tier} />
                    ))}
                  </div>
                ) : null}
              </>
            )
          )}
        </div>

        {/* 底部:查询时间 */}
        {quota?.queriedAt ? (
          <div className="flex items-center justify-between bg-secondary/50 p-3 text-muted-foreground">
            <span>查询时间</span>
            <span className="tabular-nums">
              {new Date(quota.queriedAt * 1000).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
