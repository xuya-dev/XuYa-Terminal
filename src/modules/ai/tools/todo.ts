import { tool } from "ai";
import { z } from "zod";
import { newTodoId, validateTodos, type Todo } from "../lib/todos";
import { useTodosStore } from "../store/todoStore";
import type { ToolContext } from "./context";

const TodoStatus = z.enum(["pending", "in_progress", "completed"]);

export function buildTodoTools(ctx: ToolContext) {
  return {
    todo_write: tool({
      description:
        "替换当前任务列表。用于任何非简单的多步骤任务（>=3 个实质步骤）。处理时将恰好一个项目标记为 `in_progress`；完成后将其翻转为 `completed`，并将下一个标记为 `in_progress`。此工具会替换之前的列表 -- 请始终传递完整列表，而非增量更新。自动执行，无需批准。",
      inputSchema: z.object({
        todos: z
          .array(
            z.object({
              id: z
                .string()
                .optional()
                .describe(
                  "稳定 ID；省略则自动生成。跨调用复用 ID 以保持界面稳定。",
                ),
              title: z.string().min(1),
              description: z.string().optional(),
              status: TodoStatus,
            }),
          )
          .describe("此任务的完整待办事项列表。"),
      }),
      execute: async ({ todos }) => {
        const sessionId = ctx.getSessionId();
        if (!sessionId)
          return { error: "无活动会话；无法保存待办事项" };

        const normalized: Todo[] = todos.map((t) => ({
          id: t.id ?? newTodoId(),
          title: t.title,
          description: t.description,
          status: t.status,
        }));

        const err = validateTodos(normalized);
        if (err) return { error: err };

        useTodosStore.getState().setTodos(sessionId, normalized);

        return {
          ok: true,
          count: normalized.length,
          inProgress:
            normalized.find((t) => t.status === "in_progress")?.title ?? null,
        };
      },
    }),
  } as const;
}
