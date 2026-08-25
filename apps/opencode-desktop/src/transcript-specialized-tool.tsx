import { createEffect, createSignal, For, Show, Switch, Match } from "solid-js";
import { codeHighlights } from "./code-surface-model.js";
import { openExternalURL } from "./open-editor.js";
import { highlightCode, highlightSource, type HighlightedSource } from "./source-highlighter.js";
import { color, interactive } from "./theme.js";
import { pathParts, type SpecializedTool, type ToolDiagnostic, type ToolFileChange } from "./transcript-specialized-tool-model.js";

const plain = (content: string): HighlightedSource => ({ language: "text", lines: content.split("\n").map((line) => [{ content: line }]) });
const openURL = (url: string) => void openExternalURL(url).catch(() => undefined);

function CodePreview(props: { path: string; content: string; diff?: boolean }) {
  const [highlighted, setHighlighted] = createSignal<HighlightedSource>();
  let generation = 0;
  createEffect(
    () => ({ path: props.path, content: props.content, diff: props.diff }),
    ({ path, content, diff }) => {
      const current = ++generation;
      setHighlighted(undefined);
      void (diff ? highlightCode("diff", content) : highlightSource(path, content)).then((source) => {
        if (current === generation) setHighlighted(source);
      });
    },
  );
  const source = () => highlighted() ?? plain(props.content);
  const lines = () => props.content.split("\n");
  const height = () => Math.min(340, Math.max(68, lines().length * 17 + 18));
  return (
    <codeSurface
      value={props.content}
      highlights={codeHighlights(lines(), source().lines)}
      lineNumbers={!props.diff}
      style={{ height: height(), flexShrink: 0, paddingX: 8, borderWidth: 1, borderColor: color.border, borderRadius: 6, background: "#181817", color: color.text }}
    />
  );
}

function Diagnostics(props: { items: ToolDiagnostic[] }) {
  return (
    <Show when={props.items.length > 0}>
      <div style={{ flexDirection: "column", gap: 4, padding: 8, borderWidth: 1, borderColor: "#5b3035", borderRadius: 6, background: "#302023" }}>
        <div style={{ color: color.red, fontSize: 9, fontWeight: "bold" }}>LSP ERRORS</div>
        <For each={props.items}>
          {(item) => <div style={{ color: "#e5b2b7", fontSize: 9, lineHeight: 14 }}>[{item.line}:{item.column}] {item.message}</div>}
        </For>
      </div>
    </Show>
  );
}

function Changes(props: { additions: number; deletions: number }) {
  return <Show when={props.additions + props.deletions > 0}><div style={{ gap: 5, fontSize: 9 }}><span style={{ color: color.green }}>+{props.additions}</span><span style={{ color: color.red }}>−{props.deletions}</span></div></Show>;
}

function PatchFile(props: { file: ToolFileChange }) {
  const [expanded, setExpanded] = createSignal(props.file.type !== "delete");
  const path = () => pathParts(props.file.relativePath);
  const operation = () => props.file.type === "add" ? "Created" : props.file.type === "delete" ? "Deleted" : props.file.type === "move" ? "Moved" : undefined;
  return (
    <div style={{ flexDirection: "column", borderWidth: 1, borderColor: color.border, borderRadius: 7, overflow: "hidden" }}>
      <div style={{ ...interactive, alignItems: "center", gap: 7, paddingX: 9, paddingY: 7, background: color.sidebar }} hoverStyle={{ background: color.raisedHover }} onClick={() => setExpanded((value) => !value)}>
        <div style={{ color: color.tertiary }}>▧</div>
        <div style={{ color: color.tertiary, fontSize: 9 }}>{path().directory}</div>
        <div style={{ color: color.text, fontSize: 10, fontWeight: "semibold" }}>{path().name}</div>
        <div style={{ flexGrow: 1 }} />
        <Show when={operation()} fallback={<Changes additions={props.file.additions} deletions={props.file.deletions} />}>
          {(label) => <div style={{ color: props.file.type === "delete" ? color.red : color.secondary, fontSize: 9 }}>{label()}{props.file.movePath ? ` → ${props.file.movePath}` : ""}</div>}
        </Show>
        <div style={{ color: color.tertiary, fontSize: 9 }}>{expanded() ? "▾" : "▸"}</div>
      </div>
      <Show when={expanded() && props.file.patch}>
        <CodePreview path={props.file.relativePath} content={props.file.patch!} diff />
      </Show>
    </div>
  );
}

export function specializedExpandable(tool: SpecializedTool): boolean {
  if (tool.kind === "webfetch") return false;
  if (tool.kind === "websearch") return tool.urls.length > 0;
  return true;
}

export function SpecializedToolHeading(props: { tool: SpecializedTool; active: boolean }) {
  const file = () => props.tool.kind === "edit" || props.tool.kind === "write"
    ? pathParts(props.tool.path)
    : props.tool.kind === "patch" && props.tool.files.length === 1 ? pathParts(props.tool.files[0]!.relativePath) : undefined;
  const subtitle = () => props.tool.kind === "websearch" ? props.tool.query
    : props.tool.kind === "webfetch" ? props.tool.url
    : props.tool.kind === "patch" && props.tool.files.length !== 1 ? `${props.tool.files.length} files`
    : file()?.directory;
  return (
    <div style={{ flexDirection: "column", gap: 2 }}>
      <div style={{ alignItems: "center", gap: 6 }}>
        <div style={{ color: color.text, fontSize: 11, fontWeight: "semibold" }}>{props.tool.title}</div>
        <Show when={!props.active && file()}>{(value) => <div style={{ color: color.secondary, fontSize: 10 }}>{value().name}</div>}</Show>
      </div>
      <Show when={(!props.active || props.tool.kind === "websearch") && subtitle()}>{(value) => (
        <div
          style={{ color: props.tool.kind === "webfetch" ? color.blue : color.tertiary, fontSize: 9, lineClamp: 1, textOverflow: "ellipsis" }}
          hoverStyle={props.tool.kind === "webfetch" ? { color: color.text } : undefined}
          onClick={() => props.tool.kind === "webfetch" && props.tool.url ? openURL(props.tool.url) : undefined}
        >
          {value()}{props.tool.kind === "webfetch" ? " ↗" : ""}
        </div>
      )}</Show>
    </div>
  );
}

export function SpecializedToolStats(props: { tool: SpecializedTool }) {
  const changes = () => props.tool.kind === "edit"
    ? { additions: props.tool.additions, deletions: props.tool.deletions }
    : props.tool.kind === "patch" && props.tool.files.length === 1
      ? { additions: props.tool.files[0]!.additions, deletions: props.tool.files[0]!.deletions }
      : undefined;
  return <Show when={changes()}>{(value) => <Changes additions={value().additions} deletions={value().deletions} />}</Show>;
}

export function SpecializedToolBody(props: { tool: SpecializedTool }) {
  return (
    <Switch>
      <Match when={props.tool.kind === "edit" ? props.tool : undefined}>
        {(tool) => <>
          <Show when={tool().patch} fallback={<>
            <Show when={tool().before}><div style={{ color: color.tertiary, fontSize: 9 }}>BEFORE</div><CodePreview path={tool().path} content={tool().before!} /></Show>
            <Show when={tool().after}><div style={{ color: color.tertiary, fontSize: 9 }}>AFTER</div><CodePreview path={tool().path} content={tool().after!} /></Show>
          </>}>
            {(patch) => <CodePreview path={tool().path} content={patch()} diff />}
          </Show>
          <Diagnostics items={tool().diagnostics} />
        </>}
      </Match>
      <Match when={props.tool.kind === "write" ? props.tool : undefined}>
        {(tool) => <><CodePreview path={tool().path} content={tool().content} /><Diagnostics items={tool().diagnostics} /></>}
      </Match>
      <Match when={props.tool.kind === "patch" ? props.tool : undefined}>
        {(tool) => <Show when={tool().files.length > 0} fallback={<div style={{ color: color.tertiary, fontSize: 9 }}>Waiting for patch metadata…</div>}>
          <For each={tool().files}>{(file) => <PatchFile file={file} />}</For>
        </Show>}
      </Match>
      <Match when={props.tool.kind === "websearch" ? props.tool : undefined}>
        {(tool) => <For each={tool().urls}>{(url) => (
          <div style={{ ...interactive, color: color.blue, fontSize: 10, lineClamp: 1, textOverflow: "ellipsis" }} hoverStyle={{ color: color.text, background: color.raisedHover }} onClick={() => openURL(url)}>↗ {url}</div>
        )}</For>}
      </Match>
    </Switch>
  );
}
