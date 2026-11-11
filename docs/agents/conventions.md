# Conventions

profile: light — one user, a desktop app, no API server, no database, no payments. The app has few custom actions, and most of them are file operations.

The stdcode skill applies where this file, `CONTEXT.md` and `docs/adr/` are silent. Existing code is not restructured to match it. New and changed code follows the rules below.

## Layout (stdcode mapping)

The electron-vite layout is the framework layout. It stays:

| folder | holds |
|---|---|
| `src/main/` | Electron main process: window, menu, IPC handlers, MCP bridge |
| `src/preload/` | `contextBridge` with the allow-list of IPC channels |
| `src/renderer/src/` | React UI: App, Pane, Gallery, Settings, canvas tool handlers, layout |
| `src/shared/` | types, canvas tool definitions, notation, agent instructions |
| `agent/` | the diagram-design skill (third-party, see `agent/diagram-design/UPSTREAM.md`) |

Light-profile folders, for new code only. Create a folder when its first file needs it:

| folder | holds |
|---|---|
| `src/main/actions/` | one IPC handler or main-process MCP tool per file. Thin: check the input, call `lib/`, do the file or network side effect |
| `src/main/lib/` | pure main-process logic: input in, output out. No `electron`, no `fs` writes, no network |
| `src/shared/` | pure logic that both processes use (for example `notationWarnings`) |

No `hooks/` folder: in this repo "hooks" means React hooks. The app has no lifecycle reactions that need their own folder.

## Accepted deviations (existing code)

- `src/main/index.ts` holds the IPC handlers inline (24 handlers). Move a handler to `src/main/actions/` when you change it, not before.
- `src/main/guard.ts`, `share.ts`, `rules.ts` are pure logic in `src/main/`, not in `lib/`. They stay where they are.
- `src/renderer/src/layout.ts` imports Excalidraw, so it is not pure. Its tests are slow (see below).
- `src/shared/tools.ts` holds several units (tool definitions, notation, `classify`, `notationWarnings`, agent instructions). The notation is one table on purpose: every reader of a color uses it.
- Environment variables (`EXPLAINER_DATA`, `EXPLAINER_MCP_PORT`, `EXPLAINER_UI_URL`, `EXPLAINER_DEBUG_PORT`, `EXPLAINER_BLOB_TOKEN`) are read at the top of `src/main/index.ts`. No separate config module yet.
- No linter and no formatter config yet. TypeScript runs with `strict: true`.

## Tests

| tier | what | command |
|---|---|---|
| fast | pure logic: guard, share format, notation, rules, history copies | `pnpm typecheck && pnpm check` |
| slow | layout fixtures in the running dev app over CDP (ADR-0005) | `EXPLAINER_DEBUG_PORT=9222 pnpm dev`, then `pnpm check` |

The layout fixture test finds the dev UI on any `localhost` port. Without the dev app, it skips.

Each new `lib/` file and each new action gets a fast test in `test/<name>.test.mjs`.

## Commits

Conventional Commits (`feat:`, `fix:`, `style:`, `docs:`, `refactor:`, `test:`, `chore:`).
