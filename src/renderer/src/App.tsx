import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu, Sidebar, WelcomeScreen, getCommonBounds, getSceneVersion, loadFromBlob, sceneCoordsToViewportCoords, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { api } from "./api";
import { DEFAULT_FONT, runCanvasTool } from "./canvas";
import { ChatPanel, useChat } from "./Chat";
import { Minimap, type MinimapHandle } from "./Minimap";
import type { AppState } from "../../shared/types";

const LIB_KEY = "explainer-library";
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function App() {
  const [xapi, setXapi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [initial, setInitial] = useState<ExcalidrawInitialDataState | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [askPos, setAskPos] = useState<{ x: number; y: number } | null>(null);
  const [attached, setAttached] = useState<string[]>([]);
  const [docked, setDocked] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const selRef = useRef(selectedIds); selRef.current = selectedIds;
  const xapiRef = useRef(xapi); xapiRef.current = xapi;
  const fileRef = useRef(file); fileRef.current = file;
  const saveTimer = useRef<number>(undefined);
  const minimap = useRef<MinimapHandle>(null);
  const lastSaved = useRef("");

  const chat = useChat({ xapi, file, state, setState, attached, setAttached });

  const openFile = useCallback(async (path: string) => {
    const text = await api.invoke("file:read", path);
    let data: ExcalidrawInitialDataState = { elements: [], appState: {} };
    if (text) { try { data = (await loadFromBlob(new Blob([text], { type: "application/json" }), null, null)) as any; } catch (e) { console.error("load failed", e); } }
    let libraryItems: any[] = [];
    try { libraryItems = JSON.parse(localStorage.getItem(LIB_KEY) ?? "[]"); } catch {}
    lastSaved.current = "";
    setInitial({ ...data, appState: { ...data.appState, currentItemFontFamily: DEFAULT_FONT }, libraryItems, scrollToContent: true });
    setFile(path);
    setState(await api.invoke("state:set", { lastFile: path }));
  }, []);

  useEffect(() => {
    (async () => {
      const s = await api.invoke("state:get");
      setState(s);
      const last = s.lastFile && (await api.invoke("file:read", s.lastFile)) !== null ? s.lastFile : await api.invoke("file:new");
      await openFile(last);
    })();
  }, [openFile]);

  useEffect(() => api.on("canvas:call", async ({ callId, tool, args }) => {
    const x = xapiRef.current;
    if (!x) return api.send("canvas:result", { callId, error: "canvas not ready" });
    try { api.send("canvas:result", { callId, result: await runCanvasTool(x, tool, args, selRef.current) }); }
    catch (e: any) { api.send("canvas:result", { callId, error: e?.message ?? String(e) }); }
  }), []);

  const onChange = useCallback((elements: readonly any[], appState: any, files: any) => {
    setSidebarOpen(!!appState.openSidebar);
    setDark(appState.theme === "dark");
    minimap.current?.draw(elements, appState);
    const ids = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]);
    setSelectedIds((prev) => (same(prev, ids) ? prev : ids));
    if (ids.length) {
      const sel = elements.filter((e) => ids.includes(e.id) && !e.isDeleted);
      if (sel.length) {
        const [, y1, x2] = getCommonBounds(sel as any);
        const p = sceneCoordsToViewportCoords({ sceneX: x2, sceneY: y1 }, appState);
        const x = Math.round(p.x + 8), y = Math.round(p.y - 36);
        setAskPos((prev) => (prev && prev.x === x && prev.y === y ? prev : { x, y })); // same value = no re-render (onChange fires on every render)
      }
    } else setAskPos(null);
    // autosave: scene version + the bits of appState worth keeping
    const sig = `${getSceneVersion(elements as any)}|${appState.theme}|${appState.viewBackgroundColor}|${appState.gridModeEnabled}`;
    if (sig === lastSaved.current) return;
    lastSaved.current = sig;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { const f = fileRef.current; if (f) api.invoke("file:write", f, serializeAsJSON(elements as any, appState, files, "local")); }, 800);
  }, []);

  const share = useCallback(async (elements: readonly any[], appState: any, files: any) => {
    const r = await api.invoke("share:post", serializeAsJSON(elements as any, appState, files, "database"));
    const x = xapiRef.current;
    if ("url" in r) { await navigator.clipboard.writeText(r.url); x?.setToast({ message: `Link copied${Object.keys(files ?? {}).length ? " (images are not included in share links)" : ""}: ${r.url}`, duration: 8000, closable: true }); }
    else x?.setToast({ message: r.error, closable: true });
    return true;
  }, []);

  const newFile = async () => openFile(await api.invoke("file:new"));
  const open = async () => { const p = await api.invoke("file:openDialog"); if (p) openFile(p); };
  const saveAs = async () => {
    const x = xapiRef.current, p = await api.invoke("file:saveAsDialog", fileRef.current ?? "");
    if (!x || !p) return;
    await api.invoke("file:write", p, serializeAsJSON(x.getSceneElements(), x.getAppState(), x.getFiles(), "local"));
    setFile(p); setState(await api.invoke("state:set", { lastFile: p }));
  };

  const uiOptions = useMemo(() => ({ canvasActions: { loadScene: false, export: { saveFileToDisk: true, onExportToBackend: share as any } } }), [share]);
  // Excalidraw memoizes renderTopRightUI, so visibility is driven by CSS (.app.sidebar-open .agent-trigger)
  const topRight = useCallback(() => (
    <Sidebar.Trigger name="agent" className="agent-trigger" title="Claude agent" icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" /></svg>}>
      Agent
    </Sidebar.Trigger>
  ), []);
  const onLibraryChange = useCallback((items: any) => localStorage.setItem(LIB_KEY, JSON.stringify(items)), []);
  const setApi = useCallback((a: ExcalidrawImperativeAPI) => { setXapi(a); if (import.meta.env.DEV) { (window as any).__xapi = a; (window as any).__canvas = (tool: string, args: any) => runCanvasTool(a, tool, args, selRef.current); } }, []);

  if (!initial || !file) return <div className="app" />;
  return (
    <div className={"app" + (sidebarOpen ? " sidebar-open" : "") + (dark ? " dark" : "")}>
      <Excalidraw
        key={file}
        initialData={initial}
        excalidrawAPI={setApi}
        onChange={onChange}
        onLibraryChange={onLibraryChange}
        UIOptions={uiOptions}
        renderTopRightUI={topRight}
        name={file.split("/").pop()?.replace(/\.excalidraw$/, "")}
      >
        <WelcomeScreen />
        <MainMenu>
          <MainMenu.Item onSelect={newFile}>New drawing</MainMenu.Item>
          <MainMenu.Item onSelect={open}>Open…</MainMenu.Item>
          <MainMenu.Item onSelect={saveAs}>Save as…</MainMenu.Item>
          <MainMenu.Item onSelect={() => { const x = xapiRef.current; if (x) share(x.getSceneElements(), x.getAppState(), x.getFiles()); }}>Copy share link</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
        <Sidebar name="agent" docked={docked} onDock={setDocked} className="agent-sidebar">
          <ChatPanel chat={chat} />
        </Sidebar>
      </Excalidraw>
      <Minimap ref={minimap} api={xapi} />
      {askPos && selectedIds.length > 0 && (
        <button className="ask-btn" style={{ left: askPos.x, top: askPos.y }} onClick={() => { setAttached(selectedIds); xapiRef.current?.toggleSidebar({ name: "agent", force: true }); }}>
          ✦ Ask agent ({selectedIds.length})
        </button>
      )}
    </div>
  );
}
