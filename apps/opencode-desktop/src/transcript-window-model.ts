import type { MessageItem } from "./opencode.js";

export const TRANSCRIPT_PAGE_SIZE = 32;

export interface TranscriptWindow {
  start: number;
  end: number;
  messages: MessageItem[];
}

/** Selects one bounded variable-height page ending before an optional message anchor. */
export function transcriptWindow(messages: MessageItem[], beforeID?: string): TranscriptWindow {
  const anchor = beforeID ? messages.findIndex((message) => message.info.id === beforeID) : -1;
  const end = anchor >= 0 ? anchor : messages.length;
  const start = Math.max(0, end - TRANSCRIPT_PAGE_SIZE);
  return { start, end, messages: messages.slice(start, end) };
}
