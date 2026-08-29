// usage: node turn.mjs "<prompt>" [maxSeconds]  -> sends a chat turn, waits until idle, prints the chat log
const [, , prompt, max = "180"] = process.argv;
const port = process.env.CDP_PORT ?? "9222";
const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = pages.find((p) => p.type === "page" && p.url.includes("localhost:5173")) ?? pages[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const call = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!(await ev("!!document.querySelector('.chat-log')"))) { await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Agent').click()"); await sleep(800); }
const before = await ev("document.querySelectorAll('.chat-log .msg, .chat-log .tool').length");
await ev(`(() => { const ta = document.querySelector('.chat-input textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, ${JSON.stringify(prompt)}); ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(300);
await ev("document.querySelector('.chat-input button.enter').click()");
const t0 = Date.now();
await sleep(3000);
while (Date.now() - t0 < Number(max) * 1000) {
  const running = await ev("!!document.querySelector('.dot.running') || !!document.querySelector('.chat-input button.stop')");
  if (!running) break;
  await sleep(2000);
}
const log = await ev(`[...document.querySelectorAll('.chat-log > *')].slice(${before}).map(n => n.className + ' | ' + n.textContent.replace(/\\s+/g,' ').slice(0, 400)).join('\\n')`);
console.log(`--- ${Math.round((Date.now() - t0) / 1000)}s ---\n` + log);
ws.close(); process.exit(0);
