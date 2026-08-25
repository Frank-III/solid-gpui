import { describe, expect, it } from "vitest";
import type { Message, Part } from "@opencode-ai/sdk/v2";
import type { MessageItem } from "./opencode.js";
import { contextToolSummary, groupContextTools, type ToolPart } from "./transcript-tool-groups.js";

const assistant = (id: string, parts: Part[]): MessageItem => ({ info: { id, role: "assistant" } as Message, parts });
const user = (id: string): MessageItem => ({ info: { id, role: "user" } as Message, parts: [] });
const tool = (id: string, name: string, status: "running" | "completed" = "completed") => ({
  id, type: "tool", tool: name, state: { status, input: {}, ...(status === "completed" ? { output: "", title: name, metadata: {}, time: { start: 1, end: 2 } } : {}) },
}) as unknown as ToolPart;

describe("context tool grouping", () => {
  it("groups across assistant messages while ignoring step markers", () => {
    const read = tool("read", "read");
    const grep = tool("grep", "grep", "running");
    const list = tool("list", "list");
    const result = groupContextTools([
      assistant("one", [read, { id: "step", type: "step-finish" } as Part]),
      assistant("two", [grep, list]),
    ]);
    expect(result.groups.get("read")).toEqual([read, grep, list]);
    expect([...result.hidden]).toEqual(["grep", "list"]);
    expect(contextToolSummary([read, grep, list])).toEqual({ reads: 1, searches: 1, lists: 1, running: true });
  });

  it("uses user messages and visible content as barriers and leaves single tools alone", () => {
    const first = tool("first", "read");
    const second = tool("second", "grep");
    const result = groupContextTools([
      assistant("one", [first, { id: "text", type: "text", text: "done" } as Part, second]),
      user("user"),
      assistant("three", [tool("third", "list")]),
    ]);
    expect(result.groups.size).toBe(0);
    expect(result.hidden.size).toBe(0);
  });
});
