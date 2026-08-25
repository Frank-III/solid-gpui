import { createMemo, For, Show } from "solid-js";
import type { Session } from "@opencode-ai/sdk/v2";
import type { OpenCodeState } from "./opencode.js";
import { color, interactive } from "./theme.js";
import { IconButton, projectName, relativeTime } from "./ui.js";

export function Sidebar(props: {
  state: OpenCodeState;
  onCollapse: () => void;
  onRefresh: () => void;
  onOpenProject: () => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
}) {
  const sessions = createMemo(() => props.state.sessions.filter((session) => !session.parentID));
  return (
    <div style={{ width: 252, height: "100%", flexShrink: 0, flexDirection: "column", borderRightWidth: 1, borderColor: color.border, background: color.sidebar, overflow: "hidden" }}>
      <div style={{ height: 49, flexShrink: 0, alignItems: "center", gap: 9, paddingX: 12 }}>
        <div style={{ color: color.secondary, fontSize: 12 }}>▱</div>
        <div style={{ flexDirection: "column", flexGrow: 1, minWidth: 0, gap: 2 }}>
          <div style={{ color: color.text, fontSize: 11, fontWeight: "semibold", lineClamp: 1, textOverflow: "ellipsis" }}>{projectName(props.state.directory)}</div>
          <div style={{ color: color.tertiary, fontSize: 8 }}>LOCAL PROJECT</div>
        </div>
        <IconButton label="↗" tooltip="Open another project" onClick={props.onOpenProject} />
      </div>
      <div style={{ paddingX: 8, paddingBottom: 8 }}>
        <div style={{ ...interactive, height: 33, alignItems: "center", gap: 9, paddingX: 9, color: color.secondary }} hoverStyle={{ background: color.raisedHover, color: color.text }} onClick={props.onCreate}>
          <div style={{ fontSize: 15 }}>＋</div>
          <div style={{ fontSize: 11, fontWeight: "semibold" }}>New session</div>
          <div style={{ flexGrow: 1 }} />
          <div style={{ color: color.tertiary, fontSize: 8 }}>⌘N</div>
        </div>
      </div>
      <div style={{ paddingX: 14, paddingY: 6, color: color.tertiary, fontSize: 8, fontWeight: "semibold" }}>SESSIONS · {sessions().length}</div>
      <div style={{ flexDirection: "column", flexGrow: 1, minHeight: 0, overflowY: "scroll", paddingX: 7, gap: 2 }}>
        <Show when={sessions().length === 0}>
          <div style={{ padding: 11, color: color.tertiary, fontSize: 10, lineHeight: 16 }}>No sessions in this project yet.</div>
        </Show>
        <For each={sessions()}>
          {(session) => <SessionRow session={session} selected={props.state.selectedID === session.id} onSelect={props.onSelect} />}
        </For>
      </div>
      <div style={{ height: 46, flexShrink: 0, alignItems: "center", paddingX: 9, borderTopWidth: 1, borderColor: color.border }}>
        <div style={{ color: props.state.connection === "connected" ? color.green : props.state.connection === "connecting" ? color.yellow : color.red, fontSize: 8 }}>●</div>
        <div style={{ marginLeft: 6, color: color.tertiary, fontSize: 9 }}>{props.state.connection}</div>
        <div style={{ flexGrow: 1 }} />
        <IconButton label="↻" tooltip="Refresh project" onClick={props.onRefresh} />
        <IconButton label="‹" tooltip="Hide project navigation" onClick={props.onCollapse} />
      </div>
    </div>
  );
}

export function SessionRow(props: { session: Session; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <div style={{ ...interactive, flexDirection: "column", gap: 4, paddingX: 9, paddingY: 7, background: props.selected ? color.raised : "transparent" }} hoverStyle={{ background: color.raisedHover }} onClick={() => props.onSelect(props.session.id)}>
      <div style={{ fontSize: 11, fontWeight: "medium", lineClamp: 1, textOverflow: "ellipsis" }}>{props.session.title || "Untitled session"}</div>
      <div style={{ alignItems: "center", gap: 5, color: color.tertiary, fontSize: 9 }}>
        <div>▱</div>
        <div style={{ lineClamp: 1, textOverflow: "ellipsis" }}>{projectName(props.session.directory)}</div>
        <div style={{ flexGrow: 1 }} />
        <div>{relativeTime(props.session.time.updated)}</div>
      </div>
    </div>
  );
}
