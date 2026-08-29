import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // data dir is baked at build time so the packaged .app finds the repo's data/ folder
    define: { __DATA_DIR__: JSON.stringify(path.resolve("data")) },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()],
    define: { "process.env.IS_PREACT": JSON.stringify("false") },
  },
});
