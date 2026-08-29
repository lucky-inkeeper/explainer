# Explainer - domain context

Explainer is a Mac app: the Excalidraw editor with a Claude agent in a side panel. The agent answers by drawing on the canvas, not with prose.

## Glossary

- **Canvas** - the single Excalidraw scene shown in the window. The user and the agent draw on the same canvas.
- **Drawing** - a `.excalidraw` file in `data/drawings/`. One drawing is open at a time. It autosaves.
- **Agent** - one long-lived `claude -p` process (the user's own Claude Code install and login), speaking stream-json over stdin/stdout.
- **Session** - a Claude Code conversation (`~/.claude/projects/<cwd-slug>/<id>.jsonl`). A drawing remembers its last session (`data/app/state.json`).
- **Workspace** - the agent's working directory (`data/workspace/` by default). Repos get cloned here.
- **Canvas tools** - MCP tools the app serves in-process to the agent: `draw_elements`, `draw_mermaid`, `read_canvas`, `update_elements`, `delete_elements`.
- **Skeleton** - Excalidraw's element-skeleton input format (`convertToExcalidrawElements`). What the agent emits.
- **Placement** - where a batch of new elements lands: `auto` (free space right of content), `selection` (next to the user's selected elements), `exact`.
- **Attach** - the Figma-style flow: select elements, press "Ask agent", the selection is sent with the next message as `<selected_elements>` JSON.
- **Share link** - `https://excalidraw.com/#json=<id>,<key>`, produced by posting the encrypted scene to Excalidraw's public share backend.
- **Notation** - fixed shape + color per kind (user action, system step, decision, data, DB, external service, note) and one legend frame per scene. Lives in the agent system prompt (`src/shared/tools.ts`).
- **Label spacing** - after a `draw_elements` batch, arrows bound between two shapes get enough room for their label: the far shape and everything beyond it is pushed along the arrow axis, then the batch is re-converted. Remaining text/shape overlaps come back as `warnings` in the tool result.
- **Diagram-design skill** - a Claude Code plugin in `agent/diagram-design/` (ported from cathrynlavery/diagram-design, MIT). Routing table + 16 type references + semantic patterns, rewritten for the skeleton. Loaded with `--plugin-dir`; the system prompt makes the agent invoke it before every new complete diagram. See ADR-0004 and `agent/diagram-design/UPSTREAM.md`.
- **Focal treatment** - `strokeColor "#e8590c"`, `strokeWidth 2` on the 1-2 nodes the reader must notice; the fill keeps the kind color.
- **Fonts** - Google Fonts loaded in `index.html`; registered as Excalidraw font ids 101 (Playpen Sans, default) and 102 (Inter). Excalidraw's own picker still lists only built-ins; SVG export does not embed these fonts.

## Layout

```
src/main/      Electron main: claude bridge (claude.ts), files, share link, IPC
src/preload/   contextBridge (window.api)
src/renderer/  React: App (Excalidraw + sidebar), Chat (agent UI), canvas (tool handlers)
src/shared/    types, canvas tool definitions, agent system prompt
agent/         Claude Code plugins loaded into the agent (diagram-design)
data/          user data (gitignored): drawings/, workspace/, app/
docs/adr/      decisions
```

## Run

- `pnpm dev` - dev app. `EXPLAINER_DEBUG_PORT=9222 pnpm dev` exposes CDP for testing.
- `pnpm build` - unsigned `dist/mac-arm64/Explainer.app`. First open: right-click > Open.
- `pnpm typecheck`, `pnpm check` (share-format self-test).
- Login: the app uses the token from `claude login` in Terminal. Nothing else.
