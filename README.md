# solid-gpui

A [SolidJS 2.0](https://www.solidjs.com) universal renderer for [gpui](https://gpui.rs),
the GPU-accelerated UI framework behind [Zed](https://zed.dev). Write a desktop
application in JSX with Solid's fine-grained reactivity; gpui paints it.

```tsx
import { createSignal } from "solid-js";
import { render } from "solid-gpui";

function App() {
  const [count, setCount] = createSignal(0);
  return (
    <div style={{ padding: 24, gap: 12, alignItems: "center", background: "#1e1e22", color: "#eee" }}>
      <div
        style={{ paddingX: 12, paddingY: 6, borderRadius: 6, background: "#2a2a30", cursor: "pointer" }}
        hoverStyle={{ background: "#34343c" }}
        onClick={() => setCount(count() + 1)}
      >
        clicked {count()} times
      </div>
    </div>
  );
}

await render(() => <App />, { title: "Hello", width: 480, height: 240 });
```

## How it works

gpui is a Rust framework that must own the platform event loop, and on macOS
that event loop must own the main thread. Rather than embedding a JavaScript
engine or fighting Node for the main thread, `solid-gpui` splits the work across
two processes:

```
   Node / Bun                              solid-gpui-host (Rust)
┌────────────────────┐                   ┌──────────────────────┐
│ your components    │                   │  gpui window         │
│ Solid reactivity   │  ── operations ─▶ │  element tree        │
│ shadow tree        │                   │  layout + paint      │
│ event listeners    │ ◀──── events ──── │  platform event loop │
└────────────────────┘                   └──────────────────────┘
             newline-delimited JSON over stdin/stdout
```

Solid reconciles the tree in JavaScript, exactly as it would in a browser. Every
mutation the universal renderer performs is recorded as an operation, and the
whole batch ships on one line per flush. The host applies the batch to its mirror
of the tree, marks the root entity dirty, and gpui repaints. Input events travel
the other way and are dispatched to the listener that registered them, and the
resulting signal writes produce the next batch.

Because Solid does the reconciliation, the host never diffs anything. It only
applies operations and builds elements.

## Repository layout

| Path | What it is |
| --- | --- |
| [packages/solid-gpui/](packages/solid-gpui/) | The JavaScript library: renderer, protocol, style normalisation, build helpers |
| [crates/solid-gpui-host/](crates/solid-gpui-host/) | The Rust host binary that owns gpui and the window |
| [examples/counter/](examples/counter/) | The smallest thing that runs: clicks, hover styles, a keyed list |
| [examples/showcase/](examples/showcase/) | Every element at once: lists, rich text, canvas, scrollbars, text input |
| [tools/mock-host.mjs](tools/mock-host.mjs) | A host that speaks the protocol and prints the tree instead of drawing it |

The library is bundled with [tsdown](https://tsdown.dev) and tested with
[Vitest](https://vitest.dev); `pnpm test` runs the suite, which exercises the
renderer against a fake host and asserts the operations it emits.

## Getting started

```sh
pnpm install
pnpm build                 # builds the JavaScript package with tsdown
pnpm test                  # runs the Vitest suite
pnpm build:host            # builds the Rust host (needs a Rust toolchain)
pnpm example:counter
```

The Rust host is fetched from the Zed repository, so the first `build:host`
clones several gigabytes and then compiles for a while. On macOS the Xcode
Command Line Tools are enough.

A project of your own needs the JSX transform and two TypeScript options.
[docs/setup.md](docs/setup.md) covers those, how the host binary is found, and
how to develop without a Rust toolchain at all.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/elements.md](docs/elements.md) | Every tag: text and spans, text input, virtualised lists, canvas, scrollbars |
| [docs/styling.md](docs/styling.md) | The style object, groups and state styles, animation |
| [docs/events.md](docs/events.md) | Listeners, focus and keyboard, drag and drop, tooltips |
| [docs/commands.md](docs/commands.md) | The window, dialogs, key bindings, the menu bar |
| [docs/protocol.md](docs/protocol.md) | The wire protocol between the two processes |
| [docs/setup.md](docs/setup.md) | The JSX transform, TypeScript options, developing without Rust |
| [docs/releasing.md](docs/releasing.md) | How the package and the host binary are published together |

## The window

```ts
await render(() => <App />, {
  title: "My application",
  width: 900,
  height: 640,
  x: 100,              // omit x/y to centre the window
  y: 100,
  titlebar: false,     // hides the platform title bar
  resizable: true,
  fullscreen: false,
  appearance: "blurred",   // "opaque" | "transparent" | "blurred"
  activate: true,
  onClose: () => process.exit(0),
});
```

`render` resolves once the window is up and the first frame has been sent, and
returns a function that disposes the reactive root and asks the host to quit.
Closing the window exits the process unless you pass your own `onClose`.

## Control flow

`For`, `Show`, `Switch`, `Match`, `Repeat`, `Reveal`, `Loading` and `Errored` are
re-exported from `solid-js`, which is where the JSX transform imports them from.
`Dynamic` lives in this package, since Solid's core has no universal version.

```tsx
<For each={items()} fallback={<div>nothing here</div>}>
  {(item, index) => <div>{index() + 1}. {item.label}</div>}
</For>
```

## Current limitations

- **One window per process.** The protocol has a single root.
- **The menu bar is macOS-shaped.** The platform names the first menu after the
  application and adopts one called `Window` as its own.
- **A `<list>` shows blank rows for one frame.** gpui asks for a row while it is
  laying out and cannot wait for a round trip, so a row outside the rendered
  window stands in at `itemHeight` until the next frame carries it.
- **`onResize` does not work on `<img>` or `<svg>`.** The size is measured by a
  layer laid over the element, and those two cannot hold one.
- **No `surface`.** It is a macOS video frame source, and the frames cannot cross
  a process boundary. `<canvas>` sidesteps the same problem by recording.
- **A canvas cannot be read back or measured.** See
  [docs/elements.md](docs/elements.md#canvas).
- **Scrolling reports one frame late.** `onScroll` is emitted from the following
  render, since the offset is only known after gpui applies it.

## Licence

MIT.
