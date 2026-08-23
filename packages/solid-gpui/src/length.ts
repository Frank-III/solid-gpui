/**
 * Length parsing. gpui distinguishes absolute lengths (pixels, rems), definite
 * lengths (absolute plus fractions of the parent) and `auto`. The wire format
 * keeps that distinction explicit with a tagged object so the host never has to
 * guess what a bare number meant.
 */

export type WireLength =
  | { k: "px"; v: number }
  | { k: "rem"; v: number }
  | { k: "pct"; v: number }
  | { k: "auto" };

/**
 * Anything accepted where a length is expected. Bare numbers are pixels, which
 * matches how gpui code is usually written.
 */
export type LengthInput = number | `${number}px` | `${number}rem` | `${number}%` | "auto" | "full" | string;

export function px(value: number): WireLength {
  return { k: "px", v: value };
}

export function rems(value: number): WireLength {
  return { k: "rem", v: value };
}

/** A fraction of the parent, expressed 0..1. */
export function relative(fraction: number): WireLength {
  return { k: "pct", v: fraction };
}

export const auto: WireLength = { k: "auto" };

/** Normalises any accepted length notation into its wire form. */
export function toLength(input: LengthInput): WireLength {
  if (typeof input === "number") return px(input);
  const text = input.trim();
  if (text === "auto") return auto;
  if (text === "full") return relative(1);
  if (text.endsWith("%")) return relative(parseFloat(text) / 100);
  if (text.endsWith("rem")) return rems(parseFloat(text));
  if (text.endsWith("px")) return px(parseFloat(text));
  const bare = Number(text);
  if (!Number.isNaN(bare)) return px(bare);
  throw new TypeError(`solid-gpui: cannot parse length ${JSON.stringify(input)}`);
}
