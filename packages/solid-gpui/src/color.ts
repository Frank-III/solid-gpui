/**
 * Colour parsing. gpui stores colours as HSLA with every channel in the 0..1
 * range, so all supported input notations are converted here rather than in the
 * host: the wire format is always `{ h, s, l, a }`.
 */

export interface Hsla {
  h: number;
  s: number;
  l: number;
  a: number;
}

export type ColorInput = string | Hsla | { r: number; g: number; b: number; a?: number } | number;

const NAMED: Record<string, number> = {
  transparent: 0x00000000,
  black: 0x000000ff,
  white: 0xffffffff,
  red: 0xff0000ff,
  green: 0x008000ff,
  blue: 0x0000ffff,
  yellow: 0xffff00ff,
  cyan: 0x00ffffff,
  magenta: 0xff00ffff,
  gray: 0x808080ff,
  grey: 0x808080ff,
  orange: 0xffa500ff,
  purple: 0x800080ff,
};

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Converts straight 0..255 RGB plus 0..1 alpha into gpui's HSLA representation. */
export function rgbaToHsla(r: number, g: number, b: number, a: number): Hsla {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  return { h, s, l, a: clamp01(a) };
}

/** Expands `0xRRGGBBAA` into HSLA. */
export function rgba(value: number): Hsla {
  const r = (value >>> 24) & 0xff;
  const g = (value >>> 16) & 0xff;
  const b = (value >>> 8) & 0xff;
  const a = (value & 0xff) / 255;
  return rgbaToHsla(r, g, b, a);
}

/** Expands `0xRRGGBB` into fully opaque HSLA. */
export function rgb(value: number): Hsla {
  return rgbaToHsla((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff, 1);
}

/** Builds an HSLA colour from 0..1 components. */
export function hsla(h: number, s: number, l: number, a = 1): Hsla {
  return { h, s, l, a };
}

function parseHex(text: string): Hsla | null {
  const hex = text.slice(1);
  const expand = (c: string) => parseInt(c + c, 16);
  if (hex.length === 3 || hex.length === 4) {
    const r = expand(hex[0]!);
    const g = expand(hex[1]!);
    const b = expand(hex[2]!);
    const a = hex.length === 4 ? expand(hex[3]!) / 255 : 1;
    return rgbaToHsla(r, g, b, a);
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return rgbaToHsla(r, g, b, a);
  }
  return null;
}

function parseFunctional(text: string): Hsla | null {
  const match = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text);
  if (!match) return null;
  const fn = match[1]!;
  const parts = match[2]!
    .split(/[,/\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  const num = (raw: string, scale: number) =>
    raw.endsWith("%") ? (parseFloat(raw) / 100) * scale : parseFloat(raw);
  const alpha = parts.length > 3 ? num(parts[3]!, 1) : 1;
  if (fn.startsWith("rgb")) {
    return rgbaToHsla(num(parts[0]!, 255), num(parts[1]!, 255), num(parts[2]!, 255), alpha);
  }
  const h = parseFloat(parts[0]!) / 360;
  return {
    h: ((h % 1) + 1) % 1,
    s: clamp01(num(parts[1]!, 1)),
    l: clamp01(num(parts[2]!, 1)),
    a: clamp01(alpha),
  };
}

/**
 * Normalises any accepted colour notation into HSLA. Throws on input that
 * cannot be interpreted so mistakes surface at the call site instead of
 * silently painting black.
 */
export function toColor(input: ColorInput): Hsla {
  if (typeof input === "number") return rgb(input);
  if (typeof input === "object") {
    if ("h" in input) return { h: input.h, s: input.s, l: input.l, a: input.a ?? 1 };
    return rgbaToHsla(input.r, input.g, input.b, input.a ?? 1);
  }
  const text = input.trim().toLowerCase();
  if (text in NAMED) return rgba(NAMED[text]!);
  if (text.startsWith("#")) {
    const parsed = parseHex(text);
    if (parsed) return parsed;
  }
  const functional = parseFunctional(text);
  if (functional) return functional;
  throw new TypeError(`solid-gpui: cannot parse colour ${JSON.stringify(input)}`);
}
