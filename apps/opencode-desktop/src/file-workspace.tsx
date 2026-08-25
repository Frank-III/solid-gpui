import { extname } from "node:path";
import clipboard from "clipboardy";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { InputEvent, KeyEvent, SelectionChangeEvent } from "solid-gpui";
import { codeHighlights, lineSelection, selectedSourceText, type TextSelection } from "./code-surface-model.js";
import type { OpenCodeController, OpenCodeState } from "./opencode.js";
import { openProjectFile } from "./open-editor.js";
import { highlightSource, type HighlightedSource, type SourceToken } from "./source-highlighter.js";
import { findSourceMatches } from "./source-search.js";
import { color, interactive } from "./theme.js";
import type { LineSelection } from "./workspace-model.js";

const run = (action: () => Promise<unknown>) => void action().catch(() => undefined);

function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function filename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function language(path: string): string {
  const extension = extname(path).slice(1).toUpperCase();
  return extension || "TEXT";
}

function fileTone(status: string | undefined): string {
  if (status === "added") return color.green;
  if (status === "deleted") return color.red;
  if (status === "modified") return color.yellow;
  return color.text;
}

export function FileWorkspace(props: {
  state: OpenCodeState;
  controller: OpenCodeController;
  onAttach?: (path: string, mime?: string) => void;
  onContext: (selection: LineSelection, preview: string) => void;
}) {
  const [textSelection, setTextSelection] = createSignal<TextSelection>({ start: 0, end: 0 });
  const [highlighted, setHighlighted] = createSignal<{ path: string; content: string; source: HighlightedSource }>();
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [activeMatch, setActiveMatch] = createSignal(0);
  const [fileAction, setFileAction] = createSignal<string>();
  let highlightGeneration = 0;
  const changed = (path: string) => props.state.fileStatus.find((item) => item.file === path);
  const active = () => props.state.openFiles.find((file) => file.path === props.state.selectedFile);
  const rawLines = createMemo(() => {
    const content = active()?.content;
    return content?.type === "text" ? content.content.split("\n") : [];
  });
  const tokens = createMemo<SourceToken[][]>(() => {
    const file = active();
    if (file?.content?.type !== "text") return [];
    const result = highlighted();
    return result?.path === file.path && result.content === file.content.content
      ? result.source.lines
      : rawLines().map((line) => [{ content: line }]);
  });
  const matches = createMemo(() => findSourceMatches(rawLines(), searchQuery(), caseSensitive()));
  const highlights = createMemo(() => codeHighlights(rawLines(), tokens(), matches(), activeMatch()));
  const currentMatch = () => matches()[activeMatch()];
  const selection = createMemo(() => {
    const file = active();
    return file?.content?.type === "text" ? lineSelection(file.path, file.content.content, textSelection()) : undefined;
  });
  createEffect(
    () => props.state.selectedFile,
    () => {
      setTextSelection({ start: 0, end: 0 });
      setSearchOpen(false);
      setSearchQuery("");
      setActiveMatch(0);
      setFileAction(undefined);
    },
  );
  createEffect(
    () => {
      const file = active();
      return { path: file?.path, content: file?.content?.type === "text" ? file.content.content : undefined };
    },
    ({ path, content }) => {
      const generation = ++highlightGeneration;
      setHighlighted(undefined);
      if (!path || content === undefined) return;
      void highlightSource(path, content).then((source) => {
        if (generation === highlightGeneration) setHighlighted({ path, content, source });
      });
    },
  );
  createEffect(
    () => matches().length,
    (length) => { setActiveMatch((current) => length === 0 ? 0 : Math.min(current, length - 1)); },
  );
  const addSelection = () => {
    const value = selection();
    const content = active()?.content;
    if (!value || content?.type !== "text") return;
    props.onContext(value, selectedSourceText(content.content, textSelection()));
  };
  const copySelection = () => {
    const value = selection();
    const content = active()?.content;
    if (!value || content?.type !== "text") return;
    void clipboard.write(selectedSourceText(content.content, textSelection()))
      .then(() => setFileAction("Copied selection"))
      .catch(() => setFileAction("Copy failed"));
  };
  const openInEditor = () => {
    const file = active();
    if (!file) return;
    setFileAction("Opening editor…");
    void openProjectFile(props.state.directory, file.path, selection()?.startLine)
      .then((editor) => setFileAction(`Opened in ${editor}`))
      .catch(() => setFileAction("Set OPENCODE_EDITOR to open files"));
  };
  const moveMatch = (amount: number) => {
    if (matches().length === 0) return;
    setActiveMatch((current) => (current + amount + matches().length) % matches().length);
  };
  const selectText = (event: SelectionChangeEvent) => setTextSelection({ start: event.selectionStart, end: event.selectionEnd });
  const keyDown = (event: KeyEvent) => {
    const shortcut = event.modifiers.platform || event.modifiers.control;
    if (shortcut && event.key === "f") {
      setSearchOpen(true);
      return;
    }
    if (!searchOpen()) return;
    if (event.key === "escape") { setSearchOpen(false); return; }
    if (event.key === "enter") moveMatch(event.modifiers.shift ? -1 : 1);
  };

  return (
    <div style={{ flexGrow: 1, minHeight: 0 }} onKeyDown={keyDown}>
      <div style={{ width: 290, flexShrink: 0, flexDirection: "column", borderRightWidth: 1, borderColor: color.border, background: color.sidebar }}>
        <div style={{ height: 40, alignItems: "center", gap: 8, paddingX: 11, borderBottomWidth: 1, borderColor: color.border }}>
          <Show when={props.state.browsePath}>
            <div style={{ ...interactive, paddingX: 7, paddingY: 5, color: color.secondary, fontSize: 11 }} hoverStyle={{ background: color.raisedHover }} onClick={() => run(() => props.controller.browse(parentPath(props.state.browsePath)))}>‹</div>
          </Show>
          <div style={{ flexGrow: 1, color: color.secondary, fontSize: 10, lineClamp: 1, textOverflow: "ellipsis" }}>/{props.state.browsePath}</div>
          <div style={{ ...interactive, paddingX: 7, paddingY: 5, color: color.secondary, fontSize: 11 }} hoverStyle={{ background: color.raisedHover }} onClick={() => run(() => props.controller.loadWorkspace())}>↻</div>
        </div>
        <div style={{ flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", padding: 6 }}>
          <For each={props.state.files}>
            {(file) => {
              const status = () => changed(file.path);
              return (
                <div
                  style={{ ...interactive, alignItems: "center", gap: 8, minHeight: 30, paddingX: 8, background: props.state.selectedFile === file.path ? color.raised : "transparent" }}
                  hoverStyle={{ background: color.raisedHover }}
                  onClick={() => file.type === "directory" ? run(() => props.controller.browse(file.path)) : run(() => props.controller.openFile(file.path))}
                >
                  <div style={{ width: 13, color: file.type === "directory" ? color.accent : color.tertiary, fontSize: 11 }}>{file.type === "directory" ? "▸" : "·"}</div>
                  <div style={{ flexGrow: 1, color: fileTone(status()?.status), fontSize: 11, lineClamp: 1, textOverflow: "ellipsis" }}>{file.name}</div>
                  <Show when={status()}>{(item) => <div style={{ color: color.tertiary, fontSize: 9 }}>+{item().additions} −{item().deletions}</div>}</Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      <div style={{ flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
        <Show when={props.state.openFiles.length > 0}>
          <div style={{ height: 38, flexShrink: 0, alignItems: "stretch", overflowX: "scroll", borderBottomWidth: 1, borderColor: color.border, background: color.sidebar }}>
            <For each={props.state.openFiles}>
              {(file) => (
                <div style={{ ...interactive, alignItems: "center", gap: 8, minWidth: 130, maxWidth: 230, paddingX: 11, borderRightWidth: 1, borderColor: color.border, background: props.state.selectedFile === file.path ? color.canvas : "transparent", color: props.state.selectedFile === file.path ? color.text : color.tertiary, fontSize: 10 }} onClick={() => props.controller.selectOpenFile(file.path)}>
                  <div style={{ flexGrow: 1, lineClamp: 1, textOverflow: "ellipsis" }}>{filename(file.path)}</div>
                  <Show when={file.loading}><div style={{ color: color.yellow }}>●</div></Show>
                  <div style={{ ...interactive }} hoverStyle={{ color: color.text }} onClick={() => props.controller.closeFile(file.path)}>×</div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={active()} fallback={<div style={{ flexGrow: 1, alignItems: "center", justifyContent: "center", color: color.tertiary, fontSize: 12 }}>Select a file to inspect it</div>}>
          {(file) => (
            <>
              <div style={{ height: 40, flexShrink: 0, alignItems: "center", gap: 10, paddingX: 13, borderBottomWidth: 1, borderColor: color.border, color: color.secondary, fontSize: 10 }}>
                <div style={{ flexGrow: 1, lineClamp: 1, textOverflow: "ellipsis" }}>{file().path}</div>
                <div style={{ color: color.tertiary }}>{highlighted()?.path === file().path ? highlighted()!.source.language.toUpperCase() : language(file().path)}</div>
                <div style={{ ...interactive, paddingX: 8, paddingY: 5, color: searchOpen() ? color.blue : color.tertiary }} hoverStyle={{ background: color.raisedHover, color: color.text }} onClick={() => setSearchOpen((value) => !value)}>⌕ Find</div>
                <Show when={selection()}>{(value) => <div style={{ color: color.blue }}>L{value().startLine}–{value().endLine}</div>}</Show>
                <Show when={selection()}><div style={{ ...interactive, paddingX: 8, paddingY: 5, color: color.secondary }} hoverStyle={{ background: color.raisedHover }} onClick={copySelection}>Copy</div></Show>
                <Show when={selection()}><div style={{ ...interactive, paddingX: 8, paddingY: 5, background: "#253242", color: color.blue }} hoverStyle={{ background: "#2c3d51" }} onClick={addSelection}>Add selection</div></Show>
                <Show when={props.onAttach}><div style={{ ...interactive, paddingX: 8, paddingY: 5, color: color.secondary }} hoverStyle={{ background: color.raisedHover }} onClick={() => props.onAttach?.(file().path, file().content?.mimeType)}>Attach file</div></Show>
                <div style={{ ...interactive, paddingX: 8, paddingY: 5, color: color.secondary }} hoverStyle={{ background: color.raisedHover }} onClick={openInEditor}>Open in editor</div>
              </div>
              <Show when={searchOpen()}>
                <div style={{ height: 40, flexShrink: 0, alignItems: "center", gap: 7, paddingX: 10, borderBottomWidth: 1, borderColor: color.border, background: color.sidebar }}>
                  <div style={{ position: "relative", flexGrow: 1, height: 28, alignItems: "center", paddingX: 8, borderWidth: 1, borderColor: color.borderStrong, background: color.canvas, color: searchQuery() ? color.text : color.tertiary, fontSize: 10 }}>
                    <div style={{ lineClamp: 1, textOverflow: "ellipsis" }}>{searchQuery() || "Find in file"}</div>
                    <input value={searchQuery()} focused selectionStart={searchQuery().length} selectionEnd={searchQuery().length} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: 0 }} onInput={(event: InputEvent) => { setSearchQuery(event.value); setActiveMatch(0); }} />
                  </div>
                  <div style={{ ...interactive, paddingX: 7, paddingY: 5, background: caseSensitive() ? "#253242" : "transparent", color: caseSensitive() ? color.blue : color.tertiary, fontSize: 10 }} hoverStyle={{ background: color.raisedHover }} onClick={() => setCaseSensitive((value) => !value)}>Aa</div>
                  <div style={{ width: 58, color: color.tertiary, fontSize: 9, textAlign: "center" }}>{matches().length ? `${activeMatch() + 1} / ${matches().length}` : searchQuery() ? "No results" : "0 / 0"}</div>
                  <div style={{ ...interactive, paddingX: 7, paddingY: 5, color: color.secondary }} hoverStyle={{ background: color.raisedHover }} onClick={() => moveMatch(-1)}>↑</div>
                  <div style={{ ...interactive, paddingX: 7, paddingY: 5, color: color.secondary }} hoverStyle={{ background: color.raisedHover }} onClick={() => moveMatch(1)}>↓</div>
                  <div style={{ ...interactive, paddingX: 7, paddingY: 5, color: color.tertiary }} hoverStyle={{ background: color.raisedHover, color: color.text }} onClick={() => setSearchOpen(false)}>×</div>
                </div>
              </Show>
              <div style={{ flexDirection: "column", flexGrow: 1, minHeight: 0, background: "#161615", fontFamily: "monospace", fontSize: 10, lineHeight: 17 }}>
                <Show when={file().content} fallback={<div style={{ padding: 14, color: color.tertiary }}>Loading…</div>}>
                  {(content) => (
                    <Show when={content().type === "text"} fallback={<div style={{ padding: 14, color: color.tertiary }}>Binary file · {content().mimeType ?? "unknown type"}</div>}>
                      <codeSurface
                        value={content().content}
                        selectionStart={textSelection().start}
                        selectionEnd={textSelection().end}
                        highlights={highlights()}
                        lineNumbers
                        scrollToLine={currentMatch()?.line}
                        style={{ flexGrow: 1, minHeight: 0, paddingX: 8, color: color.text }}
                        onSelectionChange={selectText}
                      />
                    </Show>
                  )}
                </Show>
              </div>
              <div style={{ height: 24, flexShrink: 0, alignItems: "center", paddingX: 13, borderTopWidth: 1, borderColor: color.border, color: color.tertiary, fontSize: 9 }}>
                <div>Drag to select text · Click a line number for the row · Ctrl/Cmd+C copies natively</div>
                <div style={{ flexGrow: 1 }} />
                <Show when={fileAction()}>{(status) => <div style={{ color: color.secondary }}>{status()}</div>}</Show>
              </div>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
