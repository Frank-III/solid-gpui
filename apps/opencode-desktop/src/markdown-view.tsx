import clipboard from "clipboardy";
import { createEffect, createMemo, createSignal, For, Show, Switch, Match } from "solid-js";
import type { GpuiStyle } from "solid-gpui";
import { highlightCode, type HighlightedSource, type SourceToken } from "./source-highlighter.js";
import { color, interactive } from "./theme.js";
import { parseInlineMarkdown, parseTranscriptMarkdown } from "./transcript-model.js";

function runStyle(kind: ReturnType<typeof parseInlineMarkdown>[number]["kind"]): GpuiStyle | undefined {
  if (kind === "code") return { fontFamily: "monospace", background: "#ffffff12", color: "#d7cfae" };
  if (kind === "strong") return { fontWeight: "bold", color: color.text };
  if (kind === "emphasis") return { fontStyle: "italic" };
  if (kind === "strike") return { strikethrough: true, color: color.tertiary };
  if (kind === "link") return { color: color.blue, underline: true };
  return undefined;
}

function InlineText(props: { text: string; style?: GpuiStyle }) {
  const runs = createMemo(() => parseInlineMarkdown(props.text));
  return (
    <text style={props.style}>
      <For each={runs()}>
        {(run) => run.kind === "text" ? run.text : <span style={runStyle(run.kind)}>{run.text}</span>}
      </For>
    </text>
  );
}

const plain = (content: string): HighlightedSource => ({
  language: "text",
  lines: content.split("\n").map((line) => [{ content: line }]),
});

function tokenStyle(token: SourceToken): GpuiStyle {
  return {
    color: token.color ?? "#c7c5c1",
    ...(token.fontStyle && token.fontStyle & 1 ? { fontStyle: "italic" as const } : {}),
    ...(token.fontStyle && token.fontStyle & 2 ? { fontWeight: "bold" as const } : {}),
    ...(token.fontStyle && token.fontStyle & 4 ? { underline: true } : {}),
  };
}

function HighlightedCode(props: { language: string; text: string }) {
  const [highlighted, setHighlighted] = createSignal<HighlightedSource>();
  let generation = 0;
  createEffect(
    () => ({ language: props.language, text: props.text }),
    ({ language, text }) => {
      const current = ++generation;
      setHighlighted(undefined);
      void highlightCode(language, text).then((source) => {
        if (current === generation) setHighlighted(source);
      });
    },
  );
  const source = () => highlighted() ?? plain(props.text);
  return (
    <div style={{ flexDirection: "column", maxHeight: 360, overflowY: "scroll", padding: 11, background: "#20201f", fontFamily: "monospace", fontSize: 11, lineHeight: 17 }}>
      <For each={source().lines}>
        {(line) => (
          <text>
            <Show when={line.length > 0} fallback=" ">
              <For each={line}>{(token) => <span style={tokenStyle(token)}>{token.content}</span>}</For>
            </Show>
          </text>
        )}
      </For>
    </div>
  );
}

export function RichText(props: { text: string }) {
  const blocks = createMemo(() => parseTranscriptMarkdown(props.text));
  return (
    <div style={{ flexDirection: "column", gap: 8 }}>
      <For each={blocks()}>
        {(block) => (
          <Switch>
            <Match when={block.kind === "heading"}>
              <InlineText text={block.text} style={{ fontSize: 15, fontWeight: "bold" }} />
            </Match>
            <Match when={block.kind === "bullet" || block.kind === "numbered"}>
              <div style={{ alignItems: "start", gap: 9, color: color.secondary, fontSize: 14, lineHeight: 22 }}>
                <div style={{ color: color.accent }}>{block.marker}</div>
                <InlineText text={block.text} style={{ flexGrow: 1 }} />
              </div>
            </Match>
            <Match when={block.kind === "code"}>
              <div style={{ flexDirection: "column", borderWidth: 1, borderColor: color.borderStrong, borderRadius: 8, background: "#20201f", overflow: "hidden" }}>
                <div style={{ alignItems: "center", paddingX: 11, paddingY: 7, borderBottomWidth: 1, borderColor: color.border }}>
                  <div style={{ color: color.tertiary, fontSize: 10 }}>{block.language || "text"}</div>
                  <div style={{ flexGrow: 1 }} />
                  <div style={{ ...interactive, color: color.tertiary, fontSize: 9 }} hoverStyle={{ color: color.text }} onClick={() => void clipboard.write(block.text)}>Copy</div>
                </div>
                <HighlightedCode language={block.language ?? ""} text={block.text} />
              </div>
            </Match>
            <Match when={block.kind === "quote"}>
              <div style={{ paddingLeft: 10, borderLeftWidth: 2, borderColor: color.borderStrong }}>
                <InlineText text={block.text} style={{ color: color.secondary, fontSize: 14, lineHeight: 22 }} />
              </div>
            </Match>
            <Match when={block.kind === "space"}><div style={{ height: 4 }} /></Match>
            <Match when={block.kind === "paragraph"}>
              <InlineText text={block.text} style={{ color: color.text, fontSize: 14, lineHeight: 22 }} />
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}
