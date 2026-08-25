import type { Agent, McpResource, ReferenceInfo } from "@opencode-ai/sdk/v2";

export type MentionSuggestion =
  | { kind: "file" | "recent"; label: string; path: string; description?: string }
  | { kind: "agent"; label: string; name: string; description?: string }
  | { kind: "reference"; label: string; path: string; description?: string }
  | { kind: "resource"; label: string; uri: string; client: string; mime?: string; description?: string };

export interface AgentMention {
  name: string;
  start: number;
  end: number;
  text: string;
}

const matches = (query: string, ...values: Array<string | undefined>) => {
  const normalized = query.toLowerCase();
  return !normalized || values.some((value) => value?.toLowerCase().includes(normalized));
};

export function mentionSuggestions(input: {
  query: string;
  recent: string[];
  files: string[];
  agents: Agent[];
  references: ReferenceInfo[];
  resources: McpResource[];
}): MentionSuggestion[] {
  const usedPaths = new Set<string>();
  const recent = input.recent.filter((path) => matches(input.query, path)).flatMap((path) => {
    if (usedPaths.has(path)) return [];
    usedPaths.add(path);
    return [{ kind: "recent" as const, label: path, path, description: "Recent file" }];
  });
  const files = input.files.flatMap((path) => {
    if (usedPaths.has(path)) return [];
    usedPaths.add(path);
    return [{ kind: "file" as const, label: path, path }];
  });
  return [
    ...input.references.filter((item) => !item.hidden && matches(input.query, item.name, item.description, item.path)).map((item) => ({ kind: "reference" as const, label: item.name, path: item.path, description: item.description ?? "Reference" })),
    ...input.agents.filter((item) => !item.hidden && item.mode !== "primary" && matches(input.query, item.name, item.description)).map((item) => ({ kind: "agent" as const, label: item.name, name: item.name, description: item.description ?? "Agent" })),
    ...input.resources.filter((item) => matches(input.query, item.name, item.description, item.client, item.uri)).map((item) => ({ kind: "resource" as const, label: item.name, uri: item.uri, client: item.client, mime: item.mimeType, description: item.description ?? item.client })),
    ...recent,
    ...files,
  ].slice(0, 40);
}

export function agentMentions(text: string, selected: string[]): AgentMention[] {
  return Array.from(new Set(selected)).flatMap((name) => {
    const token = `@${name}`;
    const mentions: AgentMention[] = [];
    let start = text.indexOf(token);
    while (start >= 0) {
      const before = text[start - 1];
      const after = text[start + token.length];
      if ((!before || /[\s([{"']/.test(before)) && (!after || /[\s),.!?;:}\]"']/.test(after))) {
        mentions.push({ name, start, end: start + token.length, text: token });
      }
      start = text.indexOf(token, start + token.length);
    }
    return mentions;
  }).sort((a, b) => a.start - b.start);
}
