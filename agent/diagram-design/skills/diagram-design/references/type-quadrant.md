# Quadrant

**Best for:** prioritization (Impact x Effort), positioning (Reach x Frequency), portfolio maps, 2x2 decision frames.

## Layout conventions
- A 2x2 grid: two `line` elements that cross at the center, `strokeWidth 1`, with an arrowhead at the positive end of each axis.
- Axis labels: one single word at each arrow tip. No glyphs, no parentheticals, no "HIGH / LOW". `fontFamily 102`, uppercase. Place labels beyond the tips, never on the axis line, never at the midpoint.
- Items: 12x12 dots with a label 12 px away. Do not let labels cross the axis lines.
- Quadrant names: a small grey text in each corner (`DO FIRST`, `DELEGATE`...).
- Focal treatment (16x16 dot in the focal color) on the "do first" item, typically top-right.
- Cluster or split when items get crowded.

## Anti-patterns
- Four filled quadrants in different colors: position and label do the work.
- Items placed on an axis line (ambiguous quadrant).
- Missing axis names.

## Variant: 2x2 scenario matrix
Use when you frame four futures, archetypes or strategic options across two independent drivers. The reader takes away four named bets, not a point cloud.
- Axes hold a range, both ends labeled, arrowheads at both ends.
- Four equal cells (about 280x180) with a 48 px gap from the axis cross, so the axes pass between the cells.
- Each cell: a numbered corner tag (`01  DIMENSION-A / DIMENSION-B`, fontFamily 102, grey), a name (fontSize 20) and a 1-3 line description (fontFamily 102, fontSize 14).
- Exactly one focal cell: focal treatment on the cell rectangle. None makes it a placeholder; two erases the signal.
- Corner tags must repeat the axis words exactly.
- Not for prioritization or anything where the position inside a cell matters: use the standard quadrant.
