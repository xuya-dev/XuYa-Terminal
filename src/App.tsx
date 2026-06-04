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
import { useModalStore } from "./stores/modalStore";
import { check } from "@tauri-apps/plugin-updater";
import { ask } from "@tauri-apps/plugin-dialog";
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

  // Periodic update check
  useEffect(() => {
    let promptedVersion = "";

    const checkUpdate = async () => {
      // Avoid checking update if not running under Tauri (e.g. in browser dev)
      if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
        return;
      }
      try {
        const update = await check();
        if (update && update.version !== promptedVersion) {
          promptedVersion = update.version;
          const yes = await ask(
            `发现新版本 v${update.version}，是否前往“关于”页面进行升级？`,
            {
              title: "发现新版本",
              kind: "info",
              okLabel: "去更新",
              cancelLabel: "稍后",
            }
          );
          if (yes) {
            useModalStore.getState().openModal("about");
          }
        }
      } catch (err) {
        console.error("Auto update check failed:", err);
      }
    };

    // Check immediately on startup
    void checkUpdate();

    // Check every 12 hours
    const interval = setInterval(() => {
      void checkUpdate();
    }, 12 * 60 * 60 * 1000);

    return () => {
      clearInterval(interval);
    };
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
