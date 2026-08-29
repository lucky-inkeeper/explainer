// Export every frame on the canvas through Excalidraw's exportToBlob (clean, no UI chrome) into out/png/NN-slug.jpg
import fs from "node:fs";
fs.mkdirSync("out/png", { recursive: true });
const port = process.env.CDP_PORT ?? "9222";
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find((p) => p.type === "page" && p.url.includes("localhost:5173")) ?? pages[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const modUrl = await ev(`(async () => { const s = [...document.scripts].map(s => s.src).find(s => s.includes('excalidraw')); return s || null; })()`);
const frames = await ev("window.__xapi.getSceneElements().filter(e => e.type === 'frame').sort((a, b) => a.x - b.x).map(f => ({ id: f.id, name: f.name }))");
let i = 0;
for (const f of frames) {
  i++;
  const slug = (f.name ?? "frame").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const dataUrl = await ev(`(async () => {
    const mod = await import(${JSON.stringify(process.env.MOD_URL)});
    const els = window.__xapi.getSceneElements();
    const frame = els.find(e => e.id === ${JSON.stringify(f.id)});
    const blob = await mod.exportToBlob({ elements: els, appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false }, files: window.__xapi.getFiles(), exportingFrame: frame, exportPadding: 24, maxWidthOrHeight: 1800, mimeType: 'image/jpeg', quality: 0.85 });
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  })()`);
  const out = `out/png/${String(i).padStart(2, "0")}-${slug}.jpg`;
  fs.writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(out, Math.round(fs.statSync(out).size / 1024) + "KB");
}
ws.close(); process.exit(0);
