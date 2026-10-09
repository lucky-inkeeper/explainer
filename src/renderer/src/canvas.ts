import { CaptureUpdateAction, convertToExcalidrawElements, getCommonBounds, getVisibleSceneBounds, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { api as ipc } from "./api";
import { type El, fitText, followBindings, inspect, labelsFollowFrames, layout, legendFor, withDefaultFont, wrapInFrame } from "./layout";

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

type Scene = ReturnType<ExcalidrawImperativeAPI["getSceneElements"]>;

/**
 * Free spot for a w x h box: right of or below an existing top-level element (or the whole content), clear of every element by GAP.
 * Picks the spot that keeps the content box smallest (longer side, then area), then the one nearest the content's top-left: a row
 * fills before a new row starts, and the canvas grows in both axes instead of one long row.
 */
function freeSpot(scene: Scene, w: number, h: number): [number, number] {
  const boxes = scene.map((e) => getCommonBounds([e]));
  const [sx1, sy1, sx2, sy2] = getCommonBounds(scene);
  const spots: [number, number][] = [[sx2 + GAP, sy1], [sx1, sy2 + GAP]]; // always clear
  for (const e of scene) if (!e.frameId) { const [x1, y1, x2, y2] = getCommonBounds([e]); spots.push([x2 + GAP, y1], [x1, y2 + GAP]); }
  const clear = ([x, y]: [number, number]) => boxes.every(([bx1, by1, bx2, by2]) => x >= bx2 + GAP || x + w + GAP <= bx1 || y >= by2 + GAP || y + h + GAP <= by1);
  const rank = ([x, y]: [number, number]) => {
    const bw = Math.max(sx2, x + w) - sx1, bh = Math.max(sy2, y + h) - sy1; // content box after placing
    return [Math.max(bw, bh), bw * bh, Math.hypot(x - sx1, y - sy1)];
  };
  const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return spots.filter(clear).sort((a, b) => cmp(rank(a), rank(b)))[0];
}

/** Shift a batch of fresh elements into free space. */
function place(api: ExcalidrawImperativeAPI, els: El[], mode: string, selectedIds: string[]) {
  if (mode === "exact" || !els.length) return els;
  const scene = api.getSceneElements();
  const sel = scene.filter((e) => selectedIds.includes(e.id));
  const [nx, ny, nx2, ny2] = getCommonBounds(els);
  let tx: number, ty: number;
  if (sel.length && (mode === "selection" || mode === "auto" || !mode)) { const [, y1, x2] = getCommonBounds(sel); tx = x2 + GAP; ty = y1; }
  else if (scene.length) [tx, ty] = freeSpot(scene, nx2 - nx, ny2 - ny);
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
  api.updateScene({ elements: growFrames(labelsFollowFrames([...base, ...placed])), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  api.scrollToContent(placed, { fitToContent: true, animate: true, duration: 300 });
  return { created: placed.map((e) => ({ id: e.id, type: e.type, x: r(e.x), y: r(e.y) })) };
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

const withWarnings = (res: any, warnings: string[]) => (warnings.length ? { ...res, warnings, hint: "Fix with update_elements (move/shrink/reword, or route the arrow around) or delete_elements + redraw." } : res);

export async function runCanvasTool(api: ExcalidrawImperativeAPI, tool: string, args: any, selectedIds: string[]) {
  switch (tool) {
    case "draw_elements": {
      const renamed = dedupeIds(api, args.elements ?? []);
      const { elements, parked, warnings } = layout(args.elements ?? [], { frame: args.frame });
      const res: any = add(api, elements, args.placement ?? "auto", selectedIds);
      if (renamed.length) res.renamed = renamed; // ids that were already on the canvas got a suffix; use the new ids from `created`
      if (parked.length) res.parked = parked.map((id) => `${id} was moved by the app (it sat on a node, or its leader crossed something); its leader follows`);
      return withWarnings(res, warnings);
    }
    case "draw_image": {
      const images: any[] = args.images ?? [];
      if (!images.length) throw new Error("images is empty");
      const row = args.layout === "row", GAP = 40, CAPTION_W = 320;
      const used = new Set<string>(), fileIds: string[] = [], skeleton: El[] = [];
      let cx = 0, cy = 0;
      for (const im of images) {
        if (!im.path && !im.dataURL) throw new Error("each image needs path or dataURL");
        const f = await ipc.invoke("image:read", { dataURL: im.dataURL }).catch((e: any) => { throw new Error(String(e?.message ?? e).replace(/^.*'image:read': (Error: )?/, "")); }); // drop Electron's IPC prefix
        api.addFiles([{ id: f.id, dataURL: f.dataURL, mimeType: f.mimeType, created: Date.now() }] as any);
        if (!fileIds.includes(f.id)) fileIds.push(f.id);
        // half the pixel size by default (retina captures); one given side keeps the aspect ratio
        const w = im.width ?? (im.height ? (im.height * f.width) / f.height : f.width / 2), h = im.height ?? (im.width ? (im.width * f.height) / f.width : f.height / 2);
        let id = im.id ?? `img-${f.id.slice(0, 8)}`;
        for (let n = 2; used.has(id); n++) id = `${im.id ?? `img-${f.id.slice(0, 8)}`}-${n}`;
        used.add(id);
        const exact = args.placement === "exact" && Number.isFinite(im.x) && Number.isFinite(im.y);
        const x = exact ? im.x : cx, y = exact ? im.y : cy;
        skeleton.push({ type: "image", id, fileId: f.id, x, y, width: w, height: h });
        if (im.caption) skeleton.push(row ? { type: "text", id: `${id}-caption`, text: im.caption, x, y: y + h + 16, width: w, fontSize: 16 } : { type: "text", id: `${id}-caption`, text: im.caption, x: x + w + 24, y, width: CAPTION_W, fontSize: 16 });
        if (row) cx += w + GAP; else cy += h + (im.caption ? GAP : 0) + GAP;
      }
      const renamed = dedupeIds(api, skeleton);
      const { elements, parked, warnings } = layout(skeleton, { frame: args.frame });
      const res: any = add(api, elements, args.placement ?? "auto", selectedIds);
      res.files = fileIds;
      if (renamed.length) res.renamed = renamed;
      if (parked.length) res.parked = parked;
      return withWarnings(res, warnings);
    }
    case "draw_mermaid": {
      const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
      // extra keys reach mermaid.initialize(): wider ranks so edge labels fit between nodes
      const { elements, files } = await parseMermaidToExcalidraw(args.definition, { flowchart: { curve: "linear", rankSpacing: 150, nodeSpacing: 70 } } as any);
      if (files) api.addFiles(Object.values(files) as any);
      let els = convertToExcalidrawElements(withDefaultFont(elements as any), { regenerateIds: true });
      if (args.frame) els = wrapInFrame([...els, ...legendFor(els)], String(args.frame));
      return withWarnings(add(api, els, args.placement ?? "auto", selectedIds), inspect(els));
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
        if (e.type === "text" && !e.containerId && props.width > 0) { const t = fitText(String(props.text ?? e.originalText ?? e.text), props.width, String(e.text), e.width); if (t !== (props.text ?? e.text)) props.text = t; } // a free text wraps to the given width
        if (props.text !== undefined && e.type === "text") props.originalText = props.text;
        if (props.points && e.type === "arrow") props.fixedSegments = null; // new points: old fixed segments are stale
        return newElementWith(e, props);
      });
      const restored = restoreElements(next, null, { refreshDimensions: true, repairBindings: true }) as El[];
      const final = growFrames(labelsFollowFrames(followBindings(restored, new Set(updates.map((u) => u.id)))));
      api.updateScene({ elements: final, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      // a move re-routes bound arrows, so inspect the touched frames the same way a fresh batch is inspected
      const ids = new Set(updates.map((u) => u.id));
      const frames = new Set(final.filter((e: El) => ids.has(e.id)).map((e: El) => (e.type === "frame" ? e.id : e.frameId)).filter(Boolean));
      const scope = final.filter((e: El) => !e.isDeleted && (frames.has(e.frameId) || frames.has(e.id) || ids.has(e.id)));
      return withWarnings({ updated: updates.map((u) => u.id) }, inspect(scope));
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
