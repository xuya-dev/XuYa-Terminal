import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkShellCommand } from "../lib/security";
import type { ToolContext } from "./context";
import { currentWorkspaceEnv, workspaceScopeKey } from "@/modules/workspace";

/**
 * Per-session lazy shell-session id. The agent gets one persistent shell per
 * chat session, so cwd survives across tool calls (cd, mkdir+cd, etc).
 */
const sessionShells = new Map<string, Promise<number>>();

async function getSessionShell(
  sessionId: string,
  cwd: string | null,
): Promise<number> {
  let p = sessionShells.get(sessionId);
  if (!p) {
    p = native.shellSessionOpen(cwd);
    sessionShells.set(sessionId, p);
  }
  return p;
}

function workspaceSessionKey(sessionId: string): string {
  return `${sessionId}:${workspaceScopeKey(currentWorkspaceEnv())}`;
}

export function buildShellTools(ctx: ToolContext) {
  return {
    bash_run: tool({
      description:
        "在当前会话的持久化智能体 Shell 中运行前台命令。cwd 在多次调用间保持不变（因此 `cd foo` 后 `bash_run pwd` 可正常工作）。用于短期命令（lint、test、search、build）。对于长时间运行或守护进程（dev server、watch 任务），请使用 `bash_background`。切勿调用交互式工具（vim、less、top）-- 它们会挂起。运行前会请求用户批准。",
      inputSchema: z.object({
        command: z.string(),
        timeout_secs: z.number().int().min(1).max(300).optional(),
      }),
      needsApproval: true,
      execute: async ({ command, timeout_secs }) => {
        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };
        const sid = ctx.getSessionId();
        if (!sid) return { error: "无活动聊天会话" };
        try {
          const cwd = ctx.getCwd();
          const shellId = await getSessionShell(workspaceSessionKey(sid), cwd);
          const r = await native.shellSessionRun(
            shellId,
            command,
            cwd,
            timeout_secs,
          );
          return {
            command,
            stdout: r.stdout,
            stderr: r.stderr,
            exit_code: r.exit_code,
            timed_out: r.timed_out,
            truncated: r.truncated,
            cwd_after: r.cwd_after,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    bash_background: tool({
      description:
        "启动长时间运行的后台进程（例如 `pnpm dev`、`cargo watch`、日志跟踪器）。返回一个句柄；使用 `bash_logs` 读取其输出，使用 `bash_kill` 停止它。输出被捕获到 4MB 环形缓冲区中。运行前会请求用户批准。",
      inputSchema: z.object({
        command: z.string(),
        cwd: z.string().nullable().optional(),
      }),
      needsApproval: true,
      execute: async ({ command, cwd }) => {
        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };
        const effectiveCwd = cwd ?? ctx.getCwd();
        try {
          const handle = await native.shellBgSpawn(command, effectiveCwd);
          return { handle, command, cwd: effectiveCwd, ok: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    bash_logs: tool({
      description:
        "读取 `bash_background` 进程的累计日志。传递上一次响应中的 `next_offset` 作为 `since_offset` 可进行增量读取。`dropped` 报告被环形缓冲区淘汰的字节数。",
      inputSchema: z.object({
        handle: z.number().int(),
        since_offset: z.number().int().optional(),
      }),
      execute: async ({ handle, since_offset }) => {
        try {
          const r = await native.shellBgLogs(handle, since_offset);
          return r;
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    bash_list: tool({
      description:
        "列出此应用中由 `bash_background` 启动的所有后台进程 -- 包括正在运行和已退出的。**在启动新的长时间运行进程之前务必先调用此工具**（尤其是 dev server，如 `pnpm dev`、`next dev`、`vite`），以避免重复启动。如果匹配的进程已在运行，请复用它（再次调用 `open_preview` 而非重新启动）。自动执行，无需批准。",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const list = await native.shellBgList();
          return { processes: list };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    bash_kill: tool({
      description:
        "按句柄终止 `bash_background` 进程。幂等操作 -- 如果句柄未知或进程已退出，则不执行任何操作。",
      inputSchema: z.object({ handle: z.number().int() }),
      execute: async ({ handle }) => {
        try {
          await native.shellBgKill(handle);
          return { handle, ok: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
