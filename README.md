# Explainer

Excalidraw + a Claude agent in a side panel. The agent explains by drawing on the canvas.

- `pnpm install` (once: `cd node_modules/electron && node install.js` if the Electron binary is missing)
- `pnpm dev` — run. `pnpm build` — unsigned `dist/mac-arm64/Explainer.app` (right-click > Open the first time).
- Needs `claude` (Claude Code CLI) installed and logged in (`claude login` in Terminal).
- Your data lives in `data/` (gitignored): `drawings/`, `workspace/` (agent cwd, clone repos here), `app/`.

See `CONTEXT.md` and `docs/adr/` for how it fits together and why.
