import { tool } from "ai";
import { z } from "zod";
import { checkShellCommand } from "../lib/security";
import type { ToolContext } from "./context";

export function buildTerminalTools(ctx: ToolContext) {
  return {
    suggest_command: tool({
      description:
        "提议一条 Shell 命令。在聊天中渲染带有「插入」按钮的卡片 -- 命令不会自动写入任何终端；只有用户点击后才会将其插入到提示符处而不执行。当答案本身就是一条命令时使用此工具。",
      inputSchema: z.object({
        command: z
          .string()
          .describe("Shell 命令。单行，无尾部换行。"),
        explanation: z
          .string()
          .optional()
          .describe("命令旁显示的可选单行备注。"),
      }),
      execute: async ({ command, explanation }) => {
        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };
        // Reject control bytes — the user inserts via click, but the rendered
        // command must reflect exactly what will land at the prompt.
        if (/[\n\r\x00\x1b\x07]/.test(command)) {
          return { error: "命令必须为不含控制字符的单行文本" };
        }
        return { command, explanation };
      },
    }),

    get_terminal_output: tool({
      description:
        "返回活动终端回滚缓冲区的尾部内容。当用户提到「这个错误」「上一条命令」或需要解读最近的终端输出时使用此工具。默认返回 80 行；仅在确实需要更多内容时才增加。如果没有活动终端则返回空字符串；如果终端处于隐私模式则拒绝。",
      inputSchema: z.object({
        lines: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe("返回的尾部行数。默认 80。"),
      }),
      execute: async ({ lines }) => {
        if (ctx.isActiveTerminalPrivate()) {
          return {
            error:
              "活动终端处于隐私模式；其缓冲区已隐藏。如需查看，请要求用户切换到普通选项卡。",
          };
        }
        const buffer = ctx.getTerminalContext();
        if (!buffer) return { output: "", note: "无活动终端" };
        const n = lines ?? 80;
        const parts = buffer.split("\n");
        const sliced = parts.length <= n ? buffer : parts.slice(parts.length - n).join("\n");
        const MAX = 24_000;
        const capped =
          sliced.length > MAX ? `…[truncated]…\n${sliced.slice(sliced.length - MAX)}` : sliced;
        return { output: capped, lines_returned: Math.min(parts.length, n) };
      },
    }),

    open_preview: tool({
      description:
        "在给定 URL 处打开预览选项卡（应用内 iframe）-- 仅限 localhost/回环地址的本地 dev server。在启动 dev server（例如 `pnpm dev`、`npm run dev`）后使用此工具，可在终端旁显示渲染页面。如需预览外部站点，请要求用户自行将 URL 粘贴到预览地址栏中。",
      inputSchema: z.object({
        url: z
          .url()
          .describe(
            "要加载的完整 URL（例如 http://localhost:5173）。必须包含协议。仅接受回环主机上的 http/https。",
          ),
      }),
      execute: async ({ url }) => {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return { error: "无效 URL", url };
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return { error: "仅允许 http/https URL", url };
        }
        const host = parsed.hostname;
        const isLocal =
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "0.0.0.0" ||
          host === "[::1]" ||
          host === "::1" ||
          host.endsWith(".localhost");
        if (!isLocal) {
          return {
            error:
              "open_preview 仅限 localhost URL。请要求用户将外部 URL 粘贴到预览地址栏中。",
            url,
          };
        }
        const ok = ctx.openPreview(url);
        if (!ok) return { error: "预览界面不可用", url };
        return { url, ok: true };
      },
    }),

  } as const;
}
