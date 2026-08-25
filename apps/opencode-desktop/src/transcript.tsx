import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import type { Part, Session, SessionStatus } from "@opencode-ai/sdk/v2";
import type { MessageItem } from "./opencode.js";
import { RichText } from "./markdown-view.js";
import { color } from "./theme.js";
import { fileSourceDetail, taskActivity, taskChildSessionID, toolPresentation, toolSections, toolSummary } from "./transcript-model.js";
import { SpecializedToolBody, SpecializedToolHeading, SpecializedToolStats, specializedExpandable } from "./transcript-specialized-tool.js";
import { specializedTool } from "./transcript-specialized-tool-model.js";
import { contextToolSummary, type ContextToolGrouping, type ToolPart } from "./transcript-tool-groups.js";

export function ToolPartView(props: { part: ToolPart; sessions?: Session[]; statuses?: Record<string, SessionStatus>; openSession?: (id: string) => void; cancelSession?: (id: string) => void }) {
  const [expanded, setExpanded] = createSignal(false);
  const presentation = createMemo(() => toolPresentation(props.part));
  const sections = createMemo(() => toolSections(props.part));
  const specialized = createMemo(() => specializedTool(props.part));
  const childSessionID = createMemo(() => taskChildSessionID(props.part, props.sessions ?? []));
  const activity = createMemo(() => taskActivity(props.part, childSessionID() ? props.statuses?.[childSessionID()!] : undefined));
  const expandable = () => specialized() ? specializedExpandable(specialized()!) : true;
  const tone = () => {
    if (props.part.state.status === "error") return color.red;
    if (activity().working) return color.yellow;
    return props.part.state.status === "completed" ? color.green : color.yellow;
  };
  return (
    <div
      style={{
        flexDirection: "column",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <div onClick={() => expandable() && !activity().working && setExpanded((value) => !value)} style={{ minHeight: 28, alignItems: "center", gap: 6, cursor: expandable() ? "pointer" : "default" }}>
        <div style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", color: tone(), fontSize: 8 }}>{activity().working ? "◌" : "●"}</div>
        <Show when={specialized()} fallback={<div style={{ flexDirection: "column", gap: 2 }}>
          <div style={{ alignItems: "center", gap: 6 }}>
            <div style={{ color: color.text, fontSize: 13, fontWeight: 530, lineHeight: 20 }}>{presentation().title}</div>
            <Show when={presentation().agent}><div style={{ paddingX: 5, paddingY: 2, borderRadius: 4, background: "#243247", color: color.blue, fontSize: 8 }}>{presentation().agent}</div></Show>
            <Show when={presentation().background}><div style={{ paddingX: 5, paddingY: 2, borderRadius: 4, background: "#342f22", color: color.yellow, fontSize: 8 }}>BACKGROUND</div></Show>
          </div>
          <Show when={presentation().subtitle}><div style={{ color: color.secondary, fontSize: 13, fontWeight: 440, lineHeight: 20 }}>{presentation().subtitle}</div></Show>
        </div>}>
          {(tool) => <SpecializedToolHeading tool={tool()} active={activity().working} />}
        </Show>
        <div style={{ flexGrow: 1 }} />
        <Show when={childSessionID()}>
          <div style={{ color: color.blue, fontSize: 9 }} hoverStyle={{ color: color.text }} onClick={() => props.openSession?.(childSessionID()!)}>↗ child session</div>
        </Show>
        <Show when={childSessionID() && activity().working}>
          <div style={{ color: color.tertiary, fontSize: 9 }} hoverStyle={{ color: color.red }} onClick={() => props.cancelSession?.(childSessionID()!)}>Stop</div>
        </Show>
        <Show when={!activity().working && specialized()}>{(tool) => <SpecializedToolStats tool={tool()} />}</Show>
        <div style={{ color: color.tertiary, fontSize: 11 }}>{toolSummary(props.part)}</div>
        <div style={{ color: color.tertiary, fontSize: 11 }}>{activity().label}</div>
        <Show when={expandable()}><div style={{ color: color.tertiary, fontSize: 10 }}>{expanded() ? "▾" : "▸"}</div></Show>
      </div>
      <Show when={expanded() && expandable()}>
        <div style={{ flexDirection: "column", maxHeight: 320, overflowY: "scroll", marginTop: 4, padding: 10, gap: 10, borderWidth: 1, borderColor: color.border, borderRadius: 6, background: color.raised }}>
          <Show when={specialized()} fallback={<>
            <Show when={presentation().attributes.length > 0}>
              <div style={{ color: color.tertiary, fontFamily: "monospace", fontSize: 9 }}>{presentation().attributes.join(" · ")}</div>
            </Show>
            <For each={sections()}>
              {(section) => (
                <div style={{ flexDirection: "column", gap: 5 }}>
                  <div style={{ color: section.title === "Error" ? color.red : color.tertiary, fontSize: 9, fontWeight: "bold" }}>{section.title.toUpperCase()}</div>
                  <Show when={section.format === "markdown"} fallback={<div style={{ color: section.title === "Error" ? color.red : color.secondary, fontFamily: "monospace", fontSize: 10, lineHeight: 15 }}>{section.content}</div>}>
                    <RichText text={section.content} />
                  </Show>
                </div>
              )}
            </For>
            <Show when={props.part.state.status === "completed" && props.part.state.attachments?.length}>
              <div style={{ color: color.blue, fontSize: 9 }}>{props.part.state.status === "completed" ? props.part.state.attachments?.map((item) => item.filename ?? item.url).join(" · ") : ""}</div>
            </Show>
          </>}>
            {(tool) => <SpecializedToolBody tool={tool()} />}
          </Show>
        </div>
      </Show>
    </div>
  );
}

function ContextToolGroup(props: { parts: ToolPart[]; sessions?: Session[]; statuses?: Record<string, SessionStatus>; openSession?: (id: string) => void; cancelSession?: (id: string) => void }) {
  const [expanded, setExpanded] = createSignal(false);
  const summary = createMemo(() => contextToolSummary(props.parts));
  const detail = () => [
    summary().reads ? `${summary().reads} read${summary().reads === 1 ? "" : "s"}` : undefined,
    summary().searches ? `${summary().searches} search${summary().searches === 1 ? "" : "es"}` : undefined,
    summary().lists ? `${summary().lists} list${summary().lists === 1 ? "" : "s"}` : undefined,
  ].filter(Boolean).join(" · ");
  return (
    <div style={{ width: "100%", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ minHeight: 28, alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => setExpanded((value) => !value)}>
        <div style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", color: summary().running ? color.yellow : color.green, fontSize: 8 }}>{summary().running ? "◌" : "●"}</div>
        <div style={{ color: color.text, fontSize: 13, fontWeight: 530 }}>{summary().running ? "Gathering context" : "Gathered context"}</div>
        <div style={{ color: color.tertiary, fontSize: 13, fontWeight: 440 }}>{detail()}</div>
        <div style={{ flexGrow: 1 }} />
        <div style={{ color: color.tertiary, fontSize: 9 }}>{expanded() ? "▾" : "▸"}</div>
      </div>
      <Show when={expanded()}>
        <div style={{ flexDirection: "column", gap: 4, paddingLeft: 22 }}>
          <For each={props.parts}>{(part) => <ToolPartView part={part} sessions={props.sessions} statuses={props.statuses} openSession={props.openSession} cancelSession={props.cancelSession} />}</For>
        </div>
      </Show>
    </div>
  );
}

export function PartView(props: { part: Part; sessions?: Session[]; statuses?: Record<string, SessionStatus>; toolGrouping?: ContextToolGrouping; openSession?: (id: string) => void; cancelSession?: (id: string) => void }) {
  return (
    <Switch>
      <Match
        when={
          props.part.type === "text" &&
          (props.part as Extract<Part, { type: "text" }>)
        }
      >
        {(p) => <RichText text={p().text} />}
      </Match>
      <Match
        when={
          props.part.type === "reasoning" &&
          (props.part as Extract<Part, { type: "reasoning" }>)
        }
      >
        {(p) => (
          <div
            style={{
              flexGrow: 1,
              minWidth: 0,
              paddingLeft: 11,
              borderLeftWidth: 2,
              borderColor: color.borderStrong,
            }}
          >
            <RichText text={p().text} />
          </div>
        )}
      </Match>
      <Match
        when={
          props.part.type === "tool" &&
          (props.part as Extract<Part, { type: "tool" }>)
        }
      >
        {(p) => (
          <Show when={!props.toolGrouping?.hidden.has(p().id)}>
            <Show
              when={props.toolGrouping?.groups.get(p().id)}
              fallback={<ToolPartView part={p()} sessions={props.sessions} statuses={props.statuses} openSession={props.openSession} cancelSession={props.cancelSession} />}
            >
              {(parts) => <ContextToolGroup parts={parts()} sessions={props.sessions} statuses={props.statuses} openSession={props.openSession} cancelSession={props.cancelSession} />}
            </Show>
          </Show>
        )}
      </Match>
      <Match
        when={
          props.part.type === "file" &&
          (props.part as Extract<Part, { type: "file" }>)
        }
      >
        {(p) => (
          <div
            style={{
              flexDirection: "column",
              gap: 3,
              padding: 9,
              borderRadius: 7,
              background: color.raised,
              color: color.blue,
              fontSize: 11,
            }}
          >
            <div>▧ {p().filename ?? p().url}</div>
            <Show when={p().source}>
              {(source) => (
                <div style={{ color: color.tertiary, fontSize: 9 }}>
                  {fileSourceDetail(source())}
                </div>
              )}
            </Show>
          </div>
        )}
      </Match>
      <Match
        when={
          props.part.type === "patch" &&
          (props.part as Extract<Part, { type: "patch" }>)
        }
      >
        {(p) => (
          <div style={{ color: color.green, fontSize: 11 }}>
            ＋ changed {p().files.length} file
            {p().files.length === 1 ? "" : "s"}
          </div>
        )}
      </Match>
      <Match
        when={
          props.part.type === "subtask" &&
          (props.part as Extract<Part, { type: "subtask" }>)
        }
      >
        {(p) => (
          <div
            style={{
              flexDirection: "column",
              gap: 5,
              padding: 10,
              borderRadius: 7,
              borderWidth: 1,
              borderColor: color.border,
              background: "#20201f",
            }}
          >
            <div
              style={{ color: color.blue, fontSize: 10, fontWeight: "bold" }}
            >
              SUBTASK · {p().agent}
            </div>
            <div style={{ fontSize: 11 }}>{p().description}</div>
            <div style={{ color: color.tertiary, fontSize: 10 }}>
              {p().prompt}
            </div>
          </div>
        )}
      </Match>
      <Match
        when={props.part.type === "step-start" && (props.part as Extract<Part, { type: "step-start" }>)}
      >
        {(p) => <div style={{ color: color.tertiary, fontSize: 9 }}>◇ Step started{p().snapshot ? ` · snapshot ${p().snapshot}` : ""}</div>}
      </Match>
      <Match
        when={props.part.type === "snapshot" && (props.part as Extract<Part, { type: "snapshot" }>)}
      >
        {(p) => <div style={{ color: color.tertiary, fontSize: 9 }}>◫ Snapshot {p().snapshot}</div>}
      </Match>
      <Match
        when={
          props.part.type === "agent" &&
          (props.part as Extract<Part, { type: "agent" }>)
        }
      >
        {(p) => (
          <div style={{ color: color.blue, fontSize: 10 }}>
            Agent switched to {p().name}{p().source ? ` · ${p().source!.value}` : ""}
          </div>
        )}
      </Match>
      <Match
        when={
          props.part.type === "step-finish" &&
          (props.part as Extract<Part, { type: "step-finish" }>)
        }
      >
        {(p) => (
          <div style={{ color: color.tertiary, fontSize: 9 }}>
            {p().reason} · {p().tokens.input} in / {p().tokens.output} out
            {p().tokens.reasoning ? ` / ${p().tokens.reasoning} reasoning` : ""} · ${p().cost.toFixed(4)}
            {p().snapshot ? ` · snapshot ${p().snapshot}` : ""}
          </div>
        )}
      </Match>
      <Match
        when={
          props.part.type === "compaction" &&
          (props.part as Extract<Part, { type: "compaction" }>)
        }
      >
        {(p) => <div style={{ color: color.yellow, fontSize: 10 }}>
          Context compacted · {p().auto ? "automatic" : "manual"}{p().overflow ? " · overflow" : ""}
        </div>}
      </Match>
      <Match
        when={
          props.part.type === "retry" &&
          (props.part as Extract<Part, { type: "retry" }>)
        }
      >
        {(p) => (
          <div style={{ color: color.yellow, fontSize: 11 }}>
            Retry {p().attempt}: {p().error.data.message}
          </div>
        )}
      </Match>
    </Switch>
  );
}

export interface MessageActions {
  edit: (messageID: string) => Promise<unknown>;
  retry: (messageID: string) => Promise<unknown>;
  revert: (messageID: string) => Promise<unknown>;
  fork: (messageID: string) => Promise<unknown>;
  selectSession: (sessionID: string) => Promise<unknown>;
  cancelSession: (sessionID: string) => Promise<unknown>;
}

function messageAction(label: string, action: () => Promise<unknown>) {
  return (
    <div
      style={{ cursor: "pointer", paddingX: 5, paddingY: 2, color: color.tertiary, fontSize: 10 }}
      hoverStyle={{ color: color.text, background: color.raisedHover }}
      onClick={() => void action().catch(() => undefined)}
    >
      {label}
    </div>
  );
}

export function MessageView(props: { message: MessageItem; sessions?: Session[]; statuses?: Record<string, SessionStatus>; toolGrouping?: ContextToolGrouping; actions?: MessageActions }) {
  const user = () => props.message.info.role === "user";
  const editable = () => user() && props.message.parts.some((part) => part.type === "text" && part.text.trim());
  const visible = () => props.message.parts.some((part) => part.type !== "tool" || !props.toolGrouping?.hidden.has(part.id))
    || (props.message.info.role === "assistant" && Boolean(props.message.info.error));
  return (
    <Show when={visible()}>
      <div
        style={{
          width: "100%",
          justifyContent: user() ? "end" : "start",
          marginBottom: user() ? 22 : 30,
        }}
      >
        <div
          style={{
            flexDirection: "column",
            width: user() ? "auto" : "100%",
            maxWidth: user() ? 760 : "100%",
            gap: 11,
            paddingX: user() ? 12 : 0,
            paddingY: user() ? 8 : 0,
            borderRadius: user() ? 10 : 0,
            background: user() ? color.raised : "transparent",
            fontWeight: user() ? 440 : 400,
          }}
        >
          <For each={props.message.parts}>
            {(part) => <PartView part={part} sessions={props.sessions} statuses={props.statuses} toolGrouping={props.toolGrouping} openSession={(id) => void props.actions?.selectSession(id)} cancelSession={(id) => void props.actions?.cancelSession(id).catch(() => undefined)} />}
          </For>
          <Show when={user() && props.actions}>
            <div style={{ alignItems: "center", justifyContent: "end", gap: 2, paddingTop: 2 }}>
              <div style={{ marginRight: 3, color: color.tertiary, fontSize: 10 }}>
                {new Date(props.message.info.time.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
              <Show when={editable()}>
                {messageAction("Edit", () => props.actions!.edit(props.message.info.id))}
                {messageAction("Retry", () => props.actions!.retry(props.message.info.id))}
              </Show>
              {messageAction("Revert", () => props.actions!.revert(props.message.info.id))}
              {messageAction("Fork", () => props.actions!.fork(props.message.info.id))}
            </div>
          </Show>
          <Show
            when={
              !user() &&
              props.message.info.role === "assistant" &&
              props.message.info.error
            }
          >
            <div
              style={{
                padding: 10,
                borderRadius: 7,
                background: "#3b2224",
                color: color.red,
                fontSize: 11,
              }}
            >
              {JSON.stringify(
                props.message.info.role === "assistant"
                  ? props.message.info.error
                  : undefined,
              )}
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
