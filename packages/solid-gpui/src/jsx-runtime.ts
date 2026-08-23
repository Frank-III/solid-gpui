/**
 * JSX typings for the intrinsic elements the host understands.
 *
 * The `JSX` namespace is exported rather than declared globally: TypeScript
 * finds it through `"jsxImportSource": "solid-gpui"`, so a project can render
 * to gpui without the types leaking into every other file it compiles.
 *
 * There is no runtime JSX factory here. The compiler emits calls to the
 * renderer primitives directly, which is what makes Solid's compile-time
 * reconciliation possible in the first place.
 */

import type { GpuiNode } from "./node.js";
import type { GpuiStyle } from "./style.js";
import type {
  ClickEvent,
  HoverEvent,
  KeyEvent,
  MouseButtonEvent,
  MouseEvent,
  ScrollWheelEvent,
} from "./events.js";

export interface ElementProps {
  /** Base style for the element. */
  style?: GpuiStyle;
  /** Style merged in while the pointer is over the element. */
  hoverStyle?: GpuiStyle;
  /** Style merged in while the element is pressed. */
  activeStyle?: GpuiStyle;
  /** Style merged in while the named ancestor group is hovered. */
  groupHoverStyle?: GpuiStyle;
  /** Names this element as a group other elements can react to. */
  group?: string;
  /** Marks the element as a group member reacting to the named group. */
  groupOf?: string;
  /** Plain-text tooltip shown after the usual hover delay. */
  tooltip?: string;

  onClick?: (event: ClickEvent) => void;
  onMouseDown?: (event: MouseButtonEvent) => void;
  onMouseUp?: (event: MouseButtonEvent) => void;
  onMouseMove?: (event: MouseEvent) => void;
  onMouseExit?: (event: MouseEvent) => void;
  onScrollWheel?: (event: ScrollWheelEvent) => void;
  onHover?: (hovered: HoverEvent) => void;
  /**
   * Key events are delivered along gpui's focus path, which the window root
   * owns, so every element that declares this listener hears every keystroke.
   */
  onKeyDown?: (event: KeyEvent) => void;
  onKeyUp?: (event: KeyEvent) => void;

  ref?: GpuiNode | ((element: GpuiNode) => void);
  children?: GpuiChild;
}

export interface ImageProps extends ElementProps {
  /** File path or `http(s)` URL of the image to paint. */
  src: string;
}

export interface SvgProps extends ElementProps {
  /** Path to an SVG asset; it is painted using the current text colour. */
  path: string;
}

/**
 * What a component may return. This mirrors Solid's own `Element` union with
 * `GpuiNode` in the place of a DOM node, so control-flow components typecheck
 * against this renderer.
 */
export type GpuiChild =
  | GpuiRenderedElement
  | GpuiChildArray
  | (string & {})
  | number
  | boolean
  | null
  | undefined;

export interface GpuiChildArray extends Array<GpuiChild> {}

/**
 * Structurally identical to Solid's `RenderedElement`: any object that is not
 * callable. `GpuiNode` satisfies it, and so does whatever a control-flow
 * component hands back.
 */
export type GpuiRenderedElement = object & {
  readonly call?: never;
  readonly apply?: never;
  readonly bind?: never;
};

export namespace JSX {
  export type Element = GpuiChild;

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicElements {
    /** A flexbox container, the direct equivalent of gpui's `div()`. */
    div: ElementProps;
    /** A container whose children are laid out as inline text. */
    text: ElementProps;
    img: ImageProps;
    svg: SvgProps;
  }
}
