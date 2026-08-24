/**
 * The Solid universal renderer.
 *
 * `createRenderer` is called once at module scope because the JSX transform
 * imports the returned functions by name from this package. Every callback here
 * mutates the local shadow tree first and then records the equivalent operation
 * on the session, which is what eventually reaches the host.
 */

import { createRenderer } from "@solidjs/universal";
import { createRenderEffect, createSignal } from "solid-js";
import {
  ELEMENT,
  TEXT,
  createNode,
  isNode,
  isText,
  linkNode,
  unlinkNode,
  type GpuiNode,
} from "./node.js";
import { session } from "./session.js";
import { Op } from "./protocol.js";
import { eventNameFromProp } from "./events.js";
import {
  normalizeAnimation,
  normalizeStyle,
  type AnimationSpec,
  type GpuiStyle,
} from "./style.js";
import { CanvasContext, type Draw } from "./canvas.js";

const STYLE_PROPS = new Set([
  "style",
  "hoverStyle",
  "activeStyle",
  "groupHoverStyle",
  "groupActiveStyle",
  "dragOverStyle",
  "thumbStyle",
]);

/** The draw function currently set on each `<canvas>`. */
const CANVASES = new WeakMap<GpuiNode, (draw: Draw | null) => void>();

/**
 * Wires a `<canvas>`'s `draw` function up to an effect.
 *
 * The drawing is recorded rather than performed, so it can simply be re-run
 * whenever something it read changes — that is what makes a canvas reactive
 * without any explicit invalidation. The element's size is one of those things:
 * it is only known once the host has laid the element out, so it arrives as an
 * event and feeds the same effect.
 */
function attachCanvas(node: GpuiNode, value: unknown): void {
  const draw = typeof value === "function" ? (value as Draw) : null;
  const update = CANVASES.get(node);
  if (update) {
    update(draw);
    return;
  }

  // Boxed, because a signal holding a bare function would take it for the
  // computation that produces the value.
  const [currentDraw, setDraw] = createSignal<{ draw: Draw | null }>({ draw });
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  CANVASES.set(node, (next) => setDraw({ draw: next }));

  node.handlers.set("resize", (event: { width: number; height: number }) => setSize(event));
  node.props.set("@resize", true);
  session.push([Op.SetProp, node.id, "@resize", true]);

  createRenderEffect(
    () => {
      const { draw } = currentDraw();
      const { width, height } = size();
      if (!draw) return null;
      const context = new CanvasContext(width, height);
      draw(context);
      return context.toJSON();
    },
    (commands) => {
      if (!commands) return;
      node.props.set("commands", commands);
      session.push([Op.SetProp, node.id, "commands", commands]);
    },
  );
}

function wireValue(node: GpuiNode, name: string, value: unknown): unknown {
  const eventName = eventNameFromProp(name);
  if (eventName) {
    if (typeof value === "function") {
      node.handlers.set(eventName, value as (event: never) => void);
      return true;
    }
    node.handlers.delete(eventName);
    return null;
  }
  if (STYLE_PROPS.has(name)) return normalizeStyle(value as GpuiStyle | null | undefined);
  if (name === "animate") return normalizeAnimation(value as AnimationSpec | null | undefined);
  // A prop can hold an element — a tooltip written as JSX. It never joins the
  // tree, so it is referenced by id and pinned so the collector leaves it alone.
  if (isNode(value)) {
    session.markAttached(value);
    return { __node: value.id };
  }
  return value === undefined ? null : value;
}

/** Protocol property name for a prop: listeners lose their `on` prefix. */
function wireName(name: string): string {
  const eventName = eventNameFromProp(name);
  return eventName ? `@${eventName}` : name;
}

function setProperty(node: GpuiNode, name: string, value: unknown, prev?: unknown): void {
  if (name === "children" || name === "ref") return;
  // A draw function is not a property: it is recorded, and the recording is what
  // travels.
  if (name === "draw") {
    attachCanvas(node, value);
    return;
  }
  // An element-valued prop that is being replaced loses its pin, so the node it
  // pointed at can be collected with everything else.
  if (isNode(prev) && prev !== value) session.markDetached(prev);
  const key = wireName(name);
  const next = wireValue(node, name, value);
  const previous = node.props.get(key);
  // Listeners collapse to a boolean on the wire, so identical presence never
  // costs a message even when the closure identity changed.
  if (previous === next && (next === null || typeof next !== "object")) return;
  if (next === null) node.props.delete(key);
  else node.props.set(key, next);
  session.push([Op.SetProp, node.id, key, next]);
}

export const {
  render: renderTree,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  applyRef,
  ref,
} = createRenderer<GpuiNode>({
  createElement(tag, staticProps) {
    const node = createNode(ELEMENT, tag, "");
    session.register(node);
    const props: Record<string, unknown> = {};
    let draw: unknown;
    if (staticProps) {
      for (const name in staticProps) {
        if (name === "children" || name === "ref") continue;
        // Held back: recording pushes operations of its own, and none of them
        // may reach the host before the element they belong to exists.
        if (name === "draw") {
          draw = staticProps[name];
          continue;
        }
        const key = wireName(name);
        const value = wireValue(node, name, staticProps[name]);
        if (value === null) continue;
        props[key] = value;
        node.props.set(key, value);
      }
    }
    session.push([Op.CreateElement, node.id, tag, props]);
    if (draw !== undefined) attachCanvas(node, draw);
    return node;
  },

  createTextNode(value) {
    const text = String(value ?? "");
    const node = createNode(TEXT, "", text);
    session.register(node);
    session.push([Op.CreateText, node.id, text]);
    return node;
  },

  replaceText(node, value) {
    const text = String(value ?? "");
    if (node.text === text) return;
    node.text = text;
    session.push([Op.SetText, node.id, text]);
  },

  isTextNode: isText,

  setProperty(node, name, value, prev) {
    setProperty(node, name, value, prev);
  },

  insertNode(parent, node, anchor) {
    linkNode(parent, node, anchor);
    session.markAttached(node);
    session.push([Op.Insert, parent.id, node.id, anchor ? anchor.id : 0]);
  },

  removeNode(parent, node) {
    unlinkNode(parent, node);
    session.markDetached(node);
    session.push([Op.Remove, parent.id, node.id]);
  },

  getParentNode(node) {
    return node.parent ?? undefined;
  },

  getFirstChild(node) {
    return node.children[0];
  },

  getNextSibling(node) {
    const parent = node.parent;
    if (!parent) return undefined;
    return parent.children[parent.children.indexOf(node) + 1];
  },
});

/**
 * Creates the node that backs the window's root element.
 *
 * It is styled to fill the window rather than left bare: an auto-sized root has
 * no definite height, so a `height: "100%"` on the application's own outermost
 * element would resolve against nothing and collapse the whole tree.
 */
export function createRootNode(): GpuiNode {
  const node = createNode(ELEMENT, "div", "");
  const style = normalizeStyle({ width: "100%", height: "100%" });
  session.register(node);
  session.push([Op.CreateElement, node.id, "div", { style }]);
  node.props.set("style", style);
  session.push([Op.SetRoot, node.id]);
  return node;
}
