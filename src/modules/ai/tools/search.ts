import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkReadableCanonical } from "../lib/security";
import { resolvePath, type ToolContext } from "./context";

function resolveRoot(
  rawRoot: string | undefined,
  ctx: ToolContext,
): { ok: true; path: string } | { ok: false; error: string } {
  if (rawRoot && rawRoot.trim().length > 0) {
    try {
      return { ok: true, path: resolvePath(rawRoot, ctx.getCwd()) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
  const ws = ctx.getWorkspaceRoot();
  if (ws) return { ok: true, path: ws };
  const cwd = ctx.getCwd();
  if (cwd) return { ok: true, path: cwd };
  return {
    ok: false,
    error: "无工作区根目录或活动工作目录；请显式传递 `root`。",
  };
}

const MAX_LINE_LEN = 160;

function clipLine(s: string): string {
  if (s.length <= MAX_LINE_LEN) return s;
  return `${s.slice(0, MAX_LINE_LEN)}…[+${s.length - MAX_LINE_LEN}]`;
}

export function buildSearchTools(ctx: ToolContext) {
  return {
    grep: tool({
      description:
        "使用正则表达式搜索工作区中的文件内容。遵循 .gitignore 规则。返回最多 `max_results`（默认 30，最大 500）条 `{path, line, text}` 匹配结果，当存在更多结果时带有 `truncated` 标志。较长的匹配行会被截断为 160 个字符。用于代码导航 -- 请勿对目录树进行暴力 read_file。尽可能使用 `glob` 缩小范围；仅在第一批结果确实不足时才增加 `max_results`。",
      inputSchema: z.object({
        pattern: z
          .string()
          .describe(
            "正则表达式模式（Rust ripgrep 方言）。根据需要锚定和转义字面字符。",
          ),
        root: z
          .string()
          .optional()
          .describe(
            "搜索根目录。默认为工作区根目录，然后是活动工作目录。",
          ),
        glob: z
          .array(z.string())
          .optional()
          .describe(
            "可选的路径包含 glob，例如 ['**/*.ts', 'src/**/*.tsx']。",
          ),
        case_insensitive: z.boolean().optional(),
        max_results: z.number().int().min(1).max(500).optional(),
      }),
      execute: async ({
        pattern,
        root,
        glob,
        case_insensitive,
        max_results,
      }) => {
        const r = resolveRoot(root, ctx);
        if (!r.ok) return { error: r.error };
        const safety = await checkReadableCanonical(r.path, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, root: r.path };
        r.path = safety.canonical;
        const cap = Math.min(max_results ?? 30, 500);
        try {
          const res = await native.grep({
            pattern,
            root: r.path,
            glob,
            caseInsensitive: case_insensitive,
            maxResults: cap,
          });
          return {
            root: r.path,
            hits: res.hits.map((h) => ({
              path: h.path,
              rel: h.rel,
              line: h.line,
              text: clipLine(h.text),
            })),
            truncated: res.truncated,
            files_scanned: res.files_scanned,
          };
        } catch (e) {
          return { error: String(e), root: r.path };
        }
      },
    }),

    glob: tool({
      description:
        "按路径模式查找文件（支持 gitignore）。需要递归获取所有匹配时使用此工具代替 `list_directory`。模式使用 globset 语法: `**/*.ts`、`src/**/test_*.py`。返回最多 `max_results` 个匹配。",
      inputSchema: z.object({
        pattern: z.string().describe("相对路径的 glob 模式。"),
        root: z.string().optional(),
        max_results: z.number().int().min(1).max(2000).optional(),
      }),
      execute: async ({ pattern, root, max_results }) => {
        const r = resolveRoot(root, ctx);
        if (!r.ok) return { error: r.error };
        const safety = await checkReadableCanonical(r.path, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, root: r.path };
        r.path = safety.canonical;
        try {
          const res = await native.glob({
            pattern,
            root: r.path,
            maxResults: max_results,
          });
          return {
            root: r.path,
            hits: res.hits,
            truncated: res.truncated,
          };
        } catch (e) {
          return { error: String(e), root: r.path };
        }
      },
    }),
  } as const;
}
