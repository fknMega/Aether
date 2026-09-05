import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone Vite server for previewing the renderer in a plain browser
// (no Electron). Serves src/renderer/preview.html with a mocked window.aether.
export default defineConfig({
  root: resolve("src/renderer"),
  server: { port: 5199, strictPort: true },
  resolve: { alias: { "@shared": resolve("src/shared"), "@renderer": resolve("src/renderer") } },
  plugins: [react()],
});
