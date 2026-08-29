# Swimlane

**Best for:** cross-functional processes, RACI-style flows, vendor handoffs, multi-team shipping workflows.

## Layout conventions
- Horizontal lanes (or vertical columns), one per actor or team. Each lane is a Section container with the actor name as its title.
- Lanes share the same x and width and sit directly under each other with no gap, so the borders act as dividers.
- Process steps are rectangles placed inside the lane of the actor who performs them. Arrows show the flow, left to right.
- Steps sit on one shared row per lane and on shared columns across lanes. Handoffs between lanes use `elbowed: true`, so every arrow runs horizontal or vertical.
- Handoffs (arrows that cross a lane border) are the most important edges. Focal treatment on the handoff that adds the most coupling or latency.
- Do not force an equal step count per lane. A lane with one step is fine.

## Anti-patterns
- Lanes without labels.
- A step drawn across two lanes (pick one owner).
- Arrows that snake back and forth: reorder the steps so the flow goes mostly one way.
