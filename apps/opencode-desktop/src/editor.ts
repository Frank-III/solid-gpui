export interface EditorState {
  value: string;
  cursor: number;
  anchor?: number;
}

export interface ActiveFileMention {
  start: number;
  end: number;
  query: string;
}

/** Returns the file mention being typed immediately before the cursor. */
export function activeFileMention(state: EditorState): ActiveFileMention | undefined {
  const prefix = state.value.slice(0, state.cursor);
  const match = /(^|[\s([{"'])@([^\s@]*)$/.exec(prefix);
  if (!match) return undefined;
  const start = prefix.length - (match[2]?.length ?? 0) - 1;
  return { start, end: state.cursor, query: match[2] ?? "" };
}

export function replaceFileMention(state: EditorState, mention: ActiveFileMention, path: string): EditorState {
  const suffix = state.value.slice(mention.end);
  const spacer = /^\s/.test(suffix) ? "" : " ";
  const value = `${state.value.slice(0, mention.start)}@${path}${spacer}${suffix}`;
  return { value, cursor: mention.start + path.length + 1 + spacer.length };
}

const range = (state: EditorState): [number, number] => state.anchor === undefined
  ? [state.cursor, state.cursor]
  : [Math.min(state.anchor, state.cursor), Math.max(state.anchor, state.cursor)];

export const insertText = (state: EditorState, text: string): EditorState => {
  const [start, end] = range(state);
  return {
    value: state.value.slice(0, start) + text + state.value.slice(end),
    cursor: start + text.length,
  };
};
