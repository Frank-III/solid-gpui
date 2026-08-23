/**
 * The shadow tree.
 *
 * Solid's universal renderer needs a mutable tree it can walk and reorder
 * synchronously. Keeping that tree in JavaScript — rather than round-tripping
 * every `getFirstChild` to the host — means the host only ever receives a
 * stream of already-reconciled mutations.
 */

export const ELEMENT = 0;
export const TEXT = 1;

export interface GpuiNode {
  readonly id: number;
  readonly kind: typeof ELEMENT | typeof TEXT;
  /** Element tag; empty for text nodes. */
  readonly tag: string;
  /** Text content; empty for elements. */
  text: string;
  parent: GpuiNode | null;
  children: GpuiNode[];
  /** Last value sent for each property, used to skip redundant traffic. */
  props: Map<string, unknown>;
  /** Event listeners, keyed by protocol event name (`click`, `keyDown`, ...). */
  handlers: Map<string, (event: never) => void>;
}

let nextId = 1;

export function createNode(kind: typeof ELEMENT | typeof TEXT, tag: string, text: string): GpuiNode {
  return {
    id: nextId++,
    kind,
    tag,
    text,
    parent: null,
    children: [],
    props: new Map(),
    handlers: new Map(),
  };
}

export function isText(node: GpuiNode): boolean {
  return node.kind === TEXT;
}

/**
 * Links `child` into `parent` before `anchor`, or at the end when `anchor` is
 * absent. A node already in the tree is unlinked first, which is what makes
 * plain `insertNode` calls double as moves.
 */
export function linkNode(parent: GpuiNode, child: GpuiNode, anchor?: GpuiNode): void {
  if (child.parent) unlinkNode(child.parent, child);
  const index = anchor ? parent.children.indexOf(anchor) : -1;
  if (index >= 0) parent.children.splice(index, 0, child);
  else parent.children.push(child);
  child.parent = parent;
}

export function unlinkNode(parent: GpuiNode, child: GpuiNode): void {
  const index = parent.children.indexOf(child);
  if (index >= 0) parent.children.splice(index, 1);
  if (child.parent === parent) child.parent = null;
}
