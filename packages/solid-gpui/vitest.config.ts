import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import solidGpui from "./src/vite.js";

const source = fileURLToPath(new URL("./src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [solidGpui()],
  resolve: {
    // Compiled JSX imports the runtime by package name; inside the package
    // itself that has to point back at the sources under test.
    alias: { "solid-gpui": source },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
