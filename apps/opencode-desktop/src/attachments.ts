import { basename, extname } from "node:path";
import type { ClipboardEntry } from "solid-gpui";
import type { FileMention } from "./opencode.js";

export interface ComposerAttachment {
  id: string;
  label: string;
  path?: string;
  mime: string;
  url?: string;
  token?: string;
  resource?: { clientName: string; uri: string };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
  ".json": "application/json",
  ".pdf": "application/pdf",
};

export function attachmentFromPath(path: string): ComposerAttachment {
  return {
    id: `path:${path}`,
    label: path,
    path,
    mime: MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? "text/plain",
  };
}

export function attachmentFromImage(entry: Extract<ClipboardEntry, { type: "image" }>, sequence: number): ComposerAttachment {
  const extension = entry.mime.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") ?? "png";
  return {
    id: `clipboard:${sequence}`,
    label: `Pasted image ${sequence}.${extension}`,
    mime: entry.mime,
    url: `data:${entry.mime};base64,${entry.data}`,
  };
}

export function attachmentFromReference(reference: { name: string; path: string }): ComposerAttachment {
  return { id: `reference:${reference.name}:${reference.path}`, label: reference.name, path: reference.path, mime: "application/x-directory", token: `@${reference.name}` };
}

export function attachmentFromResource(resource: { name: string; uri: string; client: string; mime?: string }): ComposerAttachment {
  return { id: `resource:${resource.client}:${resource.uri}`, label: resource.name, mime: resource.mime ?? "text/plain", url: resource.uri, token: `@${resource.name}`, resource: { clientName: resource.client, uri: resource.uri } };
}

export function attachmentFromMention(mention: FileMention, sequence: number): ComposerAttachment {
  const label = mention.path ?? mention.filename ?? `Attachment ${sequence}`;
  return {
    id: mention.path ? `path:${mention.path}` : `message:${sequence}:${mention.url ?? label}`,
    label,
    path: mention.path,
    mime: mention.mime ?? "text/plain",
    url: mention.url,
    token: mention.text || undefined,
    resource: mention.resource,
  };
}

export function attachmentToken(attachment: ComposerAttachment): string {
  return attachment.token ?? `@${attachment.path ?? attachment.label}`;
}

export function fileMentions(text: string, attachments: ComposerAttachment[]): FileMention[] {
  return attachments.flatMap((attachment) => {
    const value = attachmentToken(attachment);
    const mentions: FileMention[] = [];
    let start = text.indexOf(value);
    while (start >= 0) {
      mentions.push({
        path: attachment.path,
        filename: attachment.path ? basename(attachment.path) : attachment.label,
        mime: attachment.mime,
        url: attachment.url,
        start,
        end: start + value.length,
        text: value,
        resource: attachment.resource,
      });
      start = text.indexOf(value, start + value.length);
    }
    if (mentions.length === 0 && attachment.url && !attachment.path) {
      mentions.push({ filename: attachment.label, mime: attachment.mime, url: attachment.url, start: 0, end: 0, text: "", resource: attachment.resource });
    }
    return mentions;
  });
}
