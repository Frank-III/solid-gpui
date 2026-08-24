# Window, dialogs and the menu bar

The parts of a desktop application that are not the element tree. Everything
here is a round trip to the host, so each function returns a promise. The ones
that open a dialog resolve when the user answers it.

## The window

```ts
import { appWindow } from "solid-gpui";

await appWindow.setTitle("Untitled 1");
await appWindow.minimize();
await appWindow.zoom();
await appWindow.toggleFullscreen();
await appWindow.activate();
```

`render` sets the window's title, size, position and appearance when it opens.
These change it afterwards. `zoom` is the green button, which fills the screen
without entering full screen.

## Dialogs

```ts
import { dialog } from "solid-gpui";

const answer = await dialog.message({
  message: "Discard this draft?",
  detail: "It has not been saved.",
  answers: ["Discard", "Keep"],
  level: "warning",
});

const opened = await dialog.openFile({ multiple: true });
const target = await dialog.saveFile({ suggestedName: "notes.md" });
```

`message` resolves with the index of the button that was pressed, counting from
the left. `level` is `"info"`, `"warning"` or `"critical"` and picks the icon.

`openFile` resolves with the chosen paths, or `null` when the dialog was
cancelled. `files`, `directories` and `multiple` say what may be picked, and
`prompt` labels the accept button. `saveFile` resolves with one path or `null`,
and takes a `directory` to open in and a `suggestedName`.

## The shell

```ts
import { shell } from "solid-gpui";

await shell.revealPath("/Users/me/notes.md");
await shell.openWithSystem("/Users/me/notes.md");
```

`revealPath` shows the file in Finder, or the platform's equivalent.
`openWithSystem` hands it to whatever application owns that file type.

## Key bindings

`keys` declares the keystrokes an element handles, spelled the way gpui spells
them: `"cmd-k"`, `"ctrl-shift-p"`, `"escape"`, or a sequence such as
`"ctrl-x ctrl-s"`.

```tsx
<div
  keys={{
    "cmd-shift-p": () => setPalette(true),
    escape: () => setPalette(false),
  }}
/>
```

A focusable element's bindings fire only while it holds focus. On an element
that is not focusable they are application-wide, which is the same rule
`onKeyDown` follows.

This is what to reach for instead of `onKeyDown` when a shortcut is what you
mean. gpui resolves the keystroke through its keymap, so a binding does not have
to compete with every other key listener in the tree, and the host does not send
an event for keystrokes nothing asked for.

## The menu bar

A menu is written in JSX so that Solid's control flow works on it, but it is not
painted. The host reads it out of the tree and hands it to the platform, which on
macOS is the menu bar at the top of the screen.

```tsx
<menu label="File">
  <item label="New" shortcut="cmd-n" onSelect={newDocument} />
  <item label="Open…" shortcut="cmd-o" onSelect={open} />
  <separator />
  <menu label="Recent">
    <For each={recent()}>
      {(file) => <item label={file.name} onSelect={() => open(file)} />}
    </For>
  </menu>
</menu>
```

A `<menu>` nested inside another is a submenu. `label` names it, and text
children are used when there is no `label`. `disabled` greys it out.

An `<item>` takes `onSelect`, plus `checked` and `disabled`. Its `shortcut`
becomes a real key binding, so the keystroke works whether or not the menu is
open, and the platform prints it beside the item.

macOS gives the first menu the application's own name, whatever `label` says,
because that is the slot the system reserves for it. A menu named `Window` is
adopted as the system Window menu and gains the standard entries alongside yours.
