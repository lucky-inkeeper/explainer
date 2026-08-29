// usage: node cdp.mjs shot out.png | node cdp.mjs eval "<js expression>" | node cdp.mjs logs <seconds>
import fs from "node:fs";
const [, , cmd, arg, arg2] = process.argv;
const port = process.env.CDP_PORT ?? "9222";
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find((p) => p.type === "page" && p.url.includes("localhost:5173")) ?? pages[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const events = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else if (m.method) events.push(m); };
await new Promise((r) => (ws.onopen = r));
if (cmd === "shot") {
  const r = await call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(arg, Buffer.from(r.data, "base64")); console.log("saved", arg);
} else if (cmd === "evalfile" || cmd === "eval") {
  const expr = cmd === "evalfile" ? fs.readFileSync(arg, "utf8") : arg;
  const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(r.exceptionDetails ? "EXC " + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) : JSON.stringify(r.result.value, null, 1));
} else if (cmd === "click") {
  const [x, y] = [Number(arg), Number(arg2)];
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  console.log("clicked", x, y);
} else if (cmd === "key") {
  const mods = arg2 ? Number(arg2) : 0; // 4 = Meta
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: arg, code: "Key" + arg.toUpperCase(), modifiers: mods, text: mods ? undefined : arg });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: arg, code: "Key" + arg.toUpperCase(), modifiers: mods });
  console.log("key", arg);
} else if (cmd === "logs") {
  await call("Runtime.enable"); await call("Log.enable");
  await new Promise((r) => setTimeout(r, Number(arg ?? 3) * 1000));
  for (const ev of events) {
    if (ev.method === "Runtime.consoleAPICalled") console.log(ev.params.type.toUpperCase(), ev.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400));
    if (ev.method === "Runtime.exceptionThrown") console.log("EXCEPTION", ev.params.exceptionDetails.exception?.description?.slice(0, 600));
    if (ev.method === "Log.entryAdded") console.log("LOG", ev.params.entry.level, ev.params.entry.text.slice(0, 300));
  }
}
ws.close(); process.exit(0);
