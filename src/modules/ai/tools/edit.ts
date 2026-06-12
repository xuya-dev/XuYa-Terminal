import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkWritableCanonical } from "../lib/security";
import { newQueuedEditId, usePlanStore } from "../store/planStore";
import { resolvePath, type ToolContext } from "./context";

type EditResult =
  | { ok: true; replacements: number; bytesWritten: number; path: string }
  | { error: string; path: string };

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

async function applyEdits(
  abs: string,
  edits: { old_string: string; new_string: string; replace_all?: boolean }[],
  kind: "edit" | "multi_edit",
  readCache: Map<string, { size: number; hash: number }>,
): Promise<EditResult> {
  const r = await native.readFile(abs);
  if (r.kind === "binary")
    return { error: "拒绝: 二进制文件", path: abs };
  if (r.kind === "toolarge")
    return { error: `文件过大（${r.size} 字节）`, path: abs };

  const original = r.content;
  let content = original;
  let totalReplacements = 0;

  for (const e of edits) {
    if (e.old_string === e.new_string) {
      return {
        error: "old_string 和 new_string 相同",
        path: abs,
      };
    }
    if (e.old_string.length === 0) {
      return { error: "old_string 不能为空", path: abs };
    }
    if (e.replace_all) {
      const before = content;
      content = content.split(e.old_string).join(e.new_string);
      const occurrences =
        (before.length - content.length) /
          (e.old_string.length - e.new_string.length || 1) || 0;
      // Recover count via direct search to avoid divide-by-zero edge cases.
      let n = 0;
      let i = 0;
      while ((i = before.indexOf(e.old_string, i)) !== -1) {
        n++;
        i += e.old_string.length;
      }
      if (n === 0) {
        return {
          error: `未找到 old_string: ${JSON.stringify(e.old_string.slice(0, 80))}`,
          path: abs,
        };
      }
      totalReplacements += n;
      void occurrences;
    } else {
      const first = content.indexOf(e.old_string);
      if (first === -1) {
        return {
          error: `未找到 old_string: ${JSON.stringify(e.old_string.slice(0, 80))}`,
          path: abs,
        };
      }
      const second = content.indexOf(e.old_string, first + 1);
      if (second !== -1) {
        return {
          error:
            "old_string 不唯一。请提供更多上下文，或设置 replace_all=true。",
          path: abs,
        };
      }
      content =
        content.slice(0, first) +
        e.new_string +
        content.slice(first + e.old_string.length);
      totalReplacements += 1;
    }
  }

  if (usePlanStore.getState().active) {
    usePlanStore.getState().enqueue({
      id: newQueuedEditId(),
      kind,
      path: abs,
      originalContent: original,
      proposedContent: content,
      isNewFile: false,
    });
    return {
      ok: true,
      replacements: totalReplacements,
      bytesWritten: content.length,
      path: abs,
    };
  }

  try {
    await native.writeFile(abs, content);
    readCache.set(abs, { size: content.length, hash: djb2(content) });
    return {
      ok: true,
      replacements: totalReplacements,
      bytesWritten: content.length,
      path: abs,
    };
  } catch (err) {
    return { error: String(err), path: abs };
  }
}

export function buildEditTools(ctx: ToolContext) {
  return {
    edit: tool({
      description:
        "替换文件中的精确字符串。需要先在当前会话中对此路径调用 read_file -- 以防止盲目编辑。除非设置 `replace_all: true`，否则 `old_string` 在文件中必须唯一。写入前会请求用户批准。",
      inputSchema: z.object({
        path: z.string(),
        old_string: z
          .string()
          .describe("要替换的精确子串。除非设置 replace_all，否则必须唯一。"),
        new_string: z.string().describe("替换后的子串。"),
        replace_all: z.boolean().optional(),
      }),
      needsApproval: true,
      execute: async ({ path, old_string, new_string, replace_all }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        if (!ctx.readCache.has(abs)) {
          return {
            error:
              "必须先对此路径调用 read_file（读取后编辑不变量）。",
            path: abs,
          };
        }
        return applyEdits(
          abs,
          [{ old_string, new_string, replace_all }],
          "edit",
          ctx.readCache,
        );
      },
    }),

    multi_edit: tool({
      description:
        "对单个文件原子性地应用多个精确字符串替换。每个编辑按顺序应用到当前缓冲区；如果任何编辑的 old_string 缺失或不唯一，整个批次将在写入前中止。需要先对此路径调用 read_file。写入前会请求用户批准。",
      inputSchema: z.object({
        path: z.string(),
        edits: z
          .array(
            z.object({
              old_string: z.string(),
              new_string: z.string(),
              replace_all: z.boolean().optional(),
            }),
          )
          .min(1),
      }),
      needsApproval: true,
      execute: async ({ path, edits }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        if (!ctx.readCache.has(abs)) {
          return {
            error:
              "必须先对此路径调用 read_file（读取后编辑不变量）。",
            path: abs,
          };
        }
        return applyEdits(abs, edits, "multi_edit", ctx.readCache);
      },
    }),
  } as const;
}
