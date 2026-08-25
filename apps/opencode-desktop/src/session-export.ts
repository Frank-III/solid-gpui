import type { OpenCodeState } from "./opencode.js";
import { toolPresentation, toolSections } from "./transcript-model.js";

const fence = (value: string, language = "") => `\`\`\`${language}\n${value}\n\`\`\``;

function partMarkdown(part: OpenCodeState["messages"][number]["parts"][number]): string[] {
  if (part.type === "text") return [part.text];
  if (part.type === "reasoning") return [`<details><summary>Reasoning</summary>\n\n${part.text}\n\n</details>`];
  if (part.type === "file") return [`[${part.filename ?? "file"}](${part.url})`];
  if (part.type === "patch") return [`Changed ${part.files.join(", ")}`];
  if (part.type === "subtask") return [`**Subtask · ${part.agent}:** ${part.description}\n\n${part.prompt}`];
  if (part.type === "compaction") return [`> Context compacted · ${part.auto ? "automatic" : "manual"}${part.overflow ? " · overflow" : ""}`];
  if (part.type === "retry") return [`> Retry ${part.attempt}: ${part.error.data.message}`];
  if (part.type === "step-finish") {
    const total = part.tokens.input + part.tokens.output + part.tokens.reasoning + part.tokens.cache.read + part.tokens.cache.write;
    return [`_${part.reason} · ${total.toLocaleString()} tokens · $${part.cost.toFixed(4)}_`];
  }
  if (part.type !== "tool") return [];
  const presentation = toolPresentation(part);
  const sections = toolSections(part).map((section) => {
    const language = section.format === "structured" && section.content.trimStart().startsWith("{") ? "json" : "";
    return `**${section.title}**\n\n${fence(section.content, language)}`;
  });
  return [`<details><summary>${presentation.title} — ${part.state.status}</summary>\n\n${sections.join("\n\n")}\n\n</details>`];
}

export function sessionMarkdown(state: OpenCodeState): string {
  const session = state.sessions.find((item) => item.id === state.selectedID);
  const messages = state.messages.map((message) => {
    const body = message.parts.flatMap(partMarkdown).filter(Boolean).join("\n\n");
    let usage = "";
    if (message.info.role === "assistant") {
      const tokens = message.info.tokens;
      const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
      usage = `\n\n_${message.info.providerID}/${message.info.modelID} · ${total.toLocaleString()} tokens (${tokens.input.toLocaleString()} in / ${tokens.output.toLocaleString()} out / ${tokens.reasoning.toLocaleString()} reasoning / ${tokens.cache.read.toLocaleString()} cache read / ${tokens.cache.write.toLocaleString()} cache write) · $${message.info.cost.toFixed(4)}_`;
    }
    return `## ${message.info.role === "user" ? "User" : "Assistant"}\n\n${body}${usage}`;
  });
  return [`# ${session?.title ?? "OpenCode session"}`, ...messages].join("\n\n");
}
