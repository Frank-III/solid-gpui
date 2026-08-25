import { randomUUID } from "node:crypto";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { ClickEvent, InputEvent, KeyEvent } from "solid-gpui";
import { codeHighlights } from "./code-surface-model.js";
import type { OpenCodeState } from "./opencode.js";
import { highlightSource, type HighlightedSource } from "./source-highlighter.js";
import { color, interactive } from "./theme.js";
import { NativeRows } from "./native-rows.js";
import { normalizeSelection, parseUnifiedPatch, selectionID, type DiffRow, type DiffSide, type LineSelection, type PromptContext } from "./workspace-model.js";

type DisplayRow = { type: "diff"; row: DiffRow } | { type: "comment"; comment: PromptContext };

function lineFor(row: DiffRow, side: DiffSide): number | undefined {
  return side === "old" ? row.oldLine : row.newLine;
}

function textFor(row: DiffRow, side: DiffSide): string | undefined {
  return side === "old" ? row.oldText : row.newText;
}

export function ReviewWorkspace(props: {
  state: OpenCodeState;
  contexts: PromptContext[];
  onContext: (context: PromptContext) => void;
  onUpdateContext: (id: string, comment: string) => void;
  onRemoveContext: (id: string) => void;
}) {
  const [path, setPath] = createSignal<string>();
  const [selection, setSelection] = createSignal<LineSelection>();
  const [commenting, setCommenting] = createSignal(false);
  const [comment, setComment] = createSignal("");
  const [editingID, setEditingID] = createSignal<string>();
  const [diffHighlight, setDiffHighlight] = createSignal<{ path: string; old: HighlightedSource; new: HighlightedSource }>();
  let highlightGeneration = 0;
  const diff = () => props.state.sessionDiffs.find((item) => item.file === path()) ?? props.state.sessionDiffs[0];
  createEffect(
    () => ({ diffs: props.state.sessionDiffs, selectedPath: path() }),
    ({ diffs, selectedPath }) => {
      if (!diffs.some((item) => item.file === selectedPath)) setPath(diffs[0]?.file);
    },
  );
  createEffect(
    () => path(),
    () => {
      setSelection(undefined);
      setCommenting(false);
      setComment("");
      setEditingID(undefined);
    },
  );
  const rows = createMemo(() => parseUnifiedPatch(diff()?.patch ?? ""));
  createEffect(
    () => ({
      path: diff()?.file,
      old: rows().map((row) => row.oldText ?? "").join("\n"),
      new: rows().map((row) => row.newText ?? "").join("\n"),
    }),
    ({ path, old, new: next }) => {
      const generation = ++highlightGeneration;
      setDiffHighlight(undefined);
      if (!path) return;
      void Promise.all([highlightSource(path, old), highlightSource(path, next)]).then(([oldSource, newSource]) => {
        if (generation === highlightGeneration) setDiffHighlight({ path, old: oldSource, new: newSource });
      });
    },
  );
  const comments = () => props.contexts.filter((item) => item.origin === "review" && item.comment && item.path === diff()?.file);
  const displayRows = createMemo<DisplayRow[]>(() => rows().flatMap((row) => {
    const attached = comments().filter((item) => item.endLine === lineFor(row, item.side ?? "new"));
    return [{ type: "diff" as const, row }, ...attached.map((comment) => ({ type: "comment" as const, comment }))];
  }));
  const selected = (side: DiffSide, line: number | undefined) => {
    const value = selection();
    return line !== undefined && value?.side === side && line >= value.startLine && line <= value.endLine;
  };
  const selectLine = (side: DiffSide, line: number | undefined, event: ClickEvent) => {
    const file = diff()?.file;
    if (!file || line === undefined) return;
    const previous = selection();
    setSelection(normalizeSelection({
      path: file,
      side,
      startLine: event.modifiers.shift && previous?.path === file && previous.side === side ? previous.startLine : line,
      endLine: line,
    }));
    setCommenting(false);
  };
  const preview = (value: LineSelection): string => rows()
    .filter((row) => {
      const line = lineFor(row, value.side ?? "new");
      return line !== undefined && line >= value.startLine && line <= value.endLine;
    })
    .map((row) => textFor(row, value.side ?? "new") ?? "")
    .join("\n");
  const addSelection = () => {
    const value = selection();
    if (!value) return;
    props.onContext({ ...value, id: `selection:${selectionID(value)}`, origin: "review", preview: preview(value) });
  };
  const submitComment = () => {
    const value = selection();
    const note = comment().trim();
    if (!value || !note) return;
    const editing = editingID();
    if (editing) props.onUpdateContext(editing, note);
    else props.onContext({ ...value, id: `comment:${randomUUID()}`, origin: "review", comment: note, preview: preview(value) });
    setComment("");
    setCommenting(false);
    setEditingID(undefined);
  };
  const cancelComment = () => {
    setComment("");
    setCommenting(false);
    setEditingID(undefined);
  };
  const startComment = () => {
    setComment("");
    setEditingID(undefined);
    setCommenting(true);
  };
  const editComment = (context: PromptContext) => {
    setSelection(normalizeSelection(context));
    setComment(context.comment ?? "");
    setEditingID(context.id);
    setCommenting(true);
  };
  const commentKeyDown = (event: KeyEvent) => {
    if (event.key === "escape") cancelComment();
    if (event.key === "enter" && !event.modifiers.shift) submitComment();
  };
  const rowHighlights = (row: DiffRow, side: DiffSide) => {
    const index = rows().indexOf(row);
    const source = diffHighlight();
    const line = textFor(row, side) ?? "";
    const tokens = source && source.path === diff()?.file ? source[side].lines[index] : undefined;
    return codeHighlights([line], [tokens ?? [{ content: line }]]);
  };

  return (
    <div style={{ flexGrow: 1, minHeight: 0 }}>
      <div style={{ width: 270, flexShrink: 0, flexDirection: "column", borderRightWidth: 1, borderColor: color.border, background: color.sidebar }}>
        <div style={{ height: 40, alignItems: "center", paddingX: 12, borderBottomWidth: 1, borderColor: color.border, color: color.secondary, fontSize: 10, fontWeight: "semibold" }}>SESSION CHANGES</div>
        <Show when={props.state.sessionDiffs.length > 0} fallback={<div style={{ padding: 14, color: color.tertiary, fontSize: 11 }}>No changes in this session</div>}>
          <For each={props.state.sessionDiffs}>
            {(item) => (
              <div style={{ ...interactive, alignItems: "center", gap: 8, minHeight: 34, paddingX: 11, background: diff() === item ? color.raised : "transparent", fontSize: 10 }} hoverStyle={{ background: color.raisedHover }} onClick={() => setPath(item.file)}>
                <div style={{ flexGrow: 1, lineClamp: 1, textOverflow: "ellipsis" }}>{item.file ?? "Changed file"}</div>
                <div style={{ color: color.green }}>+{item.additions}</div><div style={{ color: color.red }}>−{item.deletions}</div>
              </div>
            )}
          </For>
        </Show>
      </div>

      <div style={{ flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <Show when={diff()} fallback={<div style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", color: color.tertiary, fontSize: 12 }}>Select a changed file</div>}>
          {(active) => (
            <>
              <div style={{ height: 42, flexShrink: 0, alignItems: "center", gap: 9, paddingX: 12, borderBottomWidth: 1, borderColor: color.border, fontSize: 10 }}>
                <div style={{ flexGrow: 1, fontWeight: "semibold" }}>{active().file ?? "Changed file"}</div>
                <Show when={selection()}>{(value) => <div style={{ color: color.blue }}>{value().side === "old" ? "OLD" : "NEW"} · L{value().startLine}–{value().endLine}</div>}</Show>
                <Show when={selection()}>
                  <div style={{ ...interactive, paddingX: 8, paddingY: 5, color: color.blue }} hoverStyle={{ background: color.raisedHover }} onClick={addSelection}>Add selection</div>
                  <div style={{ ...interactive, paddingX: 8, paddingY: 5, background: "#253242", color: color.blue }} hoverStyle={{ background: "#2c3d51" }} onClick={startComment}>Comment</div>
                </Show>
              </div>
              <div style={{ height: 27, flexShrink: 0, alignItems: "center", borderBottomWidth: 1, borderColor: color.border, background: color.sidebar, color: color.tertiary, fontSize: 9 }}>
                <div style={{ width: "50%", paddingX: 12 }}>OLD</div><div style={{ width: "50%", paddingX: 12, borderLeftWidth: 1, borderColor: color.border }}>NEW</div>
              </div>
              <NativeRows items={displayRows()} rowHeight={24} visibleRows={34} style={{ background: "#161615", fontFamily: "monospace", fontSize: 10 }}>
                {(item) => (
                  <Show
                    when={item.type === "diff" ? item.row : undefined}
                    fallback={
                      <div style={{ height: 24, alignItems: "center", marginLeft: item.type === "comment" && item.comment.side === "old" ? 0 : "50%", width: "50%", paddingX: 9, background: "#26344a", color: "#c8d9ee", borderLeftWidth: 2, borderColor: color.blue }}>
                        <div style={{ flexGrow: 1, lineClamp: 1, textOverflow: "ellipsis" }}>↳ {item.type === "comment" ? item.comment.comment : ""}</div>
                        <Show when={item.type === "comment"}><div style={{ ...interactive, marginRight: 8, color: color.blue }} hoverStyle={{ color: color.text }} onClick={() => item.type === "comment" && editComment(item.comment)}>Edit</div></Show>
                        <Show when={item.type === "comment"}><div style={{ ...interactive, color: color.tertiary }} hoverStyle={{ color: color.text }} onClick={() => item.type === "comment" && props.onRemoveContext(item.comment.id)}>×</div></Show>
                      </div>
                    }
                  >
                    {(row) => (
                      <Show
                        when={row().kind !== "hunk"}
                        fallback={<div style={{ height: 24, alignItems: "center", paddingX: 10, background: "#1d2935", color: color.blue }}>{row().newText}</div>}
                      >
                        <For each={["old", "new"] as const}>
                          {(side) => {
                            const line = () => lineFor(row(), side);
                            const changed = () => row().kind === "change";
                            return (
                              <div style={{ ...interactive, width: "50%", height: 24, alignItems: "center", paddingX: 8, borderLeftWidth: side === "new" ? 1 : 0, borderColor: color.border, background: selected(side, line()) ? "#253c55" : changed() ? side === "old" ? "#3a2224" : "#1e3325" : "transparent", color: changed() ? side === "old" ? color.red : color.green : color.secondary }} hoverStyle={{ background: selected(side, line()) ? "#2c4865" : "#252422" }} onClick={(event) => selectLine(side, line(), event)}>
                                <text style={{ width: 38, flexShrink: 0, color: selected(side, line()) ? color.blue : color.tertiary }}>{line() ?? ""}</text>
                                <codeSurface
                                  value={textFor(row(), side) ?? ""}
                                  highlights={rowHighlights(row(), side)}
                                  style={{ flexGrow: 1, minWidth: 0, height: 24, color: changed() ? side === "old" ? color.red : color.green : color.secondary }}
                                />
                              </div>
                            );
                          }}
                        </For>
                      </Show>
                    )}
                  </Show>
                )}
              </NativeRows>
              <Show when={commenting()}>
                <div style={{ height: 52, flexShrink: 0, alignItems: "center", gap: 8, paddingX: 10, borderTopWidth: 1, borderColor: color.blue, background: "#1d2935" }}>
                  <div style={{ color: color.blue, fontSize: 10 }}>{editingID() ? "Edit comment" : "Review comment"}</div>
                  <div style={{ position: "relative", flexGrow: 1, height: 32, alignItems: "center", paddingX: 9, background: color.canvas, borderWidth: 1, borderColor: color.borderStrong, color: comment() ? color.text : color.tertiary, fontSize: 11 }}>
                    <div style={{ lineClamp: 1, textOverflow: "ellipsis" }}>{comment() || "Describe the issue or requested change…"}</div>
                    <input value={comment()} focused selectionStart={comment().length} selectionEnd={comment().length} style={{ position: "absolute", inset: 0, opacity: 0 }} onInput={(event: InputEvent) => setComment(event.value)} onKeyDown={commentKeyDown} />
                  </div>
                  <div style={{ ...interactive, paddingX: 10, paddingY: 7, color: color.tertiary, fontSize: 10 }} hoverStyle={{ background: color.raisedHover }} onClick={cancelComment}>Cancel</div>
                  <div style={{ ...interactive, paddingX: 10, paddingY: 7, background: color.blue, color: "#101820", fontSize: 10, fontWeight: "semibold" }} hoverStyle={{ opacity: 0.82 }} onClick={submitComment}>{editingID() ? "Save" : "Add comment"}</div>
                </div>
              </Show>
              <div style={{ height: 24, flexShrink: 0, alignItems: "center", paddingX: 12, borderTopWidth: 1, borderColor: color.border, color: color.tertiary, fontSize: 9 }}>Select either side · Shift-click to extend · Comments become prompt context</div>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
