import { tool } from "ai";
import { z } from "zod";
import { useManagedAgentsStore } from "@/modules/agents/store/managedAgentsStore";
import { writeToSession } from "@/modules/terminal";
import type { ToolContext } from "./context";

// Claude Code's TUI treats a trailing CR in the same write chunk as the text
// as a literal newline, not a submit. Send the Enter as a separate chunk once
// the input has rendered so it registers as a standalone keypress.
const SUBMIT_DELAY_MS = 90;

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function tailLines(text: string, n: number): string {
  const parts = text.split("\n");
  return parts.length <= n ? text : parts.slice(parts.length - n).join("\n");
}

export function buildManagedAgentTools(ctx: ToolContext) {
  return {
    spawn_coding_agent: tool({
      description:
        "在新终端选项卡中启动 Claude Code 智能体并发送提示。当用户（通过 /claude-code）需要委派工作且当前会话中尚无活动智能体时使用此工具。请先编写完整独立的提示；用户批准后智能体才会启动。如果已有活动智能体，请勿调用此工具 -- 请改用 send_to_agent。",
      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .describe(
            "Claude Code 智能体的完整独立任务提示。",
          ),
      }),
      needsApproval: true,
      execute: async ({ prompt }) => {
        const sessionId = ctx.getSessionId();
        if (!sessionId) return { error: "无活动聊天会话" };
        const store = useManagedAgentsStore.getState();
        if (store.getBySessionId(sessionId)) {
          return {
            error:
              "当前会话中已有活动的 Claude Code 智能体；请使用 send_to_agent 给它更多任务",
          };
        }
        const spawned = ctx.spawnAgent(prompt);
        if (!spawned) return { error: "无法启动智能体" };
        return {
          ok: true,
          tab_id: spawned.tabId,
          message: "Claude Code 智能体已启动。它将很快开始工作。",
        };
      },
    }),

    send_to_agent: tool({
      description:
        "向当前会话中活动的 Claude Code 智能体发送后续指令。在查看其输出后使用，用于请求修复或分配下一项工作。指令将被输入到智能体的提示中，并在用户批准后提交。请先阅读其最新输出，以便后续指令更有针对性。",
      inputSchema: z.object({
        instruction: z
          .string()
          .min(1)
          .describe(
            "给智能体的一条清晰独立的指令。不含控制字符。",
          ),
      }),
      needsApproval: true,
      execute: async ({ instruction }) => {
        const sessionId = ctx.getSessionId();
        const store = useManagedAgentsStore.getState();
        const managed = sessionId ? store.getBySessionId(sessionId) : undefined;
        if (!managed) {
          return {
            error:
              "当前会话中没有活动的 Claude Code 智能体；请使用 spawn_coding_agent 启动一个",
          };
        }
        const oneLine = instruction.replace(/\s*\r?\n\s*/g, " ").trim();
        if (!oneLine) return { error: "指令为空" };
        if (hasControlChars(oneLine)) {
          return { error: "指令包含控制字符" };
        }
        if (!writeToSession(managed.leafId, oneLine)) {
          store.remove(managed.leafId);
          return { error: "智能体终端已不可用（已关闭？）" };
        }
        setTimeout(() => writeToSession(managed.leafId, "\r"), SUBMIT_DELAY_MS);
        store.bumpRound(managed.leafId);
        return { ok: true, sent: oneLine, round: store.get(managed.leafId)?.rounds };
      },
    }),

    read_agent_output: tool({
      description:
        "检查当前会话中的 Claude Code 智能体: 是否有活动智能体、其状态以及终端输出的尾部内容。处理 /claude-code 请求时请首先调用此工具，以便判断是启动新智能体还是跟进现有智能体，并了解其已完成的工作和报告。",
      inputSchema: z.object({
        lines: z
          .number()
          .int()
          .min(1)
          .max(400)
          .optional()
          .describe("返回智能体终端的尾部行数。默认 120。"),
      }),
      execute: async ({ lines }) => {
        const sessionId = ctx.getSessionId();
        const managed = sessionId
          ? useManagedAgentsStore.getState().getBySessionId(sessionId)
          : undefined;
        if (!managed) return { active: false };
        const raw = ctx.readAgentOutput(managed.leafId);
        return {
          active: true,
          phase: managed.phase,
          rounds: managed.rounds,
          max_rounds: managed.maxRounds,
          output: raw ? tailLines(raw, lines ?? 120) : "",
        };
      },
    }),
  } as const;
}
