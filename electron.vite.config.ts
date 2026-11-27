import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // local builds (pnpm dev/build) keep drawings in the repo's data/; release builds (pnpm dist:*) bake "" and use the user's app data folder
    define: { __DATA_DIR__: JSON.stringify(process.env.npm_lifecycle_event?.startsWith("dist") ? "" : path.resolve("data")) },
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
