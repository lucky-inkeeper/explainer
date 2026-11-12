# ADR-0010: The UI ships in the app again

Date: 2026-11-12. Status: accepted. Supersedes ADR-0006 (UI from Vercel) and ADR-0009 (service worker).

## Decision
- The window loads the UI from the app's own files (`out/renderer`) at `app://explainer/`. `src/main/index.ts` registers the `app` scheme as standard and secure, and serves only files inside `out/renderer`.
- `pnpm build` releases everything: main process, preload and UI, always the same version.
- Fonts ship in the app:
  - Inter and Playpen Sans: `src/renderer/src/fonts/` (from Google Fonts, SIL OFL 1.1).
  - Excalidraw's fonts: the build copies `@excalidraw/excalidraw/dist/prod/fonts` to `out/renderer/fonts`, and `index.html` sets `EXCALIDRAW_ASSET_PATH`.
- `pnpm deploy:web` stays only for the shared-drawing viewer (`?view=`, ADR-0008). Share links always point to https://explainer-pearl.vercel.app.

## Why
- Explainer runs on one Mac. A UI from Vercel gave fast updates to many copies, which this Mac does not need.
- The app opens offline always, also on the first start, and the UI and the main process cannot be different versions.

## Consequences
- Each Mac needs its own `pnpm build` to get a UI change. To serve the UI from Vercel again, set `UI_URL` back to the Vercel URL (ADR-0006).
- The IPC checks stay (`guard.ts`). `sameOrigin` compares scheme, host and port by hand, because `URL.origin` is "null" for `app://`.
- Open tabs are in `localStorage`, which is per origin: the first start on `app://explainer` opens with no saved tabs.
- A viewer change needs `pnpm deploy:web`. An app change does not.
