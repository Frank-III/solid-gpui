import { describe, expect, it } from "vitest";
import { normalizeStyle } from "../src/style.js";
import { px, relative, rems } from "../src/length.js";
import { toColor } from "../src/color.js";

describe("normalizeStyle", () => {
  it("returns null for nothing", () => {
    expect(normalizeStyle(null)).toBeNull();
    expect(normalizeStyle(undefined)).toBeNull();
  });

  it("emits only the fields that were set", () => {
    expect(normalizeStyle({ flexGrow: 1 })).toEqual({ flex_grow: 1 });
  });

  it("expands box shorthands before their long-hand siblings", () => {
    expect(normalizeStyle({ padding: 8, paddingTop: 16 })?.padding).toEqual({
      top: px(16),
      right: px(8),
      bottom: px(8),
      left: px(8),
    });
  });

  it("maps the axis shorthands onto the right edges", () => {
    expect(normalizeStyle({ marginX: 4, marginY: 2 })?.margin).toEqual({
      left: px(4),
      right: px(4),
      top: px(2),
      bottom: px(2),
    });
  });

  it("splits size and border radius across their components", () => {
    expect(normalizeStyle({ size: "50%" })?.size).toEqual({
      width: relative(0.5),
      height: relative(0.5),
    });
    expect(normalizeStyle({ borderRadius: "1rem" })?.corner_radii).toEqual({
      top_left: rems(1),
      top_right: rems(1),
      bottom_left: rems(1),
      bottom_right: rems(1),
    });
  });

  it("routes min and max sizes to their own fields", () => {
    const style = normalizeStyle({ minWidth: 10, maxHeight: 20 });
    expect(style?.min_size).toEqual({ width: px(10) });
    expect(style?.max_size).toEqual({ height: px(20) });
  });

  it("splits gap into a width and a height", () => {
    expect(normalizeStyle({ gap: 6 })?.gap).toEqual({ width: px(6), height: px(6) });
    expect(normalizeStyle({ columnGap: 6 })?.gap).toEqual({ width: px(6) });
  });

  it("accepts either spelling of background", () => {
    const red = toColor("#ff0000");
    expect(normalizeStyle({ background: "#ff0000" })?.background).toEqual(red);
    expect(normalizeStyle({ backgroundColor: "#ff0000" })?.background).toEqual(red);
  });

  it("copies both overflow axes from the shorthand", () => {
    expect(normalizeStyle({ overflow: "scroll" })?.overflow).toEqual({ x: "scroll", y: "scroll" });
    expect(normalizeStyle({ overflow: "scroll", overflowX: "hidden" })?.overflow).toEqual({
      x: "hidden",
      y: "scroll",
    });
  });

  it("moves text properties into the nested text style", () => {
    const style = normalizeStyle({
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "semibold",
      lineHeight: "1.4rem",
      textAlign: "center",
    });
    expect(style?.text).toEqual({
      color: toColor("#ffffff"),
      font_size: px(14),
      font_weight: 600,
      line_height: rems(1.4),
      text_align: "center",
    });
    expect(style).not.toHaveProperty("color");
  });

  it("accepts a numeric font weight unchanged", () => {
    expect(normalizeStyle({ fontWeight: 350 })?.text?.font_weight).toBe(350);
  });

  it("turns boolean decorations into styles and false into a removal", () => {
    expect(normalizeStyle({ underline: true })?.text?.underline).toEqual({});
    expect(normalizeStyle({ underline: false })?.text?.underline).toBeNull();
    expect(normalizeStyle({ strikethrough: { thickness: 2 } })?.text?.strikethrough).toEqual({
      thickness: 2,
    });
  });

  it("describes text overflow with a kind and an ellipsis", () => {
    expect(normalizeStyle({ textOverflow: "ellipsis-middle" })?.text?.text_overflow).toEqual({
      kind: "truncate_middle",
      ellipsis: "…",
    });
    expect(normalizeStyle({ textOverflow: "clip" })?.text?.text_overflow).toBeNull();
  });

  it("fills in shadow defaults", () => {
    expect(normalizeStyle({ boxShadow: [{ y: 2, blur: 8 }] })?.box_shadow).toEqual([
      {
        color: toColor("rgba(0,0,0,0.25)"),
        offset: { x: 0, y: 2 },
        blur_radius: 8,
        spread_radius: 0,
        inset: false,
      },
    ]);
  });

  it("treats flex as a shorthand for flexGrow, with the long-hand winning", () => {
    expect(normalizeStyle({ flex: 2 })?.flex_grow).toBe(2);
    expect(normalizeStyle({ flex: 2, flexGrow: 3 })?.flex_grow).toBe(3);
  });

  it("passes the cursor through for the host to map", () => {
    expect(normalizeStyle({ cursor: "pointer" })?.mouse_cursor).toBe("pointer");
  });

  it("turns visible into a visibility keyword", () => {
    expect(normalizeStyle({ visible: false })?.visibility).toBe("hidden");
  });
});
