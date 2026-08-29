# State Machine

**Best for:** finite state logic: order status, auth state, connection lifecycle, form wizard, job queue status.

Prefer `draw_mermaid` with `stateDiagram-v2` when the machine is plain. Use `draw_elements` when a focal state or a curated layout matters.

## Layout conventions
- States are rectangles with `roundness: {type: 3}`, system color (blue).
- Start: a 16x16 solid black dot. End: a 20x20 black ring (ellipse, `backgroundColor "transparent"`, `strokeWidth 2`) with a 12x12 solid dot inside.
- Transitions: arrows labeled `event [guard] / action`. Omit the parts you do not need. Label fontFamily 102.
- Self-loop: a 3-point `line` above the state, arrow end back into the state.
- Orient along the dominant flow direction. Rearrange before you let transitions cross.
- Focal treatment on the state the reader should notice: the error state, or "happy completion".

## Anti-patterns
- Many more transitions than states: likely two state machines.
- "From any state" transitions drawn from every state. Use one note text instead: `* -> Error on timeout`.
- Unlabeled transitions (the whole point is what triggers this).
