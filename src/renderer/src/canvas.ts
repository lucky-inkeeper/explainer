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
const box = (e: El): Box => ({ x: e.x, y: e.y, w: e.width, h: e.height });
const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const hit = (a: Box, b: Box, pad = 2) => a.x + a.w > b.x + pad && b.x + b.w > a.x + pad && a.y + a.h > b.y + pad && b.y + b.h > a.y + pad;
const SHAPES = new Set(["rectangle", "ellipse", "diamond", "image"]);

/**
 * Bound arrow labels overlap shapes when the arrow is shorter than the label.
 * Fix on the skeleton: push the target shape (and everything beyond it on that axis) until the label fits, then re-convert
 * so Excalidraw re-routes the arrows and recenters labels. ponytail: axis-aligned push only; a real layout engine if diagrams get dense.
 */
/** Point on the boundary of `e` (centre cx,cy) along the ray toward (ox,oy), pushed out by a small gap. */
function edgePoint(e: El, cx: number, cy: number, ox: number, oy: number): [number, number] {
  const dx = ox - cx, dy = oy - cy, hw = (e.width ?? 100) / 2, hh = (e.height ?? 100) / 2;
  if (!dx && !dy) return [cx, cy];
  const ax = Math.abs(dx) / hw, ay = Math.abs(dy) / hh;
  const t = e.type === "ellipse" ? 1 / Math.hypot(ax, ay) : e.type === "diamond" ? 1 / (ax + ay) : 1 / Math.max(ax, ay);
  const len = Math.hypot(dx, dy), gap = 6 / len;
  return [cx + dx * (t + gap), cy + dy * (t + gap)];
}

/**
 * Right-angle route for an `elbowed` arrow: leave and enter through the side that faces the other shape on the dominant axis,
 * one bend pair halfway. Excalidraw keeps the points we give (its router only runs when the user drags).
 * ponytail: no obstacle avoidance; Excalidraw re-routes on the first drag.
 */
function elbowPorts(s: El, t: El): [[number, number], [number, number], [number, number][]] {
  const cx = (e: El) => e.x + (e.width ?? 100) / 2, cy = (e: El) => e.y + (e.height ?? 100) / 2;
  const dx = cx(t) - cx(s), dy = cy(t) - cy(s), gap = 6;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sign = Math.sign(dx) || 1;
    const p1: [number, number] = [sign > 0 ? s.x + (s.width ?? 100) + gap : s.x - gap, cy(s)];
    const p2: [number, number] = [sign > 0 ? t.x - gap : t.x + (t.width ?? 100) + gap, cy(t)];
    const mx = (p2[0] - p1[0]) / 2;
    return [p1, p2, p1[1] === p2[1] ? [] : [[mx, 0], [mx, p2[1] - p1[1]]]];
  }
  const sign = Math.sign(dy) || 1;
  const p1: [number, number] = [cx(s), sign > 0 ? s.y + (s.height ?? 100) + gap : s.y - gap];
  const p2: [number, number] = [cx(t), sign > 0 ? t.y - gap : t.y + (t.height ?? 100) + gap];
  const my = (p2[1] - p1[1]) / 2;
  return [p1, p2, p1[0] === p2[0] ? [] : [[0, my], [p2[0] - p1[0], my]]];
}

/** Geometry for an arrow between two shapes: straight edge to edge, or the elbow route. */
function route(a: El, s: El, t: El) {
  const c = (e: El) => [e.x + (e.width ?? 100) / 2, e.y + (e.height ?? 100) / 2];
  const [sx, sy] = c(s), [tx, ty] = c(t);
  const [p1, p2, mid] = a.elbowed ? elbowPorts(s, t) : [edgePoint(s, sx, sy, tx, ty), edgePoint(t, tx, ty, sx, sy), null];
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  return { x: p1[0], y: p1[1], width: Math.abs(dx), height: Math.abs(dy), points: mid ? [[0, 0], ...mid, [dx, dy]] : [[0, 0], [dx, dy]] };
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
    if (a.type !== "arrow" || !a.startBinding || !a.endBinding) continue;
    const s = byId.get(a.startBinding.elementId), t = byId.get(a.endBinding.elementId);
    if (!s || !t || !(touched.has(s.id) || touched.has(t.id))) continue;
    const next = newElementWith(a, route(a, s, t));
    moved.set(a.id, next);
    const label = els.find((e) => e.type === "text" && e.containerId === a.id);
    if (label) {
      const pts = next.points, m = pts[Math.floor((pts.length - 1) / 2)], n = pts[Math.ceil((pts.length - 1) / 2)];
      moved.set(label.id, newElementWith(label, { x: next.x + (m[0] + n[0]) / 2 - label.width / 2, y: next.y + (m[1] + n[1]) / 2 - label.height / 2 }));
    }
  }
  return moved.size ? els.map((e) => moved.get(e.id) ?? e) : els;
}

function spaceForLabels(skeleton: El[]): El[] {
  // convertToExcalidrawElements may touch its input and random ids differ per run: pin ids, rebuild from a clone each pass
  const base: El[] = structuredClone(skeleton);
  base.forEach((e, i) => { if (!e.id) e.id = `el-${Date.now().toString(36)}-${i}`; });
  const off = base.map(() => ({ x: 0, y: 0 }));
  const build = () => {
    const sk: El[] = structuredClone(base).map((e: El, i: number) => ({ ...e, ...(e.x != null && { x: e.x + off[i].x }), ...(e.y != null && { y: e.y + off[i].y }) }));
    const byId = new Map(sk.map((e) => [e.id, e]));
    // an arrow bound at both ends gets a fresh edge-to-edge line each pass (the converter keeps the points we give)
    for (const a of sk) {
      if (a.type !== "arrow" || !a.start?.id || !a.end?.id) continue;
      const s = byId.get(a.start.id), t = byId.get(a.end.id);
      if (!s || s.x == null || !t || t.x == null) continue;
      Object.assign(a, route(a, s, t));
    }
    return convertToExcalidrawElements(sk, { regenerateIds: false });
  };
  let els = build();
  for (let iter = 0; iter < 8; iter++) {
    const byId = new Map(els.map((e: El) => [e.id, e]));
    let moved = false;
    for (const a of els as El[]) {
      if (a.type !== "arrow" || !a.startBinding || !a.endBinding) continue;
      const label = (els as El[]).find((t) => t.type === "text" && t.containerId === a.id);
      const s = byId.get(a.startBinding.elementId), t = byId.get(a.endBinding.elementId);
      if (!label || !s || !t) continue;
      const horizontal = Math.abs(t.x + t.width / 2 - (s.x + s.width / 2)) >= Math.abs(t.y + t.height / 2 - (s.y + s.height / 2));
      const forward = horizontal ? t.x >= s.x : t.y >= s.y;
      const [near, far] = forward ? [s, t] : [t, s]; // near = upstream on the axis, far = the one we push
      const gap = horizontal ? far.x - (near.x + near.width) : far.y - (near.y + near.height);
      const need = (horizontal ? label.width : label.height) + 32;
      if (gap >= need) continue;
      const delta = need - gap, threshold = horizontal ? far.x : far.y;
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
  if (items.length < 2) return [];
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
      if (!SHAPES.has(e.type) || e.id === t.containerId || e.isDeleted) continue;
      if (contains(box(e), box(t))) continue; // ponytail: a text fully inside a shape is a section title or a note in a zone, not a collision
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
      let els = spaceForLabels(withDefaultFont(args.elements));
      if (args.frame) els = wrapInFrame([...els, ...legendFor(els)], String(args.frame));
      const res: any = add(api, els, args.placement ?? "auto", selectedIds);
      if (renamed.length) res.renamed = renamed; // ids that were already on the canvas got a suffix; use the new ids from `created`
      const warnings = overlapWarnings(api.getSceneElements().filter((e) => res.created.some((c: any) => c.id === e.id)));
      return warnings.length ? { ...res, warnings, hint: "Fix with update_elements (move/shrink/reword) or delete_elements + redraw." } : res;
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
      const els = args.selection_only ? scene.filter((e) => selectedIds.includes(e.id)) : scene;
      return { selectedIds, elements: els.map(compact) };
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
      for (const e of scene as El[]) if (ids.has(e.id)) for (const b of e.boundElements ?? []) if (b.type === "text") ids.add(b.id);
      const next = scene.map((e: El) => (ids.has(e.id) ? newElementWith(e, { isDeleted: true }) : e));
      api.updateScene({ elements: restoreElements(next, null, { repairBindings: true }), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      return { deleted: [...ids] };
    }
    default:
      throw new Error(`unknown tool ${tool}`);
  }
}
