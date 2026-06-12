import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import type { PresenceState } from "@/lib/usePresence";
import { useEffect, useRef } from "react";

export type SelectionAskAiProps = {
  state: PresenceState;
  x: number;
  y: number;
  onAsk: () => void;
  onDismiss: () => void;
};

const W = 152;
const OFFSET = 36;

export function SelectionAskAi({
  state,
  x,
  y,
  onAsk,
  onDismiss,
}: SelectionAskAiProps) {
  const pos = useRef({ top: 0, left: 0 });
  const open = state === "open";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (open) {
    pos.current = {
      top: Math.max(8, y - OFFSET),
      left: Math.max(8, Math.min(x - W / 2, window.innerWidth - W - 8)),
    };
  }

  return (
    <div
      data-selection-ask-ai
      data-state={state}
      style={{ top: pos.current.top, left: pos.current.left, width: W }}
      className="fixed z-50 duration-150 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-1 data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-1"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAsk();
        }}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-popover px-2.5 text-xs font-medium text-popover-foreground shadow-lg shadow-foreground/10 ring-1 ring-foreground/5 backdrop-blur-md hover:bg-accent hover:text-accent-foreground"
      >
        <span className="min-w-0 shrink truncate whitespace-nowrap">向助手提问</span>
        <KbdGroup className="shrink-0">
          <Kbd className="h-4 min-w-4 rounded px-1 text-[10px] text-muted-foreground">
            {fmtShortcut(MOD_KEY, "L")}
          </Kbd>
        </KbdGroup>
      </button>
    </div>
  );
}
