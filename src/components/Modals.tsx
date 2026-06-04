import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import {
  Anthropic,
  ClaudeCode,
  Codex,
  DeepSeek,
  Kimi,
  Minimax,
  NewAPI,
  OpenAI,
  XiaomiMiMo,
  Zhipu,
} from "@lobehub/icons";
import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Github,
  Gauge,
  KeyRound,
  Loader2,
  Plus,
  Save,
  Server,
  RotateCcw,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useModalStore } from "../stores/modalStore";
import { useSettingsStore, type CursorStyle } from "../stores/settingsStore";
import {
  useSessionMenuStore,
  type SessionMenuItem,
} from "../stores/sessionMenuStore";
import { useThemeStore, applyThemeToDOM } from "../stores/themeStore";
import { FAMILIES } from "../themes";
import type { ShellKind } from "../stores/sessionStore";
import type { SettingsTab } from "../stores/modalStore";

const SHELL_OPTIONS: { value: ShellKind; label: string }[] = [
  { value: "powerShell", label: "PowerShell" },
  { value: "pwsh", label: "PowerShell 7" },
  { value: "cmd", label: "CMD" },
  { value: "wsl", label: "WSL" },
  { value: "gitBash", label: "Git Bash" },
];

const CURSOR_OPTIONS: { value: CursorStyle; label: string }[] = [
  { value: "bar", label: "竖线" },
  { value: "block", label: "方块" },
  { value: "underline", label: "下划线" },
];

const PROJECT_REPOSITORY_URL = "https://github.com/xuya-dev/XuYa-Terminal";
const APP_VERSION = "0.1.4";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "none"
  | "error";

interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: "appearance", label: "外观" },
  { value: "terminal", label: "终端" },
  { value: "agents", label: "AI 配置" },
  { value: "sessions", label: "会话菜单" },
];

type AgentTool = "claude" | "codex";
type AgentQuotaProviderType = "" | "newapi" | "sub2api";

interface AgentProviderOption {
  id: string;
  label: string;
  baseUrl: string;
  model?: string;
  haikuModel?: string;
  haikuModelName?: string;
  sonnetModel?: string;
  sonnetModelName?: string;
  opusModel?: string;
  opusModelName?: string;
  color: string;
  icon: ReactNode;
}

type ClaudeRole = "opus" | "sonnet" | "haiku";

interface AgentDraft {
  providerId: string;
  customName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  haikuModel: string;
  haikuModelName: string;
  sonnetModel: string;
  sonnetModelName: string;
  opusModel: string;
  opusModelName: string;
  extraConfig: string;
  authConfig: string;
  quotaProviderType: AgentQuotaProviderType;
  quotaBaseUrl: string;
  quotaApiKey: string;
  quotaAccessToken: string;
  quotaUserId: string;
}

interface AgentCustomProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  endpoint: string;
  apiKey?: string | null;
  model?: string | null;
  haikuModel?: string | null;
  haikuModelName?: string | null;
  sonnetModel?: string | null;
  sonnetModelName?: string | null;
  opusModel?: string | null;
  opusModelName?: string | null;
  extraConfig?: string | null;
  quotaProviderType?: AgentQuotaProviderType | null;
  quotaBaseUrl?: string | null;
  quotaApiKey?: string | null;
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
  haikuModel?: string | null;
  haikuModelName?: string | null;
  sonnetModel?: string | null;
  sonnetModelName?: string | null;
  opusModel?: string | null;
  opusModelName?: string | null;
  extraConfig?: string | null;
  authConfig?: string | null;
  tokenConfigured: boolean;
}

interface AgentToolConfigState {
  path: string;
  exists: boolean;
  activeProvider?: string | null;
  baseUrl?: string | null;
  endpoint?: string | null;
  model?: string | null;
  haikuModel?: string | null;
  haikuModelName?: string | null;
  sonnetModel?: string | null;
  sonnetModelName?: string | null;
  opusModel?: string | null;
  opusModelName?: string | null;
  extraConfig?: string | null;
  authPath?: string | null;
  authExists: boolean;
  authConfig?: string | null;
  apiKey?: string | null;
  tokenConfigured: boolean;
  builtInProviders: AgentBuiltInProviderSummary[];
  customProviders: AgentCustomProviderSummary[];
}

interface AgentConfigState {
  claude: AgentToolConfigState;
  codex: AgentToolConfigState;
}

interface AgentConfigApplyResult {
  tool: AgentTool;
  providerId: string;
  path: string;
  baseUrl?: string | null;
  endpoint?: string | null;
}

interface AgentFetchedModel {
  id: string;
  ownedBy?: string | null;
}

interface AgentModelFetchResult {
  endpoint: string;
  models: AgentFetchedModel[];
}

type AgentConfigMessage = {
  tone: "success" | "error" | "info";
  text: string;
};

const CLAUDE_PROVIDER_OPTIONS: AgentProviderOption[] = [
  {
    id: "official",
    label: "官方",
    baseUrl: "",
    color: "#D4915D",
    icon: <Anthropic size={14} />,
  },
  {
    id: "zhipu",
    label: "ZhiPu GLM",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    haikuModel: "glm-5.1",
    sonnetModel: "glm-5.1",
    opusModel: "glm-5.1",
    color: "#0F62FE",
    icon: <Zhipu size={14} />,
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimaxi.com/anthropic",
    haikuModel: "MiniMax-M2.7",
    sonnetModel: "MiniMax-M2.7",
    opusModel: "MiniMax-M2.7",
    color: "#FF6B6B",
    icon: <Minimax size={14} />,
  },
  {
    id: "kimi",
    label: "Kimi",
    baseUrl: "https://api.kimi.com/coding",
    haikuModel: "kimi-k2.6",
    sonnetModel: "kimi-k2.6",
    opusModel: "kimi-k2.6",
    color: "#6366F1",
    icon: <Kimi size={14} />,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/anthropic",
    haikuModel: "deepseek-v4-flash",
    sonnetModel: "deepseek-v4-pro",
    opusModel: "deepseek-v4-pro",
    color: "#1E88E5",
    icon: <DeepSeek size={14} />,
  },
  {
    id: "xiaomimimo",
    label: "XiaoMi Mimo",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
    haikuModel: "mimo-v2.5-pro",
    sonnetModel: "mimo-v2.5-pro",
    opusModel: "mimo-v2.5-pro",
    color: "#FF6900",
    icon: <XiaomiMiMo size={14} />,
  },
  {
    id: "custom",
    label: "自定义",
    baseUrl: "",
    color: "#8B5CF6",
    icon: <NewAPI size={14} />,
  },
];

const CODEX_DEFAULT_MODEL = "gpt-5.5";

const CODEX_PROVIDER_OPTIONS: AgentProviderOption[] = [
  {
    id: "official",
    label: "官方",
    baseUrl: "",
    model: CODEX_DEFAULT_MODEL,
    color: "#00A67E",
    icon: <OpenAI size={14} />,
  },
  {
    id: "custom",
    label: "自定义",
    baseUrl: "",
    model: CODEX_DEFAULT_MODEL,
    color: "#8B5CF6",
    icon: <NewAPI size={14} />,
  },
];

const CLAUDE_LEGACY_BUILTIN_FALLBACK_MODELS: Record<string, string> = {
  zhipu: "glm-5.1",
  minimax: "MiniMax-M2.7",
  kimi: "kimi-k2.6",
  deepseek: "deepseek-v4-pro",
  xiaomimimo: "mimo-v2.5-pro",
};

const AGENT_DRAFT_KEYS: Record<AgentTool, string> = {
  claude: "xuya-agent-config-claude",
  codex: "xuya-agent-config-codex",
};

const QUOTA_PROVIDER_OPTIONS: { value: AgentQuotaProviderType; label: string }[] = [
  { value: "", label: "不查询" },
  { value: "sub2api", label: "Sub2API" },
  { value: "newapi", label: "New API" },
];

/** Shared centered-modal shell with overlay + Esc-to-close. */
function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="xy-modal-overlay" onClick={onClose}>
      <div
        className="xy-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="xy-modal-head">
          <span className="xy-modal-title">{title}</span>
          <button className="xy-icon-btn" onClick={onClose} title="关闭">
            <X size={16} strokeWidth={1.7} />
          </button>
        </div>
        <div className="xy-modal-body">{children}</div>
        {footer && <div className="xy-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** A labelled settings row: title + optional hint on the left, control on the right. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="xy-set-row">
      <div className="xy-set-row-text">
        <span className="xy-set-row-label">{label}</span>
        {hint && <span className="xy-set-row-hint">{hint}</span>}
      </div>
      <div className="xy-set-row-control">{children}</div>
    </div>
  );
}

/** Segmented control — a row of mutually-exclusive pills. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="xy-segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={`xy-seg-item ${o.value === value ? "is-active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function providerOptionsFor(tool: AgentTool) {
  return tool === "claude" ? CLAUDE_PROVIDER_OPTIONS : CODEX_PROVIDER_OPTIONS;
}

function isCustomProviderId(providerId: string) {
  return providerId === "custom" || providerId.startsWith("custom:");
}

function customProviderId(providerId: string) {
  return providerId.startsWith("custom:") ? providerId.slice(7) : undefined;
}

function customProviderSelector(id: string) {
  return `custom:${id}`;
}

function defaultCustomModel(tool: AgentTool) {
  return tool === "codex" ? CODEX_DEFAULT_MODEL : "";
}

function roleModelFallback(provider: AgentProviderOption, role: ClaudeRole) {
  if (role === "haiku") return provider.haikuModel ?? provider.model ?? "";
  if (role === "sonnet") return provider.sonnetModel ?? provider.model ?? "";
  return provider.opusModel ?? provider.model ?? "";
}

const CLAUDE_TOKEN_PLACEHOLDER = "${ANTHROPIC_AUTH_TOKEN}";
const CODEX_TOKEN_PLACEHOLDER = "${CODEX_API_KEY}";
const CLAUDE_ONE_M_MARKER = "[1M]";

const CLAUDE_ROLE_ROWS: {
  role: ClaudeRole;
  label: string;
  modelKey: "opusModel" | "sonnetModel" | "haikuModel";
  nameKey: "opusModelName" | "sonnetModelName" | "haikuModelName";
  placeholder: string;
}[] = [
  {
    role: "opus",
    label: "Opus",
    modelKey: "opusModel",
    nameKey: "opusModelName",
    placeholder: "claude-opus / deepseek-v4-pro",
  },
  {
    role: "sonnet",
    label: "Sonnet",
    modelKey: "sonnetModel",
    nameKey: "sonnetModelName",
    placeholder: "claude-sonnet / deepseek-v4-pro",
  },
  {
    role: "haiku",
    label: "Haiku",
    modelKey: "haikuModel",
    nameKey: "haikuModelName",
    placeholder: "claude-haiku / deepseek-v4-flash",
  },
];

function hasClaudeOneMMarker(model: string) {
  return model.trimEnd().toLowerCase().endsWith("[1m]");
}

function stripClaudeOneMMarker(model: string) {
  const trimmedEnd = model.trimEnd();
  if (!trimmedEnd.toLowerCase().endsWith("[1m]")) return model;
  return trimmedEnd.slice(0, -CLAUDE_ONE_M_MARKER.length).trimEnd();
}

function setClaudeOneMMarker(model: string, enabled: boolean) {
  const base = stripClaudeOneMMarker(model).trim();
  if (!base) return "";
  return enabled ? `${base}${CLAUDE_ONE_M_MARKER}` : base;
}

function roleModelNameFallback(provider: AgentProviderOption, role: ClaudeRole) {
  if (role === "haiku") {
    return provider.haikuModelName ?? stripClaudeOneMMarker(roleModelFallback(provider, role));
  }
  if (role === "sonnet") {
    return provider.sonnetModelName ?? stripClaudeOneMMarker(roleModelFallback(provider, role));
  }
  return provider.opusModelName ?? stripClaudeOneMMarker(roleModelFallback(provider, role));
}

const CODEX_MANAGED_TOP_LEVEL_KEYS = new Set([
  "base_url",
  "disable_response_storage",
  "env_key",
  "experimental_bearer_token",
  "model_provider",
  "model",
  "model_reasoning_effort",
  "requires_openai_auth",
  "wire_api",
]);

function findProvider(tool: AgentTool, providerId: string) {
  const options = providerOptionsFor(tool);
  if (isCustomProviderId(providerId)) {
    return options.find((option) => option.id === "custom") ?? options[0];
  }
  return options.find((option) => option.id === providerId) ?? options[0];
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

function slugifyProviderId(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "custom";
}

function codexConfigProviderId(draft: AgentDraft) {
  const id = customProviderId(draft.providerId);
  return `xuya_custom_${slugifyProviderId(id || draft.customName || "custom")}`;
}

function tryParseObjectConfig(value: string) {
  if (!value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function buildClaudeFullConfig(draft: AgentDraft, baseConfig?: string) {
  const provider = findProvider("claude", draft.providerId);
  const usesOfficial = !isCustomProviderId(draft.providerId) && provider.id === "official";
  const config = tryParseObjectConfig(baseConfig ?? draft.extraConfig);
  const rawEnv = config.env;
  const env =
    rawEnv && typeof rawEnv === "object" && !Array.isArray(rawEnv)
      ? { ...(rawEnv as Record<string, unknown>) }
      : {};

  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_MODEL;
  delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME;
  delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  delete env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME;
  delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  delete env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME;

  if (!usesOfficial && draft.baseUrl.trim()) {
    env.ANTHROPIC_BASE_URL = normalizeClaudeBaseUrlForPreview(draft.baseUrl);
    env.ANTHROPIC_AUTH_TOKEN =
      draft.apiKey.trim() || CLAUDE_TOKEN_PLACEHOLDER;
  }
  if (draft.model.trim()) env.ANTHROPIC_MODEL = draft.model.trim();
  if (draft.haikuModel.trim()) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = draft.haikuModel.trim();
  }
  if (draft.haikuModelName.trim()) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME = draft.haikuModelName.trim();
  }
  if (draft.sonnetModel.trim()) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = draft.sonnetModel.trim();
  }
  if (draft.sonnetModelName.trim()) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME = draft.sonnetModelName.trim();
  }
  if (draft.opusModel.trim()) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = draft.opusModel.trim();
  }
  if (draft.opusModelName.trim()) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = draft.opusModelName.trim();
  }

  const next = { ...config };
  if (Object.keys(env).length > 0) {
    next.env = env;
  } else {
    delete next.env;
  }
  return JSON.stringify(next, null, 2);
}

function buildCodexAuthConfig(draft: AgentDraft, baseConfig?: string) {
  const provider = findProvider("codex", draft.providerId);
  const usesOfficial = !isCustomProviderId(draft.providerId) && provider.id === "official";
  const config = tryParseObjectConfig(baseConfig ?? draft.authConfig);
  if (!usesOfficial) {
    config.OPENAI_API_KEY = draft.apiKey.trim() || CODEX_TOKEN_PLACEHOLDER;
  } else if (draft.apiKey.trim()) {
    config.OPENAI_API_KEY = draft.apiKey.trim();
  }
  return JSON.stringify(config, null, 2);
}

function parseTomlSectionHeader(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined;
  return trimmed.slice(1, -1).trim() || undefined;
}

function tomlLineKey(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) {
    return undefined;
  }
  const index = trimmed.indexOf("=");
  if (index === -1) return undefined;
  return trimmed.slice(0, index).trim() || undefined;
}

function parseTomlStringValue(line: string) {
  const index = line.indexOf("=");
  if (index === -1) return undefined;
  const raw = line
    .slice(index + 1)
    .split("#")[0]
    .trim();
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return raw
      .replace(/^['"]/, "")
      .replace(/['"]$/, "")
      .trim();
  }
}

function extractTopLevelTomlString(text: string, key: string) {
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inSection = true;
    }
    if (inSection) continue;
    if (tomlLineKey(trimmed) === key) return parseTomlStringValue(trimmed);
  }
  return undefined;
}

function extractCodexProviderTomlString(
  text: string,
  provider: string,
  key: string,
) {
  const targetSection = `model_providers.${provider}`;
  let inTargetSection = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const section = parseTomlSectionHeader(trimmed);
    if (section) {
      inTargetSection = section === targetSection;
      continue;
    }
    if (inTargetSection && tomlLineKey(trimmed) === key) {
      return parseTomlStringValue(trimmed);
    }
  }
  return undefined;
}

function inferCodexCustomName(extraConfig?: string | null) {
  if (!extraConfig) return "";
  const provider = extractTopLevelTomlString(extraConfig, "model_provider");
  if (!provider || provider === "openai") return "";
  return (
    extractCodexProviderTomlString(extraConfig, provider, "name") ??
    provider.replace(/^xuya_custom_?/, "")
  );
}

function extractCodexAuthApiKey(authConfig: string) {
  try {
    const parsed = JSON.parse(authConfig) as Record<string, unknown>;
    return typeof parsed.OPENAI_API_KEY === "string"
      ? parsed.OPENAI_API_KEY.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function extractCodexConfigApiKey(config: string) {
  const provider = extractTopLevelTomlString(config, "model_provider");
  const providerToken = provider
    ? extractCodexProviderTomlString(
        config,
        provider,
        "experimental_bearer_token",
      )
    : undefined;
  return (
    providerToken ??
    extractTopLevelTomlString(config, "experimental_bearer_token")
  );
}

function isCodexProviderSection(section: string) {
  return section === "model_providers" || section.startsWith("model_providers.");
}

function stripCodexManagedConfig(text: string) {
  const output: string[] = [];
  let section: string | undefined;
  let skippingManagedSection = false;
  let skippingLegacyExtra = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "# XuYa custom config begin") {
      skippingLegacyExtra = true;
      continue;
    }
    if (trimmed === "# XuYa custom config end") {
      skippingLegacyExtra = false;
      continue;
    }
    if (skippingLegacyExtra || trimmed === "# Managed by XuYa Terminal.") {
      continue;
    }

    const header = parseTomlSectionHeader(trimmed);
    if (header) {
      section = header;
      skippingManagedSection = isCodexProviderSection(header);
    }
    if (skippingManagedSection) continue;
    if (!section && CODEX_MANAGED_TOP_LEVEL_KEYS.has(tomlLineKey(trimmed) ?? "")) {
      continue;
    }
    output.push(line);
  }

  return output.join("\n").trim();
}

function mergeCodexConfig(prefix: string, preserved: string) {
  const blocks = [prefix.trim(), preserved.trim()].filter(Boolean);
  return `${blocks.join("\n\n")}\n`;
}

function buildCodexFullConfig(draft: AgentDraft, baseConfig?: string) {
  const provider = findProvider("codex", draft.providerId);
  const preserved = stripCodexManagedConfig(baseConfig ?? draft.extraConfig);
  const model = draft.model.trim() || provider.model || CODEX_DEFAULT_MODEL;
  if (provider.id === "official" && !isCustomProviderId(draft.providerId)) {
    return mergeCodexConfig(
      `model_provider = "openai"\nmodel = ${tomlString(model)}`,
      preserved,
    );
  }

  const providerId = codexConfigProviderId(draft);
  const providerName = draft.customName.trim() || "XuYa Custom";
  const baseUrl = normalizeCodexBaseUrlForPreview(draft.baseUrl);
  return mergeCodexConfig(
    `# Managed by XuYa Terminal.
model_provider = "${providerId}"
model = ${tomlString(model)}
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.${providerId}]
name = ${tomlString(providerName)}
base_url = ${tomlString(baseUrl)}
wire_api = "responses"
experimental_bearer_token = ${tomlString(draft.apiKey.trim() || CODEX_TOKEN_PLACEHOLDER)}`,
    preserved,
  );
}

function buildAgentFullConfig(tool: AgentTool, draft: AgentDraft, baseConfig?: string) {
  return tool === "claude"
    ? buildClaudeFullConfig(draft, baseConfig)
    : buildCodexFullConfig(draft, baseConfig);
}

function draftWithFullConfig(tool: AgentTool, draft: AgentDraft) {
  return {
    ...draft,
    extraConfig: draft.extraConfig.trim()
      ? draft.extraConfig
      : buildAgentFullConfig(tool, draft),
    authConfig:
      tool === "codex"
        ? draft.authConfig.trim()
          ? draft.authConfig
          : buildCodexAuthConfig(draft)
        : draft.authConfig,
  };
}

function sanitizeFullConfigForStorage(tool: AgentTool, value: string) {
  const text = value.trim() ? value : "";
  if (!text) return text;

  if (tool === "claude") {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const env = parsed.env;
      if (env && typeof env === "object" && !Array.isArray(env)) {
        const nextEnv = { ...(env as Record<string, unknown>) };
        for (const key of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]) {
          if (typeof nextEnv[key] === "string" && nextEnv[key].trim()) {
            nextEnv[key] = CLAUDE_TOKEN_PLACEHOLDER;
          }
        }
        return JSON.stringify({ ...parsed, env: nextEnv }, null, 2);
      }
    } catch {
      // Keep the user's in-progress text shape while removing obvious tokens.
    }

    return text.replace(
      /("(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY)"\s*:\s*")([^"]*)(")/g,
      (_match, prefix: string, _token: string, suffix: string) =>
        `${prefix}${CLAUDE_TOKEN_PLACEHOLDER}${suffix}`,
    );
  }

  return text.replace(
    /^(\s*experimental_bearer_token\s*=\s*)(["'])(.*?)(\2)/gm,
    (_match, prefix: string, quote: string) =>
      `${prefix}${quote}${CODEX_TOKEN_PLACEHOLDER}${quote}`,
  );
}

function sanitizeCodexAuthConfigForStorage(value: string) {
  const text = value.trim() ? value : "";
  if (!text) return text;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.trim()) {
      parsed.OPENAI_API_KEY = CODEX_TOKEN_PLACEHOLDER;
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text.replace(
      /("OPENAI_API_KEY"\s*:\s*")([^"]*)(")/g,
      (_match, prefix: string, _token: string, suffix: string) =>
        `${prefix}${CODEX_TOKEN_PLACEHOLDER}${suffix}`,
    );
  }
}

function stringField(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function builtInFallbackModel(
  tool: AgentTool,
  provider: AgentProviderOption,
  saved?: Pick<AgentBuiltInProviderSummary, "model">,
) {
  const model = stringField(saved?.model, provider.model ?? "");
  if (
    tool === "claude" &&
    model &&
    model === CLAUDE_LEGACY_BUILTIN_FALLBACK_MODELS[provider.id]
  ) {
    return "";
  }
  return model;
}

function quotaProviderTypeField(value: unknown): AgentQuotaProviderType {
  return value === "newapi" || value === "sub2api" ? value : "";
}

function builtInProviderDraft(
  tool: AgentTool,
  provider: AgentProviderOption,
  current: AgentDraft,
  saved?: AgentBuiltInProviderSummary,
) {
  const next: AgentDraft = {
    ...current,
    providerId: provider.id,
    customName: "",
    baseUrl: stringField(saved?.baseUrl, provider.baseUrl),
    apiKey: stringField(saved?.apiKey, ""),
    model: builtInFallbackModel(tool, provider, saved),
    haikuModel: stringField(
      saved?.haikuModel,
      roleModelFallback(provider, "haiku"),
    ),
    haikuModelName: stringField(
      saved?.haikuModelName,
      roleModelNameFallback(provider, "haiku"),
    ),
    sonnetModel: stringField(
      saved?.sonnetModel,
      roleModelFallback(provider, "sonnet"),
    ),
    sonnetModelName: stringField(
      saved?.sonnetModelName,
      roleModelNameFallback(provider, "sonnet"),
    ),
    opusModel: stringField(
      saved?.opusModel,
      roleModelFallback(provider, "opus"),
    ),
    opusModelName: stringField(
      saved?.opusModelName,
      roleModelNameFallback(provider, "opus"),
    ),
    extraConfig: stringField(saved?.extraConfig, ""),
    authConfig: tool === "codex" ? stringField(saved?.authConfig, "") : "",
    quotaProviderType: "",
    quotaBaseUrl: "",
    quotaApiKey: "",
    quotaAccessToken: "",
    quotaUserId: "",
  };
  return {
    ...next,
    extraConfig: next.extraConfig.trim()
      ? next.extraConfig
      : buildAgentFullConfig(tool, next, current.extraConfig),
    authConfig:
      tool === "codex"
        ? next.authConfig.trim()
          ? next.authConfig
          : buildCodexAuthConfig(next, current.authConfig)
        : "",
  };
}

function defaultAgentDraft(tool: AgentTool): AgentDraft {
  const provider = providerOptionsFor(tool)[0];
  const draft: AgentDraft = {
    providerId: provider.id,
    customName: "",
    baseUrl: provider.baseUrl,
    apiKey: "",
    model: provider.model ?? "",
    haikuModel: roleModelFallback(provider, "haiku"),
    haikuModelName: roleModelNameFallback(provider, "haiku"),
    sonnetModel: roleModelFallback(provider, "sonnet"),
    sonnetModelName: roleModelNameFallback(provider, "sonnet"),
    opusModel: roleModelFallback(provider, "opus"),
    opusModelName: roleModelNameFallback(provider, "opus"),
    extraConfig: "",
    authConfig: "",
    quotaProviderType: "",
    quotaBaseUrl: "",
    quotaApiKey: "",
    quotaAccessToken: "",
    quotaUserId: "",
  };
  return {
    ...draft,
    extraConfig: buildAgentFullConfig(tool, draft, ""),
    authConfig: tool === "codex" ? buildCodexAuthConfig(draft, "") : "",
  };
}

function loadAgentDraft(tool: AgentTool): AgentDraft {
  const fallback = defaultAgentDraft(tool);
  const raw = localStorage.getItem(AGENT_DRAFT_KEYS[tool]);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<AgentDraft>;
    const parsedProviderId =
      typeof parsed.providerId === "string"
        ? parsed.providerId
        : fallback.providerId;
    const provider = findProvider(tool, parsedProviderId);
    const draft = {
      providerId: isCustomProviderId(parsedProviderId)
        ? parsedProviderId
        : provider.id,
      customName:
        typeof parsed.customName === "string" ? parsed.customName : "",
      baseUrl:
        (typeof parsed.baseUrl === "string" ? parsed.baseUrl : provider.baseUrl),
      apiKey: "",
      model:
        (typeof parsed.model === "string"
          ? parsed.model
          : (provider.model ?? "")),
      haikuModel:
        (typeof parsed.haikuModel === "string"
          ? parsed.haikuModel
          : roleModelFallback(provider, "haiku")),
      haikuModelName:
        (typeof parsed.haikuModelName === "string"
          ? parsed.haikuModelName
          : stripClaudeOneMMarker(
              typeof parsed.haikuModel === "string"
                ? parsed.haikuModel
                : roleModelFallback(provider, "haiku"),
            )),
      sonnetModel:
        (typeof parsed.sonnetModel === "string"
          ? parsed.sonnetModel
          : roleModelFallback(provider, "sonnet")),
      sonnetModelName:
        (typeof parsed.sonnetModelName === "string"
          ? parsed.sonnetModelName
          : stripClaudeOneMMarker(
              typeof parsed.sonnetModel === "string"
                ? parsed.sonnetModel
                : roleModelFallback(provider, "sonnet"),
            )),
      opusModel:
        (typeof parsed.opusModel === "string"
          ? parsed.opusModel
          : roleModelFallback(provider, "opus")),
      opusModelName:
        (typeof parsed.opusModelName === "string"
          ? parsed.opusModelName
          : stripClaudeOneMMarker(
              typeof parsed.opusModel === "string"
                ? parsed.opusModel
                : roleModelFallback(provider, "opus"),
            )),
      extraConfig:
        (typeof parsed.extraConfig === "string"
          ? sanitizeFullConfigForStorage(tool, parsed.extraConfig)
          : ""),
      authConfig:
        (typeof parsed.authConfig === "string"
          ? sanitizeCodexAuthConfigForStorage(parsed.authConfig)
          : ""),
      quotaProviderType: quotaProviderTypeField(parsed.quotaProviderType),
      quotaBaseUrl: "",
      quotaApiKey: "",
      quotaAccessToken: "",
      quotaUserId:
        typeof parsed.quotaUserId === "string" ? parsed.quotaUserId : "",
    };
    return {
      ...draft,
      extraConfig: draft.extraConfig.trim()
        ? draft.extraConfig
        : buildAgentFullConfig(tool, draft, ""),
      authConfig:
        tool === "codex"
          ? draft.authConfig.trim()
            ? draft.authConfig
            : buildCodexAuthConfig(draft, "")
          : "",
    };
  } catch {
    return fallback;
  }
}

function persistAgentDraft(tool: AgentTool, draft: AgentDraft) {
  localStorage.setItem(
    AGENT_DRAFT_KEYS[tool],
    JSON.stringify({
      providerId: draft.providerId,
      customName: draft.customName,
      baseUrl: draft.baseUrl,
      model: draft.model,
      haikuModel: draft.haikuModel,
      haikuModelName: draft.haikuModelName,
      sonnetModel: draft.sonnetModel,
      sonnetModelName: draft.sonnetModelName,
      opusModel: draft.opusModel,
      opusModelName: draft.opusModelName,
      extraConfig: sanitizeFullConfigForStorage(tool, draft.extraConfig),
      authConfig:
        tool === "codex"
          ? sanitizeCodexAuthConfigForStorage(draft.authConfig)
          : "",
      quotaProviderType: draft.quotaProviderType,
      quotaUserId: draft.quotaUserId,
    }),
  );
}

function normalizeClaudeBaseUrlForPreview(value: string) {
  let base = value.trim().replace(/\/+$/, "");
  base = base.replace(/\/v1\/messages$/i, "");
  base = base.replace(/\/messages$/i, "");
  base = base.replace(/\/v1$/i, "");
  return base;
}

function normalizeCodexBaseUrlForPreview(value: string) {
  let base = value.trim().replace(/\/+$/, "");
  base = base.replace(/\/responses$/i, "");
  if (base && !/\/v1$/i.test(base)) base = `${base}/v1`;
  return base;
}

function endpointPreview(tool: AgentTool, baseUrl: string) {
  if (!baseUrl.trim()) return "";
  if (tool === "claude") {
    const base = normalizeClaudeBaseUrlForPreview(baseUrl);
    return base ? `${base}/v1/messages` : "";
  }
  const base = normalizeCodexBaseUrlForPreview(baseUrl);
  return base ? `${base}/responses` : "";
}

function isSameAgentBaseUrl(tool: AgentTool, left?: string | null, right?: string | null) {
  if (!left || !right) return false;
  const normalize =
    tool === "claude"
      ? normalizeClaudeBaseUrlForPreview
      : normalizeCodexBaseUrlForPreview;
  return normalize(left).toLowerCase() === normalize(right).toLowerCase();
}

function basenamePath(path?: string | null) {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").slice(-2).join("/");
}

function resolveStateProviderId(tool: AgentTool, activeProvider?: string | null) {
  if (!activeProvider) return undefined;
  if (activeProvider === "openai") return "official";
  if (isCustomProviderId(activeProvider)) return activeProvider;
  if (providerOptionsFor(tool).some((provider) => provider.id === activeProvider)) {
    return activeProvider;
  }
  return "custom";
}

function findCustomProvider(
  providerId: string,
  customProviders?: AgentCustomProviderSummary[],
) {
  const id = customProviderId(providerId);
  if (!id) return undefined;
  return customProviders?.find((provider) => provider.id === id);
}

function findBuiltInProvider(
  providerId: string,
  builtInProviders?: AgentBuiltInProviderSummary[],
) {
  if (isCustomProviderId(providerId)) return undefined;
  return builtInProviders?.find((provider) => provider.id === providerId);
}

function upsertBuiltInProviderSummary(
  providers: AgentBuiltInProviderSummary[],
  next: AgentBuiltInProviderSummary,
) {
  const index = providers.findIndex((provider) => provider.id === next.id);
  if (index === -1) return [...providers, next];
  return providers.map((provider, providerIndex) =>
    providerIndex === index ? next : provider,
  );
}

function draftFromConfigState(
  tool: AgentTool,
  config: AgentToolConfigState,
  current: AgentDraft,
) {
  if (
    !config.activeProvider &&
    !config.baseUrl &&
    !config.extraConfig &&
    config.builtInProviders.length === 0
  ) {
    return current;
  }

  const providerId =
    resolveStateProviderId(tool, config.activeProvider) ?? current.providerId;
  const provider = findProvider(tool, providerId);
  const customProvider = findCustomProvider(providerId, config.customProviders);
  const builtInProvider = findBuiltInProvider(
    providerId,
    config.builtInProviders,
  );
  const configModel =
    typeof config.model === "string" &&
    !isCustomProviderId(providerId) &&
    tool === "claude"
      ? builtInFallbackModel(tool, provider, { model: config.model })
      : config.model;
  const savedBuiltInModel = !isCustomProviderId(providerId)
    ? builtInFallbackModel(tool, provider, builtInProvider)
    : undefined;
  const model =
    customProvider?.model ??
    configModel ??
    savedBuiltInModel ??
    provider.model ??
    (isCustomProviderId(providerId) ? current.model : "");
  const haikuModel =
    tool === "claude"
      ? customProvider?.haikuModel ??
        config.haikuModel ??
        builtInProvider?.haikuModel ??
        roleModelFallback(provider, "haiku") ??
        current.haikuModel
      : current.haikuModel;
  const sonnetModel =
    tool === "claude"
      ? customProvider?.sonnetModel ??
        config.sonnetModel ??
        builtInProvider?.sonnetModel ??
        roleModelFallback(provider, "sonnet") ??
        current.sonnetModel
      : current.sonnetModel;
  const opusModel =
    tool === "claude"
      ? customProvider?.opusModel ??
        config.opusModel ??
        builtInProvider?.opusModel ??
        roleModelFallback(provider, "opus") ??
        current.opusModel
      : current.opusModel;
  const next: AgentDraft = {
    ...current,
    providerId,
    customName:
      customProvider?.name ??
      (tool === "codex" && providerId === "custom"
        ? inferCodexCustomName(config.extraConfig)
        : current.customName),
    baseUrl:
      customProvider?.baseUrl ??
      config.baseUrl ??
      builtInProvider?.baseUrl ??
      provider.baseUrl,
    apiKey: customProvider?.apiKey ?? config.apiKey ?? builtInProvider?.apiKey ?? "",
    model,
    haikuModel,
    haikuModelName:
      tool === "claude"
        ? customProvider?.haikuModelName ??
          config.haikuModelName ??
          builtInProvider?.haikuModelName ??
          stripClaudeOneMMarker(haikuModel)
        : current.haikuModelName,
    sonnetModel,
    sonnetModelName:
      tool === "claude"
        ? customProvider?.sonnetModelName ??
          config.sonnetModelName ??
          builtInProvider?.sonnetModelName ??
          stripClaudeOneMMarker(sonnetModel)
        : current.sonnetModelName,
    opusModel,
    opusModelName:
      tool === "claude"
        ? customProvider?.opusModelName ??
          config.opusModelName ??
          builtInProvider?.opusModelName ??
          stripClaudeOneMMarker(opusModel)
        : current.opusModelName,
    extraConfig:
      config.extraConfig ??
      customProvider?.extraConfig ??
      builtInProvider?.extraConfig ??
      current.extraConfig,
    authConfig:
      tool === "codex"
        ? config.authConfig ??
          builtInProvider?.authConfig ??
          buildCodexAuthConfig(
            {
              ...current,
              apiKey:
                customProvider?.apiKey ??
                config.apiKey ??
                builtInProvider?.apiKey ??
                "",
            },
            current.authConfig,
          )
        : "",
    quotaProviderType: isCustomProviderId(providerId)
      ? quotaProviderTypeField(customProvider?.quotaProviderType)
      : "",
    quotaBaseUrl: "",
    quotaApiKey: "",
    quotaAccessToken: isCustomProviderId(providerId)
      ? customProvider?.quotaAccessToken ?? ""
      : "",
    quotaUserId: isCustomProviderId(providerId)
      ? customProvider?.quotaUserId ?? current.quotaUserId
      : "",
  };

  const extraConfig = next.extraConfig.trim()
    ? next.extraConfig
    : buildAgentFullConfig(tool, next, current.extraConfig);

  return {
    ...next,
    extraConfig:
      tool === "codex" && next.apiKey.trim()
        ? buildCodexFullConfig(next, extraConfig)
        : extraConfig,
    authConfig:
      tool === "codex"
        ? next.authConfig.trim()
          ? next.authConfig
          : buildCodexAuthConfig(next, current.authConfig)
        : "",
  };
}

/* ──────────────────────────────────────────── */
/*  Settings modal (trimmed)                   */
/* ──────────────────────────────────────────── */

function SettingsModal() {
  const closeModal = useModalStore((s) => s.closeModal);
  const activeTab = useModalStore((s) => s.settingsTab);
  const setActiveTab = useModalStore((s) => s.setSettingsTab);
  const { family, mode, setFamily, setMode, palette } = useThemeStore();
  const committedThemeRef = useRef({ palette, mode });
  const {
    zoom,
    defaultShell,
    cursorStyle,
    cursorBlink,
    setZoom,
    zoomIn,
    zoomOut,
    setDefaultShell,
    setCursorStyle,
    setCursorBlink,
  } = useSettingsStore();

  useEffect(() => {
    committedThemeRef.current = { palette, mode };
  }, [palette, mode]);

  const reapplyCommitted = useCallback(() => {
    const theme = committedThemeRef.current;
    applyThemeToDOM(theme.palette, theme.mode);
  }, []);

  useEffect(() => () => reapplyCommitted(), [reapplyCommitted]);

  return (
    <ModalShell title="设置" onClose={closeModal}>
      <div className="xy-settings-tabs" role="tablist" aria-label="设置分类">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.value}
            className={`xy-settings-tab ${
              activeTab === tab.value ? "is-active" : ""
            }`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="xy-settings-panel" role="tabpanel">
        {activeTab === "appearance" && (
          <section className="xy-set-section">
            <h3 className="xy-set-section-title">外观</h3>

            <Row label="显示模式">
              <Segmented
                value={mode}
                options={[
                  { value: "light", label: "浅色" },
                  { value: "dark", label: "深色" },
                ]}
                onChange={setMode}
              />
            </Row>

            <Row
              label="终端字号"
              hint={`${zoom}% · ${Math.round((14 * zoom) / 100)}px`}
            >
              <div className="xy-zoom-control">
                <button className="xy-zoom-btn" onClick={zoomOut} title="缩小">
                  －
                </button>
                <input
                  className="xy-zoom-slider"
                  type="range"
                  min={50}
                  max={200}
                  step={10}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
                <button className="xy-zoom-btn" onClick={zoomIn} title="放大">
                  ＋
                </button>
              </div>
            </Row>

            <div className="xy-inline-theme-block">
              <div className="xy-set-section-head">
                <div>
                  <h3 className="xy-set-section-title">主题风格</h3>
                  <p className="xy-set-section-hint">
                    悬停卡片实时预览，点击应用
                  </p>
                </div>
              </div>
              <div className="xy-family-grid xy-family-grid--settings">
                {FAMILIES.map((f) => {
                  const isActive = f.id === family.id;
                  const p = f[mode];
                  const applyFamily = () => {
                    committedThemeRef.current = {
                      palette: f[mode],
                      mode,
                    };
                    setFamily(f.id);
                  };
                  return (
                    <button
                      key={f.id}
                      className={`xy-family-card ${isActive ? "is-active" : ""}`}
                      onMouseEnter={() => applyThemeToDOM(f[mode], mode)}
                      onMouseLeave={reapplyCommitted}
                      onClick={applyFamily}
                    >
                      <span className="xy-family-card-name">
                        {f.name.split(" / ")[0]}
                      </span>
                      <div className="xy-family-card-colors">
                        <span
                          className="xy-family-dot"
                          style={{ background: p.chrome.accent }}
                        />
                        <span
                          className="xy-family-dot"
                          style={{ background: p.chrome.success }}
                        />
                        <span
                          className="xy-family-dot"
                          style={{ background: p.chrome.warning }}
                        />
                        <span
                          className="xy-family-dot"
                          style={{ background: p.chrome.danger }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {activeTab === "terminal" && (
          <section className="xy-set-section">
            <h3 className="xy-set-section-title">终端</h3>

            <Row label="默认 Shell" hint="新建会话 / 新建标签使用">
              <Segmented
                value={defaultShell}
                options={SHELL_OPTIONS}
                onChange={setDefaultShell}
              />
            </Row>

            <Row label="光标样式">
              <Segmented
                value={cursorStyle}
                options={CURSOR_OPTIONS}
                onChange={setCursorStyle}
              />
            </Row>

            <Row label="光标闪烁">
              <button
                className={`xy-switch ${cursorBlink ? "is-on" : ""}`}
                role="switch"
                aria-checked={cursorBlink}
                onClick={() => setCursorBlink(!cursorBlink)}
              >
                <span className="xy-switch-knob" />
              </button>
            </Row>
          </section>
        )}

        {activeTab === "agents" && <AgentConfigSettings />}

        {activeTab === "sessions" && <SessionMenuSettings />}
      </div>
    </ModalShell>
  );
}

function AgentConfigSettings() {
  const [state, setState] = useState<AgentConfigState | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<AgentTool | null>(null);
  const [saving, setSaving] = useState<AgentTool | null>(null);
  const [message, setMessage] = useState<AgentConfigMessage | null>(null);
  const [activeAgent, setActiveAgent] = useState<AgentTool>("claude");
  const skipNextStateHydrationRef = useRef(false);
  const [claudeDraft, setClaudeDraft] = useState<AgentDraft>(() =>
    loadAgentDraft("claude"),
  );
  const [codexDraft, setCodexDraft] = useState<AgentDraft>(() =>
    loadAgentDraft("codex"),
  );

  const loadState = useCallback(async (options?: { hydrateTool?: AgentTool }) => {
    setLoading(true);
    try {
      const next = await invoke<AgentConfigState>("get_agent_config_state");
      setState(next);
      const tool = options?.hydrateTool;
      if (tool) {
        const config = next[tool];
        if (tool === "claude") {
          setClaudeDraft((current) =>
            draftFromConfigState("claude", config, current),
          );
        } else {
          setCodexDraft((current) =>
            draftFromConfigState("codex", config, current),
          );
        }
        setActiveAgent(tool);
        setMessage({
          tone: config.exists ? "success" : "info",
          text: config.exists
            ? `${tool === "claude" ? "Claude Code" : "Codex"} 当前配置已回显。`
            : `${tool === "claude" ? "Claude Code" : "Codex"} 配置文件还不存在。`,
        });
      }
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    if (!state) return;
    if (skipNextStateHydrationRef.current) {
      skipNextStateHydrationRef.current = false;
      return;
    }

    setClaudeDraft((current) =>
      draftFromConfigState("claude", state.claude, current),
    );
    setCodexDraft((current) =>
      draftFromConfigState("codex", state.codex, current),
    );
  }, [state]);

  useEffect(() => persistAgentDraft("claude", claudeDraft), [claudeDraft]);
  useEffect(() => persistAgentDraft("codex", codexDraft), [codexDraft]);

  const updateDraftForTool = (tool: AgentTool, patch: Partial<AgentDraft>) => {
    if (tool === "claude") {
      setClaudeDraft((current) => ({ ...current, ...patch }));
    } else {
      setCodexDraft((current) => ({ ...current, ...patch }));
    }
  };

  const saveCustomProvider = async (
    tool: AgentTool,
    draft: AgentDraft,
    options: { silent?: boolean } = {},
  ) => {
    const draftToSave = draftWithFullConfig(tool, draft);
    if (!draftToSave.customName.trim()) {
      setMessage({ tone: "error", text: "请先填写自定义厂商名称。" });
      return null;
    }
    if (!draftToSave.baseUrl.trim()) {
      setMessage({ tone: "error", text: "请先填写服务端点。" });
      return null;
    }

    const currentCustom = findCustomProvider(
      draftToSave.providerId,
      tool === "claude"
        ? state?.claude.customProviders
        : state?.codex.customProviders,
    );
    const currentToolState = tool === "claude" ? state?.claude : state?.codex;
    const canReuseCurrentToken =
      currentToolState?.tokenConfigured &&
      isSameAgentBaseUrl(tool, draftToSave.baseUrl, currentToolState.baseUrl);
    if (
      !draftToSave.apiKey.trim() &&
      !currentCustom?.tokenConfigured &&
      !canReuseCurrentToken
    ) {
      setMessage({ tone: "error", text: "请先填写 API Key。" });
      return null;
    }

    setSaving(tool);
    if (!options.silent) {
      setMessage({ tone: "info", text: "正在保存自定义厂商..." });
    }
    try {
      const saved = await invoke<AgentCustomProviderSummary>(
        "save_agent_custom_provider",
        {
          request: {
            tool,
            providerId: customProviderId(draftToSave.providerId),
            name: draftToSave.customName,
            baseUrl: draftToSave.baseUrl,
            apiKey: draftToSave.apiKey,
            model: draftToSave.model,
            haikuModel: draftToSave.haikuModel,
            haikuModelName: draftToSave.haikuModelName,
            sonnetModel: draftToSave.sonnetModel,
            sonnetModelName: draftToSave.sonnetModelName,
            opusModel: draftToSave.opusModel,
            opusModelName: draftToSave.opusModelName,
            extraConfig: draftToSave.extraConfig,
            authConfig: draftToSave.authConfig,
            quotaProviderType: draftToSave.quotaProviderType || null,
            quotaBaseUrl: "",
            quotaApiKey: "",
            quotaAccessToken: draftToSave.quotaAccessToken,
            quotaUserId: draftToSave.quotaUserId,
          },
        },
      );
      updateDraftForTool(tool, {
        providerId: customProviderSelector(saved.id),
        customName: saved.name,
        baseUrl: saved.baseUrl,
        apiKey: saved.apiKey ?? "",
        model: saved.model ?? defaultCustomModel(tool),
        haikuModel: saved.haikuModel ?? "",
        haikuModelName: saved.haikuModelName ?? "",
        sonnetModel: saved.sonnetModel ?? "",
        sonnetModelName: saved.sonnetModelName ?? "",
        opusModel: saved.opusModel ?? "",
        opusModelName: saved.opusModelName ?? "",
        extraConfig: buildAgentFullConfig(
          tool,
          {
            ...draftToSave,
            providerId: customProviderSelector(saved.id),
            customName: saved.name,
            baseUrl: saved.baseUrl,
            apiKey: saved.apiKey ?? draftToSave.apiKey,
            model: saved.model ?? defaultCustomModel(tool),
            haikuModel: saved.haikuModel ?? "",
            haikuModelName: saved.haikuModelName ?? "",
            sonnetModel: saved.sonnetModel ?? "",
            sonnetModelName: saved.sonnetModelName ?? "",
            opusModel: saved.opusModel ?? "",
            opusModelName: saved.opusModelName ?? "",
            extraConfig: "",
            authConfig: draftToSave.authConfig,
          },
          saved.extraConfig ?? draftToSave.extraConfig,
        ),
        authConfig:
          tool === "codex"
            ? buildCodexAuthConfig(
                { ...draftToSave, apiKey: saved.apiKey ?? draftToSave.apiKey },
                draftToSave.authConfig,
              )
            : "",
        quotaProviderType: quotaProviderTypeField(saved.quotaProviderType),
        quotaBaseUrl: "",
        quotaApiKey: "",
        quotaAccessToken: saved.quotaAccessToken ?? "",
        quotaUserId: saved.quotaUserId ?? "",
      });
      await loadState();
      if (!options.silent) {
        setMessage({ tone: "success", text: `${saved.name} 已保存。` });
      }
      return saved;
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      setSaving(null);
    }
  };

  const saveBuiltInProvider = async (
    tool: AgentTool,
    draft: AgentDraft,
  ) => {
    const provider = findProvider(tool, draft.providerId);
    if (isCustomProviderId(draft.providerId) || provider.id === "custom") {
      setMessage({ tone: "error", text: "自定义厂商请使用自定义保存。" });
      return;
    }
    if (provider.id !== "official" && !draft.apiKey.trim()) {
      setMessage({ tone: "error", text: "请先填写 API Key。" });
      return;
    }

    setSaving(tool);
    setMessage({ tone: "info", text: "正在保存内置厂商..." });
    try {
      const draftToSave = {
        ...draft,
        extraConfig: buildAgentFullConfig(tool, draft, draft.extraConfig),
        authConfig:
          tool === "codex"
            ? buildCodexAuthConfig(draft, draft.authConfig)
            : "",
      };
      const saved = await invoke<AgentBuiltInProviderSummary>(
        "save_agent_builtin_provider",
        {
          request: {
            tool,
            providerId: provider.id,
            baseUrl: draftToSave.baseUrl,
            apiKey: draftToSave.apiKey,
            model: draftToSave.model,
            haikuModel: draftToSave.haikuModel,
            haikuModelName: draftToSave.haikuModelName,
            sonnetModel: draftToSave.sonnetModel,
            sonnetModelName: draftToSave.sonnetModelName,
            opusModel: draftToSave.opusModel,
            opusModelName: draftToSave.opusModelName,
            extraConfig: draftToSave.extraConfig,
            authConfig: draftToSave.authConfig,
          },
        },
      );
      const nextDraft = builtInProviderDraft(tool, provider, draftToSave, saved);
      updateDraftForTool(tool, nextDraft);
      setState((current) => {
        if (!current) return current;
        skipNextStateHydrationRef.current = true;
        return {
          ...current,
          [tool]: {
            ...current[tool],
            builtInProviders: upsertBuiltInProviderSummary(
              current[tool].builtInProviders,
              saved,
            ),
          },
        };
      });
      setMessage({
        tone: "success",
        text: `${provider.label} 已保存，当前使用配置未切换。`,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(null);
    }
  };

  const deleteCustomProvider = async (tool: AgentTool, providerId: string) => {
    const target = findCustomProvider(
      providerId,
      tool === "claude"
        ? state?.claude.customProviders
        : state?.codex.customProviders,
    );
    if (!target) return;
    const confirmed = window.confirm(
      `删除自定义厂商「${target.name}」？已写入工具的当前配置不会被清理。`,
    );
    if (!confirmed) return;

    setSaving(tool);
    setMessage({ tone: "info", text: "正在删除自定义厂商..." });
    try {
      await invoke("delete_agent_custom_provider", {
        tool,
        providerId: target.id,
      });
      updateDraftForTool(tool, defaultAgentDraft(tool));
      await loadState();
      setMessage({ tone: "success", text: `${target.name} 已删除。` });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(null);
    }
  };

  const applyConfig = async (
    tool: AgentTool,
    draft: AgentDraft,
    currentState?: AgentToolConfigState,
  ) => {
    let nextDraft = draftWithFullConfig(tool, draft);
    let provider = findProvider(tool, nextDraft.providerId);
    let savedCustom: AgentCustomProviderSummary | null = null;
    if (isCustomProviderId(nextDraft.providerId)) {
      const shouldSaveCustom = Boolean(customProviderId(nextDraft.providerId));
      if (shouldSaveCustom) {
        const saved = await saveCustomProvider(tool, nextDraft, { silent: true });
        if (!saved) return;
        savedCustom = saved;
        nextDraft = {
          ...nextDraft,
          providerId: customProviderSelector(saved.id),
          customName: saved.name,
          baseUrl: saved.baseUrl,
          apiKey: saved.apiKey ?? "",
          model: saved.model ?? defaultCustomModel(tool),
          haikuModel: saved.haikuModel ?? "",
          haikuModelName: saved.haikuModelName ?? "",
          sonnetModel: saved.sonnetModel ?? "",
          sonnetModelName: saved.sonnetModelName ?? "",
          opusModel: saved.opusModel ?? "",
          opusModelName: saved.opusModelName ?? "",
          extraConfig: buildAgentFullConfig(
            tool,
            {
              ...nextDraft,
              providerId: customProviderSelector(saved.id),
              customName: saved.name,
              baseUrl: saved.baseUrl,
              apiKey: saved.apiKey ?? nextDraft.apiKey,
              model: saved.model ?? defaultCustomModel(tool),
              haikuModel: saved.haikuModel ?? "",
              haikuModelName: saved.haikuModelName ?? "",
              sonnetModel: saved.sonnetModel ?? "",
              sonnetModelName: saved.sonnetModelName ?? "",
              opusModel: saved.opusModel ?? "",
              opusModelName: saved.opusModelName ?? "",
              extraConfig: "",
              authConfig: nextDraft.authConfig,
            },
            saved.extraConfig ?? nextDraft.extraConfig,
          ),
          authConfig:
            tool === "codex"
              ? buildCodexAuthConfig(
                  { ...nextDraft, apiKey: saved.apiKey ?? nextDraft.apiKey },
                  nextDraft.authConfig,
                )
              : "",
          quotaProviderType: quotaProviderTypeField(saved.quotaProviderType),
          quotaBaseUrl: "",
          quotaApiKey: "",
          quotaAccessToken: saved.quotaAccessToken ?? "",
          quotaUserId: saved.quotaUserId ?? "",
        };
        provider = findProvider(tool, nextDraft.providerId);
      }
    }

    if (provider.id !== "official") {
      const storedCustom = findCustomProvider(
        nextDraft.providerId,
        currentState?.customProviders,
      );
      const storedBuiltIn = findBuiltInProvider(
        nextDraft.providerId,
        currentState?.builtInProviders,
      );
      if (!nextDraft.baseUrl.trim()) {
        setMessage({ tone: "error", text: "请先填写服务端点。" });
        return;
      }
      if (
        !nextDraft.apiKey.trim() &&
        !currentState?.tokenConfigured &&
        !storedCustom?.tokenConfigured &&
        !storedBuiltIn?.tokenConfigured &&
        !savedCustom?.tokenConfigured
      ) {
        setMessage({ tone: "error", text: "请先填写 API Key。" });
        return;
      }
    }

    setApplying(tool);
    setMessage({ tone: "info", text: "正在写入配置文件..." });
    try {
      const result = await invoke<AgentConfigApplyResult>(
        "apply_agent_provider_config",
        {
          request: {
            tool,
            providerId: nextDraft.providerId,
            baseUrl: nextDraft.baseUrl,
            apiKey: nextDraft.apiKey,
            model: nextDraft.model,
            haikuModel: nextDraft.haikuModel,
            haikuModelName: nextDraft.haikuModelName,
            sonnetModel: nextDraft.sonnetModel,
            sonnetModelName: nextDraft.sonnetModelName,
            opusModel: nextDraft.opusModel,
            opusModelName: nextDraft.opusModelName,
            extraConfig: nextDraft.extraConfig,
            authConfig: nextDraft.authConfig,
          },
        },
      );
      await loadState();
      const label =
        nextDraft.customName.trim() && isCustomProviderId(nextDraft.providerId)
          ? nextDraft.customName.trim()
          : provider.label;
      setMessage({
        tone: "success",
        text: `${tool === "claude" ? "Claude Code" : "Codex"} 已切换到 ${
          label
        }，写入 ${basenamePath(result.path)}。`,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setApplying(null);
    }
  };

  const countConfiguredKeys = (toolState?: AgentToolConfigState | null) => {
    if (!toolState) return 0;
    const builtinCount = toolState.builtInProviders.filter((p) => p.tokenConfigured).length;
    const customCount = toolState.customProviders.filter((p) => p.tokenConfigured).length;
    return builtinCount + customCount;
  };

  const agentTabs = [
    {
      tool: "claude" as const,
      title: "Claude Code",
      endpoint: "/v1/messages",
      icon: <ClaudeCode size={17} />,
      configured: Boolean(state?.claude.activeProvider || state?.claude.baseUrl),
      keyCount: countConfiguredKeys(state?.claude),
    },
    {
      tool: "codex" as const,
      title: "Codex",
      endpoint: "/v1/responses",
      icon: <Codex size={17} />,
      configured: Boolean(state?.codex.activeProvider || state?.codex.baseUrl),
      keyCount: countConfiguredKeys(state?.codex),
    },
  ];

  return (
    <section className="xy-set-section xy-agent-settings">
      <div className="xy-set-section-head">
        <div>
          <h3 className="xy-set-section-title">AI 配置</h3>
          <p className="xy-set-section-hint">
            只写入 Claude Code 与 Codex 的本地配置文件，不做反代转换
          </p>
        </div>
        <button
          className="xy-mini-btn"
          type="button"
          disabled={loading}
          onClick={() => void loadState()}
          title="刷新配置状态"
        >
          {loading ? (
            <Loader2 className="xy-spin" size={13} strokeWidth={1.8} />
          ) : (
            <RefreshCw size={13} strokeWidth={1.8} />
          )}
          刷新
        </button>
      </div>

      <div className="xy-agent-switch" role="tablist" aria-label="选择 AI 工具配置">
        {agentTabs.map((tab) => {
          const isActive = activeAgent === tab.tool;
          return (
            <button
              key={tab.tool}
              className={`xy-agent-switch-item ${isActive ? "is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveAgent(tab.tool)}
            >
              <span className="xy-agent-switch-icon">{tab.icon}</span>
              <span className="xy-agent-switch-text">
                <strong>{tab.title}</strong>
                <small>{tab.endpoint}</small>
              </span>
              <span
                className={`xy-agent-switch-state ${
                  tab.configured || tab.keyCount > 0 ? "is-ready" : ""
                }`}
              >
                {tab.keyCount > 0 ? `已配置 ${tab.keyCount} 个 Key` : (tab.configured ? "有配置" : "未配置")}
              </span>
            </button>
          );
        })}
      </div>

      <div className="xy-agent-single">
        {activeAgent === "claude" ? (
          <AgentConfigCard
            tool="claude"
            title="Claude Code"
            description="ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN"
            endpointLabel="/v1/messages"
            icon={<ClaudeCode size={20} />}
            providers={CLAUDE_PROVIDER_OPTIONS}
            draft={claudeDraft}
            state={state?.claude}
            reading={loading}
            applying={applying === "claude"}
            saving={saving === "claude"}
            onDraftChange={setClaudeDraft}
            onSaveCustom={() => void saveCustomProvider("claude", claudeDraft)}
            onSaveBuiltIn={() => saveBuiltInProvider("claude", claudeDraft)}
            onLoadCurrent={() => void loadState({ hydrateTool: "claude" })}
            onDeleteCustom={(providerId) =>
              void deleteCustomProvider("claude", providerId)
            }
            onApply={(nextDraft) =>
              void applyConfig("claude", nextDraft ?? claudeDraft, state?.claude)
            }
          />
        ) : (
          <AgentConfigCard
            tool="codex"
            title="Codex"
            description="model_providers.xuya_custom_* + responses"
            endpointLabel="/v1/responses"
            icon={<Codex size={20} />}
            providers={CODEX_PROVIDER_OPTIONS}
            draft={codexDraft}
            state={state?.codex}
            reading={loading}
            applying={applying === "codex"}
            saving={saving === "codex"}
            onDraftChange={setCodexDraft}
            onSaveCustom={() => void saveCustomProvider("codex", codexDraft)}
            onSaveBuiltIn={() => saveBuiltInProvider("codex", codexDraft)}
            onLoadCurrent={() => void loadState({ hydrateTool: "codex" })}
            onDeleteCustom={(providerId) =>
              void deleteCustomProvider("codex", providerId)
            }
            onApply={(nextDraft) =>
              void applyConfig("codex", nextDraft ?? codexDraft, state?.codex)
            }
          />
        )}
      </div>

      {message && (
        <div className={`xy-agent-message is-${message.tone}`}>
          {message.tone === "error" ? (
            <AlertCircle size={14} strokeWidth={1.8} />
          ) : message.tone === "success" ? (
            <CheckCircle2 size={14} strokeWidth={1.8} />
          ) : (
            <Loader2 className="xy-spin" size={14} strokeWidth={1.8} />
          )}
          <span>{message.text}</span>
        </div>
      )}
    </section>
  );
}

function AgentConfigCard({
  tool,
  title,
  description,
  endpointLabel,
  icon,
  providers,
  draft,
  state,
  reading,
  applying,
  saving,
  onDraftChange,
  onSaveCustom,
  onSaveBuiltIn,
  onLoadCurrent,
  onDeleteCustom,
  onApply,
}: {
  tool: AgentTool;
  title: string;
  description: string;
  endpointLabel: string;
  icon: ReactNode;
  providers: AgentProviderOption[];
  draft: AgentDraft;
  state?: AgentToolConfigState;
  reading: boolean;
  applying: boolean;
  saving: boolean;
  onDraftChange: (draft: AgentDraft) => void;
  onSaveCustom: () => void;
  onSaveBuiltIn: () => void;
  onLoadCurrent: () => void;
  onDeleteCustom: (providerId: string) => void;
  onApply: (draftOverride?: AgentDraft) => void;
}) {
  const activeProvider = findProvider(tool, draft.providerId);
  const usesCustom = isCustomProviderId(draft.providerId);
  const usesOfficial = !usesCustom && activeProvider.id === "official";
  const customProviders = state?.customProviders ?? [];
  const savedBuiltInProviders = state?.builtInProviders ?? [];
  const selectedCustom = findCustomProvider(draft.providerId, customProviders);
  const selectedBuiltIn = findBuiltInProvider(
    activeProvider.id,
    savedBuiltInProviders,
  );
  const builtInProviders = providers.filter((provider) => provider.id !== "custom");
  const currentProviderId = resolveStateProviderId(tool, state?.activeProvider);
  const endpoint = endpointPreview(tool, draft.baseUrl);
  const fileLabel =
    tool === "codex"
      ? [
          state?.authPath ? basenamePath(state.authPath) : "auth.json 未读取",
          state?.path ? basenamePath(state.path) : "config.toml 未读取",
        ].join(" / ")
      : state?.path
        ? basenamePath(state.path)
        : "未读取";
  const fileTitle =
    tool === "codex"
      ? [state?.authPath, state?.path].filter(Boolean).join("\n")
      : state?.path ?? undefined;
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<AgentFetchedModel[]>([]);
  const [modelFetchMessage, setModelFetchMessage] =
    useState<AgentConfigMessage | null>(null);
  const [activeDetail, setActiveDetail] = useState<"models" | "config" | null>(
    null,
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const hasModelFetchApiKey = draft.apiKey.trim().length > 0;
  const modelListTitle = usesOfficial
    ? "官方登录不支持拉取模型列表"
    : hasModelFetchApiKey
      ? "根据当前 KEY 获取模型列表"
      : "请先填写 API Key";
  const showReadCurrentAction = draft.providerId === "custom";
  const showSaveCustomAction = usesCustom;
  const showSaveBuiltInAction = !usesCustom;
  const selectedProviderTokenConfigured = usesCustom
    ? Boolean(selectedCustom?.tokenConfigured)
    : Boolean(
        !usesOfficial &&
          (selectedBuiltIn?.tokenConfigured ||
            (state?.tokenConfigured &&
              isSameAgentBaseUrl(tool, draft.baseUrl, state.baseUrl))),
      );
  const apiKeyPlaceholder = usesOfficial
    ? "官方登录无需填写"
    : selectedProviderTokenConfigured
      ? "已配置，可直接使用或重新填写"
      : "sk-...";

  const updateDraft = (
    patch: Partial<AgentDraft>,
    options: { syncFullConfig?: boolean } = {},
  ) => {
    const syncFullConfig = options.syncFullConfig ?? true;
    const next = { ...draft, ...patch };
    const configPassthroughKeys = new Set([
      "extraConfig",
      "authConfig",
      "quotaProviderType",
      "quotaBaseUrl",
      "quotaApiKey",
      "quotaAccessToken",
      "quotaUserId",
    ]);
    const configAffecting = Object.keys(patch).some(
      (key) => !configPassthroughKeys.has(key),
    );
    if (syncFullConfig && configAffecting) {
      next.extraConfig = buildAgentFullConfig(tool, next, draft.extraConfig);
      if (tool === "codex") {
        next.authConfig = buildCodexAuthConfig(next, draft.authConfig);
      }
    }
    onDraftChange(next);
  };

  const handleProviderChange = (providerId: string) => {
    const provider = findProvider(tool, providerId);
    setFetchedModels([]);
    setModelFetchMessage(null);
    const next = builtInProviderDraft(
      tool,
      provider,
      draft,
      findBuiltInProvider(provider.id, savedBuiltInProviders),
    );
    onDraftChange(next);
  };

  const handleNewCustom = () => {
    setFetchedModels([]);
    setModelFetchMessage(null);
    updateDraft({
      providerId: "custom",
      customName: "",
      baseUrl: "",
      apiKey: "",
      model: defaultCustomModel(tool),
      haikuModel: "",
      haikuModelName: "",
      sonnetModel: "",
      sonnetModelName: "",
      opusModel: "",
      opusModelName: "",
      quotaProviderType: "",
      quotaBaseUrl: "",
      quotaApiKey: "",
      quotaAccessToken: "",
      quotaUserId: "",
    });
  };

  const handleCustomSelect = (provider: AgentCustomProviderSummary) => {
    setFetchedModels([]);
    setModelFetchMessage(null);
    const nextDraft = {
      ...draft,
      providerId: customProviderSelector(provider.id),
      customName: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey ?? "",
      model: provider.model ?? defaultCustomModel(tool),
      haikuModel: provider.haikuModel ?? "",
      haikuModelName: provider.haikuModelName ?? "",
      sonnetModel: provider.sonnetModel ?? "",
      sonnetModelName: provider.sonnetModelName ?? "",
      opusModel: provider.opusModel ?? "",
      opusModelName: provider.opusModelName ?? "",
      extraConfig: "",
      authConfig: draft.authConfig,
      quotaProviderType: quotaProviderTypeField(provider.quotaProviderType),
      quotaBaseUrl: "",
      quotaApiKey: "",
      quotaAccessToken: provider.quotaAccessToken ?? "",
      quotaUserId: provider.quotaUserId ?? "",
    };
    onDraftChange({
      ...nextDraft,
      authConfig:
        tool === "codex"
          ? buildCodexAuthConfig(nextDraft, draft.authConfig)
          : "",
      extraConfig: buildAgentFullConfig(
        tool,
        nextDraft,
        provider.extraConfig ?? draft.extraConfig,
      ),
    });
  };

  const handleFetchModels = async () => {
    if (usesOfficial) {
      setModelFetchMessage({ tone: "error", text: "官方登录不支持拉取模型列表。" });
      return;
    }
    if (!draft.apiKey.trim()) {
      setModelFetchMessage({ tone: "error", text: "请先填写 API Key。" });
      return;
    }
    if (!draft.baseUrl.trim()) {
      setModelFetchMessage({ tone: "error", text: "请先填写基础地址。" });
      return;
    }

    setFetchingModels(true);
    setModelFetchMessage({ tone: "info", text: "正在获取模型列表..." });
    try {
      const result = await invoke<AgentModelFetchResult>(
        "fetch_agent_provider_models",
        {
          request: {
            tool,
            providerId: draft.providerId,
            baseUrl: draft.baseUrl,
            apiKey: draft.apiKey.trim(),
          },
        },
      );
      setFetchedModels(result.models);
      setModelFetchMessage({
        tone: "success",
        text:
          result.models.length > 0
            ? `已获取 ${result.models.length} 个模型。`
            : `请求成功，但 ${result.endpoint} 未返回模型。`,
      });
    } catch (error) {
      setFetchedModels([]);
      setModelFetchMessage({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const updateClaudeRoleModel = (row: (typeof CLAUDE_ROLE_ROWS)[number], value: string) => {
    const currentModel = draft[row.modelKey];
    const keepsOneM = hasClaudeOneMMarker(currentModel);
    const oldBase = stripClaudeOneMMarker(currentModel).trim();
    const nextBase = stripClaudeOneMMarker(value).trim();
    const currentName = draft[row.nameKey].trim();
    const shouldSyncName = !currentName || currentName === oldBase;
    const patch: Partial<AgentDraft> = {
      [row.modelKey]: setClaudeOneMMarker(nextBase, keepsOneM),
    };
    if (shouldSyncName) {
      patch[row.nameKey] = nextBase;
    }
    updateDraft(patch);
  };

  const updateClaudeRoleOneM = (
    row: (typeof CLAUDE_ROLE_ROWS)[number],
    enabled: boolean,
  ) => {
    updateDraft({
      [row.modelKey]: setClaudeOneMMarker(draft[row.modelKey], enabled),
    } as Partial<AgentDraft>);
  };

  const applyFetchedModel = (
    modelId: string,
    target: "model" | "sonnetModel" | "opusModel" | "haikuModel" =
      tool === "claude" ? "opusModel" : "model",
  ) => {
    const roleRow = CLAUDE_ROLE_ROWS.find((row) => row.modelKey === target);
    if (roleRow) {
      updateClaudeRoleModel(roleRow, modelId);
    } else {
      updateDraft({ model: modelId });
    }
  };

  const handleModelListToggle = () => {
    if (activeDetail === "models") {
      setActiveDetail(null);
      return;
    }

    if (usesOfficial || !hasModelFetchApiKey) {
      return;
    }

    setActiveDetail("models");
    void handleFetchModels();
  };

  const handleReadCurrent = () => {
    setActiveDetail("config");
    onLoadCurrent();
  };

  const buildBuiltInProviderDraft = (provider: AgentProviderOption) => {
    if (!usesCustom && provider.id === activeProvider.id) return draft;
    return builtInProviderDraft(
      tool,
      provider,
      draft,
      findBuiltInProvider(provider.id, savedBuiltInProviders),
    );
  };

  const buildSavedCustomProviderDraft = (
    provider: AgentCustomProviderSummary,
  ) => {
    const providerId = customProviderSelector(provider.id);
    if (providerId === draft.providerId) return draft;
    const nextDraft = {
      ...draft,
      providerId,
      customName: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey ?? "",
      model: provider.model ?? defaultCustomModel(tool),
      haikuModel: provider.haikuModel ?? "",
      haikuModelName: provider.haikuModelName ?? "",
      sonnetModel: provider.sonnetModel ?? "",
      sonnetModelName: provider.sonnetModelName ?? "",
      opusModel: provider.opusModel ?? "",
      opusModelName: provider.opusModelName ?? "",
      extraConfig: "",
      authConfig: draft.authConfig,
      quotaProviderType: quotaProviderTypeField(provider.quotaProviderType),
      quotaBaseUrl: "",
      quotaApiKey: "",
      quotaAccessToken: provider.quotaAccessToken ?? "",
      quotaUserId: provider.quotaUserId ?? "",
    };
    return {
      ...nextDraft,
      authConfig:
        tool === "codex"
          ? buildCodexAuthConfig(nextDraft, draft.authConfig)
          : "",
      extraConfig: buildAgentFullConfig(
        tool,
        nextDraft,
        provider.extraConfig ?? draft.extraConfig,
      ),
    };
  };

  const providerNeedsKey = (targetDraft: AgentDraft) =>
    isCustomProviderId(targetDraft.providerId) ||
    findProvider(tool, targetDraft.providerId).id !== "official";

  const canApplyProvider = (
    targetDraft: AgentDraft,
    tokenConfigured = false,
  ) =>
    !providerNeedsKey(targetDraft) ||
    targetDraft.apiKey.trim().length > 0 ||
    tokenConfigured;

  const handleProviderApply = (targetDraft: AgentDraft) => {
    onDraftChange(targetDraft);
    onApply(targetDraft);
  };

  const renderProviderApplyAction = ({
    targetDraft,
    tokenConfigured = false,
    hasDelete = false,
  }: {
    targetDraft: AgentDraft;
    tokenConfigured?: boolean;
    hasDelete?: boolean;
  }) => (
    <div
      className={`xy-agent-provider-hover-actions ${
        hasDelete ? "has-delete" : ""
      }`}
    >
      <button
        className="xy-agent-provider-action is-accent"
        type="button"
        disabled={
          applying || saving || !canApplyProvider(targetDraft, tokenConfigured)
        }
        title={
          canApplyProvider(targetDraft, tokenConfigured)
            ? "应用当前厂商配置"
            : "请先填写 API Key"
        }
        onClick={() => handleProviderApply(targetDraft)}
      >
        {applying ? (
          <Loader2 className="xy-spin" size={12} strokeWidth={1.8} />
        ) : (
          <Save size={12} strokeWidth={1.8} />
        )}
        应用
      </button>
    </div>
  );

  return (
    <div className="xy-agent-card">
      <div className="xy-agent-card-head">
        <span className="xy-agent-card-icon">{icon}</span>
        <span className="xy-agent-card-title">
          <span>{title}</span>
          <small>{description}</small>
        </span>
        <span className="xy-agent-card-badge">{endpointLabel}</span>
      </div>

      <div className="xy-agent-provider-grid">
        {builtInProviders.map((provider) => {
          const isActive = !usesCustom && provider.id === activeProvider.id;
          const isCurrent = currentProviderId === provider.id;
          const targetDraft = buildBuiltInProviderDraft(provider);
          const savedBuiltIn = findBuiltInProvider(
            provider.id,
            savedBuiltInProviders,
          );
          const tokenConfigured =
            provider.id !== "official" &&
            Boolean(
              savedBuiltIn?.tokenConfigured ||
                (state?.tokenConfigured &&
                  isSameAgentBaseUrl(tool, targetDraft.baseUrl, state.baseUrl)),
            );
          return (
            <div
              key={provider.id}
              className={`xy-agent-provider xy-agent-provider--builtin ${
                isActive ? "is-active" : ""
              } ${isCurrent ? "is-current" : ""}`}
              aria-current={isCurrent ? "true" : undefined}
              title={isCurrent ? "当前使用中" : undefined}
              style={
                {
                  "--xy-provider-color": provider.color,
                } as CSSProperties
              }
            >
              <button
                className="xy-agent-provider-main xy-agent-provider-main--builtin"
                type="button"
                onClick={() => handleProviderChange(provider.id)}
              >
                <span className="xy-provider-icon">{provider.icon}</span>
                <span className="xy-provider-label">{provider.label}</span>
              </button>
              {isCurrent && (
                <span className="xy-agent-provider-current">使用中</span>
              )}
              {!isCurrent &&
                renderProviderApplyAction({ targetDraft, tokenConfigured })}
            </div>
          );
        })}
        {customProviders.map((provider) => {
          const providerId = customProviderSelector(provider.id);
          const isActive = providerId === draft.providerId;
          const isCurrent = currentProviderId === providerId;
          const targetDraft = buildSavedCustomProviderDraft(provider);
          return (
            <div
              key={provider.id}
              className={`xy-agent-provider xy-agent-provider--saved ${
                isActive ? "is-active" : ""
              } ${isCurrent ? "is-current" : ""}`}
              aria-current={isCurrent ? "true" : undefined}
              title={isCurrent ? "当前使用中" : undefined}
              style={
                {
                  "--xy-provider-color": "#8B5CF6",
                } as CSSProperties
              }
            >
              <button
                className="xy-agent-provider-main"
                type="button"
                onClick={() => handleCustomSelect(provider)}
                title={provider.endpoint}
              >
                <span className="xy-provider-icon">
                  <NewAPI size={14} />
                </span>
                <span className="xy-agent-provider-text">
                  <strong>{provider.name}</strong>
                  <small>{provider.model || provider.endpoint}</small>
                </span>
                <span
                  className={`xy-agent-provider-token ${
                    provider.tokenConfigured ? "is-ready" : ""
                  } ${isCurrent ? "is-current" : ""}`}
                >
                  {isCurrent
                    ? "使用中"
                    : provider.tokenConfigured
                      ? "Key"
                      : "缺 Key"}
                </span>
              </button>
              <button
                className="xy-agent-provider-delete"
                type="button"
                title="删除自定义厂商"
                onClick={() => onDeleteCustom(providerId)}
              >
                <Trash2 size={12} strokeWidth={1.8} />
              </button>
              {!isCurrent &&
                renderProviderApplyAction({
                  targetDraft,
                  tokenConfigured: provider.tokenConfigured,
                  hasDelete: true,
                })}
            </div>
          );
        })}
        <div
          className={`xy-agent-provider xy-agent-provider--new ${
            draft.providerId === "custom" ? "is-active" : ""
          }`}
          style={
            {
              "--xy-provider-color": "#8B5CF6",
            } as CSSProperties
          }
        >
          <button
            className="xy-agent-provider-main xy-agent-provider-main--builtin"
            type="button"
            onClick={handleNewCustom}
          >
            <span className="xy-provider-icon">
              <Plus size={14} strokeWidth={1.8} />
            </span>
            <span className="xy-provider-label">新增自定义</span>
          </button>
        </div>
      </div>

      <div className="xy-agent-fields">
        {usesCustom && (
          <label className="xy-field xy-field--wide">
            <span>
              <Server size={12} strokeWidth={1.8} />
              厂商名称
            </span>
            <input
              value={draft.customName}
              placeholder="new-api / sub2api"
              onChange={(e) => updateDraft({ customName: e.target.value })}
            />
          </label>
        )}

        <label className="xy-field">
          <span>
            <Server size={12} strokeWidth={1.8} />
            基础地址
          </span>
          <input
            value={draft.baseUrl}
            disabled={usesOfficial}
            placeholder={
              tool === "claude"
                ? "https://api.example.com/anthropic"
                : "https://api.example.com/v1"
            }
            onChange={(e) => updateDraft({ baseUrl: e.target.value })}
          />
        </label>

        <label className="xy-field">
          <span>
            <KeyRound size={12} strokeWidth={1.8} />
            API Key
          </span>
          <div className="xy-agent-secret-input">
            <input
              value={draft.apiKey}
              disabled={usesOfficial}
              type={showApiKey ? "text" : "password"}
              placeholder={apiKeyPlaceholder}
              onChange={(e) => updateDraft({ apiKey: e.target.value })}
            />
            <button
              className="xy-agent-secret-toggle"
              type="button"
              disabled={usesOfficial || !draft.apiKey.trim()}
              title={showApiKey ? "隐藏 API Key" : "查看 API Key"}
              aria-label={showApiKey ? "隐藏 API Key" : "查看 API Key"}
              onClick={() => setShowApiKey((value) => !value)}
            >
              {showApiKey ? (
                <EyeOff size={13} strokeWidth={1.8} />
              ) : (
                <Eye size={13} strokeWidth={1.8} />
              )}
            </button>
          </div>
        </label>

        {usesCustom && (
          <div className="xy-agent-quota xy-field--wide">
            <div className="xy-agent-quota-head">
              <span className="xy-agent-quota-title">
                <Gauge size={12} strokeWidth={1.8} />
                额度查询
              </span>
              <label className="xy-field xy-agent-quota-kind">
                <span>接口</span>
                <select
                  value={draft.quotaProviderType}
                  onChange={(e) =>
                    updateDraft({
                      quotaProviderType: quotaProviderTypeField(e.target.value),
                    })
                  }
                >
                  {QUOTA_PROVIDER_OPTIONS.map((option) => (
                    <option key={option.value || "none"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {draft.quotaProviderType === "newapi" && (
              <div className="xy-agent-quota-fields">
                <label className="xy-field">
                  <span>Access Token</span>
                  <input
                    value={draft.quotaAccessToken}
                    type="password"
                    placeholder="Bearer Token"
                    onChange={(e) =>
                      updateDraft({ quotaAccessToken: e.target.value })
                    }
                  />
                </label>
                <label className="xy-field">
                  <span>用户 ID</span>
                  <input
                    value={draft.quotaUserId}
                    placeholder="New-Api-User"
                    onChange={(e) =>
                      updateDraft({ quotaUserId: e.target.value })
                    }
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {tool === "claude" ? (
          <div className="xy-agent-role-models xy-field--wide">
            <div className="xy-agent-role-head">
              <span className="xy-agent-role-title">Claude 模型角色</span>
              <small>显示名称用于 /model 菜单，1M 会写入模型值后缀</small>
            </div>
            <div className="xy-agent-role-table">
              <div className="xy-agent-role-table-head" aria-hidden="true">
                <span>角色</span>
                <span>模型名称</span>
                <span>实际请求模型</span>
                <span>1M</span>
              </div>
              {CLAUDE_ROLE_ROWS.map((row) => {
                const modelBase = stripClaudeOneMMarker(draft[row.modelKey]);
                const hasOneM = hasClaudeOneMMarker(draft[row.modelKey]);
                return (
                  <div className="xy-agent-role-row" key={row.role}>
                    <span className="xy-agent-role-label">{row.label}</span>
                    <label className="xy-field xy-field--role">
                      <span>模型名称</span>
                      <input
                        value={draft[row.nameKey]}
                        placeholder={modelBase || "显示在模型菜单中的名称"}
                        onChange={(e) =>
                          updateDraft({ [row.nameKey]: e.target.value } as Partial<AgentDraft>)
                        }
                      />
                    </label>
                    <label className="xy-field xy-field--role">
                      <span>实际请求模型</span>
                      <input
                        value={modelBase}
                        placeholder={row.placeholder}
                        onChange={(e) =>
                          updateClaudeRoleModel(row, e.target.value)
                        }
                      />
                    </label>
                    <label
                      className={`xy-agent-one-m ${
                        hasOneM ? "is-active" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={hasOneM}
                        onChange={(e) =>
                          updateClaudeRoleOneM(row, e.target.checked)
                        }
                      />
                      <span>1M</span>
                    </label>
                  </div>
                );
              })}
            </div>
            <label className="xy-field">
              <span>兜底模型</span>
              <input
                value={draft.model}
                placeholder="可选"
                onChange={(e) => updateDraft({ model: e.target.value })}
              />
            </label>
          </div>
        ) : (
          <label className="xy-field">
            <span>模型</span>
            <input
              value={draft.model}
              placeholder={CODEX_DEFAULT_MODEL}
              onChange={(e) => updateDraft({ model: e.target.value })}
            />
          </label>
        )}

        <div className="xy-agent-detail-switch xy-field--wide">
          <button
            className={`xy-agent-detail-btn ${
              activeDetail === "models" ? "is-active" : ""
            }`}
            type="button"
            disabled={
              activeDetail !== "models" &&
              (fetchingModels || usesOfficial || !hasModelFetchApiKey)
            }
            title={modelListTitle}
            onClick={handleModelListToggle}
          >
            <Download size={13} strokeWidth={1.8} />
            模型列表
          </button>
          <button
            className={`xy-agent-detail-btn ${
              activeDetail === "config" ? "is-active" : ""
            }`}
            type="button"
            onClick={() =>
              setActiveDetail(activeDetail === "config" ? null : "config")
            }
          >
            <RefreshCw size={13} strokeWidth={1.8} />
            完整配置
          </button>
        </div>

        {activeDetail === "models" && (
          <div className="xy-agent-model-fetch xy-field--wide">
            <div className="xy-agent-model-fetch-head">
              <span>模型列表</span>
              <button
                className="xy-mini-btn xy-mini-btn--compact"
                type="button"
                disabled={
                  fetchingModels ||
                  usesOfficial ||
                  !hasModelFetchApiKey ||
                  saving ||
                  applying
                }
                title={modelListTitle}
                onClick={() => void handleFetchModels()}
              >
                {fetchingModels ? (
                  <Loader2 className="xy-spin" size={12} strokeWidth={1.8} />
                ) : (
                  <Download size={12} strokeWidth={1.8} />
                )}
                获取模型
              </button>
            </div>
            {modelFetchMessage && (
              <span
                className={`xy-agent-model-fetch-msg is-${modelFetchMessage.tone}`}
              >
                {modelFetchMessage.text}
              </span>
            )}
            {fetchedModels.length > 0 && (
              <div className="xy-agent-model-list">
                {fetchedModels.map((model) => (
                  <div className="xy-agent-model-item" key={model.id}>
                    <button
                      className="xy-agent-model-main"
                      type="button"
                      title={model.id}
                      onClick={() => applyFetchedModel(model.id)}
                    >
                      <strong>{model.id}</strong>
                      {model.ownedBy && <small>{model.ownedBy}</small>}
                    </button>
                    {tool === "claude" && (
                      <div className="xy-agent-model-roles">
                        <button
                          type="button"
                          onClick={() =>
                            applyFetchedModel(model.id, "opusModel")
                          }
                        >
                          Opus
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            applyFetchedModel(model.id, "sonnetModel")
                          }
                        >
                          Sonnet
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            applyFetchedModel(model.id, "haikuModel")
                          }
                        >
                          Haiku
                        </button>
                        <button
                          type="button"
                          onClick={() => applyFetchedModel(model.id, "model")}
                        >
                          兜底
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeDetail === "config" &&
          (tool === "codex" ? (
            <div className="xy-agent-config-stack xy-field--wide">
              <div className="xy-field-head">
                <span>Codex 完整配置</span>
                <button
                  className="xy-mini-btn xy-mini-btn--compact"
                  type="button"
                  title="同步表单到 auth.json 与 config.toml"
                  onClick={() =>
                    updateDraft(
                      {
                        authConfig: buildCodexAuthConfig(
                          draft,
                          draft.authConfig,
                        ),
                        extraConfig: buildCodexFullConfig(
                          draft,
                          draft.extraConfig,
                        ),
                      },
                      { syncFullConfig: false },
                    )
                  }
                >
                  <RefreshCw size={12} strokeWidth={1.8} />
                  同步表单
                </button>
              </div>

              <label className="xy-field">
                <span title={state?.authPath ?? undefined}>
                  完整 auth.json
                </span>
                <textarea
                  className="xy-agent-config-editor xy-agent-config-editor--auth"
                  value={draft.authConfig}
                  rows={3}
                  spellCheck={false}
                  placeholder={`{\n  "OPENAI_API_KEY": "${draft.apiKey.trim() || "sk-..."}"\n}`}
                  onChange={(e) => {
                    const authConfig = e.target.value;
                    const apiKey = extractCodexAuthApiKey(authConfig);
                    updateDraft(
                      apiKey === undefined
                        ? { authConfig }
                        : { authConfig, apiKey },
                      { syncFullConfig: false },
                    );
                  }}
                />
              </label>

              <label className="xy-field">
                <span title={state?.path}>完整 config.toml</span>
                <textarea
                  className="xy-agent-config-editor"
                  value={draft.extraConfig}
                  rows={10}
                  spellCheck={false}
                  placeholder={`model_provider = "xuya_custom_new-api"\nmodel = "${CODEX_DEFAULT_MODEL}"\nmodel_reasoning_effort = "high"\ndisable_response_storage = true\n\n[model_providers.xuya_custom_new-api]\nname = "new-api"\nbase_url = "https://api.example.com/v1"\nwire_api = "responses"\nexperimental_bearer_token = "${draft.apiKey.trim() || "sk-..."}"`}
                  onChange={(e) => {
                    const extraConfig = e.target.value;
                    const apiKey = extractCodexConfigApiKey(extraConfig);
                    updateDraft(
                      apiKey === undefined
                        ? { extraConfig }
                        : { extraConfig, apiKey },
                      { syncFullConfig: false },
                    );
                  }}
                />
              </label>
            </div>
          ) : (
            <div className="xy-field xy-field--wide">
              <div className="xy-field-head">
                <span>完整 settings.json</span>
                <button
                  className="xy-mini-btn xy-mini-btn--compact"
                  type="button"
                  title="同步表单到完整配置"
                  onClick={() =>
                    updateDraft(
                      {
                        extraConfig: buildAgentFullConfig(
                          tool,
                          draft,
                          draft.extraConfig,
                        ),
                      },
                      { syncFullConfig: false },
                    )
                  }
                >
                  <RefreshCw size={12} strokeWidth={1.8} />
                  同步表单
                </button>
              </div>
              <textarea
                className="xy-agent-config-editor"
                value={draft.extraConfig}
                rows={10}
                spellCheck={false}
                placeholder={`{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://api.example.com/anthropic",\n    "ANTHROPIC_AUTH_TOKEN": "${draft.apiKey.trim() || "sk-ant-..."}",\n    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro[1M]",\n    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "DeepSeek V4 Pro",\n    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro[1M]",\n    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "DeepSeek V4 Pro",\n    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",\n    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME": "DeepSeek V4 Flash"\n  }\n}`}
                onChange={(e) =>
                  updateDraft(
                    { extraConfig: e.target.value },
                    { syncFullConfig: false },
                  )
                }
              />
            </div>
          ))}
      </div>

      <div className="xy-agent-card-foot">
        <div className="xy-agent-meta">
          <span title={fileTitle}>
            文件 {fileLabel}
          </span>
          <span title={state?.endpoint ?? undefined}>
            端点 {usesOfficial ? "官方登录" : endpoint || "待填写"}
          </span>
        </div>
        {(showReadCurrentAction ||
          showSaveCustomAction ||
          showSaveBuiltInAction) && (
          <div className="xy-agent-actions">
            {showReadCurrentAction && (
              <button
                className="xy-mini-btn"
                type="button"
                disabled={reading || saving || applying}
                onClick={handleReadCurrent}
              >
                {reading ? (
                  <Loader2 className="xy-spin" size={13} strokeWidth={1.8} />
                ) : (
                  <RefreshCw size={13} strokeWidth={1.8} />
                )}
                读取当前
              </button>
            )}
            {showSaveCustomAction && (
              <button
                className="xy-mini-btn"
                type="button"
                disabled={saving || applying}
                onClick={onSaveCustom}
              >
                {saving ? (
                  <Loader2 className="xy-spin" size={13} strokeWidth={1.8} />
                ) : (
                  <Save size={13} strokeWidth={1.8} />
                )}
                保存
              </button>
            )}
            {showSaveBuiltInAction && (
              <button
                className="xy-mini-btn"
                type="button"
                disabled={
                  applying ||
                  saving ||
                  !canApplyProvider(draft, selectedProviderTokenConfigured)
                }
                title={
                  canApplyProvider(draft, selectedProviderTokenConfigured)
                    ? "保存当前内置厂商表单，不切换使用中配置"
                    : "请先填写 API Key"
                }
                onClick={onSaveBuiltIn}
              >
                {saving ? (
                  <Loader2 className="xy-spin" size={13} strokeWidth={1.8} />
                ) : (
                  <Save size={13} strokeWidth={1.8} />
                )}
                保存
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AutoUpdatePanel() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [message, setMessage] = useState("从 GitHub Releases 获取最新版本");
  const [progress, setProgress] = useState<number | null>(null);

  const busy = status === "checking" || status === "downloading";

  const statusIcon =
    status === "error" ? (
      <AlertCircle size={15} strokeWidth={1.8} />
    ) : status === "ready" || status === "none" ? (
      <CheckCircle2 size={15} strokeWidth={1.8} />
    ) : busy ? (
      <Loader2 className="xy-spin" size={15} strokeWidth={1.8} />
    ) : (
      <RefreshCw size={15} strokeWidth={1.8} />
    );
  const releaseLabel = updateInfo
    ? `版本 ${updateInfo.version}`
    : status === "none"
      ? "已是最新"
      : "等待检查";

  const handleCheck = async () => {
    setStatus("checking");
    setUpdateInfo(null);
    setProgress(null);
    setMessage("正在检查 GitHub Releases...");

    try {
      const update = await check();

      if (!update) {
        setStatus("none");
        setMessage("当前已是最新版本");
        return;
      }

      setStatus("available");
      setUpdateInfo({
        version: update.version,
        date: update.date,
        body: update.body,
      });
      setMessage(`发现新版本 ${update.version}`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "检查更新失败");
    }
  };

  const handleInstall = async () => {
    setStatus("downloading");
    setProgress(0);
    setMessage("正在下载安装包...");

    try {
      const update = await check();

      if (!update) {
        setStatus("none");
        setProgress(null);
        setMessage("当前已是最新版本");
        return;
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          downloaded = 0;
          setProgress(0);
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setProgress(Math.round((downloaded / contentLength) * 100));
          }
        }

        if (event.event === "Finished") {
          setProgress(100);
        }
      });

      setStatus("ready");
      setMessage("更新已安装，正在重启应用...");
      await relaunch();
    } catch (error) {
      setStatus("error");
      setProgress(null);
      setMessage(error instanceof Error ? error.message : "安装更新失败");
    }
  };

  return (
    <section className="xy-about-section">
      <div className="xy-update-card xy-update-card--about" data-status={status}>
        <div className="xy-update-main">
          <span className="xy-update-status-icon">{statusIcon}</span>

          <div className="xy-update-copy">
            <div className="xy-update-title-row">
              <span className="xy-update-title">自动更新</span>
              <span className="xy-update-badge">{releaseLabel}</span>
            </div>
            <span className="xy-update-message">{message}</span>
            <span className="xy-update-meta">
              更新源 GitHub Releases
              {updateInfo?.date ? ` · ${updateInfo.date}` : ""}
            </span>
          </div>
        </div>

        {typeof progress === "number" && (
          <div className="xy-update-progress" aria-label={`下载进度 ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
        )}

        {updateInfo?.body && (
          <div className="xy-update-notes">{updateInfo.body}</div>
        )}

        <div className="xy-update-actions">
          <button
            className="xy-update-btn xy-update-btn--ghost"
            type="button"
            disabled={busy}
            onClick={handleCheck}
          >
            <RefreshCw size={13} strokeWidth={1.8} />
            检查更新
          </button>
          <button
            className="xy-update-btn xy-update-btn--primary"
            type="button"
            disabled={status !== "available"}
            onClick={handleInstall}
          >
            <Download size={13} strokeWidth={1.8} />
            安装并重启
          </button>
        </div>
      </div>
    </section>
  );
}

function SessionMenuSettings() {
  const items = useSessionMenuStore((s) => s.items);
  const addItem = useSessionMenuStore((s) => s.addItem);
  const updateItem = useSessionMenuStore((s) => s.updateItem);
  const removeItem = useSessionMenuStore((s) => s.removeItem);
  const moveItem = useSessionMenuStore((s) => s.moveItem);
  const resetItems = useSessionMenuStore((s) => s.resetItems);
  const shellItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "shell");
  const codingItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "agent");

  return (
    <section className="xy-set-section">
      <div className="xy-set-section-head">
        <div>
          <h3 className="xy-set-section-title">会话菜单</h3>
          <p className="xy-set-section-hint">
            控制新建会话菜单的显示、排序和启动命令
          </p>
        </div>
        <div className="xy-session-menu-actions">
          <button
            className="xy-mini-btn"
            type="button"
            title="添加 Shell 会话"
            onClick={() =>
              addItem({
                label: "新 Shell",
                kind: "shell",
                shellKind: "powerShell",
              })
            }
          >
            <Plus size={13} strokeWidth={1.8} />
            Shell
          </button>
          <button
            className="xy-mini-btn"
            type="button"
            title="添加 Coding 会话"
            onClick={() =>
              addItem({
                label: "新 Coding",
                kind: "agent",
                shellKind: "powerShell",
                agentCommand: "codex --yolo",
              })
            }
          >
            <Plus size={13} strokeWidth={1.8} />
            Coding
          </button>
          <button
            className="xy-mini-btn"
            type="button"
            title="恢复默认菜单"
            onClick={resetItems}
          >
            <RotateCcw size={13} strokeWidth={1.8} />
            默认
          </button>
        </div>
      </div>

      <div className="xy-session-menu-list">
        <SessionMenuGroup
          title="Shell"
          entries={shellItems}
          updateItem={updateItem}
          removeItem={removeItem}
          moveItem={moveItem}
        />
        <SessionMenuGroup
          title="Coding"
          entries={codingItems}
          updateItem={updateItem}
          removeItem={removeItem}
          moveItem={moveItem}
        />
      </div>
    </section>
  );
}

function SessionMenuGroup({
  title,
  entries,
  updateItem,
  removeItem,
  moveItem,
}: {
  title: string;
  entries: Array<{ item: SessionMenuItem; index: number }>;
  updateItem: (id: string, patch: Partial<SessionMenuItem>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, direction: "up" | "down") => void;
}) {
  return (
    <div className="xy-session-menu-group">
      <div className="xy-session-menu-group-title">{title}</div>
      {entries.length === 0 ? (
        <div className="xy-session-menu-empty">暂无菜单项</div>
      ) : (
        entries.map(({ item }, groupIndex) => (
          <SessionMenuEditor
            key={item.id}
            item={item}
            groupIndex={groupIndex}
            groupCount={entries.length}
            updateItem={updateItem}
            removeItem={removeItem}
            moveItem={moveItem}
          />
        ))
      )}
    </div>
  );
}

function SessionMenuEditor({
  item,
  groupIndex,
  groupCount,
  updateItem,
  removeItem,
  moveItem,
}: {
  item: SessionMenuItem;
  groupIndex: number;
  groupCount: number;
  updateItem: (id: string, patch: Partial<SessionMenuItem>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, direction: "up" | "down") => void;
}) {
  return (
    <div className={`xy-session-menu-card ${!item.visible ? "is-muted" : ""}`}>
      <div className="xy-session-menu-card-main">
        <label className="xy-field">
          <span>名称</span>
          <input
            value={item.label}
            onChange={(e) => updateItem(item.id, { label: e.target.value })}
          />
        </label>

        <label className="xy-field">
          <span>Shell</span>
          <select
            value={item.shellKind}
            onChange={(e) =>
              updateItem(item.id, { shellKind: e.target.value as ShellKind })
            }
          >
            {SHELL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {item.kind === "agent" ? (
          <label className="xy-field xy-field--wide">
            <span>启动命令</span>
            <input
              value={item.agentCommand ?? ""}
              placeholder="claude / codex --yolo / opencode"
              onChange={(e) =>
                updateItem(item.id, { agentCommand: e.target.value })
              }
            />
          </label>
        ) : (
          <label className="xy-field xy-field--wide">
            <span>启动命令</span>
            <input
              value={item.startupCommand ?? ""}
              placeholder="例如: cmd /k /t:0a"
              onChange={(e) =>
                updateItem(item.id, { startupCommand: e.target.value })
              }
            />
          </label>
        )}
      </div>

      <div className="xy-session-menu-card-tools">
        <button
          className={`xy-switch xy-switch--small ${item.visible ? "is-on" : ""}`}
          role="switch"
          aria-checked={item.visible}
          title={item.visible ? "隐藏" : "显示"}
          onClick={() => updateItem(item.id, { visible: !item.visible })}
        >
          <span className="xy-switch-knob" />
        </button>
        <button
          className="xy-icon-btn"
          title="上移"
          disabled={groupIndex === 0}
          onClick={() => moveItem(item.id, "up")}
        >
          <ArrowUp size={14} strokeWidth={1.8} />
        </button>
        <button
          className="xy-icon-btn"
          title="下移"
          disabled={groupIndex === groupCount - 1}
          onClick={() => moveItem(item.id, "down")}
        >
          <ArrowDown size={14} strokeWidth={1.8} />
        </button>
        <button
          className="xy-icon-btn is-danger"
          title="删除"
          onClick={() => removeItem(item.id)}
        >
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

function AboutModal() {
  const closeModal = useModalStore((s) => s.closeModal);
  const openRepository = useCallback(() => {
    void open(PROJECT_REPOSITORY_URL).catch((error) => {
      console.error("[AboutModal] Failed to open repository:", error);
    });
  }, []);

  return (
    <ModalShell title="关于 XuYa Terminal" onClose={closeModal}>
      <div className="xy-about-layout">
        <div className="xy-about">
          <div className="xy-about-glyph">
            <img src="/logo.png" alt="XuYa Terminal" width="48" height="48" />
          </div>
          <div className="xy-about-copy">
            <div className="xy-about-name">XuYa Terminal</div>
            <div className="xy-about-tag">面向 AI Agent 工程师的终端管理器</div>
          </div>
          <div className="xy-about-meta">
            <span>版本 {APP_VERSION}</span>
            <span>Tauri v2</span>
            <span>React 19</span>
          </div>
        </div>

        <button
          className="xy-about-link"
          type="button"
          onClick={openRepository}
          title="打开 GitHub 仓库"
        >
          <span className="xy-about-link-icon">
            <Github size={17} strokeWidth={1.8} />
          </span>
          <span className="xy-about-link-copy">
            <span className="xy-about-link-label">GitHub 仓库</span>
            <span className="xy-about-link-url">{PROJECT_REPOSITORY_URL}</span>
          </span>
          <ExternalLink className="xy-about-link-action" size={15} strokeWidth={1.8} />
        </button>

        <AutoUpdatePanel />
      </div>
    </ModalShell>
  );
}

/** Single mount point — renders whichever modal is active. */
export default function Modals() {
  const modal = useModalStore((s) => s.modal);
  if (modal === "settings") return <SettingsModal />;
  if (modal === "about") return <AboutModal />;
  return null;
}
