# Setting up a project

What a project needs beyond `pnpm install`: the JSX transform, two TypeScript
options, and one export condition that is easy to get wrong. If there is no Rust
toolchain around, there is also a host that draws nothing.

## The host binary

`pnpm build:host` compiles it. gpui itself is fetched from the Zed repository, so
the first build clones several gigabytes and then compiles for a while.

On macOS the Xcode Command Line Tools are enough. The host enables gpui's
`runtime_shaders` feature, which compiles the Metal shaders at startup instead of
calling `xcrun metal`, a tool that only ships with the full Xcode. It also
enables `font-kit`. Without that, gpui installs a no-op text system and draws no
text at all.

The JavaScript side finds the binary by walking up from the working directory
looking for `crates/solid-gpui-host/target/{release,debug}/solid-gpui-host`, so
running an example from its own folder works. Otherwise set `SOLID_GPUI_HOST` to
its path, or put `solid-gpui-host` on `PATH`.

The host installs a logger, so gpui's own warnings reach stderr. `RUST_LOG=debug`
turns up the detail.

## The JSX transform

JSX is compiled by [`@dom-expressions/compiler`](https://www.npmjs.com/package/@dom-expressions/compiler),
the Oxc-based successor to `babel-preset-solid`, in universal mode and pointed at
this package. The included Vite plugin sets that up:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import solidGpui from "solid-gpui/vite";

export default defineConfig({
  plugins: [solidGpui()],
  build: {
    // The application runs in Node and drives the host over a pipe, so this is
    // an SSR-style build: one Node-targeted bundle, no HTML.
    ssr: "src/app.tsx",
    target: "node20",
    rollupOptions: { output: { entryFileNames: "app.js" } },
  },
});
```

TypeScript needs two options. `"jsx": "preserve"` keeps JSX intact for the
compiler, and `"jsxImportSource": "solid-gpui"` points the `JSX` namespace at
this package. The types are exported rather than declared globally, so they do
not leak into unrelated files.

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-gpui"
  }
}
```

For a bundler without a plugin, call the compiler directly:

```ts
import { compile } from "solid-gpui/compiler";

const { code, map } = compile(source, "src/app.tsx");
```

It emits TypeScript with the JSX already lowered, so the transform has to run
before whatever strips types.

## The `browser` export condition is required

`solid-js` publishes a server build under Node's own export condition, and that
build's effects never re-run. An application that gets it renders once and then
appears frozen.

The Vite plugin sets `resolve.conditions` for you. Anything else needs
`conditions: ["browser", "development"]` at bundle time, or
`node --conditions=browser` at runtime. `render()` checks for this and throws a
message naming the fix rather than failing silently.

## Without a Rust toolchain

[tools/mock-host.mjs](../tools/mock-host.mjs) implements the same protocol and
prints the resulting tree to stderr instead of painting it. It is enough to
develop components, exercise events and check that the renderer emits what you
expect.

```sh
SOLID_GPUI_HOST=tools/mock-host.mjs SOLID_GPUI_MOCK_DUMP=1 node dist/app.js
```

`SOLID_GPUI_MOCK_CLICK=7` also clicks node 7 the first time it appears with a
click listener, which is a quick way to test an interaction end to end.
