# ADR-0007: Drawings sync between Macs through a public Vercel Blob store

Date: 2026-10-09. Status: accepted. Changes ADR-0006 ("data stays local"): drawings now also live in the cloud.

## Decision
- Store `explainer-drawings` (`store_mDWPQCYRichJsmDW`, region sin1, public), connected to the Vercel project `explainer`.
- Each drawing is one blob at `drawings/<folder?>/<name>.excalidraw`. Thumbnails, `.history` and app state stay local.
- The main process syncs (`src/main/sync.ts`): at start, every 30 s, on window focus, and 3 s after a local save, rename, move or delete.
- `data/app/sync-state.json` keeps, per drawing, the content hash and blob etag of the last sync. `plan()` compares both sides with it:
  - changed on one side: copy it to the other side (an upload uses `ifMatch` on the last etag, so a race is caught);
  - changed on both: the cloud keeps the name, the local version becomes `<name> (conflict <host> <time>)` and uploads as a new drawing;
  - deleted on one side and unchanged on the other: delete it there too (local deletes go to the macOS Trash);
  - deleted on one side and changed on the other: the changed one wins.
- Sync is on when `data/app/sync.json` holds the store's read-write token (`pnpm sync:setup` pulls it with the Vercel CLI). The token stays in the main process, never in the UI.
- When sync writes the open drawing, the UI reloads it in place and does not save it back, so two Macs do not echo saves.

## Why
- The user works on several Macs and wants the same drawings on each. Vercel already hosts the UI.

## Consequences
- Blobs are public: anyone with a blob URL can read that drawing. The URLs are not listed anywhere public, but they are not secret either. Embedded images go with the drawing.
- A blob read can lag an overwrite for a while (CDN), even with `useCache: false`; `get()` also returns a weak etag. A download is accepted only when its etag equals the one `list()` gave; otherwise the next sweep retries.
- Opening a drawing re-saves it once (autosave after load), so it uploads once per open even without an edit. If another Mac changed it in that window, the result is a conflict copy, not a loss.
- 30 s polling: an edit shows on another Mac after up to 30 s, or on window focus.
- Empty folders do not sync. Folder depth stays one level.
- An old UI build without the `drawings:synced` listener would save over a synced drawing: deploy the UI (`pnpm deploy:web`) before shipping a `.app` with sync.
- Rejected: private store (needs signed reads, more work; the user chose public links), a server-side sync API (one more thing to host; the main process can talk to Blob directly).
