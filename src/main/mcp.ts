import http from "node:http";
import { CANVAS_SERVER, TOOLS } from "../shared/tools";

export type CanvasCall = (tool: string, args: any) => Promise<any>;

/** Minimal MCP server over JSON-RPC: initialize, tools/list, tools/call. Served by the localhost HTTP bridge. */
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
