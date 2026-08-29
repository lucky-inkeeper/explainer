# Database Schema

**Best for:** the physical schema: real tables, SQL types, constraints, indexes, and foreign keys that connect one column to another column. Migrations, review of a real database, anything where the column type or the `ON DELETE` behavior is the point.

**Not for domain modeling.** `type-er.md` is entity-level. Database schema is column-level: the FK arrow anchors to the specific column row on both ends. If you discuss what an Order is, use ER. If you discuss what happens when a row is deleted, use this.

## Layout conventions

### Table box
- Header: a database-kind rectangle (green) with the label `schema.table`, for example `DB: public.orders`.
- Column rows: one rectangle per row directly under the header, height 28, grey `#f8f9fa`, `roughness 0`. Label `fontFamily 102`, `textAlign "left"`: `column_name  type  [PK|FK|UQ|NN]`, for example `customer_id  uuid  FK NN`.
- Fixed row height, so arrows can anchor to a row.
- Overflow row: when you leave columns out, the last row reads `+ N more columns`. Never truncate a table silently.
- Index rows: optional, after the columns, title text `INDEXES` then one row per index that matters to the story.
- Give the header and all its rows the same `groupIds` entry.

### Foreign-key arrows: the defining rule
- Each FK arrow starts at the source column row and ends at the referenced column row. Bind `start` and `end` to the row rectangles, not to the header.
- Label each arrow with its referential action: `ON DELETE CASCADE`, `ON DELETE RESTRICT`, `ON DELETE SET NULL`. fontFamily 102.
- Put tables that reference each other side by side so FK arrows run horizontal.

### Schema grouping
Tables in a non-default schema sit inside a Section container titled with the schema name.

### Focal rule
The focal elements are: (1) the one destructive FK (`ON DELETE CASCADE`), arrow in focal color, and (2) the table that FK cascades into, focal treatment on its header only. Nothing else is focal. A schema without a destructive FK has no focal element; do not promote an arbitrary table.

## Anti-patterns
- Every column of every table: a schema diagram is an argument about a subsystem, not a `\d+` dump.
- FK arrows that connect box to box instead of column to column (that is ER).
- Missing SQL types: the type is half the content.
- Unlabeled FK arrows: the `ON DELETE` behavior is what a reviewer looks for.
- Constraint chips on every row until the chips are the noise.
- Conceptual entity names mixed with physical table names.
