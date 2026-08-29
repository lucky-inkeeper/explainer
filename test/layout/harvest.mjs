// Harvest fixtures: for each eval prompt, the latest agent session that got it, and its last framed draw_elements call.
// usage: node test/layout/harvest.mjs          reads ~/.claude/projects/<workspace slug>/*.jsonl, writes test/layout/fixtures/<slug>.json
//        node test/layout/harvest.mjs --todo   runs every fixture through window.__layout in the dev app and stores its warnings as `todo`
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const here = path.dirname(new URL(import.meta.url).pathname);
if (process.argv.includes("--todo")) {
  const pages = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? "9222"}/json/list`)).json();
  const ws = new WebSocket(pages.find((p) => p.type === "page" && p.url.includes("localhost:5173")).webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m.result.result.value); } };
  const run = (expression) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true } })); });
  for (const f of fs.readdirSync(path.join(here, "fixtures")).filter((f) => f.endsWith(".json")).sort()) {
    const fp = path.join(here, "fixtures", f), fx = JSON.parse(fs.readFileSync(fp, "utf8"));
    const warnings = await run(`window.__layout.layout(${JSON.stringify(fx.elements)}, { frame: ${JSON.stringify(fx.frame)} }).warnings`);
    const { todo: _old, ...rest } = fx;
    fs.writeFileSync(fp, JSON.stringify(warnings.length ? { ...rest, todo: warnings } : rest, null, 1) + "\n");
    console.log(f.padEnd(18), warnings.length ? `todo: ${warnings.length} warnings` : "clean");
  }
  ws.close(); process.exit(0);
}
const dir = path.join(os.homedir(), ".claude/projects/-Users-macbook14-Documents-Personal-Dev-explainer-data-workspace");
const sh = fs.readFileSync(path.join(here, "../eval/eval-run.sh"), "utf8");
const prompts = [...sh.matchAll(/^\s+"([a-z-]+)\|(.+)"$/gm)].map((m) => ({ slug: m[1], prompt: m[2] }));
const text = (c) => (typeof c === "string" ? c : (c ?? []).map((b) => b.text ?? "").join("\n"));
const sessions = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
  const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const users = lines.filter((l) => l.type === "user" && l.message?.role === "user").map((l) => text(l.message.content));
  const draws = lines.filter((l) => l.type === "assistant").flatMap((l) => (l.message?.content ?? []).filter((b) => b.type === "tool_use" && b.name === "mcp__canvas__draw_elements" && b.input?.frame).map((b) => ({ ts: l.timestamp, input: b.input })));
  const ts = lines.find((l) => l.timestamp)?.timestamp ?? "";
  sessions.push({ id: f.replace(".jsonl", ""), ts, users, draws });
}
let n = 0;
for (const { slug, prompt } of prompts) {
  const hits = sessions.filter((s) => s.draws.length && s.users.some((u) => u.includes(prompt))).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  if (!hits.length) { console.log("MISSING", slug); continue; }
  const s = hits[0], d = s.draws[s.draws.length - 1];
  fs.writeFileSync(path.join(here, "fixtures", `${slug}.json`), JSON.stringify({ prompt, session: s.id, at: d.ts, ...d.input }, null, 1) + "\n");
  console.log(slug, s.id.slice(0, 8), d.ts?.slice(0, 16), d.input.elements.length, "elements, frame:", d.input.frame);
  n++;
}
console.log(n, "fixtures");
