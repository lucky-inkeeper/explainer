# Semantic patterns

Semantic patterns describe what a system does; the visual types describe how information is arranged. Choose a pattern first when behavior, state, enforcement or risk is load-bearing, then use its nearest visual type as the layout grammar. If no pattern matches, choose a visual type directly.

Use one primary pattern per diagram. A second pattern may supply at most one supporting primitive; if both need full treatment, split overview and detail. Labels and outcomes must be complete on the canvas; color and position reinforce meaning but never carry it alone.

## Routing table

| The reader must understand... | Semantic pattern | Nearest visual type |
|---|---|---|
| Many arrivals competing for finite service capacity | Fan-in queue / bottleneck | Architecture (as a data flow) |
| Repeated questions, inputs, controls and outputs across stages | Stage framework with semantic slots | Swimlane (stages as columns) |
| A loose conversation becoming a durable structured record | Unstructured input to structured artifact | Architecture (as a data flow) |
| Why two policy decisions differ and where they first diverge | Paired policy-evaluation traces | Flowchart |
| Which routes cross a trust boundary and which are blocked | Secure paved road | Architecture |
| Which controls apply at each enforcement surface | Governance / control catalog | Layer stack |
| How defenses reduce risk and what risk remains | Compensating security layers | Layer stack |

## 1. Fan-in queue / bottleneck
**Triggers:** several producers converge on one reviewer, service, gate or constrained resource; the story depends on arrival rate, queue depth, wait, capacity or backpressure.
**Required primitives:** distinct sources; fanned-in arrows; an ordered queue with visible slots and a count (a row of small rectangles inside a section); a capacity or service-rate label with units (`8/hour`, `3 slots`), not just "high"; one constrained service point (focal); admitted and deferred or rejected outcomes.
**Anti-patterns:** an equal-width pipeline that hides contention; arrows merged before they can be traced; capacity implied only by box size; red alone meaning overloaded.
**Must show:** the queue with its count and capacity, the bottleneck label, and both outcome paths. The reader must see why work waits.

## 2. Stage framework with semantic slots
**Triggers:** a lifecycle or operating model repeats the same questions across stages (Question, Input, Governance, Output). Cross-stage comparability matters more than timing.
**Required primitives:** ordered stage headers; a consistent slot grid (same rows in every stage); explicit empty or `n/a` slots; stage-to-stage handoff arrows; stable slot labels; one primary output per stage.
**Anti-patterns:** each stage with a different internal layout; slot meaning encoded by position with no labels; fake precision from dozens of cells; stage order confused with ownership lanes; shrinking text to keep one canvas.
**Must show:** the full stage x slot matrix with handoffs and explicit `-` or `n/a` entries.

## 3. Unstructured input to structured artifact
**Triggers:** dialogue, notes, prompts or a rambling request are elicited, normalized and written into a durable brief, ticket, record or schema.
**Required primitives:** source utterances (note texts); clarifying questions; extracted field/value pairs; a named transformation step; the artifact boundary (a section or a data rectangle); provenance arrows from representative statements to fields; a visible missing or unknown state.
**Anti-patterns:** "AI magic" between two boxes; the artifact shown as another chat bubble; fields that appear without sources; invented certainty for missing facts.
**Must show:** a short source excerpt beside the completed labeled artifact, at least one provenance arrow, and any unknown fields.

## 4. Paired policy-evaluation traces
**Triggers:** two otherwise similar requests reach different outcomes; the reader needs rule-by-rule `PASS`, `FAIL`, `SKIPPED` or `NOT REACHED` and the first divergence.
**Required primitives:** the same ordered rules on both traces (two columns); explicit status text on every cell; the inputs that differ; final outcomes; a labeled first-divergence marker (focal); a distinction between `SKIPPED` (intentionally bypassed) and `NOT REACHED` (evaluation stopped earlier).
**Anti-patterns:** two independently ordered flows; colored dots without words; skipped and not-reached used as synonyms; every difference highlighted; a denied trace that continues as if downstream rules ran.
**Must show:** all rule states and both outcomes at once, with one marker for the first divergence.

## 5. Secure paved road
**Triggers:** a supported architecture creates a bounded route from intake or build to deployment; trust boundaries, privileged moments, permitted and forbidden ingress, approved versus blocked deploy paths are the point.
**Required primitives:** labeled trust boundaries (sections); actors and identities; permitted ingress with a positive text label; forbidden ingress that stops at the boundary (dashed arrow with `endArrowhead "bar"` and a label like `blocked`); the approved deployment path; a blocked bypass path; a privileged gate (decision diamond); an isolated runtime; an audit destination.
**Anti-patterns:** a dashed box called "security" with no route semantics; a forbidden arrow that crosses into the protected zone; secrets or identity implied but unlabeled; every component styled as trusted; a bypass path that visually rejoins the approved route.
**Must show:** every boundary and both permitted and forbidden routes. Blocked paths visibly stop before entry or deployment.

## 6. Governance / control catalog
**Triggers:** a control inventory must be understood by where it is enforced: authoring, workspace, merge/CI, deploy/runtime or another named surface. A checklist would hide the enforcement points.
**Required primitives:** enforcement-surface groups (layers); named controls inside each; the enforcement actor (`code`, `platform`, `human`); the timing (`write`, `merge`, `deploy`, `run`); a bypass or exception route; coverage gaps shown as dashed empty slots.
**Anti-patterns:** dozens of tiny chips; grouping by vague themes instead of enforcement point; aspirations mixed with enforced controls; defense in depth claimed without visible surface coverage.
**Must show:** the complete grouped catalog with surface headers and text for actor and timing; gaps and exceptions stay visible.

## 7. Compensating security layers
**Triggers:** no layer is perfect; each defense covers a failure the previous layer left, and residual risk must visibly narrow, transfer or remain through the stack.
**Required primitives:** an ordered threat or risk input; named defensive layers; each layer's mitigation; its explicit limitation or escape; a residual-risk arrow between layers (dashed, labeled); the final residual risk and the response.
**Anti-patterns:** implying the final layer makes risk zero; equal opaque slabs with no propagation; audit treated as prevention; shapes that shrink without a numeric or verbal meaning.
**Must show:** the complete chain: initial risk, mitigation, escaped risk at every layer, final residual risk and response.

## Composition rules
- The pattern may specialize status, boundary, queue or propagation primitives; the type still owns the page axis, the connector grammar, the spacing and its own rules.
- Use stable text for states and outcomes. Color and position reinforce meaning but never carry it alone.
