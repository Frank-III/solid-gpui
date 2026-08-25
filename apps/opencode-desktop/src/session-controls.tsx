import clipboard from "clipboardy";
import { writeFile } from "node:fs/promises";
import { createSignal, For, Show } from "solid-js";
import { dialog, shell } from "solid-gpui";
import type { OpenCodeController, OpenCodeState } from "./opencode.js";
import { sessionMarkdown } from "./session-export.js";
import { color, interactive } from "./theme.js";

function action(label: string, run: () => Promise<unknown>) {
  return (
    <div style={{ ...interactive, paddingX: 8, paddingY: 5, color: color.secondary, fontSize: 10 }} hoverStyle={{ background: color.raisedHover, color: color.text }} onClick={() => void run().catch(() => undefined)}>
      {label}
    </div>
  );
}

export function SessionActions(props: { state: OpenCodeState; controller: OpenCodeController }) {
  const [open, setOpen] = createSignal(false);
  const session = () => props.state.sessions.find((item) => item.id === props.state.selectedID);
  const exportSession = async () => {
    const selected = session();
    if (!selected) return;
    const suggestedName = `${selected.title.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "") || "opencode-session"}.md`;
    const path = await dialog.saveFile({ directory: props.state.directory, suggestedName });
    if (!path) return;
    try {
      await writeFile(path, `${sessionMarkdown(props.state)}\n`, "utf8");
      const answer = await dialog.message({ message: "Session exported", detail: path, answers: ["Done", "Show in folder"] });
      if (answer === 1) await shell.revealPath(path);
    } catch (error) {
      await dialog.message({
        message: "Could not export session",
        detail: error instanceof Error ? error.message : String(error),
        level: "critical",
      });
    }
  };
  const menuActions = () => [
    { label: session()?.revert ? "Redo message" : "Undo last message", run: () => session()?.revert ? props.controller.unrevert() : props.controller.revertLastMessage() },
    { label: "Fork session", run: () => props.controller.forkSession() },
    { label: "Compact context", run: () => props.controller.compact() },
    { label: session()?.share ? "Unshare session" : "Share session", run: async () => {
      const url = await props.controller.toggleShare();
      if (url) await clipboard.write(url);
    } },
    { label: "Export Markdown", run: exportSession },
    { label: "Archive session", run: () => props.controller.archiveSession() },
  ];
  return (
    <Show when={session()}>
      <div style={{ position: "relative" }}>
        <div tooltip="Session actions" style={{ ...interactive, width: 30, height: 30, alignItems: "center", justifyContent: "center", color: color.secondary, fontSize: 14 }} hoverStyle={{ background: color.raisedHover, color: color.text }} onClick={() => setOpen((value) => !value)}>•••</div>
        <Show when={open()}>
          <deferred priority={10}>
            <anchored anchor="top-right" offset={{ y: 4, x: 0 }} snapToWindow snapMargin={12}>
              <div style={{ width: 154, flexDirection: "column", gap: 2, padding: 5, borderWidth: 1, borderColor: color.borderStrong, borderRadius: 8, background: color.raised, boxShadow: [{ y: 8, blur: 24, color: "#000b" }] }}>
                <For each={menuActions()}>{(item) => action(item.label, async () => { setOpen(false); await item.run(); })}</For>
              </div>
            </anchored>
          </deferred>
        </Show>
      </div>
    </Show>
  );
}

export function QueueDock(props: { state: OpenCodeState; controller: OpenCodeController }) {
  const queue = () => props.state.queued.filter((item) => item.sessionID === props.state.selectedID);
  return (
    <Show when={queue().length > 0}>
      <div style={{ flexDirection: "column", gap: 4, marginBottom: 7, padding: 8, borderWidth: 1, borderColor: color.border, borderRadius: 8, background: color.raised }}>
        <div style={{ color: props.state.queuePaused ? color.yellow : color.tertiary, fontSize: 9, fontWeight: "bold" }}>
          {props.state.queuePaused ? "QUEUE PAUSED" : "QUEUED FOLLOW-UPS"} · {queue().length}
        </div>
        <For each={props.state.queued}>
          {(item, index) => (
            <Show when={item.sessionID === props.state.selectedID}>
              <div style={{ alignItems: "center", gap: 7, color: color.secondary, fontSize: 10 }}>
                <div style={{ color: item.kind === "shell" ? color.green : color.blue }}>{item.kind === "shell" ? "$" : item.kind === "command" ? "/" : "↳"}</div>
                <div style={{ flexGrow: 1, lineClamp: 1, textOverflow: "ellipsis" }}>{item.kind === "command" ? `${item.command} ${item.args}` : item.kind === "shell" ? item.command : item.text}</div>
                <div style={interactive} hoverStyle={{ color: color.red }} onClick={() => props.controller.removeQueued(index())}>×</div>
              </div>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}
