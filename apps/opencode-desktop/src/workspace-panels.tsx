import { For, Show } from "solid-js";
import type { OpenCodeController, OpenCodeState } from "./opencode.js";
import { color, interactive } from "./theme.js";
import { NativeRows } from "./native-rows.js";

const run = (action: () => Promise<unknown>) => void action().catch(() => undefined);

export function TodoDock(props: { state: OpenCodeState }) {
  const completed = () => props.state.todos.filter((todo) => todo.status === "completed").length;
  return (
    <Show when={props.state.todos.length > 0}>
      <div style={{ flexDirection: "column", gap: 6, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: color.border, borderRadius: 9, background: "#20201f" }}>
        <div style={{ alignItems: "center", color: color.secondary, fontSize: 10, fontWeight: "semibold" }}><div style={{ flexGrow: 1 }}>TASKS</div><div>{completed()}/{props.state.todos.length}</div></div>
        <For each={props.state.todos}>
          {(todo) => <div style={{ alignItems: "center", gap: 8, color: todo.status === "completed" ? color.tertiary : color.text, fontSize: 10 }}><div style={{ color: todo.status === "completed" ? color.green : todo.status === "in_progress" ? color.yellow : color.tertiary }}>{todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "●" : "○"}</div><div style={{ flexGrow: 1, lineClamp: 1, textOverflow: "ellipsis" }}>{todo.content}</div><div style={{ color: color.tertiary }}>{todo.priority}</div></div>}
        </For>
      </div>
    </Show>
  );
}

export function TerminalPanel(props: { state: OpenCodeState; controller: OpenCodeController }) {
  const lines = () => props.state.terminalOutput.split("\n").slice(-500);
  return (
    <div style={{ flexDirection: "column", flexGrow: 1, minHeight: 0, background: "#121211" }}>
      <div style={{ height: 40, flexShrink: 0, alignItems: "center", gap: 5, paddingX: 9, borderBottomWidth: 1, borderColor: color.border, background: color.sidebar }}>
        <For each={props.state.terminals}>
          {(terminal) => (
            <div
              style={{ ...interactive, paddingX: 9, paddingY: 6, background: props.state.terminal?.id === terminal.id ? color.raised : "transparent", color: props.state.terminal?.id === terminal.id ? color.text : color.tertiary, fontSize: 10 }}
              hoverStyle={{ background: color.raisedHover }}
              onClick={() => run(() => props.controller.selectTerminal(terminal))}
            >
              {terminal.title || terminal.command}
            </div>
          )}
        </For>
        <div style={{ ...interactive, paddingX: 9, paddingY: 6, color: color.accent, fontSize: 10 }} hoverStyle={{ background: color.raisedHover }} onClick={() => run(() => props.controller.createTerminal())}>＋ Terminal</div>
        <div style={{ flexGrow: 1 }} />
        <div style={{ color: props.state.terminalConnection === "open" ? color.green : props.state.terminalConnection === "error" ? color.red : color.tertiary, fontSize: 9 }}>● {props.state.terminalConnection}</div>
        <Show when={props.state.terminal}>
          <div style={{ ...interactive, paddingX: 8, paddingY: 5, color: color.red, fontSize: 10 }} hoverStyle={{ background: color.raisedHover }} onClick={() => run(() => props.controller.removeTerminal())}>Kill</div>
        </Show>
      </div>
      <Show
        when={props.state.terminal}
        fallback={
          <div style={{ flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 11 }}>
            <div style={{ color: color.tertiary, fontSize: 12 }}>No terminal is attached</div>
            <div style={{ ...interactive, paddingX: 12, paddingY: 8, borderRadius: 7, background: color.raised, color: color.text, fontSize: 11 }} hoverStyle={{ background: color.raisedHover }} onClick={() => run(() => props.controller.createTerminal())}>Start terminal</div>
          </div>
        }
      >
        <Show when={!props.state.terminalOutput}><div style={{ padding: 13, color: color.tertiary, fontFamily: "monospace", fontSize: 11 }}>Connecting to {props.state.terminal?.command}…</div></Show>
        <NativeRows items={lines()} rowHeight={17} visibleRows={38} followEnd style={{ padding: 13, fontFamily: "monospace", fontSize: 11, lineHeight: 17 }}>
          {(line) => <div>{line || " "}</div>}
        </NativeRows>
        <div style={{ height: 28, flexShrink: 0, alignItems: "center", paddingX: 13, borderTopWidth: 1, borderColor: color.border, color: color.tertiary, fontSize: 9 }}>
          Keyboard input is sent directly to the PTY · Ctrl/Cmd+V pastes · Ctrl+C interrupts
        </div>
      </Show>
    </div>
  );
}
