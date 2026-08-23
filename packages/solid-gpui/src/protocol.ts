/**
 * Wire protocol between the JavaScript side (which owns Solid's reactive graph
 * and the shadow tree) and the Rust host process (which owns gpui, the window,
 * and the platform event loop).
 *
 * Both directions are newline-delimited JSON. Every line sent by JavaScript is
 * an array of operations that must be applied atomically before the host
 * repaints; every line sent by the host is a single event object.
 */

/** Operation codes sent from JavaScript to the host. */
export const Op = {
  /** `[CreateElement, id, tag, props]` */
  CreateElement: 0,
  /** `[CreateText, id, text]` */
  CreateText: 1,
  /** `[SetText, id, text]` */
  SetText: 2,
  /** `[SetProp, id, key, value]` — a `null` value removes the property. */
  SetProp: 3,
  /** `[Insert, parentId, childId, anchorId]` — anchor `0` appends. */
  Insert: 4,
  /** `[Remove, parentId, childId]` */
  Remove: 5,
  /** `[SetRoot, id]` — makes `id` the root of the window's element tree. */
  SetRoot: 6,
  /** `[OpenWindow, options]` */
  OpenWindow: 7,
  /** `[Quit]` — asks the host to close the window and exit. */
  Quit: 8,
  /** `[Drop, id]` — the node is unreachable and its host state can be freed. */
  Drop: 9,
} as const;

export type OpCode = (typeof Op)[keyof typeof Op];

export type Operation =
  | [typeof Op.CreateElement, number, string, Record<string, unknown>]
  | [typeof Op.CreateText, number, string]
  | [typeof Op.SetText, number, string]
  | [typeof Op.SetProp, number, string, unknown]
  | [typeof Op.Insert, number, number, number]
  | [typeof Op.Remove, number, number]
  | [typeof Op.SetRoot, number]
  | [typeof Op.OpenWindow, WindowOptions]
  | [typeof Op.Quit]
  | [typeof Op.Drop, number];

/** Options accepted when opening the gpui window. */
export interface WindowOptions {
  title?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  /** Hides the platform title bar and lets the tree paint its own. */
  titlebar?: boolean;
  /** Starts the window full screen. */
  fullscreen?: boolean;
  /** Allows the user to resize the window. Defaults to `true`. */
  resizable?: boolean;
  /** Background appearance: `"opaque"`, `"transparent"`, or `"blurred"`. */
  appearance?: "opaque" | "transparent" | "blurred";
  /** Focuses and raises the application once the window is up. */
  activate?: boolean;
}

/** Modifier key state carried by mouse and keyboard events. */
export interface Modifiers {
  control: boolean;
  alt: boolean;
  shift: boolean;
  platform: boolean;
  function: boolean;
}

export interface HostEventMessage {
  t: "e";
  /** Node id the listener was registered on. */
  id: number;
  /** Listener name without the `on` prefix, lower camel case: `click`, `keyDown`. */
  n: string;
  /** Event payload; shape depends on `n`. */
  d: Record<string, unknown>;
}

export type HostMessage =
  | { t: "ready" }
  | HostEventMessage
  | { t: "closed" }
  | { t: "log"; m: string }
  | { t: "error"; m: string };
