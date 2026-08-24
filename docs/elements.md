# Elements

The tags this renderer understands. Styling them is covered in
[styling.md](styling.md), and the listeners they accept in
[events.md](events.md).

| Tag | Renders as | Notes |
| --- | --- | --- |
| `div` | gpui `div()` | A flex container. The workhorse. |
| `text` | gpui `div()` or `StyledText` | Text laid out as one block, so it wraps. |
| `span` | a run inside `<text>` | Styles or makes clickable part of one string. |
| `img` | gpui `img()` | Takes `src`, a file path or an `http(s)` URL. |
| `svg` | gpui `svg()` | Takes `path`. Painted in the current text colour. |
| `anchored` | gpui `anchored()` | A floating layer for popovers, dropdowns and menus. |
| `deferred` | gpui `deferred()` | Paints after its siblings, so overlays land on top. |
| `input` | custom | A text field whose buffer lives in the host. `multiline` makes it wrap. |
| `uniform-list` | gpui `uniform_list()` | A virtualised list of equal-height rows. |
| `list` | gpui `list()` | A virtualised list whose rows may each be a different height. |
| `image-cache` | gpui `image_cache()` | Keeps the images inside it decoded rather than reloading them. |
| `canvas` | gpui `canvas()` | A surface the application paints itself, from a recorded draw list. |
| `scrollbar` | custom | Wraps a scrollable and lays a bar over its edge. |
| `menu`, `item`, `separator` | gpui `Menu` | The application's menu bar. Painted by the platform, not by gpui. See [commands.md](commands.md). |

Every element defaults to `display: flex`, not to gpui's own `display: block`.
That is what makes `flexDirection`, `alignItems`, `justifyContent` and `gap`
meaningful on a bare `<div>`. Set `display` explicitly to opt out. `<text>` is
the exception and defaults to `display: block`, for the reason under
[Text](#text).

Text is written as ordinary JSX children. The host concatenates adjacent text
nodes, so `<div>#{index() + 1}</div>` lays out as one run of text rather than two
boxes.

## Text

Long text belongs in `<text>` rather than `<div>`. gpui measures a line at its
full width even when the layout asks how narrow it could be, so as a flex item it
never shrinks and a long line runs out of its container instead of wrapping. A
`<text>` is laid out as a block, which hands it the container's width and lets it
wrap inside it.

A `<span>` styles part of that text:

```tsx
<text>
  Wraps between <span style={{ color: "#7aa2f7", fontWeight: "bold" }}>two</span>{" "}
  <span style={{ fontStyle: "italic" }}>differently</span> styled runs, and this one{" "}
  <span style={{ underline: true }} onClick={openLink}>answers a click</span>.
</text>
```

A span is not an element of its own. gpui lays the whole `<text>` out as a single
string and a span contributes a range of it, which is what lets a line wrap in
the middle of a styled run.

Only the fields gpui can vary run by run apply: `color`, `fontWeight`,
`fontStyle`, `fontFamily`, `background`, `underline`, `strikethrough` and
`fadeOut`. A size or an alignment belongs to the `<text>` as a whole and is
ignored on a span. `onClick` takes no event, because gpui reports which run was
clicked and nothing else.

A `<text>` holding anything other than strings and spans falls back to laying its
children out as boxes.

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
They have to: while composing, the platform asks for the selected range and the
text around the cursor synchronously, and those questions cannot wait for a round
trip.

`value` sets the text, `onInput` fires on every edit, and `onChange` fires once
when focus leaves after an edit. Selection offsets are UTF-16 code units, as the
platform reports them. Editing keys (arrows, shift-arrows, home, end, backspace,
delete, select-all, cut, copy, paste) are bound by the host.

`multiline` makes the field wrap, grow to fit what it holds, and take newlines
from the return key and the clipboard. Up and down move by row, and home and end
go to the ends of the row rather than of the buffer.

```tsx
<input multiline rows={3} value={note()} onInput={(event) => setNote(event.value)} />
```

`rows` sets the fewest lines the field occupies. It grows from there and does not
scroll, so cap it with a `maxHeight` if the text can run long.

Without `multiline` the field is one line and the return key is left alone, so an
application can bind it to submitting a form.

## Virtualised lists

```tsx
const [range, setRange] = createSignal({ start: 0, end: 40 });
const first = () => Math.max(0, range().start - 20);
const last = () => Math.min(total, range().end + 20);

<uniform-list count={total} start={first()} onRange={setRange}>
  <For each={rows(first(), last())}>{(row) => <div style={{ height: 24 }}>{row}</div>}</For>
</uniform-list>
```

`count` is the full row count. The children are the rows actually rendered, and
`start` says which absolute index the first child is.

`scrollToItem` scrolls a row to the top of the viewport. It acts on change, so
setting it does not stop the user scrolling away afterwards.

`onRange` asks for the rows the viewport needs. One wrinkle is worth knowing:
gpui asks for a range **during layout**, and the answer cannot wait for a round
trip to JavaScript. The host renders whatever rows it already has and forwards
the request, so the next frame carries the rest. A fast scroll therefore shows
one frame of catch-up. Rendering a margin around the visible range, as above,
hides it.

Rows must be the same height. That is what makes the list virtualisable, since
gpui measures the first row and derives every other row's position from it.

A virtualised list keeps its own scroll state, so `onScroll` does not apply to
it. `onRange` is how it reports where the viewport is.

### Rows of differing heights

`<list>` is the same idea for rows that are not all the same height: a chat log,
a feed, anything whose rows wrap. It is driven the same way, by `count`, `start`
and `onRange`.

```tsx
<list count={messages.length} start={window().start} align="bottom" follow="tail"
      itemHeight={40} onRange={setWindow}>
  <For each={messages.slice(window().start, window().end)}>
    {(message) => <text>{message.body}</text>}
  </For>
</list>
```

gpui caches the height of every row it has measured, which is what lets it scroll
without laying the whole list out. It is also why this element carries state the
others do not.

- **`itemHeight`** is the height to assume for a row that has not been measured.
  It matters more than it looks. A row the host has not received yet stands in as
  a blank of this height, and a stand-in measured at nothing would tell the list
  that all of it fits on screen, which makes it ask for every row at once.
- **`insertedAt`** says where rows went when `count` grew, so the heights either
  side of the insertion survive. It defaults to the end, an append. Pass `0` when
  prepending. A `count` that shrinks re-measures everything, because nothing says
  which rows went.
- **`align`** anchors the list to the `"top"` or the `"bottom"`. `"bottom"` suits
  a chat log. **`follow="tail"`** keeps it at the end as rows arrive, until the
  user scrolls away. **`overdraw`** is how far beyond the viewport, in pixels,
  rows are measured so scrolling does not pop. `align`, `overdraw` and
  `itemHeight` are read once, when the list first renders.
- **`scrollToItem`** scrolls until that row is fully visible, on change.

Rows are asked for in chunks. A request for a row far from the ones already
rendered replaces the standing request rather than widening it, because a list
anchored to its bottom starts laying out from its last row while JavaScript is
still showing its first, and widening across that gap would ask for the entire
list.

## Canvas

`draw` records what to paint. It runs in an effect, so it re-records whenever
something it read changes, including the element's own size, which only becomes
known once the host has laid it out.

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
being built. The recording is a property like any other, and the host replays it
on every repaint until a new one replaces it. Re-recording is how the picture
changes, which is what a reactive renderer wants anyway.

Coordinates are local to the element, so a recording keeps working when the
element moves.

What the context can do:

- `fillRect` and `strokeRect`, both taking an optional corner radius. gpui draws
  rounded rectangles directly, so a chart made of bars costs no triangulation.
- `beginPath`, `moveTo`, `lineTo`, `quadraticCurveTo`, `closePath` and `fill`.
  Curves are quadratic, because gpui's paths are.
- `stroke`, with a caveat. gpui fills paths and cannot stroke them, so each
  segment becomes the quadrilateral covering it: butt joints, and curves are
  flattened first. A stroked curve costs more than a filled one.
- `fillText`, which draws one line positioned by its top-left corner, in the font
  the element inherits.

What it deliberately cannot do:

- **No readback.** `getImageData` and `toDataURL` have no answer to give. The
  pixels are on the GPU, in the host process.
- **No `measureText`.** The font system is in the host, so an answer could not be
  returned synchronously, which is the only way the web's is useful.
- **No transform stack, no clipping, no images.** Fold transforms into the
  coordinates before recording them.

## Scrollbars

gpui ships no scrollbar. It gives an element a scroll offset and a maximum, and
leaves the bar to the application. `<scrollbar>` is that bar, driven from the
same handles the renderer already keeps.

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

It wraps what it scrolls. The bar has to be a *sibling* of the scrolling content,
since placed inside it would scroll away with it, and wrapping is the arrangement
where that holds without either element having to name the other. Otherwise it is
transparent: it stands where a wrapping `<div>` would have stood, and takes the
style that div would have taken.

It works with anything that scrolls: a `<div>` with `overflow: "scroll"`, a
`<uniform-list>`, or a `<list>`. The first two scroll by pixels. A `<list>` only
knows where it is by row, because it caches heights as it measures them and never
totals them up, so its bar moves in whole rows. That shows as a slight step when
dragging.

`thickness` is how wide the bar is in pixels, defaulting to 8. `thumbStyle`
paints the thumb with `background` and `borderRadius`, plus `minHeight` (or
`minWidth`, when horizontal) to keep it grabbable. A proportional thumb in a
five-thousand-row list would be a fraction of a pixel wide.

Dragging is handled inside the host rather than through listeners, because a
listener on the bar stops hearing the mouse the moment it leaves, and a pointer
wandering off an eight-pixel track mid-drag is the normal case. Clicking the
track jumps the thumb there.
