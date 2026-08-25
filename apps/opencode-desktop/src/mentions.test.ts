import { describe, expect, it } from "vitest";
import { agentMentions, mentionSuggestions } from "./mentions.js";

describe("composer mentions", () => {
  it("orders references, secondary agents, resources, recent files, then search results", () => {
    const suggestions = mentionSuggestions({
      query: "",
      recent: ["src/app.ts"],
      files: ["src/app.ts", "src/other.ts"],
      agents: [
        { name: "build", description: "Primary", mode: "primary", hidden: false, permission: [], options: {} },
        { name: "reviewer", description: "Review changes", mode: "subagent", hidden: false, permission: [], options: {} },
      ],
      references: [{ name: "design", path: "/refs/design", description: "Design system", source: { type: "local", path: "/refs/design" } }],
      resources: [{ name: "API docs", uri: "docs://api", client: "docs", mimeType: "text/markdown" }],
    });
    expect(suggestions.map((item) => [item.kind, item.label])).toEqual([
      ["reference", "design"],
      ["agent", "reviewer"],
      ["resource", "API docs"],
      ["recent", "src/app.ts"],
      ["file", "src/other.ts"],
    ]);
  });

  it("creates typed agent ranges only while the selected token remains in text", () => {
    expect(agentMentions("Ask @reviewer then @reviewer.", ["reviewer", "deleted"])).toEqual([
      { name: "reviewer", start: 4, end: 13, text: "@reviewer" },
      { name: "reviewer", start: 19, end: 28, text: "@reviewer" },
    ]);
    expect(agentMentions("email@reviewer.com", ["reviewer"])).toEqual([]);
  });
});
