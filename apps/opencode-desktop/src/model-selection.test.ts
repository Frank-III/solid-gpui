import { describe, expect, it } from "vitest";
import { orderModels } from "./model-selection.js";

describe("model selection", () => {
  it("orders favorites, then recents, then provider and model name", () => {
    const models = [
      { providerID: "z", id: "plain", name: "Plain" },
      { providerID: "a", id: "recent", name: "Recent" },
      { providerID: "b", id: "favorite-two", name: "Favorite two" },
      { providerID: "a", id: "favorite-one", name: "Favorite one" },
    ];

    expect(orderModels(models, ["a/recent"], ["a/favorite-one", "b/favorite-two"]).map((model) => model.id)).toEqual([
      "favorite-one",
      "favorite-two",
      "recent",
      "plain",
    ]);
  });
});
