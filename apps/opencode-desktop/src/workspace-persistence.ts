import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PromptContext } from "./workspace-model.js";

interface StoredWorkspace {
  version: 1;
  project: string;
  tabs: { open: string[]; selected?: string };
  sessions?: { open: string[]; selected?: string; closed?: string[] };
  contexts: Record<string, PromptContext[]>;
}

export interface WorkspaceStorage {
  read(): string | undefined;
  write(contents: string): void;
}

class FileStorage implements WorkspaceStorage {
  constructor(private readonly path: string) {}
  read(): string | undefined {
    try { return readFileSync(this.path, "utf8"); } catch { return undefined; }
  }
  write(contents: string): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.path), 0o700);
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

function defaultPath(project: string): string {
  const root = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const key = createHash("sha256").update(project).digest("hex").slice(0, 24);
  return join(root, "opencode-desktop", "workspace", `${key}.json`);
}

function validContext(value: unknown): value is PromptContext {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.path === "string"
    && Number.isInteger(item.startLine)
    && Number.isInteger(item.endLine)
    && (item.side === undefined || item.side === "old" || item.side === "new")
    && (item.comment === undefined || typeof item.comment === "string")
    && (item.preview === undefined || typeof item.preview === "string")
    && (item.origin === "file" || item.origin === "review");
}

/** Persisted project tabs and per-session prompt context. */
export class WorkspacePersistence {
  #tabs: StoredWorkspace["tabs"] = { open: [] };
  #sessions: NonNullable<StoredWorkspace["sessions"]> = { open: [], closed: [] };
  #contexts: Record<string, PromptContext[]> = {};
  #timer?: ReturnType<typeof setTimeout>;
  readonly #project: string;
  readonly #storage: WorkspaceStorage;
  readonly #debounceMs: number;

  constructor(options: { projectDirectory: string; storage?: WorkspaceStorage; storagePath?: string; debounceMs?: number }) {
    this.#project = options.projectDirectory;
    this.#storage = options.storage ?? new FileStorage(options.storagePath ?? defaultPath(this.#project));
    this.#debounceMs = options.debounceMs ?? 300;
    this.#load();
  }

  #load(): void {
    try {
      const parsed = JSON.parse(this.#storage.read() ?? "null") as unknown;
      if (!parsed || typeof parsed !== "object") return;
      const stored = parsed as Partial<StoredWorkspace>;
      if (stored.version !== 1 || stored.project !== this.#project) return;
      if (stored.tabs && Array.isArray(stored.tabs.open) && stored.tabs.open.every((path) => typeof path === "string")) {
        const open = Array.from(new Set(stored.tabs.open)).slice(0, 30);
        const selected = typeof stored.tabs.selected === "string" && open.includes(stored.tabs.selected) ? stored.tabs.selected : open.at(-1);
        this.#tabs = { open, selected };
      }
      if (stored.sessions && Array.isArray(stored.sessions.open) && stored.sessions.open.every((id) => typeof id === "string")) {
        const open = Array.from(new Set(stored.sessions.open)).slice(-20);
        const selected = typeof stored.sessions.selected === "string" && open.includes(stored.sessions.selected) ? stored.sessions.selected : open.at(-1);
        const closed = Array.isArray(stored.sessions.closed)
          ? Array.from(new Set(stored.sessions.closed.filter((id): id is string => typeof id === "string" && !open.includes(id)))).slice(-20)
          : [];
        this.#sessions = { open, selected, closed };
      }
      if (stored.contexts && typeof stored.contexts === "object" && !Array.isArray(stored.contexts)) {
        for (const [sessionID, contexts] of Object.entries(stored.contexts)) {
          if (Array.isArray(contexts) && contexts.every(validContext)) this.#contexts[sessionID] = contexts.slice(-100);
        }
      }
    } catch { /* Invalid state is ignored. */ }
  }

  tabs(): { open: string[]; selected?: string } {
    return { open: [...this.#tabs.open], selected: this.#tabs.selected };
  }

  saveTabs(open: string[], selected?: string): void {
    const unique = Array.from(new Set(open)).slice(-30);
    this.#tabs = { open: unique, selected: selected && unique.includes(selected) ? selected : unique.at(-1) };
    this.#changed();
  }

  sessionTabs(): { open: string[]; selected?: string; closed: string[] } {
    return { open: [...this.#sessions.open], selected: this.#sessions.selected, closed: [...(this.#sessions.closed ?? [])] };
  }

  saveSessionTabs(open: string[], selected?: string, closed: string[] = []): void {
    const unique = Array.from(new Set(open)).slice(-20);
    this.#sessions = {
      open: unique,
      selected: selected && unique.includes(selected) ? selected : unique.at(-1),
      closed: Array.from(new Set(closed.filter((id) => !unique.includes(id)))).slice(-20),
    };
    this.#changed();
  }

  contexts(sessionID: string | undefined): PromptContext[] {
    return sessionID ? (this.#contexts[sessionID] ?? []).map((context) => ({ ...context })) : [];
  }

  saveContexts(sessionID: string | undefined, contexts: PromptContext[]): void {
    if (!sessionID) return;
    if (contexts.length === 0) delete this.#contexts[sessionID];
    else this.#contexts[sessionID] = contexts.slice(-100).map((context) => ({ ...context }));
    this.#changed();
  }

  #changed(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), this.#debounceMs);
    this.#timer.unref?.();
  }

  flush(): void {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = undefined; }
    try {
      this.#storage.write(JSON.stringify({ version: 1, project: this.#project, tabs: this.#tabs, sessions: this.#sessions, contexts: this.#contexts } satisfies StoredWorkspace));
    } catch { /* Persistence failure must not take down the desktop app. */ }
  }
}
