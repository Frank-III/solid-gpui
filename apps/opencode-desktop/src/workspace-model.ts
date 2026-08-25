import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type DiffSide = "old" | "new";

export interface LineSelection {
  path: string;
  startLine: number;
  endLine: number;
  side?: DiffSide;
}

export interface PromptContext extends LineSelection {
  id: string;
  comment?: string;
  preview?: string;
  origin: "file" | "review";
}

export interface DiffRow {
  kind: "hunk" | "context" | "change";
  oldLine?: number;
  newLine?: number;
  oldText?: string;
  newText?: string;
}

export function normalizeSelection(selection: LineSelection): LineSelection {
  return {
    ...selection,
    startLine: Math.min(selection.startLine, selection.endLine),
    endLine: Math.max(selection.startLine, selection.endLine),
  };
}

export function selectionID(selection: LineSelection): string {
  const value = normalizeSelection(selection);
  return `${value.path}:${value.side ?? "file"}:${value.startLine}-${value.endLine}`;
}

export function contextFileURL(directory: string, selection: LineSelection): string {
  const value = normalizeSelection(selection);
  const url = pathToFileURL(resolve(directory, value.path));
  url.searchParams.set("start", String(value.startLine));
  url.searchParams.set("end", String(value.endLine));
  return url.href;
}

export function formatCommentNote(input: Pick<PromptContext, "path" | "startLine" | "endLine" | "comment">): string {
  const selection = normalizeSelection({ ...input, path: input.path });
  const range = selection.startLine === selection.endLine
    ? `line ${selection.startLine}`
    : `lines ${selection.startLine} through ${selection.endLine}`;
  return `The user made the following comment regarding ${range} of ${selection.path}: ${input.comment?.trim() ?? ""}`;
}

export function selectedLinePreview(content: string, selection: Pick<LineSelection, "startLine" | "endLine">): string {
  const start = Math.min(selection.startLine, selection.endLine);
  const end = Math.max(selection.startLine, selection.endLine);
  return content.split("\n").slice(start - 1, end).join("\n");
}

function hunkHeader(line: string): { oldLine: number; newLine: number } | undefined {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) return;
  return { oldLine: Number(match[1]), newLine: Number(match[2]) };
}

/** Converts a unified patch into aligned old/new rows suitable for a split review. */
export function parseUnifiedPatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const lines = patch.split("\n");
  let oldLine = 0;
  let newLine = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const header = hunkHeader(line);
    if (header) {
      oldLine = header.oldLine;
      newLine = header.newLine;
      rows.push({ kind: "hunk", oldText: line, newText: line });
      index += 1;
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("\\ No newline")) {
      index += 1;
      continue;
    }
    if (line.startsWith("-")) {
      const removed: string[] = [];
      const added: string[] = [];
      while (lines[index]?.startsWith("-") && !lines[index]?.startsWith("---")) removed.push(lines[index++]!.slice(1));
      while (lines[index]?.startsWith("+") && !lines[index]?.startsWith("+++")) added.push(lines[index++]!.slice(1));
      const count = Math.max(removed.length, added.length);
      for (let offset = 0; offset < count; offset += 1) {
        const oldText = removed[offset];
        const newText = added[offset];
        rows.push({
          kind: "change",
          oldLine: oldText === undefined ? undefined : oldLine++,
          newLine: newText === undefined ? undefined : newLine++,
          oldText,
          newText,
        });
      }
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "change", newLine: newLine++, newText: line.slice(1) });
      index += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      rows.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, oldText: line.slice(1), newText: line.slice(1) });
    }
    index += 1;
  }
  return rows;
}
