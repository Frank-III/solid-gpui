# Events

Listeners are `on`-prefixed props. Each receives a plain object, with positions
in logical pixels and modifiers as booleans.

| Listener | Fires on |
| --- | --- |
| `onClick`, `onAuxClick` | A completed click, primary or secondary |
| `onMouseDown`, `onMouseUp`, `onMouseMove`, `onMouseExit` | Raw pointer movement |
| `onHover` | Receives `true` on enter, `false` on leave |
| `onScrollWheel` | Wheel and trackpad scrolling, before it is applied |
| `onScroll` | The scroll offset of an `overflow: "scroll"` element changed |
| `onMousePressure`, `onPinch` | Trackpad force click and pinch |
| `onKeyDown`, `onKeyUp` | Keystrokes, scoped to focus on a focusable element |
| `onFocus`, `onBlur` | Focus entering or leaving a focusable element |
| `onDragStart`, `onDrop` | A drag beginning here, or released here |
| `onInput`, `onChange` | Edits to an `<input>` |
| `onRange` | A `<uniform-list>` or `<list>` asking for rows |
| `onResize` | An element's size, once laid out and whenever it changes |

```tsx
<div onClick={(event) => console.log(event.position, event.clickCount)} />
<div onHover={(hovered) => setActive(hovered)} />
<div onScrollWheel={(event) => scrollBy(event.delta.y)} />
```

`onResize` is measured by an empty layer laid over the element, since gpui has
no hook for an element's size. That works for anything which can hold children,
so every tag except `<img>` and `<svg>`.

## Focus and keyboard

An element with `focusable`, `tabIndex` or `autofocus` gets its own focus
handle, which changes how its key events behave. `onKeyDown` and `onKeyUp` on a
focusable element fire only while it holds focus, the way gpui does natively.

On an element that is *not* focusable, key events fall back to the window. gpui
delivers them along the focus path and the window root owns focus, so every such
listener hears every keystroke. Filter on `event.key` yourself.

`tabIndex` also puts the element in the tab order. `onFocus` and `onBlur` report
the change.

## Drag and drop

```tsx
<div dragData={{ id: item.id }}>drag me</div>

<div dragOverStyle={{ borderColor: "#7aa2f7" }} onDrop={(event) => move(event.data)}>
  drop here
</div>
```

`dragData` is any JSON value, and the drag preview is the source element itself.
`onDrop` receives the data and the source node's id. `onDragStart` fires when the
drag begins.

## Tooltips

`tooltip` takes either a string or an element:

```tsx
<div tooltip="Plain text" />
<div tooltip={<div style={{ padding: 8 }}>Anything you can render</div>} />
```

An element-valued prop never joins the tree. It is referenced by id and built
when the tooltip is first shown.
