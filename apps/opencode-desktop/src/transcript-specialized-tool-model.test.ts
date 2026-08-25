import { describe, expect, it } from "vitest";
import type { Part } from "@opencode-ai/sdk/v2";
import { pathParts, specializedTool, webURLs } from "./transcript-specialized-tool-model.js";

type ToolPart = Extract<Part, { type: "tool" }>;

describe("specialized transcript tools", () => {
  it("normalizes edit statistics and file-local error diagnostics", () => {
    const part = { type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "/repo/src/app.ts", oldString: "old", newString: "new" }, output: "ok", title: "src/app.ts", time: { start: 1, end: 2 }, attachments: [], metadata: {
      filediff: { file: "src/app.ts", patch: "@@ -1 +1 @@\n-old\n+new", additions: 1, deletions: 1 },
      diagnostics: { "/repo/src/app.ts": [
        { severity: 2, message: "warning", range: { start: { line: 0, character: 0 } } },
        { severity: 1, message: "broken", range: { start: { line: 3, character: 4 } } },
      ] },
    } } } as unknown as ToolPart;
    expect(specializedTool(part)).toMatchObject({
      kind: "edit", path: "src/app.ts", additions: 1, deletions: 1,
      diagnostics: [{ line: 4, column: 5, message: "broken" }],
    });
  });

  it("normalizes multi-file patches", () => {
    const part = { type: "tool", tool: "apply_patch", state: { status: "completed", input: {}, output: "Done", title: "Done", time: { start: 1, end: 2 }, attachments: [], metadata: { files: [
      { filePath: "/repo/a.ts", relativePath: "a.ts", type: "update", patch: "patch", additions: 2, deletions: 1 },
      { nope: true },
    ] } } } as unknown as ToolPart;
    expect(specializedTool(part)).toMatchObject({ kind: "patch", files: [{ relativePath: "a.ts", type: "update", additions: 2, deletions: 1 }] });
  });

  it("extracts unique web citations and provider titles", () => {
    expect(webURLs("See https://example.com/a, then https://example.com/a and https://docs.test/b)."))
      .toEqual(["https://example.com/a", "https://docs.test/b"]);
    const part = { type: "tool", tool: "websearch", state: { status: "completed", input: { query: "solid gpui" }, output: "https://example.com", title: "search", time: { start: 1, end: 2 }, attachments: [], metadata: { provider: "exa" } } } as unknown as ToolPart;
    expect(specializedTool(part)).toEqual({ kind: "websearch", title: "Exa Web Search", query: "solid gpui", urls: ["https://example.com"] });
  });

  it("splits portable paths", () => {
    expect(pathParts("src/components/app.tsx")).toEqual({ name: "app.tsx", directory: "src/components" });
    expect(pathParts("C:\\repo\\app.ts")).toEqual({ name: "app.ts", directory: "C:/repo" });
  });
});
