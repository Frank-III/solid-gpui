import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/jsx-runtime.ts", "src/vite.ts", "src/compiler.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  dts: true,
  clean: true,
  // The package is ESM-only, so plain `.js` is unambiguous and keeps the
  // exports map readable.
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  // Nothing here benefits from being minified, and readable output makes the
  // generated renderer calls easy to follow when debugging an application.
  minify: false,
});
