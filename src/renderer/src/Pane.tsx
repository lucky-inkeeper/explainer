import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Excalidraw, MainMenu, WelcomeScreen, getSceneVersion, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { api } from "./api";
import { runCanvasTool } from "./canvas";
import { DEFAULT_FONT, FONTS, inspect, layout, settleFrames } from "./layout";
import { NOTATION, classify, isFocal } from "../../shared/tools";
import { Minimap, type MinimapHandle } from "./Minimap";

const LIB_KEY = "explainer-library";
export const THEME_KEY = "explainer-theme"; // "light" | "dark", app-wide, wins over the theme saved inside a drawing
/** What autosave compares: scene version + the bits of appState worth keeping. */
const sceneSig = (elements: readonly any[], appState: any) => `${getSceneVersion(elements as any)}|${appState.theme}|${appState.viewBackgroundColor}|${appState.gridModeEnabled}`;
// per-drawing pan/zoom: a pane remounts when its drawing changes (key={file}), so the view is kept here and restored on open
export const views = new Map<string, { scrollX: number; scrollY: number; zoom: any }>();
/** The read-only page for a shared drawing: the UI deployed to Vercel with ?view=<blob URL> (Viewer.tsx), so anyone can open it. */
const viewLink = (blobUrl: string) => `https://explainer-pearl.vercel.app/?view=${encodeURIComponent(blobUrl)}`;
let toastNext: string | null = null; // shown by the next pane that mounts (a failed load hands its pane a fresh drawing)

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

export type PaneHandle = { api: ExcalidrawImperativeAPI | null; selected: string[] };

type Props = {
  file: string;
  dark: boolean;
  focused: boolean;
  onFocus: () => void;
  /** this pane now shows another file: a fresh one after a failed load, or the Save as target */
  onMoved: (from: string, to: string) => void;
  onDark: (dark: boolean) => void;
  onHome: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSettings: () => void;
};

/** One drawing in one Excalidraw: load, autosave, wheel zoom, minimap, cloud-sync reload. The app shows one pane, or two side by side. */
export const Pane = forwardRef<PaneHandle, Props>(function Pane({ file, dark, focused, onFocus, onMoved, onDark, onHome, onNew, onOpen, onSettings }, ref) {
  const [xapi, setXapi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [initial, setInitial] = useState<ExcalidrawInitialDataState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sharedUrl, setSharedUrl] = useState<string | null>(null); // the drawing's public blob, when the user shared it (ADR-0008)
  const [sharing, setSharing] = useState(false); // Share with link needs a Blob token on this computer (pnpm sync:setup)
  useEffect(() => { api.invoke("share:enabled").then(setSharing, () => setSharing(true)); }, []); // older shell: no channel, keep the item
  const xapiRef = useRef(xapi); xapiRef.current = xapi;
  const selected = useRef<string[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number>(undefined);
  const minimap = useRef<MinimapHandle>(null);
  const onDarkRef = useRef(onDark); onDarkRef.current = onDark;
  const darkRef = useRef(dark); darkRef.current = dark;
  const seenTheme = useRef<string>(undefined);
  useImperativeHandle(ref, () => ({ api: xapi, get selected() { return selected.current; } }), [xapi]);

  // Wheel zoom. Excalidraw re-renders the whole scene on every wheel tick and, unless shouldCacheIgnoreZoom is set, re-rasterizes
  // every visible element too: on a big drawing one tick froze for hundreds of ms. Instead, while the gesture runs the canvases (and
  // the DOM frame titles) are CSS-transformed from the view at gesture start, at most once per animation frame, and the scene is
  // rendered once when the wheel has been quiet for a moment. Element rasters are kept (scaled) while zooming out, down to half the
  // zoom they were made at, and remade when zooming in past it: zooming out to see everything never stalls, zooming in stays sharp.
  const gesture = useRef<{ z0: number; sx0: number; sy0: number; zoom: number; scrollX: number; scrollY: number; raf: number; end: number; done: boolean } | null>(null);
  const rasterZoom = useRef(1); // zoom the element canvases were last rasterized at (last time shouldCacheIgnoreZoom was false)
  const rasterTimer = useRef<number>(undefined);
  useEffect(() => {
    const pane = wrap.current!;
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement;
      const root = pane.querySelector<HTMLElement>(".excalidraw");
      const title = t instanceof HTMLDivElement && !t.className && t.parentElement === root;
      const canvas = pane.querySelector("canvas.excalidraw__canvas.interactive");
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
    pane.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => pane.removeEventListener("wheel", onWheel, { capture: true } as any);
  }, []);
  const lastSaved = useRef("");
  // boot guard: Excalidraw can report an empty or partial scene before initialData lands; never autosave that over a fuller file
  const expected = useRef(0);

  useEffect(() => {
    let dead = false;
    (async () => {
      const text = await api.invoke("file:read", file);
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
          toastNext = "Could not read the last drawing; opened a new one. The file was left untouched.";
          if (!dead) onMoved(file, await api.invoke("file:new"));
          return;
        }
      }
      if (dead) return;
      let libraryItems: any[] = [];
      try { libraryItems = JSON.parse(localStorage.getItem(LIB_KEY) ?? "[]"); } catch {}
      expected.current = (data.elements ?? []).filter((e: any) => !e.isDeleted).length;
      window.setTimeout(() => { expected.current = 0; }, 15_000); // never leave a file unsaveable if Excalidraw drops something on load
      const theme = (localStorage.getItem(THEME_KEY) as "light" | "dark" | null) ?? data.appState?.theme;
      const view = views.get(file);
      setInitial({ ...data, appState: { ...data.appState, ...view, theme, currentItemFontFamily: DEFAULT_FONT }, libraryItems, scrollToContent: !view });
      const st = await api.invoke("state:set", { lastFile: file });
      setSharedUrl(st.shared?.[file] ?? null);
    })();
    return () => { dead = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- key={file}: one pane instance per file

  // the app theme changed (tab bar toggle, or the other pane): follow it
  useEffect(() => { const x = xapi; if (x && (x.getAppState().theme === "dark") !== dark) x.updateScene({ appState: { theme: dark ? "dark" : "light" } }); }, [dark, xapi]);
  // hooks for CDP drivers (test/eval, Claude Code) in dev and in the packaged app alike: they drive the focused pane
  useEffect(() => {
    if (!focused || !xapi) return;
    Object.assign(window as any, { __xapi: xapi, __canvas: (tool: string, args: any) => runCanvasTool(xapi, tool, args, selected.current), __layout: { layout, inspect, settleFrames, classify, isFocal, NOTATION } });
  }, [focused, xapi]);

  const onChange = useCallback((elements: readonly any[], appState: any, files: any) => {
    setSidebarOpen(!!appState.openSidebar);
    // report only a theme this pane changed itself (its menu, or the drawing's own theme on load): a pane still on the old
    // theme, before it follows the app, must not report it back, or two panes flip the app theme forever
    if (appState.theme !== seenTheme.current) { seenTheme.current = appState.theme; if ((appState.theme === "dark") !== darkRef.current) onDarkRef.current(appState.theme === "dark"); }
    const g = gesture.current;
    if (g?.done) { // the scene is rendered at the final zoom: drop the CSS transforms in the same task, before paint
      gesture.current = null;
      const root = wrap.current?.querySelector<HTMLElement>(".excalidraw");
      if (root) zoomTransform(root, 1, 0, 0);
    }
    window.clearTimeout(rasterTimer.current);
    if (!appState.shouldCacheIgnoreZoom) rasterZoom.current = appState.zoom.value;
    else if (!gesture.current && (appState.zoom.value > rasterZoom.current || appState.zoom.value < rasterZoom.current / 2)) {
      rasterTimer.current = window.setTimeout(() => xapiRef.current?.updateScene({ appState: { shouldCacheIgnoreZoom: false } }), 300);
    }
    minimap.current?.draw(elements, appState);
    views.set(file, { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom });
    selected.current = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]);
    // autosave: scene version + the bits of appState worth keeping
    const live = elements.filter((e) => !e.isDeleted).length;
    if (live < expected.current) { console.warn(`autosave skipped: ${live} of ${expected.current} elements loaded`); return; }
    expected.current = 0; // loaded once: from here on every change is the user's or an MCP client's
    const sig = sceneSig(elements, appState);
    if (sig === lastSaved.current) return;
    lastSaved.current = sig;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => api.invoke("file:write", file, serializeAsJSON(elements as any, appState, files, "local")), 800);
  }, [file]);

  const share = useCallback(async (elements: readonly any[], appState: any, files: any) => {
    // excalidraw.com does not know the web-font ids (ADR-0003): both become its Nunito (6), the closest to how the app looks
    const web = elements.map((e) => (e.fontFamily === FONTS["Playpen Sans"] || e.fontFamily === FONTS.Inter ? { ...e, fontFamily: 6 } : e));
    const r = await api.invoke("share:post", serializeAsJSON(web as any, appState, files, "database"));
    const x = xapiRef.current;
    if ("url" in r) { await navigator.clipboard.writeText(r.url); x?.setToast({ message: `Link copied${Object.keys(files ?? {}).length ? " (images are not included in share links)" : ""}: ${r.url}`, duration: 8000, closable: true }); }
    else x?.setToast({ message: r.error, closable: true });
    return true;
  }, []);
  /** Share with link / Update shared link: upload the scene now (one Blob write per click) and copy the viewer link. */
  const publish = async () => {
    const x = xapiRef.current;
    if (!x) return;
    try {
      const url = await api.invoke("share:publish", file, serializeAsJSON(x.getSceneElements(), x.getAppState(), x.getFiles(), "local"));
      setSharedUrl(url);
      const link = viewLink(url);
      await navigator.clipboard.writeText(link);
      x.setToast({ message: `${sharedUrl ? "Shared link updated" : "Shared"}, link copied: ${link}`, duration: 8000, closable: true });
    } catch (e: any) { x.setToast({ message: String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), closable: true }); }
  };
  const unpublish = async () => {
    await api.invoke("share:unpublish", file);
    setSharedUrl(null);
    xapiRef.current?.setToast({ message: "Stopped sharing: the link no longer opens. The drawing stays on this computer.", duration: 6000, closable: true });
  };
  const saveAs = async () => {
    const x = xapiRef.current, p = await api.invoke("file:saveAsDialog", file);
    if (!x || !p) return;
    await api.invoke("file:write", p, serializeAsJSON(x.getSceneElements(), x.getAppState(), x.getFiles(), "local"));
    const v = views.get(file);
    if (v) views.set(p, v);
    onMoved(file, p);
  };

  const uiOptions = useMemo(() => ({ canvasActions: { loadScene: false, export: { saveFileToDisk: true, onExportToBackend: share as any } } }), [share]);
  const onLibraryChange = useCallback((items: any) => localStorage.setItem(LIB_KEY, JSON.stringify(items)), []);
  const setApi = useCallback((a: ExcalidrawImperativeAPI) => {
    setXapi(a);
    const msg = toastNext;
    if (msg) { toastNext = null; setTimeout(() => a.setToast({ message: msg, closable: true, duration: 10000 }), 1500); }
  }, []);

  return (
    <div ref={wrap} className={"pane" + (sidebarOpen ? " sidebar-open" : "") + (focused ? " focused" : "")} onPointerDownCapture={onFocus}>
      {initial && (
        <Excalidraw
          initialData={initial}
          excalidrawAPI={setApi}
          onChange={onChange}
          onLibraryChange={onLibraryChange}
          UIOptions={uiOptions}
          name={file.split(/[\\/]/).pop()?.replace(/\.excalidraw$/, "")}
        >
          <WelcomeScreen>
            <WelcomeScreen.Hints.MenuHint />
            <WelcomeScreen.Hints.ToolbarHint />
            <WelcomeScreen.Hints.HelpHint />
            {/* drawings come from the agent: point the user to it, not to the tools */}
            <WelcomeScreen.Center>
              <WelcomeScreen.Center.Logo />
              <WelcomeScreen.Center.Heading>Ask your AI agent to draw here, for example:<br />“How does login work in this repo? Draw it.”</WelcomeScreen.Center.Heading>
              <WelcomeScreen.Center.Menu>
                <WelcomeScreen.Center.MenuItemHelp />
              </WelcomeScreen.Center.Menu>
            </WelcomeScreen.Center>
          </WelcomeScreen>
          <MainMenu>
            <MainMenu.Item onSelect={onHome}>Drawings…</MainMenu.Item>
            <MainMenu.Item onSelect={onNew}>New drawing</MainMenu.Item>
            <MainMenu.Item onSelect={onOpen}>Open…</MainMenu.Item>
            <MainMenu.Item onSelect={saveAs}>Save as…</MainMenu.Item>
            {(sharing || sharedUrl) && <MainMenu.Item onSelect={publish}>{sharedUrl ? "Update shared link" : "Share with link"}</MainMenu.Item>}
            {sharedUrl && <MainMenu.Item onSelect={() => { navigator.clipboard.writeText(viewLink(sharedUrl)); xapiRef.current?.setToast({ message: "Link copied (the last update; use Update shared link to send newer edits)", duration: 5000, closable: true }); }}>Copy shared link</MainMenu.Item>}
            {sharedUrl && <MainMenu.Item onSelect={unpublish}>Stop sharing</MainMenu.Item>}
            <MainMenu.Item onSelect={() => { const x = xapiRef.current; if (x) share(x.getSceneElements(), x.getAppState(), x.getFiles()); }}>Copy excalidraw.com link</MainMenu.Item>
            <MainMenu.Item onSelect={onSettings}>MCP settings…</MainMenu.Item>
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
      )}
      <Minimap ref={minimap} api={xapi} />
    </div>
  );
});
