# Explainer — domain context

Explainer is a Mac app: the Excalidraw editor with a Claude agent in a side panel. The agent answers by drawing on the canvas, not with prose.

## Glossary

- **Canvas** — the single Excalidraw scene shown in the window. The user and the agent draw on the same canvas.
- **Drawing** — a `.excalidraw` file in `data/drawings/`. One drawing is open at a time. It autosaves.
- **Agent** — one long-lived `claude -p` process (the user's own Claude Code install and login), speaking stream-json over stdin/stdout.
- **Session** — a Claude Code conversation (`~/.claude/projects/<cwd-slug>/<id>.jsonl`). A drawing remembers its last session (`data/app/state.json`).
- **Workspace** — the agent's working directory (`data/workspace/` by default). Repos get cloned here.
- **Canvas tools** — MCP tools the app serves in-process to the agent: `draw_elements`, `draw_mermaid`, `read_canvas`, `update_elements`, `delete_elements`.
- **Skeleton** — Excalidraw's element-skeleton input format (`convertToExcalidrawElements`). What the agent emits.
- **Placement** — where a batch of new elements lands: `auto` (free space right of content), `selection` (next to the user's selected elements), `exact`.
- **Attach** — the Figma-style flow: select elements, press "Ask agent", the selection is sent with the next message as `<selected_elements>` JSON.
- **Share link** — `https://excalidraw.com/#json=<id>,<key>`, produced by posting the encrypted scene to Excalidraw's public share backend.

## Layout

```
src/main/      Electron main: claude bridge (claude.ts), files, share link, IPC
src/preload/   contextBridge (window.api)
src/renderer/  React: App (Excalidraw + sidebar), Chat (agent UI), canvas (tool handlers)
src/shared/    types, canvas tool definitions, agent system prompt
data/          user data (gitignored): drawings/, workspace/, app/
docs/adr/      decisions
```

## Run

- `pnpm dev` — dev app. `EXPLAINER_DEBUG_PORT=9222 pnpm dev` exposes CDP for testing.
- `pnpm build` — unsigned `dist/mac-arm64/Explainer.app`. First open: right-click > Open.
- `pnpm typecheck`, `pnpm check` (share-format self-test).
- Login: the app uses the token from `claude login` in Terminal. Nothing else.
