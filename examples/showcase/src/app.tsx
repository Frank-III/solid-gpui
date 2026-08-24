import { createSignal, For, Show } from "solid-js";
import { appWindow, dialog, render, shell } from "solid-gpui";
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

/** Deterministic, so a reload draws the same chart. */
const SERIES = Array.from({ length: 24 }, (_, index) =>
  0.35 + 0.3 * Math.sin(index / 2.5) + 0.2 * Math.sin(index / 1.3),
);

const ROW_HEIGHT = 24;
const TOTAL_ROWS = 5000;
const OVERSCAN = 20;

const WORDS = [
  "gpui paints this from Rust",
  "a row here is as tall as its text, so the list has to measure each one",
  "short",
  "solid reconciles the tree and only the rows in view are ever built, which is what keeps a list of five thousand affordable even when every row wraps to a different height",
  "another line",
];

/** Deterministic filler, so a reload shows the same list. */
const messages = Array.from({ length: 2000 }, (_, index) => ({
  index,
  who: index % 3 === 0 ? "them" : "you",
  body: WORDS[index % WORDS.length]!,
}));

function App() {
  const [name, setName] = createSignal("");
  const [note, setNote] = createSignal("");
  const [focused, setFocused] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [dropped, setDropped] = createSignal<string | null>(null);
  const [range, setRange] = createSignal({ start: 0, end: 40 });
  const [chat, setChat] = createSignal({ start: 0, end: 20 });
  const [panelSize, setPanelSize] = createSignal({ width: 0, height: 0 });

  const first = () => Math.max(0, range().start - OVERSCAN);
  const last = () => Math.min(TOTAL_ROWS, range().end + OVERSCAN);
  const rows = () => Array.from({ length: last() - first() }, (_, index) => first() + index);

  const chatRows = () => messages.slice(chat().start, chat().end);

  return (
    <div
      keys={{ "cmd-shift-k": () => setNote("cmd-shift-k, application wide") }}
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
      <menu label="Showcase">
        <item label="Say hello" shortcut="cmd-shift-h" onSelect={() => setNote("hello from the menu")} />
        <separator />
        <item label="Reveal this project" onSelect={() => shell.revealPath(process.cwd())} />
      </menu>
      <menu label="Window">
        <item label="Minimise" shortcut="cmd-shift-m" onSelect={() => appWindow.minimize()} />
        <item label="Zoom" onSelect={() => appWindow.zoom()} />
        <item label="Full screen" shortcut="ctrl-cmd-f" onSelect={() => appWindow.toggleFullscreen()} />
      </menu>

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

          <input
            multiline
            rows={3}
            value={note()}
            placeholder="a multi-line field: it wraps, and return makes a new line"
            onInput={(event) => setNote(event.value)}
            style={{
              paddingX: 8,
              paddingY: 6,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: palette.border,
              background: palette.background,
            }}
          />

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

          <div style={heading}>COMMANDS AND KEYS</div>
          <div style={{ gap: 8 }}>
            <div
              style={button}
              hoverStyle={{ background: "#363642" }}
              onClick={async () => {
                const answer = await dialog.message({
                  message: "A platform message box",
                  detail: "Opened by the host, answered back over the pipe.",
                  answers: ["Fine", "Cancel"],
                });
                setNote(`you pressed ${answer === 0 ? "Fine" : "Cancel"}`);
              }}
            >
              message box
            </div>
            <div
              style={button}
              hoverStyle={{ background: "#363642" }}
              onClick={async () => {
                const picked = await dialog.openFile({ multiple: true });
                setNote(picked ? `picked ${picked.length} file(s)` : "cancelled");
              }}
            >
              open a file
            </div>
          </div>
          <div style={{ color: palette.muted, fontSize: 12 }}>
            cmd-shift-k anywhere, or the Showcase menu
          </div>

          <div style={heading}>CANVAS</div>
          <canvas
            style={{ height: 90, borderRadius: 6, background: palette.background }}
            draw={(ctx) => {
              const points = SERIES.length;
              const step = ctx.width / (points - 1 || 1);
              const scale = (value: number) => ctx.height - 8 - value * (ctx.height - 16);

              ctx.fillStyle = palette.raised;
              for (let index = 0; index < points; index += 1) {
                const height = SERIES[index]! * (ctx.height - 16);
                ctx.fillRect(index * step + 2, ctx.height - 8 - height, step - 4, height, 2);
              }

              ctx.strokeStyle = palette.accent;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(0, scale(SERIES[0]!));
              for (let index = 1; index < points; index += 1) {
                ctx.lineTo(index * step, scale(SERIES[index]!));
              }
              ctx.stroke();

              ctx.fillStyle = palette.muted;
              ctx.fontSize = 10;
              ctx.fillText(`${points} points, drawn from JavaScript`, 4, 2);
            }}
          />

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
          <scrollbar
            style={{ flexGrow: 1, minHeight: 0 }}
            thumbStyle={{ background: "#ffffff35", borderRadius: 4, minHeight: 24 }}
          >
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
          </scrollbar>
          <div style={{ color: palette.muted, fontSize: 12 }}>
            rendered {first()}–{last()} · viewport {range().start}–{range().end}
          </div>
        </div>

        <div
          style={{ ...panel, flexGrow: 1, minWidth: 260 }}
          onResize={(size) => setPanelSize(size)}
        >
          <div style={heading}>
            RICH TEXT — PANEL IS {Math.round(panelSize().width)}×
            {Math.round(panelSize().height)}
          </div>
          <text style={{ lineHeight: 20 }}>
            One string, laid out once, so a line can wrap between{" "}
            <span style={{ color: palette.accent, fontWeight: "semibold" }}>two</span>{" "}
            <span style={{ color: palette.good, fontStyle: "italic" }}>differently</span>{" "}
            styled runs. This one{" "}
            <span
              style={{ color: palette.accent, underline: true, cursor: "pointer" }}
              onClick={() => setDropped("the link was clicked")}
            >
              answers a click
            </span>
            , and this one{" "}
            <span style={{ fadeOut: 0.6 }}>fades into the background</span>.
          </text>

          <div style={heading}>VARIABLE-HEIGHT LIST — {messages.length} ROWS</div>
          <list
            count={messages.length}
            start={chat().start}
            align="bottom"
            follow="tail"
            itemHeight={40}
            onRange={(event) => setChat(event)}
            style={{ flexGrow: 1, borderRadius: 6, background: palette.background }}
          >
            <For each={chatRows()}>
              {(message) => (
                <div
                  style={{
                    flexDirection: "column",
                    gap: 2,
                    paddingX: 8,
                    paddingY: 6,
                    borderBottomWidth: 1,
                    borderColor: palette.border,
                  }}
                >
                  <div style={{ fontSize: 11, color: palette.muted }}>
                    #{message.index} · {message.who}
                  </div>
                  <text style={{ color: message.who === "you" ? palette.text : palette.muted }}>
                    {message.body}
                  </text>
                </div>
              )}
            </For>
          </list>
          <div style={{ color: palette.muted, fontSize: 12 }}>
            rendered {chat().start}–{chat().end}
          </div>
        </div>
      </div>
    </div>
  );
}

await render(() => <App />, {
  title: "solid-gpui showcase",
  width: 1180,
  height: 640,
});
