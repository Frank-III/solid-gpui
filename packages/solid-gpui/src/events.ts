/**
 * Event payloads delivered from the host.
 *
 * Listeners are declared with `on`-prefixed props; the prefix is stripped and
 * the first letter lower-cased to produce the protocol name, so `onKeyDown`
 * becomes `keyDown` on the wire and in the host's dispatch table.
 */

import type { Modifiers } from "./protocol.js";

export type { Modifiers };

export interface Point {
  x: number;
  y: number;
}

export type MouseButtonName =
  | "left"
  | "right"
  | "middle"
  | "navigate-back"
  | "navigate-forward";

export interface MouseEvent {
  /** Window-relative position in logical pixels. */
  position: Point;
  modifiers: Modifiers;
}

export interface MouseButtonEvent extends MouseEvent {
  button: MouseButtonName;
  clickCount: number;
}

export interface ClickEvent extends MouseEvent {
  button: MouseButtonName;
  clickCount: number;
  /** Where the press that started this click landed. */
  down: Point;
}

export interface ScrollWheelEvent extends MouseEvent {
  delta: Point;
  /** `"lines"` for discrete wheels, `"pixels"` for trackpads. */
  deltaUnit: "lines" | "pixels";
}

/** Trackpad force-click pressure, macOS only. */
export interface MousePressureEvent extends MouseEvent {
  /** 0..1 while pressing, beyond 1 for a force click. */
  pressure: number;
  stage: "zero" | "normal" | "force";
}

/** Trackpad pinch, reported as a scale delta. */
export interface PinchEvent extends MouseEvent {
  delta: number;
  phase: "started" | "moved" | "ended";
}

export interface KeyEvent {
  /** The keystroke in gpui notation, for example `cmd-shift-p`. */
  keystroke: string;
  /** The bare key, for example `p`, `enter`, `escape`. */
  key: string;
  /** Text the keystroke would insert, when it produces any. */
  text: string | null;
  modifiers: Modifiers;
  repeat: boolean;
}

/** The scroll offset of an element that tracks its own scrolling. */
export interface ScrollEvent {
  offset: Point;
  maxOffset: Point;
}

/** Emitted when a drag that started in this window is released on an element. */
export interface DropEvent {
  /** Whatever `dragData` the source element carried. */
  data: unknown;
  /** Node id of the element the drag started from. */
  source: number;
  position: Point;
}

export interface DragStartEvent {
  data: unknown;
  position: Point;
}

/** Text typed into an `<input>`; the host owns the buffer. */
export interface InputEvent {
  value: string;
  /** Cursor and selection offsets, in UTF-16 code units. */
  selectionStart: number;
  selectionEnd: number;
}

/** The rows a `<uniform-list>` needs rendered. */
export interface RangeEvent {
  start: number;
  end: number;
}

/** The size of a `<canvas>`, once the host has laid it out. */
export interface ResizeEvent {
  width: number;
  height: number;
}

/** Fired when the pointer enters or leaves an element. */
export type HoverEvent = boolean;

export interface EventMap {
  click: ClickEvent;
  auxClick: ClickEvent;
  mouseDown: MouseButtonEvent;
  mouseUp: MouseButtonEvent;
  mouseMove: MouseEvent;
  mouseExit: MouseEvent;
  mousePressure: MousePressureEvent;
  pinch: PinchEvent;
  scrollWheel: ScrollWheelEvent;
  hover: HoverEvent;
  keyDown: KeyEvent;
  keyUp: KeyEvent;
  focus: null;
  blur: null;
  scroll: ScrollEvent;
  drop: DropEvent;
  dragStart: DragStartEvent;
  input: InputEvent;
  change: InputEvent;
  range: RangeEvent;
  resize: ResizeEvent;
}

export type EventName = keyof EventMap;

const EVENT_NAMES = new Set<string>([
  "click",
  "auxClick",
  "mouseDown",
  "mouseUp",
  "mouseMove",
  "mouseExit",
  "mousePressure",
  "pinch",
  "scrollWheel",
  "hover",
  "keyDown",
  "keyUp",
  "focus",
  "blur",
  "scroll",
  "drop",
  "dragStart",
  "input",
  "change",
  "range",
  "resize",
]);

/**
 * Turns a prop name into a protocol event name, or returns `null` when the prop
 * is not a listener the host knows how to attach.
 */
export function eventNameFromProp(prop: string): EventName | null {
  if (prop.length < 3 || !prop.startsWith("on") || prop[2] !== prop[2]!.toUpperCase()) return null;
  const name = prop[2]!.toLowerCase() + prop.slice(3);
  return EVENT_NAMES.has(name) ? (name as EventName) : null;
}
