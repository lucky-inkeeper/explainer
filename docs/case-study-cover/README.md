# Case study cover animation

The 8 s cover loop for the portfolio case study (`/projects/explainer-excalidraw-mcp`).

1. Open the dev app with CDP: `EXPLAINER_DEBUG_PORT=9222 npx electron-vite dev`.
2. The diagram is the frame "Explainer case study cover" in the drawing "Personal/How Explainer works". Edit it there.
3. Export one SVG per step into `layers/`:
   `MOD_URL="$(curl -s http://localhost:5173/src/canvas.ts | grep -o 'from "[^"]*@excalidraw_excalidraw.js[^"]*"' | head -1 | sed 's/from "//; s/"$//')" node export-layers.mjs`
   The step names and element ids are in `STEPS`. Paste the SVGs into `index.html` (one `.layer` per step).
4. Change the timing, the text or the wall of text in `index.html` (CSS animation delays).
5. Serve this folder (`python3 -m http.server 8765`) and record it in a Chrome with `--remote-debugging-port=9223`: `node record.mjs` writes `frames/`.
6. Encode with ffmpeg (`npm i ffmpeg-static` gives a binary):
   `ffmpeg -framerate 30 -i frames/%04d.png -vf scale=1600:-2 -c:v libx264 -pix_fmt yuv420p -crf 26 -movflags +faststart explainer-cover.mp4`
   `ffmpeg -i frames/0235.png -vf scale=1200:630 -q:v 3 explainer-og.jpg`
7. Upload both in the CMS: the MP4 as Cover, the JPG as SEO > Image.

## Phone cover

A portrait version (540×960, 9:16) for screens under 600 px. The diagram is the frame "Explainer case study cover (phone)" in the same drawing: one column, no legend.

1. `PHONE=1 MOD_URL=... node export-layers.mjs` writes `layers-phone/`. Paste the SVGs into `index-phone.html`.
2. Serve this folder, then `PHONE=1 PORT=<port> node record.mjs` writes `frames-phone/`.
3. `ffmpeg -framerate 30 -i frames-phone/%04d.png -vf scale=800:-2 -c:v libx264 -pix_fmt yuv420p -crf 26 -movflags +faststart explainer-cover-phone.mp4`
4. Upload it in the CMS as Cover (phone).
