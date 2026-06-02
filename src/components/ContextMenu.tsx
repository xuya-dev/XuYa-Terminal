import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/** A non-interactive group label rendered as a small heading. */
export interface MenuHeader {
  header: string;
}

export type MenuEntry = MenuItem | "separator" | MenuHeader;

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

/**
 * Lightweight portal context menu. Positions itself at (x, y) and flips
 * back on-screen if it would overflow the viewport edges.
 */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + r.width > window.innerWidth - 8) nx = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight - 8)
      ny = window.innerHeight - r.height - 8;
    setPos({ x: Math.max(8, nx), y: Math.max(8, ny) });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Defer so the opening click doesn't immediately close it.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", close);
      window.addEventListener("resize", close);
      window.addEventListener("blur", close);
      document.addEventListener("wheel", close, { passive: true });
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      document.removeEventListener("wheel", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="xy-ctxmenu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item === "separator") {
          return <div key={`sep-${i}`} className="xy-ctxmenu-sep" />;
        }
        if ("header" in item) {
          return (
            <div key={`hdr-${i}`} className="xy-ctxmenu-header">
              {item.header}
            </div>
          );
        }
        return (
          <button
            key={item.id}
            className={`xy-ctxmenu-item ${item.danger ? "is-danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.icon && <span className="xy-ctxmenu-icon">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
