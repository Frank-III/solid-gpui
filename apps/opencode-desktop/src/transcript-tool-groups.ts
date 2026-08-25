import type { Part } from "@opencode-ai/sdk/v2";
import type { MessageItem } from "./opencode.js";

export type ToolPart = Extract<Part, { type: "tool" }>;

export interface ContextToolGrouping {
  groups: Map<string, ToolPart[]>;
  hidden: Set<string>;
}

export interface ContextToolSummary {
  reads: number;
  searches: number;
  lists: number;
  running: boolean;
}

const CONTEXT_TOOLS = new Set(["read", "glob", "grep", "list"]);
const ADMINISTRATIVE_PARTS = new Set(["step-start", "step-finish", "snapshot", "agent"]);

export function contextToolSummary(parts: ToolPart[]): ContextToolSummary {
  return {
    reads: parts.filter((part) => part.tool === "read").length,
    searches: parts.filter((part) => part.tool === "glob" || part.tool === "grep").length,
    lists: parts.filter((part) => part.tool === "list").length,
    running: parts.some((part) => part.state.status === "pending" || part.state.status === "running"),
  };
}

/** Groups consecutive context-gathering tools, including across assistant message boundaries. */
export function groupContextTools(messages: MessageItem[]): ContextToolGrouping {
  const groups = new Map<string, ToolPart[]>();
  const hidden = new Set<string>();
  let pending: ToolPart[] = [];
  const flush = () => {
    if (pending.length > 1) {
      groups.set(pending[0]!.id, pending);
      for (const part of pending.slice(1)) hidden.add(part.id);
    }
    pending = [];
  };
  for (const message of messages) {
    if (message.info.role !== "assistant") {
      flush();
      continue;
    }
    for (const part of message.parts) {
      if (part.type === "tool" && CONTEXT_TOOLS.has(part.tool)) {
        pending.push(part);
        continue;
      }
      if (!ADMINISTRATIVE_PARTS.has(part.type)) flush();
    }
  }
  flush();
  return { groups, hidden };
}
