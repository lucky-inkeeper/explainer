# Explainer - domain context

Explainer is a Mac app: the Excalidraw editor with canvas tools served over MCP. A Claude Code client (the agent) answers by drawing on the canvas, not with prose. The in-app agent sidebar was removed on 2026-09-26.

## Glossary

- **Canvas** - the single Excalidraw scene shown in the window. The user and the agent draw on the same canvas.
- **Drawing** - a `.excalidraw` file in `data/drawings/` or in one **folder** below it (one level). One drawing is open at a time. It autosaves. A boot guard skips autosave while Excalidraw still reports fewer elements than the file held; `file:write` keeps a `.history` copy before any write that empties or shrinks a file by more than 30 percent. (The two "emptied at restart" drawings of 2026-08-29 were in fact deleted by the agent on a "remove all drawing" chat request; the restart was a coincidence.)
- **Pane** - one drawing in one Excalidraw (`Pane.tsx`): load, autosave, boot guard, wheel zoom, minimap. **Split view** shows two panes side by side: right-click a tab > Open in split view / Close split view. The two drawings form a **pair**: one tab entry (Firefox style). Several pairs can exist; a drawing is in one pair at most. Clicking a tab outside a pair shows that drawing alone; clicking a pair member brings its split view back. Open in split view works from a drawing shown alone. Never the same drawing in both. The **focused pane** (the one touched last, purple top line) gets tab clicks, the gallery, and every canvas tool call without a `drawing` argument; a call with `drawing` (a name from read_canvas `onScreen`) goes to that pane.
- **Gallery** - the drawings list (menu > Drawings…, or the button at the top left): thumbnails, folder tabs, new, open, rename, move to a folder, move to Trash. Thumbnails are cached in `data/drawings/.thumbs/` per file and mtime.
- **Agent** - any Claude Code client connected to the canvas tools over MCP.
- **Canvas tools** - MCP tools the app serves to the agent: `draw_elements`, `draw_mermaid`, `draw_image`, `read_canvas`, `update_elements`, `delete_elements`, `open_drawing`, `get_diagram_rules`. Every canvas tool except `open_drawing` takes an optional `drawing` (name, folder/name or path); a drawing not on screen opens first. Deleting a frame deletes everything inside it; `delete_elements` takes a `frame` name or id for a whole diagram, `read_canvas` takes `frame` or `ids` to stay small. They are served over Streamable HTTP on `127.0.0.1:7331/mcp` (`EXPLAINER_MCP_PORT` to move it) so any other Claude Code client (Zed, CLI, VS Code) can draw on and read the focused pane: `claude mcp add --transport http explainer http://127.0.0.1:7331/mcp --scope user`. Explainer must be running; request/reply only, no push.
- **MCP bridge** - the localhost HTTP server for the canvas tools (`src/main/mcp.ts`). On by default; the user turns it off and on in menu > Agent > MCP Bridge or on the **Settings page** (gear beside the theme button, canvas menu > MCP settings…, Cmd+,). The choice persists as `mcpOff` in `data/app/state.json`. The Settings page also shows the server URL and the setup for each MCP client (Claude Code, Cursor, VS Code, Codex, Gemini CLI, stdio-only clients through `mcp-remote`), and hides them while the bridge is off.
- **Agent instructions** - `agentInstructions()` in `src/shared/tools.ts`, sent as `instructions` in the MCP `initialize` reply: the notation, the short-text and icon rules, and the order to call `get_diagram_rules` before a new diagram. The only channel that reaches every agent since the sidebar was removed. Claude Code cuts it at 2048 chars without a warning; `test/notation.test.mjs` guards the length.
- **Skeleton** - Excalidraw's element-skeleton input format (`convertToExcalidrawElements`). What the agent emits.
- **Placement** - where a batch of new elements lands: `auto` (free space right of content), `selection` (next to the user's selected elements), `exact`.
- **Shared drawing** - a drawing the user shared (menu > Share with link): uploaded on a click to the public Blob store at `shared/<uuid>.excalidraw`, opened read-only by the viewer (`?view=<blob URL>`, `Viewer.tsx`). All other drawings stay on this Mac. See ADR-0008.
- **excalidraw.com link** - `https://excalidraw.com/#json=<id>,<key>`, produced by posting the encrypted scene to Excalidraw's public share backend (menu > Copy excalidraw.com link).
- **Notation** - fixed shape + color per kind (user action, system step, decision, data, DB, external service, note). One table, `NOTATION` in `src/shared/tools.ts`; the prompt block, the legend strip, the layout checks and the eval metrics read it.
- **Legend strip** - built by the app under every framed diagram: the kinds and arrow styles the batch uses. The agent never draws one.
- **Elbowed arrow** - `elbowed: true` on a bound arrow; the spacing pass gives it a right-angle route (facing sides, one bend pair).
- **Layout** - the diagram math the app runs on a batch before it lands on the canvas: arrow routes, label spacing, note parking, the legend strip, the frame, and the overlap warnings. It works on the batch alone and does not read or write the scene.
- **Label spacing** - after a `draw_elements` batch, arrows bound between two shapes get enough room for their label: the far shape and everything beyond it is pushed along the arrow axis, then the batch is re-converted. Remaining text/shape overlaps come back as `warnings` in the tool result.
- **Notation warnings** - `notationWarnings()` in `src/shared/tools.ts`, run by the layout on every `draw_elements` / `draw_image` batch and added to `warnings`: a fill not in the notation, a kind drawn with the wrong shape, stroke or roundness, a decision without "?", a DB label without "DB: ", more than 2 focal elements or notes, a slanted unbound arrow, a complete diagram (3+ shapes) without the frame param. Marker dots (<= 24 px) and note leaders are exempt. Same feedback for every agent, whatever its client does with the MCP instructions.
- **Diagram-design skill** - a Claude Code plugin in `agent/diagram-design/` (ported from cathrynlavery/diagram-design, MIT). Routing table + 16 type references + semantic patterns, rewritten for the skeleton. Served to every agent by the `get_diagram_rules` tool (`src/main/rules.ts`, answered in the main process): no name = SKILL.md and the reference names, a name = that reference. So an agent without file access gets the same rules. A Claude Code client can also load it with `--plugin-dir agent/diagram-design`. See ADR-0004 and `agent/diagram-design/UPSTREAM.md`.
- **Note** - grey Inter text, no box, next to the element it explains or tied to it by a dashed leader arrow with a dot end. Max 2 per diagram.
- **Focal treatment** - `strokeColor "#e8590c"`, `strokeWidth 2` on the 1-2 nodes the reader must notice; the fill keeps the kind color.
- **Fonts** - Google Fonts loaded in `index.html`; registered as Excalidraw font ids 101 (Playpen Sans, default) and 102 (Inter). Excalidraw's own picker still lists only built-ins; SVG export does not embed these fonts.

## Layout

```
src/main/      Electron main: MCP HTTP server (mcp.ts), files, share link, IPC
src/preload/   contextBridge (window.api)
src/renderer/  React: App (Excalidraw), Gallery, canvas (tool handlers)
src/shared/    types, canvas tool definitions, agent instructions
agent/         Claude Code plugins for the agent (diagram-design)
data/          user data (gitignored): drawings/, app/
docs/adr/      decisions
```

## Run

- `pnpm dev` - dev app. `EXPLAINER_DEBUG_PORT=9222 pnpm dev` exposes CDP for testing.
- `pnpm build` - unsigned `dist/mac-arm64/Explainer.app`. First open: right-click > Open. For CDP on the packaged app, launch the binary with the env var (`open -a` drops it): `EXPLAINER_DEBUG_PORT=9222 dist/mac-arm64/Explainer.app/Contents/MacOS/Explainer &`. `window.__xapi` / `__canvas` / `__layout` exist in both builds.
- `pnpm typecheck`, `pnpm check` (share-format self-test; the Layout fixtures too when the dev app is up on 9222, see ADR-0005).
