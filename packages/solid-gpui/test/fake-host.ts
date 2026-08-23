/**
 * A host that records operations instead of drawing them, plus enough of a tree
 * to assert against. It is the same bookkeeping the Rust host does, which makes
 * these tests a check on the protocol as well as on the renderer.
 */

import { Op, type HostMessage, type Operation } from "../src/protocol.js";
import type { HostConnection } from "../src/transport.js";

interface HostNode {
  id: number;
  tag: string;
  text: string | null;
  props: Record<string, unknown>;
  children: number[];
}

export class HostTree {
  nodes = new Map<number, HostNode>();
  root: number | null = null;

  apply(operations: Operation[]): void {
    for (const operation of operations) {
      switch (operation[0]) {
        case Op.CreateElement:
          this.nodes.set(operation[1], {
            id: operation[1],
            tag: operation[2],
            text: null,
            props: { ...operation[3] },
            children: [],
          });
          break;
        case Op.CreateText:
          this.nodes.set(operation[1], {
            id: operation[1],
            tag: "#text",
            text: operation[2],
            props: {},
            children: [],
          });
          break;
        case Op.SetText: {
          const node = this.nodes.get(operation[1]);
          if (node) node.text = operation[2];
          break;
        }
        case Op.SetProp: {
          const node = this.nodes.get(operation[1]);
          if (!node) break;
          if (operation[3] === null) delete node.props[operation[2]];
          else node.props[operation[2]] = operation[3];
          break;
        }
        case Op.Insert: {
          const parent = this.nodes.get(operation[1]);
          if (!parent) break;
          for (const other of this.nodes.values()) {
            const at = other.children.indexOf(operation[2]);
            if (at >= 0) other.children.splice(at, 1);
          }
          const index = operation[3] ? parent.children.indexOf(operation[3]) : -1;
          if (index >= 0) parent.children.splice(index, 0, operation[2]);
          else parent.children.push(operation[2]);
          break;
        }
        case Op.Remove: {
          const parent = this.nodes.get(operation[1]);
          if (!parent) break;
          const at = parent.children.indexOf(operation[2]);
          if (at >= 0) parent.children.splice(at, 1);
          break;
        }
        case Op.SetRoot:
          this.root = operation[1];
          break;
        case Op.Drop:
          this.nodes.delete(operation[1]);
          break;
        default:
          break;
      }
    }
  }

  /** A stable, readable rendering of the tree, for assertions. */
  print(id: number | null = this.root, depth = 0): string {
    if (id === null) return "";
    const node = this.nodes.get(id);
    if (!node) return "";
    const pad = "  ".repeat(depth);
    if (node.tag === "#text") return node.text ? `${pad}"${node.text}"\n` : "";
    const listeners = Object.keys(node.props)
      .filter((key) => key.startsWith("@"))
      .sort()
      .join(" ");
    let out = `${pad}<${node.tag}>${listeners ? ` ${listeners}` : ""}\n`;
    for (const child of node.children) out += this.print(child, depth + 1);
    return out;
  }

  /** The first node whose tag matches and that carries the given listener. */
  findByListener(event: string): number | null {
    for (const node of this.nodes.values()) {
      if (node.props[`@${event}`]) return node.id;
    }
    return null;
  }

  /** Every node id currently reachable from the root. */
  reachable(): Set<number> {
    const seen = new Set<number>();
    const stack = this.root === null ? [] : [this.root];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const child of this.nodes.get(id)?.children ?? []) stack.push(child);
    }
    return seen;
  }
}

export class FakeHost implements HostConnection {
  readonly batches: Operation[][] = [];
  readonly tree = new HostTree();
  #messageListeners = new Set<(message: HostMessage) => void>();
  #exitListeners = new Set<(code: number | null) => void>();

  onMessage(listener: (message: HostMessage) => void): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onExit(listener: (code: number | null) => void): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  send(operations: Operation[]): void {
    this.batches.push(operations);
    this.tree.apply(operations);
  }

  close(): void {
    for (const listener of [...this.#exitListeners]) listener(0);
  }

  emit(message: HostMessage): void {
    for (const listener of [...this.#messageListeners]) listener(message);
  }

  ready(): void {
    this.emit({ t: "ready" });
  }

  event(id: number, name: string, payload: Record<string, unknown> = {}): void {
    this.emit({ t: "e", id, n: name, d: payload });
  }

  get operations(): Operation[] {
    return this.batches.flat();
  }
}

/**
 * Hands `render` a fake host and answers its `OpenWindow` with `ready`, which is
 * what the real host does once the window is up.
 */
export function connectFake(host: FakeHost) {
  return () => {
    queueMicrotask(() => host.ready());
    return host;
  };
}
