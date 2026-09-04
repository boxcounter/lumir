import { defineConfig } from "vite";

// Tauri 2 约定：固定端口、直连、相对 base（见 tauri.conf.json devUrl/frontendDist）
export default defineConfig({
  base: "./",
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
});
