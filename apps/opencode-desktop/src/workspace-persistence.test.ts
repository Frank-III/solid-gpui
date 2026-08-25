import { describe, expect, it } from "vitest";
import { WorkspacePersistence, type WorkspaceStorage } from "./workspace-persistence.js";

class MemoryStorage implements WorkspaceStorage {
  value?: string;
  read() { return this.value; }
  write(contents: string) { this.value = contents; }
}

describe("WorkspacePersistence", () => {
  it("restores deduplicated tabs and per-session prompt context", () => {
    const storage = new MemoryStorage();
    const first = new WorkspacePersistence({ projectDirectory: "/project", storage, debounceMs: 60_000 });
    first.saveTabs(["src/a.ts", "src/b.ts", "src/a.ts"], "src/b.ts");
    first.saveSessionTabs(["ses_one", "ses_two", "ses_one"], "ses_two", ["ses_old", "ses_one"]);
    first.saveContexts("ses_one", [{ id: "one", path: "src/a.ts", startLine: 4, endLine: 7, side: "new", origin: "review", comment: "Extract this", preview: "code" }]);
    first.flush();

    const restored = new WorkspacePersistence({ projectDirectory: "/project", storage });
    expect(restored.tabs()).toEqual({ open: ["src/a.ts", "src/b.ts"], selected: "src/b.ts" });
    expect(restored.sessionTabs()).toEqual({ open: ["ses_one", "ses_two"], selected: "ses_two", closed: ["ses_old"] });
    expect(restored.contexts("ses_one")).toEqual([{ id: "one", path: "src/a.ts", startLine: 4, endLine: 7, side: "new", origin: "review", comment: "Extract this", preview: "code" }]);
    expect(restored.contexts("ses_two")).toEqual([]);
  });

  it("ignores state for another project and invalid context", () => {
    const storage = new MemoryStorage();
    storage.value = JSON.stringify({
      version: 1,
      project: "/other",
      tabs: { open: ["secret"] },
      contexts: { ses_one: [{ id: 1 }] },
    });
    const state = new WorkspacePersistence({ projectDirectory: "/project", storage });
    expect(state.tabs()).toEqual({ open: [], selected: undefined });
    expect(state.sessionTabs()).toEqual({ open: [], selected: undefined, closed: [] });
    expect(state.contexts("ses_one")).toEqual([]);
  });

  it("falls back to the last valid session tab and limits reopen history", () => {
    const storage = new MemoryStorage();
    const state = new WorkspacePersistence({ projectDirectory: "/project", storage, debounceMs: 60_000 });
    state.saveSessionTabs(Array.from({ length: 24 }, (_, index) => `ses_${index}`), "missing", Array.from({ length: 24 }, (_, index) => `closed_${index}`));
    state.flush();

    const restored = new WorkspacePersistence({ projectDirectory: "/project", storage });
    expect(restored.sessionTabs().open).toHaveLength(20);
    expect(restored.sessionTabs().selected).toBe("ses_23");
    expect(restored.sessionTabs().closed).toEqual(Array.from({ length: 20 }, (_, index) => `closed_${index + 4}`));
  });
});
