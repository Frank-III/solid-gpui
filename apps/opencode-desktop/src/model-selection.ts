import { createEffect, createSignal, untrack, type Accessor } from "solid-js";
import { ModelPreferences, modelKey } from "./model-preferences.js";
import type { OpenCodeController, OpenCodeState } from "./opencode.js";

type Model = OpenCodeState["models"][number];

export function orderModels<T extends { providerID: string; id: string; name: string }>(models: T[], recent: string[], favorites: string[]): T[] {
  return [...models].sort((a, b) => {
    const aKey = modelKey(a);
    const bKey = modelKey(b);
    const aFavorite = favorites.indexOf(aKey);
    const bFavorite = favorites.indexOf(bKey);
    if (aFavorite !== bFavorite) return (aFavorite < 0 ? 999 : aFavorite) - (bFavorite < 0 ? 999 : bFavorite);
    const aRecent = recent.indexOf(aKey);
    const bRecent = recent.indexOf(bKey);
    if (aRecent !== bRecent) return (aRecent < 0 ? 999 : aRecent) - (bRecent < 0 ? 999 : bRecent);
    return a.providerID.localeCompare(b.providerID) || a.name.localeCompare(b.name);
  });
}

/** Owns desktop-local model ordering and variant memory without leaking it into server state. */
export function createModelSelection(controller: OpenCodeController, state: Accessor<OpenCodeState>) {
  const preferences = new ModelPreferences();
  const [revision, setRevision] = createSignal(0);
  const bump = () => setRevision((value) => value + 1);

  createEffect(
    () => ({ selected: state().model, currentVariant: state().variant, models: state().models }),
    ({ selected, currentVariant, models }) => {
      if (currentVariant) return;
      const model = models.find((item) => item.providerID === selected?.providerID && item.id === selected?.modelID);
      if (!model) return;
      untrack(() => {
        const remembered = preferences.variant(modelKey(model));
        if (remembered && Object.hasOwn(model.variants ?? {}, remembered)) controller.selectVariant(remembered);
      });
    },
  );

  const select = (model: Model) => {
    const key = modelKey(model);
    preferences.use(key);
    bump();
    controller.selectModel(model);
    controller.selectVariant(preferences.variant(key));
  };

  const restore = (model: Model, variant?: string) => {
    preferences.use(modelKey(model));
    preferences.setVariant(modelKey(model), variant);
    bump();
    controller.selectModel(model);
    controller.selectVariant(variant);
  };

  const toggleFavorite = (model: Model) => {
    preferences.toggleFavorite(modelKey(model));
    bump();
  };

  const cycleVariant = () => {
    const model = state().models.find((item) => item.providerID === state().model?.providerID && item.id === state().model?.modelID);
    if (!model) return;
    const values = [undefined, ...Object.keys(model.variants ?? {})];
    const next = values[(values.indexOf(state().variant) + 1) % values.length];
    preferences.setVariant(modelKey(model), next);
    bump();
    controller.selectVariant(next);
  };

  return {
    select,
    restore,
    toggleFavorite,
    cycleVariant,
    recent: () => (revision(), preferences.recent()),
    favorites: () => (revision(), preferences.favorites()),
  };
}
