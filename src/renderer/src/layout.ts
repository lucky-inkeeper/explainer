/**
 * Layout: the diagram math run on a batch before it lands on the canvas (CONTEXT.md "Layout", ADR-0005).
 * Arrow routes, label spacing, note parking, legend strip, frame, overlap and crossing warnings. Works on the batch alone; never touches the scene.
 * Entry points: layout() for a skeleton batch, inspect() for converted elements. In dev both hang on window.__layout; test/layout.test.mjs replays fixtures through them.
 */
import { FONT_FAMILY, convertToExcalidrawElements, getCommonBounds, newElementWith } from "@excalidraw/excalidraw";
import { KINDS, NOTATION, classify, isFocal, notationWarnings } from "../../shared/tools";

/** Web fonts (Google Fonts, loaded in index.html) registered as extra Excalidraw font ids. Excalidraw resolves the id to the family name for canvas drawing and measuring. */
export const FONTS = { "Playpen Sans": 101, Inter: 102 } as const;
export const DEFAULT_FONT = FONTS["Playpen Sans"];
Object.assign(FONT_FAMILY, FONTS);

/** Apply the default font to skeleton text and labels that do not name one. */
export const withDefaultFont = (skeleton: El[]): El[] =>
  skeleton.map((e) => {
    const out = { ...e };
    if (e.type === "text" && !e.fontFamily) out.fontFamily = DEFAULT_FONT;
    if (e.label && !e.label.fontFamily) out.label = { ...e.label, fontFamily: DEFAULT_FONT };
    return out;
  });

// ponytail: excalidraw element types live in scattered subpaths; loose typing here, excalidraw validates at runtime
export type El = any;

type Box = { x: number; y: number; w: number; h: number };
/** Estimated text width: 0.6 em per character of the longest line plus padding. The spacing pass swaps in measured widths after conversion. */
const textWidth = (text: unknown, fontSize: number) => Math.max(...String(text).split("\n").map((l) => l.length)) * fontSize * 0.6 + 8;
/** Geometry box; an arrow label gets the box of its visible text (Excalidraw pads labels to 11 x font size). */
const box = (e: El): Box => {
  if (e.type === "text" && e.containerId && e.text) {
    const w = Math.min(e.width, textWidth(e.text, e.fontSize ?? 16));
    return { x: e.x + (e.width - w) / 2, y: e.y, w, h: e.height };
  }
  return { x: e.x, y: e.y, w: e.width, h: e.height };
};
const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const hit = (a: Box, b: Box, pad = 2) => a.x + a.w > b.x + pad && b.x + b.w > a.x + pad && a.y + a.h > b.y + pad && b.y + b.h > a.y + pad;
const SHAPES = new Set(["rectangle", "ellipse", "diamond", "image"]);
/** What an arrow must not run through: a node, or a free text (a note, a title) with a known box. Sections are transparent. */
const isObstacle = (e: El) => e.x != null && ((SHAPES.has(e.type) && !isSection(e)) || (e.type === "text" && !e.containerId && Number.isFinite(e.width) && Number.isFinite(e.height)));
/** Greedy word wrap to about `maxChars` per line; the converter does not wrap a free text at the width the agent gives. */
const wrap = (text: string, maxChars: number) => text.split("\n").map((para) => { const lines: string[] = []; let line = ""; for (const word of para.split(" ")) { if (line && line.length + 1 + word.length > maxChars) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word; } lines.push(line); return lines.join("\n"); }).join("\n");
/** Wrap `text` to `boxW` px given a measured sample (its longest line spans `measuredW` px). Returns the text unchanged when it fits. */
export function fitText(text: string, boxW: number, measuredText: string, measuredW: number): string {
  if (!(measuredW > boxW + 1)) return text;
  const longest = Math.max(...measuredText.split("\n").map((l) => l.length));
  return wrap(text, Math.max(8, Math.floor((boxW * longest) / measuredW)));
}

/**
 * Bound arrow labels overlap shapes when the arrow is shorter than the label.
 * Fix on the skeleton: push the target shape (and everything beyond it on that axis) until the label fits, then re-convert
 * so Excalidraw re-routes the arrows and recenters labels. ponytail: axis-aligned push only; a real layout engine if diagrams get dense.
 */
/** Point on the boundary of `e` (centre cx,cy) along the ray toward (ox,oy), pushed out by a small gap. */
function edgePoint(e: El, cx: number, cy: number, ox: number, oy: number, gapPx = 6): [number, number] {
  const dx = ox - cx, dy = oy - cy, hw = (e.width ?? 100) / 2, hh = (e.height ?? 100) / 2;
  if (!dx && !dy) return [cx, cy];
  const ax = Math.abs(dx) / hw, ay = Math.abs(dy) / hh;
  const t = e.type === "ellipse" ? 1 / Math.hypot(ax, ay) : e.type === "diamond" ? 1 / (ax + ay) : 1 / Math.max(ax, ay);
  const len = Math.hypot(dx, dy), gap = gapPx / len;
  return [cx + dx * (t + gap), cy + dy * (t + gap)];
}

type Route = { p1: [number, number]; p2: [number, number]; kind: "straight" | "zh" | "zv" | "lv" | "lh"; frac?: number; elbowed?: boolean };

/** Free space between two boxes on each axis (negative when their ranges overlap). Decides sideways vs up/down. */
const gaps = (s: El, t: El) => ({
  gx: Math.max(t.x - (s.x + (s.width ?? 100)), s.x - (t.x + (t.width ?? 100))),
  gy: Math.max(t.y - (s.y + (s.height ?? 100)), s.y - (t.y + (t.height ?? 100))),
});

/** Skeleton geometry for a route: z = one bend pair halfway, l = one bend, straight otherwise. */
function geometry(r: Route) {
  const dx = r.p2[0] - r.p1[0], dy = r.p2[1] - r.p1[1], f = r.frac ?? 0.5;
  const mid = r.kind === "zh" ? [[dx * f, 0], [dx * f, dy]] : r.kind === "zv" ? [[0, dy * f], [dx, dy * f]] : r.kind === "lv" ? [[0, dy]] : r.kind === "lh" ? [[dx, 0]] : [];
  return { x: r.p1[0], y: r.p1[1], width: Math.abs(dx), height: Math.abs(dy), points: [[0, 0], ...mid.filter((m, i, all) => i === 0 || m[0] !== all[i - 1][0] || m[1] !== all[i - 1][1]), [dx, dy]] };
}

const isSection = (e: El) => classify(e) === "section";

/** Where Excalidraw puts an arrow label: the middle point of an odd path (the corner), else the midpoint of the middle segment. */
function labelCenter(pts: number[][]): number[] {
  if (pts.length % 2 === 1) return pts[Math.floor(pts.length / 2)];
  const i = pts.length / 2 - 1;
  return [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
}

/**
 * Route cost: 100 per node or text it runs through (its own ends included: ports sit outside the box), 10 per arrow it runs along,
 * 1 per arrow it crosses, 20 when its label would sit on a node, a text or another arrow, 5 when the label would straddle a section border.
 */
function routeCost(r: Route, obstacles: El[], placed: Seg[], label: { w: number; h: number } | null, sections: El[]) {
  const g = geometry(r), pts = g.points.map((p) => [g.x + p[0], g.y + p[1]]);
  const segs: Seg[] = pts.slice(1).map((p, i) => [pts[i], p]);
  let cost = 0;
  for (const o of obstacles) if (segs.some((sg) => segCrosses(sg[0], sg[1], box(o)))) cost += 100;
  for (const sh of placed) for (const sg of segs) { if (segsAlong(sg, sh)) cost += 10; else if (segsCross(sg, sh)) cost += 1; }
  if (label) {
    const c = labelCenter(pts), lb: Box = { x: c[0] - label.w / 2, y: c[1] - label.h / 2, w: label.w, h: label.h };
    for (const o of obstacles) if (hit(lb, box(o))) cost += 20;
    for (const sh of placed) if (segCrosses(sh[0], sh[1], lb)) cost += 20;
    for (const sc of sections) if (hit(lb, box(sc)) && !contains(box(sc), lb)) cost += 5;
  }
  return cost;
}

/** Ids of the two ends of an arrow in either vocabulary: skeleton start/end, Excalidraw bindings, or leader links to a text kept in customData. */
const endIds = (a: El): [string | undefined, string | undefined] => [a.start?.id ?? a.startBinding?.elementId ?? a.customData?.leaderStart, a.end?.id ?? a.endBinding?.elementId ?? a.customData?.leaderEnd];

/** Obstacles among converted elements: nodes, free texts, and the bound labels of arrows and sections (a label inside a node is covered by the node). */
function obstaclesOf(live: El[]): El[] {
  const byId = new Map(live.map((e) => [e.id, e]));
  const owner = (e: El) => (e.containerId ? byId.get(e.containerId) : undefined);
  return [...live.filter(isObstacle), ...live.filter((e) => e.type === "text" && e.containerId && (owner(e)?.type === "arrow" || (owner(e) && isSection(owner(e)))))];
}

/** A bound label as an obstacle box before conversion: centered on (cx, cy), estimated size. `containerId` names the owner so its own arrow ignores it. */
const labelBox = (ownerId: string, label: El, cx: number, cy: number): El => {
  const w = textWidth(label.text, label.fontSize ?? 20), h = String(label.text).split("\n").length * (label.fontSize ?? 20) * 1.25;
  return { id: `${ownerId}:label`, type: "text", containerId: ownerId, x: cx - w / 2, y: cy - h / 2, width: w, height: h };
};

/** One bound arrow as the router sees it, whichever vocabulary it came from. */
type Edge = { a: El; s: El; t: El; elbowed: boolean; dotEnd: boolean; label: { w: number; h: number } | null };
/** What a route is scored against: nodes it must not run through, sections whose border a label must not straddle, segments of arrows already placed. */
type Field = { obstacles: El[]; sections: El[]; placed: Seg[] };

/**
 * The two vocabularies meet here. A skeleton arrow carries its label inline (estimated width); a scene arrow's label is a bound text in
 * `labels` (measured width). An arrow whose ends are missing or unplaced is not routed.
 */
function edgeOf(a: El, byId: Map<string, El>, labels: Map<string, El>): Edge | null {
  const [sid, tid] = endIds(a);
  const s = sid ? byId.get(sid) : undefined, t = tid ? byId.get(tid) : undefined;
  if (!s || s.x == null || !t || t.x == null) return null;
  const bound = labels.get(a.id);
  const label = bound ? { w: box(bound).w, h: bound.height } : a.label?.text ? { w: textWidth(a.label.text, a.label.fontSize ?? 20), h: 24 } : null;
  return { a, s, t, elbowed: !!a.elbowed, dotEnd: a.endArrowhead === "dot", label };
}

/**
 * Attach points and shape of a bound arrow. Straight edge to edge unless elbowed; ends whose centers are off on both axes are elbowed
 * (no diagonals). An elbow tries a z-route on the dominant axis, the two single-bend routes and the other z-route, and takes the cheapest
 * (shapes it runs through, then arrows it runs along or crosses, then where its label lands); ties go to the first.
 * ponytail: four candidates, no channel routing; Excalidraw re-routes on the first drag.
 */
function routeEdge(edge: Edge, f: Field): Route {
  const { s, t, dotEnd, label } = edge;
  const w = (e: El) => e.width ?? 100, h = (e: El) => e.height ?? 100;
  const cx = (e: El) => e.x + w(e) / 2, cy = (e: El) => e.y + h(e) / 2;
  const gap = 6, endGap = dotEnd ? 12 : gap; // a dot head needs room or it sits on the target
  const others = f.obstacles.filter((o) => o.containerId !== edge.a.id); // own ends stay: a route through the body of its own end costs like any node
  const dx = cx(t) - cx(s), dy = cy(t) - cy(s);
  const elbowed = edge.elbowed || (Math.abs(dx) > 24 && Math.abs(dy) > 24);
  // a text leaves and enters through the side that faces the other end, never through its own glyphs
  const textPort = (e: El, o: El, g: number): [number, number] => {
    const ddx = cx(o) - cx(e), ddy = cy(o) - cy(e), { gx, gy } = gaps(e, o);
    return gx >= gy ? [ddx > 0 ? e.x + w(e) + g : e.x - g, cy(e)] : [cx(e), ddy > 0 ? e.y + h(e) + g : e.y - g];
  };
  if (!elbowed) {
    const p1 = s.type === "text" ? textPort(s, t, gap) : edgePoint(s, cx(s), cy(s), cx(t), cy(t), gap);
    const p2 = t.type === "text" ? textPort(t, s, endGap) : edgePoint(t, cx(t), cy(t), cx(s), cy(s), endGap);
    const straight: Route = { p1, p2, kind: "straight" };
    if (!label) return straight;
    // a straight line with a collinear middle point: same line, label at 30 or 70 percent instead of the midpoint
    const ldx = straight.p2[0] - straight.p1[0], ldy = straight.p2[1] - straight.p1[1];
    const slid: Route[] = Math.abs(ldy) <= 2 ? [{ ...straight, kind: "zh", frac: 0.3 }, { ...straight, kind: "zh", frac: 0.7 }] : Math.abs(ldx) <= 2 ? [{ ...straight, kind: "zv", frac: 0.3 }, { ...straight, kind: "zv", frac: 0.7 }] : [];
    const cands = [straight, ...slid];
    const costs = cands.map((r) => routeCost(r, others, f.placed, label, f.sections));
    return cands[costs.indexOf(Math.min(...costs))];
  }
  const sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
  const sideX = (e: El, sign: number, g: number): number => (sign > 0 ? e.x + w(e) + g : e.x - g);
  const sideY = (e: El, sign: number, g: number): number => (sign > 0 ? e.y + h(e) + g : e.y - g);
  const zh: Route = { p1: [sideX(s, sx, gap), cy(s)], p2: [sideX(t, -sx, endGap), cy(t)], kind: "zh", elbowed: true };
  const zv: Route = { p1: [cx(s), sideY(s, sy, gap)], p2: [cx(t), sideY(t, -sy, endGap)], kind: "zv", elbowed: true };
  const lv: Route = { p1: [cx(s), sideY(s, sy, gap)], p2: [sideX(t, -sx, endGap), cy(t)], kind: "lv", elbowed: true }; // down, then into the side
  const lh: Route = { p1: [sideX(s, sx, gap), cy(s)], p2: [cx(t), sideY(t, -sy, endGap)], kind: "lh", elbowed: true }; // sideways, then into top or bottom
  const bends = (z: Route) => [z, { ...z, frac: 0.3 }, { ...z, frac: 0.7 }]; // a z-route can bend early or late to dodge another arrow
  const { gx, gy } = gaps(s, t);
  const order = gx >= gy ? [...bends(zh), lh, lv, ...bends(zv)] : [...bends(zv), lv, lh, ...bends(zh)];
  const costs = order.map((r) => routeCost(r, others, f.placed, label, f.sections));
  return order[costs.indexOf(Math.min(...costs))];
}

/** Arrows that attach to the same side of one shape are spread 24 px apart along that side, so heads and labels do not stack. */
function fan(routed: { e: Edge; r: Route }[]) {
  const side = (e: El, p: [number, number]) => {
    const d: [string, number][] = [["l", Math.abs(p[0] - e.x)], ["r", Math.abs(p[0] - (e.x + (e.width ?? 100)))], ["t", Math.abs(p[1] - e.y)], ["b", Math.abs(p[1] - (e.y + (e.height ?? 100)))]];
    return d.sort((x, y) => x[1] - y[1])[0][0];
  };
  const groups = new Map<string, { r: Route; key: "p1" | "p2"; e: El; other: [number, number]; label: number }[]>();
  for (const { e, r } of routed) {
    const label = e.label?.w ?? 0; // estimate; the spacing pass measures the real width later
    for (const [key, n, other] of [["p1", e.s, r.p2], ["p2", e.t, r.p1]] as ["p1" | "p2", El, [number, number]][]) {
      const k = `${n.id}:${side(n, r[key])}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push({ r, key, e: n, other, label });
    }
  }
  for (const [k, g] of groups) {
    if (g.length < 2) continue;
    const alongY = k.endsWith(":l") || k.endsWith(":r");
    g.sort((m, n) => (alongY ? m.other[1] - n.other[1] : m.other[0] - n.other[0])); // keep lines from crossing each other
    // labels of parallel arrows sit side by side: spread by the widest label when the side is horizontal, else 24 px
    const want = alongY ? 24 : Math.max(24, ...g.map((m) => m.label));
    const e = g[0].e, len = alongY ? e.height ?? 100 : e.width ?? 100, step = Math.min(want, (len - 24) / (g.length - 1));
    const center = alongY ? e.y + len / 2 : e.x + len / 2;
    g.forEach((m, i) => { const v = center + (i - (g.length - 1) / 2) * step; m.r[m.key] = alongY ? [m.r[m.key][0], v] : [v, m.r[m.key][1]]; });
  }
}

/**
 * After update_elements moves or resizes shapes, arrows bound to them keep stale endpoints (Excalidraw only re-routes on user drags).
 * Re-route every arrow bound to a touched element and recenter its label. Untouched arrows keep their points and count as obstacles.
 */
export function followBindings(els: El[], touched: Set<string>): El[] {
  const byId = new Map(els.map((e) => [e.id, e]));
  const moved = new Map<string, El>();
  // a shape's own label stays centered in it
  for (const id of touched) {
    const c = byId.get(id);
    if (!c || !SHAPES.has(c.type)) continue;
    for (const b of c.boundElements ?? []) {
      const label = b.type === "text" && byId.get(b.id);
      if (label) moved.set(label.id, newElementWith(label, { x: c.x + (c.width - label.width) / 2, y: c.y + (c.height - label.height) / 2 }));
    }
  }
  const live = els.filter((e) => !e.isDeleted);
  const labels = new Map<string, El>(live.filter((e) => e.type === "text" && e.containerId).map((e) => [e.containerId, e]));
  const field: Field = { obstacles: obstaclesOf(live), sections: live.filter((e) => SHAPES.has(e.type) && isSection(e)), placed: [] };
  const arrows = live.filter((a) => a.type === "arrow");
  const redo = arrows.filter((a) => endIds(a).some((id) => id && touched.has(id)));
  for (const a of arrows) if (!redo.includes(a) && a.points) field.placed.push(...segsOf(a));
  for (const a of redo) {
    const edge = edgeOf(a, byId, labels);
    if (!edge) continue;
    const r = routeEdge(edge, field), g = geometry(r);
    field.placed.push(...segsOf(g));
    const next = newElementWith(a, { ...g, fixedSegments: null, ...(r.elbowed && !a.elbowed && { elbowed: true }) }); // new points: a segment the user fixed on the old route is stale
    moved.set(a.id, next);
    const label = labels.get(a.id);
    if (label) moved.set(label.id, centerLabel(next, label));
  }
  // an arrow moved directly (its own x/y/points in the update) or one whose route failed keeps its label at the old spot: recenter it
  for (const a of arrows) {
    const label = labels.get(a.id);
    if (!label || moved.has(label.id) || !(touched.has(a.id) || redo.includes(a))) continue;
    moved.set(label.id, centerLabel(moved.get(a.id) ?? a, label));
  }
  return moved.size ? els.map((e) => moved.get(e.id) ?? e) : els;
}

/** An arrow's bound text sits on the midpoint of its middle segment. */
function centerLabel(a: El, label: El): El {
  const pts = a.points, m = pts[Math.floor((pts.length - 1) / 2)], n = pts[Math.ceil((pts.length - 1) / 2)];
  return newElementWith(label, { x: a.x + (m[0] + n[0]) / 2 - label.width / 2, y: a.y + (m[1] + n[1]) / 2 - label.height / 2 });
}

/** A bound text lives in its container's frame; the converter creates it without one, so it would sit outside the diagram. */
export function labelsFollowFrames(els: El[]): El[] {
  const byId = new Map(els.map((e) => [e.id, e]));
  return els.map((t) => {
    const c = t.type === "text" && t.containerId ? byId.get(t.containerId) : undefined;
    return c && (c.frameId ?? null) !== (t.frameId ?? null) ? newElementWith(t, { frameId: c.frameId ?? null }) : t;
  });
}

function spaceForLabels(skeleton: El[]): El[] {
  // convertToExcalidrawElements may touch its input and random ids differ per run: pin ids, rebuild from a clone each pass
  const base: El[] = structuredClone(skeleton);
  base.forEach((e, i) => { if (!e.id) e.id = `el-${Date.now().toString(36)}-${i}`; });
  // Excalidraw relocates a text that is given as a binding target (it parks it at the arrow's start): keep such links in customData and route them here
  const textIds = new Set(base.filter((e) => e.type === "text").map((e) => e.id));
  for (const a of base) {
    if (a.type !== "arrow") continue;
    if (a.start?.id && textIds.has(a.start.id)) { a.customData = { ...(a.customData ?? {}), leaderStart: a.start.id }; delete a.start; }
    if (a.end?.id && textIds.has(a.end.id)) { a.customData = { ...(a.customData ?? {}), leaderEnd: a.end.id }; delete a.end; }
  }
  const off = base.map(() => ({ x: 0, y: 0 }));
  const build = () => {
    const sk: El[] = structuredClone(base).map((e: El, i: number) => ({ ...e, ...(e.x != null && { x: e.x + off[i].x }), ...(e.y != null && { y: e.y + off[i].y }) }));
    const byId = new Map(sk.map((e) => [e.id, e]));
    // an arrow bound at both ends gets a fresh edge-to-edge line each pass (the converter keeps the points we give)
    const field: Field = { obstacles: sk.filter(isObstacle), sections: sk.filter((e) => SHAPES.has(e.type) && e.x != null && isSection(e)), placed: [] };
    // labels do not exist before conversion: a section's label sits at its center, an arrow's label at the label point of its route
    for (const sc of field.sections) {
      if (!sc.label?.text) continue;
      const w = (sc.width ?? 100), half = textWidth(sc.label.text, sc.label.fontSize ?? 20) / 2, align = sc.label.textAlign;
      field.obstacles.push(labelBox(sc.id, sc.label, align === "left" ? sc.x + 5 + half : align === "right" ? sc.x + w - 5 - half : sc.x + w / 2, sc.y + (sc.height ?? 100) / 2));
    }
    const routed: { e: Edge; r: Route }[] = [];
    for (const a of sk) {
      if (a.type !== "arrow") continue;
      const e = edgeOf(a, byId, new Map());
      if (!e) continue;
      const r = routeEdge(e, field);
      if (r.elbowed) a.elbowed = true; // no diagonals: the converter gets an elbowed arrow with our points
      routed.push({ e, r });
      const g = geometry(r);
      field.placed.push(...segsOf(g));
      if (a.label?.text) { const c = labelCenter(g.points.map((p) => [g.x + p[0], g.y + p[1]])); field.obstacles.push(labelBox(a.id, a.label, c[0], c[1])); }
    }
    fan(routed);
    for (const { e, r } of routed) Object.assign(e.a, geometry(r));
    return convertToExcalidrawElements(sk, { regenerateIds: false });
  };
  // the agent gives a free text as a box: left edge x, optional width. Excalidraw anchors a text at its alignment point (center or right
  // edge) and never wraps, so the anchor moves by the box width on the first measured pass and a text wider than its box is wrapped.
  const given = new Map(base.filter((t) => t.type === "text" && !t.containerId && t.width > 0).map((t) => [t.id, t.width as number]));
  let els = build();
  // texts get their measured size on conversion: copy it back so routes and parking see real boxes, then rebuild (twice when a wrap changes the size)
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const b of base) {
      if (b.type !== "text") continue;
      const m = (els as El[]).find((e) => e.id === b.id);
      if (!m) continue;
      if (pass === 0 && !b.containerId && b.x != null) {
        const boxW = given.get(b.id) ?? m.width, k = b.textAlign === "right" ? 1 : b.textAlign === "center" ? 0.5 : 0;
        if (k) { b.x += boxW * k; changed = true; }
        if (given.has(b.id)) { const t = fitText(String(b.text), boxW, String(m.text), m.width); if (t !== b.text) { b.text = t; changed = true; } }
      }
      if (b.width !== m.width || b.height !== m.height) { b.width = m.width; b.height = m.height; changed = true; }
    }
    if (!changed) break;
    els = build();
  }
  for (let iter = 0; iter < 8; iter++) {
    const byId = new Map(els.map((e: El) => [e.id, e]));
    const sects = (els as El[]).filter((e) => SHAPES.has(e.type) && isSection(e));
    const sectionOf = (e: El) => sects.find((sc) => contains(box(sc), box(e)));
    let moved = false;
    for (const a of els as El[]) {
      if (a.type !== "arrow") continue;
      const [sid, tid] = endIds(a);
      if (!sid || !tid) continue;
      const label = (els as El[]).find((t) => t.type === "text" && t.containerId === a.id);
      const s = byId.get(sid), t = byId.get(tid);
      if (!label || !s || !t) continue;
      const horizontal = Math.abs(t.x + t.width / 2 - (s.x + s.width / 2)) >= Math.abs(t.y + t.height / 2 - (s.y + s.height / 2));
      const forward = horizontal ? t.x >= s.x : t.y >= s.y;
      const [near, far] = forward ? [s, t] : [t, s]; // near = upstream on the axis, far = the one we push
      let gap = horizontal ? far.x - (near.x + near.width) : far.y - (near.y + near.height);
      let threshold = horizontal ? far.x : far.y;
      // across a section border the label must fit between the borders: measure from the outer edges and push the far section with everything in it
      const ns = sectionOf(near), fs = sectionOf(far);
      if (ns?.id !== fs?.id) {
        const a = ns ?? near, b = fs ?? far;
        gap = horizontal ? b.x - (a.x + a.width) : b.y - (a.y + a.height);
        threshold = horizontal ? b.x : b.y;
      }
      const lb = box(label), need = (horizontal ? lb.w : lb.h) + 32;
      const touches = hit(lb, box(s)) || hit(lb, box(t)); // a label slid off-center can still lean on a shape
      if (gap >= need && !touches) continue;
      const delta = Math.max(gap < need ? need - gap : 0, touches ? 24 : 0);
      base.forEach((e, i) => {
        if (e.type === "arrow" && !e.points) return; // bound arrows follow their shapes
        const pos = horizontal ? (e.x ?? 0) + off[i].x : (e.y ?? 0) + off[i].y;
        if (pos >= threshold - 1) horizontal ? (off[i].x += delta) : (off[i].y += delta);
      });
      moved = true;
      break; // re-convert before evaluating the next arrow
    }
    if (!moved) break;
    els = build();
  }
  return els;
}

/**
 * Legend strip under a framed diagram: one swatch + label per notation kind used, one sample per arrow style used, focal if present.
 * Built by the app so every diagram carries the same legend and the agent never spends tokens on it.
 * ponytail: label widths come from textWidth; the 40 px item gap absorbs the error.
 */
export function legendFor(els: El[]): El[] {
  const items: El[] = [];
  for (const k of KINDS) if (els.some((e) => classify(e) === k.label)) items.push({ label: k.label, swatch: { type: k.type, backgroundColor: k.color, strokeStyle: k.strokeStyle ?? "solid", strokeWidth: k.strokeWidth ?? 1, ...(k.rounded && { roundness: { type: 3 } }) } });
  if (els.some(isFocal)) items.push({ label: "Focal", swatch: { type: "rectangle", backgroundColor: "transparent", strokeColor: NOTATION.focal.color, strokeWidth: NOTATION.focal.strokeWidth } });
  const arrows = els.filter((e) => e.type === "arrow");
  if (arrows.some((a) => a.strokeStyle === "solid" || !a.strokeStyle)) items.push({ label: "Flow / call", arrow: { strokeStyle: "solid" } });
  if (arrows.some((a) => a.strokeStyle === "dashed" || a.strokeStyle === "dotted")) items.push({ label: "Async / optional / return", arrow: { strokeStyle: "dashed" } });
  if (!items.length) return [];
  const top = els.filter((e) => !e.frameId && !e.containerId && Number.isFinite(e.x));
  const [x1, , x2, y2] = getCommonBounds(top);
  const groupIds = [`${NOTATION.legendGroup}${Date.now().toString(36)}`];
  const text = (x: number, y: number, t: string, fontSize = 14, strokeColor = "#495057") => ({ type: "text", x, y, text: t, fontSize, fontFamily: FONTS.Inter, strokeColor, groupIds });
  const out: El[] = [
    { type: "line", x: x1, y: y2 + 28, width: x2 - x1, height: 0, points: [[0, 0], [x2 - x1, 0]], strokeColor: "#dee2e6", strokeWidth: 1, roughness: 0, groupIds },
    text(x1, y2 + 40, "LEGEND", 12, "#868e96"),
  ];
  let x = x1, y = y2 + 68;
  for (const it of items) {
    const sw = it.swatch ? 28 : 44, w = sw + 8 + textWidth(it.label, 14);
    if (x + w > x2 && x > x1) { x = x1; y += 32; }
    if (it.swatch) out.push({ ...it.swatch, x, y, width: sw, height: 20, fillStyle: "solid", roughness: 0, groupIds });
    else out.push({ type: "arrow", x, y: y + 10, width: sw, height: 0, points: [[0, 0], [sw, 0]], endArrowhead: "triangle", strokeWidth: 1, roughness: 0, groupIds, ...it.arrow });
    out.push(text(x + sw + 8, y + 1, it.label));
    x += w + 40;
  }
  return convertToExcalidrawElements(out, { regenerateIds: true }) as El[];
}

/**
 * Note placement. A free text that lands on a node is parked below the content; a note whose leader would cross a node or a text is
 * moved to the first free side of its target (right, left, below, above). The agent guesses note positions and cannot always see the scene.
 */
function parkNotes(els: El[]): { els: El[]; parked: string[] } {
  const nodes = els.filter((e) => SHAPES.has(e.type) && !isSection(e) && !e.isDeleted);
  const notes = els.filter((t) => t.type === "text" && !t.containerId && !t.isDeleted);
  const placed = els.filter((e) => Number.isFinite(e.x) && !e.isDeleted);
  if (!notes.length || !placed.length) return { els, parked: [] };
  let y = getCommonBounds(placed)[3] + 24;
  const moved = new Map<string, El>();
  for (const t of notes) {
    const on = nodes.find((n) => hit(box(t), box(n)) && !contains(box(n), box(t)));
    if (!on) continue;
    moved.set(t.id, newElementWith(t, { y }));
    y += t.height + 16;
  }
  let out = moved.size ? followBindings(els.map((e) => moved.get(e.id) ?? e), new Set(moved.keys())) : els;
  const solid = obstaclesOf(out.filter((e) => !e.isDeleted));
  const sections = out.filter((e) => !e.isDeleted && SHAPES.has(e.type) && isSection(e));
  const crosses = (a: El, skip: Set<string>) => solid.some((o) => !skip.has(o.id) && segsOf(a).some((sg) => segCrosses(sg[0], sg[1], box(o))));
  // ponytail: four spots at 24 px, no wrapping to fit a lane; a note that fits nowhere keeps its warning for the agent
  const free = (n: El) => !solid.some((o) => o.id !== n.id && hit(box(n), box(o))) && !sections.some((sc) => hit(box(n), box(sc)) && !contains(box(sc), box(n)));
  for (const a of out) {
    if (a.type !== "arrow" || a.endArrowhead !== "dot" || a.isDeleted) continue;
    const [sid, tid] = endIds(a);
    const note = sid && out.find((e) => e.id === sid), target = tid && out.find((e) => e.id === tid);
    if (!note || note.type !== "text" || !target || !crosses(a, new Set([sid, tid]))) continue;
    const pad = 24;
    const my = target.y + (target.height - note.height) / 2, mx = target.x + (target.width - note.width) / 2; // centered on the target, so the leader runs straight
    const spots = [[target.x + target.width + pad, my], [target.x - pad - note.width, my], [mx, target.y + target.height + pad], [mx, target.y - pad - note.height]];
    for (const [nx, ny] of spots) {
      const trial = followBindings(out.map((e) => (e.id === note.id ? newElementWith(e, { x: nx, y: ny }) : e)), new Set([note.id]));
      const n2 = trial.find((e) => e.id === note.id), a2 = trial.find((e) => e.id === a.id);
      if (!free(n2) || crosses(a2, new Set([sid, tid]))) continue;
      out = trial;
      moved.set(note.id, n2);
      break;
    }
  }
  return { els: out, parked: [...moved.keys()] };
}

/** Wrap a converted batch in one frame named `name` (top-level elements only; nested frames keep their children). */
export function wrapInFrame(els: El[], name: string): El[] {
  const top = els.filter((e) => !e.frameId && Number.isFinite(e.x));
  if (!top.length) return els;
  const [x1, y1, x2, y2] = getCommonBounds(top);
  const pad = 32;
  const [frame] = convertToExcalidrawElements([{ type: "frame", name, children: [], x: x1 - pad, y: y1 - pad, width: x2 - x1 + 2 * pad, height: y2 - y1 + 2 * pad } as any], { regenerateIds: true });
  return [frame, ...els.map((e) => (e.frameId ? e : { ...e, frameId: frame.id }))];
}

/** Labels that still intersect a shape they are not bound to - reported back so the agent can fix them. */
function overlapWarnings(els: El[]) {
  const out: string[] = [];
  for (const t of els) {
    if (t.type !== "text") continue;
    for (const e of els) {
      if (e.isDeleted || e.id === t.id || e.id === t.containerId) continue;
      if (e.type === "text") { if (e.id > t.id && hit(box(t), box(e))) out.push(`text "${t.text}" (${t.id}) overlaps text "${e.text}" (${e.id})`); continue; }
      if (!SHAPES.has(e.type) || isSection(e)) continue; // sections are transparent
      if (contains(box(e), box(t))) continue; // ponytail: a text fully inside a shape is a note in a zone, not a collision
      if (hit(box(t), box(e))) out.push(`text "${t.text}" (${t.id}) overlaps ${e.type} ${e.id}`);
    }
  }
  return out;
}

/** True when the segment passes through the inside of the box (shrunk by 4 px, so touching an edge does not count). */
function segCrosses([x1, y1]: number[], [x2, y2]: number[], b: Box): boolean {
  const pad = 4, bx1 = b.x + pad, by1 = b.y + pad, bx2 = b.x + b.w - pad, by2 = b.y + b.h - pad;
  if (bx2 <= bx1 || by2 <= by1) return false;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - bx1], [dx, bx2 - x1], [-dy, y1 - by1], [dy, by2 - y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t1 - t0 > 0.02;
}

const inBox = (p: number[], b: Box) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
type Seg = [number[], number[]];
const segsOf = (a: El): Seg[] => { const pts = a.points.map((p: number[]) => [a.x + p[0], a.y + p[1]]); return pts.slice(1).map((p: number[], i: number) => [pts[i], p] as Seg); };

/** Proper crossing of two segments (shared endpoints and touching do not count). */
function segsCross([a, b]: Seg, [c, d]: Seg): boolean {
  const o = (p: number[], q: number[], r: number[]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

/** Two axis-aligned segments that run along the same line and overlap for more than 24 px (less is a corner artifact). */
function segsAlong([a, b]: Seg, [c, d]: Seg): boolean {
  const flat = (p: number[], q: number[]) => Math.abs(p[1] - q[1]) < 2, tall = (p: number[], q: number[]) => Math.abs(p[0] - q[0]) < 2;
  if (flat(a, b) && flat(c, d) && Math.abs(a[1] - c[1]) < 4) return Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) > 24;
  if (tall(a, b) && tall(c, d) && Math.abs(a[0] - c[0]) < 4) return Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) > 24;
  return false;
}

/** Arrows that run through a node they do not connect, over a text that is not their label, or along another arrow. Sections are transparent. */
function crossingWarnings(els: El[]) {
  const out: string[] = [];
  const arrows = els.filter((a) => a.type === "arrow" && !a.isDeleted);
  for (const a of arrows) {
    const ends = new Set(endIds(a));
    const segs = segsOf(a), first = segs[0][0], last = segs[segs.length - 1][1];
    for (const e of els) {
      if (e.isDeleted || e.id === a.id || isSection(e)) continue;
      if (ends.has(e.id)) { // an elbow's ports sit outside its ends; a leg inside the box means it runs through its own end
        if (a.elbowed && SHAPES.has(e.type) && segs.some((sg) => segCrosses(sg[0], sg[1], box(e)))) out.push(`arrow ${a.id} runs through its own end ${e.type} ${e.id}`);
        continue;
      }
      if (e.type === "text" ? e.containerId === a.id || ends.has(e.containerId) : !SHAPES.has(e.type)) continue;
      const b = box(e);
      if (inBox(first, b) || inBox(last, b)) continue; // the arrow attaches to it
      if (segs.some((sg) => segCrosses(sg[0], sg[1], b))) out.push(`arrow ${a.id} crosses ${e.type} ${e.id}${e.text ? ` "${e.text.slice(0, 24)}"` : ""}`);
    }
    for (const o of arrows) if (o.id > a.id && segs.some((sg) => segsOf(o).some((sh) => segsAlong(sg, sh)))) out.push(`arrow ${a.id} runs along arrow ${o.id}`);
  }
  return out;
}

/** Overlap and crossing warnings for converted elements: a fresh batch, a Mermaid result, or a frame read from the scene. */
export const inspect = (els: El[]): string[] => [...overlapWarnings(els), ...crossingWarnings(els)];

/** Skeleton in; placed-ready elements, parked note ids and warnings out. */
export function layout(skeleton: El[], opts: { frame?: string } = {}): { elements: El[]; parked: string[]; warnings: string[] } {
  // Excalidraw crashes with a bare TypeError when an arrow binds to an arrow or line; say it plainly instead
  const byId = new Map<string, El>(skeleton.map((e) => [e.id, e]));
  for (const e of skeleton) for (const side of ["start", "end"] as const) {
    const target = e[side]?.id && byId.get(e[side].id);
    if (target && (target.type === "arrow" || target.type === "line")) throw new Error(`${e.type} ${e.id} cannot bind its ${side} to ${target.type} ${target.id}; bind to a shape or text, or give x/y/points`);
  }
  const park = parkNotes(spaceForLabels(withDefaultFont(skeleton)));
  let els = park.els;
  const notation = notationWarnings(els, { framed: !!opts.frame });
  if (opts.frame) els = wrapInFrame([...els, ...legendFor(els)], String(opts.frame));
  return { elements: els, parked: park.parked, warnings: [...inspect(els), ...notation] };
}
