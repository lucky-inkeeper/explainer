# ER / Data Model

**Best for:** conceptual and logical data models, API resource relationships, domain models: anything where the story is entities and cardinality.

**Not for the physical schema.** ER is entity-level: relationship lines join boxes and carry cardinality at each end. When the point is real tables with SQL types, constraints, indexes and column-to-column foreign keys, use `type-db-schema.md`.

`draw_mermaid` with `erDiagram` gives the layout for free. Use `draw_elements` when a focal entity or grouping matters.

## Layout conventions
- Each entity is one database-kind rectangle (green, `roundness: {type: 3}`, label "DB: <Entity>") or a two-part box: a header rectangle with the entity name and a body rectangle below with the field list, `fontFamily 102`, one field per line, `textAlign "left"`. PK prefixed with `#`, FK prefixed with `->`.
- Relationships: `line` elements (no arrowhead) between entities with cardinality at each end as small text, fontFamily 102, fontSize 14: `1`, `N`, `0..1`, `1..*`, placed 12 px from the entity edge.
- Optional relationship label ("has", "belongs to") as the line label.
- Group related entities close. Lay out so most relationships are straight lines.
- Focal treatment on the aggregate root or central entity.

## Anti-patterns
- A line for every FK on a model with dozens: lay out by cluster instead.
- Inconsistent cardinality notation between the two ends of one relationship.
- Boxes padded to equal height: natural height by content is fine.
