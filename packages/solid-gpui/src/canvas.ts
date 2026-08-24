/**
 * The recorder behind `<canvas>`.
 *
 * gpui repaints from its own scene every frame, and the drawing code is a
 * process away, so a canvas here cannot be immediate-mode the way the web's is:
 * nothing can be asked to draw while the frame is being built. Instead the draw
 * function records what to draw, the recording travels as a property, and the
 * host replays it until a new one replaces it. Re-recording is how you change
 * the picture, which is also what a reactive renderer wants — the draw function
 * runs in an effect and re-records when what it read changes.
 *
 * There is no readback. `getImageData` and friends have no answer to give: the
 * pixels are on the GPU, in the other process.
 */

import { toColor, type ColorInput, type Hsla } from "./color.js";

/** One point on a path; `cx`/`cy` curve the segment that arrives at it. */
export interface Vertex {
  x: number;
  y: number;
  cx?: number;
  cy?: number;
}

export type DrawCommand =
  | {
      k: "quad";
      x: number;
      y: number;
      w: number;
      h: number;
      background?: Hsla;
      radius?: number;
      border_width?: number;
      border_color?: Hsla;
    }
  | { k: "path"; points: Vertex[]; color: Hsla }
  | { k: "text"; x: number; y: number; text: string; font_size?: number; color?: Hsla };

/** How finely a curve is flattened when it is stroked rather than filled. */
const CURVE_STEPS = 16;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * A drawing surface shaped like the web's 2D context, with the differences the
 * host forces: it records rather than paints, and it has no state stack.
 */
export class CanvasContext {
  /** The element's width in logical pixels, as of the last layout. */
  readonly width: number;
  /** The element's height in logical pixels, as of the last layout. */
  readonly height: number;

  fillStyle: ColorInput = "#000000";
  strokeStyle: ColorInput = "#000000";
  lineWidth = 1;
  /** Font size for `fillText`; the family is the one the element inherits. */
  fontSize?: number;

  private commands: DrawCommand[] = [];
  private path: Vertex[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  /** Throws away everything recorded so far. */
  clear(): this {
    this.commands = [];
    this.path = [];
    return this;
  }

  fillRect(x: number, y: number, w: number, h: number, radius?: number): this {
    this.commands.push({
      k: "quad",
      x,
      y,
      w,
      h,
      background: toColor(this.fillStyle),
      ...(radius === undefined ? {} : { radius }),
    });
    return this;
  }

  strokeRect(x: number, y: number, w: number, h: number, radius?: number): this {
    this.commands.push({
      k: "quad",
      x,
      y,
      w,
      h,
      border_width: this.lineWidth,
      border_color: toColor(this.strokeStyle),
      ...(radius === undefined ? {} : { radius }),
    });
    return this;
  }

  beginPath(): this {
    this.path = [];
    return this;
  }

  moveTo(x: number, y: number): this {
    this.path = [{ x, y }];
    return this;
  }

  lineTo(x: number, y: number): this {
    this.path.push({ x, y });
    return this;
  }

  /** A quadratic curve. gpui's paths are quadratic; cubics are not available. */
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): this {
    this.path.push({ x, y, cx, cy });
    return this;
  }

  closePath(): this {
    const first = this.path[0];
    if (first) this.path.push({ x: first.x, y: first.y });
    return this;
  }

  /** Fills the current path. It is closed for you, as gpui fills a region. */
  fill(): this {
    if (this.path.length > 2) {
      this.commands.push({ k: "path", points: [...this.path], color: toColor(this.fillStyle) });
    }
    return this;
  }

  /**
   * Strokes the current path.
   *
   * gpui fills paths and cannot stroke them, so each segment is turned into the
   * quadrilateral that covers it — a butt-jointed stroke. Curves are flattened
   * first, which is why a stroked curve costs more than a filled one.
   */
  stroke(): this {
    const color = toColor(this.strokeStyle);
    const half = this.lineWidth / 2;
    const points = this.flatten();
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!;
      const to = points[index]!;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      const nx = (-dy / length) * half;
      const ny = (dx / length) * half;
      this.commands.push({
        k: "path",
        points: [
          { x: from.x + nx, y: from.y + ny },
          { x: to.x + nx, y: to.y + ny },
          { x: to.x - nx, y: to.y - ny },
          { x: from.x - nx, y: from.y - ny },
          { x: from.x + nx, y: from.y + ny },
        ],
        color,
      });
    }
    return this;
  }

  /** Draws one line of text, positioned by its top-left corner. */
  fillText(text: string, x: number, y: number): this {
    this.commands.push({
      k: "text",
      x,
      y,
      text,
      color: toColor(this.fillStyle),
      ...(this.fontSize === undefined ? {} : { font_size: this.fontSize }),
    });
    return this;
  }

  /** The recording, as it will be sent. */
  toJSON(): DrawCommand[] {
    return this.commands;
  }

  /** The current path with its curves reduced to straight segments. */
  private flatten(): Vertex[] {
    const flat: Vertex[] = [];
    for (const vertex of this.path) {
      const previous = flat[flat.length - 1];
      if (previous && vertex.cx !== undefined && vertex.cy !== undefined) {
        for (let step = 1; step <= CURVE_STEPS; step += 1) {
          const t = step / CURVE_STEPS;
          const ax = lerp(previous.x, vertex.cx, t);
          const ay = lerp(previous.y, vertex.cy, t);
          const bx = lerp(vertex.cx, vertex.x, t);
          const by = lerp(vertex.cy, vertex.y, t);
          flat.push({ x: lerp(ax, bx, t), y: lerp(ay, by, t) });
        }
      } else {
        flat.push({ x: vertex.x, y: vertex.y });
      }
    }
    return flat;
  }
}

/** What a `draw` function is handed. */
export type Draw = (context: CanvasContext) => void;
