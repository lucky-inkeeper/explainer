import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { insideDir, sameOrigin } from "./guard";
import { serveMcp } from "./mcp";
import { agentInstructions } from "../shared/tools";
import { diagramRules } from "./rules";
import { shareScene } from "./share";
import { del, put } from "@vercel/blob";
import type { AppState, DrawingInfo, DrawingList, McpStatus } from "../shared/types";

declare const __DATA_DIR__: string;
declare const __AGENT_DIR__: string;
const DATA = process.env.EXPLAINER_DATA ?? __DATA_DIR__;
const DIRS = { drawings: path.join(DATA, "drawings"), app: path.join(DATA, "app") };
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
const STATE_FILE = path.join(DIRS.app, "state.json");
const DEFAULTS: AppState = {};
const readState = (): AppState => { try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch { return { ...DEFAULTS }; } };
const writeState = (s: AppState) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
const MCP_PORT = Number(process.env.EXPLAINER_MCP_PORT ?? 7331); // `claude mcp add --transport http explainer http://127.0.0.1:7331/mcp --scope user`
const FILTERS = [{ name: "Excalidraw", extensions: ["excalidraw", "json"] }];
// the UI is served from Vercel (`pnpm deploy:web`); the .app is a shell around it and needs the internet to open
const UI_URL = process.env.ELECTRON_RENDERER_URL ?? process.env.EXPLAINER_UI_URL ?? "https://explainer-pearl.vercel.app";
const UI_ORIGIN = new URL(UI_URL).origin;

app.setName("Explainer"); // menu bar and About; the Dock label of the dev binary stays "Electron" until the app is packaged
app.whenReady().then(() => { try { app.dock?.setIcon(path.join(__dirname, "../../build/icon.png")); } catch { /* packaged: the bundle has its own icon */ } }); // dev Dock icon
if (process.env.EXPLAINER_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.EXPLAINER_DEBUG_PORT);

let win: BrowserWindow;
const pendingCanvas = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, title: "Explainer",
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 12 }, // the tab bar is the title bar, Figma style
    webPreferences: { preload: path.join(__dirname, "../preload/index.js"), contextIsolation: true, sandbox: true },
  });
  win.maximize(); // Excalidraw docks the sidebar only above ~1229px editor width
  // page zoom stays fixed: pinch and Cmd+wheel must zoom the canvas (Excalidraw), not the UI
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(1));
  // the page may only be the UI, or the offline page that links back to it; every other link opens in the browser
  win.webContents.on("will-navigate", (e, url) => { if (!sameOrigin(url, UI_ORIGIN)) { e.preventDefault(); if (url.startsWith("https://")) shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith("https://")) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: aborted by a newer load
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlinePage(desc))}`);
  });
  win.loadURL(UI_URL);
}
const offlinePage = (why: string) => `<!doctype html><title>Explainer</title><body style="font:15px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;margin:0;color:#333">
<div style="text-align:center"><h2>Explainer needs the internet to open</h2><p style="color:#777">${why.replace(/[<>&]/g, "")}</p><p>Your drawings are safe on this Mac.</p><a href="${UI_URL}">Try again</a></div>`;

// ---- ipc: every call must come from the UI origin (the UI is web content, see guard.ts)
type Handler = (e: IpcMainInvokeEvent, ...args: any[]) => unknown;
const handle = (ch: string, fn: Handler) => ipcMain.handle(ch, (e, ...args) => {
  if (!sameOrigin(e.senderFrame?.url, UI_ORIGIN)) throw new Error(`${ch}: blocked, the caller is not the Explainer UI`);
  return fn(e, ...args);
});
const listen = (ch: string, fn: (e: IpcMainEvent, ...args: any[]) => void) => ipcMain.on(ch, (e, ...args) => { if (sameOrigin(e.senderFrame?.url, UI_ORIGIN)) fn(e, ...args); });
// drawings live in data/drawings; a file outside it is reachable only after the user picked it in a dialog this session
const picked = new Set<string>();
const pick = (p: string | null | undefined) => { if (p) picked.add(path.resolve(p)); return p ?? null; };
const mayUse = (p: unknown) => insideDir(DIRS.drawings, p) || (typeof p === "string" && picked.has(path.resolve(p)));
const mustBeDrawing = (p: unknown) => { if (!insideDir(DIRS.drawings, p)) throw new Error(`not a drawing in ${DIRS.drawings}`); };

handle("state:get", () => readState());
handle("state:set", (_e, patch: Partial<AppState>) => {
  const cur = readState();
  const next = { ...cur, ...patch };
  writeState(next);
  return next;
});
handle("file:read", (_e, p: string) => (mayUse(p) && fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null));
const IMAGE_MAX = 4 * 1024 * 1024; // the dataURL is stored inside the .excalidraw file for good
/** Pixel size from the header: PNG IHDR, or the first JPEG SOF segment. */
function imageSize(b: Buffer): { mimeType: "image/png" | "image/jpeg"; width: number; height: number } {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { mimeType: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length && b[i] === 0xff; i += 2 + b.readUInt16BE(i + 2)) {
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mimeType: "image/jpeg", width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    throw new Error("JPEG without a size header");
  }
  throw new Error("not a PNG or JPEG (checked the file header)");
}
const checkSize = (b: Buffer) => { if (b.length > IMAGE_MAX) throw new Error(`image is ${(b.length / 1024 / 1024).toFixed(1)} MB; the limit is 4 MB (it is stored inside the drawing). Downscale or crop it first.`); };
/** draw_image paths come from the MCP client, which may read local files; the UI may not, so the main process reads them and hands the UI bytes. */
function withImageData(args: any) {
  return { ...args, images: (args?.images ?? []).map((im: any) => {
    if (!im?.path) return im;
    if (!fs.existsSync(im.path)) throw new Error(`no file at ${im.path}`);
    const b = fs.readFileSync(im.path);
    checkSize(b);
    imageSize(b); // fail on a non-image before its bytes reach the UI
    return { ...im, path: undefined, dataURL: `data:application/octet-stream;base64,${b.toString("base64")}` };
  }) };
}
/** An image for the canvas, from a dataURL: validated, measured, id = sha1 of the bytes so one picture is stored once. */
handle("image:read", (_e, src: { dataURL?: string }) => {
  if (!src?.dataURL) throw new Error("give dataURL");
  const b = Buffer.from(src.dataURL.slice(src.dataURL.indexOf(",") + 1), "base64");
  checkSize(b);
  const { mimeType, width, height } = imageSize(b);
  return { id: createHash("sha1").update(b).digest("hex"), dataURL: `data:${mimeType};base64,${b.toString("base64")}`, mimeType, width, height };
});
const liveCount = (text: string) => { try { return (JSON.parse(text).elements ?? []).filter((e: any) => !e.isDeleted).length; } catch { return -1; } };
const lastBackup = new Map<string, number>();
/** Atomic write; the previous version is kept in .history when the scene shrinks by more than 30 percent or is emptied, and at most every 5 min otherwise. */
handle("file:write", (_e, p: string, text: string) => {
  if (!mayUse(p)) throw new Error(`file:write: ${p} is outside ${DIRS.drawings} and was not picked in a dialog`);
  writeDrawing(p, text);
});
function writeDrawing(p: string, text: string) {
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
}
handle("file:new", (_e, folder?: string | null) => {
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
/** A gallery folder: one level under data/drawings, never "", "." or "..". */
const folderDir = (name: string) => { const d = path.join(DIRS.drawings, safeName(String(name))); if (!insideDir(DIRS.drawings, d) || path.dirname(d) !== DIRS.drawings) throw new Error(`bad folder name: ${name}`); return d; };
const thumbFile = (p: string, mtime: number) => path.join(THUMBS, `${createHash("md5").update(p).digest("hex")}-${Math.round(mtime)}.jpg`);
/** A drawing moved: its creation time, the last-file pointer and its shared link follow it. A trashed drawing stops being shared. */
function retarget(from: string, to: string | null) {
  const st = readState();
  const created = { ...(st.created ?? {}) }, shared = { ...(st.shared ?? {}) };
  const born = created[from], url = shared[from];
  delete created[from]; delete shared[from];
  if (to && born) created[to] = born;
  if (to && url) shared[to] = url;
  if (!to && url) unpublish(url);
  writeState({ ...st, created, shared, lastFile: st.lastFile === from ? to ?? undefined : st.lastFile });
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
handle("drawings:list", () => listDrawings());
handle("drawings:rename", (_e, p: string, name: string) => { mustBeDrawing(p); return moveDrawing(p, path.join(path.dirname(p), safeName(name) + EXT)); });
handle("drawings:move", (_e, p: string, folder: string | null) => { mustBeDrawing(p); return moveDrawing(p, path.join(folder ? folderDir(folder) : DIRS.drawings, path.basename(p))); });
handle("drawings:delete", async (_e, p: string) => { mustBeDrawing(p); await shell.trashItem(p); retarget(p, null); });
handle("drawings:newFolder", (_e, name: string) => { fs.mkdirSync(folderDir(name), { recursive: true }); });
const folderFiles = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith(EXT)).map((f) => path.join(dir, f));
handle("drawings:renameFolder", (_e, name: string, next: string) => {
  const from = folderDir(name), to = folderDir(next);
  if (from === to) return;
  if (fs.existsSync(to)) throw new Error(`${safeName(next)} already exists`);
  const files = folderFiles(from);
  fs.renameSync(from, to);
  for (const f of files) retarget(f, path.join(to, path.basename(f)));
});
handle("drawings:deleteFolder", async (_e, name: string) => {
  const dir = folderDir(name);
  const files = folderFiles(dir);
  await shell.trashItem(dir);
  for (const f of files) retarget(f, null);
});
handle("drawings:thumb", (_e, p: string, mtime: number) => {
  const f = thumbFile(p, mtime);
  return fs.existsSync(f) ? `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}` : null;
});
handle("drawings:thumbSet", (_e, p: string, mtime: number, dataUrl: string) => {
  fs.mkdirSync(THUMBS, { recursive: true });
  const f = thumbFile(p, mtime), prefix = path.basename(f).split("-")[0];
  for (const old of fs.readdirSync(THUMBS)) if (old.startsWith(prefix + "-")) fs.unlinkSync(path.join(THUMBS, old)); // one thumbnail per file
  fs.writeFileSync(f, Buffer.from(dataUrl.split(",")[1], "base64"));
});
handle("file:openDialog", async () => pick((await dialog.showOpenDialog(win, { defaultPath: DIRS.drawings, filters: FILTERS, properties: ["openFile"] })).filePaths[0]));
handle("file:saveAsDialog", async (_e, cur: string) => pick((await dialog.showSaveDialog(win, { defaultPath: mayUse(cur) ? cur : DIRS.drawings, filters: FILTERS })).filePath));

// ---- shared drawings (ADR-0008): a drawing goes to the public Blob store only when the user shares it, and only on a click
function blobToken() {
  try { return process.env.EXPLAINER_BLOB_TOKEN ?? JSON.parse(fs.readFileSync(path.join(DIRS.app, "sync.json"), "utf8")).blobToken as string; } catch { return undefined; }
}
const unpublish = (url: string) => { const token = blobToken(); if (token) del(url, { token }).catch((e) => console.error(`[share] delete ${url}: ${e?.message ?? e}`)); };
/** Upload the scene to its blob (the same URL on every update) and return the blob URL. */
handle("share:publish", async (_e, p: string, text: string) => {
  if (!mayUse(p)) throw new Error(`share: ${p} is not a drawing`);
  const token = blobToken();
  if (!token) throw new Error("Sharing is off: run `pnpm sync:setup` once on this Mac, then restart Explainer.");
  const st = readState(), old = st.shared?.[p];
  const id = old ? /\/shared\/([\w-]+)\.excalidraw$/.exec(new URL(old).pathname)?.[1] ?? randomUUID() : randomUUID(); // random: the URL is public but not guessable
  const r = await put(`shared/${id}.excalidraw`, text, { token, access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
  writeState({ ...readState(), shared: { ...(readState().shared ?? {}), [p]: r.url } });
  return r.url;
});
handle("share:unpublish", (_e, p: string) => {
  const st = readState(), url = st.shared?.[p];
  if (!url) return;
  const shared = { ...st.shared };
  delete shared[p];
  writeState({ ...st, shared });
  unpublish(url);
});

const callCanvas = (tool: string, args: any) => new Promise<any>((resolve, reject) => {
  const callId = randomUUID();
  pendingCanvas.set(callId, { resolve, reject });
  win.webContents.send("canvas:call", { callId, tool, args });
  setTimeout(() => { if (pendingCanvas.delete(callId)) reject(new Error(`canvas did not answer ${tool} within 60s (window reloaded?)`)); }, 60_000);
});
listen("canvas:result", (_e, { callId, result, error }: { callId: string; result?: any; error?: string }) => {
  const p = pendingCanvas.get(callId);
  if (!p) return;
  pendingCanvas.delete(callId);
  error ? p.reject(new Error(error)) : p.resolve(result);
});
handle("share:post", (_e, json: string) => shareScene(json));

// no zoomIn/zoomOut/resetZoom roles: Cmd+= Cmd+- Cmd+0 belong to Excalidraw's canvas zoom
// MCP bridge: on by default; menu > Agent and the Settings page turn it off and on, and the choice persists in state.json
let mcp: ReturnType<typeof serveMcp> | null = null;
let mcpError: string | null = null;
const mcpStatus = (): McpStatus => ({ on: !!mcp, port: MCP_PORT, error: mcpError });
function setMcp(on: boolean) {
  mcp?.close(); mcp = null; mcpError = null;
  if (on) {
    mcp = serveMcp(MCP_PORT, async (tool, args) =>
      tool === "get_diagram_rules" ? diagramRules(path.join(__AGENT_DIR__, "diagram-design/skills/diagram-design"), args?.name, agentInstructions())
      : callCanvas(tool, tool === "draw_image" ? withImageData(args) : args), agentInstructions());
    mcp.on("error", (e: Error) => { mcp = null; mcpError = e.message; buildMenu(); });
  }
  buildMenu();
}
function saveMcp(on: boolean) { writeState({ ...readState(), mcpOff: !on }); setMcp(on); }
handle("mcp:get", () => mcpStatus());
handle("mcp:set", (_e, on: boolean) => { saveMcp(on === true); return mcpStatus(); });
function buildMenu() {
  if (win && !win.isDestroyed()) win.webContents.send("mcp:status", mcpStatus()); // the Settings page follows the menu
  const status = mcp ? `MCP: on, 127.0.0.1:${MCP_PORT}` : mcpError ? `MCP: failed (${mcpError})` : "MCP: off";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "fileMenu" },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "Agent", submenu: [
      { label: status, enabled: false },
      { label: "MCP Bridge", type: "checkbox", checked: !!mcp, click: (item) => saveMcp(item.checked) },
      { type: "separator" },
      { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => win?.webContents.send("settings:open") },
    ] },
    { role: "windowMenu" },
  ]));
}

// heartbeat: a stalled event loop in either process shows up in the log with its length
let beat = Date.now();
setInterval(() => { const now = Date.now(), lag = now - beat - 1000; if (lag > 300) console.error(`[main] event loop stalled ${lag}ms`); beat = now; }, 1000);
listen("log:stall", (_e, where: string, ms: number) => console.error(`[${where}] stalled ${ms}ms`));

app.whenReady().then(() => { createWindow(); setMcp(!readState().mcpOff); });
app.on("window-all-closed", () => app.quit());
