# ADR-0009: A service worker keeps an offline copy of the UI

Date: 2026-11-12. Status: accepted. Changes ADR-0006 ("No internet, no app").

## Decision
- `src/renderer/sw.js` is the service worker. The build (`electron.vite.config.ts`, plugin `sw`) writes the build id and the list of every output file into `out/renderer/sw.js`.
- On install it caches all UI files (about 12 MB). Each deploy has a new file list, so the app installs a new worker and deletes the old cache.
- Page loads are network first: online, the app gets the newest deploy. Offline, it opens the cached copy.
- UI files come from the cache first (their names carry a hash).
- Fonts from `fonts.googleapis.com`, `fonts.gstatic.com` and `esm.sh` are cached on first use. No other cross-origin request is cached (Vercel Blob sync and share stay live).
- Only the app window registers it. The shared-drawing viewer (`?view=`) in other browsers does not.

## Consequences
- The app opens offline after one online start with this version. The first start ever still needs the internet (the offline page of ADR-0006 stays).
- Offline, you get the last UI version you loaded. Sync and share need the internet.
- An Excalidraw font that was never used online is missing offline; the canvas falls back to another font.
