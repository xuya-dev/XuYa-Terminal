import {
  DockviewReact,
  DockviewReadyEvent,
  DockviewApi,
  IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { useEffect, useState, useCallback } from "react";
import TerminalView from "./TerminalView";
import PanelTab from "./PanelTab";
import Watermark from "./Watermark";
import { LeftHeaderActions, RightHeaderActions } from "./HeaderActions";
import { openTerminal } from "../lib/panels";

const components: Record<string, React.FC<IDockviewPanelProps>> = {
  terminal: TerminalView,
};

const tabComponents = {
  default: PanelTab,
};

const LAYOUT_KEY = "xuya-layout";

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
        leftHeaderActionsComponent={LeftHeaderActions}
        rightHeaderActionsComponent={RightHeaderActions}
      />
    </div>
  );
}
