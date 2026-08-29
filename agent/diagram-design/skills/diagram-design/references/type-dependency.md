# Dependency Graph

**Best for:** what depends on what across packages, modules or services, specifically to show two things a tree cannot: (a) a node with more than one parent (a shared dependency several things converge on), and (b) a cycle. If neither appears (every node has one parent, nothing points backward) use `type-tree.md` and say so.

`draw_mermaid` with `flowchart TD` gives the ranked layout for free. Use `draw_elements` when the cycle or the fan-in badges must be curated.

## Layout conventions
- Ranked rows by dependency depth: rank 0 (entry points nothing depends on) at the top, deeper ranks below. Rows 120 px apart. Nodes in one rank share one row.
- Forward arrows point down across ranks, or run horizontal inside one rank. Never upward, except the one marked cycle.
- Nodes: module rectangles (grey) for internal packages, external rectangles (red) for third-party, `opacity 70` for leaves with no outgoing arrows. 160x56.
- Fan-in badge: a small grey text at the top-right of every node: `4 in`. The node with the highest fan-in is the story; nothing else competes with it.
- The cycle: at most one back-arrow that points up against the rank order. Focal color, dashed, with `elbowed: true` so it runs around the outside of the node stack, with a grey label `CYCLE` at its visible end. The two nodes it touches keep their normal treatment.
- Focal rule: the 2 focal elements are the back-arrow and its `CYCLE` label. Nothing else.
- Over capacity: collapse a leaf cluster into one aggregate node (`+6 leaves`) and say so in chat. Do not drop nodes silently.

## Anti-patterns
- A dependency graph for tree-shaped data: use tree.
- Forward arrows that point upward without being the marked cycle.
- A hairball with no rank order. Rank first, always.
- One node per file instead of per package, module or service.
- External dependencies without a version or registry sublabel (`v3.23  npm`).
- More than one highlighted cycle.
- Missing fan-in badges: without them the reader cannot see where dependencies concentrate.
