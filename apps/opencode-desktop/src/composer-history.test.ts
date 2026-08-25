import { describe, expect, it } from "vitest";
import { ComposerHistory } from "./composer-history.js";

function memory(initial?: string) {
  let value = initial;
  return { read: () => value, write: (next: string) => { value = next; }, value: () => value };
}

describe("ComposerHistory", () => {
  it("keeps prompt and shell histories separate and restores the scratch draft", () => {
    const history = new ComposerHistory({ storage: memory() });
    history.record("one", "prompt", "first prompt");
    history.record("one", "shell", "pnpm test");
    history.record("one", "prompt", "second prompt");
    expect(history.previous("one", "prompt", "draft")).toBe("second prompt");
    expect(history.previous("one", "prompt", "second prompt")).toBe("first prompt");
    expect(history.next("one", "prompt", "first prompt")).toBe("second prompt");
    expect(history.next("one", "prompt", "second prompt")).toBe("draft");
    expect(history.previous("one", "shell", "")).toBe("pnpm test");
  });

  it("stores drafts by session", () => {
    const history = new ComposerHistory({ storage: memory() });
    history.saveDraft("one", "draft one");
    history.saveDraft("two", "draft two");
    expect(history.draft("one")).toBe("draft one");
    history.clearDraft("one");
    expect(history.draft("one")).toBe("");
  });

  it("persists only the matching project and session state", () => {
    const storage = memory();
    const first = new ComposerHistory({ projectDirectory: "/project", storage, maxEntries: 2 });
    first.saveDraft("one", "unfinished");
    first.record("one", "prompt", "old");
    first.record("one", "prompt", "new");
    first.record("one", "shell", "ls");
    first.flush();

    const restored = new ComposerHistory({ projectDirectory: "/project", storage });
    expect(restored.draft("one")).toBe("unfinished");
    expect(restored.previous("one", "shell", "")).toBe("ls");
    expect(restored.previous("two", "prompt", "empty")).toBe("empty");
    expect(new ComposerHistory({ projectDirectory: "/other", storage }).draft("one")).toBe("");
  });

  it("ignores invalid schema", () => {
    const storage = memory('{"version":2,"project":"/project","sessions":{}}');
    expect(new ComposerHistory({ projectDirectory: "/project", storage }).draft("one")).toBe("");
  });
});
