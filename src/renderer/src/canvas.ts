import { CaptureUpdateAction, FONT_FAMILY, convertToExcalidrawElements, getCommonBounds, getVisibleSceneBounds, newElementWith, restoreElements } from "@excalidraw/excalidraw";

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
  api.updateScene({ elements: [...base, ...placed], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  api.scrollToContent(placed, { fitToContent: true, animate: true, duration: 300 });
  return { created: placed.map((e) => ({ id: e.id, type: e.type, x: r(e.x), y: r(e.y) })) };
}

type Box = { x: number; y: number; w: number; h: number };
const box = (e: El): Box => ({ x: e.x, y: e.y, w: e.width, h: e.height });
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
      const c = (e: El) => [e.x + (e.width ?? 100) / 2, e.y + (e.height ?? 100) / 2];
      const [sx, sy] = c(s), [tx, ty] = c(t);
      const p1 = edgePoint(s, sx, sy, tx, ty), p2 = edgePoint(t, tx, ty, sx, sy);
      Object.assign(a, { x: p1[0], y: p1[1], width: Math.abs(p2[0] - p1[0]), height: Math.abs(p2[1] - p1[1]), points: [[0, 0], [p2[0] - p1[0], p2[1] - p1[1]]] });
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

/** Labels that still intersect a shape they are not bound to - reported back so the agent can fix them. */
function overlapWarnings(els: El[]) {
  const out: string[] = [];
  for (const t of els) {
    if (t.type !== "text") continue;
    for (const e of els) {
      if (!SHAPES.has(e.type) || e.id === t.containerId || e.isDeleted) continue;
      if (hit(box(t), box(e))) out.push(`text "${t.text}" (${t.id}) overlaps ${e.type} ${e.id}`);
    }
  }
  return out;
}

export async function runCanvasTool(api: ExcalidrawImperativeAPI, tool: string, args: any, selectedIds: string[]) {
  switch (tool) {
    case "draw_elements": {
      const els = spaceForLabels(withDefaultFont(args.elements));
      const res = add(api, els, args.placement ?? "auto", selectedIds);
      const warnings = overlapWarnings(api.getSceneElements().filter((e) => res.created.some((c) => c.id === e.id)));
      return warnings.length ? { ...res, warnings, hint: "Fix with update_elements (move/shrink/reword) or delete_elements + redraw." } : res;
    }
    case "draw_mermaid": {
      const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
      // extra keys reach mermaid.initialize(): wider ranks so edge labels fit between nodes
      const { elements, files } = await parseMermaidToExcalidraw(args.definition, { flowchart: { curve: "linear", rankSpacing: 150, nodeSpacing: 70 } } as any);
      if (files) api.addFiles(Object.values(files) as any);
      const els = convertToExcalidrawElements(withDefaultFont(elements as any), { regenerateIds: true });
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
      api.updateScene({ elements: restoreElements(next, null, { refreshDimensions: true, repairBindings: true }), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
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
