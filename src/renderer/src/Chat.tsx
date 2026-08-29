import { useCallback, useEffect, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Sidebar } from "@excalidraw/excalidraw";
import { api } from "./api";
import { compact } from "./canvas";
import type { AppState, ImageBlock, PermissionMode, SessionInfo, UserContent } from "../../shared/types";

type Item =
  | { k: "user"; id: string; text: string; images: string[] }
  | { k: "text"; id: string; text: string; parent: string | null }
  | { k: "thinking"; id: string; text: string; parent: string | null; done?: boolean }
  | { k: "tool"; id: string; name: string; input: any; partial: string; result?: string; isError?: boolean; parent: string | null }
  | { k: "perm"; id: string; toolName: string; input: any; suggestions: any[]; description?: string; done?: string }
  | { k: "ask"; id: string; questions: any[]; done?: boolean }
  | { k: "info"; id: string; text: string; level?: string }
  | { k: "result"; id: string; cost: number; turns: number; error?: string };
type Command = { name: string; description: string; argumentHint: string };

const MODELS = ["", "claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-haiku-4-5"];
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
const MODES: PermissionMode[] = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"];
const MODE_LABELS: Record<PermissionMode, string> = { default: "Ask", acceptEdits: "Accept edits", plan: "Plan", auto: "Auto", bypassPermissions: "Bypass", dontAsk: "Don't ask" };
let n = 0;
const uid = () => `i${++n}`;
const shortModel = (m: string) => (m ? m.replace(/^claude-/, "") : "model");

/** Text + chevron sized by the current label; the real <select> sits invisibly on top for clicks and keyboard. */
function Picker({ value, options, onChange, title }: { value: string; options: [string, string][]; onChange: (v: string) => void; title: string }) {
  const label = options.find(([v]) => v === value)?.[1] ?? value;
  return (
    <span className="pick" title={title}>
      <span>{label}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={title}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </span>
  );
}
const stripAttach = (t: string) => t.replace(/\n*<selected_elements>[\s\S]*?<\/selected_elements>/g, "").trim();

export function useChat({ xapi, file, state, setState, attached, setAttached }: {
  xapi: ExcalidrawImperativeAPI | null; file: string | null; state: AppState | null; setState: (s: AppState) => void;
  attached: string[]; setAttached: (ids: string[]) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [session, setSession] = useState<{ id?: string; model?: string; mode?: PermissionMode }>({});
  const [commands, setCommands] = useState<Command[]>([]);
  const [cost, setCost] = useState(0);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const streams = useRef<Record<string, string>>({});
  const stateRef = useRef(state); stateRef.current = state;
  const fileRef = useRef(file); fileRef.current = file;
  const xapiRef = useRef(xapi); xapiRef.current = xapi;
  const attachedRef = useRef(attached); attachedRef.current = attached;
  const stoppedRef = useRef(false);

  const push = (it: Item) => setItems((s) => [...s, it]);
  const update = (id: string, f: (it: Item) => Item) => setItems((s) => s.map((it) => (it.id === id ? f(it) : it)));

  const onAssistant = useCallback((m: any) => {
    const p = m.parent_tool_use_id ?? null;
    for (const b of m.message?.content ?? []) {
      if (b.type === "text") {
        setItems((s) => {
          const last = [...s].reverse().find((it) => it.k === "text" && it.parent === p) as Extract<Item, { k: "text" }> | undefined;
          if (last && (b.text === last.text || b.text.startsWith(last.text))) return s.map((it) => (it.id === last.id ? { ...last, text: b.text } : it));
          return [...s, { k: "text", id: uid(), text: b.text, parent: p }];
        });
      } else if (b.type === "tool_use") {
        setItems((s) => (s.some((it) => it.id === b.id) ? s.map((it) => (it.id === b.id && it.k === "tool" ? { ...it, input: b.input } : it)) : [...s, { k: "tool", id: b.id, name: b.name, input: b.input, partial: "", parent: p }]));
      }
    }
  }, []);

  const onUser = useCallback((m: any, fromTranscript = false) => {
    const c = m.message?.content;
    const blocks = Array.isArray(c) ? c : [];
    const results = blocks.filter((b: any) => b.type === "tool_result");
    for (const b of results) {
      const text = typeof b.content === "string" ? b.content : (b.content ?? []).map((x: any) => (x.type === "text" ? x.text : `[${x.type}]`)).join("\n");
      update(b.tool_use_id, (it) => (it.k === "tool" ? { ...it, result: text, isError: !!b.is_error } : it));
    }
    if (fromTranscript && !results.length) {
      const text = typeof c === "string" ? c : blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      if (text && !/^\s*[<[]/.test(text)) push({ k: "user", id: uid(), text: stripAttach(text), images: [] }); // skip synthetic <task-notification>, [Request interrupted...]
    }
  }, []);

  const onStream = (m: any) => {
    const e = m.event, p = m.parent_tool_use_id ?? null, key = `${p}:${e.index}`;
    if (e.type === "content_block_start") {
      const b = e.content_block, id = b.type === "tool_use" ? b.id : uid();
      streams.current[key] = id;
      if (b.type === "text") push({ k: "text", id, text: b.text ?? "", parent: p });
      else if (b.type === "thinking") push({ k: "thinking", id, text: "", parent: p });
      else if (b.type === "tool_use") push({ k: "tool", id, name: b.name, input: b.input ?? {}, partial: "", parent: p });
    } else if (e.type === "content_block_delta") {
      const id = streams.current[key]; if (!id) return;
      const d = e.delta;
      update(id, (it) => d.type === "text_delta" && it.k === "text" ? { ...it, text: it.text + d.text }
        : d.type === "thinking_delta" && it.k === "thinking" ? { ...it, text: it.text + d.thinking }
        : d.type === "input_json_delta" && it.k === "tool" ? { ...it, partial: it.partial + d.partial_json } : it);
    } else if (e.type === "content_block_stop") {
      const id = streams.current[key]; delete streams.current[key];
      if (id) update(id, (it) => (it.k === "thinking" ? { ...it, done: true } : it));
    }
  };

  const onSessionId = (id: string) => {
    const f = fileRef.current;
    if (f && stateRef.current?.sessions[f] !== id) api.invoke("state:set", { sessions: { [f]: id } }).then(setState);
  };

  const onEvent = (m: any) => {
    switch (m.type) {
      case "system":
        if (m.subtype === "init") { setSession({ id: m.session_id, model: m.model, mode: m.permissionMode }); setCommands((c) => (c.length ? c : m.slash_commands.map((name: string) => ({ name, description: "", argumentHint: "" })))); onSessionId(m.session_id); }
        else if (m.subtype === "status") setStatus(m.status);
        else if (m.subtype === "informational") push({ k: "info", id: uid(), text: m.content, level: m.level });
        else if (m.subtype === "task_notification") push({ k: "info", id: uid(), text: `Task ${m.status}: ${m.summary}` });
        else if (m.subtype === "compact_boundary") push({ k: "info", id: uid(), text: "Context compacted" });
        else if (m.subtype === "commands_changed") setCommands(m.commands);
        return;
      case "control_response":
        if (m.response?.request_id === "init" && m.response.response?.commands) setCommands(m.response.response.commands);
        return;
      case "stream_event": return onStream(m);
      case "assistant": return onAssistant(m);
      case "user": return onUser(m);
      case "result": {
        setRunning(false); setStatus(null); setCost(m.total_cost_usd ?? 0);
        setItems((s) => s.map((it) => (it.k === "thinking" && !it.done ? { ...it, done: true } : it)));
        if (stoppedRef.current) { stoppedRef.current = false; push({ k: "info", id: uid(), text: "Stopped." }); return; }
        if (m.is_error || m.subtype !== "success") {
          const err: string = m.errors?.join("\n") ?? m.result ?? m.subtype;
          push({ k: "result", id: uid(), cost: m.total_cost_usd, turns: m.num_turns, error: err });
          if (/log ?in|authenticat|api key|oauth/i.test(err)) setLoginNeeded(true);
        }
        return;
      }
      case "control_request": {
        const r = m.request;
        if (r.subtype === "can_use_tool") {
          if (r.tool_name === "AskUserQuestion") push({ k: "ask", id: m.request_id, questions: r.input.questions ?? [] });
          else push({ k: "perm", id: m.request_id, toolName: r.tool_name, input: r.input, suggestions: r.permission_suggestions ?? [], description: r.description ?? r.title });
        } else api.invoke("claude:respond", m.request_id, { error: `unsupported control request ${r.subtype}` });
        return;
      }
      case "auth_status": if (m.error) setLoginNeeded(true); return;
      case "exit": setRunning(false); push({ k: "info", id: uid(), text: `Agent process exited (code ${m.code})` }); return;
      case "stderr": console.warn("[claude]", m.text); return;
    }
  };
  const onEventRef = useRef(onEvent); onEventRef.current = onEvent;
  useEffect(() => api.on("claude:event", (m) => onEventRef.current(m)), []);

  const start = useCallback(async (resume?: string, fork?: boolean) => {
    const s = stateRef.current; if (!s) return;
    setItems([]); streams.current = {}; setRunning(false); setLoginNeeded(false); setSession({}); setCost(0);
    await api.invoke("claude:start", { cwd: s.workspace, resume, fork, model: s.model, effort: s.effort, permissionMode: s.permissionMode });
    if (resume && !fork) {
      onSessionId(resume);
      setSession((x) => ({ ...x, id: resume }));
      for (const m of await api.invoke("sessions:transcript", resume, s.workspace)) m.type === "assistant" ? onAssistant(m) : onUser(m, true);
    }
  }, [onAssistant, onUser]);

  // a drawing remembers its session
  useEffect(() => { if (file && state) start(state.sessions[file]); }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text: string, images: ImageBlock[]) => {
    let full = text;
    const ids = attachedRef.current, x = xapiRef.current;
    if (ids.length && x) full += `\n\n<selected_elements>\n${JSON.stringify(x.getSceneElements().filter((e) => ids.includes(e.id)).map(compact))}\n</selected_elements>`;
    const content: UserContent = images.length ? [{ type: "text", text: full }, ...images] : full;
    push({ k: "user", id: uid(), text: text + (ids.length ? `  [${ids.length} elements attached]` : ""), images: images.map((i) => `data:${i.source.media_type};base64,${i.source.data}`) });
    setAttached([]); setRunning(true);
    await api.invoke("claude:send", content);
  };

  const respond = (id: string, response: Record<string, unknown>, done: string) => {
    api.invoke("claude:respond", id, response);
    update(id, (it) => (it.k === "perm" ? { ...it, done } : it.k === "ask" ? { ...it, done: true } : it));
  };
  const setModel = (model: string) => { api.invoke("claude:control", { subtype: "set_model", model: model || null }); api.invoke("state:set", { model }).then(setState); setSession((s) => ({ ...s, model })); };
  const setMode = (mode: PermissionMode) => { api.invoke("claude:control", { subtype: "set_permission_mode", mode }); api.invoke("state:set", { permissionMode: mode }).then(setState); setSession((s) => ({ ...s, mode })); };
  const setEffort = (effort: string) => { api.invoke("state:set", { effort }).then(setState); if (effort) send(`/effort ${effort}`, []); };
  const stop = () => { stoppedRef.current = true; api.invoke("claude:stop"); };
  const pickFolder = async () => { const d = await api.invoke("file:pickFolder", stateRef.current!.workspace); if (d) { setState(await api.invoke("state:set", { workspace: d })); setTimeout(() => start(), 0); } };

  return { items, running, status, session, commands, cost, loginNeeded, state, attached, setAttached, start, send, respond, setModel, setMode, setEffort, stop, pickFolder };
}

export type Chat = ReturnType<typeof useChat>;

const hint = (name: string, input: any) => {
  if (!input) return "";
  if (name === "Bash") return input.command;
  if (input.file_path) return input.file_path;
  if (name.startsWith("mcp__canvas__")) return input.elements ? `${input.elements.length} elements` : input.definition ? input.definition.split("\n")[0] : input.ids ? input.ids.join(",") : "";
  if (input.description) return input.description;
  if (input.pattern) return input.pattern;
  const v = Object.values(input).find((v) => typeof v === "string");
  return typeof v === "string" ? v : "";
};

function ToolCard({ it }: { it: Extract<Item, { k: "tool" }> }) {
  const name = it.name.replace(/^mcp__canvas__/, "canvas: ").replace(/^mcp__/, "");
  const input = Object.keys(it.input ?? {}).length ? it.input : (() => { try { return JSON.parse(it.partial); } catch { return it.partial; } })();
  return (
    <details className={"tool" + (it.isError ? " err" : "") + (it.parent ? " child" : "")}>
      <summary><span className={"dot " + (it.result === undefined ? "running" : it.isError ? "error" : "ok")} /><span className="name">{name}</span><span className="hint">{hint(it.name, input)}</span></summary>
      <pre>{typeof input === "string" ? input : JSON.stringify(input, null, 1)}</pre>
      {it.result !== undefined && <pre className="result">{it.result.slice(0, 6000)}</pre>}
    </details>
  );
}

function PermCard({ it, respond }: { it: Extract<Item, { k: "perm" }>; respond: Chat["respond"] }) {
  const [msg, setMsg] = useState("");
  if (it.done) return <div className="msg info">{it.toolName}: {it.done}</div>;
  const always = it.suggestions.length ? it.suggestions : [{ type: "addRules", rules: [{ toolName: it.toolName }], behavior: "allow", destination: "userSettings" }];
  return (
    <div className="card">
      <h4>Allow {it.toolName}?</h4>
      {it.description && <div>{it.description}</div>}
      <pre>{it.toolName === "Bash" ? it.input.command : JSON.stringify(it.input, null, 1)}</pre>
      <div className="row">
        <button className="primary" onClick={() => respond(it.id, { behavior: "allow", updatedInput: it.input }, "allowed")}>Allow</button>
        <button onClick={() => respond(it.id, { behavior: "allow", updatedInput: it.input, updatedPermissions: always }, "always allowed")}>Always allow</button>
        <button onClick={() => respond(it.id, { behavior: "deny", message: msg || "User denied this action" }, "denied")}>Deny</button>
      </div>
      <div className="row"><input placeholder="Tell the agent what to do instead (optional)" value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
    </div>
  );
}

function AskCard({ it, respond }: { it: Extract<Item, { k: "ask" }>; respond: Chat["respond"] }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  if (it.done) return <div className="msg info">Question answered</div>;
  const toggle = (q: any, label: string) => setAnswers((a) => { const cur = a[q.question] ?? []; return { ...a, [q.question]: q.multiSelect ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label] }; });
  const submit = () => {
    const out: Record<string, string> = {};
    for (const q of it.questions) out[q.question] = other[q.question]?.trim() || (answers[q.question] ?? []).join(", ");
    respond(it.id, { behavior: "allow", updatedInput: { questions: it.questions, answers: out } }, "");
  };
  return (
    <div className="card">
      {it.questions.map((q: any) => (
        <div key={q.question}>
          <h4>{q.header}: {q.question}</h4>
          <div className="row">
            {q.options.map((o: any) => <button key={o.label} title={o.description} className={(answers[q.question] ?? []).includes(o.label) ? "sel" : ""} onClick={() => toggle(q, o.label)}>{o.label}</button>)}
          </div>
          <div className="row"><input placeholder="Other…" value={other[q.question] ?? ""} onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))} /></div>
        </div>
      ))}
      <div className="row"><button className="primary" onClick={submit}>Answer</button></div>
    </div>
  );
}

export function ChatPanel({ chat }: { chat: Chat }) {
  const { items, running, status, session, commands, cost, loginNeeded, state, attached, setAttached } = chat;
  const [input, setInput] = useState("");
  const [images, setImages] = useState<ImageBlock[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [active, setActive] = useState(0);
  const log = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addImage = (f: File) => {
    const r = new FileReader();
    r.onload = () => setImages((im) => [...im, { type: "image", source: { type: "base64", media_type: f.type, data: String(r.result).split(",")[1] } }]);
    r.readAsDataURL(f);
  };

  useEffect(() => { const el = log.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight; }, [items]);
  useEffect(() => { if (attached.length) ta.current?.focus(); }, [attached]);

  const slash = input.startsWith("/") && !/\s/.test(input) ? commands.filter((c) => c.name.startsWith(input.slice(1))).slice(0, 12) : [];
  const submit = () => { const t = input.trim(); if (!t) return; chat.send(t, images); setInput(""); setImages([]); };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setActive((a) => (a + (e.key === "ArrowDown" ? 1 : slash.length - 1)) % slash.length); return; }
    if (slash.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) { e.preventDefault(); setInput(`/${slash[active].name} `); setActive(0); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === "Escape") setInput("");
  };
  const onPaste = (e: React.ClipboardEvent) => {
    for (const f of Array.from(e.clipboardData.files)) { if (f.type.startsWith("image/")) { e.preventDefault(); addImage(f); } }
  };
  const openSessions = async () => setSessions(sessions ? null : await api.invoke("sessions:list", state!.workspace));
  const mode = session.mode ?? state?.permissionMode ?? "default";

  return (
    <div className="chat">
      <Sidebar.Header>
        <div className="agent-title">
          <button className="menu" onClick={openSessions} title="Sessions" aria-label="Sessions">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <span className="title">Claude</span>
          <button className="new" onClick={() => chat.start()} title="New session">+</button>
        </div>
      </Sidebar.Header>
      {sessions && (
        <div className="sessions">
          {sessions.length === 0 && <div>No sessions in this folder yet</div>}
          {sessions.map((s) => <div key={s.id} className={s.id === session.id ? "cur" : ""} onClick={() => { setSessions(null); chat.start(s.id); }}><span>{s.title}</span><small>{new Date(s.mtime).toLocaleString()}</small></div>)}
        </div>
      )}
      {loginNeeded && (
        <div className="chat-banner">Not logged in. Run <code>claude login</code> in Terminal.
          <button onClick={() => api.invoke("shell:terminal", "claude login")}>Open Terminal</button>
          <button onClick={() => chat.start(session.id)}>Retry</button>
        </div>
      )}
      <div className="chat-log" ref={log}>
        {items.length === 0 && <div className="msg info">Ask for an explanation. The agent answers on the canvas. Select elements and press "Ask agent" to talk about them. Type / for commands.</div>}
        {items.map((it) => {
          switch (it.k) {
            case "user": return <div key={it.id} className="msg user">{it.text}{it.images.map((src, i) => <img key={i} src={src} style={{ display: "block", maxWidth: "100%", marginTop: 4 }} />)}</div>;
            case "text": return it.text ? <div key={it.id} className={"msg text" + (it.parent ? " child" : "")}>{it.text}</div> : null;
            case "thinking": return <div key={it.id} className="thinking">{it.done ? "Thought" : "Thinking…"}{it.text ? `: ${it.text.slice(0, 300)}` : ""}</div>;
            case "tool": return <ToolCard key={it.id} it={it} />;
            case "perm": return <PermCard key={it.id} it={it} respond={chat.respond} />;
            case "ask": return <AskCard key={it.id} it={it} respond={chat.respond} />;
            case "info": return <div key={it.id} className={"msg info" + (it.level === "warning" ? " error" : "")}>{it.text}</div>;
            case "result": return <div key={it.id} className="msg error">{it.error}</div>;
          }
        })}
      </div>
      <div className="composer">
        <div className="chips">
          <button className="chip" onClick={chat.pickFolder} title={`Agent folder: ${state?.workspace}`}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 6h6l2 2h10v11H3z" /></svg>
            {state?.workspace.split("/").pop()}
          </button>
          {session.id && <span className="chip" title={session.id}>#{session.id.slice(0, 8)}</span>}
          {attached.length > 0 && <span className="chip active">{attached.length} elements attached <button onClick={() => setAttached([])}>×</button></span>}
          {images.map((im, i) => <span key={i} className="chip"><img src={`data:${im.source.media_type};base64,${im.source.data}`} /><button onClick={() => setImages(images.filter((_, j) => j !== i))}>×</button></span>)}
        </div>
        <div className="chat-input">
          {slash.length > 0 && (
            <div className="popup">{slash.map((c, i) => <div key={c.name} className={i === active ? "active" : ""} onMouseDown={() => { setInput(`/${c.name} `); setActive(0); }}>/{c.name} <span>{c.description}</span></div>)}</div>
          )}
          <textarea ref={ta} value={input} placeholder={attached.length ? "Ask about the attached elements" : "Describe a diagram or ask a question"} onChange={(e) => { setInput(e.target.value); setActive(0); }} onKeyDown={onKey} onPaste={onPaste} rows={2} />
          {running ? <button className="stop" onClick={chat.stop} title="Interrupt the agent">Stop</button> : <button className="enter" onClick={submit} title="Send (Enter)">↵</button>}
        </div>
        <div className="composer-foot">
          <button className="plain plus" onClick={() => fileRef.current?.click()} title="Attach an image">+</button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { for (const f of Array.from(e.target.files ?? [])) addImage(f); e.target.value = ""; }} />
          <Picker title="Permission mode" value={mode} options={MODES.map((m) => [m, MODE_LABELS[m]])} onChange={(v) => chat.setMode(v as PermissionMode)} />
          <span className="spacer" />
          <Picker title="Model" value={session.model ?? state?.model ?? ""} options={[...new Set([...MODELS, session.model ?? ""])].map((m) => [m, shortModel(m)])} onChange={chat.setModel} />
          <Picker title="Effort" value={state?.effort ?? ""} options={EFFORTS.map((m) => [m, m || "effort"])} onChange={chat.setEffort} />
          <span className={"dot " + (running ? "running" : "ok")} title={`${status ?? (running ? "working" : "idle")} · $${cost.toFixed(2)} this session`} />
        </div>
      </div>
    </div>
  );
}
