import { useEffect, useState } from "react";
import { api } from "./api";
import type { McpStatus } from "../../shared/types";

/** Settings page: the MCP bridge that lets Claude Code draw here. Same switch as menu > Agent > MCP Bridge. The gear, Home or a tab closes it. */
export function Settings() {
  const [s, setS] = useState<McpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // an older app shell has no mcp channels (the UI deploys apart from the .app, ADR-0006)
    api.invoke("mcp:get").then(setS, () => setError("This version of the app has no MCP settings. Rebuild it with pnpm build."));
    try { return api.on("mcp:status", setS); } catch { return undefined; } // older preload throws on an unknown channel
  }, []);

  const url = `http://127.0.0.1:${s?.port ?? 7331}/mcp`;
  const [client, setClient] = useState(0);
  const state = !s ? "…" : s.on ? "On" : s.error ? `Failed: ${s.error}` : "Off";

  return (
    <div className="gallery settings">
      {error && <div className="gerror">{error}</div>}
      <section className="sset">
        <h2>MCP server</h2>
        <p className="sdim">Let AI agents (Claude Code, Cursor, Codex, Gemini and other MCP clients) draw on this canvas. The server listens on this computer only, and refuses requests from web pages.</p>
        <label className="srow">
          <span>
            <b>MCP Bridge</b>
            <span className={"sstate" + (s?.on ? " on" : s?.error ? " bad" : "")}>{state}</span>
          </span>
          <input type="checkbox" role="switch" className="sswitch" checked={!!s?.on} disabled={!s}
            onChange={(e) => api.invoke("mcp:set", e.target.checked).then(setS, (err) => setError(String(err?.message ?? err)))} />
        </label>
        {s?.on && (<>
          <p className="slabel">Server URL</p>
          <Code text={url} />
          <p className="slabel">Connect a client (once per Mac)</p>
          <div className="stabs" role="tablist">
            {CLIENTS.map((c, i) => <button key={c.name} role="tab" aria-selected={i === client} className={i === client ? "on" : ""} onClick={() => setClient(i)}>{c.name}</button>)}
          </div>
          <p className="sdim shint">{CLIENTS[client].where}</p>
          <Code text={CLIENTS[client].config(url)} />
          <p className="sdim shint">The agent gets the drawing rules from the server. A client that ignores MCP instructions can draw, but can break the notation.</p>
        </>)}
      </section>
    </div>
  );
}

const json = (o: unknown) => JSON.stringify(o, null, 2);
/** Setup per MCP client: where the config goes, and the text to paste. */
export const CLIENTS: { name: string; where: string; config: (url: string) => string }[] = [
  { name: "Claude Code", where: "Run in a terminal. Works in the CLI, Zed and VS Code.", config: (url) => `claude mcp add --transport http explainer ${url} --scope user` },
  { name: "Cursor", where: "Add to ~/.cursor/mcp.json.", config: (url) => json({ mcpServers: { explainer: { url } } }) },
  { name: "VS Code", where: "Add to .vscode/mcp.json, or run MCP: Open User Configuration.", config: (url) => json({ servers: { explainer: { type: "http", url } } }) },
  // ponytail: stdio through mcp-remote, because Codex 0.40 rejects `url` ("missing field `command`"); newer Codex takes `url = "..."`
  { name: "Codex", where: "Add to ~/.codex/config.toml. Needs Node.js (npx).", config: (url) => `[mcp_servers.explainer]\ncommand = "npx"\nargs = ["-y", "mcp-remote", "${url}"]` },
  { name: "Gemini CLI", where: "Add to ~/.gemini/settings.json.", config: (url) => json({ mcpServers: { explainer: { httpUrl: url } } }) },
  { name: "Other", where: "For a client that runs only local (stdio) servers: mcp-remote bridges stdio to this URL.", config: (url) => json({ mcpServers: { explainer: { command: "npx", args: ["-y", "mcp-remote", url] } } }) },
];

export function Code({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <div className="scode">
      <pre>{text}</pre>
      <button className="gsecondary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
