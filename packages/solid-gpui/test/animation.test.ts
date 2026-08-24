import { describe, expect, it } from "vitest";
import { normalizeAnimation } from "../src/style.js";
import { px } from "../src/length.js";
import { toColor } from "../src/color.js";

describe("normalizeAnimation", () => {
  it("returns null for nothing", () => {
    expect(normalizeAnimation(null)).toBeNull();
    expect(normalizeAnimation(undefined)).toBeNull();
  });

  it("normalises both endpoints and fills in defaults", () => {
    expect(
      normalizeAnimation({ duration: 400, from: { opacity: 0 }, to: { opacity: 1 } }),
    ).toEqual({
      duration_ms: 400,
      from: { opacity: 0 },
      to: { opacity: 1 },
      repeat: false,
      easing: "ease-in-out",
    });
  });

  it("carries repeat, easing and the frame cap", () => {
    const animation = normalizeAnimation({
      duration: 1000,
      from: { width: 0 },
      to: { width: 100 },
      repeat: true,
      easing: "linear",
      maxFps: 30,
    });
    expect(animation).toMatchObject({ repeat: true, easing: "linear", max_fps: 30 });
    expect(animation?.from.size).toEqual({ width: px(0) });
    expect(animation?.to.size).toEqual({ width: px(100) });
  });

  it("normalises colours in the endpoints", () => {
    const animation = normalizeAnimation({
      duration: 200,
      from: { background: "#000000" },
      to: { background: "#ffffff" },
    });
    expect(animation?.from.background).toEqual(toColor("#000000"));
    expect(animation?.to.background).toEqual(toColor("#ffffff"));
  });
});
