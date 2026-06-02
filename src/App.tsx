import { useEffect, useState } from "react";
import type { DockviewApi } from "dockview-react";
import DockviewLayout from "./components/DockviewLayout";
import CommandPalette from "./components/CommandPalette";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import Modals from "./components/Modals";
import { useSessionStore } from "./stores/sessionStore";
import { useUIStore } from "./stores/uiStore";
import { useSettingsStore } from "./stores/settingsStore";
import "@xterm/xterm/css/xterm.css";

export default function App() {
  const [api, setApi] = useState<DockviewApi | null>(null);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  // Dockview ↔ session focus sync.
  useEffect(() => {
    if (!api) return;
    const dispose = api.onDidActivePanelChange((panel) => {
      if (panel?.id) useSessionStore.getState().setActive(panel.id);
    });
    return () => dispose.dispose();
  }, [api]);

  // Global zoom shortcuts: Ctrl+= / Ctrl+- / Ctrl+0.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const { zoomIn, zoomOut, resetZoom } = useSettingsStore.getState();
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="xy-app"
      data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
    >
      <TopBar />

      <div className="xy-body">
        <Sidebar api={api} />
        <main className="xy-main">
          <DockviewLayout onApiReady={setApi} />
        </main>
      </div>

      <StatusBar />

      <CommandPalette api={api} />
      <Modals />
    </div>
  );
}
