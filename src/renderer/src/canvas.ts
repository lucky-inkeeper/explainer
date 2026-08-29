import { CaptureUpdateAction, FONT_FAMILY, convertToExcalidrawElements, getCommonBounds, getVisibleSceneBounds, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import { FOCAL, KINDS } from "../../shared/tools";

/** Web fonts (Google Fonts, loaded in index.html) registered as extra Excalidraw font ids. Excalidraw resolves the id to the family name for canvas drawing and measuring. */
export const FONTS = { "Playpen Sans": 101, Inter: 102 } as const;
export const DEFAULT_FONT = FONTS["Playpen Sans"];
Object.assign(FONT_FAMILY, FONTS);

/** Apply the default font to skeleton text and labels that do not name one. */
const withDefaultFont = (skeleton: El[]): El[] =>
  skeleton.map((e) => {
    const out = { ...e };
    if (e.type === "text" && !e.fontFamily) out.fontFamily = DEFAULT_FONT;
    if (e.label && !e.label.fontFamily) out.label = { ...e.label, fontFamily: DEFAULT_FONT };
    return out;
  });
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

// ponytail: excalidraw element types live in scattered subpaths; loose typing here, excalidraw validates at runtime
type El = any;
const r = (n: number) => Math.round(n);

export const compact = (el: El) => ({
  id: el.id, type: el.type, x: r(el.x), y: r(el.y), width: r(el.width), height: r(el.height),
  ...(el.text !== undefined && { text: el.text }),
  ...(el.angle ? { angle: +el.angle.toFixed(2) } : {}),
  strokeColor: el.strokeColor,
  ...(el.backgroundColor !== "transparent" && { backgroundColor: el.backgroundColor }),
  ...(el.containerId && { containerId: el.containerId }),
  ...(el.boundElements?.length && { boundElements: el.boundElements }),
  ...(el.startBinding && { start: el.startBinding.elementId }),
  ...(el.endBinding && { end: el.endBinding.elementId }),
  ...(el.groupIds?.length && { groupIds: el.groupIds }),
  ...(el.frameId && { frameId: el.frameId }),
  ...(el.link && { link: el.link }),
  ...(el.type === "frame" && { name: el.name }),
  ...(el.type === "image" && { fileId: el.fileId }),
});

const GAP = 120;

/** Shift a batch of fresh elements into free space. */
function place(api: ExcalidrawImperativeAPI, els: El[], mode: string, selectedIds: string[]) {
  if (mode === "exact" || !els.length) return els;
  const scene = api.getSceneElements();
  const sel = scene.filter((e) => selectedIds.includes(e.id));
  const [nx, ny] = getCommonBounds(els);
  let tx: number, ty: number;
  if (sel.length && (mode === "selection" || mode === "auto" || !mode)) { const [, y1, x2] = getCommonBounds(sel); tx = x2 + GAP; ty = y1; }
  else if (scene.length) { const [, y1, x2] = getCommonBounds(scene); tx = x2 + GAP; ty = y1; }
  else { const [vx, vy] = getVisibleSceneBounds(api.getAppState()); tx = vx + 80; ty = vy + 80; }
  const dx = tx - nx, dy = ty - ny;
  return els.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
}

/** A frame given only `children` converts with no bounds: fit it around them. */
function fitFrames(els: El[]): El[] {
  return els.map((f) => {
    if (f.type !== "frame" || (Number.isFinite(f.x) && Number.isFinite(f.y) && f.width > 0)) return f;
    const kids = els.filter((e) => e.frameId === f.id && Number.isFinite(e.x));
    if (!kids.length) return f;
    const [x1, y1, x2, y2] = getCommonBounds(kids);
    return { ...f, x: x1 - 24, y: y1 - 24, width: x2 - x1 + 48, height: y2 - y1 + 48 };
  });
}

function add(api: ExcalidrawImperativeAPI, rawEls: El[], mode: string, selectedIds: string[]) {
  const els = fitFrames(rawEls);
  const bad = els.filter((e) => ![e.x, e.y, e.width, e.height].every(Number.isFinite));
  if (bad.length) throw new Error(`invalid geometry on ${bad.map((e) => `${e.id} (${e.type})`).join(", ")}; every element needs numeric x, y, width, height`);
  const live = new Set(api.getSceneElements().map((e) => e.id));
  const dup = els.filter((e) => live.has(e.id)).map((e) => e.id);
  if (dup.length) throw new Error(`ids already exist on canvas: ${dup.join(", ")}. Use update_elements or pick new ids.`);
  const placed = place(api, els, mode, selectedIds);
  const incoming = new Set(placed.map((e) => e.id));
  // a deleted element may be re-created under the same id: drop the tombstone so ids stay unique
  const base = api.getSceneElementsIncludingDeleted().filter((e) => !(e.isDeleted && incoming.has(e.id)));
  api.updateScene({ elements: growFrames([...base, ...placed]), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  api.scrollToContent(placed, { fitToContent: true, animate: true, duration: 300 });
  return { created: placed.map((e) => ({ id: e.id, type: e.type, x: r(e.x), y: r(e.y) })) };
}

type Box = { x: number; y: number; w: number; h: number };
/** Geometry box; an arrow label gets the box of its visible text (Excalidraw pads labels to 11 x font size). */
const box = (e: El): Box => {
  if (e.type === "text" && e.containerId && e.text) {
    const w = Math.min(e.width, Math.max(...String(e.text).split("\n").map((l: string) => l.length)) * (e.fontSize ?? 16) * 0.6 + 8);
    return { x: e.x + (e.width - w) / 2, y: e.y, w, h: e.height };
  }
  return { x: e.x, y: e.y, w: e.width, h: e.height };
};
const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const hit = (a: Box, b: Box, pad = 2) => a.x + a.w > b.x + pad && b.x + b.w > a.x + pad && a.y + a.h > b.y + pad && b.y + b.h > a.y + pad;
const SHAPES = new Set(["rectangle", "ellipse", "diamond", "image"]);

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

type Route = { p1: [number, number]; p2: [number, number]; kind: "straight" | "zh" | "zv" | "lv" | "lh"; frac?: number };

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

const isSection = (e: El) => (e.backgroundColor ?? "").toLowerCase() === "#f8f9fa";

/** Where Excalidraw puts an arrow label: the middle point of an odd path (the corner), else the midpoint of the middle segment. */
function labelCenter(pts: number[][]): number[] {
  if (pts.length % 2 === 1) return pts[Math.floor(pts.length / 2)];
  const i = pts.length / 2 - 1;
  return [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
}

/**
 * Route cost: 100 per shape it runs through (other than its own two ends), 10 per arrow it runs along, 1 per arrow it crosses,
 * 20 when its label would sit on a node, 5 when the label would straddle a section border.
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
    for (const sc of sections) if (hit(lb, box(sc)) && !contains(box(sc), lb)) cost += 5;
  }
  return cost;
}

/**
 * Attach points and shape of a bound arrow. Straight edge to edge unless `elbowed`. An elbow tries a z-route on the dominant
 * axis, the two single-bend routes and the other z-route, and takes the cheapest (shapes it runs through, then arrows it runs
 * along or crosses); ties go to the first. ponytail: four candidates, no channel routing; Excalidraw re-routes on the first drag.
 */
function ports(a: El, s: El, t: El, obstacles: El[] = [], placed: Seg[] = [], sections: El[] = []): Route {
  const w = (e: El) => e.width ?? 100, h = (e: El) => e.height ?? 100;
  const cx = (e: El) => e.x + w(e) / 2, cy = (e: El) => e.y + h(e) / 2;
  const gap = 6, endGap = a.endArrowhead === "dot" ? 12 : gap; // a dot head needs room or it sits on the target
  // a text leaves and enters through the side that faces the other end, never through its own glyphs
  const textPort = (e: El, o: El, g: number): [number, number] => {
    const ddx = cx(o) - cx(e), ddy = cy(o) - cy(e), { gx, gy } = gaps(e, o);
    return gx >= gy ? [ddx > 0 ? e.x + w(e) + g : e.x - g, cy(e)] : [cx(e), ddy > 0 ? e.y + h(e) + g : e.y - g];
  };
  if (!a.elbowed) {
    const p1 = s.type === "text" ? textPort(s, t, gap) : edgePoint(s, cx(s), cy(s), cx(t), cy(t), gap);
    const p2 = t.type === "text" ? textPort(t, s, endGap) : edgePoint(t, cx(t), cy(t), cx(s), cy(s), endGap);
    const straight: Route = { p1, p2, kind: "straight" };
    if (!a.label?.text) return straight;
    // a straight line with a collinear middle point: same line, label at 30 or 70 percent instead of the midpoint
    const dx = straight.p2[0] - straight.p1[0], dy = straight.p2[1] - straight.p1[1];
    const slid: Route[] = Math.abs(dy) <= 2 ? [{ ...straight, kind: "zh", frac: 0.3 }, { ...straight, kind: "zh", frac: 0.7 }] : Math.abs(dx) <= 2 ? [{ ...straight, kind: "zv", frac: 0.3 }, { ...straight, kind: "zv", frac: 0.7 }] : [];
    const cands = [straight, ...slid], label = { w: String(a.label.text).length * (a.label.fontSize ?? 20) * 0.6 + 8, h: 24 };
    const costs = cands.map((r) => routeCost(r, obstacles.filter((o) => o.id !== s.id && o.id !== t.id), placed, label, sections));
    return cands[costs.indexOf(Math.min(...costs))];
  }
  const dx = cx(t) - cx(s), dy = cy(t) - cy(s), sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
  const sideX = (e: El, sign: number, g: number): number => (sign > 0 ? e.x + w(e) + g : e.x - g);
  const sideY = (e: El, sign: number, g: number): number => (sign > 0 ? e.y + h(e) + g : e.y - g);
  const zh: Route = { p1: [sideX(s, sx, gap), cy(s)], p2: [sideX(t, -sx, endGap), cy(t)], kind: "zh" };
  const zv: Route = { p1: [cx(s), sideY(s, sy, gap)], p2: [cx(t), sideY(t, -sy, endGap)], kind: "zv" };
  const lv: Route = { p1: [cx(s), sideY(s, sy, gap)], p2: [sideX(t, -sx, endGap), cy(t)], kind: "lv" }; // down, then into the side
  const lh: Route = { p1: [sideX(s, sx, gap), cy(s)], p2: [cx(t), sideY(t, -sy, endGap)], kind: "lh" }; // sideways, then into top or bottom
  const bends = (z: Route) => [z, { ...z, frac: 0.3 }, { ...z, frac: 0.7 }]; // a z-route can bend early or late to dodge another arrow
  const { gx, gy } = gaps(s, t);
  const order = gx >= gy ? [...bends(zh), lh, lv, ...bends(zv)] : [...bends(zv), lv, lh, ...bends(zh)];
  const others = obstacles.filter((o) => o.id !== s.id && o.id !== t.id);
  const label = a.label?.text ? { w: String(a.label.text).length * (a.label.fontSize ?? 20) * 0.6 + 8, h: 24 } : null; // estimate; measured later by the spacing pass
  const costs = order.map((r) => routeCost(r, others, placed, label, sections));
  return order[costs.indexOf(Math.min(...costs))];
}

const route = (a: El, s: El, t: El, obstacles: El[] = []) => geometry(ports(a, s, t, obstacles));

/** Arrows that attach to the same side of one shape are spread 24 px apart along that side, so heads and labels do not stack. */
function fan(routed: { a: El; r: Route; s: El; t: El }[]) {
  const side = (e: El, p: [number, number]) => {
    const d: [string, number][] = [["l", Math.abs(p[0] - e.x)], ["r", Math.abs(p[0] - (e.x + (e.width ?? 100)))], ["t", Math.abs(p[1] - e.y)], ["b", Math.abs(p[1] - (e.y + (e.height ?? 100)))]];
    return d.sort((x, y) => x[1] - y[1])[0][0];
  };
  const groups = new Map<string, { r: Route; key: "p1" | "p2"; e: El; other: [number, number]; label: number }[]>();
  for (const { a, r, s, t } of routed) {
    const label = a.label?.text ? String(a.label.text).length * (a.label.fontSize ?? 20) * 0.6 + 8 : 0; // estimate; the spacing pass measures the real width later
    for (const [key, e, other] of [["p1", s, r.p2], ["p2", t, r.p1]] as ["p1" | "p2", El, [number, number]][]) {
      const k = `${e.id}:${side(e, r[key])}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push({ r, key, e, other, label });
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
 * Re-route every arrow bound at both ends to a touched element and recenter its label.
 */
function followBindings(els: El[], touched: Set<string>): El[] {
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
  for (const a of els) {
    if (a.type !== "arrow") continue;
    const [sid, tid] = endIds(a);
    if (!sid || !tid) continue;
    const s = byId.get(sid), t = byId.get(tid);
    if (!s || !t || !(touched.has(s.id) || touched.has(t.id))) continue;
    const next = newElementWith(a, route(a, s, t, els.filter((e) => SHAPES.has(e.type) && !e.isDeleted && !isSection(e))));
    moved.set(a.id, next);
    const label = els.find((e) => e.type === "text" && e.containerId === a.id);
    if (label) {
      const pts = next.points, m = pts[Math.floor((pts.length - 1) / 2)], n = pts[Math.ceil((pts.length - 1) / 2)];
      moved.set(label.id, newElementWith(label, { x: next.x + (m[0] + n[0]) / 2 - label.width / 2, y: next.y + (m[1] + n[1]) / 2 - label.height / 2 }));
    }
  }
  return moved.size ? els.map((e) => moved.get(e.id) ?? e) : els;
}

/** Ids of the two ends of an arrow: Excalidraw bindings, or leader links to a text kept in customData. */
const endIds = (a: El): [string | undefined, string | undefined] => [a.startBinding?.elementId ?? a.customData?.leaderStart, a.endBinding?.elementId ?? a.customData?.leaderEnd];

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
    const routed: { a: El; r: Route; s: El; t: El }[] = [];
    const placed: Seg[] = [];
    const obstacles = sk.filter((e) => SHAPES.has(e.type) && e.x != null && !isSection(e));
    const sections = sk.filter((e) => SHAPES.has(e.type) && e.x != null && isSection(e));
    for (const a of sk) {
      if (a.type !== "arrow") continue;
      const sid = a.start?.id ?? a.customData?.leaderStart, tid = a.end?.id ?? a.customData?.leaderEnd;
      if (!sid || !tid) continue;
      const s = byId.get(sid), t = byId.get(tid);
      if (!s || s.x == null || !t || t.x == null) continue;
      // no diagonals: ends whose centers are off on both axes get a right-angle route
      const c = (e: El) => [e.x + (e.width ?? 100) / 2, e.y + (e.height ?? 100) / 2];
      const [sx, sy] = c(s), [tx, ty] = c(t);
      if (!a.elbowed && Math.abs(tx - sx) > 24 && Math.abs(ty - sy) > 24) a.elbowed = true;
      const r = ports(a, s, t, obstacles, placed, sections);
      routed.push({ a, r, s, t });
      const g = geometry(r), pts = g.points.map((p) => [g.x + p[0], g.y + p[1]]);
      placed.push(...pts.slice(1).map((p, i) => [pts[i], p] as Seg));
    }
    fan(routed);
    for (const { a, r } of routed) Object.assign(a, geometry(r));
    return convertToExcalidrawElements(sk, { regenerateIds: false });
  };
  let els = build();
  // texts get their measured size on conversion: copy it back so routes and parking see real boxes, then rebuild once
  let measured = false;
  for (const b of base) {
    if (b.type !== "text" || b.width) continue;
    const m = (els as El[]).find((e) => e.id === b.id);
    if (m) { b.width = m.width; b.height = m.height; measured = true; }
  }
  if (measured) els = build();
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
 * ponytail: label widths are estimated (7.5 px per char at 14 px Inter); the 40 px item gap absorbs the error.
 */
function legendFor(els: El[]): El[] {
  const lc = (c?: string) => (c ?? "").toLowerCase();
  const items: El[] = [];
  // match on color only: Mermaid renders a stadium as a rounded rectangle, not an ellipse
  for (const k of KINDS) if (els.some((e) => SHAPES.has(e.type) && lc(e.backgroundColor) === k.color)) items.push({ label: k.label, swatch: { type: k.type, backgroundColor: k.color, strokeStyle: k.strokeStyle ?? "solid", strokeWidth: k.strokeWidth ?? 1, ...(k.rounded && { roundness: { type: 3 } }) } });
  if (els.some((e) => SHAPES.has(e.type) && lc(e.strokeColor) === FOCAL)) items.push({ label: "Focal", swatch: { type: "rectangle", backgroundColor: "transparent", strokeColor: FOCAL, strokeWidth: 2 } });
  const arrows = els.filter((e) => e.type === "arrow");
  if (arrows.some((a) => a.strokeStyle === "solid" || !a.strokeStyle)) items.push({ label: "Flow / call", arrow: { strokeStyle: "solid" } });
  if (arrows.some((a) => a.strokeStyle === "dashed" || a.strokeStyle === "dotted")) items.push({ label: "Async / optional / return", arrow: { strokeStyle: "dashed" } });
  if (!items.length) return [];
  const top = els.filter((e) => !e.frameId && !e.containerId && Number.isFinite(e.x));
  const [x1, , x2, y2] = getCommonBounds(top);
  const groupIds = [`legend-${Date.now().toString(36)}`];
  const text = (x: number, y: number, t: string, fontSize = 14, strokeColor = "#495057") => ({ type: "text", x, y, text: t, fontSize, fontFamily: FONTS.Inter, strokeColor, groupIds });
  const out: El[] = [
    { type: "line", x: x1, y: y2 + 28, width: x2 - x1, height: 0, points: [[0, 0], [x2 - x1, 0]], strokeColor: "#dee2e6", strokeWidth: 1, roughness: 0, groupIds },
    text(x1, y2 + 40, "LEGEND", 12, "#868e96"),
  ];
  let x = x1, y = y2 + 68;
  for (const it of items) {
    const sw = it.swatch ? 28 : 44, w = sw + 8 + it.label.length * 7.5;
    if (x + w > x2 && x > x1) { x = x1; y += 32; }
    if (it.swatch) out.push({ ...it.swatch, x, y, width: sw, height: 20, fillStyle: "solid", roughness: 0, groupIds });
    else out.push({ type: "arrow", x, y: y + 10, width: sw, height: 0, points: [[0, 0], [sw, 0]], endArrowhead: "triangle", strokeWidth: 1, roughness: 0, groupIds, ...it.arrow });
    out.push(text(x + sw + 8, y + 1, it.label));
    x += w + 40;
  }
  return convertToExcalidrawElements(out, { regenerateIds: true }) as El[];
}

/** A frame clips its children; when the agent moves or adds a child past the edge, grow the frame (never shrink). */
function growFrames(els: El[]): El[] {
  const grown = new Map<string, El>();
  for (const f of els) {
    if (f.type !== "frame" || f.isDeleted) continue;
    const kids = els.filter((e) => e.frameId === f.id && !e.isDeleted);
    if (!kids.length) continue;
    const [x1, y1, x2, y2] = getCommonBounds(kids);
    const pad = 32, nx = Math.min(f.x, x1 - pad), ny = Math.min(f.y, y1 - pad), nx2 = Math.max(f.x + f.width, x2 + pad), ny2 = Math.max(f.y + f.height, y2 + pad);
    if (nx !== f.x || ny !== f.y || nx2 !== f.x + f.width || ny2 !== f.y + f.height) grown.set(f.id, newElementWith(f, { x: nx, y: ny, width: nx2 - nx, height: ny2 - ny }));
  }
  return grown.size ? els.map((e) => grown.get(e.id) ?? e) : els;
}

/** A free text that lands on a node is parked below the content; the agent guesses note positions and cannot always see the scene. */
function parkNotes(els: El[]): { els: El[]; parked: string[] } {
  const nodes = els.filter((e) => SHAPES.has(e.type) && !isSection(e) && !e.isDeleted);
  const notes = els.filter((t) => t.type === "text" && !t.containerId && !t.isDeleted);
  const placed = els.filter((e) => Number.isFinite(e.x) && !e.isDeleted);
  if (!nodes.length || !notes.length || !placed.length) return { els, parked: [] };
  let y = getCommonBounds(placed)[3] + 24;
  const moved = new Map<string, El>();
  for (const t of notes) {
    const on = nodes.find((n) => hit(box(t), box(n)) && !contains(box(n), box(t)));
    if (!on) continue;
    moved.set(t.id, newElementWith(t, { y }));
    y += t.height + 16;
  }
  if (!moved.size) return { els, parked: [] };
  const out = followBindings(els.map((e) => moved.get(e.id) ?? e), new Set(moved.keys()));
  return { els: out, parked: [...moved.keys()] };
}

/** Wrap a converted batch in one frame named `name` (top-level elements only; nested frames keep their children). */
function wrapInFrame(els: El[], name: string): El[] {
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

/** The agent reuses ids across turns (n1, start...): suffix the ones already on the canvas and repoint references inside the batch. */
function dedupeIds(api: ExcalidrawImperativeAPI, skeleton: El[]): string[] {
  const live = new Set(api.getSceneElements().map((e) => e.id));
  const map = new Map<string, string>();
  for (const e of skeleton) {
    if (!e.id || !live.has(e.id)) continue;
    let n = 2, id = `${e.id}-2`;
    while (live.has(id)) id = `${e.id}-${++n}`;
    map.set(e.id, id);
  }
  if (!map.size) return [];
  const re = (id: string) => map.get(id) ?? id;
  for (const e of skeleton) {
    if (e.id) e.id = re(e.id);
    if (e.frameId) e.frameId = re(e.frameId);
    if (e.start?.id) e.start.id = re(e.start.id);
    if (e.end?.id) e.end.id = re(e.end.id);
    if (Array.isArray(e.children)) e.children = e.children.map(re);
  }
  return [...map].map(([from, to]) => `${from} -> ${to}`);
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

/** Two axis-aligned segments that run along the same line and overlap for more than 8 px. */
function segsAlong([a, b]: Seg, [c, d]: Seg): boolean {
  const flat = (p: number[], q: number[]) => Math.abs(p[1] - q[1]) < 2, tall = (p: number[], q: number[]) => Math.abs(p[0] - q[0]) < 2;
  if (flat(a, b) && flat(c, d) && Math.abs(a[1] - c[1]) < 4) return Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) > 8;
  if (tall(a, b) && tall(c, d) && Math.abs(a[0] - c[0]) < 4) return Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) > 8;
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
      if (e.isDeleted || e.id === a.id || ends.has(e.id) || isSection(e)) continue;
      if (e.type === "text" ? e.containerId === a.id || ends.has(e.containerId) : !SHAPES.has(e.type)) continue;
      const b = box(e);
      if (inBox(first, b) || inBox(last, b)) continue; // the arrow attaches to it
      if (segs.some((sg) => segCrosses(sg[0], sg[1], b))) out.push(`arrow ${a.id} crosses ${e.type} ${e.id}${e.text ? ` "${e.text.slice(0, 24)}"` : ""}`);
    }
    for (const o of arrows) if (o.id > a.id && segs.some((sg) => segsOf(o).some((sh) => segsAlong(sg, sh)))) out.push(`arrow ${a.id} runs along arrow ${o.id}`);
  }
  return out;
}

export async function runCanvasTool(api: ExcalidrawImperativeAPI, tool: string, args: any, selectedIds: string[]) {
  switch (tool) {
    case "draw_elements": {
      // Excalidraw crashes with a bare TypeError when an arrow binds to an arrow or line; say it plainly instead
      const byId = new Map<string, El>((args.elements ?? []).map((e: El) => [e.id, e]));
      for (const e of args.elements ?? []) for (const side of ["start", "end"] as const) {
        const target = e[side]?.id && byId.get(e[side].id);
        if (target && (target.type === "arrow" || target.type === "line")) throw new Error(`${e.type} ${e.id} cannot bind its ${side} to ${target.type} ${target.id}; bind to a shape or text, or give x/y/points`);
      }
      const renamed = dedupeIds(api, args.elements ?? []);
      const park = parkNotes(spaceForLabels(withDefaultFont(args.elements)));
      let els = park.els;
      if (args.frame) els = wrapInFrame([...els, ...legendFor(els)], String(args.frame));
      const res: any = add(api, els, args.placement ?? "auto", selectedIds);
      if (renamed.length) res.renamed = renamed; // ids that were already on the canvas got a suffix; use the new ids from `created`
      if (park.parked.length) res.parked = park.parked.map((id) => `${id} sat on a node; moved below the diagram (its leader follows)`);
      const fresh = api.getSceneElements().filter((e) => res.created.some((c: any) => c.id === e.id));
      const warnings = [...overlapWarnings(fresh), ...crossingWarnings(fresh)];
      return warnings.length ? { ...res, warnings, hint: "Fix with update_elements (move/shrink/reword, or route the arrow around) or delete_elements + redraw." } : res;
    }
    case "draw_mermaid": {
      const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
      // extra keys reach mermaid.initialize(): wider ranks so edge labels fit between nodes
      const { elements, files } = await parseMermaidToExcalidraw(args.definition, { flowchart: { curve: "linear", rankSpacing: 150, nodeSpacing: 70 } } as any);
      if (files) api.addFiles(Object.values(files) as any);
      let els = convertToExcalidrawElements(withDefaultFont(elements as any), { regenerateIds: true });
      if (args.frame) els = wrapInFrame([...els, ...legendFor(els)], String(args.frame));
      return add(api, els, args.placement ?? "auto", selectedIds);
    }
    case "read_canvas": {
      const scene = api.getSceneElements();
      const frames = scene.filter((e) => e.type === "frame").map((f) => ({ id: f.id, name: f.name, elements: scene.filter((e) => e.frameId === f.id).length }));
      let els = args.selection_only ? scene.filter((e) => selectedIds.includes(e.id)) : scene;
      if (args.frame) {
        const f = scene.find((e) => e.type === "frame" && (e.id === args.frame || e.name === args.frame));
        els = f ? els.filter((e) => e.id === f.id || e.frameId === f.id) : [];
      }
      if (Array.isArray(args.ids) && args.ids.length) els = els.filter((e) => args.ids.includes(e.id) || args.ids.includes(e.frameId));
      const scoped = args.selection_only || args.frame || (Array.isArray(args.ids) && args.ids.length);
      if (!scoped && els.length > 150) return { selectedIds, frames, elements: [], hint: `${els.length} elements on the canvas; pass frame (name or id) or ids to read one part` };
      return { selectedIds, frames, elements: els.map(compact) };
    }
    case "update_elements": {
      const updates: El[] = args.updates ?? [];
      const missing = updates.filter((u) => !api.getSceneElements().some((e) => e.id === u.id)).map((u) => u.id);
      if (missing.length) throw new Error(`unknown ids: ${missing.join(", ")}`);
      const next = api.getSceneElementsIncludingDeleted().map((e: El) => {
        const u = updates.find((u) => u.id === e.id);
        if (!u) return e;
        const { id: _id, ...props } = u;
        if (props.text !== undefined && e.type === "text") props.originalText = props.text;
        return newElementWith(e, props);
      });
      const restored = restoreElements(next, null, { refreshDimensions: true, repairBindings: true }) as El[];
      api.updateScene({ elements: growFrames(followBindings(restored, new Set(updates.map((u) => u.id)))), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      return { updated: updates.map((u) => u.id) };
    }
    case "delete_elements": {
      const ids = new Set<string>(args.ids ?? []);
      const scene = api.getSceneElementsIncludingDeleted();
      if (args.frame) {
        const f = scene.find((e) => e.type === "frame" && !e.isDeleted && (e.id === args.frame || (e as El).name === args.frame));
        if (!f) throw new Error(`no frame named or with id "${args.frame}"`);
        ids.add(f.id);
      }
      // a frame is the diagram: deleting it deletes everything inside it, and every element takes its bound label along
      for (const e of scene as El[]) if (e.frameId && ids.has(e.frameId)) ids.add(e.id);
      for (const e of scene as El[]) if (ids.has(e.id)) for (const b of e.boundElements ?? []) if (b.type === "text") ids.add(b.id);
      const next = scene.map((e: El) => (ids.has(e.id) ? newElementWith(e, { isDeleted: true }) : e));
      api.updateScene({ elements: restoreElements(next, null, { repairBindings: true }), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      return { deleted: [...ids] };
    }
    default:
      throw new Error(`unknown tool ${tool}`);
  }
}
