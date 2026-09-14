import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { CANVAS_SERVER, SYSTEM_PROMPT, TOOLS } from "../shared/tools";
import type { StartOpts, UserContent } from "../shared/types";

declare const __AGENT_DIR__: string; // <repo>/agent, baked at build time like __DATA_DIR__
const PLUGIN_DIR = path.join(__AGENT_DIR__, "diagram-design");

/** GUI apps get a minimal PATH; look in the usual places for the user's claude install. */
export function findClaude(): string {
  const home = os.homedir();
  const dirs = [...(process.env.PATH ?? "").split(":"), "/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".local/bin"), path.join(home, ".claude/local")];
  return dirs.map((d) => path.join(d, "claude")).find((p) => fs.existsSync(p)) ?? "claude";
}

export const spawnEnv = () => ({
  ...process.env,
  PATH: [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local/bin")].filter(Boolean).join(":"),
});

export type CanvasCall = (tool: string, args: any) => Promise<any>;
type Handlers = { onEvent: (msg: any) => void; onCanvas: CanvasCall };

/** Minimal MCP server over JSON-RPC: initialize, tools/list, tools/call. Shared by the claude -p stdio path and the localhost HTTP bridge. */
export async function handleMcp(msg: any, onCanvas: CanvasCall): Promise<any> {
  if (msg.id === undefined) return { jsonrpc: "2.0", result: {}, id: 0 }; // notification
  let result: unknown;
  try {
    switch (msg.method) {
      case "initialize":
        result = { protocolVersion: msg.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: CANVAS_SERVER, version: "1" } };
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        const out = await onCanvas(msg.params.name, msg.params.arguments ?? {});
        result = { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] };
        break;
      }
      default:
        result = {};
    }
    return { jsonrpc: "2.0", id: msg.id, result };
  } catch (e: any) {
    return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Error: ${e?.message ?? e}` }], isError: true } };
  }
}

/** Streamable HTTP MCP endpoint on localhost so other Claude Code clients (Zed, CLI, VS Code) can use the canvas tools. Explainer must be running. */
export function serveMcp(port: number, onCanvas: CanvasCall) {
  const srv = http.createServer((req, res) => {
    if (req.url !== "/mcp") { res.writeHead(404).end(); return; }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end(); return; } // no server-push stream: request/reply only
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      let msg: any;
      try { msg = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      const out = await handleMcp(msg, onCanvas);
      if (msg.id === undefined) { res.writeHead(202).end(); return; }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
    });
  });
  srv.on("error", (e) => console.error(`mcp bridge: ${e.message}`)); // e.g. port taken by a second Explainer; the app still works without the bridge
  srv.listen(port, "127.0.0.1");
  return srv;
}

/** One long-lived `claude -p` process speaking stream-json on stdin/stdout. */
export class ClaudeSession {
  private proc: ChildProcess;
  private reqId = 0;
  private closed = false;

  constructor(opts: StartOpts, private h: Handlers) {
    const args = [
      "-p", "--output-format", "stream-json", "--verbose", "--input-format", "stream-json", "--include-partial-messages",
      "--permission-prompt-tool", "stdio",
      "--mcp-config", JSON.stringify({ mcpServers: { [CANVAS_SERVER]: { type: "sdk", name: CANVAS_SERVER, alwaysLoad: true } } }),
      "--plugin-dir", PLUGIN_DIR,
      // canvas tools always; reading the skill references must not prompt in default mode
      "--allowedTools", `mcp__${CANVAS_SERVER}__*`, `Read(${PLUGIN_DIR}/**)`,
      "--append-system-prompt", SYSTEM_PROMPT,
      "--permission-mode", opts.permissionMode ?? "default",
    ];
    if (opts.model) args.push("--model", opts.model);
    if (opts.effort) args.push("--effort", opts.effort);
    if (opts.resume) args.push("--resume", opts.resume);
    if (opts.resume && opts.fork) args.push("--fork-session");
    fs.mkdirSync(opts.cwd, { recursive: true });
    this.proc = spawn(findClaude(), args, { cwd: opts.cwd, env: spawnEnv(), stdio: ["pipe", "pipe", "pipe"] });
    readline.createInterface({ input: this.proc.stdout! }).on("line", (l) => this.onLine(l));
    this.proc.stderr!.on("data", (d) => h.onEvent({ type: "stderr", text: String(d) }));
    this.proc.on("exit", (code) => { if (!this.closed) h.onEvent({ type: "exit", code }); });
    this.write({ type: "control_request", request_id: "init", request: { subtype: "initialize", sdkMcpServers: [CANVAS_SERVER] } });
  }

  private write(o: unknown) {
    if (this.proc.stdin?.writable) this.proc.stdin.write(JSON.stringify(o) + "\n");
  }

  private onLine(line: string) {
    let m: any;
    try { m = JSON.parse(line); } catch { return this.h.onEvent({ type: "stderr", text: line }); }
    if (m.type === "control_request" && m.request?.subtype === "mcp_message") return void this.mcp(m.request_id, m.request.message);
    this.h.onEvent(m); // renderer answers can_use_tool via respond()
  }

  private async mcp(requestId: string, msg: any) {
    const mcp_response = await handleMcp(msg, this.h.onCanvas);
    this.write({ type: "control_response", response: { subtype: "success", request_id: requestId, response: { mcp_response } } });
  }

  send(content: UserContent) {
    this.write({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" });
  }

  control(request: Record<string, unknown>) {
    this.write({ type: "control_request", request_id: `r${++this.reqId}`, request });
  }

  respond(requestId: string, response: Record<string, unknown>) {
    const r = "error" in response ? { subtype: "error", request_id: requestId, error: String(response.error) } : { subtype: "success", request_id: requestId, response };
    this.write({ type: "control_response", response: r });
  }

  kill() {
    this.closed = true;
    this.proc.stdin?.end();
    setTimeout(() => this.proc.kill("SIGTERM"), 500);
  }
}
