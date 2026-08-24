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
import type { AnimationSpec, GpuiStyle } from "./style.js";
import type {
  ClickEvent,
  DragStartEvent,
  DropEvent,
  HoverEvent,
  InputEvent,
  KeyEvent,
  MouseButtonEvent,
  MouseEvent,
  MousePressureEvent,
  PinchEvent,
  RangeEvent,
  ScrollEvent,
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
  /** Style merged in while the named ancestor group is pressed. */
  groupActiveStyle?: GpuiStyle;
  /** Style merged in while a drag is held over the element. */
  dragOverStyle?: GpuiStyle;
  /** Names this element as a group other elements can react to. */
  group?: string;
  /** Marks the element as a group member reacting to the named group. */
  groupOf?: string;
  /** Tooltip content: plain text, or any element. */
  tooltip?: string | GpuiChild;
  /** Stops the mouse reaching anything painted underneath. */
  occlude?: boolean;
  /** Runs a style-to-style animation; the host interpolates it. */
  animate?: AnimationSpec;

  /** Makes the element focusable and scopes its key events to when it has focus. */
  focusable?: boolean;
  /** Focusable, and placed in the tab order at this index. */
  tabIndex?: number;
  /** Takes focus once, when the element first appears. */
  autofocus?: boolean;

  /** Payload carried by a drag started on this element. */
  dragData?: unknown;

  /** Scroll offset to apply, for an element with `overflow: "scroll"`. */
  scrollTop?: number;
  scrollLeft?: number;

  onClick?: (event: ClickEvent) => void;
  onAuxClick?: (event: ClickEvent) => void;
  onMouseDown?: (event: MouseButtonEvent) => void;
  onMouseUp?: (event: MouseButtonEvent) => void;
  onMouseMove?: (event: MouseEvent) => void;
  onMouseExit?: (event: MouseEvent) => void;
  onMousePressure?: (event: MousePressureEvent) => void;
  onPinch?: (event: PinchEvent) => void;
  onScrollWheel?: (event: ScrollWheelEvent) => void;
  onHover?: (hovered: HoverEvent) => void;
  onScroll?: (event: ScrollEvent) => void;
  onDragStart?: (event: DragStartEvent) => void;
  onDrop?: (event: DropEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;

  /**
   * Key events reach a focusable element only while it holds focus. On an
   * element that is not focusable they fall back to the window, where every
   * such listener hears every keystroke.
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

export type AnchorPoint =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top-center"
  | "bottom-center"
  | "left-center"
  | "right-center";

export interface AnchoredProps extends ElementProps {
  /** Which corner of the content sits at the anchor point. */
  anchor?: AnchorPoint;
  /** Window coordinates to anchor to. Defaults to where the element lands. */
  position?: { x: number; y: number };
  /** Shifts the content after anchoring. */
  offset?: { x: number; y: number };
  /** Keeps the content inside the window instead of flipping the anchor. */
  snapToWindow?: boolean;
  /** Margin kept from the window edge when snapping. */
  snapMargin?: number;
}

export interface DeferredProps extends ElementProps {
  /** Higher priorities paint later, over lower ones. */
  priority?: number;
}

export interface InputProps extends Omit<ElementProps, "children"> {
  /** The text to show. The host owns the buffer and echoes edits back. */
  value?: string;
  /** Shown, dimmed, while the value is empty. */
  placeholder?: string;
  /** Fires on every edit. */
  onInput?: (event: InputEvent) => void;
  /** Fires when the element loses focus after an edit. */
  onChange?: (event: InputEvent) => void;
}

export interface UniformListProps extends ElementProps {
  /** Total number of rows, including the ones not rendered. */
  count: number;
  /** Absolute index of the first child. */
  start?: number;
  /** Asks for the rows the viewport needs; render them and update `start`. */
  onRange?: (event: RangeEvent) => void;
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
    /** A floating layer, for popovers, dropdowns and context menus. */
    anchored: AnchoredProps;
    /** Paints its child after its siblings, above them. */
    deferred: DeferredProps;
    /** A single-line text field whose buffer lives in the host. */
    input: InputProps;
    /** A virtualised list of equal-height rows. */
    "uniform-list": UniformListProps;
  }
}
