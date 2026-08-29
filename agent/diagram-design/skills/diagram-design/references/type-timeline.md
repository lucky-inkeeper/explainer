# Timeline

**Best for:** release history, project milestones, incident timelines, roadmaps, changelog visualizations.

## Layout conventions
- One horizontal `line` as the baseline across the middle, `strokeWidth 1`.
- Tick marks at time boundaries (quarters, months, sprints): short vertical `line` elements with the date label below, `fontFamily 102`, fontSize 14.
- Events: 12x12 solid black dots on the baseline. Labels alternate above and below to prevent collisions, joined to the dot by a short vertical `line`.
- Major milestones: 16x16 dot in the focal color plus a bold label (fontSize 20).
- The time scale must be honest: unequal intervals get unequal spacing. Do not fake linear spacing. Break the axis visibly (a gap and a `//` text) when a region is too dense.

## Anti-patterns
- Equal spacing for events that are not equally spaced in time.
- Missing axis labels ("what unit is this?").
- Crowded labels without vertical offset.
