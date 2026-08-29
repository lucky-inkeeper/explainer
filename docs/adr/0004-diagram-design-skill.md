# ADR-0004: Diagram type routing comes from a ported diagram-design skill; render target stays the canvas

Date: 2026-08-29. Status: accepted.

## Decision
- The knowledge layer of cathrynlavery/diagram-design (MIT, v2.6.7) is ported into `agent/diagram-design/` as a Claude Code plugin: a routing table (which type for which question), 16 type references, 7 semantic patterns, annotation callouts, and a deletion-first philosophy. Its render layer (HTML + SVG, fonts, export, animation, importers, brand profiles, doctor, scripts) is not taken.
- Scope: 16 of 39 types. Architecture, flowchart, sequence, state machine, ER, database schema, timeline, swimlane, quadrant, tree, org chart, layer stack, kanban, user journey, deployment, dependency graph. Quantitative charts and niche data-platform types are out; the agent draws them free-form.
- Every reference is rewritten for the Excalidraw skeleton. Upstream terms map to skeleton props in `SKILL.md` "Canvas mapping" (rounded box = `roundness {type: 3}`, zone = Section container, orthogonal connector = nodes on shared rows and columns, accent = focal treatment).
- ADR-0003 notation wins over the upstream "shape carries type, ink + one accent" scheme. Kind colors stay. New rule: focal treatment (`strokeColor "#e8590c"`, `strokeWidth 2`) on at most 2 nodes per diagram.
- A note points at what it explains: within 40 px of the element, or a dashed grey leader arrow (`endArrowhead "dot"`) bound from the note to the element. Max 2 notes per diagram. Leaders bind to shapes or text only; `draw_elements` rejects an arrow bound to an arrow with a plain error instead of Excalidraw's TypeError.
- No numeric node budget. Upstream detail dials and per-type limits are dropped; the deletion philosophy stays as prose.
- No pause before drawing. The agent picks the type, draws, then reports the type and count in one chat line.
- Delivery: `claude.ts` passes `--plugin-dir <repo>/agent/diagram-design`; the path is baked at build time as `__AGENT_DIR__`, like `__DATA_DIR__`. `--allowedTools` also gets `Read(//<plugin dir>/**)`, so reading a reference never prompts in `default` mode. The system prompt forces the skill before every new complete diagram.

## Why
- The upstream references encode diagram craft (grouping by tier, one flow direction, labeled handoffs, one focal element) that the system prompt did not have, and they are renderer-independent once the SVG is stripped.
- A plugin dir is versioned in the repo and independent of the agent's workspace, which the user can point at any folder. `data/` is gitignored, so a workspace copy would not be versioned.
- The user reads diagrams faster with one fixed notation; the upstream editorial palette would replace it for no gain on a whiteboard.
- Charts need computed geometry the skeleton does not offer; a table in chat serves numbers better.

## Consequences
- Every new diagram costs one skill invocation plus one reference read (about 30-80 lines).
- Upstream updates are merged by hand; `agent/diagram-design/UPSTREAM.md` records the commit to diff against.
- `elbowed: true` on a bound arrow gets a right-angle route from the spacing pass (facing sides, one bend pair, no obstacle avoidance; Excalidraw re-routes on the first drag).
- Every framed diagram gets an app-built legend strip (swatch + label per kind used, one sample per arrow style, focal). The agent never draws a legend; `KINDS` in `src/shared/tools.ts` is the single table behind the strip and must match the NOTATION prose.
- Ids the agent reuses across turns get a `-2`, `-3` suffix and references in the batch follow; the result lists them under `renamed`.
