# ADR-0002: `@excalidraw/excalidraw` package, unchanged; agent draws via in-process MCP tools

Date: 2026-08-29. Status: accepted.

## Decision
Use the npm package (not a fork). The chat lives in a native Excalidraw `Sidebar`. The agent draws through five MCP tools served by the app itself; tool calls execute in the renderer against `excalidrawAPI`.

- `draw_elements` (skeleton format, full freedom) and `draw_mermaid` (auto layout) both exist.
- New batches are auto-placed in free space; `placement: "selection"` puts them next to the user's selection; `exact` trusts the agent's coordinates.
- Agent reads the canvas as compact JSON (`read_canvas`); no screenshots yet.
- Policy: draw first, short labels; long text goes on the canvas only when needed, never in chat.

## Why
- All editor features come from the package; a fork would drag in collab/PWA and merge pain.
- Mermaid gives layout for structural diagrams; skeleton gives annotation freedom. Each tool is ~20 lines.
- Auto-placement keeps the agent from overlapping existing work without it needing to compute scene bounds.

## Consequences
- Excalidraw.com-only extras (collab rooms, PWA) are absent. Share links reuse Excalidraw's public backend (undocumented for third parties; images are not uploaded).
- Drawings are `.excalidraw` files under `data/drawings/`; a drawing remembers its session.
