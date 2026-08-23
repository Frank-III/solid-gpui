/**
 * JSX compilation.
 *
 * `@dom-expressions/compiler` is the Oxc-based successor to
 * `babel-preset-solid`: it parses TypeScript and JSX directly and emits calls to
 * the renderer primitives this package exports. Types are left in place — the
 * bundler strips them afterwards — so the transform has to run before whatever
 * handles TypeScript.
 */

import { transform, transformAsync } from "@dom-expressions/compiler";
import type { TransformOptions, TransformResult } from "@dom-expressions/compiler";

export type { TransformOptions, TransformResult };

/**
 * Components the compiler may inline instead of routing through
 * `createComponent`. Every name here is re-exported from `solid-gpui`, which is
 * where the generated imports point.
 */
export const BUILT_INS = [
  "For",
  "Show",
  "Switch",
  "Match",
  "Loading",
  "Reveal",
  "Repeat",
  "Errored",
  "Dynamic",
] as const;

export interface CompileOptions extends Omit<TransformOptions, "generate"> {
  /** Overrides the module the runtime is imported from. */
  moduleName?: string;
}

/** Fills in the options that make the compiler target this renderer. */
export function compileOptions(options: CompileOptions = {}): TransformOptions {
  return {
    moduleName: "solid-gpui",
    builtIns: [...BUILT_INS],
    wrapConditionals: true,
    sourceMap: true,
    ...options,
    generate: "universal",
  };
}

/** Compiles one module. `filename` selects the parser dialect, so pass it. */
export function compile(
  code: string,
  filename: string,
  options: CompileOptions = {},
): TransformResult {
  return transform(code, { ...compileOptions(options), filename });
}

/** The promise-returning form, for integrations that expect one. */
export function compileAsync(
  code: string,
  filename: string,
  options: CompileOptions = {},
): Promise<TransformResult> {
  return transformAsync(code, { ...compileOptions(options), filename });
}
