import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { MessageDraft, OpenCodeController, OpenCodeState } from "./opencode.js";
import { color, interactive } from "./theme.js";
import { MessageView, type MessageActions } from "./transcript.js";
import { TranscriptContext } from "./transcript-context.js";
import { groupContextTools } from "./transcript-tool-groups.js";
import { transcriptWindow } from "./transcript-window-model.js";

export function TranscriptWindowView(props: {
  state: OpenCodeState;
  controller: OpenCodeController;
  edit: (draft: MessageDraft) => void;
}) {
  const [anchors, setAnchors] = createSignal<(string | undefined)[]>([undefined]);
  createEffect(
    () => props.state.selectedID,
    () => { setAnchors([undefined]); },
  );
  const anchor = () => anchors().at(-1);
  const page = createMemo(() => transcriptWindow(props.state.messages, anchor()));
  const toolGrouping = createMemo(() => groupContextTools(page().messages));
  const olderAvailable = () => page().start > 0 || props.state.hasOlderMessages;
  const older = async () => {
    const currentFirst = page().messages[0]?.info.id;
    if (!currentFirst) return;
    if (page().start === 0) {
      const loaded = await props.controller.loadOlderMessages();
      if (loaded === 0) return;
    }
    setAnchors((current) => [...current, currentFirst]);
  };
  const newer = () => setAnchors((current) => current.length > 1 ? current.slice(0, -1) : current);
  const actions: MessageActions = {
    edit: async (messageID) => {
      const draft = await props.controller.prepareMessageEdit(messageID);
      if (draft) props.edit(draft);
    },
    retry: (messageID) => props.controller.retryMessage(messageID),
    revert: (messageID) => props.controller.revertToMessage(messageID),
    fork: (messageID) => props.controller.forkSession(messageID),
    selectSession: (sessionID) => props.controller.selectSession(sessionID),
    cancelSession: (sessionID) => props.controller.abort(sessionID),
  };
  return (
    <div style={{ width: "100%", flexDirection: "column", flexGrow: 1 }}>
      <TranscriptContext state={props.state} />
      <Show when={olderAvailable()}>
        <div style={{ justifyContent: "center", paddingBottom: 18 }}>
          <div style={{ ...interactive, paddingX: 10, paddingY: 6, color: color.secondary, fontSize: 10 }} hoverStyle={{ background: color.raisedHover, color: color.text }} onClick={() => void older()}>
            {props.state.loadingOlderMessages ? "Loading earlier messages…" : "↑ Earlier messages"}
          </div>
        </div>
      </Show>
      <For each={page().messages}>{(message) => <MessageView message={message} sessions={props.state.sessions} statuses={props.state.statuses} toolGrouping={toolGrouping()} actions={actions} />}</For>
      <Show when={anchors().length > 1}>
        <div style={{ justifyContent: "center", paddingTop: 2, paddingBottom: 12 }}>
          <div style={{ ...interactive, paddingX: 10, paddingY: 6, color: color.secondary, fontSize: 10 }} hoverStyle={{ background: color.raisedHover, color: color.text }} onClick={newer}>↓ Newer messages</div>
        </div>
      </Show>
      <Show when={props.state.busy && anchors().length === 1}><div style={{ color: color.accent, fontSize: 11 }}>● OpenCode is working…</div></Show>
      <Show when={props.state.messages.length > page().messages.length}>
        <div style={{ alignSelf: "center", color: color.tertiary, fontSize: 9 }}>
          Showing {page().start + 1}–{page().end} of {props.state.messages.length} loaded messages
        </div>
      </Show>
    </div>
  );
}
