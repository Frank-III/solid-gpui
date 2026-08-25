# OpenCode Desktop for Solid GPUI

A native OpenCode desktop client built in Solid and rendered by
[`solid-gpui`](../../packages/solid-gpui). It runs in Node.js; Bun and a browser
DOM are not used.

This is an application package, not a component fork. OpenCode state and product
behavior stay in TypeScript/Solid. The Rust host is treated as an upstream
renderer. Native primitives that eventually require IME, virtualization, or
layout-aware overlays should be designed from proven GPUI patterns rather than
implemented as application-specific host patches.

## Run

```sh
pnpm install
pnpm build
pnpm build:host
pnpm opencode:desktop
```

Self-contained Node/GPUI bundles for macOS and Linux are assembled by
`scripts/package-desktop.mjs`. They include Node and the native host; only the
OpenCode CLI remains an external requirement. See [DISTRIBUTION.md](DISTRIBUTION.md).

By default the app reuses OpenCode on `127.0.0.1:4096`, or starts
`opencode serve` there when no server is running. To connect explicitly:

```sh
OPENCODE_URL=http://127.0.0.1:4096 \
OPENCODE_DIRECTORY=/absolute/path/to/project \
OPENCODE_PASSWORD=optional-password \
pnpm opencode:desktop
```

Set `OPENCODE_EDITOR` to an editor executable such as `code`, `cursor`, or
`zed` to override automatic external-editor detection. Selected source ranges
open at their first line when the editor supports line arguments.

## Product surface

- Real projects, sessions, message parts, status, permissions, questions, and SSE updates
- Session creation, selection, archive, prompt submission, and abort
- Server-backed `@file` search with structured file context and mention ranges
- Project files, native file picker, drag/drop, clipboard file paths, and pasted images with preserved MIME type
- Prompt and shell modes with persisted, separate history and per-session drafts
- Queued follow-up prompts with automatic serial delivery, cancellation, and failure pausing
- Session undo/redo, fork, compact, share/unshare, and fidelity-preserving Markdown export through a native save dialog
- Per-message edit/retry/revert/fork actions that preserve model, agent, and attachments while creating a fresh submission ID
- Provider model and primary-agent selection
- Slash-command discovery and execution through the OpenCode command API
- Server-paged, bounded streaming transcript with inline Markdown, lazy Shiki code fences, reasoning, files, patches, subtasks, compaction, grouped context-gathering tools, background-task identity and child-session discovery, structured expandable details, and context/token/cost metrics
- Session todos and Shiki-highlighted side-by-side review diffs with selectable text, old/new line ranges, and editable inline comments
- Project file browser, persisted closable file tabs, native visible-line source virtualization and pixel scrolling, cached Shiki syntax highlighting, in-file search, character/line selection and native copy, external-editor launch, and Git status badges
- Persisted file selections and review comments sent as OpenCode-compatible structured prompt context
- MCP connection count and offline/retry handling
- Real OpenCode PTY terminals with output replay, keyboard input, paste, and process lifecycle
- Native visible-line shaping for source files plus GPUI lists and scrollbars for diffs and terminal scrollback
- Native visible IME-aware multiline composer with controlled selection, native text editing/clipboard behavior, and structured path/image paste integration

Keyboard shortcuts:

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+N` | New session |
| `Ctrl/Cmd+K` | Model picker |
| `Ctrl/Cmd+E` | Toggle prompt/shell mode |
| `Ctrl/Cmd+1` | Chat |
| `Ctrl/Cmd+2` | Files |
| `Ctrl/Cmd+3` | Review |
| `Ctrl/Cmd+4` | Terminal |
| `Ctrl/Cmd+F` | Find in the open file |
| `Enter` | Send |
| `Shift+Enter` | New line |
| `@` | Search and attach a project file |
| `Ctrl/Cmd+V` | Paste text, file paths, or an image |
| `Up/Down` | Navigate the current mode's history |

This is a usable vertical slice, not yet a feature-complete OpenCode replacement.
See the [commit-pinned feature parity map](../../docs/opencode-desktop-parity.md)
for the implemented surface, important gaps, and the next product priorities.

## Architecture

```text
OpenCode server
      │ HTTP + SSE
      ▼
OpenCodeController       SDK lifecycle and normalized desktop state
      │
      ▼
Solid components         sessions, transcript, files, review, dialogs
      │ renderer protocol
      ▼
solid-gpui host          native GPUI layout, paint, pointer and key events
```

Framework additions stay generic: a controlled `input` bridge with a desktop
Enter-key policy, a read-only
shaped `codeSurface`, native path prompts, structured clipboard reads, and
external path-drop events. Solid owns application state, source text and
highlight spans; upstream GPUI lists own row virtualization and scrolling, and
GPUI owns visible-line shaping, glyph hit testing, selection
geometry, pixel scrolling, focus, UTF-16 conversion, IME composition, dialogs,
and OS clipboard/drop integration.
