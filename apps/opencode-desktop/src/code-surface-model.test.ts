import { describe, expect, it } from "vitest";
import { codeHighlights, lineSelection, selectedSourceText } from "./code-surface-model.js";
import { findSourceMatches } from "./source-search.js";

describe("code surface model", () => {
  it("creates UTF-16 document spans while preserving syntax and search styles", () => {
    const lines = ["const value", "value"];
    const matches = findSourceMatches(lines, "value");
    expect(codeHighlights(lines, [
      [{ content: "const", color: "#ff0000" }, { content: " value", color: "#00ff00" }],
      [{ content: "value", color: "#00ff00" }],
    ], matches, 1)).toEqual([
      { start: 0, end: 5, color: "#ff0000", background: undefined, fontStyle: undefined },
      { start: 5, end: 6, color: "#00ff00", background: undefined, fontStyle: undefined },
      { start: 6, end: 11, color: "#00ff00", background: "#554521", fontStyle: undefined },
      { start: 12, end: 17, color: "#00ff00", background: "#9b6b2f", fontStyle: undefined },
    ]);
  });

  it("maps character selections to line context and exact copied text", () => {
    const content = "alpha\nbeta\ngamma";
    expect(lineSelection("file.ts", content, { start: 2, end: 9 })).toEqual({ path: "file.ts", startLine: 1, endLine: 2 });
    expect(selectedSourceText(content, { start: 9, end: 2 })).toBe("pha\nbet");
    expect(lineSelection("file.ts", content, { start: 2, end: 2 })).toBeUndefined();
  });
});
