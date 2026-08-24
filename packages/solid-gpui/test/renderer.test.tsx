import { afterEach, describe, expect, it } from "vitest";
import { createSignal, flush } from "solid-js";
import { For, Show, render, type Dispose } from "solid-gpui";
import { Op } from "../src/protocol.js";
import { FakeHost, connectFake } from "./fake-host.js";

let dispose: Dispose | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

/** Lets the queued batch reach the host; the renderer flushes on a microtask. */
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

/** The element the markup created, as opposed to the window's own root. */
function created(host: FakeHost, tag: string) {
  return host.operations
    .filter((operation) => operation[0] === Op.CreateElement && operation[2] === tag)
    .at(-1);
}

/** Mounts a tree against a fake host and returns both. */
async function mount(code: () => unknown) {
  const host = new FakeHost();
  dispose = await render(code as never, {
    connect: connectFake(host),
    onClose: () => {},
    title: "test",
    width: 100,
    height: 100,
  });
  return host;
}

describe("mounting", () => {
  it("opens the window before anything else", async () => {
    const host = await mount(() => <div />);
    expect(host.batches[0]).toEqual([[Op.OpenWindow, { title: "test", width: 100, height: 100 }]]);
  });

  it("gives the window root a definite size", async () => {
    const host = await mount(() => <div />);
    const root = host.tree.root;
    expect(root).not.toBeNull();
    expect(host.tree.nodes.get(root!)?.props["style"]).toEqual({
      size: { width: { k: "pct", v: 1 }, height: { k: "pct", v: 1 } },
    });
  });

  it("builds the tree the markup describes", async () => {
    const host = await mount(() => (
      <div>
        <text>hello</text>
        <img src="logo.png" />
      </div>
    ));
    expect(host.tree.print()).toBe(
      ["<div>", "  <div>", "    <text>", '      "hello"', "    <img>", ""].join("\n"),
    );
  });

  it("sends static props with the element that has them", async () => {
    const host = await mount(() => <img src="logo.png" />);
    expect(created(host, "img")?.[3]).toEqual({ src: "logo.png" });
  });

  it("normalises styles on the wire", async () => {
    const host = await mount(() => <div style={{ paddingX: 8, color: "#ffffff" }} />);
    expect(created(host, "div")?.[3]).toMatchObject({
      style: {
        padding: { left: { k: "px", v: 8 }, right: { k: "px", v: 8 } },
        text: { color: { h: 0, s: 0, l: 1, a: 1 } },
      },
    });
  });

  it("reduces listeners to their presence", async () => {
    const host = await mount(() => <div onClick={() => {}} />);
    expect(created(host, "div")?.[3]).toEqual({ "@click": true });
  });
});

describe("reactivity", () => {
  it("updates text in place when a signal changes", async () => {
    const [count, setCount] = createSignal(0);
    const host = await mount(() => <div>{count()}</div>);
    expect(host.tree.print()).toContain('"0"');

    const before = host.batches.length;
    setCount(1);
    flush();
    await tick();
    expect(host.batches.length).toBeGreaterThan(before);
    expect(host.tree.print()).toContain('"1"');
  });

  it("dispatches an event to the listener that registered it", async () => {
    const [count, setCount] = createSignal(0);
    const host = await mount(() => (
      <div>
        <div onClick={() => setCount(count() + 1)}>press</div>
        <text>{count()}</text>
      </div>
    ));

    const target = host.tree.findByListener("click");
    expect(target).not.toBeNull();
    host.event(target!, "click");
    expect(host.tree.print()).toContain('"1"');
  });

  it("passes a bare event value straight to the listener", async () => {
    const seen: boolean[] = [];
    const host = await mount(() => <div onHover={(hovered) => seen.push(hovered)} />);
    host.event(host.tree.findByListener("hover")!, "hover", { value: true });
    expect(seen).toEqual([true]);
  });

  it("reorders a keyed list without recreating its rows", async () => {
    const [items, setItems] = createSignal(["a", "b", "c"]);
    const host = await mount(() => (
      <div>
        <For each={items()}>{(item) => <text>{item}</text>}</For>
      </div>
    ));

    const created = () =>
      host.operations.filter((operation) => operation[0] === Op.CreateText).length;
    const before = created();

    setItems(["c", "a", "b"]);
    flush();
    await tick();

    expect(host.tree.print()).toBe(
      [
        "<div>",
        "  <div>",
        "    <text>",
        '      "c"',
        "    <text>",
        '      "a"',
        "    <text>",
        '      "b"',
        "",
      ].join("\n"),
    );
    expect(created()).toBe(before);
  });
});

describe("node lifetime", () => {
  it("frees a subtree the moment it becomes unreachable", async () => {
    const [shown, setShown] = createSignal(true);
    const host = await mount(() => (
      <div>
        <Show when={shown()}>
          <div onClick={() => {}}>
            <text>inside</text>
          </div>
        </Show>
      </div>
    ));

    const removed = host.tree.findByListener("click");
    expect(removed).not.toBeNull();

    setShown(false);
    flush();
    await tick();

    const drops = host.operations.filter((operation) => operation[0] === Op.Drop);
    expect(drops.some((operation) => operation[1] === removed)).toBe(true);
    expect(host.tree.nodes.has(removed!)).toBe(false);
  });

  it("keeps every node the tree can still reach", async () => {
    const [shown, setShown] = createSignal(true);
    const host = await mount(() => (
      <div>
        <Show when={shown()}>
          <text>a</text>
        </Show>
        <text>b</text>
      </div>
    ));

    setShown(false);
    flush();
    await tick();
    setShown(true);
    flush();
    await tick();

    for (const id of host.tree.reachable()) {
      expect(host.tree.nodes.has(id)).toBe(true);
    }
  });
});

describe("newer elements", () => {
  it("keeps the tags the host dispatches on", async () => {
    const host = await mount(() => (
      <div>
        <anchored anchor="bottom-left" snapToWindow>
          <div>menu</div>
        </anchored>
        <deferred priority={2}>
          <div>above</div>
        </deferred>
        <input value="hello" placeholder="type" />
        <uniform-list count={1000} start={0} />
      </div>
    ));
    const tags = host.operations
      .filter((operation) => operation[0] === Op.CreateElement)
      .map((operation) => operation[2]);
    expect(tags).toEqual(
      expect.arrayContaining(["anchored", "deferred", "input", "uniform-list"]),
    );
  });

  it("sends the props each element is configured by", async () => {
    const host = await mount(() => (
      <div>
        <anchored anchor="top-right" offset={{ x: 4, y: 8 }} snapToWindow snapMargin={12} />
        <deferred priority={3} />
        <input value="hi" placeholder="type here" />
        <uniform-list count={500} start={40} scrollToItem={120} onRange={() => {}} />
      </div>
    ));
    expect(created(host, "anchored")?.[3]).toMatchObject({
      anchor: "top-right",
      offset: { x: 4, y: 8 },
      snapToWindow: true,
      snapMargin: 12,
    });
    expect(created(host, "deferred")?.[3]).toMatchObject({ priority: 3 });
    expect(created(host, "input")?.[3]).toMatchObject({ value: "hi", placeholder: "type here" });
    expect(created(host, "uniform-list")?.[3]).toMatchObject({
      count: 500,
      start: 40,
      scrollToItem: 120,
      "@range": true,
    });
  });

  it("sends an animation with both endpoints normalised", async () => {
    const host = await mount(() => (
      <div animate={{ duration: 300, from: { opacity: 0 }, to: { opacity: 1 }, repeat: true }} />
    ));
    expect(created(host, "div")?.[3]).toMatchObject({
      animate: {
        duration_ms: 300,
        from: { opacity: 0 },
        to: { opacity: 1 },
        repeat: true,
        easing: "ease-in-out",
      },
    });
  });

  it("references an element-valued prop by node id and keeps it alive", async () => {
    const host = await mount(() => <div tooltip={<div>rich</div>} />);
    const tooltip = created(host, "div")?.[3] as { tooltip?: { __node: number } };
    expect(tooltip.tooltip).toEqual({ __node: expect.any(Number) });
    // The referenced node never joins the tree, so only the pin keeps the
    // collector from dropping it.
    const dropped = host.operations.filter((operation) => operation[0] === Op.Drop);
    expect(dropped.some((operation) => operation[1] === tooltip.tooltip!.__node)).toBe(false);
  });

  it("passes focus and drag props through", async () => {
    const host = await mount(() => (
      <div focusable tabIndex={2} autofocus occlude dragData={{ id: 7 }} onDrop={() => {}} />
    ));
    expect(created(host, "div")?.[3]).toMatchObject({
      focusable: true,
      tabIndex: 2,
      autofocus: true,
      occlude: true,
      dragData: { id: 7 },
      "@drop": true,
    });
  });
});

describe("teardown", () => {
  it("asks the host to quit", async () => {
    const host = await mount(() => <div />);
    dispose?.();
    dispose = null;
    expect(host.operations.some((operation) => operation[0] === Op.Quit)).toBe(true);
  });
});
