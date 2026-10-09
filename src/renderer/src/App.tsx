import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu, WelcomeScreen, getSceneVersion, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { api } from "./api";
import { runCanvasTool } from "./canvas";
import { DEFAULT_FONT, inspect, layout } from "./layout";
import { NOTATION, classify, isFocal } from "../../shared/tools";
import { Minimap, type MinimapHandle } from "./Minimap";
import { Gallery } from "./Gallery";

const LIB_KEY = "explainer-library";
const THEME_KEY = "explainer-theme"; // "light" | "dark", app-wide, wins over the theme saved inside a drawing
const TABS_KEY = "explainer-tabs"; // { tabs: string[], active: string | null } (null = Home)
const readTabs = (): { tabs: string[]; active: string | null } => { try { return { tabs: [], active: null, ...JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}") }; } catch { return { tabs: [], active: null }; } };
const shortName = (p: string) => p.split("/").pop()?.replace(/\.excalidraw$/, "") ?? p;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** CSS-scale the canvases (and the DOM frame titles, fixed font size, anchored bottom-left) by k about the container origin, then shift by tx, ty. */
function zoomTransform(root: HTMLElement, k: number, tx: number, ty: number) {
  const t = (x: number, y: number, s = 1) => (k === 1 && !tx && !ty ? "" : `translate(${x}px, ${y}px)` + (s === 1 ? "" : ` scale(${s})`));
  for (const c of root.querySelectorAll<HTMLElement>("canvas.excalidraw__canvas")) { c.style.transformOrigin = "0 0"; c.style.transform = t(tx, ty, k); }
  for (const el of root.children) {
    if (!(el instanceof HTMLDivElement) || el.className) continue;
    const L = el.offsetLeft, B = el.offsetTop + el.offsetHeight; // offset*: layout position, ignores the transform already on it
    el.style.transform = t(tx + L * (k - 1), ty + B * (k - 1));
  }
}

export function App() {
  const [xapi, setXapi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [initial, setInitial] = useState<ExcalidrawInitialDataState | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [home, setHome] = useState(true); // Home tab = the gallery; the canvas stays mounted underneath
  const selRef = useRef(selectedIds); selRef.current = selectedIds;
  const xapiRef = useRef(xapi); xapiRef.current = xapi;
  const fileRef = useRef(file); fileRef.current = file;
  const saveTimer = useRef<number>(undefined);
  const minimap = useRef<MinimapHandle>(null);
  // per-tab pan/zoom: Excalidraw remounts on tab switch (key={file}), so the view is kept here and restored on open
  const views = useRef(new Map<string, { scrollX: number; scrollY: number; zoom: any }>());
  // Wheel zoom. Excalidraw re-renders the whole scene on every wheel tick and, unless shouldCacheIgnoreZoom is set, re-rasterizes
  // every visible element too: on a big drawing one tick froze for hundreds of ms. Instead, while the gesture runs the canvases (and
  // the DOM frame titles) are CSS-transformed from the view at gesture start, at most once per animation frame, and the scene is
  // rendered once when the wheel has been quiet for a moment. Element rasters are kept (scaled) while zooming out, down to half the
  // zoom they were made at, and remade when zooming in past it: zooming out to see everything never stalls, zooming in stays sharp.
  const gesture = useRef<{ z0: number; sx0: number; sy0: number; zoom: number; scrollX: number; scrollY: number; raf: number; end: number; done: boolean } | null>(null);
  const rasterZoom = useRef(1); // zoom the element canvases were last rasterized at (last time shouldCacheIgnoreZoom was false)
  const rasterTimer = useRef<number>(undefined);
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement;
      const root = document.querySelector<HTMLElement>(".excalidraw");
      const title = t instanceof HTMLDivElement && !t.className && t.parentElement === root;
      const canvas = document.querySelector("canvas.excalidraw__canvas.interactive");
      if (!canvas || !root) return;
      if ((e.ctrlKey || e.metaKey) && (title || t === canvas)) {
        const x = xapiRef.current;
        if (!x) return;
        e.preventDefault(); e.stopPropagation();
        let g = gesture.current;
        if (g?.done) return; // the last gesture's render is still on its way: drop the tick, the next one starts from the rendered view
        if (!g) { const s = x.getAppState(); g = gesture.current = { z0: s.zoom.value, sx0: s.scrollX, sy0: s.scrollY, zoom: s.zoom.value, scrollX: s.scrollX, scrollY: s.scrollY, raf: 0, end: 0, done: false }; }
        // relative step anchored at the cursor, same shape as Excalidraw's getStateForZoom (its own step is absolute: +66% per tick at zoom 0.15)
        const d = Math.max(-10, Math.min(10, e.deltaY));
        const zoom = Math.max(0.1, Math.min(30, g.zoom * (1 - d / 100)));
        const r = root.getBoundingClientRect(), ax = e.clientX - r.left, ay = e.clientY - r.top;
        g.scrollX += (ax - ax / g.zoom) - (ax - ax / zoom); g.scrollY += (ay - ay / g.zoom) - (ay - ay / zoom); g.zoom = zoom;
        if (!g.raf) g.raf = requestAnimationFrame(() => {
          if (!g || g.done) return;
          g.raf = 0;
          zoomTransform(root, g.zoom / g.z0, (g.scrollX - g.sx0) * g.zoom, (g.scrollY - g.sy0) * g.zoom);
        });
        window.clearTimeout(g.end);
        g.end = window.setTimeout(() => { if (!g) return; g.done = true; x.updateScene({ appState: { zoom: { value: g.zoom as any }, scrollX: g.scrollX, scrollY: g.scrollY, shouldCacheIgnoreZoom: true } }); }, 120);
        return;
      }
      // Excalidraw ignores wheel events whose target is not its canvas; frame titles are DOM overlays, so pan died with the cursor on one
      if (!title) return;
      e.preventDefault(); e.stopPropagation();
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true }));
    };
    document.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => document.removeEventListener("wheel", onWheel, { capture: true } as any);
  }, []);
  const lastSaved = useRef("");
  // boot guard: Excalidraw can report an empty or partial scene before initialData lands; never autosave that over a fuller file
  const expected = useRef(0);

  const openFile = useCallback(async (path: string) => {
    let text = await api.invoke("file:read", path);
    let data: ExcalidrawInitialDataState = { elements: [], appState: {} };
    if (text) {
      try {
        data = (await loadFromBlob(new Blob([text], { type: "application/json" }), null, null)) as any;
        // an elbow arrow with a diagonal fixed segment makes Excalidraw (dev build) throw on every pointer event: drop the segments, it re-routes
        data.elements = (data.elements ?? []).map((e: any) => e.fixedSegments?.some((s: any) => s.start[0] !== s.end[0] && s.start[1] !== s.end[1]) ? { ...e, fixedSegments: null } : e);
      }
      catch (e) {
        // never let an unreadable file become an empty scene that autosaves over it: leave it alone, open a fresh drawing
        console.error("load failed", e);
        path = await api.invoke("file:new");
        text = null;
        setTimeout(() => xapiRef.current?.setToast({ message: "Could not read the last drawing; opened a new one. The file was left untouched.", closable: true, duration: 10000 }), 1500);
      }
    }
    let libraryItems: any[] = [];
    try { libraryItems = JSON.parse(localStorage.getItem(LIB_KEY) ?? "[]"); } catch {}
    lastSaved.current = "";
    expected.current = (data.elements ?? []).filter((e: any) => !e.isDeleted).length;
    window.setTimeout(() => { expected.current = 0; }, 15_000); // never leave a file unsaveable if Excalidraw drops something on load
    const theme = (localStorage.getItem(THEME_KEY) as "light" | "dark" | null) ?? data.appState?.theme;
    const view = views.current.get(path);
    setInitial({ ...data, appState: { ...data.appState, ...view, theme, currentItemFontFamily: DEFAULT_FONT }, libraryItems, scrollToContent: !view });
    setFile(path);
    await api.invoke("state:set", { lastFile: path });
  }, []);

  useEffect(() => {
    (async () => {
      const s = await api.invoke("state:get");
      const saved = readTabs();
      const alive: string[] = [];
      for (const t of saved.tabs) if ((await api.invoke("file:read", t)) !== null) alive.push(t);
      const last = saved.active && alive.includes(saved.active) ? saved.active : alive[0] ?? (s.lastFile && (await api.invoke("file:read", s.lastFile)) !== null ? s.lastFile : await api.invoke("file:new"));
      if (!alive.includes(last)) alive.push(last);
      setTabs(alive);
      setHome(saved.active === null || !saved.tabs.length);
      await openFile(last);
    })();
  }, [openFile]);
  useEffect(() => { if (file) localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active: home ? null : file })); }, [tabs, home, file]);

  useEffect(() => api.on("canvas:call", async ({ callId, tool, args }) => {
    const x = xapiRef.current;
    if (!x) return api.send("canvas:result", { callId, error: "canvas not ready" });
    try { api.send("canvas:result", { callId, result: await runCanvasTool(x, tool, args, selRef.current) }); }
    catch (e: any) { api.send("canvas:result", { callId, error: e?.message ?? String(e) }); }
  }), []);

  const onChange = useCallback((elements: readonly any[], appState: any, files: any) => {
    setSidebarOpen(!!appState.openSidebar);
    setDark(appState.theme === "dark");
    const g = gesture.current;
    if (g?.done) { // the scene is rendered at the final zoom: drop the CSS transforms in the same task, before paint
      gesture.current = null;
      const root = document.querySelector<HTMLElement>(".excalidraw");
      if (root) zoomTransform(root, 1, 0, 0);
    }
    window.clearTimeout(rasterTimer.current);
    if (!appState.shouldCacheIgnoreZoom) rasterZoom.current = appState.zoom.value;
    else if (!gesture.current && (appState.zoom.value > rasterZoom.current || appState.zoom.value < rasterZoom.current / 2)) {
      rasterTimer.current = window.setTimeout(() => xapiRef.current?.updateScene({ appState: { shouldCacheIgnoreZoom: false } }), 300);
    }
    minimap.current?.draw(elements, appState);
    if (fileRef.current) views.current.set(fileRef.current, { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom });
    const ids = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]);
    setSelectedIds((prev) => (same(prev, ids) ? prev : ids));
    // autosave: scene version + the bits of appState worth keeping
    const live = elements.filter((e) => !e.isDeleted).length;
    if (live < expected.current) { console.warn(`autosave skipped: ${live} of ${expected.current} elements loaded`); return; }
    expected.current = 0; // loaded once: from here on every change is the user's or an MCP client's
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

  /** Show a drawing in its tab; opens a new tab when it has none. */
  const openTab = useCallback((p: string) => {
    setTabs((t) => (t.includes(p) ? t : [...t, p]));
    setHome(false);
    if (p !== fileRef.current) openFile(p);
  }, [openFile]);
  const closeTab = useCallback((p: string) => {
    setTabs((t) => {
      const i = t.indexOf(p), next = t.filter((x) => x !== p);
      if (p === fileRef.current) { const n = next[Math.min(i, next.length - 1)]; if (n) openFile(n); else setHome(true); }
      return next;
    });
  }, [openFile]);
  /** A drawing was renamed, moved or trashed in the gallery: its tab follows; the gallery stays open. */
  const relocate = useCallback((from: string, to: string | null) => {
    setTabs((t) => (to ? t.map((x) => (x === from ? to : x)) : t.filter((x) => x !== from)));
    if (from === fileRef.current) { if (to) openFile(to); else { const n = readTabs().tabs.find((x) => x !== from); if (n) openFile(n); } }
  }, [openFile]);
  const newFile = async () => openTab(await api.invoke("file:new"));
  const toggleTheme = useCallback(() => {
    const next = dark ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    setDark(next === "dark");
    xapiRef.current?.updateScene({ appState: { theme: next } });
  }, [dark]);
  const open = async () => { const p = await api.invoke("file:openDialog"); if (p) openFile(p); };
  const saveAs = async () => {
    const x = xapiRef.current, p = await api.invoke("file:saveAsDialog", fileRef.current ?? "");
    if (!x || !p) return;
    await api.invoke("file:write", p, serializeAsJSON(x.getSceneElements(), x.getAppState(), x.getFiles(), "local"));
    setFile(p); await api.invoke("state:set", { lastFile: p });
  };

  const uiOptions = useMemo(() => ({ canvasActions: { loadScene: false, export: { saveFileToDisk: true, onExportToBackend: share as any } } }), [share]);
  const onLibraryChange = useCallback((items: any) => localStorage.setItem(LIB_KEY, JSON.stringify(items)), []);
  // hooks for CDP drivers (test/eval, Claude Code) in dev and in the packaged app alike: it is a local app, nothing else can reach the page
  const setApi = useCallback((a: ExcalidrawImperativeAPI) => { setXapi(a); (window as any).__xapi = a; (window as any).__canvas = (tool: string, args: any) => runCanvasTool(a, tool, args, selRef.current); (window as any).__layout = { layout, inspect, classify, isFocal, NOTATION }; }, []);

  if (!initial || !file) return <div className="app" />;
  return (
    <div className={"app" + (sidebarOpen ? " sidebar-open" : "") + (dark ? " dark" : "")}>
      <div className="tabs" role="tablist">
        <button className={"tab home" + (home ? " on" : "")} role="tab" aria-selected={home} onClick={() => setHome(true)} title="Drawings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
        </button>
        {tabs.map((t) => (
          <div key={t} className={"tab" + (!home && t === file ? " on" : "")} role="tab" aria-selected={!home && t === file} onClick={() => openTab(t)} title={t}>
            <span className="tab-name">{shortName(t)}</span>
            <button className="tab-x" aria-label={`Close ${shortName(t)}`} onClick={(e) => { e.stopPropagation(); closeTab(t); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        ))}
        <button className="tab plus" onClick={() => setHome(true)} title="New tab" aria-label="New tab">+</button>
        <button className="tab theme" onClick={toggleTheme} title={dark ? "Light mode" : "Dark mode"} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={dark}>
          {dark
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>}
        </button>
      </div>
      <div className="canvas-wrap">
      <Excalidraw
        key={file}
        initialData={initial}
        excalidrawAPI={setApi}
        onChange={onChange}
        onLibraryChange={onLibraryChange}
        UIOptions={uiOptions}
        name={file.split("/").pop()?.replace(/\.excalidraw$/, "")}
      >
        <WelcomeScreen />
        <MainMenu>
          <MainMenu.Item onSelect={() => setHome(true)}>Drawings…</MainMenu.Item>
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
      </Excalidraw>
      <Minimap ref={minimap} api={xapi} />
      {home && <Gallery current={file} onOpen={openTab} onRelocate={relocate} />}
      </div>
    </div>
  );
}
