# The solid-gpui protocol

Both directions are newline-delimited JSON over the host's stdin and stdout. A
line from JavaScript is an array of operations that the host applies in order
before repainting. A line from the host is a single message object.

The encoding is positional rather than tagged: a busy frame carries hundreds of
operations and the shape never varies per opcode.

## Operations (JavaScript → host)

| Code | Form | Meaning |
| --- | --- | --- |
| 0 | `[0, id, tag, props]` | Create an element with static properties already applied |
| 1 | `[1, id, text]` | Create a text node |
| 2 | `[2, id, text]` | Replace a text node's content |
| 3 | `[3, id, key, value]` | Set a property; `null` removes it |
| 4 | `[4, parentId, childId, anchorId]` | Insert before `anchorId`, or append when it is `0` |
| 5 | `[5, parentId, childId]` | Detach a child from its parent |
| 6 | `[6, id]` | Make `id` the root of the window's tree |
| 7 | `[7, options]` | Open the window |
| 8 | `[8]` | Close the window and exit |
| 9 | `[9, id]` | The node is unreachable; free its host state |

Operation 4 doubles as a move: a node already in the tree is detached from its
current parent first.

Node ids are assigned by JavaScript and are never reused.

### Properties

Property names are passed through unchanged except for listeners, which are sent
as `@name` with a boolean value — the closure itself stays in JavaScript, so the
host only needs to know whether to attach a listener. Presence is what travels,
which means a changed closure identity costs no traffic.

`style`, `hoverStyle`, `activeStyle`, `groupHoverStyle` and `thumbStyle` carry a normalised
style object whose field names mirror gpui's `Style`. Lengths are tagged objects
(`{"k":"px","v":12}`, `{"k":"rem","v":1.5}`, `{"k":"pct","v":0.5}`, `{"k":"auto"}`)
and colours are HSLA with every channel in 0..1. Shorthand expansion, unit
parsing and colour parsing all happen in JavaScript so the host is a mechanical
field-by-field assignment.

A `<span>` inside a `<text>` is an ordinary element on the wire — it carries a
`style` like any other, and the host reads the text fields out of it to build one
run of the surrounding string. Its `click` listener is reported with a `null`
payload, since gpui says which run was clicked and nothing more.

A prop whose value is an element — a tooltip written as JSX — is sent as
`{"__node": id}`. The node it names is created like any other but never inserted
into the tree, and the sender pins it so the collector described below leaves it
alone; the host builds it on demand.

`animate` carries `{duration_ms, from, to, repeat, easing, max_fps}`, where
`from` and `to` are style objects in the same normalised form.

`commands` carries a `<canvas>`'s recording: an array of tagged objects, one per
thing to draw, in coordinates local to the element. `{"k":"quad"}` has `x`, `y`,
`w`, `h` and optional `background`, `radius`, `border_width` and `border_color`;
`{"k":"path"}` has `points` — each `{x, y}`, optionally with a quadratic control
point as `cx`/`cy` — and a `color`; `{"k":"text"}` has `x`, `y`, `text` and
optional `font_size` and `color`. The host replays the last recording it received
on every repaint, so a drawing is replaced rather than added to.

Remaining properties are element-specific: `src` on `img`, `path` on `svg`,
`count`, `start` and `scrollToItem` on `uniform-list`, the same plus
`insertedAt`, `align`, `overdraw`, `itemHeight` and `follow` on `list`,
`value`, `placeholder`, `multiline` and `rows` on `input`, `commands` on
`canvas`, `orientation`, `thickness` and `thumbStyle` on `scrollbar` — which scrolls its
own first element child,
`anchor`/`position`/`offset`/`snapToWindow` on `anchored`, `priority` on
`deferred`, and `group`, `groupOf`, `tooltip`, `dragData`, `focusable`,
`tabIndex`, `autofocus`, `occlude`, `scrollTop` and `scrollLeft` on any element.

## Messages (host → JavaScript)

| Message | Meaning |
| --- | --- |
| `{"t":"ready"}` | The window is open; buffered operations may be flushed |
| `{"t":"e","id":N,"n":"click","d":{…}}` | An event for the listener registered on node `N` |
| `{"t":"closed"}` | The window was closed |
| `{"t":"log","m":"…"}` | Diagnostic text |
| `{"t":"error","m":"…"}` | The host could not carry out a request |

Event names drop the `on` prefix and lower-case the first letter, so `onKeyDown`
arrives as `keyDown`. Payloads carry positions in logical pixels and modifiers as
booleans. Events whose payload is a bare value — `hover` — wrap it as
`{"value": …}`, and events that carry nothing — `focus`, `blur` — send `null`.

`resize` reports an element's size after it has been laid out, which is the only
point at which it is known. It is emitted while gpui is laying out, so a
drawing that depends on the size lands on the following frame.

Two events are requests rather than notifications. `range` asks for the rows a
virtualised list needs, and is emitted while gpui is laying out, so the answer
arrives a frame later. A `list` asks in chunks of sixteen rows, and a request far
from the standing one replaces it rather than widening it, so a list anchored to
its bottom does not end up asking for every row between the two. `input` reports an edit the host has already applied to
its own buffer, which is why a `value` prop that echoes it does not fight the
caret.

## Batching and lifetime

JavaScript queues operations as Solid mutates the tree and flushes them on a
microtask, so one Solid update produces one line. After dispatching an event the
session flushes Solid's effects and then the queue, which keeps an interaction to
a single round trip.

Detaching a node does not free it, because Solid's reconciler detaches and
reinserts nodes within one batch. At the end of a batch, any node still detached
is unreachable, and a `Drop` operation is emitted for it and its subtree.
