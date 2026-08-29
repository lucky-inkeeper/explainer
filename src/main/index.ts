import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeSession } from "./claude";
import { shareScene } from "./share";
import type { AppState, DrawingInfo, DrawingList, SessionInfo, StartOpts } from "../shared/types";

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
  // page zoom stays fixed: pinch and Cmd+wheel must zoom the canvas (Excalidraw), not the UI
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(1));
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
const liveCount = (text: string) => { try { return (JSON.parse(text).elements ?? []).filter((e: any) => !e.isDeleted).length; } catch { return -1; } };
const lastBackup = new Map<string, number>();
/** Atomic write; the previous version is kept in .history when the scene shrinks by more than 30 percent or is emptied, and at most every 5 min otherwise. */
ipcMain.handle("file:write", (_e, p: string, text: string) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p)) {
    const prev = fs.readFileSync(p, "utf8");
    const prevLive = liveCount(prev), nextLive = liveCount(text), now = Date.now();
    const emptying = prevLive > 0 && nextLive === 0;
    const shrinking = prevLive > 0 && nextLive >= 0 && nextLive < prevLive * 0.7;
    if (prev !== text && prevLive > 0 && (emptying || shrinking || now - (lastBackup.get(p) ?? 0) > 5 * 60_000)) {
      const dir = path.join(path.dirname(p), ".history");
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
      fs.writeFileSync(path.join(dir, `${path.basename(p, ".excalidraw")}-${stamp}${emptying ? "-before-clear" : shrinking ? "-before-shrink" : ""}.excalidraw`), prev);
      lastBackup.set(p, now);
      const old = fs.readdirSync(dir).filter((f) => f.startsWith(path.basename(p, ".excalidraw") + "-")).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 30))) fs.unlinkSync(path.join(dir, f));
    }
  }
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
});
ipcMain.handle("file:new", (_e, folder?: string | null) => {
  const dir = folder ? path.join(DIRS.drawings, safeName(folder)) : DIRS.drawings;
  fs.mkdirSync(dir, { recursive: true });
  let p = "", i = 0;
  do { p = path.join(dir, `Untitled${i ? "-" + i : ""}.excalidraw`); i++; } while (fs.existsSync(p));
  fs.writeFileSync(p, JSON.stringify({ type: "excalidraw", version: 2, source: "explainer", elements: [], appState: {}, files: {} }));
  return p;
});

// ---- drawings gallery: data/drawings/<folder?>/<name>.excalidraw, thumbnails in data/drawings/.thumbs
const EXT = ".excalidraw";
const THUMBS = path.join(DIRS.drawings, ".thumbs");
const safeName = (n: string) => n.replace(/[\/\\:]/g, "-").replace(/\.excalidraw$/i, "").trim();
const thumbFile = (p: string, mtime: number) => path.join(THUMBS, `${createHash("md5").update(p).digest("hex")}-${Math.round(mtime)}.jpg`);
/** A drawing moved: its agent session and the last-file pointer follow it. */
function retarget(from: string, to: string | null) {
  const st = readState();
  const sessions = { ...st.sessions };
  const sid = sessions[from];
  delete sessions[from];
  if (to && sid) sessions[to] = sid;
  writeState({ ...st, sessions, lastFile: st.lastFile === from ? to ?? undefined : st.lastFile });
}
function listDrawings(): DrawingList {
  const st = readState();
  const info = (p: string, folder: string | null): DrawingInfo => ({ path: p, name: path.basename(p, EXT), folder, mtime: fs.statSync(p).mtimeMs, hasSession: !!st.sessions[p] });
  const files: DrawingInfo[] = [], folders: string[] = [];
  for (const e of fs.readdirSync(DIRS.drawings, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      folders.push(e.name);
      for (const f of fs.readdirSync(path.join(DIRS.drawings, e.name))) if (f.endsWith(EXT)) files.push(info(path.join(DIRS.drawings, e.name, f), e.name));
    } else if (e.name.endsWith(EXT)) files.push(info(path.join(DIRS.drawings, e.name), null));
  }
  files.sort((a, b) => b.mtime - a.mtime);
  folders.sort((a, b) => a.localeCompare(b));
  return { folders, files };
}
const moveDrawing = (from: string, to: string) => {
  if (from === to) return to;
  if (fs.existsSync(to)) throw new Error(`${path.basename(to, EXT)} already exists there`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  retarget(from, to);
  return to;
};
ipcMain.handle("drawings:list", () => listDrawings());
ipcMain.handle("drawings:rename", (_e, p: string, name: string) => moveDrawing(p, path.join(path.dirname(p), safeName(name) + EXT)));
ipcMain.handle("drawings:move", (_e, p: string, folder: string | null) => moveDrawing(p, path.join(folder ? path.join(DIRS.drawings, safeName(folder)) : DIRS.drawings, path.basename(p))));
ipcMain.handle("drawings:delete", async (_e, p: string) => { await shell.trashItem(p); retarget(p, null); });
ipcMain.handle("drawings:newFolder", (_e, name: string) => { fs.mkdirSync(path.join(DIRS.drawings, safeName(name)), { recursive: true }); });
ipcMain.handle("drawings:thumb", (_e, p: string, mtime: number) => {
  const f = thumbFile(p, mtime);
  return fs.existsSync(f) ? `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}` : null;
});
ipcMain.handle("drawings:thumbSet", (_e, p: string, mtime: number, dataUrl: string) => {
  fs.mkdirSync(THUMBS, { recursive: true });
  const f = thumbFile(p, mtime), prefix = path.basename(f).split("-")[0];
  for (const old of fs.readdirSync(THUMBS)) if (old.startsWith(prefix + "-")) fs.unlinkSync(path.join(THUMBS, old)); // one thumbnail per file
  fs.writeFileSync(f, Buffer.from(dataUrl.split(",")[1], "base64"));
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
      setTimeout(() => { if (pendingCanvas.delete(callId)) reject(new Error(`canvas did not answer ${tool} within 60s (window reloaded?)`)); }, 60_000);
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

// no zoomIn/zoomOut/resetZoom roles: Cmd+= Cmd+- Cmd+0 belong to Excalidraw's canvas zoom
const menu = Menu.buildFromTemplate([
  { role: "appMenu" },
  { role: "fileMenu" },
  { role: "editMenu" },
  { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }] },
  { role: "windowMenu" },
]);

// heartbeat: a stalled event loop in either process shows up in the log with its length
let beat = Date.now();
setInterval(() => { const now = Date.now(), lag = now - beat - 1000; if (lag > 300) console.error(`[main] event loop stalled ${lag}ms`); beat = now; }, 1000);
ipcMain.on("log:stall", (_e, where: string, ms: number) => console.error(`[${where}] stalled ${ms}ms`));

app.whenReady().then(() => { Menu.setApplicationMenu(menu); createWindow(); });
app.on("window-all-closed", () => { session?.kill(); app.quit(); });
