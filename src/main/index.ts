import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeSession } from "./claude";
import { shareScene } from "./share";
import type { AppState, SessionInfo, StartOpts } from "../shared/types";

declare const __DATA_DIR__: string;
const DATA = process.env.EXPLAINER_DATA ?? __DATA_DIR__;
const DIRS = { drawings: path.join(DATA, "drawings"), workspace: path.join(DATA, "workspace"), app: path.join(DATA, "app") };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
const STATE_FILE = path.join(DIRS.app, "state.json");
const DEFAULTS: AppState = { workspace: DIRS.workspace, permissionMode: "default", sessions: {} };
const readState = (): AppState => { try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch { return { ...DEFAULTS }; } };
const writeState = (s: AppState) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
const FILTERS = [{ name: "Excalidraw", extensions: ["excalidraw", "json"] }];

if (process.env.EXPLAINER_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.EXPLAINER_DEBUG_PORT);

let win: BrowserWindow;
let session: ClaudeSession | null = null;
const pendingCanvas = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, title: "Explainer",
    webPreferences: { preload: path.join(__dirname, "../preload/index.js"), contextIsolation: true, sandbox: false },
  });
  win.maximize(); // Excalidraw docks the sidebar only above ~1229px editor width
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

// ---- sessions on disk (claude writes ~/.claude/projects/<cwd-slug>/<id>.jsonl)
const projectsDir = path.join(os.homedir(), ".claude", "projects");
const slug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");
const findTranscript = (id: string, cwd: string) => {
  const direct = path.join(projectsDir, slug(cwd), `${id}.jsonl`);
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(projectsDir)) return null;
  for (const d of fs.readdirSync(projectsDir)) { const p = path.join(projectsDir, d, `${id}.jsonl`); if (fs.existsSync(p)) return p; }
  return null;
};
const parseLines = (p: string) => fs.readFileSync(p, "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const titleOf = (msgs: any[]) => {
  for (const m of msgs) {
    if (m.type === "summary" && m.summary) return String(m.summary).slice(0, 60);
    if (m.type === "user" && !m.isMeta) {
      const c = m.message?.content;
      const t: string | undefined = typeof c === "string" ? c : c?.find?.((b: any) => b.type === "text")?.text;
      if (t && !t.startsWith("<")) return t.replace(/\s+/g, " ").slice(0, 60);
    }
  }
  return null;
};
function listSessions(cwd: string): SessionInfo[] {
  const dir = path.join(projectsDir, slug(cwd));
  if (!fs.existsSync(dir)) return [];
  // ponytail: reads every transcript fully for a title; index it if the list ever feels slow
  return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => {
    const p = path.join(dir, f);
    return { id: f.slice(0, -6), title: titleOf(parseLines(p)) ?? f.slice(0, 8), mtime: fs.statSync(p).mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime);
}

// ---- ipc
ipcMain.handle("state:get", () => readState());
ipcMain.handle("state:set", (_e, patch: Partial<AppState>) => {
  const cur = readState();
  const next = { ...cur, ...patch, sessions: { ...cur.sessions, ...(patch.sessions ?? {}) } };
  writeState(next);
  return next;
});
ipcMain.handle("file:read", (_e, p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null));
ipcMain.handle("file:write", (_e, p: string, text: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); });
ipcMain.handle("file:new", () => {
  let p = "", i = 0;
  do { p = path.join(DIRS.drawings, `Untitled${i ? "-" + i : ""}.excalidraw`); i++; } while (fs.existsSync(p));
  fs.writeFileSync(p, JSON.stringify({ type: "excalidraw", version: 2, source: "explainer", elements: [], appState: {}, files: {} }));
  return p;
});
ipcMain.handle("file:openDialog", async () => (await dialog.showOpenDialog(win, { defaultPath: DIRS.drawings, filters: FILTERS, properties: ["openFile"] })).filePaths[0] ?? null);
ipcMain.handle("file:saveAsDialog", async (_e, cur: string) => (await dialog.showSaveDialog(win, { defaultPath: cur || DIRS.drawings, filters: FILTERS })).filePath || null);
ipcMain.handle("file:pickFolder", async (_e, cur: string) => (await dialog.showOpenDialog(win, { defaultPath: cur, properties: ["openDirectory", "createDirectory"] })).filePaths[0] ?? null);

ipcMain.handle("claude:start", (_e, opts: StartOpts) => {
  session?.kill();
  session = new ClaudeSession(opts, {
    onEvent: (m) => win.webContents.send("claude:event", m),
    onCanvas: (tool, args) => new Promise((resolve, reject) => {
      const callId = randomUUID();
      pendingCanvas.set(callId, { resolve, reject });
      win.webContents.send("canvas:call", { callId, tool, args });
    }),
  });
});
ipcMain.on("canvas:result", (_e, { callId, result, error }: { callId: string; result?: any; error?: string }) => {
  const p = pendingCanvas.get(callId);
  if (!p) return;
  pendingCanvas.delete(callId);
  error ? p.reject(new Error(error)) : p.resolve(result);
});
ipcMain.handle("claude:send", (_e, content) => session?.send(content));
ipcMain.handle("claude:control", (_e, request) => session?.control(request));
ipcMain.handle("claude:respond", (_e, id: string, response) => session?.respond(id, response));
ipcMain.handle("claude:stop", () => session?.control({ subtype: "interrupt" }));
ipcMain.handle("sessions:list", (_e, cwd: string) => listSessions(cwd));
ipcMain.handle("sessions:transcript", (_e, id: string, cwd: string) => {
  const p = findTranscript(id, cwd);
  return p ? parseLines(p).filter((m) => (m.type === "user" || m.type === "assistant") && !m.isMeta) : [];
});
ipcMain.handle("share:post", (_e, json: string) => shareScene(json));
ipcMain.handle("shell:terminal", (_e, cmd: string) =>
  execFile("osascript", ["-e", 'tell application "Terminal" to activate', "-e", `tell application "Terminal" to do script "${cmd}"`]));
ipcMain.handle("shell:openExternal", (_e, url: string) => shell.openExternal(url));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { session?.kill(); app.quit(); });
