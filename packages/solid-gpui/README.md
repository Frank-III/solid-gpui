# solid-gpui

A SolidJS 2.0 universal renderer for [gpui](https://gpui.rs), Zed's
GPU-accelerated UI framework.

```tsx
import { createSignal } from "solid-js";
import { render } from "solid-gpui";

function App() {
  const [count, setCount] = createSignal(0);
  return (
    <div style={{ padding: 24, background: "#1e1e22", color: "#eee" }}>
      <div onClick={() => setCount(count() + 1)} style={{ cursor: "pointer" }}>
        clicked {count()} times
      </div>
    </div>
  );
}

await render(() => <App />, { title: "Hello", width: 480, height: 240 });
```

Solid's reactive graph runs in Node; a companion Rust process, `solid-gpui-host`,
owns the gpui window and the platform event loop. The two exchange
newline-delimited JSON: batched tree mutations one way, input events the other.

## Install

```sh
npm install solid-gpui solid-js@next
npm install --save-dev vite
```

You also need the host binary. Build it from the
[repository](https://github.com/alexis-munsayac/solid-gpui) with
`cargo build --release --manifest-path crates/solid-gpui-host/Cargo.toml`, then
either leave it where it was built or point `SOLID_GPUI_HOST` at it.

## Build setup

```ts
// vite.config.ts
import { defineConfig } from "vite";
import solidGpui from "solid-gpui/vite";

export default defineConfig({
  plugins: [solidGpui()],
  build: {
    ssr: "src/app.tsx",
    target: "node20",
    rollupOptions: { output: { entryFileNames: "app.js" } },
  },
});
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-gpui"
  }
}
```

JSX is compiled by `@dom-expressions/compiler` in universal mode. Without the
Vite plugin, call `compile()` from `solid-gpui/compiler` yourself, and make sure
the `browser` export condition is active — under Node's own condition
`solid-js` resolves to a server build whose effects never re-run.

Full documentation — elements, the style object, events, window options and
current limitations — is in the
[repository README](https://github.com/alexis-munsayac/solid-gpui#readme).

## Licence

MIT.
