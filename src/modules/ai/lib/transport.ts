import type { UIMessage } from "ai";
import type { ToolContext } from "../tools/context";
import type { ProviderKeys, CustomEndpointKeys } from "./keyring";
import { buildLanguageModel, runAgent, type AgentUsage, type AgentUsageDelta } from "./agent";
import type { CustomEndpoint, ProviderId } from "../config";

export type { AgentUsage, AgentUsageDelta };

export type Live = {
  getCwd: () => string | null;
  getWorkspaceRoot: () => string | null;
  getActiveFile: () => string | null;
  isActiveTerminalPrivate: () => boolean;
  getTerminalContext: () => string | null;
  injectIntoActivePty: (text: string) => boolean;
  openPreview: (url: string) => boolean;
  spawnAgent: (prompt: string) => { tabId: number; leafId: number } | null;
  readAgentOutput: (leafId: number) => string | null;
  readCache: Map<string, { size: number; hash: number }>;
  getSessionId: () => string | null;
};

export type SendOptions = {
  messages: UIMessage[];
  signal?: AbortSignal;
};

export type TransportDeps = {
  getLive: () => Live;
  getKeys: () => ProviderKeys;
  getModelId: () => string;
  getCustomInstructions: () => string;
  getAgentPersona: () => string | null;
  toolContext: ToolContext;
  onStep: (step: string) => void;
  onUsage: (delta: AgentUsageDelta) => void;
  onCompact: (info: { droppedCount: number }) => void;
  onFinishMeta: (meta: { finishReason: string; steps: number }) => void;
  getOllamaBaseURL?: () => string;
  getOllamaModelId?: () => string;
  getOpenaiCompatibleBaseURL?: () => string;
  getOpenaiCompatibleModelId?: () => string;
  getOpenaiCompatibleContextLimit?: () => number;
  getCustomEndpoints?: () => readonly CustomEndpoint[];
  getCustomEndpointKeys?: () => CustomEndpointKeys;
  getPlanMode?: () => boolean;
};

function formatEnvBlock(live: Live): string | null {
  const cwd = live.getCwd();
  const root = live.getWorkspaceRoot();
  const file = live.getActiveFile();
  if (!cwd && !root && !file) return null;
  const parts: string[] = [];
  if (root) parts.push(`workspace_root=${root}`);
  if (cwd) parts.push(`active_terminal_cwd=${cwd}`);
  if (file) parts.push(`active_file=${file}`);
  return parts.length ? `<env>\n${parts.join("\n")}\n</env>` : null;
}

function injectEnvIntoLastUser(messages: UIMessage[], envBlock: string): UIMessage[] {
  if (!messages.length) return messages;
  const last = messages[messages.length - 1];
  if (last.role !== "user") return messages;
  // UIMessage content is an array of parts, prepend env block as text
  const updated = {
    ...last,
    parts: [
      { type: "text" as const, text: `${envBlock}\n\n` },
      ...last.parts,
    ],
  };
  return [...messages.slice(0, -1), updated];
}

export function createTransport(deps: TransportDeps) {
  return {
    async send(options: SendOptions): Promise<void> {
      const live = deps.getLive();
      const envBlock = formatEnvBlock(live);
      const messagesForRun = envBlock
        ? injectEnvIntoLastUser(options.messages, envBlock)
        : options.messages;

      const model = await buildLanguageModel(
        deps.getModelId(),
        "deepseek" as ProviderId,
        deps.getKeys(),
        deps.getModelId(),
        {
          openaiCompatibleBaseURL: deps.getOpenaiCompatibleBaseURL?.(),
        },
      );

      const result = await runAgent(
        model,
        messagesForRun,
        deps.toolContext,
        { signal: options.signal },
      );

      deps.onFinishMeta({
        finishReason: result.finishReason,
        steps: result.steps,
      });
    },
  };
}
