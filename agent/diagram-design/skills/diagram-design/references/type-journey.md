# User Journey Map

**Best for:** what a person does across the stages of an experience and how it feels at each one. The sentiment curve is the load-bearing element. If you cannot name a sentiment for every stage, use a flowchart or a timeline instead.

## Layout conventions
Vertical stack, top to bottom, for one persona:
- Stage headers: up to 6 equal columns (200 wide, 24 px gutters). Each: a grey eyebrow text (`STAGE 1`, fontFamily 102) over the stage name (fontSize 20), centered on the column.
- Sentiment band: a 160 px tall area under the headers. Three horizontal dashed `line` elements mark `HIGH`, `NEUTRAL`, `LOW`, labeled at the left margin with grey text (never emoji, never rotated text). One 12x12 dot per stage, snapped to one of five levels (`HIGH`, `MED-HIGH`, `NEUTRAL`, `MED-LOW`, `LOW`), joined by one `line` element with one point per stage. The trough dot is 16x16 in the focal color; the rest are black.
- Content rows: up to 3 labeled rows below the band, each with a grey row label in the left margin (`ACTIONS`, `TOUCHPOINTS`, and an optional metric or owner row). One short text per stage, fontFamily 102. Rows are separated by full-width `line` elements.
- Pain markers: on the trough stage only, a small dashed rectangle in the focal color under that stage's action, with a short label that names the friction. At most 2 per diagram.

## Focal rule
Exactly 2 focal elements: the trough dot with its incoming segment, and its pain marker. Nothing else.

## Anti-patterns
- No sentiment curve: that is a process, not a journey.
- More than 6 stages: split into two journeys (acquisition, retention).
- Numeric sentiment axis (0-100). Sentiment here is ordinal: five named levels.
- Emoji as sentiment markers.
- Two personas on one map: overlaid curves erase each other.
- Pain markers on every stage.
- A system flow with no human in it: that is architecture or data flow.
