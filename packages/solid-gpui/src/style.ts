/**
 * Style normalisation.
 *
 * Authors write a CSS-flavoured camel case object; the host wants something
 * that maps one-to-one onto gpui's `StyleRefinement`. All of the shorthand
 * expansion, unit parsing and colour parsing happens here so the Rust side is a
 * mechanical field-by-field assignment with no guessing.
 */

import { toColor, type ColorInput, type Hsla } from "./color.js";
import { toLength, type LengthInput, type WireLength } from "./length.js";

export interface WireEdges {
  top?: WireLength;
  right?: WireLength;
  bottom?: WireLength;
  left?: WireLength;
}

export interface WireCorners {
  top_left?: WireLength;
  top_right?: WireLength;
  bottom_left?: WireLength;
  bottom_right?: WireLength;
}

export interface WireSize {
  width?: WireLength;
  height?: WireLength;
}

export interface WireShadow {
  color: Hsla;
  offset: { x: number; y: number };
  blur_radius: number;
  spread_radius: number;
  inset: boolean;
}

export interface WireTextStyle {
  color?: Hsla;
  font_family?: string;
  font_size?: WireLength;
  line_height?: WireLength;
  font_weight?: number;
  font_style?: string;
  background_color?: Hsla;
  underline?: { color?: Hsla; thickness?: number; wavy?: boolean } | null;
  strikethrough?: { color?: Hsla; thickness?: number } | null;
  white_space?: string;
  text_align?: string;
  text_overflow?: { kind: string; ellipsis: string } | null;
  line_clamp?: number;
}

export interface WireGridTemplate {
  repeat: number;
  min_size: string;
}

export interface WireStyle {
  display?: string;
  visibility?: string;
  position?: string;
  overflow?: { x?: string; y?: string };
  scrollbar_width?: WireLength;
  inset?: WireEdges;
  size?: WireSize;
  min_size?: WireSize;
  max_size?: WireSize;
  aspect_ratio?: number;
  margin?: WireEdges;
  padding?: WireEdges;
  border_widths?: WireEdges;
  align_items?: string;
  align_self?: string;
  align_content?: string;
  justify_content?: string;
  gap?: WireSize;
  flex_direction?: string;
  flex_wrap?: string;
  flex_basis?: WireLength;
  flex_grow?: number;
  flex_shrink?: number;
  background?: Hsla;
  border_color?: Hsla;
  border_style?: string;
  corner_radii?: WireCorners;
  box_shadow?: WireShadow[];
  opacity?: number;
  mouse_cursor?: string;
  grid_cols?: WireGridTemplate;
  grid_rows?: WireGridTemplate;
  text?: WireTextStyle;
}

/** A shadow as authors write it. Offsets, blur and spread are pixels. */
export interface ShadowInput {
  color?: ColorInput;
  x?: number;
  y?: number;
  blur?: number;
  spread?: number;
  inset?: boolean;
}

export type Display = "flex" | "block" | "grid" | "none";
export type Position = "relative" | "absolute";
export type Overflow = "visible" | "hidden" | "scroll";
export type FlexDirection = "row" | "column" | "row-reverse" | "column-reverse";
export type FlexWrap = "nowrap" | "wrap" | "wrap-reverse";
export type AlignItems = "start" | "end" | "center" | "baseline" | "stretch";
export type JustifyContent =
  | "start"
  | "end"
  | "center"
  | "space-between"
  | "space-around"
  | "space-evenly"
  | "stretch";
export type FontWeightName =
  | "thin"
  | "extralight"
  | "light"
  | "normal"
  | "medium"
  | "semibold"
  | "bold"
  | "extrabold"
  | "black";
export type Cursor =
  | "default"
  | "pointer"
  | "text"
  | "crosshair"
  | "grab"
  | "grabbing"
  | "ew-resize"
  | "ns-resize"
  | "col-resize"
  | "row-resize"
  | "none";

/** The style object accepted by every intrinsic element's `style` prop. */
export interface GpuiStyle {
  display?: Display;
  visible?: boolean;
  position?: Position;

  overflow?: Overflow;
  overflowX?: Overflow;
  overflowY?: Overflow;
  scrollbarWidth?: LengthInput;

  inset?: LengthInput;
  top?: LengthInput;
  right?: LengthInput;
  bottom?: LengthInput;
  left?: LengthInput;

  size?: LengthInput;
  width?: LengthInput;
  height?: LengthInput;
  minWidth?: LengthInput;
  minHeight?: LengthInput;
  maxWidth?: LengthInput;
  maxHeight?: LengthInput;
  aspectRatio?: number;

  margin?: LengthInput;
  marginX?: LengthInput;
  marginY?: LengthInput;
  marginTop?: LengthInput;
  marginRight?: LengthInput;
  marginBottom?: LengthInput;
  marginLeft?: LengthInput;

  padding?: LengthInput;
  paddingX?: LengthInput;
  paddingY?: LengthInput;
  paddingTop?: LengthInput;
  paddingRight?: LengthInput;
  paddingBottom?: LengthInput;
  paddingLeft?: LengthInput;

  borderWidth?: LengthInput;
  borderTopWidth?: LengthInput;
  borderRightWidth?: LengthInput;
  borderBottomWidth?: LengthInput;
  borderLeftWidth?: LengthInput;
  borderColor?: ColorInput;
  borderStyle?: "solid" | "dashed";

  borderRadius?: LengthInput;
  borderTopLeftRadius?: LengthInput;
  borderTopRightRadius?: LengthInput;
  borderBottomLeftRadius?: LengthInput;
  borderBottomRightRadius?: LengthInput;

  alignItems?: AlignItems;
  alignSelf?: AlignItems;
  alignContent?: JustifyContent;
  justifyContent?: JustifyContent;
  gap?: LengthInput;
  columnGap?: LengthInput;
  rowGap?: LengthInput;

  flexDirection?: FlexDirection;
  flexWrap?: FlexWrap;
  flexBasis?: LengthInput;
  flexGrow?: number;
  flexShrink?: number;
  /** Shorthand for `flexGrow`. */
  flex?: number;

  background?: ColorInput;
  backgroundColor?: ColorInput;
  boxShadow?: ShadowInput[];
  opacity?: number;
  cursor?: Cursor;

  gridColumns?: number;
  gridRows?: number;

  color?: ColorInput;
  fontFamily?: string;
  fontSize?: LengthInput;
  fontWeight?: number | FontWeightName;
  fontStyle?: "normal" | "italic" | "oblique";
  lineHeight?: LengthInput;
  textAlign?: "left" | "center" | "right";
  whiteSpace?: "normal" | "nowrap";
  underline?: boolean | { color?: ColorInput; thickness?: number; wavy?: boolean };
  strikethrough?: boolean | { color?: ColorInput; thickness?: number };
  textOverflow?: "clip" | "ellipsis" | "ellipsis-start" | "ellipsis-middle";
  lineClamp?: number;
}

const FONT_WEIGHTS: Record<FontWeightName, number> = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
};

const TEXT_OVERFLOW_KIND: Record<string, string> = {
  ellipsis: "truncate",
  "ellipsis-start": "truncate_start",
  "ellipsis-middle": "truncate_middle",
};

function edges<T extends WireEdges>(target: WireStyle, key: "inset" | "margin" | "padding" | "border_widths"): WireEdges {
  return (target[key] ??= {}) as T;
}

function size(target: WireStyle, key: "size" | "min_size" | "max_size" | "gap"): WireSize {
  return (target[key] ??= {});
}

function text(target: WireStyle): WireTextStyle {
  return (target.text ??= {});
}

/**
 * Converts an author-facing style object into its wire representation.
 * Shorthands are applied before their long-hand counterparts so that, for
 * example, `{ padding: 8, paddingTop: 16 }` behaves the way CSS would.
 */
export function normalizeStyle(input: GpuiStyle | null | undefined): WireStyle | null {
  if (!input) return null;
  const out: WireStyle = {};

  if (input.display !== undefined) out.display = input.display;
  if (input.visible !== undefined) out.visibility = input.visible ? "visible" : "hidden";
  if (input.position !== undefined) out.position = input.position;

  if (input.overflow !== undefined) out.overflow = { x: input.overflow, y: input.overflow };
  if (input.overflowX !== undefined) (out.overflow ??= {}).x = input.overflowX;
  if (input.overflowY !== undefined) (out.overflow ??= {}).y = input.overflowY;
  if (input.scrollbarWidth !== undefined) out.scrollbar_width = toLength(input.scrollbarWidth);

  if (input.inset !== undefined) {
    const value = toLength(input.inset);
    out.inset = { top: value, right: value, bottom: value, left: value };
  }
  if (input.top !== undefined) edges(out, "inset").top = toLength(input.top);
  if (input.right !== undefined) edges(out, "inset").right = toLength(input.right);
  if (input.bottom !== undefined) edges(out, "inset").bottom = toLength(input.bottom);
  if (input.left !== undefined) edges(out, "inset").left = toLength(input.left);

  if (input.size !== undefined) {
    const value = toLength(input.size);
    out.size = { width: value, height: value };
  }
  if (input.width !== undefined) size(out, "size").width = toLength(input.width);
  if (input.height !== undefined) size(out, "size").height = toLength(input.height);
  if (input.minWidth !== undefined) size(out, "min_size").width = toLength(input.minWidth);
  if (input.minHeight !== undefined) size(out, "min_size").height = toLength(input.minHeight);
  if (input.maxWidth !== undefined) size(out, "max_size").width = toLength(input.maxWidth);
  if (input.maxHeight !== undefined) size(out, "max_size").height = toLength(input.maxHeight);
  if (input.aspectRatio !== undefined) out.aspect_ratio = input.aspectRatio;

  applyBox(out, "margin", input.margin, input.marginX, input.marginY, input.marginTop, input.marginRight, input.marginBottom, input.marginLeft);
  applyBox(out, "padding", input.padding, input.paddingX, input.paddingY, input.paddingTop, input.paddingRight, input.paddingBottom, input.paddingLeft);
  applyBox(out, "border_widths", input.borderWidth, undefined, undefined, input.borderTopWidth, input.borderRightWidth, input.borderBottomWidth, input.borderLeftWidth);

  if (input.borderColor !== undefined) out.border_color = toColor(input.borderColor);
  if (input.borderStyle !== undefined) out.border_style = input.borderStyle;

  if (input.borderRadius !== undefined) {
    const value = toLength(input.borderRadius);
    out.corner_radii = { top_left: value, top_right: value, bottom_left: value, bottom_right: value };
  }
  const corners = () => (out.corner_radii ??= {});
  if (input.borderTopLeftRadius !== undefined) corners().top_left = toLength(input.borderTopLeftRadius);
  if (input.borderTopRightRadius !== undefined) corners().top_right = toLength(input.borderTopRightRadius);
  if (input.borderBottomLeftRadius !== undefined) corners().bottom_left = toLength(input.borderBottomLeftRadius);
  if (input.borderBottomRightRadius !== undefined) corners().bottom_right = toLength(input.borderBottomRightRadius);

  if (input.alignItems !== undefined) out.align_items = input.alignItems;
  if (input.alignSelf !== undefined) out.align_self = input.alignSelf;
  if (input.alignContent !== undefined) out.align_content = input.alignContent;
  if (input.justifyContent !== undefined) out.justify_content = input.justifyContent;

  if (input.gap !== undefined) {
    const value = toLength(input.gap);
    out.gap = { width: value, height: value };
  }
  if (input.columnGap !== undefined) size(out, "gap").width = toLength(input.columnGap);
  if (input.rowGap !== undefined) size(out, "gap").height = toLength(input.rowGap);

  if (input.flexDirection !== undefined) out.flex_direction = input.flexDirection;
  if (input.flexWrap !== undefined) out.flex_wrap = input.flexWrap;
  if (input.flexBasis !== undefined) out.flex_basis = toLength(input.flexBasis);
  if (input.flex !== undefined) out.flex_grow = input.flex;
  if (input.flexGrow !== undefined) out.flex_grow = input.flexGrow;
  if (input.flexShrink !== undefined) out.flex_shrink = input.flexShrink;

  const background = input.background ?? input.backgroundColor;
  if (background !== undefined) out.background = toColor(background);

  if (input.boxShadow !== undefined) {
    out.box_shadow = input.boxShadow.map((shadow) => ({
      color: toColor(shadow.color ?? "rgba(0,0,0,0.25)"),
      offset: { x: shadow.x ?? 0, y: shadow.y ?? 0 },
      blur_radius: shadow.blur ?? 0,
      spread_radius: shadow.spread ?? 0,
      inset: shadow.inset ?? false,
    }));
  }
  if (input.opacity !== undefined) out.opacity = input.opacity;
  if (input.cursor !== undefined) out.mouse_cursor = input.cursor;

  if (input.gridColumns !== undefined) out.grid_cols = { repeat: input.gridColumns, min_size: "zero" };
  if (input.gridRows !== undefined) out.grid_rows = { repeat: input.gridRows, min_size: "zero" };

  if (input.color !== undefined) text(out).color = toColor(input.color);
  if (input.fontFamily !== undefined) text(out).font_family = input.fontFamily;
  if (input.fontSize !== undefined) text(out).font_size = toLength(input.fontSize);
  if (input.fontWeight !== undefined) {
    text(out).font_weight =
      typeof input.fontWeight === "number" ? input.fontWeight : FONT_WEIGHTS[input.fontWeight];
  }
  if (input.fontStyle !== undefined) text(out).font_style = input.fontStyle;
  if (input.lineHeight !== undefined) text(out).line_height = toLength(input.lineHeight);
  if (input.textAlign !== undefined) text(out).text_align = input.textAlign;
  if (input.whiteSpace !== undefined) text(out).white_space = input.whiteSpace;
  if (input.lineClamp !== undefined) text(out).line_clamp = input.lineClamp;

  if (input.underline !== undefined) {
    text(out).underline =
      input.underline === false
        ? null
        : input.underline === true
          ? {}
          : {
              ...(input.underline.color !== undefined ? { color: toColor(input.underline.color) } : {}),
              ...(input.underline.thickness !== undefined ? { thickness: input.underline.thickness } : {}),
              ...(input.underline.wavy !== undefined ? { wavy: input.underline.wavy } : {}),
            };
  }
  if (input.strikethrough !== undefined) {
    text(out).strikethrough =
      input.strikethrough === false
        ? null
        : input.strikethrough === true
          ? {}
          : {
              ...(input.strikethrough.color !== undefined ? { color: toColor(input.strikethrough.color) } : {}),
              ...(input.strikethrough.thickness !== undefined ? { thickness: input.strikethrough.thickness } : {}),
            };
  }
  if (input.textOverflow !== undefined) {
    text(out).text_overflow =
      input.textOverflow === "clip"
        ? null
        : { kind: TEXT_OVERFLOW_KIND[input.textOverflow]!, ellipsis: "…" };
  }

  return out;
}

function applyBox(
  out: WireStyle,
  key: "margin" | "padding" | "border_widths",
  all: LengthInput | undefined,
  x: LengthInput | undefined,
  y: LengthInput | undefined,
  top: LengthInput | undefined,
  right: LengthInput | undefined,
  bottom: LengthInput | undefined,
  left: LengthInput | undefined,
): void {
  if (all !== undefined) {
    const value = toLength(all);
    out[key] = { top: value, right: value, bottom: value, left: value };
  }
  if (x !== undefined) {
    const value = toLength(x);
    const target = edges(out, key);
    target.left = value;
    target.right = value;
  }
  if (y !== undefined) {
    const value = toLength(y);
    const target = edges(out, key);
    target.top = value;
    target.bottom = value;
  }
  if (top !== undefined) edges(out, key).top = toLength(top);
  if (right !== undefined) edges(out, key).right = toLength(right);
  if (bottom !== undefined) edges(out, key).bottom = toLength(bottom);
  if (left !== undefined) edges(out, key).left = toLength(left);
}
