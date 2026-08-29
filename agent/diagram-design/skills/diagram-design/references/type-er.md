# ER / Data Model

**Best for:** conceptual and logical data models, API resource relationships, domain models: anything where the story is entities and cardinality.

**Not for the physical schema.** ER is entity-level: relationship lines join boxes and carry cardinality at each end. When the point is real tables with SQL types, constraints, indexes and column-to-column foreign keys, use `type-db-schema.md`.

`draw_mermaid` with `erDiagram` gives the layout for free. Use `draw_elements` when a focal entity or grouping matters.

## Layout conventions
- Each entity is ONE database-kind rectangle (green, `roundness: {type: 3}`), tall enough for its fields (height 44 + 22 per field): label `{text: "DB: <Entity>", verticalAlign: "top"}`. The field list is a separate text element placed inside it (x + 16, y + 44, `fontFamily 102`, `fontSize 16`, `textAlign "left"`, one field per line), listed AFTER the rectangle and sharing a `groupIds` entry with it. PK prefixed with `#`, FK prefixed with `->`. Never two stacked boxes: a line bound to a header crosses the body.
- Relationships: `line` elements (no arrowhead) bound to the entity rectangles, with cardinality at each end as small text, fontFamily 102, fontSize 14: `1`, `N`, `0..1`, `1..*`, placed 12 px outside the entity edge, never on a line.
- Optional relationship label ("has", "belongs to") as the line label.
- Group related entities close. Lay out so most relationships are straight lines.
- Focal treatment on the aggregate root or central entity.

## Anti-patterns
- A line for every FK on a model with dozens: lay out by cluster instead.
- Inconsistent cardinality notation between the two ends of one relationship.
- Boxes padded to equal height: natural height by content is fine.
