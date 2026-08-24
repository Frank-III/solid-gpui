import { defineConfig } from "vite";
import solidGpui from "solid-gpui/vite";

export default defineConfig({
  plugins: [solidGpui()],
  build: {
    // The application runs in Node and drives the gpui host over a pipe, so
    // this is an SSR-style build: one Node-targeted bundle, no HTML.
    ssr: "src/app.tsx",
    outDir: "dist",
    target: "node20",
    minify: false,
    rollupOptions: {
      output: { entryFileNames: "app.js" },
    },
  },
});
