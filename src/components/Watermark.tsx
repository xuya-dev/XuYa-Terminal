import type { IWatermarkPanelProps } from "dockview-react";
import { useState } from "react";
import { ChevronDown, TerminalSquare } from "lucide-react";
import ContextMenu from "./ContextMenu";
import { buildNewSessionItems } from "./newSessionMenu";

/**
 * Empty-state shown by Dockview when no panels are open. Mirrors the
 * app's brand and offers a one-click way back to a terminal.
 */
export default function Watermark(props: IWatermarkPanelProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const newSessionItems = buildNewSessionItems(props.containerApi);

  return (
    <div className="xy-watermark">
      <div className="xy-watermark-inner">
        <div className="xy-watermark-glyph">
          <img src="/logo.png" alt="XuYa Terminal" width="56" height="56" />
        </div>
        <div className="xy-watermark-title">没有打开的终端</div>
        <div className="xy-watermark-sub">
          从顶栏选择一个 Shell,或点击下方按钮开始
        </div>
        <button
          className="xy-watermark-btn"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 6 });
          }}
        >
          <TerminalSquare size={15} strokeWidth={1.7} />
          新建终端
          <ChevronDown size={13} strokeWidth={1.7} />
        </button>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={newSessionItems}
            onClose={() => setMenu(null)}
          />
        )}
        <div className="xy-watermark-hint">
          按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> 打开命令面板
        </div>
      </div>
    </div>
  );
}
