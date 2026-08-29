# Org Chart / Responsibility Map

**Best for:** human teams, agent teams, support escalation maps, role ownership, routing maps: any hierarchy where the reader needs to know who owns what.

Use Org chart instead of Tree when the nodes are people, agents, teams, roles or accountable owners. A tree shows structure. An org chart shows responsibility, invocation paths and coverage gaps.

## Layout conventions
- Root owner or "front door" at the top center. Focal treatment on the person, team or agent that receives ambiguous work.
- Tier 1 nodes are departments, pods, queues or primary routing buckets. Keep them on one row.
- Tier 2 nodes are responsible owners or specialists. With more than 8 specialists, group them under pod nodes instead of one giant row.
- Orthogonal connectors as in `type-tree.md`. No diagonal lines.
- Each node answers three questions when space allows: name (the label), how to invoke (Slack handle, queue, issue prefix; grey sublabel text, fontFamily 102), scope (2-4 terse words; second sublabel line).
- Owners that are not live yet: `strokeStyle "dashed"` instead of hidden. Missing routes matter.
- Escalation and approval rules go in one note text or a small Section container at the side, not as extra org nodes.

## Node kinds
- Front door: focal treatment.
- Team, pod, department: system rectangle (blue).
- Individual agent or owner: user action ellipse (yellow) for people, module rectangle (grey) for agents.
- Gap, needs setup: dashed stroke.
- Approval gate: decision diamond, separate from the reporting hierarchy.

## Anti-patterns
- A swimlane when the real question is "who does what?". Swimlanes explain process; org charts explain ownership.
- Every person or agent as an identical box: hides the front door, specialists, gaps and escalation paths.
- Full job descriptions inside nodes. Keep scope phrases short; move detail to a note text.
- Unavailable owners shown as normal active owners.
