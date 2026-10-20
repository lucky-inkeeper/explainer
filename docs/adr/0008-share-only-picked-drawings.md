# ADR-0008: Blob holds only the drawings the user shares, uploaded on a click

Date: 2026-10-20. Status: accepted. Supersedes ADR-0007.

## Decision
- No sync between Macs. Drawings live in `data/drawings` on this Mac only.
- Menu > **Share with link** uploads the open drawing to the public Blob store `explainer-drawings` at `shared/<random uuid>.excalidraw` and copies a viewer link. **Update shared link** uploads again to the same blob. **Stop sharing** deletes the blob. Moving the drawing to the Trash also deletes it.
- `state.json` `shared` maps a drawing path to its blob URL; rename and move keep the link.
- The viewer is the UI with `?view=<blob URL>` (`Viewer.tsx`): read-only Excalidraw, any browser, no `window.api`. It fetches only `https://*.public.blob.vercel-storage.com` URLs.
- The token is still `data/app/sync.json` (`pnpm sync:setup`), main process only.

## Why
- ADR-0007 called `list()` every 30 s on each Mac. `list()` is an advanced Blob operation; the Hobby plan allows 2,000 per month for the whole Vercel account. The store was suspended on 2026-10-20 at 16 MB.
- The user wants only drawings shared with another person in the cloud; everything else stays on disk.

## Consequences
- One `put` per click; no reads by the app at all. Viewer reads are simple operations.
- Viewers see the last uploaded version, not live edits. Blob cache is 60 s.
- The URL is public but random: anyone with the link can read the drawing and its embedded images.
- The old `drawings/` blobs of ADR-0007 were deleted. A `.app` built before this ADR must not run again: its sync would read the missing blobs as "deleted on another Mac" and trash the local drawings.
