// Deterministic capture: pause every animation, set currentTime per frame, screenshot.
import fs from "node:fs";
// PHONE=1: index-phone.html at 540x960 into frames-phone/.
const PHONE = !!process.env.PHONE;
const FPS = 30, DUR = 8, OUT = PHONE ? "frames-phone" : "frames";
const [W, H] = PHONE ? [540, 960] : [1200, 630];
const PAGE = PHONE ? "index-phone.html" : "index.html";
const PORT = process.env.PORT ?? "8765";
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
const tab = await (await fetch(`http://127.0.0.1:9223/json/new?http://127.0.0.1:${PORT}/${PAGE}`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const call = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
await call("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await new Promise((r) => setTimeout(r, 1500));
await ev("document.fonts.ready.then(() => document.fonts.size)");
for (let f = 0; f < FPS * DUR; f++) {
  await ev(`document.getAnimations().forEach(a => { a.pause(); a.currentTime = ${(f * 1000) / FPS}; })`);
  const { data } = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  fs.writeFileSync(`${OUT}/${String(f).padStart(4, "0")}.png`, Buffer.from(data, "base64"));
}
console.log("frames", FPS * DUR, "tab", tab.id);
process.exit(0);
