# ADR-0003: Fixed notation, automatic label spacing, web fonts as extra font ids

Date: 2026-08-29. Status: accepted.

## Decision
- The agent must use one symbol per kind (ellipse/yellow user action, rectangle/blue system step, diamond/orange decision, dashed purple data, rounded green DB, red external service, grey note) and draw a legend once per scene. Enforced by the system prompt, not by code.
- `draw_elements` runs a spacing pass on the skeleton: for each arrow bound between two shapes, if the gap is smaller than its label plus margin, push the downstream shape (and everything beyond it on that axis) and re-convert. Bound arrows drop explicit points so Excalidraw re-routes them. Leftover overlaps are reported as `warnings`.
- Playpen Sans (id 101, default) and Inter (id 102) are Google Fonts added to Excalidraw's `FONT_FAMILY` map at runtime and loaded before first render.

## Why
- The user reads diagrams faster when the visual language never changes.
- Excalidraw's arrow labels have a minimum width (11 × font size), so short arrows overlap; a layout nudge is cheaper than teaching the model pixel math.
- Excalidraw has no public custom-font API; the id-map trick works because the canvas and the measurer resolve ids to family names.

## Consequences
- Ponytail ceiling: the push is axis-aligned; dense multi-row graphs may need a real layout engine later.
- The font picker in Excalidraw's UI does not list 101/102; SVG export will not embed them (PNG is fine). Offline start falls back to system fonts after 3 s.
