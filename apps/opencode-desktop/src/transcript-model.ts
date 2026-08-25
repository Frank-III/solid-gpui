import type { Part, Session, SessionStatus } from "@opencode-ai/sdk/v2";

export type TextBlock = {
  kind: "paragraph" | "heading" | "bullet" | "numbered" | "quote" | "code" | "space";
  text: string;
  language?: string;
  marker?: string;
};

export type InlineRun = {
  kind: "text" | "code" | "strong" | "emphasis" | "strike" | "link";
  text: string;
  href?: string;
};

const INLINE_PATTERNS: Array<{ kind: InlineRun["kind"]; pattern: RegExp; text: number; href?: number }> = [
  { kind: "code", pattern: /`([^`\n]+)`/g, text: 1 },
  { kind: "link", pattern: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, text: 1, href: 2 },
  { kind: "strong", pattern: /\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, text: 1 },
  { kind: "strike", pattern: /~~([^~\n]+)~~/g, text: 1 },
  { kind: "emphasis", pattern: /(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/g, text: 1 },
];

/** Parses inline runs without hiding incomplete syntax while text is streaming. */
export function parseInlineMarkdown(value: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let offset = 0;
  while (offset < value.length) {
    let selected: { kind: InlineRun["kind"]; index: number; end: number; text: string; href?: string } | undefined;
    for (const candidate of INLINE_PATTERNS) {
      candidate.pattern.lastIndex = offset;
      const match = candidate.pattern.exec(value);
      if (!match || (selected && match.index >= selected.index)) continue;
      const text = match[candidate.text] ?? match[candidate.text + 1];
      if (!text) continue;
      selected = {
        kind: candidate.kind,
        index: match.index,
        end: match.index + match[0].length,
        text,
        href: candidate.href === undefined ? undefined : match[candidate.href],
      };
    }
    if (!selected) {
      runs.push({ kind: "text", text: value.slice(offset) });
      break;
    }
    if (selected.index > offset) runs.push({ kind: "text", text: value.slice(offset, selected.index) });
    runs.push({ kind: selected.kind, text: selected.text, ...(selected.href ? { href: selected.href } : {}) });
    offset = selected.end;
  }
  return runs.length ? runs : [{ kind: "text", text: "" }];
}

/** A deliberately small, deterministic Markdown block parser for the native renderer. */
export function parseTranscriptMarkdown(value: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let code: string[] | undefined;
  let language = "";
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```\s*([^`]*)$/);
    if (fence) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n"), language });
        code = undefined;
      } else {
        flushParagraph();
        code = [];
        language = (fence[1] ?? "").trim();
      }
      continue;
    }
    if (code) { code.push(line); continue; }
    if (!line.trim()) {
      flushParagraph();
      if (blocks.length && blocks.at(-1)?.kind !== "space") blocks.push({ kind: "space", text: "" });
      continue;
    }
    const heading = line.match(/^\s*#{1,6}\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (heading || bullet || numbered || quote) {
      flushParagraph();
      if (heading) blocks.push({ kind: "heading", text: heading[1]! });
      else if (bullet) blocks.push({ kind: "bullet", text: bullet[1]!, marker: "•" });
      else if (numbered) blocks.push({ kind: "numbered", text: numbered[2]!, marker: `${numbered[1]}.` });
      else if (quote) blocks.push({ kind: "quote", text: quote[1]! });
    } else paragraph.push(line);
  }
  flushParagraph();
  if (code) blocks.push({ kind: "code", text: code.join("\n"), language });
  while (blocks.at(-1)?.kind === "space") blocks.pop();
  return blocks;
}

export function formatStructured(value: unknown, limit = 12_000): string {
  if (typeof value === "string") return value.length > limit ? `${value.slice(0, limit)}\n… (truncated)` : value;
  try {
    const seen = new WeakSet<object>();
    const text = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") return `${item}n`;
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    }, 2) ?? String(value);
    return text.length > limit ? `${text.slice(0, limit)}\n… (truncated)` : text;
  } catch { return String(value); }
}

type ToolPart = Extract<Part, { type: "tool" }>;
export interface ToolPresentation {
  title: string;
  subtitle?: string;
  attributes: string[];
  childSessionID?: string;
  agent?: string;
  background: boolean;
}

export interface ToolSection {
  title: string;
  content: string;
  format: "structured" | "markdown" | "terminal";
}

const inputString = (input: Record<string, unknown>, key: string): string | undefined =>
  typeof input[key] === "string" && input[key] ? input[key] as string : undefined;

function stateMetadata(part: ToolPart): Record<string, unknown> | undefined {
  if (!("metadata" in part.state) || !part.state.metadata || typeof part.state.metadata !== "object") return undefined;
  return part.state.metadata as Record<string, unknown>;
}

export function toolPresentation(part: ToolPart): ToolPresentation {
  const input = part.state.input;
  const metadata = stateMetadata(part);
  const title = "title" in part.state && part.state.title ? part.state.title : part.tool === "task" ? "Subagent task" : part.tool;
  const keys = part.tool === "task"
    ? ["description", "subagent_type"]
    : ["description", "query", "url", "filePath", "path", "pattern", "name", "command"];
  const subtitle = keys.map((key) => inputString(input, key)).find(Boolean);
  const excluded = new Set(keys);
  const attributes = Object.entries(input)
    .filter(([key, value]) => !excluded.has(key) && ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`);
  const childSessionID = metadata && typeof metadata === "object" && typeof metadata["sessionId"] === "string"
    ? metadata["sessionId"] as string
    : undefined;
  return {
    title,
    subtitle,
    attributes,
    childSessionID,
    agent: part.tool === "task" ? inputString(input, "subagent_type") : undefined,
    background: metadata?.["background"] === true,
  };
}

/** Resolves a task's child session even when older tool metadata omitted its ID. */
export function taskChildSessionID(part: ToolPart, sessions: Session[]): string | undefined {
  const explicit = toolPresentation(part).childSessionID;
  if (explicit || part.tool !== "task") return explicit;
  const input = part.state.input;
  const description = inputString(input, "description")?.toLowerCase();
  const agent = inputString(input, "subagent_type")?.toLowerCase();
  return sessions
    .filter((session) => session.parentID === part.sessionID && !session.time.archived)
    .filter((session) => !description || session.title.toLowerCase().startsWith(description))
    .filter((session) => !agent || session.agent?.toLowerCase() === agent || session.title.toLowerCase().includes(`@${agent}`))
    .sort((left, right) => right.time.created - left.time.created)[0]?.id;
}

export function taskActivity(part: ToolPart, childStatus?: SessionStatus): { working: boolean; label: string } {
  const toolWorking = part.state.status === "pending" || part.state.status === "running";
  const background = part.tool === "task" && toolPresentation(part).background;
  if (background && childStatus?.type === "retry") {
    return { working: true, label: `retry ${childStatus.attempt}` };
  }
  if (background && childStatus?.type === "busy") return { working: true, label: "working" };
  return { working: toolWorking, label: part.state.status };
}

export function toolSections(part: ToolPart): ToolSection[] {
  const state = part.state;
  const sections: ToolSection[] = [{ title: "Input", content: formatStructured(state.input), format: "structured" }];
  if (state.status === "pending" && state.raw) sections.push({ title: "Raw input", content: state.raw, format: "structured" });
  if (state.status === "completed" && state.output) {
    const format = ["list", "glob", "grep", "websearch", "webfetch"].includes(part.tool)
      ? "markdown"
      : ["bash", "shell"].includes(part.tool) ? "terminal" : "structured";
    sections.push({ title: "Output", content: formatStructured(state.output), format });
  }
  if (state.status === "error") sections.push({ title: "Error", content: state.error, format: "terminal" });
  if ("metadata" in state && state.metadata && Object.keys(state.metadata).length)
    sections.push({ title: "Metadata", content: formatStructured(state.metadata), format: "structured" });
  return sections;
}

export function fileSourceDetail(source: Extract<Part, { type: "file" }>["source"]): string {
  if (!source) return "";
  if (source.type === "resource") return `${source.clientName} · ${source.uri}`;
  if (source.type === "symbol") return `${source.name} · ${source.path}:${source.range.start.line + 1}`;
  return `${source.path} · characters ${source.text.start}–${source.text.end}`;
}

export function toolDetail(part: ToolPart): string {
  return toolSections(part).map((section) => `${section.title}\n${section.content}`).join("\n\n");
}

export function toolSummary(part: ToolPart): string {
  const state = part.state;
  if (!("time" in state)) return part.callID;
  const elapsed = "end" in state.time ? Math.max(0, state.time.end - state.time.start) : undefined;
  return [part.callID, elapsed === undefined ? undefined : `${elapsed}ms`, state.status === "completed" && state.attachments?.length ? `${state.attachments.length} attachment${state.attachments.length === 1 ? "" : "s"}` : undefined].filter(Boolean).join(" · ");
}
