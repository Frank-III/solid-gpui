import type { Session } from "@opencode-ai/sdk/v2";
import { For, Show } from "solid-js";
import { color, interactive } from "./theme.js";

export function SessionTabs(props: {
  sessions: Session[];
  open: string[];
  selected?: string;
  canReopen: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReopen: () => void;
}) {
  const session = (id: string) => props.sessions.find((item) => item.id === id);
  return (
      <div style={{ minWidth: 80, flexGrow: 1, height: 36, alignItems: "center", gap: 2, overflowX: "scroll" }}>
        <For each={props.open}>
          {(id) => (
            <Show when={session(id)}>
              {(item) => (
                <div
                  style={{ ...interactive, minWidth: 108, maxWidth: 224, height: 28, alignItems: "center", gap: 6, paddingX: 8, borderRadius: 6, background: props.selected === id ? color.hover : "transparent", color: props.selected === id ? color.text : color.tertiary, fontSize: 13, fontWeight: 500, overflow: "hidden" }}
                  hoverStyle={{ background: color.hover, color: color.text }}
                  onClick={() => props.onSelect(id)}
                >
                  <div style={{ width: 5, height: 5, flexShrink: 0, borderRadius: 3, background: props.selected === id ? color.green : color.tertiary }} />
                  <div style={{ width: 174, minWidth: 0, flexShrink: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{item().title || "Untitled session"}</div>
                  <div
                    tooltip="Close tab"
                    style={{ ...interactive, width: 16, height: 16, alignItems: "center", justifyContent: "center", borderRadius: 4, color: color.tertiary, fontSize: 13 }}
                    hoverStyle={{ background: color.raisedHover, color: color.text }}
                    onClick={() => props.onClose(id)}
                  >×</div>
                </div>
              )}
            </Show>
          )}
        </For>
        <Show when={props.canReopen}>
          <div tooltip="Reopen closed session tab (Cmd/Ctrl+Shift+T)" style={{ ...interactive, width: 24, height: 24, flexShrink: 0, alignItems: "center", justifyContent: "center", color: color.tertiary, fontSize: 12 }} hoverStyle={{ background: color.hover, color: color.text }} onClick={props.onReopen}>↶</div>
        </Show>
      </div>
  );
}
