import { createSignal, For, Show } from "solid-js";
import type { QuestionRequest } from "@opencode-ai/sdk/v2";
import type { OpenCodeState } from "./opencode.js";
import { color, interactive } from "./theme.js";
import { Button } from "./ui.js";

export function PermissionDialog(props: {
  state: OpenCodeState;
  reply: (response: "reject" | "always" | "once") => void;
}) {
  const permission = () => props.state.permission!;
  return (
    <Show when={props.state.permission}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          alignItems: "center",
          justifyContent: "center",
          background: "#0008",
        }}
      >
        <div
          style={{
            width: 510,
            flexDirection: "column",
            gap: 12,
            padding: 18,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: color.borderStrong,
            background: "#242321",
            boxShadow: [{ y: 12, blur: 40, color: "#000b" }],
          }}
        >
          <div
            style={{ color: color.yellow, fontSize: 11, fontWeight: "bold" }}
          >
            PERMISSION REQUIRED
          </div>
          <div style={{ fontSize: 16, fontWeight: "bold" }}>
            Allow {permission().permission}?
          </div>
          <For each={permission().patterns}>
            {(pattern) => (
              <div
                style={{
                  padding: 9,
                  borderRadius: 6,
                  background: color.raised,
                  color: color.secondary,
                  fontFamily: "monospace",
                  fontSize: 10,
                }}
              >
                {pattern}
              </div>
            )}
          </For>
          <div style={{ justifyContent: "end", gap: 8, marginTop: 5 }}>
            <Button tone="danger" onClick={() => props.reply("reject")}>
              Reject
            </Button>
            <Button onClick={() => props.reply("always")}>Always allow</Button>
            <Button tone="primary" onClick={() => props.reply("once")}>
              Allow once
            </Button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export function QuestionDialog(props: {
  request?: QuestionRequest;
  reject: () => void;
  reply: (answers: string[][]) => void;
}) {
  const [answers, setAnswers] = createSignal<string[][]>([]);
  const [custom, setCustom] = createSignal<string[]>([]);
  const toggle = (index: number, label: string, multiple: boolean) =>
    setAnswers((current) => {
      const next = current.map((value) => [...value]);
      const selected = next[index] ?? [];
      next[index] = multiple
        ? selected.includes(label)
          ? selected.filter((value) => value !== label)
          : [...selected, label]
        : [label];
      return next;
    });
  return (
    <Show when={props.request}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          alignItems: "center",
          justifyContent: "center",
          background: "#0008",
        }}
      >
        <div
          style={{
            width: 560,
            maxHeight: 650,
            overflowY: "scroll",
            flexDirection: "column",
            gap: 15,
            padding: 18,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: color.borderStrong,
            background: "#242321",
          }}
        >
          <div style={{ color: color.blue, fontSize: 11, fontWeight: "bold" }}>
            OPENCODE HAS A QUESTION
          </div>
          <For each={props.request!.questions}>
            {(question, questionIndex) => (
              <div style={{ flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: "semibold" }}>
                  {question.header}
                </div>
                <div
                  style={{
                    color: color.secondary,
                    fontSize: 12,
                    lineHeight: 18,
                  }}
                >
                  {question.question}
                </div>
                <For each={question.options}>
                  {(option) => {
                    const selected = () =>
                      answers()[questionIndex()]?.includes(option.label) ??
                      false;
                    return (
                      <div
                        style={{
                          ...interactive,
                          flexDirection: "column",
                          gap: 3,
                          padding: 10,
                          borderWidth: 1,
                          borderColor: selected() ? color.blue : color.border,
                          background: selected() ? "#24313d" : color.raised,
                        }}
                        hoverStyle={{ borderColor: color.blue }}
                        onClick={() =>
                          toggle(
                            questionIndex(),
                            option.label,
                            question.multiple ?? false,
                          )
                        }
                      >
                        <div style={{ fontSize: 11, fontWeight: "semibold" }}>
                          {selected() ? "● " : "○ "}
                          {option.label}
                        </div>
                        <div style={{ color: color.tertiary, fontSize: 10 }}>
                          {option.description}
                        </div>
                      </div>
                    );
                  }}
                </For>
                <Show when={question.custom}>
                  <div style={{ flexDirection: "column", gap: 5 }}>
                    <div style={{ color: color.tertiary, fontSize: 10 }}>Custom answer</div>
                    <input
                      value={custom()[questionIndex()] ?? ""}
                      selectionStart={(custom()[questionIndex()] ?? "").length}
                      selectionEnd={(custom()[questionIndex()] ?? "").length}
                      style={{ height: 34, paddingX: 9, borderWidth: 1, borderColor: color.borderStrong, borderRadius: 6, background: color.raised, color: color.text, fontSize: 11 }}
                      onInput={(event) => setCustom((current) => {
                        const next = [...current];
                        next[questionIndex()] = event.value;
                        return next;
                      })}
                    />
                  </div>
                </Show>
              </div>
            )}
          </For>
          <div style={{ justifyContent: "end", gap: 8 }}>
            <Button
              tone="danger"
              onClick={() => {
                setAnswers([]);
                setCustom([]);
                props.reject();
              }}
            >
              Reject
            </Button>
            <Button
              tone="primary"
              onClick={() => {
                const selected = props.request!.questions.map((_, index) => [
                  ...(answers()[index] ?? []),
                  ...(custom()[index]?.trim() ? [custom()[index]!.trim()] : []),
                ]);
                setAnswers([]);
                setCustom([]);
                props.reply(selected);
              }}
            >
              Submit answers
            </Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
