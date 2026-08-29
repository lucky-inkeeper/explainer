# Tree / Hierarchy

**Best for:** dependency trees, taxonomy, file trees, decision breakdowns, skill trees. For people, teams or agents use `type-org-chart.md`.

## Layout conventions
- Root at the top, children fan out below (or root at the left, children to the right).
- Nodes are rectangles, 160x52 by default, name in the label plus an optional grey sublabel text (fontFamily 102, fontSize 14) under it. Use at most 2 widths.
- Connectors are orthogonal: arrows from parent to child with `elbowed: true` (they leave the parent bottom and enter the child top with one bend pair). Never diagonal. No arrowhead needed on a tree: `endArrowhead: null`.
- Siblings share one row. Leave 48 px between siblings, 80 px between levels.
- Leaf indicator: `strokeWidth 1` and lighter fill, or let the terminal position do the work.
- Focal treatment on one node: the root or the critical leaf. Not both.

## Anti-patterns
- A tree 5 or more levels deep on one canvas: split it.
- Nodes of wildly different widths.
- Diagonal connectors.
- Skipped levels (parent connected to grandchild with no middle).
