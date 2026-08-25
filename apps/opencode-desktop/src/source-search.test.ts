import { describe, expect, it } from "vitest";
import { findSourceMatches, sourceSegments } from "./source-search.js";

describe("source search", () => {
  it("finds multiple case-insensitive matches with stable indexes", () => {
    expect(findSourceMatches(["Alpha alpha", "beta ALPHA"], "alpha")).toEqual([
      { index: 0, line: 0, start: 0, end: 5 },
      { index: 1, line: 0, start: 6, end: 11 },
      { index: 2, line: 1, start: 5, end: 10 },
    ]);
    expect(findSourceMatches(["Alpha alpha"], "Alpha", true)).toEqual([{ index: 0, line: 0, start: 0, end: 5 }]);
  });

  it("preserves syntax styles while splitting at search boundaries", () => {
    const matches = findSourceMatches(["const value"], "st va");
    expect(sourceSegments([
      { content: "const", color: "red", fontStyle: 2 },
      { content: " value", color: "blue" },
    ], matches, 0)).toEqual([
      { content: "con", color: "red", fontStyle: 2, match: undefined },
      { content: "st", color: "red", fontStyle: 2, match: "active" },
      { content: " va", color: "blue", match: "active" },
      { content: "lue", color: "blue", match: undefined },
    ]);
  });
});
