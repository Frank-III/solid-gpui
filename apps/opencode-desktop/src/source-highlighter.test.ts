import { describe, expect, it } from "vitest";
import { highlightCode, highlightSource, sourceLanguage } from "./source-highlighter.js";

describe("source highlighter", () => {
  it("detects common source languages", () => {
    expect(sourceLanguage("src/app.tsx")).toBe("tsx");
    expect(sourceLanguage("Dockerfile")).toBe("dockerfile");
    expect(sourceLanguage("notes.unknown")).toBeUndefined();
  });

  it("caches Shiki tokenization and falls back for unknown files", async () => {
    const first = highlightSource("src/app.ts", "const answer = 42");
    expect(highlightSource("src/app.ts", "const answer = 42")).toBe(first);
    const highlighted = await first;
    expect(highlighted.language).toBe("typescript");
    expect(highlighted.lines[0]?.map((token) => token.content).join("")).toBe("const answer = 42");
    expect(highlighted.lines[0]?.some((token) => token.color)).toBe(true);

    await expect(highlightSource("README.unknown", "plain text")).resolves.toEqual({
      language: "text",
      lines: [[{ content: "plain text" }]],
    });
  });

  it("accepts common fenced-code language aliases", async () => {
    const highlighted = await highlightCode("ts", "const answer: number = 42");
    expect(highlighted.language).toBe("typescript");
    expect(highlighted.lines.flat().map((token) => token.content).join(""))
      .toBe("const answer: number = 42");
  });
});
