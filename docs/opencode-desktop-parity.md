# OpenCode desktop parity map

This map compares the Solid GPUI desktop app in this repository with
`anomalyco/opencode`'s `v2` branch at commit
[`bcd17695`](https://github.com/anomalyco/opencode/commit/bcd1769521a0b89fc32db67ed2717668f326bc43),
verified from a local checkout rather than the published SDK alone.
It is a product map, not a claim of full parity.

Status: **Yes** works end to end, **Partial** is usable but less complete, and
**No** has not been implemented.

| Area | Status | Solid GPUI desktop today | OpenCode v2 reference |
| --- | --- | --- | --- |
| OpenCode server and SDK | **Yes** | Spawns or reuses a server, supports basic auth, uses `@opencode-ai/sdk/v2`, and consumes SSE | `packages/app/src/runtime/server/` |
| Sessions | **Partial** | List, create, select, archive, streamed messages, server-backed history paging, and persistent closable/reopenable top-level session tabs | `packages/app/src/home/sessions/`, `packages/app/src/session/model.ts`, `packages/app/src/shell/tabs/` |
| Prompt submission | **Yes** | Async prompts with selected model and primary agent; abort while working | `packages/app/src/composer/submit.ts` |
| Shell mode | **Yes** | Dedicated composer mode backed by `session.shell`, with separate history and queued execution | `packages/app/src/composer/model.ts`, `packages/app/src/composer/submit.ts` |
| Follow-ups and history | **Partial** | Persisted per-project/per-session drafts, persisted prompt/shell history, editable queued follow-ups, and automatic serial delivery | `packages/app/src/composer/history/`, `packages/app/src/composer/submission-state.ts` |
| `@` mentions | **Yes** | References, secondary agents, MCP resources, recent open files, and server-backed file search in v2 order; resources and agents submit as structured typed parts with source ranges | `packages/app/src/composer/suggestions/`, `packages/app/src/composer/prompt-parts.ts` |
| Attachments | **Yes** | Project files, native multi-file picker, OS drag/drop, clipboard file paths, and clipboard images sent as data URL file parts, with removable composer chips | `packages/app/src/composer/attachments/` |
| Slash commands | **Partial** | Server command discovery, picker, and execution | `packages/app/src/composer/commands.tsx` |
| Model and agent selection | **Partial** | Connected models, primary-agent cycling, five-item model recents, favorites, and remembered variants; no provider management yet | `packages/app/src/providers/models/`, `packages/app/src/settings/` |
| Transcript | **Partial** | Streaming block/inline Markdown with lazy Shiki code fences and copy; reasoning, files, patches, subtasks, retries and compaction; cross-message read/search/list grouping; specialized edit/write/apply-patch diagnostics and diffs; web provider labels, citations and external fetch links; structured expandable fallback tool state; background-task labels, child-session discovery/navigation, live child busy/retry state, and targeted session cancellation; exact latest-message context pressure, cache tokens and session cost | `packages/app/src/session/timeline/`, shared `packages/session-ui/` |
| Permissions | **Partial** | Once/always/reject requests | `packages/app/src/session/requests/session-permission-dock.tsx`, `auto-approve.ts` |
| Questions | **Yes** | Single-choice, multi-choice, custom free-text responses, and reject | `packages/app/src/session/requests/session-question-dock.tsx` |
| Session recovery/actions | **Strong** | Message-point edit/retry/revert/fork, undo/redo, compact, share/unshare, archive, and Markdown export through a native save dialog | `packages/app/src/session/revert.ts`, `packages/app/src/session/commands/` |
| Files | **Partial** | VCS-aware tree, persisted closable file tabs, native visible-line shaping and pixel scrolling, cached lazy Shiki highlighting, case-aware in-file search, character/line selection with native copy, external-editor launch, and persisted structured selection-to-prompt context | `packages/app/src/session/files/` |
| Review | **Partial** | Shiki-highlighted aligned side-by-side unified diffs, selectable text, old/new line selection, persisted editable inline comments, and structured comments-to-prompt context | `packages/app/src/session/review/`, `packages/app/src/composer/comments.tsx` |
| Terminal | **Partial** | Real OpenCode PTYs, ticketed WebSocket, ANSI terminal model, tabs, input/paste/control keys | `packages/app/src/session/terminal/` |
| Todos and MCP | **Partial** | Session todos, connected MCP count, and typed MCP resource mentions; no MCP management UI | `packages/app/src/composer/suggestions/`, `packages/app/src/shell/status/` |
| Native editing | **Partial** | Visible host-owned Unicode/IME multiline editing, selection, and text clipboard behavior with Solid-controlled value; no rich inline prompt tokens | `packages/app/src/composer/editor/` |
| Large lists | **Partial** | Native visible-line shaping for source files and upstream GPUI list/scrollbar virtualization for diffs and terminal | `packages/app/src/session/timeline/virtualizer.tsx`, `packages/app/src/session/files/virtual-scroll.ts` |

## Important missing product capabilities

These are the largest gaps, in implementation order rather than visual polish.

### Gap summary against current OpenCode v2

| Priority | Gap | Why it is material |
| --- | --- | --- |
| 1 | Projects, worktrees, and servers | OpenCode v2 is a multi-project workspace with sandbox/worktree creation, multiple authenticated servers, and per-server state. This clone now has a native project identity rail, opens additional project windows, and restores/reopens session tabs, but each window still owns one directory and one server. |
| 2 | Settings and providers | OpenCode v2 can connect/disconnect integrations, configure custom providers, expose models, and set themes/fonts/language/sounds/shell/layout/keybindings. This clone now covers recent/favorite models and variants but not provider authentication or settings. |
| 3 | Rich composer tokens and skills | The broader v2 `@` resource graph is implemented, including typed agent/resource parts, but this clone still renders mentions as native plain text plus attachment chips and has no skill picker. |
| 4 | Terminal workspace | OpenCode v2 has resizable dock/side layouts, reconnect, resize synchronization, reorderable and renameable terminals, selection/search/links, and mature terminal keyboard behavior. This clone has real PTYs and useful tabs but remains a basic terminal panel. |
| 5 | Desktop lifecycle | OpenCode v2 bundles/supervises its sidecar and adds updater/release notes, native notifications with navigation, unread/error badges, deep links, native menus, restored windows/routes, crash diagnostics, proxy/certificate integration, and WSL. The Solid GPUI bundle currently requires an installed OpenCode CLI and lacks those shell services. |
| 6 | File and review depth | OpenCode v2 has richer tree keyboard/drag behavior, changed/all-file modes, remembered view/scroll state, unified/split review, and denser file navigation. This clone covers the daily read/select/comment/review loop but not all workspace ergonomics or in-place editing. |

The transcript itself is no longer the largest discrepancy: streaming Markdown,
reasoning, context grouping, specialized tool cards, diffs/diagnostics, background
tasks, token pressure, retry/edit/revert/fork, questions, and permissions are all
represented. OpenCode v2 remains denser and more polished, but closing shell and
workspace gaps has substantially higher product value than adding more transcript cards.

### P0 — daily coding workflow

- [x] Stable-ID optimistic turns, guarded composer restoration, fresh edit/retry submissions, and paused failed queues
  (`packages/app/src/composer/history/`, `packages/app/src/composer/submission-state.ts`).
- [x] Native save-location export with reveal-in-folder confirmation (`packages/app/src/session/commands/`).

### P1 — complete OpenCode workspace

- [x] Persistent closable/reopenable session tabs and native opening of additional project windows.
- Worktrees/workspaces, multiple servers in one window, and WSL/remote scopes
  (`packages/app/src/new-session/`, `packages/app/src/servers/`, `packages/app/src/shell/tabs/`).
- [x] References, secondary agents, MCP resources, and recent files as structured prompt context.
- Skills and rich inline prompt tokens (`packages/app/src/composer/suggestions/`, `packages/app/src/composer/prompt-parts.ts`).
- In-place source editing.
- [x] Recent/favorite models and remembered model variants.
- Provider authentication and model/settings management.
- Terminal resize synchronization, search, links, selection/copy, scrollback, persisted workspace
  terminals, reorder/rename, and complete terminal key handling.

### P2 — desktop product shell

- Command palette and complete configurable keybindings (`packages/app/src/shell/commands/`).
- Settings UI, provider/account management, themes, localization, and accessibility behavior.
- Toasts and native notifications, deep links, updater/release notes, native menus/title bar,
  and broader platform integration (`packages/app/src/shell/`).

## Framework implications

The clone is feasible without turning Solid GPUI into an OpenCode-specific framework. Server,
session, prompt, and workspace state remain ordinary Solid code; SDK calls remain ordinary Node
code. Effect 4 now owns the desktop endpoint/server acquisition scope and cleanup, matching the
current v2 desktop's lifecycle boundary; Solid still owns interactive application state. The generic
framework work proven necessary so far is a controlled native text input bridge
(including IME and selection), event correctness, and host rendering compatibility.

Solid GPUI now has small generic primitives for controlled native input, read-only shaped selectable
text, native file/folder dialogs, external path drops, and structured clipboard text/path/image
payloads. Upstream's variable-height list and scrollbar now cover the desktop's large row surfaces.
The next likely framework capability is stronger accessibility/focus primitives;
those should only be added when a product feature reaches that boundary. Most remaining parity work belongs in `apps/opencode-desktop`, not in
`packages/solid-gpui` or the Rust host.
