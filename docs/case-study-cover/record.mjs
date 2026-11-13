// Deterministic capture: pause every animation, set currentTime per frame, screenshot.
import fs from "node:fs";
const FPS = 30, DUR = 8, OUT = "frames";
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
const tab = await (await fetch("http://127.0.0.1:9223/json/new?http://127.0.0.1:8765/index.html", { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const call = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
await call("Emulation.setDeviceMetricsOverride", { width: 1200, height: 630, deviceScaleFactor: 2, mobile: false });
await new Promise((r) => setTimeout(r, 1500));
await ev("document.fonts.ready.then(() => document.fonts.size)");
for (let f = 0; f < FPS * DUR; f++) {
  await ev(`document.getAnimations().forEach(a => { a.pause(); a.currentTime = ${(f * 1000) / FPS}; })`);
  const { data } = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
  fs.writeFileSync(`${OUT}/${String(f).padStart(4, "0")}.png`, Buffer.from(data, "base64"));
}
console.log("frames", FPS * DUR, "tab", tab.id);
process.exit(0);
