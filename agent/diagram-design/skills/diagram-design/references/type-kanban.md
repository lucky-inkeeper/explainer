# Kanban Board

**Best for:** a snapshot of work in progress by state: what is queued, what moves, what is stuck, and where the WIP limit is breached. A state census, not a flow: a kanban board has no arrows at all. That separates it from a swimlane (lanes plus a flow with handoffs) and from a process (ordered steps). If the diagram needs an arrow anywhere, use swimlane or flowchart instead.

## Layout conventions
- Up to 5 vertical columns of equal width (240), 32 px gutters. Each column is a Section container.
- Column title: the column name plus a WIP chip at the right: `n/limit` as grey text, fontFamily 102. A queue or terminal column shows a bare `n`. Every in-process column states a limit.
- Cards: rectangles, column width minus 32, height 72, 12 px vertical gap. Label: the title, `verticalAlign: "top"`, at most 24 characters so it stays on one line. Sublabel text inside the card at its bottom-left (x + 12, y + 44), fontFamily 102, fontSize 14, grey: `TICKET-ID  owner`, sharing a `groupIds` entry with the card.
- Batch order: columns, then column titles and chips, then cards.

## Card states

| State | Treatment |
|---|---|
| default | module rectangle (grey `#e9ecef`) |
| blocked | `strokeStyle "dashed"`, focal treatment (`strokeColor "#e8590c"`, `strokeWidth 2`) |
| waiting / external | external color (`#ffc9c9`), `strokeStyle "dashed"` |
| done | grey, `opacity 60` |

## Over-limit column
When a column's card count exceeds its limit, the WIP chip text turns to the focal color. That plus one blocked card is the whole focal budget for the diagram.

## Anti-patterns
- Arrows between cards. A board shows state, not flow.
- A column that runs off the canvas. Aggregate the rest into one count card: `+14 more`.
- One card per person (that is an org chart in a kanban skin).
- In-process columns without WIP limits.
- Every blocked card focal: noise, not signal.
- A "Done" column that grows without bound. Cap it and note the archive point in a sublabel.
