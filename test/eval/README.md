# Diagram evaluation run

Draws one diagram per type in the diagram-design skill with the real agent, exports every frame, measures the scene and builds a report page.

Needs the dev app with CDP: `EXPLAINER_DEBUG_PORT=9222 npx electron-vite dev --watch`, the Agent sidebar open, an empty drawing (menu > New drawing).

```
cd test/eval
./eval-run.sh                 # 16 prompts, new session each, ~25 min; chat logs and out/summary.md
node cdp.mjs evalfile metrics.js > out/metrics.json   # per frame: nodes, arrows, notes, leaders, focal, legend, overlaps
MOD_URL="$(curl -s http://localhost:5173/src/canvas.ts | grep -o 'from "[^"]*@excalidraw_excalidraw.js[^"]*"' | head -1 | sed 's/from "//; s/"$//')" node export-frames.mjs   # out/png/NN-<frame>.jpg
node build-data.mjs           # out/data.json: prompt, timing, tool calls, reference read, metrics per type
```

Review `out/png/` by eye; `out/data.json` is the machine-readable side.
Helpers: `cdp.mjs shot|eval|evalfile|click|key|logs`, `turn.mjs "<prompt>" [maxSeconds]` sends one chat turn and prints the log.
