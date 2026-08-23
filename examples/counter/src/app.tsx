import { createSignal, For } from "solid-js";
import { render } from "solid-gpui";
import type { GpuiStyle } from "solid-gpui";

const palette = {
  background: "#1e1e22",
  surface: "#2a2a30",
  border: "#3a3a44",
  text: "#e8e8ee",
  muted: "#9a9aa8",
  accent: "#7aa2f7",
};

const button: GpuiStyle = {
  paddingX: 14,
  paddingY: 8,
  borderRadius: 6,
  background: palette.surface,
  borderWidth: 1,
  borderColor: palette.border,
  color: palette.text,
  cursor: "pointer",
};

function Counter() {
  const [count, setCount] = createSignal(0);
  const [history, setHistory] = createSignal<number[]>([]);

  const record = (next: number) => {
    setCount(next);
    setHistory((entries) => [next, ...entries].slice(0, 8));
  };

  return (
    <div
      style={{
        flexDirection: "column",
        gap: 16,
        padding: 24,
        width: "100%",
        height: "100%",
        background: palette.background,
        color: palette.text,
        fontSize: 15,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: "semibold" }}>solid-gpui counter</div>

      <div style={{ alignItems: "center", gap: 12 }}>
        <div
          style={button}
          hoverStyle={{ background: "#34343c" }}
          activeStyle={{ opacity: 0.7 }}
          onClick={() => record(count() - 1)}
        >
          −
        </div>
        <div style={{ fontSize: 32, fontWeight: "bold", minWidth: 72, textAlign: "center" }}>
          {count()}
        </div>
        <div
          style={button}
          hoverStyle={{ background: "#34343c" }}
          activeStyle={{ opacity: 0.7 }}
          onClick={() => record(count() + 1)}
        >
          +
        </div>
        <div
          style={{ ...button, background: "transparent", color: palette.muted }}
          hoverStyle={{ color: palette.text }}
          onClick={() => {
            setCount(0);
            setHistory([]);
          }}
        >
          reset
        </div>
      </div>

      <div style={{ color: palette.muted, fontSize: 13 }}>
        Press a key to see keyboard events, or scroll to change the count.
      </div>

      <div
        style={{
          flexDirection: "column",
          gap: 6,
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: palette.border,
          flexGrow: 1,
          overflowY: "scroll",
        }}
        onScrollWheel={(event) => record(count() + Math.sign(event.delta.y))}
        onKeyDown={(event) => {
          if (event.key === "up") record(count() + 1);
          if (event.key === "down") record(count() - 1);
        }}
      >
        <For each={history()} fallback={<div style={{ color: palette.muted }}>no history yet</div>}>
          {(entry, index) => (
            <div style={{ justifyContent: "space-between" }}>
              <div style={{ color: palette.muted }}>#{index() + 1}</div>
              <div style={{ color: palette.accent, fontWeight: "medium" }}>{entry}</div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

await render(() => <Counter />, {
  title: "solid-gpui counter",
  width: 520,
  height: 460,
});
