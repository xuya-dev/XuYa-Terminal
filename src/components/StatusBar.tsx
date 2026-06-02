import { useEffect, useState } from "react";
import { Activity, Clock, FolderOpen, Maximize2 } from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import { useSettingsStore } from "../stores/settingsStore";

function formatUptime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function shellLabelFor(kind: string): string {
  return (
    {
      powerShell: "PowerShell",
      pwsh: "pwsh",
      cmd: "CMD",
      wsl: "WSL",
      gitBash: "Git Bash",
    }[kind] ?? kind
  );
}

/** POSIX-y shells default to LF; Windows shells to CRLF. */
function eolFor(kind?: string): string {
  return kind === "wsl" || kind === "gitBash" ? "LF" : "CRLF";
}

export default function StatusBar() {
  const active = useSessionStore((s) =>
    s.sessions.find((x) => x.id === s.activeId) ?? null,
  );
  const zoom = useSettingsStore((s) => s.zoom);
  const resetZoom = useSettingsStore((s) => s.resetZoom);
  const [, setTick] = useState(0);

  // One-second tick — forces uptime to re-render.
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const uptime = active ? formatUptime(Date.now() - active.startTime) : "—";
  const shell = active ? shellLabelFor(active.shellKind) : "无活跃会话";
  const cwd = active?.cwd ?? "—";

  return (
    <footer className="xy-statusbar">
      <div className="xy-status-left">
        <span
          className="xy-status-chip"
          data-tone={active?.status ?? "idle"}
        >
          <Activity size={12} strokeWidth={2} />
          <span>{shell}</span>
        </span>
        <span className="xy-status-chip xy-status-chip--ghost">
          <Clock size={12} strokeWidth={1.7} />
          <span>运行时间 {uptime}</span>
        </span>
        <span className="xy-status-chip xy-status-chip--ghost">
          <FolderOpen size={12} strokeWidth={1.7} />
          <span className="xy-status-cwd" title={cwd}>
            {cwd}
          </span>
        </span>
      </div>

      <div className="xy-status-right">
        <span className="xy-status-pill">UTF-8</span>
        <span className="xy-status-pill">{eolFor(active?.shellKind)}</span>
        <button
          className="xy-status-pill xy-status-pill--btn"
          onClick={resetZoom}
          title="点击重置为 100%"
        >
          <Maximize2 size={11} strokeWidth={1.7} />
          {zoom}%
        </button>
      </div>
    </footer>
  );
}
