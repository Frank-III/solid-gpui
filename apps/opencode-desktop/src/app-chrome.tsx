import { For, Show } from "solid-js";
import type { OpenCodeController, OpenCodeState } from "./opencode.js";
import { SessionActions } from "./session-controls.js";
import { SessionTabs } from "./session-tabs.js";
import { color, interactive } from "./theme.js";
import { IconButton, projectName } from "./ui.js";

export type WorkspaceView = "chat" | "files" | "review" | "terminal";

const views = [
  { id: "chat", label: "Chat" },
  { id: "files", label: "Files" },
  { id: "review", label: "Review" },
  { id: "terminal", label: "Terminal" },
] as const;

export function AppChrome(props: {
  state: OpenCodeState;
  sidebarOpen: boolean;
  openSessions: string[];
  canReopen: boolean;
  toggleSidebar: () => void;
  createSession: () => void;
  selectSession: (id: string) => void;
  closeSession: (id: string) => void;
  reopenSession: () => void;
}) {
  return (
    <div style={{ height: 36, flexShrink: 0, alignItems: "center", paddingLeft: process.platform === "darwin" ? 84 : 8, paddingRight: 8, gap: 4, background: color.chrome }}>
      <IconButton label={props.sidebarOpen ? "◧" : "◫"} tooltip={props.sidebarOpen ? "Hide project navigation" : "Show project navigation"} onClick={props.toggleSidebar} />
      <div tooltip={props.state.directory} style={{ maxWidth: 150, alignItems: "center", gap: 7, paddingX: 7, color: color.secondary }}>
        <div style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: 4, background: color.text, color: color.deep, fontSize: 9, fontWeight: "bold" }}>
          {projectName(props.state.directory).slice(0, 1).toUpperCase()}
        </div>
        <div style={{ minWidth: 0, fontSize: 13, fontWeight: 500, lineClamp: 1, textOverflow: "ellipsis" }}>{projectName(props.state.directory)}</div>
      </div>
      <div style={{ width: 1, height: 18, marginX: 3, background: color.border }} />
      <SessionTabs sessions={props.state.sessions} open={props.openSessions} selected={props.state.selectedID} canReopen={props.canReopen} onSelect={props.selectSession} onClose={props.closeSession} onReopen={props.reopenSession} />
      <IconButton label="＋" tooltip="New session" onClick={props.createSession} />
      <div tooltip={props.state.connection} style={{ width: 7, height: 7, marginX: 6, borderRadius: 4, background: props.state.connection === "connected" ? color.green : props.state.connection === "connecting" ? color.yellow : color.red }} />
    </div>
  );
}

export function SessionHeader(props: { state: OpenCodeState; controller: OpenCodeController; view: WorkspaceView; selectView: (view: WorkspaceView) => void }) {
  const session = () => props.state.sessions.find((item) => item.id === props.state.selectedID);
  const count = (view: WorkspaceView) => view === "files" ? props.state.fileStatus.length : view === "review" ? props.state.sessionDiffs.length : view === "terminal" ? props.state.terminals.length : 0;
  return (
    <Show when={session()}>
      {(item) => (
        <div style={{ width: "100%", maxWidth: 1000, height: 48, flexShrink: 0, alignSelf: "center", alignItems: "center", paddingX: 12, gap: 6, background: color.canvas }}>
          <div style={{ color: color.tertiary, fontSize: 10 }}>▣</div>
          <div style={{ minWidth: 0, maxWidth: 520, marginLeft: 3, paddingX: 8, paddingY: 4, borderRadius: 6, color: color.text, fontSize: 13, fontWeight: 530, lineHeight: 16, lineClamp: 1, textOverflow: "ellipsis" }}>{item().title || "Untitled session"}</div>
          <div style={{ flexGrow: 1 }} />
          <For each={views}>
            {(view) => (
              <div
                style={{ ...interactive, height: 28, alignItems: "center", gap: 5, paddingX: 8, background: props.view === view.id ? color.pressed : "transparent", color: props.view === view.id ? color.text : color.tertiary, fontSize: 12 }}
                hoverStyle={{ background: color.hover, color: color.text }}
                onClick={() => props.selectView(view.id)}
              >
                {view.label}<span style={{ color: color.tertiary }}>{count(view.id) || ""}</span>
              </div>
            )}
          </For>
          <SessionActions state={props.state} controller={props.controller} />
        </div>
      )}
    </Show>
  );
}
