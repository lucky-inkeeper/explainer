# Sequence

**Best for:** request/response flows, protocol exchanges, multi-actor interactions over time, API call traces, incident reconstructions, auth or token refresh paths with branching.

Prefer `draw_mermaid` with `sequenceDiagram` for a plain sequence. Use `draw_elements` when you need fragments, activation bars or a focal message.

## Layout conventions
- Actors as rectangles in one horizontal row at the top (user action = ellipse, system = rectangle, external = red rectangle).
- Lifelines: dashed vertical `line` elements from each actor down to the bottom.
- Messages: horizontal arrows between lifelines. Time flows top to bottom. Leave 40 px between message rows.
- Activation bar: a narrow rectangle (width 12, grey `#e9ecef`) on a lifeline over the interval that actor holds control. Stack them for nested calls.
- Self-message: a short U-shaped `line` (3 points) that returns to the same lifeline, label to the right.
- Focal treatment on the primary success response or the headline message: one, at most two.
- When the flow branches (valid vs invalid token, retry, optional step), draw a combined fragment. Do not invent free-floating if/else arrow clusters.

## Message kinds

| Kind | Stroke | Arrowhead | When |
|---|---|---|---|
| Call (sync) | solid | triangle | request that expects a reply |
| Return | dashed | triangle | reply to a sync call, never solid |
| Async, fire-and-forget | dashed | arrow (open) | beacons, events, one-way notify |
| Headline success | solid, focal color | triangle | primary happy-path response only |

## Combined fragments (alt, opt, loop)
- A Section container that spans only the lifelines that take part. Its title text is the operator in uppercase: `ALT`, `OPT`, `LOOP`, fontFamily 102.
- Guard label under the title, fontFamily 102, in brackets: `[token valid]`, `[for each item]`, `[retry <= 3]`.
- `alt` has 2 regions, divided by a dashed horizontal `line` inside the container, with `[else]` or a second guard on region 2.
- Fragment inset: 12 px outside the outermost participating lifeline. 24 px between message rows inside a region.
- Nesting: at most 1 level. Prefer two diagrams over deep nesting.
- Focal treatment stays on one headline success message across the whole diagram. Never on both `alt` branches.
- Out of scope: `par`, `critical`, `break`, `ref`, participant create/destroy, timing bars.

## Anti-patterns
- Message arrow that points upward (reverses time).
- Activation bars that never close.
- A label that sits over another lifeline: shorten it or move the row.
- Lanes instead of lifelines (that is a swimlane).
- if/else as two loose arrow clusters with no fragment.
- Solid arrow on a return, open arrowhead on a return, filled arrowhead on fire-and-forget.
