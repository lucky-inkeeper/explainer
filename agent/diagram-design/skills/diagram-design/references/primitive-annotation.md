# Annotation Callout (editorial aside)

Use for an aside that marks a detail without competing with the diagram grammar. Think marginalia: "structure IS the index", "no imports, no configuration".

## Grammar
1. A note text element: `fontFamily 102`, `fontSize 16`, `strokeColor "#868e96"`, 1-2 lines, no box.
2. A dashed leader: an arrow with `strokeStyle "dashed"`, `strokeWidth 1`, `endArrowhead "dot"`, from the text to the element it points at. Bind `end` to that element's id.

## Rules
- The dashed leader separates the callout from primary arrows, which are solid.
- Place callouts in the margins (top-right, bottom-left), never inside the active diagram area.
- Max 2 callouts per diagram. More is commentary, not signal.
- A focal callout uses `strokeColor "#e8590c"` on both the text and the leader.

## Anti-patterns
- A solid leader (reads as a flow arrow).
- A callout that crosses primary arrows or lifelines: move it to a clear margin.
- A callout for something the diagram should label directly: put the label on the element.
