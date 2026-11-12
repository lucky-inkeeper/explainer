# Explainer

Excalidraw with canvas tools served over MCP. Claude Code (CLI, Zed, VS Code) draws on the open canvas: `claude mcp add --transport http explainer http://127.0.0.1:7331/mcp --scope user`.

- `pnpm install` (once: `cd node_modules/electron && node install.js` if the Electron binary is missing)
- `pnpm dev` - run. `pnpm build` - unsigned `dist/mac-arm64/Explainer.app` (right-click > Open the first time).
- `pnpm deploy:web` - deploy the shared-drawing viewer to https://explainer-pearl.vercel.app. The `.app` has its own copy of the UI and opens offline; `pnpm build` updates it (ADR-0010).
- `pnpm sync:setup` - once per Mac: saves the Vercel Blob token so menu > Share with link works (ADR-0008). Only drawings you share go to the cloud, as public blobs.
- Your data lives in `data/` (gitignored): `drawings/`, `app/`.

See `CONTEXT.md` and `docs/adr/` for how it fits together and why.
