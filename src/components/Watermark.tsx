import type { IWatermarkPanelProps } from "dockview-react";
import { TerminalSquare } from "lucide-react";
import { openTerminal } from "../lib/panels";

/**
 * Empty-state shown by Dockview when no panels are open. Mirrors the
 * app's brand and offers a one-click way back to a terminal.
 */
export default function Watermark(props: IWatermarkPanelProps) {
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
          onClick={() => openTerminal(props.containerApi)}
        >
          <TerminalSquare size={15} strokeWidth={1.7} />
          新建终端
        </button>
        <div className="xy-watermark-hint">
          按 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> 打开命令面板
        </div>
      </div>
    </div>
  );
}
