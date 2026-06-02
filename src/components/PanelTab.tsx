import { useState, useRef, useEffect } from "react";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import { X, Pencil, Columns2, Rows2, XCircle, Copy } from "lucide-react";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import { openTerminal } from "../lib/panels";

/**
 * Custom Dockview tab: shows the title, a close affordance, supports
 * double-click-to-rename and a right-click context menu (rename, close,
 * close others, split right/down).
 */
export default function PanelTab(props: IDockviewPanelHeaderProps) {
  const { api, containerApi } = props;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(api.title ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

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

  const closeOthers = () => {
    const groupId = api.group?.id;
    containerApi.panels
      .filter((p) => p.id !== api.id && p.api.group?.id === groupId)
      .forEach((p) => p.api.close());
  };

  const items: (MenuItem | "separator")[] = [
    {
      id: "rename",
      label: "重命名",
      icon: <Pencil size={14} strokeWidth={1.6} />,
      onClick: startRename,
    },
    "separator",
    {
      id: "split-right",
      label: "向右分屏",
      icon: <Columns2 size={14} strokeWidth={1.6} />,
      onClick: () =>
        openTerminal(containerApi, {
          referenceGroup: api.group?.id,
          direction: "right",
        }),
    },
    {
      id: "split-down",
      label: "向下分屏",
      icon: <Rows2 size={14} strokeWidth={1.6} />,
      onClick: () =>
        openTerminal(containerApi, {
          referenceGroup: api.group?.id,
          direction: "below",
        }),
    },
    {
      id: "duplicate",
      label: "在此组新建标签",
      icon: <Copy size={14} strokeWidth={1.6} />,
      onClick: () =>
        openTerminal(containerApi, {
          referenceGroup: api.group?.id,
          direction: "within",
        }),
    },
    "separator",
    {
      id: "close-others",
      label: "关闭其他标签",
      icon: <XCircle size={14} strokeWidth={1.6} />,
      onClick: closeOthers,
    },
    {
      id: "close",
      label: "关闭",
      icon: <X size={14} strokeWidth={1.6} />,
      danger: true,
      onClick: () => api.close(),
    },
  ];

  return (
    <>
      <div
        className="xy-tab"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
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
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            api.close();
          }}
        >
          <X size={13} strokeWidth={1.8} />
        </button>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={items}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
