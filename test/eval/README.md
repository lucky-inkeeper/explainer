# Diagram evaluation run

Draws one diagram per type in the diagram-design skill with the real agent, exports every frame, measures the scene and builds a report page.

Needs the dev app with CDP: `EXPLAINER_DEBUG_PORT=9222 npx electron-vite dev --watch`, the Agent sidebar open, an empty drawing (menu > New drawing).

```
cd test/eval
./eval-run.sh                 # 16 prompts, new session each, ~25 min; logs and screenshots in out/
node cdp.mjs evalfile metrics.js > out/metrics.json
MOD_URL="$(curl -s http://localhost:5173/src/canvas.ts | grep -o 'from "[^"]*@excalidraw_excalidraw.js[^"]*"' | head -1 | sed 's/from "//; s/"$//')" node export-frames.mjs
node build-data.mjs && node build-report.mjs   # out/report.html
```

`notes.json` holds the hand review (verdict + note per type); edit it after looking at `out/png/`.
Helpers: `cdp.mjs shot|eval|evalfile|click|key|logs`, `turn.mjs "<prompt>" [maxSeconds]` sends one chat turn and prints the log.
