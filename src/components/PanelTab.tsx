import { useState, useRef, useEffect } from "react";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import { X } from "lucide-react";

/**
 * Custom Dockview tab: shows the title, a close affordance, supports
 * double-click-to-rename and a right-click context menu.
 */
export default function PanelTab(props: IDockviewPanelHeaderProps) {
  const { api } = props;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(api.title ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerClosedRef = useRef(false);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const commitRename = () => {
    const next = draft.trim();
    if (next) api.setTitle(next);
    else setDraft(api.title ?? "");
    setRenaming(false);
  };

  const startRename = () => {
    setDraft(api.title ?? "");
    setRenaming(true);
  };

  return (
    <div
      className="xy-tab"
      onDoubleClick={(e) => {
        e.preventDefault();
        startRename();
      }}
    >
      {renaming ? (
        <input
          ref={inputRef}
          className="xy-tab-rename"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            else if (e.key === "Escape") {
              setDraft(api.title ?? "");
              setRenaming(false);
            }
            e.stopPropagation();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="xy-tab-title">{api.title}</span>
      )}
      <button
        className="xy-tab-close"
        title="关闭"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          pointerClosedRef.current = true;
          api.close();
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (pointerClosedRef.current) {
            pointerClosedRef.current = false;
            return;
          }
          api.close();
        }}
      >
        <X size={13} strokeWidth={1.8} />
      </button>
    </div>
  );
}
