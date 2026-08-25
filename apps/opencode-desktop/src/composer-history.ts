import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ComposerMode = "prompt" | "shell";
type HistoryEntry = { mode: ComposerMode; text: string };
type SessionState = { drafts?: string; entries: HistoryEntry[] };
type StoredState = { version: 1; project: string; sessions: Record<string, SessionState> };

export interface ComposerHistoryStorage {
  read(): string | undefined;
  write(contents: string): void;
}

class FileStorage implements ComposerHistoryStorage {
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

export interface ComposerHistoryOptions {
  projectDirectory?: string;
  storage?: ComposerHistoryStorage;
  storagePath?: string;
  debounceMs?: number;
  maxEntries?: number;
}

function defaultPath(project: string): string {
  const root = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const key = createHash("sha256").update(project).digest("hex").slice(0, 24);
  return join(root, "opencode-desktop", "composer", `${key}.json`);
}

function validEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (entry.mode === "prompt" || entry.mode === "shell") && typeof entry.text === "string";
}

/** Persistent drafts and history, isolated by project and session. */
export class ComposerHistory {
  #sessions = new Map<string, SessionState>();
  #positions = new Map<string, number>();
  #scratch = new Map<string, string>();
  #timer?: ReturnType<typeof setTimeout>;
  readonly #project: string;
  readonly #storage: ComposerHistoryStorage;
  readonly #debounceMs: number;
  readonly #maxEntries: number;

  constructor(options: ComposerHistoryOptions = {}) {
    this.#project = options.projectDirectory ?? "";
    this.#storage = options.storage ?? new FileStorage(options.storagePath ?? defaultPath(this.#project));
    this.#debounceMs = options.debounceMs ?? 300;
    this.#maxEntries = options.maxEntries ?? 100;
    this.#load();
  }

  #load(): void {
    try {
      const value = JSON.parse(this.#storage.read() ?? "null") as unknown;
      if (!value || typeof value !== "object") return;
      const stored = value as Partial<StoredState>;
      if (stored.version !== 1 || stored.project !== this.#project || !stored.sessions || typeof stored.sessions !== "object" || Array.isArray(stored.sessions)) return;
      for (const [id, raw] of Object.entries(stored.sessions)) {
        if (!raw || typeof raw !== "object") continue;
        const session = raw as Partial<SessionState>;
        if (session.drafts !== undefined && typeof session.drafts !== "string") continue;
        if (!Array.isArray(session.entries) || !session.entries.every(validEntry)) continue;
        this.#sessions.set(id, { drafts: session.drafts, entries: session.entries.slice(-this.#maxEntries) });
      }
    } catch { /* Invalid state is ignored. */ }
  }

  #session(id: string): SessionState {
    let value = this.#sessions.get(id);
    if (!value) { value = { entries: [] }; this.#sessions.set(id, value); }
    return value;
  }

  #changed(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), this.#debounceMs);
    this.#timer.unref?.();
  }

  saveDraft(sessionID: string | undefined, text: string): void {
    if (!sessionID) return;
    const session = this.#session(sessionID);
    if (session.drafts === text) return;
    session.drafts = text;
    this.#changed();
  }

  draft(sessionID: string | undefined): string { return sessionID ? this.#sessions.get(sessionID)?.drafts ?? "" : ""; }

  clearDraft(sessionID: string | undefined): void {
    if (sessionID && this.#sessions.get(sessionID)?.drafts !== undefined) {
      delete this.#sessions.get(sessionID)!.drafts;
      this.#changed();
    }
  }

  record(sessionID: string | undefined, mode: ComposerMode, text: string): void {
    if (!sessionID) return;
    const value = text.trim();
    if (!value) return;
    const entries = this.#session(sessionID).entries;
    const previous = entries.at(-1);
    if (!previous || previous.mode !== mode || previous.text !== value) {
      entries.push({ mode, text: value });
      if (entries.length > this.#maxEntries) entries.splice(0, entries.length - this.#maxEntries);
      this.#changed();
    }
    this.reset(sessionID);
  }

  previous(sessionID: string | undefined, mode: ComposerMode, current: string): string {
    if (!sessionID) return current;
    const entries = this.#sessions.get(sessionID)?.entries ?? [];
    const matches = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.mode === mode);
    if (!matches.length) return current;
    let position = this.#positions.get(sessionID);
    if (position === undefined) { this.#scratch.set(sessionID, current); position = matches.at(-1)!.index; }
    else position = matches.filter(({ index }) => index < position!).at(-1)?.index ?? position;
    this.#positions.set(sessionID, position);
    return entries[position]!.text;
  }

  next(sessionID: string | undefined, mode: ComposerMode, current: string): string {
    if (!sessionID) return current;
    const position = this.#positions.get(sessionID);
    if (position === undefined) return current;
    const entries = this.#sessions.get(sessionID)?.entries ?? [];
    const next = entries.map((entry, index) => ({ entry, index })).find(({ entry, index }) => entry.mode === mode && index > position);
    if (next) { this.#positions.set(sessionID, next.index); return next.entry.text; }
    const scratch = this.#scratch.get(sessionID) ?? "";
    this.reset(sessionID);
    return scratch;
  }

  reset(sessionID?: string): void {
    if (sessionID) { this.#positions.delete(sessionID); this.#scratch.delete(sessionID); }
    else { this.#positions.clear(); this.#scratch.clear(); }
  }

  flush(): void {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = undefined; }
    const sessions = Object.fromEntries(this.#sessions);
    try {
      this.#storage.write(JSON.stringify({ version: 1, project: this.#project, sessions } satisfies StoredState));
    } catch { /* Persistence failure must not take down the desktop app. */ }
  }
}
