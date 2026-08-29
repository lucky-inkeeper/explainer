# ADR-0005: Layout is one module; its tests run in the renderer over CDP, not in node

Date: 2026-08-29. Status: accepted.

## Decision
- The diagram math (arrow routes, label spacing, note parking, legend strip, frame, overlap and crossing warnings) is one module, **Layout**, in `src/renderer/src/layout.ts`: `layout(skeleton, { frame? }) -> { elements, parked, warnings }` and `inspect(elements) -> warnings`. It never receives the Excalidraw API; `canvas.ts` keeps id dedupe, placement and scene writes.
- Tests feed saved agent batches (`test/layout/fixtures/`, harvested from real sessions) to `window.__layout` in the running dev app over CDP (port 9222) and assert: no warnings, every element inside the frame, legend present. `pnpm check` runs them and skips when the app is not up.

## Why
- 15 of the first 21 commits to `canvas.ts` were fixes inside the layout pass, each verified by a 25-minute agent eval and a PNG review.
- `@excalidraw/excalidraw` does not load in node (`ERR_IMPORT_ATTRIBUTE_MISSING` on its JSON imports, then DOM text measuring). Layout needs `convertToExcalidrawElements` for real text sizes, so a node test needs a fake converter whose sizes are estimates; a batch could pass in node and fail in the app.
- The dev workflow already runs the app with CDP; the replay hook (`window.__canvas`) exists.

## Consequences
- The layout test needs the dev app open. No app, no signal.
- Fixtures are frozen agent output; a rule with no fixture gets a hand-written batch.
- A raw agent batch is not always clean: the agent fixes warnings with `update_elements` after drawing. A fixture that still warns carries its warnings as `todo` and is reported as TODO, not as a failure; it is the layout worklist.
- Golden positions are not asserted: every routing fix would break all fixtures.
- Rejected: node tests with an injected fake converter (kept as the upgrade path if CDP is too slow).
