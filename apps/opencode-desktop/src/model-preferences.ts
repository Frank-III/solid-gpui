import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type StoredModels = { version: 1; recent: string[]; favorites: string[]; variants: Record<string, string> };
export interface ModelPreferencesStorage { read(): string | undefined; write(contents: string): void }

class FileStorage implements ModelPreferencesStorage {
  constructor(private readonly path: string) {}
  read() { try { return readFileSync(this.path, "utf8"); } catch { return undefined; } }
  write(contents: string) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.path), 0o700);
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

const defaultPath = () => join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "opencode-desktop", "models.json");
export const modelKey = (model: { providerID: string; id: string }) => `${model.providerID}/${model.id}`;

/** Global desktop-only model recents, favorites, and remembered variants. */
export class ModelPreferences {
  #recent: string[] = [];
  #favorites = new Set<string>();
  #variants: Record<string, string> = {};
  readonly #storage: ModelPreferencesStorage;

  constructor(options: { storage?: ModelPreferencesStorage; storagePath?: string } = {}) {
    this.#storage = options.storage ?? new FileStorage(options.storagePath ?? defaultPath());
    try {
      const stored = JSON.parse(this.#storage.read() ?? "null") as Partial<StoredModels> | null;
      if (stored?.version !== 1) return;
      if (Array.isArray(stored.recent)) this.#recent = Array.from(new Set(stored.recent.filter((item): item is string => typeof item === "string"))).slice(0, 5);
      if (Array.isArray(stored.favorites)) this.#favorites = new Set(stored.favorites.filter((item): item is string => typeof item === "string"));
      if (stored.variants && typeof stored.variants === "object" && !Array.isArray(stored.variants)) this.#variants = Object.fromEntries(Object.entries(stored.variants).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    } catch { /* Invalid local preferences are ignored. */ }
  }

  use(key: string): void { this.#recent = [key, ...this.#recent.filter((item) => item !== key)].slice(0, 5); this.#save(); }
  recent(): string[] { return [...this.#recent]; }
  favorite(key: string): boolean { return this.#favorites.has(key); }
  favorites(): string[] { return [...this.#favorites]; }
  toggleFavorite(key: string): void { this.#favorites.has(key) ? this.#favorites.delete(key) : this.#favorites.add(key); this.#save(); }
  variant(key: string): string | undefined { return this.#variants[key]; }
  setVariant(key: string, variant?: string): void { if (variant) this.#variants[key] = variant; else delete this.#variants[key]; this.#save(); }
  #save(): void { try { this.#storage.write(JSON.stringify({ version: 1, recent: this.#recent, favorites: [...this.#favorites], variants: this.#variants } satisfies StoredModels)); } catch { /* Local preferences are best effort. */ } }
}
