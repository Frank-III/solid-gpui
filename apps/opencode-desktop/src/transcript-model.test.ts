import { describe, expect, it } from "vitest";
import type { Part, Session } from "@opencode-ai/sdk/v2";
import { formatStructured, parseInlineMarkdown, parseTranscriptMarkdown, taskActivity, taskChildSessionID, toolDetail, toolPresentation, toolSections, toolSummary } from "./transcript-model.js";

describe("transcript model", () => {
  it("parses common markdown blocks and preserves paragraph and blank-line structure", () => {
    const blocks = parseTranscriptMarkdown("# Title\n\nFirst line\nsecond line\n\n1. one\n* two\n> quote\n\n```ts\nconst n = 1;\n```");
    expect(blocks.map(({ kind, text, marker, language }) => ({ kind, text, marker, language }))).toEqual([
      { kind: "heading", text: "Title", marker: undefined, language: undefined },
      { kind: "space", text: "", marker: undefined, language: undefined },
      { kind: "paragraph", text: "First line\nsecond line", marker: undefined, language: undefined },
      { kind: "space", text: "", marker: undefined, language: undefined },
      { kind: "numbered", text: "one", marker: "1.", language: undefined },
      { kind: "bullet", text: "two", marker: "•", language: undefined },
      { kind: "quote", text: "quote", marker: undefined, language: undefined },
      { kind: "space", text: "", marker: undefined, language: undefined },
      { kind: "code", text: "const n = 1;", marker: undefined, language: "ts" },
    ]);
  });

  it("handles an unterminated fence and Windows newlines", () => {
    expect(parseTranscriptMarkdown("```sh\r\necho ok")).toEqual([{ kind: "code", text: "echo ok", language: "sh" }]);
  });

  it("parses complete inline formatting while preserving streaming fragments", () => {
    expect(parseInlineMarkdown("Use `pnpm test`, **carefully**, with [docs](https://example.com) and *focus*."))
      .toEqual([
        { kind: "text", text: "Use " },
        { kind: "code", text: "pnpm test" },
        { kind: "text", text: ", " },
        { kind: "strong", text: "carefully" },
        { kind: "text", text: ", with " },
        { kind: "link", text: "docs", href: "https://example.com" },
        { kind: "text", text: " and " },
        { kind: "emphasis", text: "focus" },
        { kind: "text", text: "." },
      ]);
    expect(parseInlineMarkdown("streaming **not done")).toEqual([{ kind: "text", text: "streaming **not done" }]);
  });

  it("safely formats circular, bigint, and oversized structured values", () => {
    const value: Record<string, unknown> = { count: 2n };
    value.self = value;
    expect(formatStructured(value)).toContain('"self": "[Circular]"');
    expect(formatStructured("abcdef", 3)).toBe("abc\n… (truncated)");
  });

  it("models completed and pending tool detail", () => {
    const completed = { callID: "call-1", tool: "read", type: "tool", state: { status: "completed", input: { file: "a.ts" }, output: "ok", title: "Read", metadata: { lines: 2 }, time: { start: 10, end: 35 }, attachments: [] } } as unknown as Extract<Part, { type: "tool" }>;
    expect(toolSummary(completed)).toBe("call-1 · 25ms");
    expect(toolDetail(completed)).toContain("Input\n{\n  \"file\": \"a.ts\"\n}\n\nOutput\nok\n\nMetadata");
    const pending = { callID: "call-2", tool: "write", type: "tool", state: { status: "pending", input: {}, raw: '{"path":' } } as unknown as Extract<Part, { type: "tool" }>;
    expect(toolSummary(pending)).toBe("call-2");
    expect(toolDetail(pending)).toContain('Raw input\n{"path":');
  });

  it("extracts useful task identity and output presentation", () => {
    const task = { callID: "task-1", tool: "task", type: "tool", state: { status: "completed", input: { description: "Inspect auth", subagent_type: "explore", thoroughness: "high" }, output: "Found it", title: "Explore", metadata: { sessionId: "child-1", background: true }, time: { start: 1, end: 2 }, attachments: [] } } as unknown as Extract<Part, { type: "tool" }>;
    expect(toolPresentation(task)).toEqual({
      title: "Explore",
      subtitle: "Inspect auth",
      attributes: ["thoroughness=high"],
      childSessionID: "child-1",
      agent: "explore",
      background: true,
    });
    expect(toolSections(task).map(({ title, format }) => ({ title, format }))).toEqual([
      { title: "Input", format: "structured" },
      { title: "Output", format: "structured" },
      { title: "Metadata", format: "structured" },
    ]);
  });

  it("discovers a task child session by parent, description, and agent", () => {
    const task = { sessionID: "parent", tool: "task", type: "tool", state: { status: "running", input: { description: "Inspect auth", subagent_type: "explore" }, metadata: {} } } as unknown as Extract<Part, { type: "tool" }>;
    const sessions = [
      { id: "other", parentID: "parent", title: "Different task (@explore subagent)", agent: "explore", time: { created: 3, updated: 3 } },
      { id: "archived", parentID: "parent", title: "Inspect auth (@explore subagent)", agent: "explore", time: { created: 2, updated: 2, archived: 3 } },
      { id: "child", parentID: "parent", title: "Inspect auth deeply (@explore subagent)", agent: "explore", time: { created: 1, updated: 1 } },
    ] as Session[];
    expect(taskChildSessionID(task, sessions)).toBe("child");
  });

  it("keeps detached background tasks live from their child session status", () => {
    const background = { tool: "task", type: "tool", state: { status: "completed", input: {}, output: "started", title: "Task", metadata: { background: true }, time: { start: 1, end: 2 }, attachments: [] } } as unknown as Extract<Part, { type: "tool" }>;
    expect(taskActivity(background, { type: "busy" })).toEqual({ working: true, label: "working" });
    expect(taskActivity(background, { type: "retry", attempt: 2, message: "retrying", next: 3 })).toEqual({ working: true, label: "retry 2" });
    expect(taskActivity(background, { type: "idle" })).toEqual({ working: false, label: "completed" });
  });
});
