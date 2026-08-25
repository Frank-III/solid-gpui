import { describe, expect, it } from "vitest";
import { contextFileURL, formatCommentNote, normalizeSelection, parseUnifiedPatch, selectedLinePreview } from "./workspace-model.js";

describe("workspace model", () => {
  it("normalizes source selections and creates OpenCode range URLs", () => {
    const selection = normalizeSelection({ path: "src/app.ts", startLine: 9, endLine: 4, side: "new" });
    expect(selection).toEqual({ path: "src/app.ts", startLine: 4, endLine: 9, side: "new" });
    expect(contextFileURL("/tmp/project", selection)).toBe("file:///tmp/project/src/app.ts?start=4&end=9");
  });

  it("uses OpenCode's comment note format", () => {
    expect(formatCommentNote({ path: "src/app.ts", startLine: 8, endLine: 8, comment: "rename this" }))
      .toBe("The user made the following comment regarding line 8 of src/app.ts: rename this");
    expect(formatCommentNote({ path: "src/app.ts", startLine: 12, endLine: 9, comment: "extract this" }))
      .toBe("The user made the following comment regarding lines 9 through 12 of src/app.ts: extract this");
  });

  it("extracts selected source previews", () => {
    expect(selectedLinePreview("one\ntwo\nthree\nfour", { startLine: 3, endLine: 2 })).toBe("two\nthree");
  });

  it("aligns replacement, insertion, deletion, and context rows", () => {
    const rows = parseUnifiedPatch([
      "@@ -10,4 +10,5 @@ function run() {",
      " same",
      "-old one",
      "-old two",
      "+new one",
      "+new two",
      "+new three",
      " tail",
    ].join("\n"));
    expect(rows).toEqual([
      { kind: "hunk", oldText: "@@ -10,4 +10,5 @@ function run() {", newText: "@@ -10,4 +10,5 @@ function run() {" },
      { kind: "context", oldLine: 10, newLine: 10, oldText: "same", newText: "same" },
      { kind: "change", oldLine: 11, newLine: 11, oldText: "old one", newText: "new one" },
      { kind: "change", oldLine: 12, newLine: 12, oldText: "old two", newText: "new two" },
      { kind: "change", oldLine: undefined, newLine: 13, oldText: undefined, newText: "new three" },
      { kind: "context", oldLine: 13, newLine: 14, oldText: "tail", newText: "tail" },
    ]);
  });
});
