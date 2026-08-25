/**
 * solid-gpui — a SolidJS universal renderer for Zed's gpui.
 *
 * Solid's reactive graph runs in Node; a companion Rust process owns the gpui
 * window and the platform event loop. This module is both the public API and
 * the runtime the JSX transform compiles against, so it re-exports the
 * renderer primitives under the names `@dom-expressions/compiler` emits when it
 * is configured with `generate: "universal"` and `moduleName: "solid-gpui"`.
 */

import { createRoot, createRenderEffect, createSignal, flush } from "solid-js";
import { createRootNode, renderTree, createComponent, createElement, spread } from "./renderer.js";
import { session, type SessionOptions } from "./session.js";
import type { GpuiNode } from "./node.js";
import type { GpuiChild } from "./jsx-runtime.js";
import type { WindowOptions } from "./protocol.js";

export {
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
} from "./renderer.js";

// Control-flow components the JSX transform imports from this module by name.
export { For, Show, Switch, Match, Repeat, Reveal, Loading, Errored } from "solid-js";

export { session, Session } from "./session.js";
export type { SessionOptions } from "./session.js";
export { Transport, resolveHostPath } from "./transport.js";
export type { TransportOptions, HostConnection } from "./transport.js";
export type { GpuiNode } from "./node.js";
export type { ClipboardEntry, PathPromptOptions, WindowOptions, Modifiers } from "./protocol.js";
export type {
  ElementProps,
  ImageProps,
  SvgProps,
  AnchoredProps,
  AnchorPoint,
  DeferredProps,
  InputProps,
  UniformListProps,
  CodeHighlight,
  CodeSurfaceProps,
  GpuiChild,
  GpuiChildArray,
  GpuiRenderedElement,
  JSX,
} from "./jsx-runtime.js";
export * from "./events.js";
export { Op } from "./protocol.js";
export type { Operation } from "./protocol.js";
export { hsla, rgb, rgba, toColor } from "./color.js";
export type { ColorInput, Hsla } from "./color.js";
export { auto, px, relative, rems, toLength } from "./length.js";
export type { LengthInput } from "./length.js";
export { appWindow, dialog, shell } from "./commands.js";
export type {
  MessageLevel,
  MessageOptions,
  OpenFileOptions,
  SaveFileOptions,
} from "./commands.js";
export { CanvasContext } from "./canvas.js";
export type { Draw, DrawCommand, Vertex } from "./canvas.js";
export { normalizeStyle, normalizeAnimation } from "./style.js";
export type { GpuiStyle, ShadowInput, Cursor, AnimationSpec, Easing } from "./style.js";

/** Opens the host platform's native file/folder picker. */
export const promptForPaths = (options: import("./protocol.js").PathPromptOptions = {}) => session.promptForPaths(options);

/** Reads text, file paths, and images from the host platform clipboard. */
export const readClipboard = () => session.readClipboard();

export interface RenderOptions extends Omit<SessionOptions, "window">, WindowOptions {}

/** Tears down the reactive root and closes the window. */
export type Dispose = () => void;

/**
 * Opens a window and renders `code` into it.
 *
 * Resolves once the host reports the window is up and the first frame's
 * operations have been sent. The returned function disposes the reactive root
 * and asks the host to quit.
 */
export async function render(
  code: () => GpuiChild,
  options: RenderOptions = {},
): Promise<Dispose> {
  const {
    title,
    width,
    height,
    x,
    y,
    titlebar,
    fullscreen,
    resizable,
    appearance,
    activate,
    ...sessionOptions
  } = options;

  assertClientBuild();

  const window: WindowOptions = {};
  if (title !== undefined) window.title = title;
  if (width !== undefined) window.width = width;
  if (height !== undefined) window.height = height;
  if (x !== undefined) window.x = x;
  if (y !== undefined) window.y = y;
  if (titlebar !== undefined) window.titlebar = titlebar;
  if (fullscreen !== undefined) window.fullscreen = fullscreen;
  if (resizable !== undefined) window.resizable = resizable;
  if (appearance !== undefined) window.appearance = appearance;
  if (activate !== undefined) window.activate = activate;

  const root = createRootNode();
  await session.start({ ...sessionOptions, window });

  const disposeTree = renderTree(code as () => GpuiNode, root);
  session.flush();

  // Closing the window should end the process the same way closing a browser
  // tab ends a web app, unless the caller said otherwise.
  if (!options.onClose) session.onClose(() => process.exit(0));

  return () => {
    disposeTree();
    session.stop();
  };
}

/**
 * Node resolves `solid-js` to its server build, whose effects never re-run, so
 * an application that forgets to opt into the client build renders once and
 * then goes silent. Catching that here turns a baffling symptom into a message.
 */
function assertClientBuild(): void {
  const [probe, setProbe] = createSignal(0);
  let observed = -1;
  const dispose = createRoot((disposeRoot) => {
    createRenderEffect(
      () => probe(),
      (value) => {
        observed = value;
      },
    );
    return disposeRoot;
  });
  flush();
  setProbe(1);
  flush();
  dispose();
  if (observed !== 1) {
    throw new Error(
      "solid-gpui: solid-js resolved to its server build, so nothing will ever " +
        "update. Bundle the application with the `browser` export condition " +
        '(Vite: the `solid-gpui/vite` plugin sets it) or run Node with ' +
        "`--conditions=browser`.",
    );
  }
}

export interface DynamicProps {
  /** A component function, or the tag name of an intrinsic element. */
  component: string | ((props: Record<string, unknown>) => GpuiNode);
  [key: string]: unknown;
}

/**
 * Renders whichever component or tag `component` currently names. Solid's core
 * package has no universal `Dynamic`, so it lives here alongside the renderer
 * it needs.
 */
export function Dynamic(props: DynamicProps): unknown {
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === "component") continue;
    Object.defineProperty(rest, key, {
      get: () => props[key],
      enumerable: true,
      configurable: true,
    });
  }
  return () => {
    const component = props.component;
    if (typeof component === "function") return createComponent(component, rest);
    const element = createElement(component);
    spread(element, rest);
    return element;
  };
}
