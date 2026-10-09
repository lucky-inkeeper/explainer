# Explainer

Excalidraw with canvas tools served over MCP. Claude Code (CLI, Zed, VS Code) draws on the open canvas: `claude mcp add --transport http explainer http://127.0.0.1:7331/mcp --scope user`.

- `pnpm install` (once: `cd node_modules/electron && node install.js` if the Electron binary is missing)
- `pnpm dev` - run. `pnpm build` - unsigned `dist/mac-arm64/Explainer.app` (right-click > Open the first time).
- `pnpm deploy:web` - deploy the UI to https://explainer-pearl.vercel.app. The `.app` loads its UI from there, so it needs the internet to open (ADR-0006).
- Your data lives in `data/` (gitignored): `drawings/`, `app/`. It never leaves the Mac.

See `CONTEXT.md` and `docs/adr/` for how it fits together and why.
