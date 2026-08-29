# Architecture

**Best for:** system overviews, data-flow diagrams, integration maps, infra topology.

## Layout conventions
- Group components by tier or trust boundary (frontend, backend, data; public, private). Each tier is a Section container.
- Primary flow runs left to right or top to bottom. Pick one and hold it.
- Nodes follow the notation: system step (blue), module (grey), external service (red), database (green), data (purple dashed).
- 1-2 focal nodes: the primary integration point, the primary data store, or the key decision node.
- A trust boundary (VPC, security group, zone) is a Section container with a dashed border and its title at the top-left.

## Connectors
- Every arrow runs horizontal or vertical. Put the source and the target on the same row or the same column; when that is not possible, use `elbowed: true` on the arrow.
- Never a diagonal arrow.
- Solid arrow = call or flow. Dashed arrow = optional, return, async or passive flow. Same routing rules for both.
- When two arrows must cross, move a node. Do not let two arrows cross a third node.
- Leave 16 px between the section title and the first node inside it.

## Sections
- Group 2 or more nodes that share a tier or trust boundary. List the section before its members in the batch.
- Max 3 sections per diagram. More reads like a swimlane: use that type instead.

## Anti-patterns
- Every box focal ("this is important too"): hierarchy collapses.
- Bidirectional arrow when one direction is obvious from context.
- A legend drawn inside the diagram.
