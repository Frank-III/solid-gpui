import { createMemo, For, Show } from "solid-js";
import type { InputEvent, KeyEvent } from "solid-gpui";
import type { ComposerMode } from "./composer-history.js";
import type { ComposerAttachment } from "./attachments.js";
import type { EditorState } from "./editor.js";
import { modelLabel, type OpenCodeState } from "./opencode.js";
import { color, interactive, overlayShadow, raisedShadow } from "./theme.js";
import { IconButton } from "./ui.js";
import type { PromptContext } from "./workspace-model.js";
import type { MentionSuggestion } from "./mentions.js";
import { modelKey } from "./model-preferences.js";
import { orderModels } from "./model-selection.js";

export function ModelPicker(props: { state: OpenCodeState; recent: string[]; favorites: string[]; close: () => void; selectModel: (model: OpenCodeState["models"][number]) => void; toggleFavorite: (model: OpenCodeState["models"][number]) => void }) {
  const models = createMemo(() => orderModels(props.state.models, props.recent, props.favorites));
  const favoriteModels = createMemo(() => models().filter((model) => props.favorites.includes(modelKey(model))));
  const recentModels = createMemo(() => models().filter((model) => !props.favorites.includes(modelKey(model)) && props.recent.includes(modelKey(model))));
  const otherModels = createMemo(() => models().filter((model) => !props.favorites.includes(modelKey(model)) && !props.recent.includes(modelKey(model))));
  const row = (model: OpenCodeState["models"][number]) => {
    const selected = () => props.state.model?.providerID === model.providerID && props.state.model?.modelID === model.id;
    return (
      <div style={{ ...interactive, minHeight: 40, alignItems: "center", gap: 8, paddingX: 12, paddingY: 6, borderRadius: 6, background: selected() ? color.hover : "transparent" }} hoverStyle={{ background: color.hover }} onClick={() => { props.selectModel(model); props.close(); }}>
        <div style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 4, background: color.layer2, color: selected() ? color.green : color.tertiary, fontSize: 9 }}>{selected() ? "●" : "✦"}</div>
        <div style={{ flexDirection: "column", minWidth: 0, gap: 1 }}>
          <div style={{ color: color.text, fontSize: 13, fontWeight: 530, lineClamp: 1, textOverflow: "ellipsis" }}>{model.name}</div>
          <div style={{ color: color.tertiary, fontSize: 10 }}>{model.providerID} · {Math.round(model.limit.context / 1000)}k context{Object.keys(model.variants ?? {}).length ? ` · ${Object.keys(model.variants ?? {}).length} variants` : ""}</div>
        </div>
        <div style={{ flexGrow: 1 }} />
        <div tooltip={props.favorites.includes(modelKey(model)) ? "Remove favorite" : "Add favorite"} style={{ ...interactive, width: 26, height: 26, alignItems: "center", justifyContent: "center", color: props.favorites.includes(modelKey(model)) ? color.yellow : color.tertiary, fontSize: 13 }} hoverStyle={{ background: color.raisedHover, color: color.yellow }} onClick={() => props.toggleFavorite(model)}>{props.favorites.includes(modelKey(model)) ? "★" : "☆"}</div>
      </div>
    );
  };
  const group = (label: string, items: OpenCodeState["models"]) => (
    <Show when={items.length > 0}>
      <div style={{ paddingX: 12, paddingTop: 12, paddingBottom: 5, color: color.secondary, fontSize: 13, fontWeight: 440 }}>{label}</div>
      <For each={items}>{row}</For>
    </Show>
  );
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 8, background: "#00000099" }} onClick={props.close}>
        <div style={{ width: 640, maxWidth: "100%", maxHeight: 640, flexDirection: "column", borderRadius: 6, background: color.raised, boxShadow: overlayShadow, overflow: "hidden" }}>
          <div style={{ alignItems: "center", padding: 16 }}>
            <div style={{ flexDirection: "column", gap: 4 }}>
              <div style={{ color: color.text, fontSize: 15, fontWeight: 530 }}>Select a model</div>
              <div style={{ color: color.tertiary, fontSize: 12 }}>Models connected through your OpenCode providers</div>
            </div>
            <div style={{ flexGrow: 1 }} />
            <div style={{ ...interactive, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 4, color: color.tertiary, fontSize: 13 }} hoverStyle={{ background: color.hover, color: color.text }} onClick={props.close}>×</div>
          </div>
          <div style={{ height: 1, background: color.border }} />
          <div style={{ flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", padding: 8 }}>
            <Show when={props.state.models.length > 0} fallback={<div style={{ padding: 18, color: color.tertiary, fontSize: 11 }}>No connected provider models found. Configure a provider in OpenCode, then refresh this project.</div>}>
              {group("Favorites", favoriteModels())}
              {group("Recent", recentModels())}
              {group("Connected models", otherModels())}
            </Show>
          </div>
          <div style={{ alignItems: "center", gap: 7, margin: 10, padding: 10, borderWidth: 1, borderColor: color.border, borderRadius: 8, background: color.layer2, color: color.secondary, fontSize: 11 }}>
            <div style={{ color: color.accent }}>✦</div><div>Provider discovery and authentication are managed by OpenCode.</div><div style={{ flexGrow: 1 }} /><div>Esc to close</div>
          </div>
        </div>
    </div>
  );
}

export function CommandPicker(props: { state: OpenCodeState; query: string; select: (name: string) => void }) {
  const commands = () => props.state.commands
    .filter((command) => command.name.toLowerCase().includes(props.query.toLowerCase()))
    .slice(0, 8);
  return (
    <Show when={commands().length > 0}>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 116, maxHeight: 320, flexDirection: "column", overflowY: "scroll", borderRadius: 12, background: color.canvas, boxShadow: raisedShadow, padding: 8 }}>
        <div style={{ paddingX: 8, paddingY: 4, color: color.tertiary, fontSize: 12 }}>Commands</div>
        <For each={commands()}>
          {(command) => (
            <div style={{ ...interactive, alignItems: "center", gap: 8, paddingX: 8, paddingY: 4 }} hoverStyle={{ background: color.hover }} onClick={() => props.select(command.name)}>
              <div style={{ color: color.accent, fontFamily: "monospace", fontSize: 13 }}>/{command.name}</div>
              <div style={{ flexGrow: 1, color: color.tertiary, fontSize: 12, lineClamp: 1, textOverflow: "ellipsis" }}>{command.description ?? command.source ?? "OpenCode command"}</div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

export function MentionPicker(props: { query: string; matches: MentionSuggestion[]; selected: number; select: (item: MentionSuggestion) => void }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 116, maxHeight: 320, flexDirection: "column", overflowY: "scroll", borderRadius: 12, background: color.canvas, boxShadow: raisedShadow, padding: 8 }}>
      <div style={{ paddingX: 8, paddingY: 4, color: color.tertiary, fontSize: 12 }}>
        Mentions{props.query ? ` · ${props.query}` : ""}
      </div>
      <Show when={props.matches.length > 0} fallback={<div style={{ padding: 12, color: color.tertiary, fontSize: 11 }}>No matching mentions</div>}>
        <For each={props.matches}>
          {(item, index) => (
            <div
              style={{ ...interactive, alignItems: "center", gap: 8, paddingX: 8, paddingY: 4, background: index() === props.selected ? color.hover : "transparent" }}
              hoverStyle={{ background: color.hover }}
              onClick={() => props.select(item)}
            >
              <div style={{ width: 14, color: item.kind === "agent" ? color.yellow : item.kind === "resource" ? color.green : item.kind === "reference" ? color.accent : color.blue, fontSize: 10 }}>{item.kind === "agent" ? "◎" : item.kind === "resource" ? "◇" : item.kind === "reference" ? "▤" : "▧"}</div>
              <div style={{ flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 }}>
                <div style={{ color: color.text, fontFamily: item.kind === "file" || item.kind === "recent" ? "monospace" : "sans-serif", fontSize: 13, lineClamp: 1, textOverflow: "ellipsis" }}>{item.label}</div>
                <Show when={item.description}><div style={{ color: color.tertiary, fontSize: 11, lineClamp: 1, textOverflow: "ellipsis" }}>{item.description}</div></Show>
              </div>
              <div style={{ color: color.tertiary, fontSize: 8 }}>{item.kind.toUpperCase()}</div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

export function Composer(props: {
  state: OpenCodeState;
  editor: EditorState;
  active: boolean;
  modelOpen: boolean;
  mode: ComposerMode;
  mentionQuery?: string;
  mentionMatches: MentionSuggestion[];
  mentionSelected: number;
  attachments: ComposerAttachment[];
  contexts: PromptContext[];
  activate: () => void;
  toggleModels: () => void;
  toggleMode: () => void;
  selectCommand: (name: string) => void;
  selectMention: (item: MentionSuggestion) => void;
  attach: () => void;
  removeAttachment: (id: string) => void;
  removeContext: (id: string) => void;
  nativeInput: (event: InputEvent) => void;
  nativeKeyDown: (event: KeyEvent) => void;
  send: () => void;
  selectModel: (model: OpenCodeState["models"][number]) => void;
  selectAgent: (name?: string) => void;
  modelRecent: string[];
  modelFavorites: string[];
  toggleModelFavorite: (model: OpenCodeState["models"][number]) => void;
  cycleVariant: () => void;
  abort: () => void;
}) {
  const commandQuery = () => props.mode === "prompt" ? /^\/([^\s]*)$/.exec(props.editor.value)?.[1] : undefined;
  const selectionStart = () => Math.min(props.editor.anchor ?? props.editor.cursor, props.editor.cursor);
  const selectionEnd = () => Math.max(props.editor.anchor ?? props.editor.cursor, props.editor.cursor);
  const cycleAgent = () => {
    if (props.state.agents.length === 0) return;
    const current = props.state.agents.findIndex((agent) => agent.name === props.state.agent);
    props.selectAgent(props.state.agents[(current + 1) % props.state.agents.length]?.name);
  };
  return (
    <div style={{ position: "relative", width: "100%", alignSelf: "stretch" }}>
      <Show when={!props.modelOpen && commandQuery() !== undefined}>
        <CommandPicker state={props.state} query={commandQuery() ?? ""} select={props.selectCommand} />
      </Show>
      <Show when={!props.modelOpen && commandQuery() === undefined && props.mentionQuery !== undefined}>
        <MentionPicker query={props.mentionQuery ?? ""} matches={props.mentionMatches} selected={props.mentionSelected} select={props.selectMention} />
      </Show>
      <div
        style={{ width: "100%", flexDirection: "column", minHeight: 96, maxHeight: 240, borderRadius: 12, background: color.canvas, boxShadow: raisedShadow, cursor: "text", overflow: "hidden" }}
        onClick={props.activate}
      >
        <Show when={props.attachments.length > 0}>
          <div style={{ flexWrap: "wrap", gap: 5, paddingX: 16, paddingTop: 12 }}>
            <For each={props.attachments}>
              {(attachment) => (
                <div style={{ alignItems: "center", gap: 5, maxWidth: 230, paddingX: 7, paddingY: 4, borderRadius: 6, background: color.canvas, color: attachment.mime.startsWith("image/") ? color.blue : color.secondary, fontSize: 9 }}>
                  <div>{attachment.mime.startsWith("image/") ? "▧" : "▱"}</div>
                  <div style={{ flexGrow: 1, lineClamp: 1, textOverflow: "ellipsis" }}>{attachment.label}</div>
                  <div style={{ ...interactive, color: color.tertiary }} hoverStyle={{ color: color.text }} onClick={() => props.removeAttachment(attachment.id)}>×</div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={props.contexts.length > 0}>
          <div style={{ flexWrap: "wrap", gap: 5, paddingX: 16, paddingTop: 8 }}>
            <For each={props.contexts}>
              {(context) => (
                <div tooltip={context.preview} style={{ alignItems: "center", gap: 5, maxWidth: 280, paddingX: 7, paddingY: 4, borderRadius: 6, background: context.comment ? "#26344a" : "#202d3c", color: color.blue, fontSize: 9 }}>
                  <div>{context.comment ? "◆" : "▤"}</div>
                  <div style={{ flexGrow: 1, lineClamp: 1, textOverflow: "ellipsis" }}>{context.path} · L{context.startLine}–{context.endLine}{context.comment ? ` · ${context.comment}` : ""}</div>
                  <div style={{ ...interactive, color: color.tertiary }} hoverStyle={{ color: color.text }} onClick={() => props.removeContext(context.id)}>×</div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <input
          value={props.editor.value}
          placeholder={props.mode === "shell" ? "Run a command in this session…" : "Ask OpenCode anything…"}
          multiline
          rows={2}
          enterBehavior="propagate"
          selectionStart={selectionStart()}
          selectionEnd={selectionEnd()}
          focused={props.active}
          style={{ width: "100%", flexGrow: 1, minHeight: 60, maxHeight: 180, paddingX: 16, paddingTop: 14, paddingBottom: 6, color: color.text, fontSize: 13, fontWeight: 440, lineHeight: 20 }}
          onInput={props.nativeInput}
          onKeyDown={props.nativeKeyDown}
        />
        <div style={{ height: 44, flexShrink: 0, alignItems: "center", gap: 4, paddingX: 8 }}>
          <IconButton label="＋" size="large" tooltip="Attach files" onClick={props.attach} />
          <div
            style={{ ...interactive, height: 28, alignItems: "center", gap: 5, paddingX: 7, background: props.mode === "shell" ? color.pressed : "transparent", color: props.mode === "shell" ? color.green : color.secondary }}
            hoverStyle={{ background: color.hover, color: props.mode === "shell" ? color.green : color.text }}
            onClick={props.toggleMode}
          >
            <div style={{ fontFamily: props.mode === "shell" ? "monospace" : "sans-serif", fontSize: 13, fontWeight: 440 }}>{props.mode === "shell" ? "$ Shell" : "Prompt"}</div>
          </div>
          <Show when={props.mode === "prompt"}>
          <div
            style={{ ...interactive, maxWidth: 220, height: 28, alignItems: "center", gap: 6, paddingX: 7, color: color.secondary }}
            hoverStyle={{ background: color.hover, color: color.text }}
            onClick={props.toggleModels}
          >
            <div style={{ color: color.tertiary, fontSize: 10 }}>✦</div><div style={{ minWidth: 0, fontSize: 13, fontWeight: 440, lineClamp: 1, textOverflow: "ellipsis" }}>{modelLabel(props.state)}</div><div style={{ color: color.tertiary, fontSize: 10 }}>⌄</div>
          </div>
          </Show>
          <Show when={Object.keys(props.state.models.find((model) => model.providerID === props.state.model?.providerID && model.id === props.state.model?.modelID)?.variants ?? {}).length > 0}>
            <div style={{ ...interactive, height: 28, alignItems: "center", paddingX: 7, color: props.state.variant ? color.blue : color.tertiary, fontSize: 12 }} hoverStyle={{ background: color.hover, color: color.text }} onClick={props.cycleVariant}>◈ {props.state.variant ?? "Default"}</div>
          </Show>
          <Show when={props.state.agent}>
            <div style={{ ...interactive, height: 28, alignItems: "center", paddingX: 7, color: color.secondary, fontSize: 12 }} hoverStyle={{ background: color.hover, color: color.text }} onClick={cycleAgent}>◎ {props.state.agent}</div>
          </Show>
          <div style={{ flexGrow: 1 }} />
          <Show
            when={props.state.busy}
            fallback={<div style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, background: color.text, color: color.deep, fontSize: 14, boxShadow: [{ y: 1, blur: 2, color: "#00000066" }, { spread: 0.5, color: "#ffffff66" }], cursor: "pointer" }} hoverStyle={{ opacity: 0.82 }} tooltip="Send (Enter)" onClick={props.send}>↑</div>}
          >
            <div style={{ alignItems: "center", gap: 2 }}>
              <IconButton label="↳" tooltip="Queue follow-up (Enter)" onClick={props.send} />
              <IconButton label="■" danger tooltip="Stop generation" onClick={props.abort} />
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
