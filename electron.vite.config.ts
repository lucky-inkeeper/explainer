import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // data and agent dirs are baked at build time so the packaged .app finds the repo's folders
    define: { __DATA_DIR__: JSON.stringify(path.resolve("data")), __AGENT_DIR__: JSON.stringify(path.resolve("agent")) },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react(), {
      // Excalidraw's fonts ship in the app (index.html sets EXCALIDRAW_ASSET_PATH), so the canvas text is right offline (ADR-0010)
      name: "excalidraw-fonts", apply: "build",
      writeBundle(o) { fs.cpSync(path.resolve("node_modules/@excalidraw/excalidraw/dist/prod/fonts"), path.join(o.dir!, "fonts"), { recursive: true }); },
    }],
    define: { "process.env.IS_PREACT": JSON.stringify("false") },
  },
});
