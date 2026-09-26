import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { serveMcp } from "./mcp";
import { shareScene } from "./share";
import type { AppState, DrawingInfo, DrawingList } from "../shared/types";

declare const __DATA_DIR__: string;
const DATA = process.env.EXPLAINER_DATA ?? __DATA_DIR__;
const DIRS = { drawings: path.join(DATA, "drawings"), app: path.join(DATA, "app") };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
const STATE_FILE = path.join(DIRS.app, "state.json");
const DEFAULTS: AppState = {};
const readState = (): AppState => { try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch { return { ...DEFAULTS }; } };
const writeState = (s: AppState) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
const MCP_PORT = Number(process.env.EXPLAINER_MCP_PORT ?? 7331); // `claude mcp add --transport http explainer http://127.0.0.1:7331/mcp --scope user`
const FILTERS = [{ name: "Excalidraw", extensions: ["excalidraw", "json"] }];

app.setName("Explainer"); // menu bar and About; the Dock label of the dev binary stays "Electron" until the app is packaged
app.whenReady().then(() => { try { app.dock?.setIcon(path.join(__dirname, "../../build/icon.png")); } catch { /* packaged: the bundle has its own icon */ } }); // dev Dock icon
if (process.env.EXPLAINER_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.EXPLAINER_DEBUG_PORT);

let win: BrowserWindow;
const pendingCanvas = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, title: "Explainer",
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 12 }, // the tab bar is the title bar, Figma style
    webPreferences: { preload: path.join(__dirname, "../preload/index.js"), contextIsolation: true, sandbox: false },
  });
  win.maximize(); // Excalidraw docks the sidebar only above ~1229px editor width
  // page zoom stays fixed: pinch and Cmd+wheel must zoom the canvas (Excalidraw), not the UI
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(1));
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

// ---- ipc
ipcMain.handle("state:get", () => readState());
ipcMain.handle("state:set", (_e, patch: Partial<AppState>) => {
  const cur = readState();
  const next = { ...cur, ...patch };
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
  const st = readState();
  writeState({ ...st, created: { ...(st.created ?? {}), [p]: Date.now() } });
  return p;
});

// ---- drawings gallery: data/drawings/<folder?>/<name>.excalidraw, thumbnails in data/drawings/.thumbs
const EXT = ".excalidraw";
const THUMBS = path.join(DIRS.drawings, ".thumbs");
const safeName = (n: string) => n.replace(/[\/\\:]/g, "-").replace(/\.excalidraw$/i, "").trim();
const thumbFile = (p: string, mtime: number) => path.join(THUMBS, `${createHash("md5").update(p).digest("hex")}-${Math.round(mtime)}.jpg`);
/** A drawing moved: its creation time and the last-file pointer follow it. */
function retarget(from: string, to: string | null) {
  const st = readState();
  const created = { ...(st.created ?? {}) };
  const born = created[from];
  delete created[from];
  if (to && born) created[to] = born;
  writeState({ ...st, created, lastFile: st.lastFile === from ? to ?? undefined : st.lastFile });
}
/** Time of the oldest .history copy of a drawing: the atomic save replaces the inode, so this beats the file's birth time. */
function oldestBackup(p: string): number | null {
  const dir = path.join(path.dirname(p), ".history"), base = path.basename(p, EXT) + "-";
  if (!fs.existsSync(dir)) return null;
  const stamps = fs.readdirSync(dir).filter((f) => f.startsWith(base)).map((f) => Date.parse(f.slice(base.length, base.length + 24).replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1T$2:$3:$4.$5Z"))).filter((t) => !Number.isNaN(t));
  return stamps.length ? Math.min(...stamps) : null;
}
function listDrawings(): DrawingList {
  const st = readState();
  const created = { ...(st.created ?? {}) };
  let learned = false;
  const info = (p: string, folder: string | null): DrawingInfo => {
    const st2 = fs.statSync(p);
    if (!created[p]) { created[p] = Math.min(st2.birthtimeMs || st2.mtimeMs, oldestBackup(p) ?? Infinity); learned = true; }
    return { path: p, name: path.basename(p, EXT), folder, mtime: st2.mtimeMs, ctime: created[p] };
  };
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
  if (learned) writeState({ ...readState(), created });
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
const folderFiles = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith(EXT)).map((f) => path.join(dir, f));
ipcMain.handle("drawings:renameFolder", (_e, name: string, next: string) => {
  const from = path.join(DIRS.drawings, safeName(name)), to = path.join(DIRS.drawings, safeName(next));
  if (from === to) return;
  if (fs.existsSync(to)) throw new Error(`${safeName(next)} already exists`);
  const files = folderFiles(from);
  fs.renameSync(from, to);
  for (const f of files) retarget(f, path.join(to, path.basename(f)));
});
ipcMain.handle("drawings:deleteFolder", async (_e, name: string) => {
  const dir = path.join(DIRS.drawings, safeName(name));
  const files = folderFiles(dir);
  await shell.trashItem(dir);
  for (const f of files) retarget(f, null);
});
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

const callCanvas = (tool: string, args: any) => new Promise<any>((resolve, reject) => {
  const callId = randomUUID();
  pendingCanvas.set(callId, { resolve, reject });
  win.webContents.send("canvas:call", { callId, tool, args });
  setTimeout(() => { if (pendingCanvas.delete(callId)) reject(new Error(`canvas did not answer ${tool} within 60s (window reloaded?)`)); }, 60_000);
});
ipcMain.on("canvas:result", (_e, { callId, result, error }: { callId: string; result?: any; error?: string }) => {
  const p = pendingCanvas.get(callId);
  if (!p) return;
  pendingCanvas.delete(callId);
  error ? p.reject(new Error(error)) : p.resolve(result);
});
ipcMain.handle("share:post", (_e, json: string) => shareScene(json));

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

app.whenReady().then(() => { Menu.setApplicationMenu(menu); createWindow(); serveMcp(MCP_PORT, callCanvas); });
app.on("window-all-closed", () => app.quit());
