import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type MinimapHandle = { draw: (elements: readonly any[], appState: any) => void };
const W = 220, H = 150, PAD = 40;
const KEY = "explainer-minimap";

/** Overview of the scene: every element as a block, the viewport as a rectangle. Click or drag to pan. */
export const Minimap = forwardRef<MinimapHandle, { api: ExcalidrawImperativeAPI | null }>(function Minimap({ api }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ elements: readonly any[]; appState: any } | null>(null);
  const frame = useRef(0);
  const view = useRef({ x: 0, y: 0, k: 1 }); // scene -> map transform
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(KEY) !== "closed"; } catch { return true; } });
  const dark = useRef(false);

  const paint = () => {
    frame.current = 0;
    const c = canvas.current, d = last.current;
    if (!c || !d) return;
    const els = d.elements.filter((e) => !e.isDeleted && Number.isFinite(e.x) && Number.isFinite(e.width));
    const { scrollX, scrollY, zoom, width, height, theme } = d.appState;
    dark.current = theme === "dark";
    const vp = { x: -scrollX, y: -scrollY, w: width / zoom.value, h: height / zoom.value };
    let x1 = vp.x, y1 = vp.y, x2 = vp.x + vp.w, y2 = vp.y + vp.h;
    for (const e of els) { x1 = Math.min(x1, e.x); y1 = Math.min(y1, e.y); x2 = Math.max(x2, e.x + e.width); y2 = Math.max(y2, e.y + e.height); }
    x1 -= PAD; y1 -= PAD; x2 += PAD; y2 += PAD;
    const k = Math.min(W / (x2 - x1), H / (y2 - y1));
    const ox = (W - (x2 - x1) * k) / 2 - x1 * k, oy = (H - (y2 - y1) * k) / 2 - y1 * k;
    view.current = { x: ox, y: oy, k };
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = dark.current ? "#4a4a55" : "#c5c7d0";
    for (const e of els) {
      if (e.type === "frame") { g.strokeStyle = dark.current ? "#5b5b66" : "#b0b2bc"; g.lineWidth = 1; g.strokeRect(ox + e.x * k, oy + e.y * k, e.width * k, e.height * k); continue; }
      const h = e.type === "text" ? Math.max(1, e.height * k * 0.6) : Math.max(1.5, e.height * k);
      g.fillRect(ox + e.x * k, oy + e.y * k, Math.max(1.5, e.width * k), h);
    }
    g.strokeStyle = "#6965db"; g.lineWidth = 1.5;
    g.fillStyle = "rgba(105,101,219,.12)";
    g.fillRect(ox + vp.x * k, oy + vp.y * k, vp.w * k, vp.h * k);
    g.strokeRect(ox + vp.x * k, oy + vp.y * k, vp.w * k, vp.h * k);
  };

  useImperativeHandle(ref, () => ({
    draw: (elements, appState) => { last.current = { elements, appState }; if (!frame.current) frame.current = requestAnimationFrame(paint); },
  }), []);

  const panTo = (ev: React.PointerEvent) => {
    const d = last.current; if (!api || !d) return;
    const r = canvas.current!.getBoundingClientRect();
    const { x, y, k } = view.current;
    const sx = (ev.clientX - r.left - x) / k, sy = (ev.clientY - r.top - y) / k; // scene point under the cursor
    const { width, height, zoom } = d.appState;
    api.updateScene({ appState: { scrollX: width / (2 * zoom.value) - sx, scrollY: height / (2 * zoom.value) - sy } });
  };
  const toggle = (v: boolean) => { setOpen(v); try { localStorage.setItem(KEY, v ? "open" : "closed"); } catch {} };

  if (!open) return <button className="minimap-toggle" onClick={() => toggle(true)} title="Show minimap">Map</button>;
  return (
    <div className="minimap">
      <canvas ref={canvas} style={{ width: W, height: H }}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); panTo(e); }}
        onPointerMove={(e) => { if (e.buttons & 1) panTo(e); }} />
      <div className="minimap-bar"><span>MINIMAP</span><button onClick={() => toggle(false)} title="Hide minimap">×</button></div>
    </div>
  );
});
