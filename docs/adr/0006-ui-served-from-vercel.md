# ADR-0006: The UI is served from Vercel; the .app is a shell that needs the internet

Date: 2026-10-09. Status: accepted. ADR-0009 adds an offline copy of the UI. Changes ADR-0001 (local only) for the UI code; data stays local.

## Decision
- The renderer build (`out/renderer`) is deployed to the Vercel project `explainer` (team `wildanathok-6769s-projects`) with `pnpm deploy:web`. Production URL: https://explainer-pearl.vercel.app.
- The window loads that URL (`EXPLAINER_UI_URL` overrides it; dev keeps `ELECTRON_RENDERER_URL`). If it does not load, the window shows an offline page with a "Try again" link.
- Drawings, `data/`, the MCP server and every file operation stay in the local main process.

## Why
- A UI change reaches every installed copy on deploy, without a new `.app` build.

## Consequences
- The UI is web content, so the main process treats IPC as untrusted (`src/main/guard.ts`):
  - every handler checks that the sender frame has the UI origin;
  - file reads and writes stay inside `data/drawings`, or a file the user picked in a dialog this session;
  - folder names resolve to one level under `data/drawings`;
  - the preload exposes a fixed channel list, the renderer runs with `sandbox: true`, and navigation to other origins opens in the browser;
  - `draw_image` paths are read by the main process; the UI only receives bytes.
- The MCP endpoint rejects requests that carry an `Origin` header (browsers), so a web page cannot drive the canvas.
- No internet, no app. Main-process changes (IPC, MCP, files) still need `pnpm build`, and the deployed UI must not call a channel an older `.app` lacks.
- Open tabs are kept in `localStorage`, which is per origin: the first start on the new origin opens with no saved tabs. A file outside `data/drawings` from an old tab must be opened again with the dialog.
- Rejected: a full web app (online storage, remote MCP relay, auth). Large work, and the data would leave the Mac.
