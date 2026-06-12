export type SubagentType = "explore" | "code-review" | "security" | "general";

export type SubagentDef = {
  id: SubagentType;
  label: string;
  description: string;
  /**
   * Whitelist of tools the subagent may call. Excludes mutating tools and
   * `run_subagent` itself to prevent recursion. The runner filters down the
   * main toolset to this list before constructing the inner Agent.
   */
  tools: string[];
  systemPrompt: string;
};

const READ_ONLY_TOOLS = ["read_file", "list_directory", "grep", "glob"];

export const SUBAGENTS: Record<SubagentType, SubagentDef> = {
  explore: {
    id: "explore",
    label: "探索",
    description:
      "只读代码库浏览器。定位文件、追踪引用、总结架构。",
    tools: READ_ONLY_TOOLS,
    systemPrompt: `You are an exploration subagent. Your job is to answer the spawn question by READING the codebase only — no edits, no commands. Use grep/glob/list_directory/read_file. Be terse. Return a concise summary suitable for the main agent to act on (file paths, key findings, line numbers). Stop as soon as you can answer.`,
  },
  "code-review": {
    id: "code-review",
    label: "代码审查",
    description:
      "审查代码变更的正确性、架构、性能和安全性。",
    tools: READ_ONLY_TOOLS,
    systemPrompt: `You are a code-review subagent. Inspect the requested code and report only ACTIONABLE findings: correctness bugs, architecture violations, performance issues, security risks. Skip style/formatting. Format each finding as: "[MUST/SHOULD/NIT] file:line — issue → fix". If nothing is wrong, say "Looks good." Do NOT propose unrelated cleanups.`,
  },
  security: {
    id: "security",
    label: "安全审查",
    description:
      "审计代码和配置中的安全风险（认证、注入、密钥等）。",
    tools: READ_ONLY_TOOLS,
    systemPrompt: `You are a security-review subagent. Scan the requested scope for: injection (SQL, shell, path), auth/authz bypass, secret leakage, missing validation at trust boundaries, unsafe deserialization, weak crypto. Report concrete findings with file:line and severity. Be conservative — false positives hurt more than missed nits. If nothing is wrong, say "No security issues found."`,
  },
  general: {
    id: "general",
    label: "通用研究",
    description:
      "通用型工作者，用于跨多个文件的多步骤研究问题。",
    tools: READ_ONLY_TOOLS,
    systemPrompt: `You are a general-purpose research subagent. Answer the spawn question by reading the codebase. Don't speculate — verify. Return a tight summary with the evidence you used (paths, line numbers).`,
  },
};
