/**
 * The session ties the shadow tree to a running host process: it batches
 * mutations, ships them as one line per flush, routes incoming events back to
 * the listener that asked for them, and frees host-side state for nodes that
 * Solid has discarded.
 */

import { flush as flushSolid } from "solid-js";
import { Op, type HostMessage, type Operation, type WindowOptions } from "./protocol.js";
import { Transport, type HostConnection, type TransportOptions } from "./transport.js";
import type { GpuiNode } from "./node.js";

export interface SessionOptions extends TransportOptions {
  window?: WindowOptions;
  /** Called after the window is closed by the user. Defaults to exiting. */
  onClose?: () => void;
  /**
   * Supplies the host connection. Defaults to spawning the host binary; tests
   * pass a fake so the renderer can be exercised without a window.
   */
  connect?: (options: TransportOptions) => HostConnection;
}

export class Session {
  #operations: Operation[] = [];
  #nodes = new Map<number, GpuiNode>();
  #orphans = new Set<GpuiNode>();
  #transport: HostConnection | null = null;
  #scheduled = false;
  #closeListeners = new Set<() => void>();

  get running(): boolean {
    return this.#transport !== null;
  }

  /**
   * Launches the host and resolves once it reports the window is up. Mutations
   * recorded before this point are buffered and sent with the first flush, so
   * a tree may be built before the window exists.
   */
  async start(options: SessionOptions = {}): Promise<void> {
    if (this.#transport) throw new Error("solid-gpui: a session is already running");
    const transport = (options.connect ?? ((given) => new Transport(given)))(options);
    this.#transport = transport;

    const ready = new Promise<void>((resolvePromise, rejectPromise) => {
      const off = transport.onMessage((message) => {
        if (message.t === "ready") {
          off();
          resolvePromise();
        } else if (message.t === "error") {
          off();
          rejectPromise(new Error(`solid-gpui: host failed to start: ${message.m}`));
        }
      });
      transport.onExit((code) => rejectPromise(new Error(`solid-gpui: host exited with code ${code}`)));
    });

    transport.onMessage((message) => this.#receive(message));
    transport.onExit(() => {
      this.#transport = null;
      for (const listener of this.#closeListeners) listener();
    });
    if (options.onClose) this.#closeListeners.add(options.onClose);

    transport.send([[Op.OpenWindow, options.window ?? {}]]);
    await ready;
    this.flush();
  }

  onClose(listener: () => void): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  #receive(message: HostMessage): void {
    switch (message.t) {
      case "e": {
        const node = this.#nodes.get(message.id);
        const handler = node?.handlers.get(message.n);
        if (!handler) return;
        (handler as (payload: unknown) => void)(message.d["value"] ?? message.d);
        // Event handlers write signals; run Solid's effects now so the
        // resulting mutations travel back in a single batch.
        flushSolid();
        this.flush();
        return;
      }
      case "log":
        process.stderr.write(`solid-gpui host: ${message.m}\n`);
        return;
      case "error":
        process.stderr.write(`solid-gpui host error: ${message.m}\n`);
        return;
      case "closed":
        for (const listener of this.#closeListeners) listener();
        return;
      default:
        return;
    }
  }

  register(node: GpuiNode): void {
    this.#nodes.set(node.id, node);
  }

  markAttached(node: GpuiNode): void {
    this.#orphans.delete(node);
  }

  markDetached(node: GpuiNode): void {
    this.#orphans.add(node);
  }

  push(operation: Operation): void {
    this.#operations.push(operation);
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.flush();
    });
  }

  /** Emits `Drop` for every node still detached at the end of a batch. */
  #collect(): void {
    if (this.#orphans.size === 0) return;
    const orphans = [...this.#orphans];
    this.#orphans.clear();
    for (const node of orphans) {
      if (node.parent) continue;
      const stack: GpuiNode[] = [node];
      while (stack.length > 0) {
        const current = stack.pop()!;
        this.#nodes.delete(current.id);
        this.#operations.push([Op.Drop, current.id]);
        for (const child of current.children) stack.push(child);
      }
    }
  }

  flush(): void {
    // Before the host is up, mutations stay queued: draining them here would
    // throw away the tree that was built while the window was opening.
    if (!this.#transport) return;
    this.#collect();
    if (this.#operations.length === 0) return;
    const batch = this.#operations;
    this.#operations = [];
    this.#transport?.send(batch);
  }

  stop(): void {
    this.push([Op.Quit]);
    this.flush();
    this.#transport?.close();
  }
}

/**
 * The renderer is created once at module scope, so the session it writes into
 * has to be a module-level singleton too.
 */
export const session = new Session();
