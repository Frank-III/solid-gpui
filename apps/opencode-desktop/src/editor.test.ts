import { describe, expect, it } from "vitest";
import { activeFileMention, insertText, replaceFileMention } from "./editor.js";

describe("desktop composer editor", () => {
  it("inserts at the caret and replaces a selected range", () => {
    expect(insertText({ value: "helo", cursor: 2 }, "l")).toEqual({ value: "hello", cursor: 3 });
    expect(insertText({ value: "replace me", anchor: 0, cursor: 10 }, "pasted")).toEqual({ value: "pasted", cursor: 6 });
  });

  it("finds and replaces the file mention at the caret", () => {
    const state = { value: "check @src/ap please", cursor: 13 };
    const mention = activeFileMention(state);
    expect(mention).toEqual({ start: 6, end: 13, query: "src/ap" });
    expect(replaceFileMention(state, mention!, "src/app.ts")).toEqual({
      value: "check @src/app.ts please",
      cursor: 17,
    });
    expect(activeFileMention({ value: "email@example.com", cursor: 17 })).toBeUndefined();
  });
});
