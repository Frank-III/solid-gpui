import { defineConfig } from "vite";
import solidGpui from "solid-gpui/vite";

export default defineConfig({
  appType: "custom",
  plugins: [solidGpui()],
  build: {
    ssr: "src/app.tsx",
    outDir: "dist",
    target: "node20",
    minify: false,
    rollupOptions: {
      output: { entryFileNames: "app.js" },
    },
  },
});
