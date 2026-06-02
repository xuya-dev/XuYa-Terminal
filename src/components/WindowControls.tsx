import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";

/**
 * Custom replacements for the OS title-bar buttons. Active because
 * `tauri.conf.json` has `decorations: false`.
 */
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const w = getCurrentWindow();
    w.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = w.onResized(() => {
      w.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const win = () => getCurrentWindow();

  return (
    <div className="xy-window-controls">
      <button
        className="xy-wc-btn"
        title="最小化"
        onClick={() => win().minimize()}
      >
        <Minus size={14} strokeWidth={1.6} />
      </button>
      <button
        className="xy-wc-btn"
        title={maximized ? "还原" : "最大化"}
        onClick={() => win().toggleMaximize()}
      >
        {maximized ? (
          <Copy size={12} strokeWidth={1.6} />
        ) : (
          <Square size={12} strokeWidth={1.6} />
        )}
      </button>
      <button
        className="xy-wc-btn xy-wc-btn--close"
        title="关闭"
        onClick={() => win().close()}
      >
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
