import type {
  IDockviewHeaderActionsProps,
  DockviewApi,
} from "dockview-react";
import {
  Plus,
  Columns2,
  Eraser,
  Settings2,
  MoreVertical,
  PanelTopOpen,
  ListX,
} from "lucide-react";
import { useState } from "react";
import { clearTerminal } from "./TerminalView";
import { openTerminal } from "../lib/panels";
import { useModalStore } from "../stores/modalStore";
import ContextMenu, { type MenuItem } from "./ContextMenu";

/** Clear the active panel's terminal buffer. */
function clearActive(api: DockviewApi, groupId: string) {
  const group = api.getGroup(groupId);
  const panelId = group?.activePanel?.id;
  if (panelId) clearTerminal(panelId);
}

/**
 * Close every panel in this group except the active one. Typed against
 * the props' `panels` array shape (IDockviewPanel isn't re-exported from
 * the barrel, so we keep it structural).
 */
function closeOthers(
  panels: IDockviewHeaderActionsProps["panels"],
  keepId: string | undefined,
) {
  panels.forEach((p) => {
    if (p.id !== keepId) p.api.close();
  });
}

export function LeftHeaderActions(props: IDockviewHeaderActionsProps) {
  return (
    <div className="xy-dv-actions xy-dv-actions--left">
      <button
        className="xy-dv-iconbtn"
        title="新建标签"
        onClick={() =>
          openTerminal(props.containerApi, {
            referenceGroup: props.group.id,
            direction: "within",
          })
        }
      >
        <Plus size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export function RightHeaderActions(props: IDockviewHeaderActionsProps) {
  const { containerApi, group, panels, activePanel } = props;
  const openModal = useModalStore((s) => s.openModal);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const hasOthers = panels.length > 1;

  const moreItems: (MenuItem | "separator")[] = [
    {
      id: "new",
      label: "新建标签",
      onClick: () =>
        openTerminal(containerApi, {
          referenceGroup: group.id,
          direction: "within",
        }),
    },
    {
      id: "split-right",
      label: "向右分屏",
      onClick: () =>
        openTerminal(containerApi, {
          referenceGroup: group.id,
          direction: "right",
        }),
    },
    {
      id: "split-down",
      label: "向下分屏",
      onClick: () =>
        openTerminal(containerApi, {
          referenceGroup: group.id,
          direction: "below",
        }),
    },
    "separator",
    {
      id: "close-others",
      label: "关闭其他标签",
      disabled: !hasOthers,
      onClick: () => closeOthers(panels, activePanel?.id),
    },
    {
      id: "clear",
      label: "清屏",
      onClick: () => clearActive(containerApi, group.id),
    },
    {
      id: "settings",
      label: "终端设置",
      onClick: () => openModal("settings"),
    },
  ];

  return (
    <div className="xy-dv-actions xy-dv-actions--right">
      <button
        className="xy-dv-textbtn"
        onClick={() =>
          openTerminal(containerApi, {
            referenceGroup: group.id,
            direction: "within",
          })
        }
      >
        <PanelTopOpen size={13} strokeWidth={1.7} />
        <span>新建标签</span>
      </button>
      <button
        className="xy-dv-textbtn"
        onClick={() =>
          openTerminal(containerApi, {
            referenceGroup: group.id,
            direction: "right",
          })
        }
      >
        <Columns2 size={13} strokeWidth={1.7} />
        <span>分屏</span>
      </button>
      <button
        className="xy-dv-textbtn"
        disabled={!hasOthers}
        title={hasOthers ? "关闭其他标签" : "没有其他标签"}
        onClick={() => closeOthers(panels, activePanel?.id)}
      >
        <ListX size={13} strokeWidth={1.7} />
        <span>关闭其他</span>
      </button>
      <button
        className="xy-dv-textbtn"
        onClick={() => clearActive(containerApi, group.id)}
      >
        <Eraser size={13} strokeWidth={1.7} />
        <span>清屏</span>
      </button>
      <button className="xy-dv-textbtn" onClick={() => openModal("settings")}>
        <Settings2 size={13} strokeWidth={1.7} />
        <span>终端设置</span>
      </button>
      <button
        className="xy-dv-iconbtn"
        title="更多"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: r.right - 180, y: r.bottom + 4 });
        }}
      >
        <MoreVertical size={14} strokeWidth={1.8} />
      </button>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={moreItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
