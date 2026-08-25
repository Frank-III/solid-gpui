import type { CodeHighlight } from "solid-gpui";
import type { SourceToken } from "./source-highlighter.js";
import type { SourceMatch } from "./source-search.js";
import { sourceSegments } from "./source-search.js";
import type { LineSelection } from "./workspace-model.js";

export interface TextSelection {
  start: number;
  end: number;
}

/** Converts per-line Shiki/search decorations into document-wide UTF-16 spans. */
export function codeHighlights(
  lines: string[],
  tokens: SourceToken[][],
  matches: SourceMatch[] = [],
  activeMatch = -1,
): CodeHighlight[] {
  const result: CodeHighlight[] = [];
  let documentOffset = 0;
  for (let line = 0; line < lines.length; line += 1) {
    let lineOffset = 0;
    const lineMatches = matches.filter((match) => match.line === line);
    for (const segment of sourceSegments(tokens[line] ?? [{ content: lines[line] ?? "" }], lineMatches, activeMatch)) {
      const length = Math.min(segment.content.length, Math.max(0, (lines[line]?.length ?? 0) - lineOffset));
      if (length > 0 && (segment.color || segment.fontStyle || segment.match)) {
        result.push({
          start: documentOffset + lineOffset,
          end: documentOffset + lineOffset + length,
          color: segment.color,
          background: segment.match === "active" ? "#9b6b2f" : segment.match === "other" ? "#554521" : undefined,
          fontStyle: segment.fontStyle,
        });
      }
      lineOffset += length;
    }
    documentOffset += (lines[line]?.length ?? 0) + (line < lines.length - 1 ? 1 : 0);
  }
  return result;
}

function lineAt(content: string, offset: number): number {
  return content.slice(0, Math.max(0, Math.min(offset, content.length))).split("\n").length;
}

export function lineSelection(path: string, content: string, selection: TextSelection): LineSelection | undefined {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  if (start === end) return;
  return { path, startLine: lineAt(content, start), endLine: lineAt(content, Math.max(start, end - 1)) };
}

export function selectedSourceText(content: string, selection: TextSelection): string {
  return content.slice(Math.min(selection.start, selection.end), Math.max(selection.start, selection.end));
}
