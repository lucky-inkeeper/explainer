# Layer Stack

**Best for:** OSI model, CSS cascade, context hierarchy, tech stack, abstraction layers, memory hierarchy.

## Layout conventions
- Horizontal bands stacked vertically. Each layer is a full-width rectangle: same x, same width (about 720), height 64, no gap, so the shared borders act as dividers. 4-6 layers.
- Each layer carries, left to right: an index tag at the far left (`L3`, `07`, `APPLICATION`; grey text, fontFamily 102), the layer name as the label, and a sublabel note at the far right (fontFamily 102, grey).
- All layers use one kind color (system blue, or module grey for a tech stack). Hierarchy comes from order, not from color.
- Direction indicator in the left margin, outside the stack: a short vertical arrow plus a grey label (`abstraction up`, `packets down`).
- Focal treatment on one layer: the bottleneck, the layer that pays the rent, the one under discussion.

## Anti-patterns
- Layers that are not hierarchical (use swimlane or architecture).
- Skipped numbering (L3 then L5 with no explanation).
- Inconsistent layer heights without reason.
