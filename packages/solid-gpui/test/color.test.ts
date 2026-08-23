import { describe, expect, it } from "vitest";
import { hsla, rgb, rgba, toColor } from "../src/color.js";

const round = (value: number) => Math.round(value * 1000) / 1000;
const approx = (color: { h: number; s: number; l: number; a: number }) => ({
  h: round(color.h),
  s: round(color.s),
  l: round(color.l),
  a: round(color.a),
});

describe("toColor", () => {
  it("reads six and eight digit hex", () => {
    expect(approx(toColor("#ff0000"))).toEqual({ h: 0, s: 1, l: 0.5, a: 1 });
    expect(approx(toColor("#ff000080"))).toEqual({ h: 0, s: 1, l: 0.5, a: 0.502 });
  });

  it("expands three and four digit hex", () => {
    expect(approx(toColor("#f00"))).toEqual(approx(toColor("#ff0000")));
    expect(approx(toColor("#f00f"))).toEqual(approx(toColor("#ff0000ff")));
  });

  it("reads rgb and rgba, with and without alpha", () => {
    expect(approx(toColor("rgb(0, 0, 255)"))).toEqual({ h: round(2 / 3), s: 1, l: 0.5, a: 1 });
    expect(approx(toColor("rgba(0, 0, 255, 0.5)")).a).toEqual(0.5);
  });

  it("reads hsl with degrees and percentages", () => {
    expect(approx(toColor("hsl(120, 50%, 25%)"))).toEqual({
      h: round(1 / 3),
      s: 0.5,
      l: 0.25,
      a: 1,
    });
  });

  it("passes through hsla objects and fills in alpha", () => {
    expect(toColor({ h: 0.5, s: 0.4, l: 0.3, a: 0.2 })).toEqual({ h: 0.5, s: 0.4, l: 0.3, a: 0.2 });
    expect(toColor({ h: 0.5, s: 0.4, l: 0.3 } as never).a).toBe(1);
  });

  it("treats bare numbers as 0xRRGGBB", () => {
    expect(approx(toColor(0xff0000))).toEqual(approx(rgb(0xff0000)));
  });

  it("knows a few names", () => {
    expect(toColor("transparent").a).toBe(0);
    expect(approx(toColor("white"))).toEqual({ h: 0, s: 0, l: 1, a: 1 });
  });

  it("throws rather than silently painting black", () => {
    expect(() => toColor("chartreuse")).toThrow(/cannot parse colour/);
    expect(() => toColor("#12345")).toThrow(/cannot parse colour/);
  });
});

describe("constructors", () => {
  it("rgba reads the low byte as alpha", () => {
    expect(rgba(0x000000ff).a).toBe(1);
    expect(rgba(0x00000000).a).toBe(0);
  });

  it("hsla defaults to opaque", () => {
    expect(hsla(0.1, 0.2, 0.3)).toEqual({ h: 0.1, s: 0.2, l: 0.3, a: 1 });
  });
});
