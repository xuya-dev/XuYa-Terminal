import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import {
  checkReadableCanonical,
  checkWritableCanonical,
} from "../lib/security";
import { newQueuedEditId, usePlanStore } from "../store/planStore";
import { resolvePath, type ToolContext } from "./context";

const READ_BYTE_CAP = 25 * 1024;
const READ_LINE_CAP = 2000;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

export function buildFsTools(ctx: ToolContext) {
  return {
    read_file: tool({
      description:
        "读取 UTF-8 文本文件。默认读取前 2000 行（上限 25KB）。传递 `offset`/`limit` 可对大文件进行基于行的窗口读取。拒绝二进制、超大或敏感文件（.env、密钥、凭证）。如果在同一会话中对同一路径连续调用两次且中间没有编辑，第二次调用将返回 `unchanged: true` 而非重新输出内容 -- 请重新阅读之前的结果。",
      inputSchema: z.object({
        path: z
          .string()
          .describe("绝对路径，或相对于活动终端工作目录。"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("从 0 开始的起始行。默认 0。"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .optional()
          .describe("最大返回行数。默认 2000。"),
      }),
      execute: async ({ path, offset, limit }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkReadableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const r = await native.readFile(abs);
          if (r.kind === "binary")
            return { error: "拒绝: 二进制文件", path: abs, size: r.size };
          if (r.kind === "toolarge")
            return {
              error: `文件过大（${r.size} 字节，限制 ${r.limit}）`,
              path: abs,
            };

          const hash = djb2(r.content);
          const isFullRead = offset === undefined && limit === undefined;
          const prior = ctx.readCache.get(abs);
          if (isFullRead && prior && prior.size === r.size && prior.hash === hash) {
            return { path: abs, unchanged: true, size: r.size };
          }
          ctx.readCache.set(abs, { size: r.size, hash });

          if (isFullRead) {
            const lines = r.content.split("\n");
            const sliceEnd = Math.min(lines.length, READ_LINE_CAP);
            let content = lines.slice(0, sliceEnd).join("\n");
            let truncated = sliceEnd < lines.length;
            if (content.length > READ_BYTE_CAP) {
              content = content.slice(0, READ_BYTE_CAP);
              truncated = true;
            }
            return {
              path: abs,
              content,
              size: r.size,
              total_lines: lines.length,
              ...(truncated
                ? { truncated: true, hint: "请使用 offset 调用 read_file 以继续读取" }
                : {}),
            };
          }

          const lines = r.content.split("\n");
          const start = offset ?? 0;
          const requested = limit ?? READ_LINE_CAP;
          const end = Math.min(lines.length, start + requested);
          let content = lines.slice(start, end).join("\n");
          let truncated = end < lines.length;
          if (content.length > READ_BYTE_CAP) {
            content = content.slice(0, READ_BYTE_CAP);
            truncated = true;
          }
          return {
            path: abs,
            content,
            size: r.size,
            total_lines: lines.length,
            start_line: start,
            end_line: end,
            ...(truncated ? { truncated: true } : {}),
          };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    list_directory: tool({
      description:
        "列出目录中的直接条目（文件 + 目录）。隐藏条目不包含在内。",
      inputSchema: z.object({
        path: z
          .string()
          .describe("绝对路径，或相对于活动终端工作目录。"),
      }),
      execute: async ({ path }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkReadableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        try {
          const entries = await native.readDir(abs);
          return {
            path: abs,
            entries: entries.map((e) => ({ name: e.name, kind: e.kind })),
          };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    write_file: tool({
      description:
        "创建或覆盖指定内容的文件。运行前始终询问用户。建议使用 `edit` / `multi_edit` 进行就地修改 -- 仅在创建全新文件或完全替换小文件时使用 `write_file`。",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      needsApproval: true,
      execute: async ({ path, content }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;

        if (usePlanStore.getState().active) {
          let original = "";
          let isNewFile = false;
          try {
            const r = await native.readFile(abs);
            if (r.kind === "text") original = r.content;
          } catch {
            isNewFile = true;
          }
          usePlanStore.getState().enqueue({
            id: newQueuedEditId(),
            kind: "write_file",
            path: abs,
            originalContent: original,
            proposedContent: content,
            isNewFile,
          });
          return {
            path: abs,
            queued_for_plan_review: true,
            ok: true,
          };
        }

        try {
          await native.writeFile(abs, content);
          ctx.readCache.set(abs, { size: content.length, hash: djb2(content) });
          return { path: abs, bytesWritten: content.length, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    create_directory: tool({
      description:
        "创建目录（包括缺失的父目录）。运行前始终询问用户。",
      inputSchema: z.object({
        path: z.string(),
      }),
      needsApproval: true,
      execute: async ({ path }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(reqPath, native.canonicalize);
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        if (usePlanStore.getState().active) {
          usePlanStore.getState().enqueue({
            id: newQueuedEditId(),
            kind: "create_directory",
            path: abs,
            originalContent: "",
            proposedContent: "",
            isNewFile: true,
            description: "创建目录",
          });
          return { path: abs, queued_for_plan_review: true, ok: true };
        }
        try {
          await native.createDir(abs);
          return { path: abs, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),
  } as const;
}
