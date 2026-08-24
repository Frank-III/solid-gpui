import { createSignal, For, Show } from "solid-js";
import { render } from "solid-gpui";
import type { GpuiStyle } from "solid-gpui";

const palette = {
  background: "#16161c",
  surface: "#22222a",
  raised: "#2c2c36",
  border: "#3a3a46",
  text: "#e8e8ee",
  muted: "#9a9aa8",
  accent: "#7aa2f7",
  good: "#9ece6a",
};

const panel: GpuiStyle = {
  flexDirection: "column",
  gap: 8,
  padding: 12,
  borderWidth: 1,
  borderColor: palette.border,
  borderRadius: 8,
  background: palette.surface,
};

const button: GpuiStyle = {
  paddingX: 12,
  paddingY: 6,
  borderRadius: 6,
  borderWidth: 1,
  borderColor: palette.border,
  background: palette.raised,
  cursor: "pointer",
};

const heading: GpuiStyle = { fontSize: 12, fontWeight: "semibold", color: palette.muted };

const ROW_HEIGHT = 24;
const TOTAL_ROWS = 5000;
const OVERSCAN = 20;

function App() {
  const [name, setName] = createSignal("");
  const [focused, setFocused] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [dropped, setDropped] = createSignal<string | null>(null);
  const [range, setRange] = createSignal({ start: 0, end: 40 });

  const first = () => Math.max(0, range().start - OVERSCAN);
  const last = () => Math.min(TOTAL_ROWS, range().end + OVERSCAN);
  const rows = () => Array.from({ length: last() - first() }, (_, index) => first() + index);

  return (
    <div
      style={{
        flexDirection: "column",
        gap: 12,
        padding: 16,
        width: "100%",
        height: "100%",
        background: palette.background,
        color: palette.text,
        fontSize: 14,
      }}
    >
      <div style={{ alignItems: "center", gap: 8 }}>
        <div
          style={{ size: 10, borderRadius: 5, background: palette.accent }}
          animate={{
            duration: 900,
            repeat: true,
            easing: "bounce",
            from: { opacity: 0.25, background: palette.accent },
            to: { opacity: 1, background: palette.good },
          }}
        />
        <div style={{ fontSize: 18, fontWeight: "bold" }}>solid-gpui showcase</div>
      </div>

      <div style={{ gap: 12, flexGrow: 1 }}>
        <div style={{ ...panel, flexGrow: 1 }}>
          <div style={heading}>TEXT INPUT</div>
          <input
            autofocus
            value={name()}
            placeholder="type your name"
            onInput={(event) => setName(event.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              paddingX: 8,
              paddingY: 6,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: focused() ? palette.accent : palette.border,
              background: palette.background,
            }}
          />
          <div style={{ color: palette.muted, fontSize: 12 }}>
            <Show when={name()} fallback={<div>waiting for input…</div>}>
              <div>hello, {name()}</div>
            </Show>
          </div>

          <div style={heading}>TOOLTIP AND POPOVER</div>
          <div style={{ gap: 8, alignItems: "center" }}>
            <div
              style={button}
              hoverStyle={{ background: "#363642", borderColor: palette.accent }}
              tooltip={
                <div style={{ ...panel, gap: 2, maxWidth: 220 }}>
                  <div style={{ fontWeight: "semibold" }}>A rich tooltip</div>
                  <div style={{ color: palette.muted, fontSize: 12 }}>
                    Built from JSX, not a plain string. gpui waits half a second
                    before showing it.
                  </div>
                </div>
              }
            >
              hover me
            </div>
            <div
              style={button}
              hoverStyle={{ background: "#363642" }}
              activeStyle={{ opacity: 0.7 }}
              onClick={() => setMenuOpen(!menuOpen())}
            >
              {menuOpen() ? "close menu" : "open menu"}
            </div>
          </div>
          <Show when={menuOpen()}>
            <deferred priority={1}>
              <anchored anchor="top-left" snapToWindow snapMargin={8}>
                <div style={{ ...panel, background: palette.raised, gap: 2, minWidth: 160 }}>
                  <For each={["Rename", "Duplicate", "Delete"]}>
                    {(item) => (
                      <div
                        style={{ paddingX: 8, paddingY: 4, borderRadius: 4 }}
                        hoverStyle={{ background: palette.accent, color: palette.background }}
                        onClick={() => setMenuOpen(false)}
                      >
                        {item}
                      </div>
                    )}
                  </For>
                </div>
              </anchored>
            </deferred>
          </Show>

          <div style={heading}>DRAG AND DROP</div>
          <div style={{ gap: 8 }}>
            <div style={{ ...button, cursor: "grab" }} dragData={{ label: "a token" }}>
              drag me
            </div>
            <div
              style={{
                ...button,
                background: "transparent",
                borderStyle: "dashed",
                color: palette.muted,
              }}
              dragOverStyle={{ borderColor: palette.accent, color: palette.text }}
              onDrop={(event) => setDropped((event.data as { label: string }).label)}
            >
              {dropped() ?? "drop here"}
            </div>
          </div>
        </div>

        <div style={{ ...panel, flexGrow: 1, minWidth: 240 }}>
          <div style={heading}>VIRTUALISED LIST — {TOTAL_ROWS} ROWS</div>
          <uniform-list
            count={TOTAL_ROWS}
            start={first()}
            onRange={(event) => setRange(event)}
            style={{ flexGrow: 1, borderRadius: 6, background: palette.background }}
          >
            <For each={rows()}>
              {(index) => (
                <div
                  style={{
                    height: ROW_HEIGHT,
                    alignItems: "center",
                    paddingX: 8,
                    gap: 8,
                    color: index % 2 === 0 ? palette.text : palette.muted,
                  }}
                >
                  <div style={{ minWidth: 48, color: palette.muted, fontSize: 12 }}>{index}</div>
                  <div>row number {index}</div>
                </div>
              )}
            </For>
          </uniform-list>
          <div style={{ color: palette.muted, fontSize: 12 }}>
            rendered {first()}–{last()} · viewport {range().start}–{range().end}
          </div>
        </div>
      </div>
    </div>
  );
}

await render(() => <App />, {
  title: "solid-gpui showcase",
  width: 820,
  height: 620,
});
