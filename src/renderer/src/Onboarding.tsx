import { useEffect, useState } from "react";
import { api } from "./api";
import { CLIENTS, Code } from "./Settings";
import type { McpStatus } from "../../shared/types";

/** MCP bridge status, live: the main process sends mcp:status when the bridge toggles or a client connects. */
export function useMcp() {
  const [s, setS] = useState<McpStatus | null>(null);
  useEffect(() => {
    api.invoke("mcp:get").then(setS, () => {});
    try { return api.on("mcp:status", setS); } catch { return undefined; }
  }, []);
  return s;
}

const turnOn = () => api.invoke("mcp:set", true);

/** First launch: connect an MCP client. Waits until a client sends initialize, then shows a first prompt. Skip closes it; the banner stays until a client connects. */
export function Onboarding({ s, onClose }: { s: McpStatus | null; onClose: () => void }) {
  const [client, setClient] = useState(0);
  const url = `http://127.0.0.1:${s?.port ?? 7331}/mcp`;
  const c = CLIENTS[client];
  return (
    <div className="onb-back">
      <div className="onb" role="dialog" aria-modal="true" aria-labelledby="onb-title">
        <h2 id="onb-title">{s?.client ? "Connected" : "Connect your AI agent"}</h2>
        {s?.client ? (<>
          <p className="sdim"><b>{s.client}</b> is connected. Ask it a question and tell it to draw, for example:</p>
          <Code text="How does login work in this repo? Draw it." />
          <div className="onb-foot"><span /><button className="gprimary" onClick={onClose}>Start drawing</button></div>
        </>) : (<>
          <p className="sdim">Explainer draws the answers of your AI agent (Claude Code, Cursor, Codex, Gemini). Connect it once per computer.</p>
          {!s?.on ? (
            <div className="srow"><span><b>MCP Bridge</b><span className={"sstate" + (s?.error ? " bad" : "")}>{s?.error ? `Failed: ${s.error}` : "Off"}</span></span>
              <button className="gprimary" onClick={turnOn}>Turn on</button></div>
          ) : (<>
            <p className="slabel">1. Pick your agent</p>
            <div className="stabs" role="tablist">
              {CLIENTS.map((x, i) => <button key={x.name} role="tab" aria-selected={i === client} className={i === client ? "on" : ""} onClick={() => setClient(i)}>{x.name}</button>)}
            </div>
            <p className="slabel">2. {c.where}</p>
            <Code text={c.config(url)} />
            <p className="slabel">3. Start a new session of your agent (restart it if it is open)</p>
            <p className="onb-wait"><span className="onb-dot" /> Waiting for your agent to connect…</p>
          </>)}
          <div className="onb-foot"><span className="sdim">You can do this later in Settings.</span><button className="gsecondary" onClick={onClose}>Skip</button></div>
        </>)}
      </div>
    </div>
  );
}

/** Bottom-center banner after a skip: shown until an MCP client connects, or while the bridge is off. */
export function ConnectBanner({ s, onConnect }: { s: McpStatus; onConnect: () => void }) {
  return (
    <div className="onb-banner" role="status">
      <span>{s.on ? "No AI agent is connected. Connect one to draw here." : "The MCP bridge is off. AI agents cannot draw here."}</span>
      <button className="gprimary" onClick={s.on ? onConnect : turnOn}>{s.on ? "Connect" : "Turn on"}</button>
    </div>
  );
}

/** Short notice when an agent connects outside the onboarding (the banner just disappears otherwise). */
export function ConnectedToast({ client, onClose }: { client: string; onClose: () => void }) {
  return (
    <div className="onb-banner ok" role="status">
      <span><b>{client}</b> connected. Ask it to draw something.</span>
      <button className="gsecondary" onClick={onClose}>OK</button>
    </div>
  );
}
