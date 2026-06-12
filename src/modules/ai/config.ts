export const KEYRING_SERVICE = "xuya-terminal";

export type ProviderId =
  | "deepseek"
  | "zhipu"
  | "minimax"
  | "kimi"
  | "xiaomimimo"
  | "openai-compatible";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  keyringAccount: string;
  keyPrefix: string | null;
  consoleUrl: string;
  /** Provider accepts (but does not require) an API key. */
  keyOptional?: boolean;
};

export const PROVIDERS: readonly ProviderInfo[] = [
  // ── 国产模型服务商 ──────────────────────────────────────────────────────
  {
    id: "deepseek",
    label: "DeepSeek",
    keyringAccount: "deepseek-api-key",
    keyPrefix: "sk-",
    consoleUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    keyringAccount: "zhipu-api-key",
    keyPrefix: null,
    consoleUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "minimax",
    label: "MiniMax",
    keyringAccount: "minimax-api-key",
    keyPrefix: null,
    consoleUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
  },
  {
    id: "kimi",
    label: "Kimi",
    keyringAccount: "kimi-api-key",
    keyPrefix: null,
    consoleUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "xiaomimimo",
    label: "小米 MiMo",
    keyringAccount: "xiaomimimo-api-key",
    keyPrefix: null,
    consoleUrl: "https://mimo.xiaomi.com/",
  },
  // ── 兼容服务商 ──────────────────────────────────────────────────────
  {
    id: "openai-compatible",
    label: "OpenAI 兼容",
    keyringAccount: "openai-compatible-api-key",
    keyPrefix: null,
    consoleUrl: "https://platform.openai.com/docs/api-reference",
    keyOptional: true,
  },
] as const;

export type CustomEndpoint = {
  id: string;
  name: string;
  baseURL: string;
  modelId: string;
  contextLimit: number;
};

const COMPAT_MODEL_PREFIX = "compat-";

export function compatModelIdForEndpoint(endpointId: string): string {
  return `${COMPAT_MODEL_PREFIX}${endpointId}`;
}

export function isCompatModelId(modelId: string): boolean {
  return modelId.startsWith(COMPAT_MODEL_PREFIX);
}

export function endpointIdFromCompatModel(modelId: string): string {
  return isCompatModelId(modelId)
    ? modelId.slice(COMPAT_MODEL_PREFIX.length)
    : "";
}

/** One-shot migration of the legacy single OpenAI-compatible config into the
 *  named-endpoint list. Returns one endpoint when the old base URL + model id
 *  were both set, else empty. `id` is supplied by the caller to stay pure. */
export function migrateLegacyCompatEndpoint(
  baseURL: string,
  modelId: string,
  contextLimit: number,
  id: string,
): CustomEndpoint[] {
  if (!baseURL.trim() || !modelId.trim()) return [];
  return [{ id, name: "自定义端点", baseURL, modelId, contextLimit }];
}

export function getProvider(id: ProviderId): ProviderInfo {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

/** 1 (lowest) – 5 (highest). For `cost`, higher = cheaper. */
export type CapabilityScore = 1 | 2 | 3 | 4 | 5;

export type ModelCapabilities = {
  intelligence: CapabilityScore;
  speed: CapabilityScore;
  cost: CapabilityScore;
};

export type ModelTag = "vision" | "reasoning" | "tools" | "coding";

export type ModelInfo = {
  id: string;
  provider: ProviderId;
  label: string;
  /** One short word for the dropdown trigger. */
  hint: string;
  /** One-line marketing-style description shown under the label. */
  description: string;
  capabilities: ModelCapabilities;
  tags?: readonly ModelTag[];
};

export const MODELS = [
  // ── DeepSeek ────────────────────────────────────────────────────────────
  {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    label: "DeepSeek V4 Pro",
    hint: "旗舰",
    description: "DeepSeek 最新旗舰模型，强大的推理和代码能力。",
    capabilities: { intelligence: 5, speed: 3, cost: 4 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    id: "deepseek-v4-flash",
    provider: "deepseek",
    label: "DeepSeek V4 Flash",
    hint: "快速",
    description: "低成本快速的日常使用。",
    capabilities: { intelligence: 4, speed: 5, cost: 5 },
    tags: ["reasoning", "tools"],
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    label: "DeepSeek Reasoner",
    hint: "思考",
    description: "开源价格的思维链推理。",
    capabilities: { intelligence: 5, speed: 2, cost: 4 },
    tags: ["reasoning", "coding"],
  },

  // ── 智谱 GLM ────────────────────────────────────────────────────────────
  {
    id: "glm-5.1",
    provider: "zhipu",
    label: "GLM-5.1",
    hint: "旗舰",
    description: "智谱最新旗舰模型，强大的推理和代码能力。",
    capabilities: { intelligence: 5, speed: 3, cost: 3 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "glm-4-flash",
    provider: "zhipu",
    label: "GLM-4 Flash",
    hint: "快速",
    description: "快速响应的日常使用模型。",
    capabilities: { intelligence: 4, speed: 5, cost: 4 },
    tags: ["vision", "tools"],
  },

  // ── MiniMax ──────────────────────────────────────────────────────────────
  {
    id: "MiniMax-M2.7",
    provider: "minimax",
    label: "MiniMax M2.7",
    hint: "旗舰",
    description: "MiniMax 最新旗舰模型。",
    capabilities: { intelligence: 5, speed: 3, cost: 3 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "MiniMax-Text-01",
    provider: "minimax",
    label: "MiniMax Text 01",
    hint: "快速",
    description: "快速文本生成模型。",
    capabilities: { intelligence: 4, speed: 4, cost: 4 },
    tags: ["tools"],
  },

  // ── Kimi ─────────────────────────────────────────────────────────────────
  {
    id: "kimi-k2.6",
    provider: "kimi",
    label: "Kimi K2.6",
    hint: "旗舰",
    description: "Kimi 最新旗舰模型，强大的长文本处理能力。",
    capabilities: { intelligence: 5, speed: 3, cost: 3 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "kimi-latest",
    provider: "kimi",
    label: "Kimi Latest",
    hint: "快速",
    description: "Kimi 快速响应模型。",
    capabilities: { intelligence: 4, speed: 4, cost: 4 },
    tags: ["tools"],
  },

  // ── 小米 MiMo ────────────────────────────────────────────────────────────
  {
    id: "mimo-v2.5-pro",
    provider: "xiaomimimo",
    label: "MiMo V2.5 Pro",
    hint: "旗舰",
    description: "小米 MiMo 最新旗舰模型。",
    capabilities: { intelligence: 5, speed: 3, cost: 3 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "mimo-latest",
    provider: "xiaomimimo",
    label: "MiMo Latest",
    hint: "快速",
    description: "小米 MiMo 快速响应模型。",
    capabilities: { intelligence: 4, speed: 4, cost: 4 },
    tags: ["tools"],
  },

  // ── Generic OpenAI-compatible (user-defined endpoint) ─────────────────────
  {
    id: "openai-compatible-custom",
    provider: "openai-compatible",
    label: "自定义端点",
    hint: "可配置",
    description: "任意 OpenAI 兼容端点。",
    capabilities: { intelligence: 3, speed: 3, cost: 3 },
  },
] as const satisfies readonly ModelInfo[];

export type ModelId = (typeof MODELS)[number]["id"];

export function getCompatModelInfo(
  modelId: string,
  endpoints: readonly CustomEndpoint[],
): ModelInfo {
  const eid = endpointIdFromCompatModel(modelId);
  const ep = endpoints.find((e) => e.id === eid);
  const name = ep?.name || "自定义端点";
  return {
    id: modelId,
    provider: "openai-compatible",
    label: ep?.modelId || name,
    hint: name,
    description: ep ? `${name} — ${ep.baseURL}` : "自定义 OpenAI 兼容端点",
    capabilities: { intelligence: 3, speed: 3, cost: 3 },
  };
}

export function resolveModel(
  modelId: string,
  endpoints: readonly CustomEndpoint[] = [],
): ModelInfo {
  if (isCompatModelId(modelId)) return getCompatModelInfo(modelId, endpoints);
  const m = MODELS.find((x) => x.id === modelId);
  if (!m) throw new Error(`Unknown model: ${modelId}`);
  return m;
}

export function getModel(id: ModelId): ModelInfo {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model: ${id}`);
  return m;
}

export function isKnownModelId(id: string): id is ModelId {
  return MODELS.some((x) => x.id === id);
}

const FREEFORM_PROVIDERS: ReadonlySet<ProviderId> = new Set([
  "openai-compatible",
  "zhipu",
  "minimax",
  "kimi",
  "xiaomimimo",
]);

// Reasoning models reject tool-call turns whose reasoning was stripped; keep it.
export function modelKeepsReasoning(m: ModelInfo): boolean {
  return (m.tags?.includes("reasoning") ?? false) || FREEFORM_PROVIDERS.has(m.provider);
}

export const DEFAULT_MODEL_ID: ModelId = "deepseek-v4-pro";

/** Approximate context window (in tokens) per model. Used for the
 *  context-usage indicator in the AI mini-window header. Conservative
 *  estimates — actual provider limits may shift. */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // DeepSeek
  "deepseek-v4-pro": 1_000_000,
  "deepseek-v4-flash": 1_000_000,
  "deepseek-reasoner": 128_000,
  // 智谱 GLM
  "glm-5.1": 128_000,
  "glm-4-flash": 128_000,
  // MiniMax
  "MiniMax-M2.7": 256_000,
  "MiniMax-Text-01": 256_000,
  // Kimi
  "kimi-k2.6": 256_000,
  "kimi-latest": 128_000,
  // 小米 MiMo
  "mimo-v2.5-pro": 128_000,
  "mimo-latest": 128_000,
  // 通用
  "openai-compatible-custom": 128_000,
};

export function getModelContextLimit(
  modelId: string | undefined,
  compatOverride?: number,
): number {
  if (!modelId) return 128_000;
  if (isCompatModelId(modelId)) return compatOverride ?? 128_000;
  if (modelId === "openai-compatible-custom" && compatOverride)
    return compatOverride;
  return MODEL_CONTEXT_LIMITS[modelId] ?? 128_000;
}

export type ModelPricing = {
  input: number;
  output: number;
  cacheRead?: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // DeepSeek
  "deepseek-v4-pro": { input: 0.28, output: 1.1, cacheRead: 0.028 },
  "deepseek-v4-flash": { input: 0.07, output: 0.27, cacheRead: 0.007 },
  "deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0.14 },
  // 智谱 GLM
  "glm-5.1": { input: 0.5, output: 1.5 },
  "glm-4-flash": { input: 0.1, output: 0.3 },
  // MiniMax
  "MiniMax-M2.7": { input: 0.5, output: 1.5 },
  "MiniMax-Text-01": { input: 0.2, output: 0.6 },
  // Kimi
  "kimi-k2.6": { input: 0.5, output: 1.5 },
  "kimi-latest": { input: 0.2, output: 0.6 },
  // 小米 MiMo
  "mimo-v2.5-pro": { input: 0.5, output: 1.5 },
  "mimo-latest": { input: 0.2, output: 0.6 },
};

export function estimateCost(
  modelId: string | undefined,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number },
): number | null {
  if (!modelId) return null;
  const p = MODEL_PRICING[modelId];
  if (!p) return null;
  const fresh = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cached = usage.cachedInputTokens;
  return (
    (fresh * p.input + cached * (p.cacheRead ?? p.input) + usage.outputTokens * p.output) /
    1_000_000
  );
}

export function providerNeedsKey(_id: ProviderId): boolean {
  return true;
}

export function providerSupportsKey(id: ProviderId): boolean {
  return providerNeedsKey(id);
}

export const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = "";
export const MAX_AGENT_STEPS = 24;
export const TERMINAL_BUFFER_LINES = 300;

// 兼容性导出
export const LMSTUDIO_DEFAULT_BASE_URL = "http://localhost:1234/v1";
export const MLX_DEFAULT_BASE_URL = "http://127.0.0.1:8080/v1";
export const DEFAULT_AUTOCOMPLETE_MODEL = "deepseek-v4-flash";
export type AutocompleteProviderId = ProviderId;
export function getAutocompleteEligibleModels(): ModelInfo[] {
  return MODELS.filter(m => m.capabilities.speed >= 4);
}

export const SYSTEM_PROMPT = `You are XuYa Terminal, an AI agent embedded in a developer terminal emulator. You are a hands-on engineer, not a chat bot — your job is to *do* the work, not narrate it.

# Environment
Every turn carries a short <env> block (prepended to the latest user message): workspace_root, active_terminal_cwd, optionally active_file. Treat it as ground truth — never ask the user where they are. The terminal scrollback is NOT auto-injected; call get_terminal_output only when the user references "this error" / "the last command" or you genuinely need to interpret recent output.

# Tool discipline
- Use tools to *act* — don't describe what you'd do.
- Read before write: open the file (or relevant files) before editing.
- Batch independent tool calls in one turn.
- When multiple files need the same transformation, process them in parallel.
- Prefer targeted searches (grep / file patterns) over scanning entire directories.
- After a shell command, check its output. If it fails, investigate before retrying.

# Editing rules
- Use the edit tool with the minimal diff; never rewrite an entire file if a few lines suffice.
- Include just enough surrounding context to make the change unambiguous.
- Preserve existing style (indentation, quotes, naming conventions).
- If a change touches generated code or a config format, confirm the tool you use respects the file's schema.

# Shell rules
- Use non-interactive flags (e.g. \`-y\`, \`--no-confirm\`, \`| cat\`) to avoid blocking on prompts.
- Prefer portable commands; avoid shell-specific tricks unless you know the user's shell.
- Don't chain long commands with && when a script file would be clearer — write a temp script, run it, then delete it.

# Refusals
- Decline clearly harmful or illegal requests (malware, credential theft, etc.).
- If a request is ambiguous, ask a concise clarifying question before acting.

# Style
- Be terse. No preamble, no postamble, no emoji unless the user uses them first.
- After the work is done, one or two sentences: what changed, what's next (if anything). Don't recap the diff — the user can see it.
- Code blocks always carry a language fence.
- Refused reads on sensitive files (.env, .ssh, credentials) are final — don't retry.`;

export const SYSTEM_PROMPT_LITE = `You are XuYa Terminal, an AI agent in a developer terminal. Each turn carries an <env> block (workspace_root, active_terminal_cwd, optional active_file) prepended to the user's message — treat as ground truth.

# Tools
Use tools to act, not narrate. Read a file before editing. Batch independent calls. Prefer targeted searches.

# Editing
Minimal diffs. Preserve style. Respect generated-code schemas.

# Shell
Non-interactive flags. Prefer portable commands. Check output before retrying.

# Refusals
Decline clearly harmful requests. Ask one concise clarifying question if ambiguous.

# Style
Terse. No preamble/postamble. Code blocks with language fence. Sensitive reads are final.`;

export function selectSystemPrompt(modelId: string): string {
  const liteModels = new Set([
    "glm-4-flash",
    "MiniMax-Text-01",
    "kimi-latest",
    "mimo-latest",
    "deepseek-v4-flash",
  ]);
  return liteModels.has(modelId) ? SYSTEM_PROMPT_LITE : SYSTEM_PROMPT;
}
