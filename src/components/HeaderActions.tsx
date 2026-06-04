import type {
  IDockviewHeaderActionsProps,
  DockviewApi,
} from "dockview-react";
import {
  Columns2,
  Eraser,
  Settings2,
  MoreVertical,
  PanelTopOpen,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { clearTerminal } from "./TerminalView";
import { openTerminal } from "../lib/panels";
import { useModalStore } from "../stores/modalStore";
import { useSessionMenuStore } from "../stores/sessionMenuStore";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import { buildNewSessionItems } from "./newSessionMenu";

/** Clear the active panel's terminal buffer. */
function clearActive(api: DockviewApi, groupId: string) {
  const group = api.getGroup(groupId);
  const panelId = group?.activePanel?.id;
  if (panelId) clearTerminal(panelId);
}

type RightActionMode = "full" | "icon";

const RIGHT_ACTIONS_FULL_WIDTH = 430;
const RIGHT_ACTIONS_FULL_BREAKPOINT = 760;
const MAX_TEXT_BUTTON_TAB_COUNT = 3;

function useRightActionMode() {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<RightActionMode>("icon");

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    let raf = 0;

    const measure = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const header = node.closest(".dv-tabs-and-actions-container");
        const scrollable = header?.querySelector(".dv-scrollable");
        const tabs = scrollable?.querySelector(".dv-tabs-container");
        const tabCount =
          tabs instanceof HTMLElement
            ? tabs.querySelectorAll(".dv-tab").length
            : 0;
        const rightSlot =
          node.parentElement instanceof HTMLElement ? node.parentElement : node;
        const headerWidth =
          header instanceof HTMLElement
            ? header.clientWidth
            : rightSlot.clientWidth;
        const leftSlot = header?.querySelector(".dv-left-actions-container");
        const leftWidth =
          leftSlot instanceof HTMLElement
            ? leftSlot.getBoundingClientRect().width
            : 0;
        const tabsNaturalWidth =
          tabs instanceof HTMLElement ? tabs.scrollWidth : 0;
        const tabsOverflow =
          scrollable instanceof HTMLElement && tabs instanceof HTMLElement
            ? tabs.scrollWidth > scrollable.clientWidth + 2
            : false;
        const actionsClipped =
          node.scrollWidth > rightSlot.clientWidth + 1 ||
          (header instanceof HTMLElement &&
            rightSlot.getBoundingClientRect().right >
              header.getBoundingClientRect().right + 1);

        let next: RightActionMode = "full";
        if (
          headerWidth < RIGHT_ACTIONS_FULL_BREAKPOINT ||
          tabCount > MAX_TEXT_BUTTON_TAB_COUNT ||
          tabsNaturalWidth + leftWidth + RIGHT_ACTIONS_FULL_WIDTH > headerWidth ||
          tabsOverflow ||
          actionsClipped
        ) {
          next = "icon";
        }

        rightSlot.dataset.mode = next;
        if (header instanceof HTMLElement) {
          header.dataset.rightActionsMode = next;
        }

        setMode((current) => (current === next ? current : next));
      });
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.cancelAnimationFrame(raf);
        window.removeEventListener("resize", measure);
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (node.parentElement) observer.observe(node.parentElement);
    const header = node.closest(".dv-tabs-and-actions-container");
    const scrollable = header?.querySelector(".dv-scrollable");
    const tabs = scrollable?.querySelector(".dv-tabs-container");
    if (header instanceof HTMLElement) observer.observe(header);
    if (scrollable instanceof HTMLElement) observer.observe(scrollable);
    if (tabs instanceof HTMLElement) observer.observe(tabs);

    const mutationObserver = new MutationObserver(measure);
    if (header instanceof HTMLElement) {
      mutationObserver.observe(header, { childList: true, subtree: true });
    }

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      mutationObserver.disconnect();
      const rightSlot =
        node.parentElement instanceof HTMLElement ? node.parentElement : null;
      const header = node.closest(".dv-tabs-and-actions-container");
      delete rightSlot?.dataset.mode;
      if (header instanceof HTMLElement) {
        delete header.dataset.rightActionsMode;
      }
    };
  }, []);

  return { ref, mode };
}

export function RightHeaderActions(props: IDockviewHeaderActionsProps) {
  const { containerApi, group } = props;
  const openModal = useModalStore((s) => s.openModal);
  const sessionMenuItems = useSessionMenuStore((s) => s.items);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const { ref: actionsRef, mode } = useRightActionMode();
  const newSessionItems = buildNewSessionItems(containerApi, sessionMenuItems, {
    referenceGroup: group.id,
    direction: "within",
  });

  const moreItems: (MenuItem | "separator")[] = [
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
    <div
      ref={actionsRef}
      className="xy-dv-actions xy-dv-actions--right"
      data-mode={mode}
    >
      <button
        className="xy-dv-textbtn"
        type="button"
        title="新建标签"
        aria-label="新建标签"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setNewMenu({ x: r.left, y: r.bottom + 4 });
        }}
      >
        <PanelTopOpen size={13} strokeWidth={1.7} />
        <span>新建标签</span>
      </button>
      <button
        className="xy-dv-textbtn"
        type="button"
        title="向右分屏"
        aria-label="向右分屏"
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
        type="button"
        title="清屏"
        aria-label="清屏"
        onClick={() => clearActive(containerApi, group.id)}
      >
        <Eraser size={13} strokeWidth={1.7} />
        <span>清屏</span>
      </button>
      <button
        className="xy-dv-textbtn"
        type="button"
        title="终端设置"
        aria-label="终端设置"
        onClick={() => openModal("settings")}
      >
        <Settings2 size={13} strokeWidth={1.7} />
        <span>终端设置</span>
      </button>
      <button
        className="xy-dv-iconbtn"
        type="button"
        title="更多"
        aria-label="更多"
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

      {newMenu && (
        <ContextMenu
          x={newMenu.x}
          y={newMenu.y}
          items={newSessionItems}
          onClose={() => setNewMenu(null)}
        />
      )}
    </div>
  );
}
