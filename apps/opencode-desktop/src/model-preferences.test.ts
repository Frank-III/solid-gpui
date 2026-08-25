import { describe, expect, it } from "vitest";
import { ModelPreferences, type ModelPreferencesStorage } from "./model-preferences.js";

class MemoryStorage implements ModelPreferencesStorage { value?: string; read() { return this.value; } write(value: string) { this.value = value; } }

describe("ModelPreferences", () => {
  it("persists five MRU models, favorites, and per-model variants", () => {
    const storage = new MemoryStorage();
    const preferences = new ModelPreferences({ storage });
    for (let index = 0; index < 7; index++) preferences.use(`p/m${index}`);
    preferences.use("p/m4");
    preferences.toggleFavorite("p/m4");
    preferences.setVariant("p/m4", "high");

    const restored = new ModelPreferences({ storage });
    expect(restored.recent()).toEqual(["p/m4", "p/m6", "p/m5", "p/m3", "p/m2"]);
    expect(restored.favorite("p/m4")).toBe(true);
    expect(restored.variant("p/m4")).toBe("high");
    restored.setVariant("p/m4");
    restored.toggleFavorite("p/m4");
    expect(restored.variant("p/m4")).toBeUndefined();
    expect(restored.favorite("p/m4")).toBe(false);
  });
});
