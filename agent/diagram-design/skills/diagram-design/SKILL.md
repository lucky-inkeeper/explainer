---
name: diagram-design
description: Pick the diagram type and its layout rules before drawing on the Explainer canvas. Covers architecture, flowchart, sequence, state machine, ER, database schema, timeline, swimlane, quadrant, tree, org chart, layer stack, kanban, user journey, deployment and dependency graph, plus semantic patterns (bottleneck, paved road, control catalog, policy traces) and annotation callouts. Use before every new complete diagram.
license: MIT, ported from cathrynlavery/diagram-design (see UPSTREAM.md)
---

# Diagram design for the Explainer canvas

Output is NOT an HTML or SVG file. Output is one `mcp__canvas__draw_elements` batch (or `mcp__canvas__draw_mermaid` for auto layout). The NOTATION in the system prompt (shape + color per kind, one frame per diagram, section containers) always applies. This skill adds three things: which type to draw, how to lay it out, what to leave out.

## 1. Philosophy

The highest-quality move is usually deletion.

- Every node is one distinct idea. Two nodes that always travel together are one node.
- Every arrow carries information. If the layout makes the relation obvious, remove the arrow.
- Accent is editorial, not a flag. Give the focal treatment to 1-2 nodes per diagram. On 5 nodes the signal is gone.
- The diagram is done when nothing can be removed, not when everything is added.
- Do not draw a list (answer with a short table in chat) or a one-shape diagram (write the sentence).

## 2. Selection: pattern first, then type

When behavior, state, enforcement or risk carries the meaning, read `references/semantic-patterns.md` first and choose one pattern. Then choose its nearest visual type for the layout. If no pattern matches, choose the type directly.

| If you show... | Type | Reference |
|---|---|---|
| Components and their connections in a system | Architecture | references/type-architecture.md |
| Decision logic with branches | Flowchart | references/type-flowchart.md |
| Time-ordered messages between actors | Sequence | references/type-sequence.md |
| States, transitions and guards | State machine | references/type-state.md |
| Entities, fields and cardinality (conceptual) | ER / data model | references/type-er.md |
| Physical tables, SQL types, column-level foreign keys | Database schema | references/type-db-schema.md |
| Events positioned in time | Timeline | references/type-timeline.md |
| Cross-functional process with handoffs | Swimlane | references/type-swimlane.md |
| Two-axis positioning or prioritization | Quadrant | references/type-quadrant.md |
| Parent to children hierarchy | Tree | references/type-tree.md |
| Who owns what: people, teams, agents, escalation | Org chart | references/type-org-chart.md |
| Stacked abstraction levels | Layer stack | references/type-layers.md |
| Work in progress by state, WIP limits, blocked items | Kanban | references/type-kanban.md |
| What a person does across stages and how it feels | User journey | references/type-journey.md |
| Where software runs: zones, hosts, replicas, ports | Deployment | references/type-deployment.md |
| What depends on what, with fan-in or cycles | Dependency graph | references/type-dependency.md |

Rules of thumb:

- If a 3-column table says the same thing, answer with the table in chat.
- If two types fit, pick the dominant axis. A semantic pattern adds primitives, never a second layout grammar.
- A type not in the table (bar, line, scatter, radar, treemap, sankey, venn, pyramid, gantt, mind map...): draw it free-form with `draw_elements` and the shared grammar in section 4. For numbers, prefer a table in chat.

Read the chosen reference before drawing. Then draw at once. Do not ask for approval first. After drawing, write one line in chat with the type and the count, for example: "Drew a swimlane (3 lanes, 9 steps)."

## 3. Canvas mapping (upstream term to skeleton)

| Upstream says | On the canvas |
|---|---|
| node box, `rx=6` | rectangle of the notation kind (system step blue, module grey, external red...) |
| rounded box, `rx=8` | `roundness: {type: 3}` |
| oval, stadium, pill | ellipse |
| dot `r=4` or `r=6` | ellipse 12x12 or 16x16, `backgroundColor "#1e1e1e"`, `fillStyle "solid"` |
| hairline, default, strong stroke | `strokeWidth` 1, 1, 2 |
| dashed, optional, async, return | `strokeStyle "dashed"` |
| accent, coral, focal | focal treatment: `strokeColor "#e8590c"`, `strokeWidth 2`; fill stays the kind color. At most 2 per diagram |
| muted text, eyebrow, mono, sublabel, tag, chip | text element, `fontFamily 102`, `fontSize 14`, `strokeColor "#868e96"`; a chip is that text inside a small grey rectangle |
| zone, boundary, lane, fragment frame, containment | the Section container from the system prompt: `#f8f9fa` dashed rectangle listed before its members, title text top-left, shared `groupIds` |
| orthogonal or elbow connector | `elbowed: true` on a bound arrow; the app routes it with right angles (facing sides, one bend pair). Still put nodes on shared rows and columns so most arrows need no bend |
| bridge or hop at a crossing | not available; reorder nodes so arrows do not cross |
| label mask, label margin | not needed; the app widens gaps so arrow labels fit |
| legend strip | the app adds one under every framed diagram (kinds and arrow styles used); never draw one |
| open arrowhead (async, fire-and-forget) | `strokeStyle "dashed"`, `endArrowhead "arrow"`; sync call = solid, `endArrowhead "triangle"` |
| filled marker on return | dashed line, `endArrowhead "triangle"` |
| Geist, Geist Mono, Instrument Serif | not used; `fontFamily 101` (hand) for labels, `102` (Inter) for notes and code-like text |
| size preset, dark mode, viewBox | none; one canvas, light |

## 4. Layout grammar shared by all types

- One flow direction per diagram: left to right, or top to bottom. Hold it.
- Nodes 160x60 by default. Use at most 2 node widths per diagram. Keep x, y, width, height in multiples of 4.
- Gaps of 60-120 px between nodes. 24 px padding inside a section. 16 px between a section title and its first member.
- Sections before their members. Arrows in the same call as their shapes, bound by id. `elbowed: true` when source and target are not on one row or column.
- Label every decision branch and every handoff arrow: a short verb or condition, 1-4 words.
- Give the focal treatment to the node the reader must notice. Never more than 2.
- Draw first. Fix the `warnings` from the tool result. Then answer.

## 5. Universal anti-patterns

- Every node focal: hierarchy collapses.
- Bidirectional arrow when one direction is obvious from context.
- Arrows that snake back and forth: reorder the nodes.
- Unlabeled branches, unlabeled handoffs, unnamed axes.
- Sentences inside nodes: move them to a note text next to the diagram.
- Two diagrams in one: split into overview + detail, and offer the detail in chat.

## 6. Annotations

For an editorial aside that must not compete with the diagram, read `references/primitive-annotation.md`.
