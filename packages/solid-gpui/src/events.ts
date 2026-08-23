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

export interface MouseEvent {
  /** Window-relative position in logical pixels. */
  position: Point;
  modifiers: Modifiers;
}

export interface MouseButtonEvent extends MouseEvent {
  button: "left" | "right" | "middle" | "navigate-back" | "navigate-forward";
  clickCount: number;
}

export interface ClickEvent extends MouseEvent {
  button: "left" | "right" | "middle" | "navigate-back" | "navigate-forward";
  clickCount: number;
  /** Where the press that started this click landed. */
  down: Point;
}

export interface ScrollWheelEvent extends MouseEvent {
  delta: Point;
  /** `"lines"` for discrete wheels, `"pixels"` for trackpads. */
  deltaUnit: "lines" | "pixels";
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

/** Fired when the pointer enters or leaves an element. */
export type HoverEvent = boolean;

export interface EventMap {
  click: ClickEvent;
  mouseDown: MouseButtonEvent;
  mouseUp: MouseButtonEvent;
  mouseMove: MouseEvent;
  mouseExit: MouseEvent;
  scrollWheel: ScrollWheelEvent;
  hover: HoverEvent;
  keyDown: KeyEvent;
  keyUp: KeyEvent;
}

export type EventName = keyof EventMap;

const EVENT_NAMES = new Set<string>([
  "click",
  "mouseDown",
  "mouseUp",
  "mouseMove",
  "mouseExit",
  "scrollWheel",
  "hover",
  "keyDown",
  "keyUp",
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
