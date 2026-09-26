# Diagram evaluation helpers

The chat-driven run (eval-run.sh, turn.mjs, build-data.mjs) was removed with the in-app agent sidebar on 2026-09-26. Draw the diagrams from a Claude Code client over MCP, then measure and export them here.

Needs the dev app with CDP: `EXPLAINER_DEBUG_PORT=9222 npx electron-vite dev --watch`.

```
cd test/eval
node cdp.mjs evalfile metrics.js > out/metrics.json   # per frame: nodes, arrows, notes, leaders, focal, legend, overlaps
MOD_URL="$(curl -s http://localhost:5173/src/canvas.ts | grep -o 'from "[^"]*@excalidraw_excalidraw.js[^"]*"' | head -1 | sed 's/from "//; s/"$//')" node export-frames.mjs   # out/png/NN-<frame>.jpg
```

Review `out/png/` by eye.
Helpers: `cdp.mjs shot|eval|evalfile|click|key|logs`.
