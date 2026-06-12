import {
  convertToModelMessages,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";
import {
  endpointIdFromCompatModel,
  isCompatModelId,
  providerNeedsKey,
  resolveModel,
  type CustomEndpoint,
  type ProviderId,
} from "../config";
import { buildTools, type ToolContext } from "../tools/tools";
import type { ProviderKeys, CustomEndpointKeys } from "./keyring";
import { createProxyFetch } from "./proxyFetch";

const localProxyFetch = createProxyFetch({ allowPrivateNetwork: true });

type BuildModelOptions = {
  openaiCompatibleBaseURL?: string;
};

const modelCache = new Map<string, LanguageModel>();

export async function buildLanguageModel(
  _modelId: string,
  provider: ProviderId,
  keys: ProviderKeys,
  resolvedModelId: string,
  options: BuildModelOptions = {},
  customEndpointKey?: string | null,
): Promise<LanguageModel> {
  if (providerNeedsKey(provider) && !keys[provider]) {
    throw new Error(
      `${provider} 未配置 API 密钥。请打开设置 → AI 添加。`,
    );
  }
  const key = keys[provider] ?? "";
  const compatURL = options.openaiCompatibleBaseURL ?? "";
  const epKey = customEndpointKey ?? "";
  const cacheKey = `${provider} ${key} ${epKey} ${resolvedModelId} ${compatURL}`;
  const hit = modelCache.get(cacheKey);
  if (hit) return hit;

  let built: LanguageModel;
  switch (provider) {
    case "deepseek": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "deepseek",
        baseURL: "https://api.deepseek.com",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "zhipu": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "zhipu",
        baseURL: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "minimax": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "minimax",
        baseURL: "https://api.minimax.chat/v1",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "kimi": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "kimi",
        baseURL: "https://api.moonshot.cn/v1",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "xiaomimimo": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "xiaomimimo",
        baseURL: "https://api.xiaomimimo.com/v1",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "openai-compatible": {
      if (!compatURL) {
        throw new Error(
          "OpenAI 兼容服务商未设置基础 URL。请在设置 → 模型中设置。",
        );
      }
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: compatURL,
        apiKey: epKey || key || undefined,
        fetch: localProxyFetch,
      })(resolvedModelId);
      break;
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${_exhaustive as ProviderId}`);
    }
  }
  modelCache.set(cacheKey, built);
  return built;
}

export type LocalProviderConfig = {
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  customEndpoints?: readonly CustomEndpoint[];
  customEndpointKeys?: CustomEndpointKeys;
};

export function buildConfiguredLanguageModel(
  modelId: string,
  keys: ProviderKeys,
  local: LocalProviderConfig = {},
): Promise<LanguageModel> {
  if (isCompatModelId(modelId)) {
    const eid = endpointIdFromCompatModel(modelId);
    const ep = local.customEndpoints?.find((e) => e.id === eid);
    if (!ep) throw new Error(`Unknown custom endpoint: ${eid}`);
    return buildLanguageModel(
      modelId,
      "openai-compatible",
      keys,
      ep.modelId,
      { openaiCompatibleBaseURL: ep.baseURL },
      local.customEndpointKeys?.[ep.id],
    );
  }
  const m = resolveModel(modelId, local.customEndpoints);
  const provider = m.provider;
  let resolvedModelId = m.id;
  if (provider === "openai-compatible") {
    resolvedModelId = local.openaiCompatibleModelId || m.id;
  }
  return buildLanguageModel(
    modelId,
    provider,
    keys,
    resolvedModelId,
    {
      openaiCompatibleBaseURL: local.openaiCompatibleBaseURL,
    },
    local.customEndpointKeys?.["openai-compatible"],
  );
}

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
};

export type AgentRunCallbacks = {
  onChunk?: (text: string) => void;
  onToolCall?: (label: string) => void;
  onToolResult?: (label: string, isError: boolean) => void;
  onThinking?: (text: string) => void;
  onStepFinish?: () => void;
};

export type AgentRunResult = {
  text: string;
  finishReason: string;
  steps: number;
  usage: AgentUsage;
};

export async function runAgent(
  model: LanguageModel,
  messages: UIMessage[],
  ctx: ToolContext,
  options?: { signal?: AbortSignal },
): Promise<AgentRunResult> {
  const modelMessages = await convertToModelMessages(messages);
  const tools = buildTools(ctx);

  let accumulated = "";
  let steps = 0;
  let finishReason = "stop";
  let totalInput = 0;
  let totalOutput = 0;
  let totalCached = 0;
  let totalReasoning = 0;

  const result = streamText({
    model,
    messages: modelMessages,
    tools,
    toolChoice: "auto",
    abortSignal: options?.signal,
    onStepFinish: async ({ finishReason: fr, usage }) => {
      steps++;
      finishReason = fr ?? "stop";
      totalInput += usage?.inputTokens ?? 0;
      totalOutput += usage?.outputTokens ?? 0;
      totalCached += usage?.cachedInputTokens ?? 0;
      totalReasoning += usage?.reasoningTokens ?? 0;
    },
  });

  for await (const chunk of result.textStream) {
    accumulated += chunk;
  }

  return {
    text: accumulated,
    finishReason,
    steps,
    usage: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cachedInputTokens: totalCached,
      totalTokens: totalInput + totalOutput,
      reasoningTokens: totalReasoning,
    },
  };
}

export async function* runAgentStream(
  model: LanguageModel,
  messages: UIMessage[],
  ctx: ToolContext,
  options?: { signal?: AbortSignal },
): AsyncGenerator<{ type: string; content: string }, void, unknown> {
  const modelMessages = await convertToModelMessages(messages);
  const tools = buildTools(ctx);

  const result = streamText({
    model,
    messages: modelMessages,
    tools,
    toolChoice: "auto",
    abortSignal: options?.signal,
  });

  for await (const chunk of result.textStream) {
    yield { type: "text", content: chunk };
  }
}

export type AgentUsageDelta = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
};
