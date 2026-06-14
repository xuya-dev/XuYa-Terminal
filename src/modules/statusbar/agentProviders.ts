/**
 * Built-in agent providers shown by the status-bar switcher and the settings
 * page. Kept in sync with `src/settings/sections/AgentConfigSection.tsx`.
 *
 * The selector id of a custom provider is its store id prefixed with
 * `custom:` — this matches the backend `CUSTOM_PROVIDER_SELECTOR_PREFIX`
 * convention in `src-tauri/src/modules/agent_config.rs`, so a provider id
 * round-trips unchanged between the dropdown and `apply_agent_provider_config`.
 */

export type AgentTool = "claude" | "codex";

export type BuiltInProvider = {
  id: string;
  name: string;
  baseUrl: string;
};

export const CUSTOM_PROVIDER_PREFIX = "custom:";

export const CLAUDE_BUILTIN_PROVIDERS: BuiltInProvider[] = [
  { id: "official", name: "官方", baseUrl: "" },
  { id: "zhipu", name: "ZhiPu GLM", baseUrl: "https://open.bigmodel.cn/api/anthropic" },
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimaxi.com/anthropic" },
  { id: "kimi", name: "Kimi", baseUrl: "https://api.kimi.com/coding" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic" },
  { id: "xiaomimimo", name: "XiaoMi MiMo", baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic" },
];

export const CODEX_BUILTIN_PROVIDERS: BuiltInProvider[] = [
  { id: "official", name: "官方 (OpenAI)", baseUrl: "" },
];

export function builtinProviders(tool: AgentTool): BuiltInProvider[] {
  return tool === "claude" ? CLAUDE_BUILTIN_PROVIDERS : CODEX_BUILTIN_PROVIDERS;
}

/** Build the dropdown selector id for a custom provider store id. */
export function customProviderSelector(storeId: string): string {
  return `${CUSTOM_PROVIDER_PREFIX}${storeId}`;
}

/** Resolve a friendly label for a provider selector id, falling back to the id. */
export function providerLabel(
  tool: AgentTool,
  providerId: string | null | undefined,
  customNames: Map<string, string>,
): string {
  if (!providerId) return "未配置";
  if (providerId.startsWith(CUSTOM_PROVIDER_PREFIX)) {
    const storeId = providerId.slice(CUSTOM_PROVIDER_PREFIX.length);
    return customNames.get(storeId) ?? providerId;
  }
  return builtinProviders(tool).find((p) => p.id === providerId)?.name ?? providerId;
}
