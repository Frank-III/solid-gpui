import { describe, expect, it } from "vitest";
import type { Message, Model, Session } from "@opencode-ai/sdk/v2";
import { transcriptContextMetrics } from "./transcript-context-model.js";

const assistant = (id: string, values: Partial<Extract<Message, { role: "assistant" }>> = {}) => ({
  id, sessionID: "session", role: "assistant", parentID: "user", modelID: "model", providerID: "provider",
  mode: "build", agent: "build", path: { cwd: "/repo", root: "/repo" }, cost: 0.1,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1 }, ...values,
}) as Extract<Message, { role: "assistant" }>;

describe("transcript context metrics", () => {
  it("uses the latest token-bearing message and OpenCode's inclusive token formula", () => {
    const messages = [
      { info: assistant("first", { cost: 0.25, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } }), parts: [] },
      { info: assistant("latest", { cost: 0.5, tokens: { input: 300, output: 100, reasoning: 50, cache: { read: 25, write: 25 } } }), parts: [] },
      { info: assistant("streaming"), parts: [] },
    ];
    const models = [{ id: "model", providerID: "provider", name: "Fast model", limit: { context: 1_000, output: 100 } }] as Model[];
    const session = { id: "session", title: "Test", version: "1", cost: 1.5, time: { created: 1, updated: 2 } } as Session;
    expect(transcriptContextMetrics(messages, models, session)).toEqual({
      total: 500, input: 300, output: 100, reasoning: 50, cacheRead: 25, cacheWrite: 25,
      contextLimit: 1_000, contextPercent: 50, cost: 1.5, model: "Fast model", agent: "build",
    });
  });

  it("falls back to loaded assistant cost and identifiers", () => {
    const messages = [{ info: assistant("one", { cost: 0.2, modelID: "missing", tokens: { input: 2, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }), parts: [] }];
    expect(transcriptContextMetrics(messages, [])).toMatchObject({ cost: 0.2, model: "provider/missing", total: 3 });
    expect(transcriptContextMetrics([{ info: assistant("empty"), parts: [] }], [])).toBeUndefined();
  });
});
