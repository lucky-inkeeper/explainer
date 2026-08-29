# Flowchart

**Best for:** decision logic, algorithms, user-facing branching flows ("Should I...?"), onboarding routing, support-triage trees.

## Layout conventions
- Shapes follow the notation: user action = ellipse, system step = rectangle, decision = diamond with a label that ends with "?".
- Start and end: ellipse with the text "Start" or "End". Merge point where branches rejoin: a 12x12 solid black dot (ellipse).
- Flow runs top to bottom. From a diamond, the conventional exits are: Yes to the right, No below. Label every outgoing arrow regardless.
- A diamond has at most 3 exits. More: split into nested diamonds.
- Focal treatment on the happy path or on the single most consequential decision. Never on every decision.
- If two arrows must cross, move a node so they do not.

## Anti-patterns
- Decision diamond with 4 or more exits.
- Unlabeled decision branches.
- A flow that snakes back upward. Reorder so the main path goes straight down.
