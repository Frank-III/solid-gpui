/**
 * The Vite plugin.
 *
 * It does two things: compile JSX with `@dom-expressions/compiler` before Vite's
 * own TypeScript pass, and force the `browser` export condition. The second is
 * not cosmetic — under Node's condition, `solid-js` resolves to its server
 * build, whose effects never re-run, and the application renders once and then
 * appears frozen.
 */

import { compile, type CompileOptions } from "./compiler.js";

export interface SolidGpuiPluginOptions extends CompileOptions {
  /** Files to compile. Defaults to every `.jsx` and `.tsx` outside dependencies. */
  include?: RegExp;
  /** Files to skip, checked after `include`. */
  exclude?: RegExp;
}

/** The minimal shape of a Vite plugin, so `vite` stays an optional peer. */
interface VitePluginShape {
  name: string;
  enforce: "pre";
  config(): Record<string, unknown>;
  transform(
    code: string,
    id: string,
  ): { code: string; map: unknown } | null;
}

const DEFAULT_INCLUDE = /\.[jt]sx$/;
const DEFAULT_EXCLUDE = /[\\/]node_modules[\\/]/;
const CONDITIONS = ["browser", "development"];

export default function solidGpui(options: SolidGpuiPluginOptions = {}): VitePluginShape {
  const { include = DEFAULT_INCLUDE, exclude = DEFAULT_EXCLUDE, ...compileOptions } = options;

  return {
    name: "solid-gpui",
    // JSX has to be gone before Vite hands the module to esbuild.
    enforce: "pre",

    config() {
      return {
        resolve: { conditions: CONDITIONS },
        ssr: {
          resolve: { conditions: CONDITIONS },
          // The application runs in Node but must not resolve Solid the way
          // Node would, so it is bundled rather than left external.
          noExternal: true,
        },
      };
    },

    transform(code, id) {
      const path = id.split("?")[0]!;
      if (!include.test(path) || exclude.test(path)) return null;
      const result = compile(code, path, compileOptions);
      return { code: result.code, map: result.map ? JSON.parse(result.map) : null };
    },
  };
}

export { solidGpui };
export { compile, compileAsync, compileOptions, BUILT_INS } from "./compiler.js";
export type { CompileOptions } from "./compiler.js";
