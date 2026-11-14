// Layout fixtures replayed in the running dev app over CDP (ADR-0005). Needs `EXPLAINER_DEBUG_PORT=9222 npx electron-vite dev`; skips otherwise.
// Fixtures: test/layout/fixtures/<type>.json, harvested by test/layout/harvest.mjs. Optional `then`: a second batch drawn at exact positions onto the first (canvas frame upkeep). Each asserts: no warnings, every element inside the frame and in it (frameId), legend present and below all content.
// Mark a fixture that still warns: node test/layout/harvest.mjs --todo (writes its current warnings into `todo`).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const port = process.env.CDP_PORT ?? "9222";
const dir = new URL("./layout/fixtures/", import.meta.url);

test("layout fixtures", async (t) => {
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => null);
  // any localhost port (Vite moves off 5173 when another dev server holds it); the title keeps out other pages on a shared 9222
  const page = pages?.find((p) => p.type === "page" && p.title === "Explainer" && /^http:\/\/localhost:\d+\//.test(p.url));
  if (!page) return t.skip(`layout: dev app not on ${port}, skipped`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); };
  const run = (expression) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
  try {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const fx = JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
      // a fixture with `todo` (its warnings when harvested) is reported as TODO until the layout clears them; delete the field then
      await t.test(f.replace(".json", ""), { todo: fx.todo ? `${fx.todo.length} known warnings` : false }, async () => {
        const r = await run(`(() => {
          const o = window.__layout.layout(${JSON.stringify(fx.elements)}, { frame: ${JSON.stringify(fx.frame)} });
          // \`then\`: a later batch drawn at exact positions onto the framed diagram, as the canvas writes it
          if (${JSON.stringify(fx.then ?? null)}) { const o2 = window.__layout.layout(${JSON.stringify(fx.then ?? [])}); o.warnings.push(...o2.warnings); o.elements = window.__layout.settleFrames([...o.elements, ...o2.elements], new Set(o2.elements.map((e) => e.id))); }
          const fr = o.elements.find((e) => e.type === "frame");
          // an arrow's points may run left or up from x,y: take the point extents, not width/height
          const bb = (e) => e.points ? [e.x + Math.min(...e.points.map((p) => p[0])), e.y + Math.min(...e.points.map((p) => p[1])), e.x + Math.max(...e.points.map((p) => p[0])), e.y + Math.max(...e.points.map((p) => p[1]))] : [e.x, e.y, e.x + e.width, e.y + e.height];
          const inside = (e) => { const [x1, y1, x2, y2] = bb(e); return x1 >= fr.x && y1 >= fr.y && x2 <= fr.x + fr.width && y2 <= fr.y + fr.height; };
          const isLegend = (e) => (e.groupIds?.[0] ?? "").startsWith(window.__layout.NOTATION.legendGroup);
          const content = o.elements.filter((e) => e.type !== "frame" && !isLegend(e));
          const legendTop = Math.min(...o.elements.filter(isLegend).map((e) => bb(e)[1]));
          return { warnings: o.warnings, outside: o.elements.filter((e) => e.type !== "frame" && !inside(e)).map((e) => e.id), unframed: o.elements.filter((e) => e.type !== "frame" && e.frameId !== fr.id).map((e) => e.id), underLegend: content.filter((e) => bb(e)[3] > legendTop).map((e) => e.id), legend: o.elements.some(isLegend), count: o.elements.length };
        })()`);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        const v = r.result.value;
        assert.deepEqual(v.warnings, [], "warnings");
        assert.deepEqual(v.outside, [], "elements outside the frame");
        assert.equal(v.legend, true, "legend strip present");
        assert.deepEqual(v.unframed, [], "elements without the frame's frameId");
        assert.deepEqual(v.underLegend, [], "elements that reach below the legend top");
      });
    }
  } finally {
    ws.close();
  }
});
