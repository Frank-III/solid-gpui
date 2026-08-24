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

The Rust host is fetched from the Zed repository, so the first `build:host`
clones several gigabytes and then compiles for a while.

On macOS the Xcode Command Line Tools are enough — the host enables gpui's
`runtime_shaders` feature, which compiles the Metal shaders at startup instead of
calling `xcrun metal`, a tool that only ships with the full Xcode. It also
enables `font-kit`: without it gpui installs a no-op text system and draws no
text at all.

The JavaScript side finds the binary by walking up from the working directory
looking for `crates/solid-gpui-host/target/{release,debug}/solid-gpui-host`, so
running an example from its own folder works. Otherwise set `SOLID_GPUI_HOST` to
its path, or put `solid-gpui-host` on `PATH`.

The host installs a logger, so gpui's own warnings reach stderr; `RUST_LOG=debug`
turns up the detail.

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
| `text` | gpui `div()` or `StyledText` | Text laid out as one block, so it wraps. |
| `span` | a run inside `<text>` | Styles or makes clickable part of one string. |
| `img` | gpui `img()` | Takes `src` — a file path or an `http(s)` URL. |
| `svg` | gpui `svg()` | Takes `path`; painted in the current text colour. |
| `anchored` | gpui `anchored()` | A floating layer: popovers, dropdowns, context menus. |
| `deferred` | gpui `deferred()` | Paints after its siblings, so overlays land on top. |
| `input` | custom | A text field whose buffer lives in the host; `multiline` makes it wrap. |
| `uniform-list` | gpui `uniform_list()` | A virtualised list of equal-height rows. |
| `list` | gpui `list()` | A virtualised list whose rows may each be a different height. |
| `image-cache` | gpui `image_cache()` | Keeps the images inside it decoded rather than reloading them. |
| `canvas` | gpui `canvas()` | A surface the application paints itself, from a recorded draw list. |
| `scrollbar` | custom | Drives another element's scroll position. |

Every element defaults to `display: flex`, not to gpui's own `display: block`.
That is what makes `flexDirection`, `alignItems`, `justifyContent` and `gap`
meaningful on a bare `<div>`; set `display` explicitly to opt out. `<text>` is the
exception and defaults to `display: block`, for the reason in the next section.

Text is written as ordinary JSX children. Adjacent text nodes are concatenated by
the host, so `<div>#{index() + 1}</div>` lays out as one run of text rather than
two boxes.

## Text

Long text belongs in `<text>` rather than `<div>`. gpui measures a line of text
at its full width even when the layout asks how narrow it could be, so as a flex
item it never shrinks and a long line runs out of its container instead of
wrapping. `<text>` is laid out as a block, which hands it the container's width
and lets it wrap inside it.

A `<span>` styles part of that text:

```tsx
<text>
  Wraps between <span style={{ color: "#7aa2f7", fontWeight: "bold" }}>two</span>{" "}
  <span style={{ fontStyle: "italic" }}>differently</span> styled runs, and this one{" "}
  <span style={{ underline: true }} onClick={openLink}>answers a click</span>.
</text>
```

A span is not an element of its own. gpui lays the whole `<text>` out as a single
string, and a span contributes a range of it — which is what lets a line wrap in
the middle of a styled run. Only the fields gpui can vary run by run apply:
`color`, `fontWeight`, `fontStyle`, `fontFamily`, `background`, `underline`,
`strikethrough` and `fadeOut`. A size or an alignment belongs to the `<text>` as
a whole and is ignored on a span. `onClick` takes no event, because gpui reports
which run was clicked and nothing else.

A `<text>` holding anything other than strings and spans falls back to laying its
children out as boxes.

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
`groupHoverStyle` or `groupActiveStyle` restyles when that ancestor is hovered or
pressed. `dragOverStyle` applies while a drag is held over the element, and
`occlude` stops the mouse reaching whatever is painted underneath.

## Animation

`animate` interpolates between two style objects. The host runs the interpolation
itself — a per-frame callback into JavaScript would put a process boundary inside
the animation loop — so it stays smooth regardless of what the application is
doing.

```tsx
<div
  animate={{
    duration: 900,
    repeat: true,
    easing: "bounce",
    from: { opacity: 0.25, background: "#7aa2f7" },
    to: { opacity: 1, background: "#9ece6a" },
  }}
/>
```

Easings are `linear`, `quadratic`, `ease-in-out` (the default), `ease-out-quint`
and `bounce`. Lengths interpolate only when both endpoints use the same unit —
pixels with pixels, percentages with percentages — since there is no meaningful
midpoint between `10px` and `50%`. Anything that cannot be interpolated, such as
a flex direction, steps to the destination at the start.

## Focus and keyboard

An element with `focusable`, `tabIndex` or `autofocus` gets its own focus handle.
That changes how its key events behave: `onKeyDown` and `onKeyUp` on a focusable
element fire only while it holds focus, which is what gpui does natively. On an
element that is *not* focusable they fall back to the window, where every such
listener hears every keystroke — filter on `event.key` yourself.

`tabIndex` also puts the element in the tab order. `onFocus` and `onBlur` report
the change.

## Text input

```tsx
const [name, setName] = createSignal("");

<input
  autofocus
  value={name()}
  placeholder="type your name"
  onInput={(event) => setName(event.value)}
  onChange={(event) => save(event.value)}
/>
```

The buffer, selection, caret and input-method composition all live in the host.
They have to: the platform asks for the selected range and the text around the
cursor synchronously while composing, and those questions cannot wait for a round
trip. `value` sets the text, `onInput` fires on every edit, and `onChange` fires
once when focus leaves after an edit. Selection offsets are UTF-16 code units, as
the platform reports them.

Editing keys — arrows, shift-arrows, home, end, backspace, delete, select-all,
cut, copy, paste — are bound by the host.

`multiline` makes the field wrap, grow to fit what it holds, and take newlines
from the return key and the clipboard. Up and down move by row, and home and end
go to the ends of the row rather than of the buffer. `rows` sets the fewest lines
it occupies; it grows from there and does not scroll, so cap it with a
`maxHeight` if the text can run long.

```tsx
<input multiline rows={3} value={note()} onInput={(event) => setNote(event.value)} />
```

Without `multiline` the field is one line and the return key is left alone, so an
application can bind it to submitting the form.

## Virtualised lists

```tsx
const [range, setRange] = createSignal({ start: 0, end: 40 });
const first = () => Math.max(0, range().start - 20);
const last = () => Math.min(total, range().end + 20);

<uniform-list count={total} start={first()} onRange={setRange}>
  <For each={rows(first(), last())}>{(row) => <div style={{ height: 24 }}>{row}</div>}</For>
</uniform-list>
```

`count` is the full row count; the children are the rows that are actually
rendered, and `start` says which absolute index the first child is.

`scrollToItem` scrolls a row to the top of the viewport; it acts on change, so
setting it does not stop the user scrolling away afterwards.

`onRange` asks for the rows the viewport needs. There is one wrinkle worth knowing:
gpui asks for a range **during layout**, and the answer cannot wait for a round
trip to JavaScript. The host renders whatever rows it already has and forwards
the request, so the next frame carries the rest — a fast scroll shows one frame of
catch-up. Rendering a margin around the visible range, as above, hides it.

Rows must be the same height; that is what makes the list virtualisable — gpui
measures the first row and derives every other row's position from it.

A virtualised list keeps its own scroll state, so `onScroll` does not apply to it;
`onRange` is how it reports where the viewport is.

### Rows of differing heights

`<list>` is the same idea for rows that are not all the same height — a chat log,
a feed, anything whose rows wrap. It is driven the same way, by `count`, `start`
and `onRange`:

```tsx
<list count={messages.length} start={window().start} align="bottom" follow="tail"
      itemHeight={40} onRange={setWindow}>
  <For each={messages.slice(window().start, window().end)}>
    {(message) => <text>{message.body}</text>}
  </For>
</list>
```

gpui caches the height of every row it has measured, which is what lets it scroll
without laying the whole list out — and it is why this element carries state the
others do not:

- **`itemHeight`** is the height to assume for a row that has not been measured.
  It matters more than it looks: a row the host has not received yet stands in as
  a blank of this height, and a stand-in measured at nothing would tell the list
  that the whole of it fits on screen, which makes it ask for every row at once.
- **`insertedAt`** says where rows went when `count` grew, so the heights either
  side of the insertion survive. It defaults to the end — an append. Pass `0`
  when prepending. A `count` that shrinks re-measures everything, because nothing
  says which rows went.
- **`align`** anchors the list to the `"top"` or the `"bottom"`; `"bottom"` suits
  a chat log. **`follow="tail"`** keeps it at the end as rows arrive, until the
  user scrolls away. **`overdraw`** is how far beyond the viewport, in pixels,
  rows are measured so scrolling does not pop. `align`, `overdraw` and
  `itemHeight` are read once, when the list first renders.
- **`scrollToItem`** scrolls until that row is fully visible, on change.

Rows are asked for in chunks, and a request for a row far from the ones already
rendered replaces the standing request rather than widening it — a list anchored
to its bottom starts laying out from its last row while JavaScript is still
showing its first, and widening across that gap would ask for the entire list.

## Canvas

`draw` records what to paint. It runs in an effect, so it re-records whenever
something it read changes — including the element's own size, which only becomes
known once the host has laid it out:

```tsx
<canvas
  style={{ height: 90 }}
  draw={(ctx) => {
    ctx.fillStyle = "#7aa2f7";
    ctx.fillRect(0, 0, ctx.width, 4);
    ctx.strokeStyle = "#9ece6a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, ctx.height);
    for (const [index, value] of series().entries()) ctx.lineTo(index * 8, value);
    ctx.stroke();
  }}
/>
```

A canvas here is not immediate-mode. gpui rebuilds its scene every frame and the
drawing code is a process away, so nothing can be asked to draw while a frame is
being built. The recording is a property like any other: the host replays it on
every repaint until a new one replaces it. Re-recording is how the picture
changes, which is what a reactive renderer wants anyway.

Coordinates are local to the element, so a recording keeps working when the
element moves.

What the context can do, and what it deliberately cannot:

- `fillRect`, `strokeRect` take an optional corner radius; gpui draws rounded
  rectangles directly, so a chart made of bars costs no triangulation.
- `beginPath`, `moveTo`, `lineTo`, `quadraticCurveTo`, `closePath`, `fill`.
  Curves are quadratic, because gpui's paths are.
- `stroke` exists, but gpui fills paths and cannot stroke them, so each segment
  becomes the quadrilateral covering it — butt joints, and curves are flattened
  first. A stroked curve costs more than a filled one.
- `fillText` draws one line, positioned by its top-left corner, in the font the
  element inherits.
- **No readback.** `getImageData` and `toDataURL` have no answer to give: the
  pixels are on the GPU, in the host process.
- **No `measureText`.** The font system is in the host, so an answer could not be
  returned synchronously — which is the only way the web's is useful.
- **No transform stack, no clipping, no images.** Fold transforms into the
  coordinates before recording them.

## Scrollbars

gpui ships none — it gives an element a scroll offset and a maximum and leaves
the bar to the application. `<scrollbar>` is that bar, driven from the same
handles the renderer already keeps.

```tsx
<scrollbar
  style={{ flexGrow: 1, minHeight: 0 }}
  thumbStyle={{ background: "#ffffff35", borderRadius: 4, minHeight: 24 }}
>
  <uniform-list count={total} start={first()} onRange={setRange}>
    …
  </uniform-list>
</scrollbar>
```

It wraps what it scrolls. The bar has to be a *sibling* of the scrolling content
— placed inside, it would scroll away with it — and wrapping is the arrangement
where that holds without either element having to name the other. Otherwise it is
transparent: it stands where a wrapping `<div>` would have stood, and takes the
style that div would have taken.

It works with anything that scrolls: a `<div>` with `overflow: "scroll"`, a
`<uniform-list>`, or a `<list>`. The first two scroll by pixels. A `<list>` only
knows where it is by row — it caches heights as it measures them and never totals
them up — so its bar moves in whole rows, which shows as a slight step when
dragging.

`thickness` is how wide the bar is, in pixels; it defaults to 8. `thumbStyle`
paints the thumb: `background` and `borderRadius`, plus `minHeight` (or
`minWidth`, when horizontal) to keep it grabbable — a proportional thumb in a
five-thousand-row list would be a fraction of a pixel wide.

Dragging is handled inside the host rather than through listeners, because a
listener on the bar stops hearing the mouse the moment it leaves, and a pointer
wandering off an eight-pixel track mid-drag is the normal case. Clicking the
track jumps the thumb there.

## Drag and drop

```tsx
<div dragData={{ id: item.id }}>drag me</div>

<div dragOverStyle={{ borderColor: "#7aa2f7" }} onDrop={(event) => move(event.data)}>
  drop here
</div>
```

`dragData` is any JSON value. The drag preview is the source element itself.
`onDrop` receives the data and the source node's id; `onDragStart` fires when the
drag begins.

## Tooltips

`tooltip` takes either a string or an element:

```tsx
<div tooltip="Plain text" />
<div tooltip={<div style={{ padding: 8 }}>Anything you can render</div>} />
```

An element-valued prop never joins the tree — it is referenced by id and built
when the tooltip is first shown.

## Events

Listeners are `on`-prefixed props. Each receives a plain object — positions in
logical pixels, modifiers as booleans.

| Listener | Fires on |
| --- | --- |
| `onClick`, `onAuxClick` | A completed click, primary or secondary |
| `onMouseDown`, `onMouseUp`, `onMouseMove`, `onMouseExit` | Raw pointer movement |
| `onHover` | Receives `true` on enter, `false` on leave |
| `onScrollWheel` | Wheel and trackpad scrolling, before it is applied |
| `onScroll` | The scroll offset of an `overflow: "scroll"` element changed |
| `onMousePressure`, `onPinch` | Trackpad force click and pinch |
| `onKeyDown`, `onKeyUp` | Keystrokes; scoped to focus on a focusable element |
| `onFocus`, `onBlur` | Focus entering or leaving a focusable element |
| `onDragStart`, `onDrop` | A drag beginning here, or released here |
| `onInput`, `onChange` | Edits to an `<input>` |
| `onRange` | A `<uniform-list>` or `<list>` asking for rows |

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

- **One window per process.** The protocol has a single root.
- **A `<list>` shows blank rows for one frame.** gpui asks for a row while it is
  laying out and cannot wait for a round trip, so a row outside the rendered
  window stands in at `itemHeight` until the next frame carries it.
- **`onResize` needs somewhere to put its measuring layer.** gpui has no hook for
  an element's size, so it is taken by an empty layer laid over the element. That
  works for anything that can hold children — everything except `<img>` and
  `<svg>`.
- **No `surface`.** It is a macOS video frame source, and the frames cannot cross
  a process boundary. `<canvas>` sidesteps the same problem by recording.
- **A canvas cannot be read back or measured.** See the section above.
- **Scrolling reports one frame late.** `onScroll` is emitted from the following
  render, since the offset is only known after gpui applies it.

## Licence

MIT.
