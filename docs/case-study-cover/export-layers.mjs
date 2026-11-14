// Export one transparent SVG per animation step; exportingFrame keeps one shared viewport.
import fs from "node:fs";
const LEGEND = (e) => e.groupIds?.some((g) => g.startsWith("legend-"));
// PHONE=1: the portrait cover (frame "Explainer case study cover (phone)") into layers-phone/, no legend step.
const PHONE = !!process.env.PHONE;
const FRAME = PHONE ? "KOc8QHIWDhHl8JgMgnm-5" : "TvjYz708Cb4kNPsC2oHKn";
const OUT = PHONE ? "layers-phone" : "layers";
const STEPS = PHONE ? {
  you: ["p-you"],
  claude: ["p-a1", "p-claude"],
  mcp: ["p-a2", "p-sec", "p-secT", "p-mcp"],
  check: ["p-a3", "p-check"],
  layout: ["p-a4", "p-layout"],
  canvas: ["p-a5", "p-canvas"],
  back: ["p-back"],
} : {
  you: ["you-2"],
  claude: ["a1-2", "claude"],
  mcp: ["a2-2", "sec-2", "secT-2", "mcp"],
  check: ["a3-2", "check"],
  layout: ["a4-2", "layout"],
  canvas: ["a5-2", "canvas-2"],
  back: ["back"],
  legend: "legend",
};
fs.mkdirSync(OUT, { recursive: true });
const pages = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = pages.find((p) => p.type === "page" && p.url.includes("localhost:5173"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const ev = (expression) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res: (r) => r.exceptionDetails ? rej(new Error(r.exceptionDetails.exception?.description)) : res(r.result.value), rej }); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
for (const [name, ids] of Object.entries(STEPS)) {
  const svg = await ev(`(async () => {
    const mod = await import(${JSON.stringify(process.env.MOD_URL)});
    const all = window.__xapi.getSceneElements();
    const frame = all.find(e => e.id === ${JSON.stringify(FRAME)});
    const want = ${JSON.stringify(ids)};
    const isLegend = ${LEGEND.toString()};
    const pick = want === "legend" ? all.filter(e => e.frameId === frame.id && isLegend(e))
      : all.filter(e => want.includes(e.id) || want.includes(e.containerId));
    const s = await mod.exportToSvg({ elements: [frame, ...pick.map(e => ({ ...e }))], appState: { exportBackground: false, exportWithDarkMode: false, frameRendering: { enabled: false } }, files: window.__xapi.getFiles(), exportingFrame: frame, exportPadding: 24, renderEmbeddables: false });
    return s.outerHTML;
  })()`);
  fs.writeFileSync(`${OUT}/${name}.svg`, svg);
  console.log(name, Math.round(svg.length / 1024) + "KB");
}
process.exit(0);
