// Render an agent's raw skeleton JSON as the agent wrote it: no notation check, no layout pass.
// Nothing is added to the canvas. usage: MOD_URL=... node render-raw.mjs in.json out.jpg
import fs from "node:fs";
const [, , input, output] = process.argv;
const skeleton = JSON.parse(fs.readFileSync(input, "utf8"));
const pages = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = pages.find((p) => p.type === "page" && p.url.includes("localhost:5173"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m.result); } };
await new Promise((r) => (ws.onopen = r));
const ev = (expression) => new Promise((res, rej) => { const i = ++id; pending.set(i, (r) => r.exceptionDetails ? rej(new Error(r.exceptionDetails.exception?.description)) : res(r.result.value)); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
const dataUrl = await ev(`(async () => {
  const mod = await import(${JSON.stringify(process.env.MOD_URL)});
  const els = mod.convertToExcalidrawElements(${JSON.stringify(skeleton)});
  const blob = await mod.exportToBlob({ elements: els, appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false }, files: {}, getDimensions: (w, h) => ({ width: w * 2, height: h * 2, scale: 2 }), exportPadding: 32, mimeType: 'image/jpeg', quality: 0.88 });
  return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
})()`);
fs.writeFileSync(output, Buffer.from(dataUrl.split(",")[1], "base64"));
console.log(output, Math.round(fs.statSync(output).size / 1024) + "KB");
process.exit(0);
