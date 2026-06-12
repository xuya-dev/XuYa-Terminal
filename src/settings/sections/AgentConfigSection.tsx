import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

// ── 类型定义 ──────────────────────────────────────────────────────────────

type AgentCustomProviderSummary = {
  id: string;
  name: string;
  baseUrl: string;
  endpoint: string;
  apiKey?: string;
  model?: string;
  haikuModel?: string;
  haikuModelName?: string;
  sonnetModel?: string;
  sonnetModelName?: string;
  opusModel?: string;
  opusModelName?: string;
  extraConfig?: string;
  quotaProviderType?: string;
  quotaBaseUrl?: string;
  quotaApiKey?: string;
  quotaAccessToken?: string;
  quotaUserId?: string;
  tokenConfigured: boolean;
};

type AgentBuiltInProviderSummary = {
  id: string;
  baseUrl: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  haikuModel?: string;
  haikuModelName?: string;
  sonnetModel?: string;
  sonnetModelName?: string;
  opusModel?: string;
  opusModelName?: string;
  extraConfig?: string;
  authConfig?: string;
  tokenConfigured: boolean;
};

type AgentToolConfigState = {
  path: string;
  exists: boolean;
  activeProvider?: string;
  baseUrl?: string;
  endpoint?: string;
  model?: string;
  haikuModel?: string;
  haikuModelName?: string;
  sonnetModel?: string;
  sonnetModelName?: string;
  opusModel?: string;
  opusModelName?: string;
  extraConfig?: string;
  authPath?: string;
  authExists: boolean;
  authConfig?: string;
  apiKey?: string;
  tokenConfigured: boolean;
  builtInProviders: AgentBuiltInProviderSummary[];
  customProviders: AgentCustomProviderSummary[];
};

type AgentConfigState = {
  claude: AgentToolConfigState;
  codex: AgentToolConfigState;
};

type AgentFetchedModel = {
  id: string;
  ownedBy?: string;
};

type AgentModelFetchResult = {
  endpoint: string;
  models: AgentFetchedModel[];
};

type AgentProviderQuotaTier = {
  name: string;
  utilization?: number;
  total?: number;
  used?: number;
  remaining?: number;
  unit?: string;
  resetsAt?: string;
};

type AgentProviderQuotaResult = {
  tool: string;
  providerId: string;
  providerName: string;
  quotaProviderType?: string;
  configured: boolean;
  success: boolean;
  planName?: string;
  total?: number;
  used?: number;
  remaining?: number;
  unit?: string;
  tiers: AgentProviderQuotaTier[];
  queriedAt: number;
  error?: string;
};

type AgentSessionUsage = {
  agent: string;
  sessionId?: string;
  source: string;
  contextTokens?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  contextWindow?: number;
  updatedAt?: number;
};

// ── 内置服务商定义 ────────────────────────────────────────────────────────

type BuiltInProvider = {
  id: string;
  name: string;
  baseUrl: string;
};

const CLAUDE_BUILTIN_PROVIDERS: BuiltInProvider[] = [
  { id: "official", name: "官方", baseUrl: "" },
  { id: "zhipu", name: "ZhiPu GLM", baseUrl: "https://open.bigmodel.cn/api/anthropic" },
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimaxi.com/anthropic" },
  { id: "kimi", name: "Kimi", baseUrl: "https://api.kimi.com/coding" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic" },
  { id: "xiaomimimo", name: "XiaoMi MiMo", baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic" },
];

const CODEX_BUILTIN_PROVIDERS: BuiltInProvider[] = [
  { id: "official", name: "官方 (OpenAI)", baseUrl: "" },
];

const CLAUDE_TOKEN_PLACEHOLDER = "${ANTHROPIC_AUTH_TOKEN}";
const CODEX_TOKEN_PLACEHOLDER = "${CODEX_API_KEY}";
const CODEX_DEFAULT_MODEL = "gpt-5.5";

type ClaudeRoleRow = {
  role: "opus" | "sonnet" | "haiku";
  label: string;
  placeholder: string;
};

const CLAUDE_ROLE_ROWS: ClaudeRoleRow[] = [
  {
    role: "opus",
    label: "Opus",
    placeholder: "claude-opus / deepseek-v4-pro",
  },
  {
    role: "sonnet",
    label: "Sonnet",
    placeholder: "claude-sonnet / deepseek-v4-pro",
  },
  {
    role: "haiku",
    label: "Haiku",
    placeholder: "claude-haiku / deepseek-v4-flash",
  },
];

// ── 辅助函数 ──────────────────────────────────────────────────────────────

function formatNumber(n?: number): string {
  if (n === undefined || n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

function formatQuotaValue(value?: number, unit?: string): string {
  if (value === undefined || value === null) return "—";
  if (unit === "%") return `${value.toFixed(1)}%`;
  return `${formatNumber(value)} ${unit || ""}`.trim();
}

function customProviderId(value: string): string | undefined {
  return value.startsWith("custom:") ? value.slice("custom:".length) : undefined;
}

function quotaProviderType(value?: string): "" | "newapi" | "sub2api" {
  return value === "newapi" || value === "sub2api" ? value : "";
}

function hasOneM(model: string): boolean {
  return model.trimEnd().toLowerCase().endsWith("[1m]");
}

function stripOneM(model: string): string {
  const trimmed = model.trimEnd();
  return hasOneM(trimmed) ? trimmed.slice(0, -4).trimEnd() : model;
}

function setOneM(model: string, enabled: boolean): string {
  const base = stripOneM(model).trim();
  if (!base) return "";
  return enabled ? `${base}[1M]` : base;
}

function modelSelectOptions(
  fetchedModels: AgentFetchedModel[],
  ...currentValues: string[]
): string[] {
  const options: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const next = stripOneM(value).trim();
    if (!next || seen.has(next)) return;
    seen.add(next);
    options.push(next);
  };

  currentValues.forEach(push);
  fetchedModels.forEach((model) => push(model.id));
  return options;
}

function ModelValueField({
  value,
  onChange,
  placeholder,
  fetchedModels,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  fetchedModels: AgentFetchedModel[];
  className?: string;
}) {
  const options = modelSelectOptions(fetchedModels, value);
  if (fetchedModels.length === 0) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
      />
    );
  }

  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder || "选择模型"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((model) => (
          <SelectItem key={model} value={model}>
            {model}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function currentProviderDisplayName(
  activeProvider: string | undefined,
  builtInProviders: BuiltInProvider[],
  customProviders: AgentCustomProviderSummary[] = [],
): string {
  const providerId = activeProvider || "";
  const customId = customProviderId(providerId);
  if (customId) {
    return customProviders.find((provider) => provider.id === customId)?.name || customId;
  }
  return builtInProviders.find((provider) => provider.id === providerId)?.name || providerId || "当前配置";
}

function cleanPreviewApiKey(value: string | undefined, placeholder: string): string {
  const key = value?.trim() || "";
  return key && key !== placeholder ? key : "";
}

function canReuseCurrentApiKey(
  config: AgentToolConfigState | undefined,
  nextBaseUrl: string,
  normalizeBaseUrl: (value: string) => string,
): boolean {
  const currentBaseUrl = config?.baseUrl || "";
  return (
    !!config?.tokenConfigured &&
    !!nextBaseUrl.trim() &&
    !!currentBaseUrl.trim() &&
    normalizeBaseUrl(nextBaseUrl) === normalizeBaseUrl(currentBaseUrl)
  );
}

function tryParseObjectConfig(value?: string): Record<string, unknown> {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeClaudeBaseUrlForPreview(value: string): string {
  let base = value.trim().replace(/\/+$/, "");
  base = base.replace(/\/v1\/messages$/i, "");
  base = base.replace(/\/messages$/i, "");
  base = base.replace(/\/v1$/i, "");
  return base;
}

function normalizeCodexBaseUrlForPreview(value: string): string {
  let base = value.trim().replace(/\/+$/, "");
  base = base.replace(/\/v1\/responses$/i, "");
  base = base.replace(/\/responses$/i, "");
  return base;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function slugifyProviderId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "custom";
}

function codexConfigProviderId(providerId: string, customName: string): string {
  const customId = customProviderId(providerId);
  return `xuya_custom_${slugifyProviderId(customId || customName || "custom")}`;
}

function buildClaudeFullConfig(params: {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  haikuModel: string;
  haikuModelName: string;
  sonnetModel: string;
  sonnetModelName: string;
  opusModel: string;
  opusModelName: string;
  baseConfig?: string;
}): string {
  const config = tryParseObjectConfig(params.baseConfig);
  const rawEnv = config.env;
  const env =
    rawEnv && typeof rawEnv === "object" && !Array.isArray(rawEnv)
      ? { ...(rawEnv as Record<string, unknown>) }
      : {};

  for (const key of [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
  ]) {
    delete env[key];
  }

  if (params.provider !== "official" && params.baseUrl.trim()) {
    env.ANTHROPIC_BASE_URL = normalizeClaudeBaseUrlForPreview(params.baseUrl);
    env.ANTHROPIC_AUTH_TOKEN = params.apiKey.trim() || CLAUDE_TOKEN_PLACEHOLDER;
  }
  if (params.model.trim()) env.ANTHROPIC_MODEL = params.model.trim();
  if (params.haikuModel.trim()) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = params.haikuModel.trim();
  if (params.haikuModelName.trim())
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME = params.haikuModelName.trim();
  if (params.sonnetModel.trim()) env.ANTHROPIC_DEFAULT_SONNET_MODEL = params.sonnetModel.trim();
  if (params.sonnetModelName.trim())
    env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME = params.sonnetModelName.trim();
  if (params.opusModel.trim()) env.ANTHROPIC_DEFAULT_OPUS_MODEL = params.opusModel.trim();
  if (params.opusModelName.trim())
    env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = params.opusModelName.trim();

  const next = { ...config };
  if (Object.keys(env).length > 0) {
    next.env = env;
  } else {
    delete next.env;
  }
  return JSON.stringify(next, null, 2);
}

function extractClaudeConfigApiKey(config: string): string | undefined {
  const env = tryParseObjectConfig(config).env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return undefined;
  const record = env as Record<string, unknown>;
  const key = record.ANTHROPIC_AUTH_TOKEN ?? record.ANTHROPIC_API_KEY;
  return typeof key === "string" ? key.trim() : undefined;
}

function buildCodexAuthConfig(params: {
  provider: string;
  apiKey: string;
  baseConfig?: string;
}): string {
  const config = tryParseObjectConfig(params.baseConfig);
  if (params.provider !== "official") {
    config.OPENAI_API_KEY = params.apiKey.trim() || CODEX_TOKEN_PLACEHOLDER;
  } else if (params.apiKey.trim()) {
    config.OPENAI_API_KEY = params.apiKey.trim();
  }
  return JSON.stringify(config, null, 2);
}

function buildCodexFullConfig(params: {
  provider: string;
  customName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}): string {
  const model = params.model.trim() || CODEX_DEFAULT_MODEL;
  if (params.provider === "official") {
    return `model_provider = "openai"\nmodel = ${tomlString(model)}\n`;
  }

  const providerId = codexConfigProviderId(params.provider, params.customName);
  const providerName = params.customName.trim() || "XuYa Custom";
  const baseUrl = normalizeCodexBaseUrlForPreview(params.baseUrl);
  return `# Managed by XuYa Terminal.
model_provider = "${providerId}"
model = ${tomlString(model)}
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.${providerId}]
name = ${tomlString(providerName)}
base_url = ${tomlString(baseUrl)}
wire_api = "responses"
experimental_bearer_token = ${tomlString(params.apiKey.trim() || CODEX_TOKEN_PLACEHOLDER)}
`;
}

function extractCodexAuthApiKey(authConfig: string): string | undefined {
  const key = tryParseObjectConfig(authConfig).OPENAI_API_KEY;
  return typeof key === "string" ? key.trim() : undefined;
}

function extractCodexConfigApiKey(config: string): string | undefined {
  const match = config.match(/^\s*experimental_bearer_token\s*=\s*(["'])(.*?)\1/m);
  return match?.[2]?.trim();
}

// ── 主组件 ────────────────────────────────────────────────────────────────

export function AgentConfigSection() {
  const [config, setConfig] = useState<AgentConfigState | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"claude" | "codex">("claude");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const state = await invoke<AgentConfigState>("get_agent_config_state");
      setConfig(state);
    } catch (e) {
      setError(`加载配置失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHeader title="编码配置" description="配置 Claude Code 和 Codex" />
        <div className="flex items-center justify-center py-12">
          <Spinner className="size-6" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHeader title="编码配置" description="配置 Claude Code 和 Codex" />
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-[12px] text-destructive">
          {error}
        </div>
        <Button onClick={loadConfig} variant="outline" size="sm">
          重试
        </Button>
      </div>
    );
  }

  const currentConfig = activeTab === "claude" ? config?.claude : config?.codex;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="编码配置"
        description="配置 Claude Code 和 Codex 的服务商、模型和额度"
      />

      {/* 标签切换 */}
      <div className="flex gap-2">
        <Button
          variant={activeTab === "claude" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("claude")}
        >
          Claude Code
        </Button>
        <Button
          variant={activeTab === "codex" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("codex")}
        >
          Codex
        </Button>
      </div>

      {/* 当前配置状态 */}
      {currentConfig && (
        <ConfigStatus config={currentConfig} tool={activeTab} onRefresh={loadConfig} />
      )}

      <Separator />

      {/* 服务商配置 */}
      {activeTab === "claude" ? (
        <ClaudeConfig config={config?.claude} onRefresh={loadConfig} />
      ) : (
        <CodexConfig config={config?.codex} onRefresh={loadConfig} />
      )}
    </div>
  );
}

// ── 配置状态组件 ──────────────────────────────────────────────────────────

function ConfigStatus({
  config,
  tool,
  onRefresh,
}: {
  config: AgentToolConfigState;
  tool: "claude" | "codex";
  onRefresh: () => void;
}) {
  const [sessionUsage, setSessionUsage] = useState<AgentSessionUsage | null>(null);
  const [quota, setQuota] = useState<AgentProviderQuotaResult | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);

  useEffect(() => {
    const loadUsage = async () => {
      try {
        const usage = await invoke<AgentSessionUsage | null>("agent_session_usage", {
          agentCommand: tool,
          cwd: null,
          sessionId: null,
        });
        setSessionUsage(usage);
      } catch {
        // 忽略
      }
    };
    loadUsage();
  }, [tool]);

  const fetchQuota = async () => {
    if (!config.activeProvider || config.activeProvider === "official") return;

    setQuotaLoading(true);
    try {
      const result = await invoke<AgentProviderQuotaResult>("fetch_agent_provider_quota", {
        request: {
          tool,
          providerId: config.activeProvider,
        },
      });
      setQuota(result);
    } catch (e) {
      console.error("Failed to fetch quota:", e);
    } finally {
      setQuotaLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] font-medium">当前状态</div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            刷新
          </Button>
          {config.activeProvider && config.activeProvider !== "official" && (
            <Button variant="ghost" size="sm" onClick={fetchQuota} disabled={quotaLoading}>
              {quotaLoading ? <Spinner className="size-3 mr-1" /> : null}
              查询额度
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <span className="text-muted-foreground">配置文件: </span>
          <span className="font-mono break-all">{config.path}</span>
        </div>
        <div>
          <span className="text-muted-foreground">状态: </span>
          <Badge variant={config.exists ? "default" : "secondary"} className="text-[10px]">
            {config.exists ? "已配置" : "未配置"}
          </Badge>
        </div>
        {config.activeProvider && (
          <div>
            <span className="text-muted-foreground">当前服务商: </span>
            <span className="font-medium">{config.activeProvider}</span>
          </div>
        )}
        {config.baseUrl && (
          <div>
            <span className="text-muted-foreground">Base URL: </span>
            <span className="font-mono">{config.baseUrl}</span>
          </div>
        )}
        {config.endpoint && (
          <div>
            <span className="text-muted-foreground">端点: </span>
            <span className="font-mono">{config.endpoint}</span>
          </div>
        )}
        {config.apiKey && (
          <div>
            <span className="text-muted-foreground">API Key: </span>
            <Badge variant="outline" className="text-[10px]">
              {config.apiKey.slice(0, 4)}...{config.apiKey.slice(-4)}
            </Badge>
          </div>
        )}
        {config.model && (
          <div>
            <span className="text-muted-foreground">模型: </span>
            <span className="font-mono">{config.model}</span>
          </div>
        )}
      </div>

      {/* Claude 角色模型 */}
      {tool === "claude" && (config.haikuModel || config.sonnetModel || config.opusModel) && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <div className="text-[11px] text-muted-foreground mb-2">角色模型</div>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            {config.haikuModel && (
              <div>
                <span className="text-muted-foreground">Haiku: </span>
                <span className="font-mono">{config.haikuModel}</span>
              </div>
            )}
            {config.sonnetModel && (
              <div>
                <span className="text-muted-foreground">Sonnet: </span>
                <span className="font-mono">{config.sonnetModel}</span>
              </div>
            )}
            {config.opusModel && (
              <div>
                <span className="text-muted-foreground">Opus: </span>
                <span className="font-mono">{config.opusModel}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 会话用量 */}
      {sessionUsage && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <div className="text-[11px] text-muted-foreground mb-2">会话用量</div>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            {sessionUsage.contextTokens !== undefined && (
              <div>
                <span className="text-muted-foreground">上下文: </span>
                <span className="font-mono">{formatNumber(sessionUsage.contextTokens)}</span>
              </div>
            )}
            {sessionUsage.totalTokens !== undefined && (
              <div>
                <span className="text-muted-foreground">总计: </span>
                <span className="font-mono">{formatNumber(sessionUsage.totalTokens)}</span>
              </div>
            )}
            {sessionUsage.contextWindow !== undefined && (
              <div>
                <span className="text-muted-foreground">窗口: </span>
                <span className="font-mono">{formatNumber(sessionUsage.contextWindow)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 额度信息 */}
      {quota && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <div className="text-[11px] text-muted-foreground mb-2">
            额度信息
            {quota.planName && <span className="ml-2 text-[10px]">({quota.planName})</span>}
          </div>
          {quota.success ? (
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              {quota.total !== undefined && (
                <div>
                  <span className="text-muted-foreground">总额: </span>
                  <span className="font-mono">{formatQuotaValue(quota.total, quota.unit)}</span>
                </div>
              )}
              {quota.used !== undefined && (
                <div>
                  <span className="text-muted-foreground">已用: </span>
                  <span className="font-mono">{formatQuotaValue(quota.used, quota.unit)}</span>
                </div>
              )}
              {quota.remaining !== undefined && (
                <div>
                  <span className="text-muted-foreground">剩余: </span>
                  <span className="font-mono">{formatQuotaValue(quota.remaining, quota.unit)}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-destructive">{quota.error || "查询失败"}</div>
          )}

          {quota.tiers.length > 0 && (
            <div className="mt-2 space-y-1">
              {quota.tiers.map((tier) => (
                <div key={tier.name} className="flex items-center gap-2 text-[10px]">
                  <span className="text-muted-foreground w-16">{tier.name}:</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${Math.min(100, tier.utilization || 0)}%` }}
                    />
                  </div>
                  <span className="font-mono w-12 text-right">
                    {tier.utilization?.toFixed(1) || "—"}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Claude 配置组件 ───────────────────────────────────────────────────────

function ClaudeConfig({
  config,
  onRefresh,
}: {
  config?: AgentToolConfigState;
  onRefresh: () => void;
}) {
  const [provider, setProvider] = useState(config?.activeProvider || "official");
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl || "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(config?.model || "");
  const [haikuModel, setHaikuModel] = useState(config?.haikuModel || "");
  const [haikuModelName, setHaikuModelName] = useState(config?.haikuModelName || "");
  const [sonnetModel, setSonnetModel] = useState(config?.sonnetModel || "");
  const [sonnetModelName, setSonnetModelName] = useState(config?.sonnetModelName || "");
  const [opusModel, setOpusModel] = useState(config?.opusModel || "");
  const [opusModelName, setOpusModelName] = useState(config?.opusModelName || "");
  const [extraConfig, setExtraConfig] = useState(config?.extraConfig || "");
  const [showFullConfig, setShowFullConfig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<AgentFetchedModel[]>([]);

  // 自定义服务商状态
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customExtraConfig, setCustomExtraConfig] = useState("");
  const [customQuotaProviderType, setCustomQuotaProviderType] =
    useState<"" | "newapi" | "sub2api">("");
  const [customQuotaAccessToken, setCustomQuotaAccessToken] = useState("");
  const [customQuotaUserId, setCustomQuotaUserId] = useState("");
  const [customSaving, setCustomSaving] = useState(false);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);

  // 回显配置
  useEffect(() => {
    if (config) {
      setProvider(config.activeProvider || "official");
      setBaseUrl(config.baseUrl || "");
      setApiKey(config.apiKey || "");
      setModel(config.model || "");
      setHaikuModel(config.haikuModel || "");
      setHaikuModelName(config.haikuModelName || "");
      setSonnetModel(config.sonnetModel || "");
      setSonnetModelName(config.sonnetModelName || "");
      setOpusModel(config.opusModel || "");
      setOpusModelName(config.opusModelName || "");
      setExtraConfig(
        config.extraConfig ||
          buildClaudeFullConfig({
            provider: config.activeProvider || "official",
            baseUrl: config.baseUrl || "",
            apiKey: config.apiKey || "",
            model: config.model || "",
            haikuModel: config.haikuModel || "",
            haikuModelName: config.haikuModelName || "",
            sonnetModel: config.sonnetModel || "",
            sonnetModelName: config.sonnetModelName || "",
            opusModel: config.opusModel || "",
            opusModelName: config.opusModelName || "",
          }),
      );
    }
  }, [config]);

  // 选择内置服务商时自动填充 URL
  useEffect(() => {
    const builtin = CLAUDE_BUILTIN_PROVIDERS.find((p) => p.id === provider);
    const saved = config?.builtInProviders.find((p) => p.id === provider);
    if (builtin && builtin.baseUrl && !saved?.baseUrl) {
      setBaseUrl(builtin.baseUrl);
    }
  }, [config?.builtInProviders, provider]);

  const handleProviderChange = (nextProvider: string) => {
    setProvider(nextProvider);
    setFetchedModels([]);

    const customId = customProviderId(nextProvider);
    if (customId) {
      const saved = config?.customProviders.find((p) => p.id === customId);
      if (saved) {
        setBaseUrl(saved.baseUrl || "");
        setApiKey(saved.apiKey || "");
        setModel(saved.model || "");
        setHaikuModel(saved.haikuModel || "");
        setHaikuModelName(saved.haikuModelName || "");
        setSonnetModel(saved.sonnetModel || "");
        setSonnetModelName(saved.sonnetModelName || "");
        setOpusModel(saved.opusModel || "");
        setOpusModelName(saved.opusModelName || "");
        setExtraConfig(
          saved.extraConfig ||
            buildClaudeFullConfig({
              provider: nextProvider,
              baseUrl: saved.baseUrl || "",
              apiKey: saved.apiKey || "",
              model: saved.model || "",
              haikuModel: saved.haikuModel || "",
              haikuModelName: saved.haikuModelName || "",
              sonnetModel: saved.sonnetModel || "",
              sonnetModelName: saved.sonnetModelName || "",
              opusModel: saved.opusModel || "",
              opusModelName: saved.opusModelName || "",
              baseConfig: config?.extraConfig,
            }),
        );
      }
      return;
    }

    const saved = config?.builtInProviders.find((p) => p.id === nextProvider);
    const builtin = CLAUDE_BUILTIN_PROVIDERS.find((p) => p.id === nextProvider);
    const isCurrent = config?.activeProvider === nextProvider;
    const nextBaseUrl =
      saved?.baseUrl || builtin?.baseUrl || (isCurrent ? config?.baseUrl || "" : "");
    const nextApiKey = saved?.apiKey || (isCurrent ? config?.apiKey || "" : "");
    const nextModel = saved?.model || (isCurrent ? config?.model || "" : "");
    const nextHaikuModel = saved?.haikuModel || (isCurrent ? config?.haikuModel || "" : "");
    const nextHaikuModelName =
      saved?.haikuModelName || (isCurrent ? config?.haikuModelName || "" : "");
    const nextSonnetModel = saved?.sonnetModel || (isCurrent ? config?.sonnetModel || "" : "");
    const nextSonnetModelName =
      saved?.sonnetModelName || (isCurrent ? config?.sonnetModelName || "" : "");
    const nextOpusModel = saved?.opusModel || (isCurrent ? config?.opusModel || "" : "");
    const nextOpusModelName =
      saved?.opusModelName || (isCurrent ? config?.opusModelName || "" : "");
    setBaseUrl(nextBaseUrl);
    setApiKey(nextApiKey);
    setModel(nextModel);
    setHaikuModel(nextHaikuModel);
    setHaikuModelName(nextHaikuModelName);
    setSonnetModel(nextSonnetModel);
    setSonnetModelName(nextSonnetModelName);
    setOpusModel(nextOpusModel);
    setOpusModelName(nextOpusModelName);
    setExtraConfig(
      saved?.extraConfig ||
        (isCurrent && config?.extraConfig
          ? config.extraConfig
          : buildClaudeFullConfig({
              provider: nextProvider,
              baseUrl: nextBaseUrl,
              apiKey: nextApiKey,
              model: nextModel,
              haikuModel: nextHaikuModel,
              haikuModelName: nextHaikuModelName,
              sonnetModel: nextSonnetModel,
              sonnetModelName: nextSonnetModelName,
              opusModel: nextOpusModel,
              opusModelName: nextOpusModelName,
              baseConfig: config?.extraConfig,
            })),
    );
  };

  const buildCurrentFullConfig = (baseConfig = extraConfig) =>
    buildClaudeFullConfig({
      provider,
      baseUrl,
      apiKey,
      model,
      haikuModel,
      haikuModelName,
      sonnetModel,
      sonnetModelName,
      opusModel,
      opusModelName,
      baseConfig,
    });

  const buildCustomFullConfig = (baseConfig = customExtraConfig) =>
    buildClaudeFullConfig({
      provider: "custom",
      baseUrl: customBaseUrl,
      apiKey: customApiKey,
      model: customModel,
      haikuModel: "",
      haikuModelName: "",
      sonnetModel: "",
      sonnetModelName: "",
      opusModel: "",
      opusModelName: "",
      baseConfig,
    });

  useEffect(() => {
    if (showCustomForm) return;
    setExtraConfig(buildCurrentFullConfig(extraConfig));
  }, [
    showCustomForm,
    provider,
    baseUrl,
    apiKey,
    model,
    haikuModel,
    haikuModelName,
    sonnetModel,
    sonnetModelName,
    opusModel,
    opusModelName,
  ]);

  useEffect(() => {
    if (!showCustomForm) return;
    setCustomExtraConfig(buildCustomFullConfig(customExtraConfig));
  }, [showCustomForm, customBaseUrl, customApiKey, customModel]);

  // 保存配置
  const handleSave = async () => {
    setSaving(true);
    try {
      if (provider !== "official" && !customProviderId(provider)) {
        await invoke("save_agent_builtin_provider", {
          request: {
            tool: "claude",
            providerId: provider,
            baseUrl: baseUrl || undefined,
            apiKey: apiKey || undefined,
            model: model || undefined,
            haikuModel: haikuModel || undefined,
            haikuModelName: haikuModelName || undefined,
            sonnetModel: sonnetModel || undefined,
            sonnetModelName: sonnetModelName || undefined,
            opusModel: opusModel || undefined,
            opusModelName: opusModelName || undefined,
            extraConfig: extraConfig || undefined,
          },
        });
      }

      await invoke("apply_agent_provider_config", {
        request: {
          tool: "claude",
          providerId: provider,
          baseUrl: provider === "official" ? undefined : baseUrl || undefined,
          apiKey: apiKey || undefined,
          model: model || undefined,
          haikuModel: haikuModel || undefined,
          haikuModelName: haikuModelName || undefined,
          sonnetModel: sonnetModel || undefined,
          sonnetModelName: sonnetModelName || undefined,
          opusModel: opusModel || undefined,
          opusModelName: opusModelName || undefined,
          extraConfig: extraConfig || undefined,
        },
      });
      await onRefresh();
      alert("Claude Code 配置已保存！");
    } catch (e) {
      alert(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  // 拉取模型列表
  const handleFetchModels = async () => {
    if (!baseUrl) {
      alert("请先填写 Base URL");
      return;
    }

    setFetchingModels(true);
    try {
      const result = await invoke<AgentModelFetchResult>("fetch_agent_provider_models", {
        request: {
          tool: "claude",
          providerId: provider,
          baseUrl: baseUrl || undefined,
          apiKey: apiKey || undefined,
        },
      });
      setFetchedModels(result.models);
    } catch (e) {
      alert(`拉取模型失败: ${e}`);
    } finally {
      setFetchingModels(false);
    }
  };

  // 保存自定义服务商
  const handleSaveCustom = async () => {
    const canReuseKey = canReuseCurrentApiKey(
      config,
      customBaseUrl,
      normalizeClaudeBaseUrlForPreview,
    );
    if (!customName || !customBaseUrl || (!customApiKey && !canReuseKey)) {
      alert("请填写完整信息");
      return;
    }

    setCustomSaving(true);
    try {
      await invoke("save_agent_custom_provider", {
        request: {
          tool: "claude",
          providerId: editingCustomId ? `custom:${editingCustomId}` : undefined,
          name: customName,
          baseUrl: customBaseUrl,
          apiKey: customApiKey,
          model: customModel || undefined,
          extraConfig: customExtraConfig || undefined,
          quotaProviderType: customQuotaProviderType || undefined,
          quotaAccessToken: customQuotaAccessToken || undefined,
          quotaUserId: customQuotaUserId || undefined,
        },
      });

      setCustomName("");
      setCustomBaseUrl("");
      setCustomApiKey("");
      setCustomModel("");
      setCustomExtraConfig("");
      setCustomQuotaProviderType("");
      setCustomQuotaAccessToken("");
      setCustomQuotaUserId("");
      setEditingCustomId(null);
      setShowCustomForm(false);
      await onRefresh();
    } catch (e) {
      alert(`保存失败: ${e}`);
    } finally {
      setCustomSaving(false);
    }
  };

  const handleLoadCurrentToCustom = () => {
    if (!config) return;

    const activeProvider = config.activeProvider || "custom";
    const sourceName = currentProviderDisplayName(
      config.activeProvider,
      CLAUDE_BUILTIN_PROVIDERS,
      config.customProviders,
    );
    const nextApiKey =
      cleanPreviewApiKey(config.apiKey, CLAUDE_TOKEN_PLACEHOLDER) ||
      cleanPreviewApiKey(extractClaudeConfigApiKey(config.extraConfig || ""), CLAUDE_TOKEN_PLACEHOLDER);

    setEditingCustomId(null);
    setCustomName(activeProvider === "official" ? "" : sourceName);
    setCustomBaseUrl(config.baseUrl || "");
    setCustomApiKey(nextApiKey);
    setCustomModel(config.model || "");
    setCustomExtraConfig(
      config.extraConfig ||
        buildClaudeFullConfig({
          provider: activeProvider,
          baseUrl: config.baseUrl || "",
          apiKey: nextApiKey,
          model: config.model || "",
          haikuModel: config.haikuModel || "",
          haikuModelName: config.haikuModelName || "",
          sonnetModel: config.sonnetModel || "",
          sonnetModelName: config.sonnetModelName || "",
          opusModel: config.opusModel || "",
          opusModelName: config.opusModelName || "",
        }),
    );
    setCustomQuotaProviderType("");
    setCustomQuotaAccessToken("");
    setCustomQuotaUserId("");
  };

  // 编辑自定义服务商
  const handleEditCustom = (provider: AgentCustomProviderSummary) => {
    setEditingCustomId(provider.id);
    setCustomName(provider.name);
    setCustomBaseUrl(provider.baseUrl);
    setCustomApiKey(provider.apiKey || "");
    setCustomModel(provider.model || "");
    setCustomExtraConfig(provider.extraConfig || "");
    setCustomQuotaProviderType(quotaProviderType(provider.quotaProviderType));
    setCustomQuotaAccessToken(provider.quotaAccessToken || "");
    setCustomQuotaUserId(provider.quotaUserId || "");
    setShowCustomForm(true);
  };

  // 删除自定义服务商
  const handleDeleteCustom = async (providerId: string) => {
    if (!confirm("确定要删除这个自定义服务商吗？")) return;

    try {
      await invoke("delete_agent_custom_provider", {
        tool: "claude",
        providerId: `custom:${providerId}`,
      });
      await onRefresh();
    } catch (e) {
      alert(`删除失败: ${e}`);
    }
  };

  const updateClaudeRoleModel = (
    currentModel: string,
    currentModelName: string,
    setRoleModel: (value: string) => void,
    setRoleModelName: (value: string) => void,
    nextValue: string,
  ) => {
    const keepsOneM = hasOneM(currentModel);
    const oldBase = stripOneM(currentModel).trim();
    const nextBase = stripOneM(nextValue).trim();
    const shouldSyncName = !currentModelName.trim() || currentModelName.trim() === oldBase;
    setRoleModel(setOneM(nextBase, keepsOneM));
    if (shouldSyncName) setRoleModelName(nextBase);
  };

  const roleRows = [
    {
      ...CLAUDE_ROLE_ROWS[0],
      model: opusModel,
      modelName: opusModelName,
      setModel: setOpusModel,
      setModelName: setOpusModelName,
    },
    {
      ...CLAUDE_ROLE_ROWS[1],
      model: sonnetModel,
      modelName: sonnetModelName,
      setModel: setSonnetModel,
      setModelName: setSonnetModelName,
    },
    {
      ...CLAUDE_ROLE_ROWS[2],
      model: haikuModel,
      modelName: haikuModelName,
      setModel: setHaikuModel,
      setModelName: setHaikuModelName,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[12px] font-medium">Claude Code 配置</div>

      {/* 服务商选择 */}
      <div className="flex flex-col gap-2">
        <Label className="text-[11px]">服务商</Label>
        <div className="flex gap-2">
          <Select value={provider} onValueChange={handleProviderChange}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLAUDE_BUILTIN_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
              {config?.customProviders && config.customProviders.length > 0 && (
                <>
                  <Separator className="my-1" />
                  {config.customProviders.map((p) => (
                    <SelectItem key={`custom:${p.id}`} value={`custom:${p.id}`}>
                      {p.name}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingCustomId(null);
              setCustomName("");
              setCustomBaseUrl("");
              setCustomApiKey("");
              setCustomModel("");
              setCustomExtraConfig("");
              setCustomQuotaProviderType("");
              setCustomQuotaAccessToken("");
              setCustomQuotaUserId("");
              setShowCustomForm(!showCustomForm);
            }}
          >
            {showCustomForm ? "取消" : "添加服务商"}
          </Button>
        </div>
      </div>

      {/* 自定义服务商表单 */}
      {showCustomForm && (
        <div className="rounded-lg border border-border/60 bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium">
              {editingCustomId ? "编辑服务商" : "添加自定义服务商"}
            </div>
            {!editingCustomId && (
              <Button variant="outline" size="sm" onClick={handleLoadCurrentToCustom} disabled={!config}>
                获取当前
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label className="text-[10px]">名称</Label>
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="我的服务商"
                className="text-[10px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-[10px]">Base URL</Label>
              <Input
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                className="text-[10px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-[10px]">API Key</Label>
              <Input
                type="password"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="text-[10px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-[10px]">模型（可选）</Label>
              <Input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="可选"
                className="text-[10px]"
              />
            </div>
            <div className="col-span-2 flex flex-col gap-2">
              <Label className="text-[10px]">完整 settings.json（可选）</Label>
              <Textarea
                value={customExtraConfig}
                onChange={(e) => setCustomExtraConfig(e.target.value)}
                rows={6}
                spellCheck={false}
                placeholder='{"env":{"ANTHROPIC_BASE_URL":"https://api.example.com","ANTHROPIC_AUTH_TOKEN":"sk-ant-..."}}'
                className="min-h-32 resize-y font-mono text-[10px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-[10px]">额度查询</Label>
              <Select
                value={customQuotaProviderType || "none"}
                onValueChange={(value) => {
                  const next = value === "none" ? "" : quotaProviderType(value);
                  setCustomQuotaProviderType(next);
                  if (next !== "newapi") {
                    setCustomQuotaAccessToken("");
                    setCustomQuotaUserId("");
                  }
                }}
              >
                <SelectTrigger className="w-full text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不查询</SelectItem>
                  <SelectItem value="sub2api">Sub2API</SelectItem>
                  <SelectItem value="newapi">New API</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {customQuotaProviderType === "newapi" && (
              <>
                <div className="flex flex-col gap-2">
                  <Label className="text-[10px]">Access Token</Label>
                  <Input
                    type="password"
                    value={customQuotaAccessToken}
                    onChange={(e) => setCustomQuotaAccessToken(e.target.value)}
                    placeholder="Bearer Token"
                    className="text-[10px]"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-[10px]">用户 ID</Label>
                  <Input
                    value={customQuotaUserId}
                    onChange={(e) => setCustomQuotaUserId(e.target.value)}
                    placeholder="New-Api-User"
                    className="text-[10px]"
                  />
                </div>
              </>
            )}
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={handleSaveCustom} disabled={customSaving}>
              {customSaving ? <Spinner className="size-3 mr-1" /> : null}
              {editingCustomId ? "更新" : "添加"}
            </Button>
            {editingCustomId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingCustomId(null);
                  setCustomName("");
                  setCustomBaseUrl("");
                  setCustomApiKey("");
                  setCustomModel("");
                  setCustomExtraConfig("");
                  setCustomQuotaProviderType("");
                  setCustomQuotaAccessToken("");
                  setCustomQuotaUserId("");
                }}
              >
                取消
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 自定义服务商列表 */}
      {!showCustomForm && config?.customProviders && config.customProviders.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] text-muted-foreground">已保存的自定义服务商</div>
          {config.customProviders.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded border border-border/40 bg-muted/40 p-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium">{p.name}</span>
                  {p.tokenConfigured && (
                    <Badge variant="outline" className="text-[9px]">
                      Key 已配置
                    </Badge>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  {p.baseUrl}
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => handleEditCustom(p)}>
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] text-destructive"
                  onClick={() => handleDeleteCustom(p.id)}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showCustomForm && (
        <>
          <Separator />

          {/* Base URL */}
          {provider !== "official" && (
            <div className="flex flex-col gap-2">
              <Label className="text-[11px]">Base URL</Label>
              <div className="flex gap-2">
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="text-[11px]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFetchModels}
                  disabled={fetchingModels || !baseUrl}
                >
                  {fetchingModels ? <Spinner className="size-3 mr-1" /> : null}
                  拉取模型
                </Button>
              </div>
            </div>
          )}

          {/* API Key */}
          <div className="flex flex-col gap-2">
            <Label className="text-[11px]">API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.tokenConfigured ? "已配置（留空保持不变）" : "sk-ant-..."}
              className="text-[11px]"
            />
          </div>

          {/* 模型 */}
          <div className="flex flex-col gap-2">
            <Label className="text-[11px]">兜底模型</Label>
            <ModelValueField
              value={model}
              onChange={setModel}
              placeholder="可选"
              fetchedModels={fetchedModels}
              className="text-[11px]"
            />
          </div>

          {/* 角色模型 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px]">Claude 模型角色</Label>
              <span className="text-[10px] text-muted-foreground">
                显示名称用于 /model 菜单，1M 会写入模型值后缀
              </span>
            </div>
            <div className="w-[640px] max-w-full overflow-x-auto rounded-lg border border-border/60 bg-card/60 p-2">
              <div className="grid min-w-[616px] grid-cols-[5rem_14rem_14rem_4rem] gap-2 px-1 pb-1 text-[10px] text-muted-foreground">
                <span>角色</span>
                <span>模型名称</span>
                <span>实际请求模型</span>
                <span className="text-center">1M</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {roleRows.map((row) => {
                  const modelBase = stripOneM(row.model);
                  const oneM = hasOneM(row.model);
                  return (
                    <div
                      key={row.role}
                      className="grid min-w-[616px] grid-cols-[5rem_14rem_14rem_4rem] items-center gap-2"
                    >
                      <div className="flex h-8 items-center justify-center rounded-md border border-border/60 bg-muted/60 text-[11px] font-semibold text-muted-foreground">
                        {row.label}
                      </div>
                      <Input
                        value={row.modelName}
                        placeholder={modelBase || "显示在模型菜单中的名称"}
                        onChange={(e) => row.setModelName(e.target.value)}
                        className="h-8 text-[11px]"
                      />
                      <ModelValueField
                        value={modelBase}
                        onChange={(value) =>
                          updateClaudeRoleModel(
                            row.model,
                            row.modelName,
                            row.setModel,
                            row.setModelName,
                            value,
                          )
                        }
                        placeholder={row.placeholder}
                        fetchedModels={fetchedModels}
                        className="h-8 text-[11px]"
                      />
                      <label className="flex h-8 items-center justify-center gap-1 rounded-md border border-border/60 bg-muted/40 text-[10px] text-muted-foreground">
                        <Checkbox
                          checked={oneM}
                          onCheckedChange={(checked) =>
                            row.setModel(setOneM(row.model, checked === true))
                          }
                        />
                        1M
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px]">完整配置</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!showFullConfig && !extraConfig.trim()) {
                    setExtraConfig(buildCurrentFullConfig(""));
                  }
                  setShowFullConfig((value) => !value);
                }}
              >
                {showFullConfig ? "收起" : "完整 settings.json"}
              </Button>
            </div>
            {showFullConfig && (
              <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-[10px]" title={config?.path}>
                    完整 settings.json
                  </Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px]"
                    onClick={() => setExtraConfig(buildCurrentFullConfig(extraConfig))}
                  >
                    同步表单
                  </Button>
                </div>
                <Textarea
                  value={extraConfig}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextApiKey = extractClaudeConfigApiKey(next);
                    setExtraConfig(next);
                    if (nextApiKey && nextApiKey !== CLAUDE_TOKEN_PLACEHOLDER) {
                      setApiKey(nextApiKey);
                    }
                  }}
                  rows={10}
                  spellCheck={false}
                  className="min-h-64 resize-y font-mono text-[11px]"
                />
              </div>
            )}
          </div>

          {/* 保存按钮 */}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Spinner className="size-4 mr-2" /> : null}
            保存配置
          </Button>
        </>
      )}
    </div>
  );
}

// ── Codex 配置组件 ────────────────────────────────────────────────────────

function CodexConfig({
  config,
  onRefresh,
}: {
  config?: AgentToolConfigState;
  onRefresh: () => void;
}) {
  const [provider, setProvider] = useState(config?.activeProvider || "official");
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl || "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(config?.model || CODEX_DEFAULT_MODEL);
  const [extraConfig, setExtraConfig] = useState(config?.extraConfig || "");
  const [authConfig, setAuthConfig] = useState(config?.authConfig || "");
  const [showFullConfig, setShowFullConfig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<AgentFetchedModel[]>([]);

  // 自定义服务商状态
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customExtraConfig, setCustomExtraConfig] = useState("");
  const [customQuotaProviderType, setCustomQuotaProviderType] =
    useState<"" | "newapi" | "sub2api">("");
  const [customQuotaAccessToken, setCustomQuotaAccessToken] = useState("");
  const [customQuotaUserId, setCustomQuotaUserId] = useState("");
  const [customSaving, setCustomSaving] = useState(false);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);

  // 回显配置
  useEffect(() => {
    if (config) {
      setProvider(config.activeProvider || "official");
      setBaseUrl(config.baseUrl || "");
      setApiKey(config.apiKey || "");
      setModel(config.model || CODEX_DEFAULT_MODEL);
      setExtraConfig(
        config.extraConfig ||
          buildCodexFullConfig({
            provider: config.activeProvider || "official",
            customName: "",
            baseUrl: config.baseUrl || "",
            apiKey: config.apiKey || "",
            model: config.model || CODEX_DEFAULT_MODEL,
          }),
      );
      setAuthConfig(
        config.authConfig ||
          buildCodexAuthConfig({
            provider: config.activeProvider || "official",
            apiKey: config.apiKey || "",
          }),
      );
    }
  }, [config]);

  const handleProviderChange = (nextProvider: string) => {
    setProvider(nextProvider);
    setFetchedModels([]);

    const customId = customProviderId(nextProvider);
    if (customId) {
      const saved = config?.customProviders.find((p) => p.id === customId);
      if (saved) {
        setBaseUrl(saved.baseUrl || "");
        setApiKey(saved.apiKey || "");
        setModel(saved.model || CODEX_DEFAULT_MODEL);
        setExtraConfig(
          saved.extraConfig ||
            buildCodexFullConfig({
              provider: nextProvider,
              customName: saved.name,
              baseUrl: saved.baseUrl || "",
              apiKey: saved.apiKey || "",
              model: saved.model || CODEX_DEFAULT_MODEL,
            }),
        );
        setAuthConfig(
          buildCodexAuthConfig({
            provider: nextProvider,
            apiKey: saved.apiKey || "",
            baseConfig: config?.authConfig,
          }),
        );
      }
      return;
    }

    const saved = config?.builtInProviders.find((p) => p.id === nextProvider);
    const builtin = CODEX_BUILTIN_PROVIDERS.find((p) => p.id === nextProvider);
    const isCurrent = config?.activeProvider === nextProvider;
    const nextBaseUrl =
      saved?.baseUrl || builtin?.baseUrl || (isCurrent ? config?.baseUrl || "" : "");
    const nextApiKey = saved?.apiKey || (isCurrent ? config?.apiKey || "" : "");
    const nextModel =
      saved?.model || (isCurrent ? config?.model || CODEX_DEFAULT_MODEL : CODEX_DEFAULT_MODEL);
    setBaseUrl(nextBaseUrl);
    setApiKey(nextApiKey);
    setModel(nextModel);
    setExtraConfig(
      saved?.extraConfig ||
        (isCurrent && config?.extraConfig
          ? config.extraConfig
          : buildCodexFullConfig({
              provider: nextProvider,
              customName: "",
              baseUrl: nextBaseUrl,
              apiKey: nextApiKey,
              model: nextModel,
            })),
    );
    setAuthConfig(
      saved?.authConfig ||
        (isCurrent && config?.authConfig
          ? config.authConfig
          : buildCodexAuthConfig({
              provider: nextProvider,
              apiKey: nextApiKey,
            })),
    );
  };

  const buildCurrentAuthConfig = (baseConfig = authConfig) =>
    buildCodexAuthConfig({
      provider,
      apiKey,
      baseConfig,
    });

  const buildCurrentFullConfig = () => {
    const selectedCustomId = customProviderId(provider);
    const selectedCustom = selectedCustomId
      ? config?.customProviders.find((p) => p.id === selectedCustomId)
      : undefined;
    return buildCodexFullConfig({
      provider,
      customName: selectedCustom?.name || "",
      baseUrl,
      apiKey,
      model,
    });
  };

  const buildCustomFullConfig = () =>
    buildCodexFullConfig({
      provider: editingCustomId ? `custom:${editingCustomId}` : "custom",
      customName,
      baseUrl: customBaseUrl,
      apiKey: customApiKey,
      model: customModel || CODEX_DEFAULT_MODEL,
    });

  useEffect(() => {
    if (showCustomForm) return;
    setAuthConfig(buildCurrentAuthConfig(authConfig));
    setExtraConfig(buildCurrentFullConfig());
  }, [showCustomForm, provider, baseUrl, apiKey, model]);

  useEffect(() => {
    if (!showCustomForm) return;
    setCustomExtraConfig(buildCustomFullConfig());
  }, [showCustomForm, editingCustomId, customName, customBaseUrl, customApiKey, customModel]);

  // 保存配置
  const handleSave = async () => {
    setSaving(true);
    try {
      if (provider !== "official" && !customProviderId(provider)) {
        await invoke("save_agent_builtin_provider", {
          request: {
            tool: "codex",
            providerId: provider,
            baseUrl: baseUrl || undefined,
            apiKey: apiKey || undefined,
            model: model || undefined,
            extraConfig: extraConfig || undefined,
            authConfig: authConfig || undefined,
          },
        });
      }

      await invoke("apply_agent_provider_config", {
        request: {
          tool: "codex",
          providerId: provider,
          baseUrl: provider === "official" ? undefined : baseUrl || undefined,
          apiKey: apiKey || undefined,
          model: model || undefined,
          extraConfig: extraConfig || undefined,
          authConfig: authConfig || undefined,
        },
      });
      await onRefresh();
      alert("Codex 配置已保存！");
    } catch (e) {
      alert(`保存失败: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  // 拉取模型列表
  const handleFetchModels = async () => {
    if (!baseUrl) {
      alert("请先填写 Base URL");
      return;
    }

    setFetchingModels(true);
    try {
      const result = await invoke<AgentModelFetchResult>("fetch_agent_provider_models", {
        request: {
          tool: "codex",
          providerId: provider,
          baseUrl: baseUrl || undefined,
          apiKey: apiKey || undefined,
        },
      });
      setFetchedModels(result.models);
    } catch (e) {
      alert(`拉取模型失败: ${e}`);
    } finally {
      setFetchingModels(false);
    }
  };

  // 保存自定义服务商
  const handleSaveCustom = async () => {
    const canReuseKey = canReuseCurrentApiKey(
      config,
      customBaseUrl,
      normalizeCodexBaseUrlForPreview,
    );
    if (!customName || !customBaseUrl || (!customApiKey && !canReuseKey)) {
      alert("请填写完整信息");
      return;
    }

    setCustomSaving(true);
    try {
      await invoke("save_agent_custom_provider", {
        request: {
          tool: "codex",
          providerId: editingCustomId ? `custom:${editingCustomId}` : undefined,
          name: customName,
          baseUrl: customBaseUrl,
          apiKey: customApiKey,
          model: customModel || undefined,
          extraConfig: customExtraConfig || undefined,
          quotaProviderType: customQuotaProviderType || undefined,
          quotaAccessToken: customQuotaAccessToken || undefined,
          quotaUserId: customQuotaUserId || undefined,
        },
      });

      setCustomName("");
      setCustomBaseUrl("");
      setCustomApiKey("");
      setCustomModel("");
      setCustomExtraConfig("");
      setCustomQuotaProviderType("");
      setCustomQuotaAccessToken("");
      setCustomQuotaUserId("");
      setEditingCustomId(null);
      setShowCustomForm(false);
      await onRefresh();
    } catch (e) {
      alert(`保存失败: ${e}`);
    } finally {
      setCustomSaving(false);
    }
  };

  const handleLoadCurrentToCustom = () => {
    if (!config) return;

    const activeProvider = config.activeProvider || "custom";
    const sourceName = currentProviderDisplayName(
      config.activeProvider,
      CODEX_BUILTIN_PROVIDERS,
      config.customProviders,
    );
    const nextApiKey =
      cleanPreviewApiKey(config.apiKey, CODEX_TOKEN_PLACEHOLDER) ||
      cleanPreviewApiKey(extractCodexAuthApiKey(config.authConfig || ""), CODEX_TOKEN_PLACEHOLDER) ||
      cleanPreviewApiKey(extractCodexConfigApiKey(config.extraConfig || ""), CODEX_TOKEN_PLACEHOLDER);

    setEditingCustomId(null);
    setCustomName(activeProvider === "official" || sourceName.includes("官方") ? "" : sourceName);
    setCustomBaseUrl(config.baseUrl || "");
    setCustomApiKey(nextApiKey);
    setCustomModel(config.model || CODEX_DEFAULT_MODEL);
    setCustomExtraConfig(
      config.extraConfig ||
        buildCodexFullConfig({
          provider: activeProvider,
          customName: sourceName,
          baseUrl: config.baseUrl || "",
          apiKey: nextApiKey,
          model: config.model || CODEX_DEFAULT_MODEL,
        }),
    );
    setCustomQuotaProviderType("");
    setCustomQuotaAccessToken("");
    setCustomQuotaUserId("");
  };

  // 删除自定义服务商
  const handleDeleteCustom = async (providerId: string) => {
    if (!confirm("确定要删除这个自定义服务商吗？")) return;

    try {
      await invoke("delete_agent_custom_provider", {
        tool: "codex",
        providerId: `custom:${providerId}`,
      });
      await onRefresh();
    } catch (e) {
      alert(`删除失败: ${e}`);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[12px] font-medium">Codex 配置</div>

      {/* 服务商选择 */}
      <div className="flex flex-col gap-2">
        <Label className="text-[11px]">服务商</Label>
        <div className="flex gap-2">
          <Select value={provider} onValueChange={handleProviderChange}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CODEX_BUILTIN_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
              {config?.customProviders && config.customProviders.length > 0 && (
                <>
                  <Separator className="my-1" />
                  {config.customProviders.map((p) => (
                    <SelectItem key={`custom:${p.id}`} value={`custom:${p.id}`}>
                      {p.name}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingCustomId(null);
              setCustomName("");
              setCustomBaseUrl("");
              setCustomApiKey("");
              setCustomModel("");
              setCustomExtraConfig("");
              setCustomQuotaProviderType("");
              setCustomQuotaAccessToken("");
              setCustomQuotaUserId("");
              setShowCustomForm(!showCustomForm);
            }}
          >
            {showCustomForm ? "取消" : "添加服务商"}
          </Button>
        </div>
      </div>

      {/* 自定义服务商表单 */}
      {showCustomForm && (
        <div className="rounded-lg border border-border/60 bg-card/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium">
              {editingCustomId ? "编辑服务商" : "添加自定义服务商"}
            </div>
            {!editingCustomId && (
              <Button variant="outline" size="sm" onClick={handleLoadCurrentToCustom} disabled={!config}>
                获取当前
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label className="text-[10px]">名称</Label>
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="我的服务商"
                className="text-[10px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-[10px]">Base URL</Label>
              <Input
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                className="text-[10px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-[10px]">API Key</Label>
              <Input
                type="password"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="sk-..."
                className="text-[10px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-[10px]">模型（可选）</Label>
              <Input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="可选"
                className="text-[10px]"
              />
            </div>
            <div className="col-span-2 flex flex-col gap-2">
              <Label className="text-[10px]">完整 config.toml（可选）</Label>
              <Textarea
                value={customExtraConfig}
                onChange={(e) => setCustomExtraConfig(e.target.value)}
                rows={6}
                spellCheck={false}
                placeholder={`model_provider = "xuya_custom"\nmodel = "${CODEX_DEFAULT_MODEL}"`}
                className="min-h-32 resize-y font-mono text-[10px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-[10px]">额度查询</Label>
              <Select
                value={customQuotaProviderType || "none"}
                onValueChange={(value) => {
                  const next = value === "none" ? "" : quotaProviderType(value);
                  setCustomQuotaProviderType(next);
                  if (next !== "newapi") {
                    setCustomQuotaAccessToken("");
                    setCustomQuotaUserId("");
                  }
                }}
              >
                <SelectTrigger className="w-full text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不查询</SelectItem>
                  <SelectItem value="sub2api">Sub2API</SelectItem>
                  <SelectItem value="newapi">New API</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {customQuotaProviderType === "newapi" && (
              <>
                <div className="flex flex-col gap-2">
                  <Label className="text-[10px]">Access Token</Label>
                  <Input
                    type="password"
                    value={customQuotaAccessToken}
                    onChange={(e) => setCustomQuotaAccessToken(e.target.value)}
                    placeholder="Bearer Token"
                    className="text-[10px]"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-[10px]">用户 ID</Label>
                  <Input
                    value={customQuotaUserId}
                    onChange={(e) => setCustomQuotaUserId(e.target.value)}
                    placeholder="New-Api-User"
                    className="text-[10px]"
                  />
                </div>
              </>
            )}
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={handleSaveCustom} disabled={customSaving}>
              {customSaving ? <Spinner className="size-3 mr-1" /> : null}
              {editingCustomId ? "更新" : "添加"}
            </Button>
          </div>
        </div>
      )}

      {/* 自定义服务商列表 */}
      {!showCustomForm && config?.customProviders && config.customProviders.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] text-muted-foreground">已保存的自定义服务商</div>
          {config.customProviders.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded border border-border/40 bg-muted/40 p-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium">{p.name}</span>
                  {p.tokenConfigured && (
                    <Badge variant="outline" className="text-[9px]">
                      Key 已配置
                    </Badge>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  {p.baseUrl}
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] text-destructive"
                  onClick={() => handleDeleteCustom(p.id)}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showCustomForm && (
        <>
          <Separator />

          {/* Base URL */}
          {provider !== "official" && (
            <div className="flex flex-col gap-2">
              <Label className="text-[11px]">Base URL</Label>
              <div className="flex gap-2">
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="text-[11px]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFetchModels}
                  disabled={fetchingModels || !baseUrl}
                >
                  {fetchingModels ? <Spinner className="size-3 mr-1" /> : null}
                  拉取模型
                </Button>
              </div>
            </div>
          )}

          {/* API Key */}
          <div className="flex flex-col gap-2">
            <Label className="text-[11px]">API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.tokenConfigured ? "已配置（留空保持不变）" : "sk-..."}
              className="text-[11px]"
            />
          </div>

          {/* 模型 */}
          <div className="flex flex-col gap-2">
            <Label className="text-[11px]">模型</Label>
            <ModelValueField
              value={model}
              onChange={setModel}
              placeholder={CODEX_DEFAULT_MODEL}
              fetchedModels={fetchedModels}
              className="text-[11px]"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px]">完整配置</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!showFullConfig) {
                    if (!extraConfig.trim()) setExtraConfig(buildCurrentFullConfig());
                    if (!authConfig.trim()) setAuthConfig(buildCurrentAuthConfig(""));
                  }
                  setShowFullConfig((value) => !value);
                }}
              >
                {showFullConfig ? "收起" : "完整 auth/config"}
              </Button>
            </div>
            {showFullConfig && (
              <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 p-3">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[10px]" title={config?.authPath}>
                      完整 auth.json
                    </Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[10px]"
                      onClick={() => setAuthConfig(buildCurrentAuthConfig(authConfig))}
                    >
                      同步表单
                    </Button>
                  </div>
                  <Textarea
                    value={authConfig}
                    onChange={(e) => {
                      const next = e.target.value;
                      const nextApiKey = extractCodexAuthApiKey(next);
                      setAuthConfig(next);
                      if (nextApiKey && nextApiKey !== CODEX_TOKEN_PLACEHOLDER) {
                        setApiKey(nextApiKey);
                      }
                    }}
                    rows={4}
                    spellCheck={false}
                    className="min-h-28 resize-y font-mono text-[11px]"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-[10px]" title={config?.path}>
                      完整 config.toml
                    </Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[10px]"
                      onClick={() => setExtraConfig(buildCurrentFullConfig())}
                    >
                      同步表单
                    </Button>
                  </div>
                  <Textarea
                    value={extraConfig}
                    onChange={(e) => {
                      const next = e.target.value;
                      const nextApiKey = extractCodexConfigApiKey(next);
                      setExtraConfig(next);
                      if (nextApiKey && nextApiKey !== CODEX_TOKEN_PLACEHOLDER) {
                        setApiKey(nextApiKey);
                      }
                    }}
                    rows={10}
                    spellCheck={false}
                    className="min-h-64 resize-y font-mono text-[11px]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 保存按钮 */}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Spinner className="size-4 mr-2" /> : null}
            保存配置
          </Button>
        </>
      )}
    </div>
  );
}
