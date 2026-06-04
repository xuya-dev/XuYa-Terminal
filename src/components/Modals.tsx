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
  ExternalLink,
  Github,
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
const APP_VERSION = "0.1.3";

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

interface AgentProviderOption {
  id: string;
  label: string;
  baseUrl: string;
  model?: string;
  haikuModel?: string;
  sonnetModel?: string;
  opusModel?: string;
  color: string;
  icon: ReactNode;
}

interface AgentDraft {
  providerId: string;
  customName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  haikuModel: string;
  sonnetModel: string;
  opusModel: string;
  extraConfig: string;
}

interface AgentCustomProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  endpoint: string;
  model?: string | null;
  haikuModel?: string | null;
  sonnetModel?: string | null;
  opusModel?: string | null;
  extraConfig?: string | null;
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
  sonnetModel?: string | null;
  opusModel?: string | null;
  extraConfig?: string | null;
  tokenConfigured: boolean;
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
    model: "glm-5.1",
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
    model: "MiniMax-M2.7",
    haikuModel: "MiniMax-M2.7",
    sonnetModel: "MiniMax-M2.7",
    opusModel: "MiniMax-M2.7",
    color: "#FF6B6B",
    icon: <Minimax size={14} />,
  },
  {
    id: "kimi",
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/anthropic",
    model: "kimi-k2.6",
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
    model: "deepseek-v4-pro",
    haikuModel: "deepseek-v4-flash",
    sonnetModel: "deepseek-v4-pro",
    opusModel: "deepseek-v4-pro",
    color: "#1E88E5",
    icon: <DeepSeek size={14} />,
  },
  {
    id: "xiaomimimo",
    label: "XiaoMi Mimo",
    baseUrl: "https://api.xiaomimimo.com/anthropic",
    model: "mimo-v2.5-pro",
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
    color: "#64748B",
    icon: <NewAPI size={14} />,
  },
];

const CODEX_PROVIDER_OPTIONS: AgentProviderOption[] = [
  {
    id: "official",
    label: "官方",
    baseUrl: "",
    model: "gpt-5-codex",
    color: "#00A67E",
    icon: <OpenAI size={14} />,
  },
  {
    id: "custom",
    label: "自定义",
    baseUrl: "",
    model: "gpt-5-codex",
    color: "#64748B",
    icon: <NewAPI size={14} />,
  },
];

const AGENT_DRAFT_KEYS: Record<AgentTool, string> = {
  claude: "xuya-agent-config-claude",
  codex: "xuya-agent-config-codex",
};

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
  return tool === "codex" ? "gpt-5-codex" : "";
}

function roleModelFallback(provider: AgentProviderOption, role: "haiku" | "sonnet" | "opus") {
  if (role === "haiku") return provider.haikuModel ?? provider.model ?? "";
  if (role === "sonnet") return provider.sonnetModel ?? provider.model ?? "";
  return provider.opusModel ?? provider.model ?? "";
}

const CLAUDE_TOKEN_PLACEHOLDER = "${ANTHROPIC_AUTH_TOKEN}";
const CODEX_TOKEN_PLACEHOLDER = "${CODEX_API_KEY}";

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
  delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;

  if (!usesOfficial && draft.baseUrl.trim()) {
    env.ANTHROPIC_BASE_URL = normalizeClaudeBaseUrlForPreview(draft.baseUrl);
    env.ANTHROPIC_AUTH_TOKEN = CLAUDE_TOKEN_PLACEHOLDER;
  }
  if (draft.model.trim()) env.ANTHROPIC_MODEL = draft.model.trim();
  if (draft.haikuModel.trim()) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = draft.haikuModel.trim();
  }
  if (draft.sonnetModel.trim()) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = draft.sonnetModel.trim();
  }
  if (draft.opusModel.trim()) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = draft.opusModel.trim();
  }

  const next = { ...config };
  if (Object.keys(env).length > 0) {
    next.env = env;
  } else {
    delete next.env;
  }
  return JSON.stringify(next, null, 2);
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

function isXuyaCodexProviderSection(section: string) {
  const prefix = "model_providers.";
  if (!section.startsWith(prefix)) return false;
  const provider = section.slice(prefix.length);
  return provider === "xuya_custom" || provider.startsWith("xuya_custom_");
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
      skippingManagedSection = isXuyaCodexProviderSection(header);
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
  const model = draft.model.trim() || provider.model || "gpt-5-codex";
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
experimental_bearer_token = ${tomlString(CODEX_TOKEN_PLACEHOLDER)}`,
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

function defaultAgentDraft(tool: AgentTool): AgentDraft {
  const provider = providerOptionsFor(tool)[0];
  const draft = {
    providerId: provider.id,
    customName: "",
    baseUrl: provider.baseUrl,
    apiKey: "",
    model: provider.model ?? "",
    haikuModel: roleModelFallback(provider, "haiku"),
    sonnetModel: roleModelFallback(provider, "sonnet"),
    opusModel: roleModelFallback(provider, "opus"),
    extraConfig: "",
  };
  return {
    ...draft,
    extraConfig: buildAgentFullConfig(tool, draft, ""),
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
        typeof parsed.baseUrl === "string" ? parsed.baseUrl : provider.baseUrl,
      apiKey: "",
      model:
        typeof parsed.model === "string"
          ? parsed.model
          : (provider.model ?? ""),
      haikuModel:
        typeof parsed.haikuModel === "string"
          ? parsed.haikuModel
          : roleModelFallback(provider, "haiku"),
      sonnetModel:
        typeof parsed.sonnetModel === "string"
          ? parsed.sonnetModel
          : roleModelFallback(provider, "sonnet"),
      opusModel:
        typeof parsed.opusModel === "string"
          ? parsed.opusModel
          : roleModelFallback(provider, "opus"),
      extraConfig:
        typeof parsed.extraConfig === "string"
          ? sanitizeFullConfigForStorage(tool, parsed.extraConfig)
          : "",
    };
    return {
      ...draft,
      extraConfig: draft.extraConfig.trim()
        ? draft.extraConfig
        : buildAgentFullConfig(tool, draft, ""),
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
      sonnetModel: draft.sonnetModel,
      opusModel: draft.opusModel,
      extraConfig: sanitizeFullConfigForStorage(tool, draft.extraConfig),
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
  const [claudeDraft, setClaudeDraft] = useState<AgentDraft>(() =>
    loadAgentDraft("claude"),
  );
  const [codexDraft, setCodexDraft] = useState<AgentDraft>(() =>
    loadAgentDraft("codex"),
  );

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const next = await invoke<AgentConfigState>("get_agent_config_state");
      setState(next);
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

    setClaudeDraft((current) => {
      if (!state.claude.activeProvider && !state.claude.baseUrl) return current;
      const providerId =
        resolveStateProviderId("claude", state.claude.activeProvider) ??
        current.providerId;
      const provider = findProvider("claude", providerId);
      const customProvider = findCustomProvider(
        providerId,
        state.claude.customProviders,
      );
      return {
        ...current,
        providerId,
        customName: customProvider?.name ?? current.customName,
        baseUrl: customProvider?.baseUrl ?? state.claude.baseUrl ?? provider.baseUrl,
        model:
          customProvider?.model ??
          state.claude.model ??
          provider.model ??
          current.model,
        haikuModel:
          customProvider?.haikuModel ??
          state.claude.haikuModel ??
          roleModelFallback(provider, "haiku") ??
          current.haikuModel,
        sonnetModel:
          customProvider?.sonnetModel ??
          state.claude.sonnetModel ??
          roleModelFallback(provider, "sonnet") ??
          current.sonnetModel,
        opusModel:
          customProvider?.opusModel ??
          state.claude.opusModel ??
          roleModelFallback(provider, "opus") ??
          current.opusModel,
        extraConfig:
          customProvider?.extraConfig ??
          state.claude.extraConfig ??
          current.extraConfig,
      };
    });

    setCodexDraft((current) => {
      if (!state.codex.activeProvider && !state.codex.baseUrl) return current;
      const providerId =
        resolveStateProviderId("codex", state.codex.activeProvider) ??
        current.providerId;
      const provider = findProvider("codex", providerId);
      const customProvider = findCustomProvider(
        providerId,
        state.codex.customProviders,
      );
      return {
        ...current,
        providerId,
        customName: customProvider?.name ?? current.customName,
        baseUrl: customProvider?.baseUrl ?? state.codex.baseUrl ?? provider.baseUrl,
        model:
          customProvider?.model ??
          state.codex.model ??
          provider.model ??
          current.model,
        haikuModel: current.haikuModel,
        sonnetModel: current.sonnetModel,
        opusModel: current.opusModel,
        extraConfig:
          customProvider?.extraConfig ??
          state.codex.extraConfig ??
          current.extraConfig,
      };
    });
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
    if (!draftToSave.apiKey.trim() && !currentCustom?.tokenConfigured) {
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
            sonnetModel: draftToSave.sonnetModel,
            opusModel: draftToSave.opusModel,
            extraConfig: draftToSave.extraConfig,
          },
        },
      );
      updateDraftForTool(tool, {
        providerId: customProviderSelector(saved.id),
        customName: saved.name,
        baseUrl: saved.baseUrl,
        apiKey: "",
        model: saved.model ?? defaultCustomModel(tool),
        haikuModel: saved.haikuModel ?? "",
        sonnetModel: saved.sonnetModel ?? "",
        opusModel: saved.opusModel ?? "",
        extraConfig: saved.extraConfig ?? "",
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
    if (isCustomProviderId(nextDraft.providerId)) {
      const saved = await saveCustomProvider(tool, nextDraft, { silent: true });
      if (!saved) return;
      nextDraft = {
        ...nextDraft,
        providerId: customProviderSelector(saved.id),
        customName: saved.name,
        baseUrl: saved.baseUrl,
        apiKey: "",
        model: saved.model ?? defaultCustomModel(tool),
        haikuModel: saved.haikuModel ?? "",
        sonnetModel: saved.sonnetModel ?? "",
        opusModel: saved.opusModel ?? "",
        extraConfig: saved.extraConfig ?? "",
      };
      provider = findProvider(tool, nextDraft.providerId);
    } else if (provider.id !== "official") {
      if (!nextDraft.baseUrl.trim()) {
        setMessage({ tone: "error", text: "请先填写服务端点。" });
        return;
      }
      if (!nextDraft.apiKey.trim() && !currentState?.tokenConfigured) {
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
            sonnetModel: nextDraft.sonnetModel,
            opusModel: nextDraft.opusModel,
            extraConfig: nextDraft.extraConfig,
          },
        },
      );
      await loadState();
      if (tool === "claude") {
        setClaudeDraft((current) => ({ ...current, apiKey: "" }));
      } else {
        setCodexDraft((current) => ({ ...current, apiKey: "" }));
      }
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

      <div className="xy-agent-grid">
        <AgentConfigCard
          tool="claude"
          title="Claude Code"
          description="ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN"
          endpointLabel="/v1/messages"
          icon={<ClaudeCode size={20} />}
          providers={CLAUDE_PROVIDER_OPTIONS}
          draft={claudeDraft}
          state={state?.claude}
          applying={applying === "claude"}
          saving={saving === "claude"}
          onDraftChange={setClaudeDraft}
          onSaveCustom={() => void saveCustomProvider("claude", claudeDraft)}
          onDeleteCustom={(providerId) =>
            void deleteCustomProvider("claude", providerId)
          }
          onApply={() => void applyConfig("claude", claudeDraft, state?.claude)}
        />
        <AgentConfigCard
          tool="codex"
          title="Codex"
          description="model_providers.xuya_custom_* + responses"
          endpointLabel="/v1/responses"
          icon={<Codex size={20} />}
          providers={CODEX_PROVIDER_OPTIONS}
          draft={codexDraft}
          state={state?.codex}
          applying={applying === "codex"}
          saving={saving === "codex"}
          onDraftChange={setCodexDraft}
          onSaveCustom={() => void saveCustomProvider("codex", codexDraft)}
          onDeleteCustom={(providerId) =>
            void deleteCustomProvider("codex", providerId)
          }
          onApply={() => void applyConfig("codex", codexDraft, state?.codex)}
        />
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
  applying,
  saving,
  onDraftChange,
  onSaveCustom,
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
  applying: boolean;
  saving: boolean;
  onDraftChange: (draft: AgentDraft) => void;
  onSaveCustom: () => void;
  onDeleteCustom: (providerId: string) => void;
  onApply: () => void;
}) {
  const activeProvider = findProvider(tool, draft.providerId);
  const usesCustom = isCustomProviderId(draft.providerId);
  const usesOfficial = !usesCustom && activeProvider.id === "official";
  const customProviders = state?.customProviders ?? [];
  const selectedCustom = findCustomProvider(draft.providerId, customProviders);
  const builtInProviders = providers.filter((provider) => provider.id !== "custom");
  const endpoint = endpointPreview(tool, draft.baseUrl);

  const updateDraft = (
    patch: Partial<AgentDraft>,
    options: { syncFullConfig?: boolean } = {},
  ) => {
    const syncFullConfig = options.syncFullConfig ?? true;
    const next = { ...draft, ...patch };
    const configAffecting = Object.keys(patch).some(
      (key) => key !== "apiKey" && key !== "extraConfig",
    );
    if (syncFullConfig && configAffecting) {
      next.extraConfig = buildAgentFullConfig(tool, next, draft.extraConfig);
    }
    onDraftChange(next);
  };

  const handleProviderChange = (providerId: string) => {
    const provider = findProvider(tool, providerId);
    updateDraft({
      providerId: provider.id,
      customName: "",
      baseUrl: provider.baseUrl,
      apiKey: "",
      model: provider.model ?? draft.model,
      haikuModel: roleModelFallback(provider, "haiku"),
      sonnetModel: roleModelFallback(provider, "sonnet"),
      opusModel: roleModelFallback(provider, "opus"),
    });
  };

  const handleNewCustom = () => {
    updateDraft({
      providerId: "custom",
      customName: "",
      baseUrl: "",
      apiKey: "",
      model: defaultCustomModel(tool),
      haikuModel: "",
      sonnetModel: "",
      opusModel: "",
    });
  };

  const handleCustomSelect = (provider: AgentCustomProviderSummary) => {
    onDraftChange({
      ...draft,
      providerId: customProviderSelector(provider.id),
      customName: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: "",
      model: provider.model ?? defaultCustomModel(tool),
      haikuModel: provider.haikuModel ?? "",
      sonnetModel: provider.sonnetModel ?? "",
      opusModel: provider.opusModel ?? "",
      extraConfig:
        provider.extraConfig ??
        buildAgentFullConfig(tool, {
          ...draft,
          providerId: customProviderSelector(provider.id),
          customName: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: "",
          model: provider.model ?? defaultCustomModel(tool),
          haikuModel: provider.haikuModel ?? "",
          sonnetModel: provider.sonnetModel ?? "",
          opusModel: provider.opusModel ?? "",
          extraConfig: "",
        }),
    });
  };

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
          return (
            <button
              key={provider.id}
              className={`xy-agent-provider ${isActive ? "is-active" : ""}`}
              type="button"
              style={
                {
                  "--xy-provider-color": provider.color,
                } as CSSProperties
              }
              onClick={() => handleProviderChange(provider.id)}
            >
              <span className="xy-provider-icon">{provider.icon}</span>
              <span className="xy-provider-label">{provider.label}</span>
            </button>
          );
        })}
      </div>

      <div className="xy-agent-custom-panel">
        <div className="xy-agent-custom-head">
          <span>自定义厂商</span>
          <button
            className={`xy-mini-btn xy-mini-btn--compact ${
              draft.providerId === "custom" ? "is-active" : ""
            }`}
            type="button"
            onClick={handleNewCustom}
          >
            <Plus size={12} strokeWidth={1.8} />
            新增
          </button>
        </div>
        <div className="xy-agent-custom-list">
          {customProviders.length === 0 && (
            <span className="xy-agent-custom-empty">暂无保存的自定义厂商</span>
          )}
          {customProviders.map((provider) => {
            const providerId = customProviderSelector(provider.id);
            const isActive = providerId === draft.providerId;
            return (
              <div
                key={provider.id}
                className={`xy-agent-custom-item ${
                  isActive ? "is-active" : ""
                }`}
                style={
                  {
                    "--xy-provider-color": "#64748B",
                  } as CSSProperties
                }
              >
                <button
                  className="xy-agent-custom-main"
                  type="button"
                  onClick={() => handleCustomSelect(provider)}
                  title={provider.endpoint}
                >
                  <span className="xy-provider-icon">
                    <NewAPI size={14} />
                  </span>
                  <span className="xy-agent-custom-text">
                    <strong>{provider.name}</strong>
                    <small>{provider.model || provider.endpoint}</small>
                  </span>
                  <span
                    className={`xy-agent-custom-token ${
                      provider.tokenConfigured ? "is-ready" : ""
                    }`}
                  >
                    {provider.tokenConfigured ? "Key" : "缺 Key"}
                  </span>
                </button>
                <button
                  className="xy-agent-custom-delete"
                  type="button"
                  title="删除自定义厂商"
                  onClick={() => onDeleteCustom(providerId)}
                >
                  <Trash2 size={12} strokeWidth={1.8} />
                </button>
              </div>
            );
          })}
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

        <label className="xy-field xy-field--wide">
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
          <input
            value={draft.apiKey}
            disabled={usesOfficial}
            type="password"
            placeholder={
              usesCustom
                ? selectedCustom?.tokenConfigured
                  ? "已保存，留空不显示"
                  : "sk-..."
                : state?.tokenConfigured
                  ? "已配置，留空不显示"
                  : "sk-..."
            }
            onChange={(e) => updateDraft({ apiKey: e.target.value })}
          />
        </label>

        {tool === "claude" ? (
          <div className="xy-agent-role-models xy-field--wide">
            <span className="xy-agent-role-title">Claude 模型角色</span>
            <div className="xy-agent-role-grid">
              <label className="xy-field">
                <span>Sonnet</span>
                <input
                  value={draft.sonnetModel}
                  placeholder="claude-sonnet / deepseek-v4-pro"
                  onChange={(e) =>
                    updateDraft({ sonnetModel: e.target.value })
                  }
                />
              </label>
              <label className="xy-field">
                <span>Opus</span>
                <input
                  value={draft.opusModel}
                  placeholder="claude-opus / deepseek-v4-pro"
                  onChange={(e) => updateDraft({ opusModel: e.target.value })}
                />
              </label>
              <label className="xy-field">
                <span>Haiku</span>
                <input
                  value={draft.haikuModel}
                  placeholder="claude-haiku / deepseek-v4-flash"
                  onChange={(e) => updateDraft({ haikuModel: e.target.value })}
                />
              </label>
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
              placeholder="gpt-5-codex"
              onChange={(e) => updateDraft({ model: e.target.value })}
            />
          </label>
        )}

        <div className="xy-field xy-field--wide">
          <div className="xy-field-head">
            <span>{tool === "claude" ? "完整 settings.json" : "完整 config.toml"}</span>
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
            spellCheck={false}
            placeholder={
              tool === "claude"
                ? '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://api.example.com/anthropic",\n    "ANTHROPIC_AUTH_TOKEN": "${ANTHROPIC_AUTH_TOKEN}",\n    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro",\n    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro",\n    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash"\n  }\n}'
                : 'model_provider = "xuya_custom_new-api"\nmodel = "gpt-5-codex"\nmodel_reasoning_effort = "high"\ndisable_response_storage = true\n\n[model_providers.xuya_custom_new-api]\nname = "new-api"\nbase_url = "https://api.example.com/v1"\nwire_api = "responses"\nexperimental_bearer_token = "${CODEX_API_KEY}"'
            }
            onChange={(e) =>
              updateDraft(
                { extraConfig: e.target.value },
                { syncFullConfig: false },
              )
            }
          />
        </div>
      </div>

      <div className="xy-agent-card-foot">
        <div className="xy-agent-meta">
          <span title={state?.path}>
            文件 {state?.path ? basenamePath(state.path) : "未读取"}
          </span>
          <span title={state?.endpoint ?? undefined}>
            端点 {usesOfficial ? "官方登录" : endpoint || "待填写"}
          </span>
        </div>
        <div className="xy-agent-actions">
          {usesCustom && (
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
              保存厂商
            </button>
          )}
          <button
            className="xy-mini-btn xy-mini-btn--accent"
            type="button"
            disabled={applying || saving}
            onClick={onApply}
          >
            {applying ? (
              <Loader2 className="xy-spin" size={13} strokeWidth={1.8} />
            ) : (
              <Save size={13} strokeWidth={1.8} />
            )}
            应用
          </button>
        </div>
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
