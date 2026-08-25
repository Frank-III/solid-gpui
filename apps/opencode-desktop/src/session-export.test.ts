import { describe, expect, it } from "vitest";
import type { OpenCodeState } from "./opencode.js";
import { sessionMarkdown } from "./session-export.js";

describe("session export", () => {
  it("preserves tool details, reasoning, and usage", () => {
    const state = {
      selectedID: "session",
      sessions: [{ id: "session", title: "Export me" }],
      messages: [{
        info: { id: "assistant", role: "assistant", providerID: "provider", modelID: "model", cost: 0.25, tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 1 } } },
        parts: [
          { type: "reasoning", text: "Thinking" },
          { type: "tool", callID: "call", tool: "read", state: { status: "completed", title: "Read file", input: { filePath: "a.ts" }, output: "contents", metadata: { lines: 1 }, time: { start: 1, end: 2 }, attachments: [] } },
          { type: "step-finish", reason: "stop", cost: 0.25, tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 1 } } },
        ],
      }],
    } as unknown as OpenCodeState;
    const markdown = sessionMarkdown(state);
    expect(markdown).toContain("# Export me");
    expect(markdown).toContain("<summary>Reasoning</summary>");
    expect(markdown).toContain("<summary>Read file — completed</summary>");
    expect(markdown).toContain('"filePath": "a.ts"');
    expect(markdown).toContain("21 tokens · $0.2500");
  });
});
