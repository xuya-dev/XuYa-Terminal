import {
  DockviewReact,
  DockviewReadyEvent,
  DockviewApi,
  IDockviewPanelProps,
  type GetTabContextMenuItemsParams,
  type ReactContextMenuItemConfig,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { useEffect, useState, useCallback } from "react";
import TerminalView from "./TerminalView";
import PanelTab from "./PanelTab";
import Watermark from "./Watermark";
import { RightHeaderActions } from "./HeaderActions";
import { openTerminal } from "../lib/panels";

const components: Record<string, React.FC<IDockviewPanelProps>> = {
  terminal: TerminalView,
};

const tabComponents = {
  default: PanelTab,
};

const LAYOUT_KEY = "xuya-layout";

function closeTabs(
  params: GetTabContextMenuItemsParams,
  mode: "left" | "right" | "others" | "all",
) {
  const panels = [...params.group.panels];
  const currentIndex = panels.findIndex((p) => p.id === params.panel.id);
  if (currentIndex === -1) return;

  const targets = panels.filter((p, index) => {
    const shouldClose =
      mode === "all" ||
      (mode === "left" && index < currentIndex) ||
      (mode === "right" && index > currentIndex) ||
      (mode === "others" && p.id !== params.panel.id);

    return shouldClose;
  });

  targets.forEach((p) => p.api.close());
}

function getTabContextMenuItems(
  params: GetTabContextMenuItemsParams,
): ReactContextMenuItemConfig[] {
  const panels = [...params.group.panels];
  const currentIndex = panels.findIndex((p) => p.id === params.panel.id);
  const hasLeft = currentIndex > 0;
  const hasRight = currentIndex >= 0 && currentIndex < panels.length - 1;
  const hasOthers = panels.length > 1;

  return [
    {
      label: "关闭左侧标签",
      disabled: !hasLeft,
      action: () => closeTabs(params, "left"),
    },
    {
      label: "关闭右侧标签",
      disabled: !hasRight,
      action: () => closeTabs(params, "right"),
    },
    {
      label: "关闭其他标签",
      disabled: !hasOthers,
      action: () => closeTabs(params, "others"),
    },
    {
      label: "关闭全部标签",
      action: () => closeTabs(params, "all"),
    },
  ];
}

interface Props {
  onApiReady: (api: DockviewApi) => void;
}

export default function DockviewLayout({ onApiReady }: Props) {
  const [api, setApi] = useState<DockviewApi | null>(null);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      setApi(event.api);
      onApiReady(event.api);

      // Restore saved layout or create a default panel.
      let restored = false;
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) {
        try {
          event.api.fromJSON(JSON.parse(saved));
          restored = true;
        } catch {
          localStorage.removeItem(LAYOUT_KEY);
        }
      }

      if (!restored) {
        openTerminal(event.api);
      }
    },
    [onApiReady],
  );

  // Auto-save layout.
  useEffect(() => {
    if (!api) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const disposable = api.onDidLayoutChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
        } catch {
          /* ignore */
        }
      }, 500);
    });
    return () => {
      if (timer) clearTimeout(timer);
      disposable.dispose();
    };
  }, [api]);

  return (
    <div className="xy-dockview-wrapper">
      <DockviewReact
        className="dockview-theme-xuya"
        onReady={onReady}
        components={components}
        tabComponents={tabComponents}
        watermarkComponent={Watermark}
        rightHeaderActionsComponent={RightHeaderActions}
        disableTabsOverflowList
        dndStrategy="pointer"
        getTabContextMenuItems={getTabContextMenuItems}
      />
    </div>
  );
}
