// usage: CDP_PORT=9222 node test/eval/perf.mjs
// Frame-time check for pan and wheel zoom on the running app, at the current zoom and at fit-to-content. Restores the view after.
const port = process.env.CDP_PORT ?? "9222";
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const info = await ev(`(() => { const x = window.__xapi, s = x.getAppState(); const r = document.querySelector("canvas.excalidraw__canvas.interactive").getBoundingClientRect(); return { n: x.getSceneElements().length, zoom: s.zoom.value, scrollX: s.scrollX, scrollY: s.scrollY, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } })()`);
console.log(`${info.n} elements`);
const start = () => ev(`window.__d = []; window.__stop = false; window.__last = performance.now(); (function t(now) { if (window.__stop) return; window.__d.push(now - window.__last); window.__last = now; requestAnimationFrame(t); })(performance.now());`);
const stop = async (label) => { const d = (await ev(`(window.__stop = true, window.__d)`)).slice(1).sort((a, b) => a - b); const p = (q) => d[Math.floor(d.length * q)].toFixed(1); console.log(`${label}: p50=${p(0.5)}ms p90=${p(0.9)} p99=${p(0.99)} max=${d[d.length - 1].toFixed(1)} over20ms=${d.filter((x) => x > 20).length}/${d.length}`); };
const wheel = (dx, dy, modifiers = 0) => call("Input.dispatchMouseEvent", { type: "mouseWheel", x: info.cx, y: info.cy, deltaX: dx, deltaY: dy, modifiers });
for (const fit of [false, true]) {
  if (fit) { await ev(`window.__xapi.scrollToContent(undefined, { fitToContent: true })`); await sleep(800); }
  const z = (await ev("window.__xapi.getAppState().zoom.value")).toFixed(2);
  await start(); for (let i = 0; i < 120; i++) { await wheel(i < 60 ? 12 : -12, 0); await sleep(6); } await sleep(200); await stop(`pan  zoom=${z}`);
  await start(); for (let i = 0; i < 120; i++) { await wheel(0, i < 60 ? 3 : -3, 2); await sleep(6); } await sleep(500); await stop(`zoom zoom=${z}`);
  await ev(`window.__xapi.updateScene({ appState: { scrollX: ${info.scrollX}, scrollY: ${info.scrollY}, zoom: { value: ${info.zoom} } } })`); await sleep(300);
}
ws.close(); process.exit(0);
