import type { SourceToken } from "./source-highlighter.js";

export interface SourceMatch {
  index: number;
  line: number;
  start: number;
  end: number;
}

export interface SourceSegment extends SourceToken {
  match?: "active" | "other";
}

export function findSourceMatches(lines: string[], query: string, caseSensitive = false): SourceMatch[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: SourceMatch[] = [];
  for (let line = 0; line < lines.length; line += 1) {
    const source = caseSensitive ? lines[line]! : lines[line]!.toLocaleLowerCase();
    let start = source.indexOf(needle);
    while (start >= 0) {
      matches.push({ index: matches.length, line, start, end: start + needle.length });
      start = source.indexOf(needle, start + Math.max(1, needle.length));
    }
  }
  return matches;
}

/** Splits syntax tokens only at search boundaries so both decorations survive. */
export function sourceSegments(tokens: SourceToken[], matches: SourceMatch[], activeMatch: number): SourceSegment[] {
  const offsets: Array<{ start: number; end: number; token: SourceToken }> = [];
  let cursor = 0;
  for (const token of tokens) {
    offsets.push({ start: cursor, end: cursor + token.content.length, token });
    cursor += token.content.length;
  }
  if (cursor === 0) return [{ content: " " }];
  const boundaries = new Set([0, cursor]);
  for (const token of offsets) { boundaries.add(token.start); boundaries.add(token.end); }
  for (const match of matches) { boundaries.add(match.start); boundaries.add(match.end); }
  const points = [...boundaries].filter((point) => point >= 0 && point <= cursor).sort((a, b) => a - b);
  return points.slice(0, -1).flatMap((start, index) => {
    const end = points[index + 1]!;
    if (end <= start) return [];
    const token = offsets.find((item) => start >= item.start && start < item.end);
    if (!token) return [];
    const match = matches.find((item) => start >= item.start && start < item.end);
    return [{
      ...token.token,
      content: token.token.content.slice(start - token.start, end - token.start),
      match: match ? (match.index === activeMatch ? "active" : "other") : undefined,
    } satisfies SourceSegment];
  });
}
