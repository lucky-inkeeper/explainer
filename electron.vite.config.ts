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
      // the offline worker gets this build's file list, so the UI opens without internet (ADR-0009)
      name: "sw", apply: "build",
      generateBundle(_, bundle) {
        const files = Object.keys(bundle).filter((f) => f !== "index.html").map((f) => "/" + f);
        const source = fs.readFileSync(path.resolve("src/renderer/sw.js"), "utf8").replace("__BUILD__", String(Date.now())).replace("__FILES__", JSON.stringify(files));
        this.emitFile({ type: "asset", fileName: "sw.js", source });
      },
    }],
    define: { "process.env.IS_PREACT": JSON.stringify("false") },
  },
});
