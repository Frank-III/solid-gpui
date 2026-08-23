#!/usr/bin/env node
/**
 * A host that speaks the protocol but draws nothing.
 *
 * It applies the same operations the Rust host would, then prints the resulting
 * tree to stderr, which makes it possible to develop and test an application —
 * or the renderer itself — without a Rust toolchain. Point `SOLID_GPUI_HOST` at
 * this file to use it. `SOLID_GPUI_MOCK_DUMP=1` and `SOLID_GPUI_MOCK_CLICK=7`
 * are equivalent to the flags below, for cases where passing arguments to the
 * host is inconvenient.
 *
 * It can also inject events: `--click <nodeId>` clicks that node once, the
 * first time the node appears with a click listener, and `--dump` prints the
 * tree after every batch.
 */

import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const dump = args.includes("--dump") || process.env.SOLID_GPUI_MOCK_DUMP === "1";
const clickTargets = [
  ...args.flatMap((arg, index) => (arg === "--click" ? [Number(args[index + 1])] : [])),
  ...(process.env.SOLID_GPUI_MOCK_CLICK ?? "")
    .split(",")
    .filter(Boolean)
    .map(Number),
].filter((id) => Number.isFinite(id));
const exitAfter = args.includes("--exit-after-first-batch");

const nodes = new Map();
let root = null;

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function apply(op) {
  const [code] = op;
  switch (code) {
    case 0:
      nodes.set(op[1], { id: op[1], tag: op[2], props: op[3] ?? {}, children: [], text: null });
      break;
    case 1:
      nodes.set(op[1], { id: op[1], tag: "#text", props: {}, children: [], text: op[2] });
      break;
    case 2: {
      const node = nodes.get(op[1]);
      if (node) node.text = op[2];
      break;
    }
    case 3: {
      const node = nodes.get(op[1]);
      if (!node) break;
      if (op[3] === null) delete node.props[op[2]];
      else node.props[op[2]] = op[3];
      break;
    }
    case 4: {
      const parent = nodes.get(op[1]);
      const child = nodes.get(op[2]);
      if (!parent || !child) break;
      for (const other of nodes.values()) {
        const at = other.children.indexOf(child.id);
        if (at >= 0) other.children.splice(at, 1);
      }
      const index = op[3] ? parent.children.indexOf(op[3]) : -1;
      if (index >= 0) parent.children.splice(index, 0, child.id);
      else parent.children.push(child.id);
      break;
    }
    case 5: {
      const parent = nodes.get(op[1]);
      if (!parent) break;
      const at = parent.children.indexOf(op[2]);
      if (at >= 0) parent.children.splice(at, 1);
      break;
    }
    case 6:
      root = op[1];
      break;
    case 7:
      send({ t: "ready" });
      break;
    case 8:
      process.exit(0);
      break;
    case 9:
      nodes.delete(op[1]);
      break;
    default:
      send({ t: "error", m: `unknown opcode ${code}` });
  }
}

function print(id, depth = 0) {
  const node = nodes.get(id);
  if (!node) return;
  const pad = "  ".repeat(depth);
  if (node.tag === "#text") {
    if (node.text !== "") process.stderr.write(`${pad}"${node.text}"\n`);
    return;
  }
  const listeners = Object.keys(node.props)
    .filter((key) => key.startsWith("@"))
    .join(" ");
  process.stderr.write(`${pad}<${node.tag} #${node.id}>${listeners ? ` ${listeners}` : ""}\n`);
  for (const child of node.children) print(child, depth + 1);
}

let batches = 0;
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let ops;
  try {
    ops = JSON.parse(line);
  } catch (error) {
    send({ t: "error", m: `unparsable batch: ${String(error)}` });
    return;
  }
  for (const op of ops) apply(op);
  batches += 1;

  if (dump && root !== null) {
    process.stderr.write(`--- batch ${batches} ---\n`);
    print(root);
  }

  for (const id of clickTargets.splice(0)) {
    if (!nodes.get(id)?.props["@click"]) {
      clickTargets.push(id);
      continue;
    }
    process.stderr.write(`--- clicking #${id} ---\n`);
    send({
      t: "e",
      id,
      n: "click",
      d: {
        position: { x: 0, y: 0 },
        down: { x: 0, y: 0 },
        button: "left",
        clickCount: 1,
        modifiers: { control: false, alt: false, shift: false, platform: false, function: false },
      },
    });
  }

  if (exitAfter) process.exit(0);
});

process.stdin.on("close", () => process.exit(0));
