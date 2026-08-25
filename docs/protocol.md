# The wire protocol

What the two processes say to each other. The elements and props named here are
described from the application's side in [elements.md](elements.md),
[styling.md](styling.md) and [events.md](events.md).

Both directions are newline-delimited JSON over the host's stdin and stdout. A
line from JavaScript is an array of operations that the host applies in order
before repainting. A line from the host is a single message object.

The encoding is positional rather than tagged, because a busy frame carries
hundreds of operations and the shape never varies per opcode.

## Operations (JavaScript to host)

| Code | Form | Meaning |
| --- | --- | --- |
| 0 | `[0, id, tag, props]` | Create an element with static properties already applied |
| 1 | `[1, id, text]` | Create a text node |
| 2 | `[2, id, text]` | Replace a text node's content |
| 3 | `[3, id, key, value]` | Set a property. `null` removes it |
| 4 | `[4, parentId, childId, anchorId]` | Insert before `anchorId`, or append when it is `0` |
| 5 | `[5, parentId, childId]` | Detach a child from its parent |
| 6 | `[6, id]` | Make `id` the root of the window's tree |
| 7 | `[7, options]` | Open the window |
| 8 | `[8]` | Close the window and exit |
| 9 | `[9, id]` | The node is unreachable, so free its host state |
| 10 | `[10, requestId, name, args]` | Ask the host to do something and answer under `requestId` |

Operation 4 doubles as a move: a node already in the tree is detached from its
current parent first.

Node ids are assigned by JavaScript and are never reused.

### Properties

Property names are passed through unchanged except for listeners, which are sent
as `@name` with a boolean value. The closure itself stays in JavaScript, so the
host only needs to know whether to attach a listener. Presence is what travels,
which means a changed closure identity costs no traffic.

`style`, `hoverStyle`, `activeStyle`, `groupHoverStyle` and `thumbStyle` carry a
normalised style object whose field names mirror gpui's `Style`. Lengths are
tagged objects (`{"k":"px","v":12}`, `{"k":"rem","v":1.5}`, `{"k":"pct","v":0.5}`,
`{"k":"auto"}`) and colours are HSLA with every channel in 0..1. Shorthand
expansion, unit parsing and colour parsing all happen in JavaScript, so the host
is a mechanical field-by-field assignment.

`keys` is an array of keystrokes, and the index of the one that fired is what
comes back, so the closures never leave JavaScript. The host turns each into a
gpui key binding, scoped to the element when it is focusable and application-wide
when it is not.

A `<span>` inside a `<text>` is an ordinary element on the wire. It carries a
`style` like any other, and the host reads the text fields out of it to build one
run of the surrounding string. Its `click` listener is reported with a `null`
payload, since gpui says which run was clicked and nothing more.

A prop whose value is an element, such as a tooltip written as JSX, is sent as
`{"__node": id}`. The node it names is created like any other but never inserted
into the tree, and the sender pins it so the collector described below leaves it
alone. The host builds it on demand.

`animate` carries `{duration_ms, from, to, repeat, easing, max_fps}`, where
`from` and `to` are style objects in the same normalised form.

`commands` carries a `<canvas>`'s recording: an array of tagged objects, one per
thing to draw, in coordinates local to the element.

| Command | Fields |
| --- | --- |
| `{"k":"quad"}` | `x`, `y`, `w`, `h`, and optional `background`, `radius`, `border_width`, `border_color` |
| `{"k":"path"}` | `points`, each `{x, y}` with an optional quadratic control point as `cx`/`cy`, and a `color` |
| `{"k":"text"}` | `x`, `y`, `text`, and optional `font_size` and `color` |

The host replays the last recording it received on every repaint, so a drawing is
replaced rather than added to.

Remaining properties are element-specific.

| Element | Properties |
| --- | --- |
| `img`, `svg` | `src`, `path` |
| `uniform-list` | `count`, `start`, `scrollToItem` |
| `list` | the same, plus `insertedAt`, `align`, `overdraw`, `itemHeight`, `follow` |
| `input` | `value`, `placeholder`, `multiline`, `rows`, `enterBehavior` (`newline` or `propagate`) |
| `codeSurface` | `value`, UTF-16 `highlights` and selection offsets, `lineNumbers`, `scrollToLine` |
| `canvas` | `commands` |
| `scrollbar` | `orientation`, `thickness`, `thumbStyle`. It scrolls its own first element child |
| `anchored` | `anchor`, `position`, `offset`, `snapToWindow` |
| `deferred` | `priority` |
| `menu` | `label`, `disabled` |
| `item` | `label`, `shortcut`, `checked`, `disabled` |
| any element | `group`, `groupOf`, `tooltip`, `dragData`, `focusable`, `tabIndex`, `autofocus`, `occlude`, `scrollTop`, `scrollLeft`, `keys` |

## Messages (host to JavaScript)

| Message | Meaning |
| --- | --- |
| `{"t":"ready"}` | The window is open, so buffered operations may be flushed |
| `{"t":"e","id":N,"n":"click","d":{…}}` | An event for the listener registered on node `N` |
| `{"t":"closed"}` | The window was closed |
| `{"t":"log","m":"…"}` | Diagnostic text |
| `{"t":"error","m":"…"}` | The host could not carry out a request |
| `{"t":"r","i":N,"d":…}` | The answer to call `N`. `e` replaces `d` when it failed |

Event names drop the `on` prefix and lower-case the first letter, so `onKeyDown`
arrives as `keyDown`. Payloads carry positions in logical pixels and modifiers as
booleans. An event whose payload is a bare value, such as `hover`, wraps it as
`{"value": …}`. Events that carry nothing, such as `focus` and `blur`, send
`null`.

`resize` reports an element's size after it has been laid out, which is the only
point at which it is known. It is emitted during layout, so a drawing that
depends on the size lands on the following frame.

`keys` reports which of an element's bindings fired, by index. `select` reports a
menu item being chosen and carries nothing.

Three events are requests rather than notifications.

- `range` asks for the rows a virtualised list needs. It is emitted during
  layout, so the answer arrives a frame later.
- A `<list>` asks in chunks of sixteen rows. A request far from the standing one
  replaces it rather than widening it, so a list anchored to its bottom does not
  end up asking for every row in between.
- `input` reports an edit the host has already applied to its own buffer, which
  is why a `value` prop that echoes it does not fight the caret.

Path pickers and clipboard reads use generic calls (`dialog.openFile` and
`clipboard.read`). Path-picker responses are arrays of native filesystem path strings. Clipboard
responses are arrays of text (`{type:"text",text}`), external paths
(`{type:"paths",paths}`), or images (`{type:"image",mime,data}`), where image
data is base64. Native path drops arrive as a `dropFiles` event with a `paths`
array.

## Batching and lifetime

JavaScript queues operations as Solid mutates the tree and flushes them on a
microtask, so one Solid update produces one line. After dispatching an event the
session flushes Solid's effects and then the queue, which keeps an interaction to
a single round trip.

Detaching a node does not free it, because Solid's reconciler detaches and
reinserts nodes within one batch. At the end of a batch, any node still detached
is unreachable, and a `Drop` operation is emitted for it and its subtree.
