import { createMemo, createSignal, Show } from "solid-js";
import type { OpenCodeState } from "./opencode.js";
import { color, interactive } from "./theme.js";
import { transcriptContextMetrics } from "./transcript-context-model.js";

const number = (value: number) => value.toLocaleString();

export function TranscriptContext(props: { state: OpenCodeState }) {
  const [expanded, setExpanded] = createSignal(false);
  const session = () => props.state.sessions.find((item) => item.id === props.state.selectedID);
  const metrics = createMemo(() => transcriptContextMetrics(props.state.messages, props.state.models, session()));
  return (
    <Show when={metrics()}>
      {(usage) => (
        <div style={{ flexDirection: "column", marginBottom: 24 }}>
          <div style={{ ...interactive, alignItems: "center", gap: 7, paddingX: 2, paddingY: 5 }} hoverStyle={{ color: color.text }} onClick={() => setExpanded((value) => !value)}>
            <div style={{ color: usage().contextPercent !== undefined && usage().contextPercent! >= 80 ? color.yellow : color.green, fontSize: 11 }}>◔</div>
            <div style={{ color: color.secondary, fontSize: 11 }}>Context</div>
            <div style={{ color: color.text, fontSize: 11, fontWeight: 530 }}>{usage().contextPercent === undefined ? number(usage().total) : `${usage().contextPercent}%`}</div>
            <Show when={usage().contextLimit}><div style={{ color: color.tertiary, fontSize: 11 }}>{number(usage().total)} / {number(usage().contextLimit!)}</div></Show>
            <div style={{ flexGrow: 1 }} />
            <div style={{ color: color.tertiary, fontSize: 11 }}>{usage().model} · ${usage().cost.toFixed(4)}</div>
            <div style={{ color: color.tertiary, fontSize: 11 }}>{expanded() ? "▾" : "▸"}</div>
          </div>
          <Show when={expanded()}>
            <div style={{ gap: 16, flexWrap: "wrap", marginTop: 5, paddingX: 10, paddingBottom: 9, borderLeftWidth: 2, borderColor: color.borderStrong, color: color.tertiary, fontSize: 9 }}>
              <text style={{ paddingTop: 8 }}>Input <span style={{ color: color.text }}>{number(usage().input)}</span></text>
              <text style={{ paddingTop: 8 }}>Output <span style={{ color: color.text }}>{number(usage().output)}</span></text>
              <text style={{ paddingTop: 8 }}>Reasoning <span style={{ color: color.text }}>{number(usage().reasoning)}</span></text>
              <text style={{ paddingTop: 8 }}>Cache read/write <span style={{ color: color.text }}>{number(usage().cacheRead)} / {number(usage().cacheWrite)}</span></text>
              <text style={{ paddingTop: 8 }}>Agent <span style={{ color: color.text }}>{usage().agent}</span></text>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
