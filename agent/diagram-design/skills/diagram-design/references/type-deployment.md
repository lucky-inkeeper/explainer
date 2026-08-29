# Deployment

**Best for:** where the software runs: hosts, VMs, pods and managed services placed inside environment or network-boundary zones, with replica counts and versioned artifacts. Architecture answers "what talks to what"; deployment answers "what is installed on which host, in which environment, behind which boundary, at how many replicas". Without a placement decision to show (no zone, no replica count, no version that matters) use `type-architecture.md`.

## Layout conventions
Three nesting levels, outer to inner:
1. Zone: an environment or network boundary (`edge`, `prod / eu-west-1`, `data`). A Section container, listed first.
2. Infrastructure node: a host, VM, pod or managed service inside a zone. System rectangle (blue) for own infrastructure, external rectangle (red) for managed cloud services. A small grey tag text at its top-left: `POD`, `VM`, `MANAGED`, `CDN` (fontFamily 102).
3. Artifact chip: what is deployed on that node. A small grey rectangle (height 28, `#e9ecef`) inside the node, label `service-name  v2.4.1`, fontFamily 102. Stack chips with an 8 px gap when artifacts are co-located (a sidecar). Give node and chips the same `groupIds` entry.

- Replica badge: a node that runs N copies carries a grey text `x3` at its top-right.
- Network paths: arrows between nodes, labeled with protocol and port (`HTTPS:443`, `TLS:5432`), fontFamily 102. A path that crosses a zone border is solid; a path inside one zone is solid, `strokeWidth 1`. Async or replication paths are dashed.
- Focal rule: at most 2 focal elements, the single point of failure or the newly introduced piece. Example: the primary database (focal treatment) and the replication arrow to its standby (focal color, dashed).
- Over capacity: one deployment diagram per environment.

## Anti-patterns
- The logical architecture with hostnames bolted on. No placement decision visible: use architecture.
- Zones that are only visual grouping with no boundary meaning.
- Artifact chips without a version.
- One node per replica instead of one node with a replica badge.
- Cloud-vendor icon soup instead of named nodes.
- Unlabeled network paths. Protocol and port are the content.
- Two environments side by side without a zone that separates them.
