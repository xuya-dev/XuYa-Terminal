import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IS_WINDOWS } from "@/lib/platform";
import {
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { Refresh01Icon, ServerStack03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Props = {
  onSelect: (env: WorkspaceEnv) => void;
};

export function WorkspaceEnvSelector({ onSelect }: Props) {
  if (!IS_WINDOWS) return null;

  const env = useWorkspaceEnvStore((s) => s.env);
  const distros = useWorkspaceEnvStore((s) => s.distros);
  const loading = useWorkspaceEnvStore((s) => s.loading);
  const error = useWorkspaceEnvStore((s) => s.error);
  const refreshDistros = useWorkspaceEnvStore((s) => s.refreshDistros);

  const handleOpenChange = (open: boolean) => {
    if (open && distros.length === 0 && !loading) {
      void refreshDistros();
    }
  };

  const label = env.kind === "wsl" ? `WSL: ${env.distro}` : "Windows 本地";

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 data-[state=open]:bg-accent data-[state=open]:text-foreground"
          title="工作区环境"
        >
          <HugeiconsIcon
            icon={ServerStack03Icon}
            size={13}
            strokeWidth={1.75}
          />
          <span className="max-w-28 truncate">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuItem onSelect={() => onSelect(LOCAL_WORKSPACE)}>
          Windows 本地
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {distros.length === 0 ? (
          <DropdownMenuItem disabled>
            {loading
              ? "加载 WSL 发行版中..."
              : error
                ? "WSL 不可用"
                : "未找到 WSL 发行版"}
          </DropdownMenuItem>
        ) : (
          distros.map((distro) => (
            <DropdownMenuItem
              key={distro.name}
              onSelect={() => onSelect({ kind: "wsl", distro: distro.name })}
            >
              WSL: {distro.name}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void refreshDistros()}>
          <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={1.75} />
          刷新
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
