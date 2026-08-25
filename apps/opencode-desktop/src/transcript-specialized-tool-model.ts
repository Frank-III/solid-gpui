import type { Part } from "@opencode-ai/sdk/v2";

export type ToolPart = Extract<Part, { type: "tool" }>;

export interface ToolDiagnostic {
  line: number;
  column: number;
  message: string;
}

export interface ToolFileChange {
  path: string;
  relativePath: string;
  type: "add" | "update" | "delete" | "move";
  patch?: string;
  additions: number;
  deletions: number;
  movePath?: string;
}

export type SpecializedTool =
  | { kind: "edit"; title: "Edit"; path: string; patch?: string; before?: string; after?: string; additions: number; deletions: number; diagnostics: ToolDiagnostic[] }
  | { kind: "write"; title: "Write"; path: string; content: string; diagnostics: ToolDiagnostic[] }
  | { kind: "patch"; title: "Patch"; files: ToolFileChange[] }
  | { kind: "websearch"; title: string; query?: string; urls: string[] }
  | { kind: "webfetch"; title: "Webfetch"; url?: string };

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const text = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;
const number = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;

function metadata(part: ToolPart): Record<string, unknown> {
  return "metadata" in part.state ? record(part.state.metadata) ?? {} : {};
}

function output(part: ToolPart): string {
  return part.state.status === "completed" && typeof part.state.output === "string" ? part.state.output : "";
}

function diagnostics(value: unknown, path: string): ToolDiagnostic[] {
  const items = record(value)?.[path];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const diagnostic = record(item);
    const start = record(record(diagnostic?.["range"])?.["start"]);
    const message = text(diagnostic?.["message"]);
    if (diagnostic?.["severity"] !== 1 || !start || !message) return [];
    return [{ line: number(start["line"]) + 1, column: number(start["character"]) + 1, message }];
  }).slice(0, 3);
}

function patchFiles(value: unknown): ToolFileChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const file = record(item);
    if (!file) return [];
    const filePath = text(file["filePath"]);
    const relativePath = text(file["relativePath"]) ?? filePath;
    const type = file["type"];
    if (!filePath || !relativePath || !["add", "update", "delete", "move"].includes(String(type))) return [];
    return [{
      path: filePath,
      relativePath,
      type: type as ToolFileChange["type"],
      patch: text(file["patch"]) ?? text(file["diff"]),
      additions: number(file["additions"]),
      deletions: number(file["deletions"]),
      movePath: text(file["movePath"]),
    }];
  });
}

export function webURLs(value: string): string[] {
  const seen = new Set<string>();
  return (value.match(/https?:\/\/[^\s<>"']+/g) ?? [])
    .map((url) => url.replace(/[)\],.;:!?]+$/g, ""))
    .filter((url) => url && !seen.has(url) && Boolean(seen.add(url)));
}

export function specializedTool(part: ToolPart): SpecializedTool | undefined {
  if (part.state.status === "error") return;
  const input = part.state.input;
  const meta = metadata(part);
  if (part.tool === "edit") {
    const path = text(input["filePath"]);
    if (!path) return;
    const diff = record(meta["filediff"]);
    return {
      kind: "edit",
      title: "Edit",
      path: text(diff?.["file"]) ?? path,
      patch: text(diff?.["patch"]) ?? text(meta["diff"]),
      before: text(diff?.["before"]) ?? text(input["oldString"]),
      after: text(diff?.["after"]) ?? text(input["newString"]),
      additions: number(diff?.["additions"]),
      deletions: number(diff?.["deletions"]),
      diagnostics: diagnostics(meta["diagnostics"], path),
    };
  }
  if (part.tool === "write") {
    const path = text(input["filePath"]);
    if (!path) return;
    return { kind: "write", title: "Write", path, content: text(input["content"]) ?? "", diagnostics: diagnostics(meta["diagnostics"], path) };
  }
  if (part.tool === "apply_patch" || part.tool === "patch") {
    return { kind: "patch", title: "Patch", files: patchFiles(meta["files"]) };
  }
  if (part.tool === "websearch") {
    const provider = text(meta["provider"]);
    return {
      kind: "websearch",
      title: provider === "exa" ? "Exa Web Search" : provider === "parallel" ? "Parallel Web Search" : "Web Search",
      query: text(input["query"]),
      urls: webURLs(output(part)),
    };
  }
  if (part.tool === "webfetch") return { kind: "webfetch", title: "Webfetch", url: text(input["url"]) };
}

export function pathParts(path: string): { name: string; directory: string } {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return { name: parts.pop() || path, directory: parts.join("/") };
}
