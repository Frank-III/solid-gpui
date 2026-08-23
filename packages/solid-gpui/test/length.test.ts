import { describe, expect, it } from "vitest";
import { auto, px, relative, rems, toLength } from "../src/length.js";

describe("toLength", () => {
  it("treats bare numbers as pixels", () => {
    expect(toLength(12)).toEqual(px(12));
    expect(toLength("12")).toEqual(px(12));
  });

  it("reads explicit units", () => {
    expect(toLength("12px")).toEqual(px(12));
    expect(toLength("1.5rem")).toEqual(rems(1.5));
  });

  it("turns percentages into fractions", () => {
    expect(toLength("50%")).toEqual(relative(0.5));
    expect(toLength("100%")).toEqual(relative(1));
  });

  it("knows auto and the full shorthand", () => {
    expect(toLength("auto")).toEqual(auto);
    expect(toLength("full")).toEqual(relative(1));
  });

  it("throws on anything else", () => {
    expect(() => toLength("min-content")).toThrow(/cannot parse length/);
  });
});
