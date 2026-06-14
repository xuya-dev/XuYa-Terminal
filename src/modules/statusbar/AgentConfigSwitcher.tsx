import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { launchAgentInLeaf } from "@/modules/terminal/lib/launchAgent";
import { respawnSession } from "@/modules/terminal/lib/useTerminalSession";
import { CheckmarkCircle02Icon, CoinsSwapIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import {
  builtinProviders,
  customProviderSelector,
  providerLabel,
  type AgentTool,
} from "./agentProviders";

type BuiltInProviderSummary = {
  id: string;
  tokenConfigured: boolean;
};

type CustomProviderSummary = {
  id: string;
  name: string;
  tokenConfigured: boolean;
};

type ToolConfigState = {
  activeProvider?: string | null;
  builtInProviders?: BuiltInProviderSummary[];
  customProviders?: CustomProviderSummary[];
};

type AgentConfigState = {
  claude: ToolConfigState;
  codex: ToolConfigState;
};

type Props = {
  tool: AgentTool;
  leafId: number;
  agentSessionId?: string;
  cwd: string | null;
  onSessionCaptured: (id: string) => void;
};

/**
 * Status-bar switcher for the active Claude Code / Codex provider. Visible only
 * on agent tabs. Switching writes the chosen provider to the agent's config
 * file (backend fills in baseUrl/apiKey/model from its store) and then restarts
 * the current agent's PTY, resuming the same conversation under the new config.
 */
export function AgentConfigSwitcher({
  tool,
  leafId,
  agentSessionId,
  cwd,
  onSessionCaptured,
}: Props) {
  const [active, setActive] = useState<string | null>(null);
  const [builtins, setBuiltins] = useState<BuiltInProviderSummary[]>([]);
  const [customs, setCustoms] = useState<CustomProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const state = await invoke<AgentConfigState>("get_agent_config_state");
      const toolState = state[tool];
      setActive(toolState.activeProvider ?? null);
      setBuiltins(toolState.builtInProviders ?? []);
      setCustoms(toolState.customProviders ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [tool]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void load();
  }, [load]);

  const customNames = new Map(customs.map((c) => [c.id, c.name]));
  const label = providerLabel(tool, active, customNames);
  const triggerTitle =
    tool === "claude" ? "切换 Claude Code 服务商" : "切换 Codex 服务商";

  const handleSwitch = async (providerId: string) => {
    if (providerId === active || switching) return;
    setSwitching(true);
    setError(null);
    try {
      // 1. Backend writes ~/.claude/settings.json or ~/.codex/config.toml. Only
      //    tool + providerId are needed — the backend fills in the rest from
      //    its provider store / known defaults.
      await invoke("apply_agent_provider_config", {
        request: { tool, providerId },
      });
      // 2. Refresh the selected state so the dropdown reflects the new choice.
      await load();
      // 3. Restart the current agent PTY and re-run the command under the new
      //    config. Resume the same conversation when a session id is bound so
      //    context is preserved; Claude --resume forks a new session which is
      //    re-bound via onSessionCaptured.
      await respawnSession(leafId);
      await launchAgentInLeaf(leafId, tool, {
        sessionId: agentSessionId,
        cwd,
        onSessionCaptured,
      });
    } catch (e) {
      setError(String(e));
      // Re-read so the trigger reflects what actually got applied.
      void load();
    } finally {
      setSwitching(false);
    }
  };

  // Only show providers that have a key configured — an unconfigured provider
  // can't be switched to. The "official" entry is the OAuth baseline and is
  // always kept. The currently-active provider is also force-kept so the user
  // can always see (and switch away from) what's in effect right now.
  const configuredBuiltInIds = new Set(
    builtins.filter((p) => p.tokenConfigured).map((p) => p.id),
  );
  const visibleBuiltins = builtinProviders(tool).filter(
    (p) =>
      p.id === "official" ||
      p.id === active ||
      configuredBuiltInIds.has(p.id),
  );
  const visibleCustoms = customs.filter(
    (c) =>
      c.tokenConfigured || active === customProviderSelector(c.id),
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={switching}
          className="flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 data-[state=open]:bg-accent data-[state=open]:text-foreground disabled:opacity-50"
          title={triggerTitle}
        >
          <HugeiconsIcon icon={CoinsSwapIcon} size={13} strokeWidth={1.75} />
          <span className="max-w-32 truncate">{switching ? "切换中…" : label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>
          {tool === "claude" ? "Claude Code 服务商" : "Codex 服务商"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading ? (
          <DropdownMenuItem disabled>加载中…</DropdownMenuItem>
        ) : visibleBuiltins.length === 0 && visibleCustoms.length === 0 ? (
          <DropdownMenuItem disabled>
            尚无可切换的服务商（请先在设置中配置 Key）
          </DropdownMenuItem>
        ) : (
          <>
            {visibleBuiltins.map((p) => (
              <ProviderItem
                key={p.id}
                id={p.id}
                name={p.name}
                selected={active === p.id}
                disabled={switching}
                onSelect={handleSwitch}
              />
            ))}
            {visibleCustoms.length > 0 && (
              <>
                <DropdownMenuSeparator />
                {visibleCustoms.map((c) => {
                  const sel = customProviderSelector(c.id);
                  return (
                    <ProviderItem
                      key={c.id}
                      id={sel}
                      name={c.name}
                      selected={active === sel}
                      disabled={switching}
                      onSelect={handleSwitch}
                    />
                  );
                })}
              </>
            )}
          </>
        )}
        {error ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-[10.5px] text-destructive">切换失败: {error}</div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderItem({
  id,
  name,
  selected,
  disabled,
  onSelect,
}: {
  id: string;
  name: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={() => void onSelect(id)}
      className="gap-2"
    >
      <span className="flex-1 truncate">{name}</span>
      {selected ? (
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} strokeWidth={1.75} />
      ) : null}
    </DropdownMenuItem>
  );
}
