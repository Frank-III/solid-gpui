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
mutation the universal renderer performs is recorded as an operation and the
whole batch is shipped on one line per flush. The host applies the batch to its
mirror of the tree, marks the root entity dirty, and gpui repaints. Input events
travel the other way, are dispatched to the listener that registered them, and
the resulting signal writes produce the next batch.

Because Solid does the reconciliation, the host never diffs anything: it only
applies operations and builds elements.

## Repository layout

| Path | What it is |
| --- | --- |
| [packages/solid-gpui/](packages/solid-gpui/) | The JavaScript library: renderer, protocol, style normalisation, build helpers |
| [crates/solid-gpui-host/](crates/solid-gpui-host/) | The Rust host binary that owns gpui and the window |
| [examples/counter/](examples/counter/) | A worked example with clicks, hover styles, keyboard and a keyed list |
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

The Rust host is fetched from the Zed repository, so the first `build:host` takes
a while. The JavaScript side finds the binary automatically when it sits at
`crates/solid-gpui-host/target/release/solid-gpui-host`; otherwise set
`SOLID_GPUI_HOST` to its path, or put `solid-gpui-host` on `PATH`.

### Without a Rust toolchain

[tools/mock-host.mjs](tools/mock-host.mjs) implements the same protocol and prints
the resulting tree to stderr instead of painting it. It is enough to develop
components, exercise events and check that the renderer emits what you expect:

```sh
SOLID_GPUI_HOST=tools/mock-host.mjs SOLID_GPUI_MOCK_DUMP=1 node dist/app.js
```

`SOLID_GPUI_MOCK_CLICK=7` additionally clicks node 7 the first time it appears
with a click listener, which is a quick way to test an interaction end to end.

## Building an application

JSX is compiled by [`@dom-expressions/compiler`](https://www.npmjs.com/package/@dom-expressions/compiler),
the Oxc-based successor to `babel-preset-solid`, in universal mode and pointed at
this package. The included Vite plugin sets that up:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import solidGpui from "solid-gpui/vite";

export default defineConfig({
  plugins: [solidGpui()],
  build: {
    // The application runs in Node and drives the host over a pipe, so this is
    // an SSR-style build: one Node-targeted bundle, no HTML.
    ssr: "src/app.tsx",
    target: "node20",
    rollupOptions: { output: { entryFileNames: "app.js" } },
  },
});
```

TypeScript needs two options. `"jsx": "preserve"` keeps JSX intact for the
compiler, and `"jsxImportSource": "solid-gpui"` points the `JSX` namespace at
this package — the types are exported rather than declared globally, so they do
not leak into unrelated files:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-gpui"
  }
}
```

For a bundler without a plugin, call the compiler directly:

```ts
import { compile } from "solid-gpui/compiler";

const { code, map } = compile(source, "src/app.tsx");
```

It emits TypeScript with the JSX already lowered, so the transform has to run
before whatever strips types.

### The `browser` export condition is required

`solid-js` publishes a server build under Node's own export condition, and that
build's effects never re-run — an application that gets it renders once and then
appears frozen. The Vite plugin sets `resolve.conditions` for you; anything else
needs `conditions: ["browser", "development"]` at bundle time, or
`node --conditions=browser` at runtime. `render()` checks for this and throws a
message naming the fix rather than letting it fail silently.

## Elements

| Tag | Renders as | Notes |
| --- | --- | --- |
| `div` | gpui `div()` | A flex container. The workhorse. |
| `text` | gpui `div()` | Same element, named for intent. |
| `img` | gpui `img()` | Takes `src` — a file path or an `http(s)` URL. |
| `svg` | gpui `svg()` | Takes `path`; painted in the current text colour. |

Text is written as ordinary JSX children. Adjacent text nodes are concatenated by
the host, so `<div>#{index() + 1}</div>` lays out as one run of text rather than
two boxes.

## Styling

Every element takes `style`, plus `hoverStyle`, `activeStyle` and `groupHoverStyle`
which are layered on top when gpui reports the corresponding state. Styles are a
CSS-flavoured object; shorthands, units and colours are normalised in JavaScript
and land on gpui's `StyleRefinement` unchanged.

```tsx
<div
  group="row"
  style={{
    flexDirection: "column",
    gap: 8,
    paddingX: 16,
    paddingY: 12,
    width: "100%",
    maxWidth: 480,
    borderWidth: 1,
    borderColor: "#3a3a44",
    borderRadius: 8,
    background: "rgba(20, 20, 24, 0.9)",
    boxShadow: [{ y: 2, blur: 8, color: "#0006" }],
    color: "#e8e8ee",
    fontSize: 15,
    fontWeight: "medium",
    overflowY: "scroll",
  }}
  hoverStyle={{ borderColor: "#7aa2f7" }}
/>
```

- **Lengths** — a number is pixels. Strings may be `"12px"`, `"1.5rem"`, `"50%"`,
  `"auto"` or `"full"`.
- **Colours** — `"#rgb"`, `"#rrggbb"`, `"#rrggbbaa"`, `rgb()`/`rgba()`/`hsl()`/`hsla()`,
  a handful of names, or `{ h, s, l, a }`. Everything is converted to gpui's HSLA.
- **Shorthands** — `padding`/`paddingX`/`paddingTop`, `margin*`, `inset`/`top`/…,
  `size`, `borderWidth*`, `borderRadius*`, `gap`/`columnGap`/`rowGap`.
- **Text** — `color`, `fontSize`, `fontFamily`, `fontWeight` (number or name),
  `fontStyle`, `lineHeight`, `textAlign`, `whiteSpace`, `underline`,
  `strikethrough`, `textOverflow`, `lineClamp` are set on the element and
  inherited by its children, the same way gpui does it.

`group` names an element, and a descendant with `groupOf="name"` plus
`groupHoverStyle` restyles when that ancestor is hovered.

## Events

Listeners are `on`-prefixed props: `onClick`, `onMouseDown`, `onMouseUp`,
`onMouseMove`, `onMouseExit`, `onScrollWheel`, `onHover`, `onKeyDown`, `onKeyUp`.
Each receives a plain object — positions in logical pixels, modifiers as booleans.

```tsx
<div onClick={(event) => console.log(event.position, event.clickCount)} />
<div onHover={(hovered) => setActive(hovered)} />
<div onScrollWheel={(event) => scrollBy(event.delta.y)} />
```

Keyboard events are a special case. gpui delivers them along the focus path, and
the window root owns focus, so **every** element declaring `onKeyDown`/`onKeyUp`
hears every keystroke. Filter on `event.key` yourself.

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

- **No text input.** gpui's text editing goes through `EntityInputHandler`, which
  has no representation in the protocol yet.
- **Window-level keyboard only**, as described above.
- **One window per process.** The protocol has a single root.
- **No virtualised lists.** gpui's `uniform_list` and `list` are not exposed, so
  very long lists build a full element tree.
- **No animations or drag and drop.**

## Licence

MIT.
