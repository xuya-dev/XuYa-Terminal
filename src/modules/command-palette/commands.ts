import type { SearchTarget } from "@/modules/header";
import { MAX_PANES_PER_TAB, type Tab } from "@/modules/tabs";
import { leafIds } from "@/modules/terminal";
import {
  Cancel01Icon,
  DashboardSquare01Icon,
  FileEditIcon,
  FileSearchIcon,
  Globe02Icon,
  IncognitoIcon,
  KeyboardIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  PaintBoardIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeftIcon,
  SourceCodeIcon,
  SparklesIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import type { PaletteItem } from "./types";

export const COMMAND_GROUPS = [
  "通用",
  "工作区",
  "选项卡",
  "窗格",
  "Git",
  "搜索",
  "视图",
  "AI",
] as const;

export type CommandPaletteActionContext = {
  tabs: Tab[];
  activeId: number;
  searchTarget: SearchTarget;
  explorerRoot: string | null;
  home: string | null;
  openNewTab: () => void;
  openNewBlock: () => void;
  openNewPrivate: () => void;
  openNewEditor: () => void;
  openNewPreview: () => void;
  openGitGraph: () => void;
  toggleSourceControl: () => void;
  closeActiveTabOrPane: () => void;
  splitPaneRight: () => void;
  splitPaneDown: () => void;
  focusSearch: () => void;
  focusExplorerSearch: () => void;
  toggleSidebar: () => void;
  toggleAi: () => void;
  askAiSelection: () => void;
  openSettings: () => void;
  openKeyboardShortcuts: () => void;
  spaces: { id: string; name: string }[];
  activeSpaceId: string | null;
  openSpacesOverview: () => void;
  newSpace: () => void;
  switchSpace: (id: string) => void;
  /** Launch a shell or agent session with the given command */
  launchSession?: (command: string, label: string) => void;
};

const noop = () => {};

export function createCommandItems(
  ctx: CommandPaletteActionContext,
): PaletteItem[] {
  const activeTab = ctx.tabs.find((tab) => tab.id === ctx.activeId);
  const activeTerminalTab = activeTab?.kind === "terminal" ? activeTab : null;
  const activePaneCount = activeTerminalTab
    ? leafIds(activeTerminalTab.paneTree).length
    : 0;
  const onlyOneTab = ctx.tabs.length < 2;
  const noWorkspaceRoot = !ctx.explorerRoot && !ctx.home;
  const splitDisabled = !activeTerminalTab
    ? "无终端选项卡"
    : activePaneCount >= MAX_PANES_PER_TAB
      ? "窗格已达上限"
      : undefined;
  const closeDisabled =
    onlyOneTab && activePaneCount < 2 ? "最后一个选项卡" : undefined;

  return [
    {
      id: "settings.open",
      title: "打开设置",
      group: "通用",
      keywords: ["preferences", "config"],
      icon: Settings01Icon,
      shortcutId: "settings.open",
      run: ctx.openSettings,
    },
    {
      id: "theme.pick",
      title: "切换主题...",
      group: "通用",
      keywords: ["theme", "appearance", "color", "dark", "light"],
      icon: PaintBoardIcon,
      run: noop,
    },
    {
      id: "shortcuts.open",
      title: "键盘快捷键",
      group: "通用",
      keywords: ["keys", "keybindings", "settings"],
      icon: KeyboardIcon,
      run: ctx.openKeyboardShortcuts,
    },
    {
      id: "spaces.overview",
      title: "工作区: 概览",
      group: "工作区",
      keywords: ["spaces", "sessions", "overview", "organize", "manage", "move"],
      icon: DashboardSquare01Icon,
      run: ctx.openSpacesOverview,
    },
    {
      id: "spaces.new",
      title: "选择目录创建工作区",
      group: "工作区",
      keywords: ["space", "session", "workspace", "group", "create", "folder", "directory"],
      icon: DashboardSquare01Icon,
      run: ctx.newSpace,
    },
    ...ctx.spaces.map((sp) => ({
      id: `spaces.switch.${sp.id}`,
      title: `切换到 ${sp.name}`,
      group: "工作区" as const,
      keywords: ["space", "switch", "session", sp.name],
      icon: DashboardSquare01Icon,
      disabledReason:
        sp.id === ctx.activeSpaceId ? "当前工作区" : undefined,
      run: () => ctx.switchSpace(sp.id),
    })),
    {
      id: "tab.new",
      title: "新建终端",
      group: "选项卡",
      keywords: ["shell", "terminal", "new tab"],
      icon: TerminalIcon,
      shortcutId: "tab.new",
      run: ctx.openNewTab,
    },
    {
      id: "tab.newBlock",
      title: "新建块终端",
      group: "选项卡",
      keywords: ["blocks", "warp", "command blocks", "terminal"],
      icon: DashboardSquare01Icon,
      run: ctx.openNewBlock,
    },
    {
      id: "tab.newPrivate",
      title: "新建隐私终端",
      group: "选项卡",
      keywords: ["privacy", "private", "incognito", "hidden from ai"],
      icon: IncognitoIcon,
      shortcutId: "tab.newPrivate",
      run: ctx.openNewPrivate,
    },
    {
      id: "tab.newEditor",
      title: "新建编辑器选项卡",
      group: "选项卡",
      keywords: ["file", "editor", "create"],
      icon: FileEditIcon,
      shortcutId: "tab.newEditor",
      disabledReason: noWorkspaceRoot ? "无工作区根目录" : undefined,
      run: ctx.openNewEditor,
    },
    {
      id: "tab.newPreview",
      title: "新建网页预览",
      group: "选项卡",
      keywords: ["browser", "web", "localhost", "preview"],
      icon: Globe02Icon,
      shortcutId: "tab.newPreview",
      run: ctx.openNewPreview,
    },
    {
      id: "tab.close",
      title: "关闭选项卡或窗格",
      group: "选项卡",
      keywords: ["close", "remove", "pane"],
      icon: Cancel01Icon,
      shortcutId: "tab.close",
      disabledReason: closeDisabled,
      run: ctx.closeActiveTabOrPane,
    },
    {
      id: "pane.splitRight",
      title: "向右拆分窗格",
      group: "窗格",
      keywords: ["terminal", "pane", "split", "right", "column"],
      icon: LayoutTwoColumnIcon,
      shortcutId: "pane.splitRight",
      disabledReason: splitDisabled,
      run: ctx.splitPaneRight,
    },
    {
      id: "pane.splitDown",
      title: "向下拆分窗格",
      group: "窗格",
      keywords: ["terminal", "pane", "split", "down", "row"],
      icon: LayoutTwoRowIcon,
      shortcutId: "pane.splitDown",
      disabledReason: splitDisabled,
      run: ctx.splitPaneDown,
    },
    {
      id: "git.graph",
      title: "打开 Git 图",
      group: "Git",
      keywords: ["git", "graph", "history", "log", "commits"],
      icon: SourceCodeIcon,
      run: ctx.openGitGraph,
    },
    {
      id: "git.source",
      title: "切换版本控制",
      group: "Git",
      keywords: ["git", "source control", "changes", "staging", "diff"],
      icon: SourceCodeIcon,
      shortcutId: "pane.source",
      run: ctx.toggleSourceControl,
    },
    {
      id: "search.content",
      title: "在文件中查找内容",
      group: "搜索",
      keywords: ["grep", "ripgrep", "text", "contents", "search in files"],
      icon: FileSearchIcon,
      trailing: "#",
      run: noop,
    },
    {
      id: "history.open",
      title: "搜索命令历史",
      group: "搜索",
      keywords: ["history", "shell", "rerun", "previous commands"],
      icon: TerminalIcon,
      trailing: ">",
      run: noop,
    },
    {
      id: "search.focus",
      title: "在当前选项卡中查找",
      group: "搜索",
      keywords: ["find", "terminal", "editor", "current"],
      icon: Search01Icon,
      shortcutId: "search.focus",
      disabledReason: ctx.searchTarget ? undefined : "无可搜索视图",
      run: ctx.focusSearch,
    },
    {
      id: "explorer.search",
      title: "按名称搜索文件",
      group: "搜索",
      keywords: ["explorer", "workspace", "file", "open"],
      icon: Search01Icon,
      shortcutId: "explorer.search",
      disabledReason: ctx.explorerRoot ? undefined : "无工作区根目录",
      run: ctx.focusExplorerSearch,
    },
    {
      id: "sidebar.toggle",
      title: "切换文件浏览器",
      group: "视图",
      keywords: ["sidebar", "files", "explorer"],
      icon: SidebarLeftIcon,
      shortcutId: "sidebar.toggle",
      run: ctx.toggleSidebar,
    },
    {
      id: "ai.toggle",
      title: "切换 AI 智能体",
      group: "AI",
      keywords: ["assistant", "chat", "agent"],
      icon: SparklesIcon,
      shortcutId: "ai.toggle",
      run: ctx.toggleAi,
    },
    {
      id: "ai.askSelection",
      title: "向 AI 询问选区内容",
      group: "AI",
      keywords: ["selection", "explain", "assistant", "chat"],
      icon: SparklesIcon,
      shortcutId: "ai.askSelection",
      run: ctx.askAiSelection,
    },
    // ── AI Agent 快捷启动 ────────────────────────────────────────────────
    {
      id: "agent.claude",
      title: "启动 Claude Code",
      group: "AI",
      keywords: ["claude", "anthropic", "agent", "code", "编程"],
      icon: SparklesIcon, // 使用 SparklesIcon 作为占位符，实际渲染时使用 Claude 组件
      run: () => ctx.launchSession?.("claude", "Claude Code"),
    },
    {
      id: "agent.codex",
      title: "启动 Codex",
      group: "AI",
      keywords: ["codex", "openai", "agent", "code", "编程"],
      icon: SparklesIcon, // 使用 SparklesIcon 作为占位符，实际渲染时使用 OpenAI 组件
      run: () => ctx.launchSession?.("codex", "Codex"),
    },
    {
      id: "agent.opencode",
      title: "启动 Open Code",
      group: "AI",
      keywords: ["opencode", "agent", "code", "编程", "开源"],
      icon: SparklesIcon, // 使用 SparklesIcon 作为占位符，实际渲染时使用 OpenAI 组件
      run: () => ctx.launchSession?.("opencode", "Open Code"),
    },
  ];
}
