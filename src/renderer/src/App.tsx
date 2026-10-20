import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { runCanvasTool } from "./canvas";
import { Gallery } from "./Gallery";
import { Pane, THEME_KEY, type PaneHandle } from "./Pane";

const TABS_KEY = "explainer-tabs"; // { tabs: string[], active: string | null (null = Home), split: string | null }
const readTabs = (): { tabs: string[]; active: string | null; split: string | null } => { try { return { tabs: [], active: null, split: null, ...JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}") }; } catch { return { tabs: [], active: null, split: null }; } };
const shortName = (p: string) => p.split("/").pop()?.replace(/\.excalidraw$/, "") ?? p;

export function App() {
  const [dark, setDark] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [home, setHome] = useState(true); // Home tab = the gallery; the panes stay mounted underneath
  // the drawings on screen: one pane, or two side by side (split view). Never the same file twice: two autosaves would fight
  const [panes, setPanes] = useState<string[]>([]);
  const [focus, setFocus] = useState(0); // the pane the user touched last: tab clicks, the gallery and the agent's canvas calls go to it
  const [menu, setMenu] = useState<{ tab: string; x: number; y: number } | null>(null);
  const panesRef = useRef(panes); panesRef.current = panes;
  const focusRef = useRef(focus); focusRef.current = focus;
  const handles = useRef<(PaneHandle | null)[]>([]);

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
      setPanes(saved.split && saved.split !== last && alive.includes(saved.split) ? [last, saved.split] : [last]);
    })();
  }, []);
  useEffect(() => { if (panes.length) localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active: home ? null : panes[0], split: panes[1] ?? null })); }, [tabs, home, panes]);

  useEffect(() => api.on("canvas:call", async ({ callId, tool, args }) => {
    const h = handles.current[focusRef.current];
    if (!h?.api) return api.send("canvas:result", { callId, error: "canvas not ready" });
    try { api.send("canvas:result", { callId, result: await runCanvasTool(h.api, tool, args, h.selected) }); }
    catch (e: any) { api.send("canvas:result", { callId, error: e?.message ?? String(e) }); }
  }), []);

  /** Show a drawing: focus its pane if it is on screen, else load it into the focused pane. Opens a tab when it has none. */
  const openTab = useCallback((p: string) => {
    setTabs((t) => (t.includes(p) ? t : [...t, p]));
    setHome(false);
    const ps = panesRef.current, j = ps.indexOf(p);
    if (j >= 0) setFocus(j);
    else setPanes(ps.map((x, i) => (i === focusRef.current ? p : x)));
  }, []);
  /** Right-click > Open in split view: the drawing goes to the right pane. */
  const openSplit = useCallback((p: string) => {
    setTabs((t) => (t.includes(p) ? t : [...t, p]));
    setHome(false);
    setPanes((ps) => [ps[0], p]);
    setFocus(1);
  }, []);
  const closeSplit = useCallback(() => { setPanes((ps) => ps.slice(0, 1)); setFocus(0); }, []);
  /** A drawing leaves the screen: in split view its pane closes; alone, the pane shows the next tab (or Home). */
  const unshow = useCallback((p: string, rest: string[], i: number) => {
    const ps = panesRef.current;
    if (!ps.includes(p)) return;
    if (ps.length === 2) { setPanes(ps.filter((x) => x !== p)); setFocus(0); return; }
    const n = rest[Math.min(i, rest.length - 1)];
    if (n) setPanes([n]); else setHome(true);
  }, []);
  const closeTab = useCallback((p: string) => {
    setTabs((t) => {
      const i = t.indexOf(p), next = t.filter((x) => x !== p);
      unshow(p, next, i);
      return next;
    });
  }, [unshow]);
  /** A drawing was renamed, moved or trashed (gallery, Save as, failed load): its tab and pane follow. */
  const relocate = useCallback((from: string, to: string | null) => {
    if (to) { setTabs((t) => t.map((x) => (x === from ? to : x))); setPanes((ps) => ps.map((x) => (x === from ? to : x))); return; }
    setTabs((t) => t.filter((x) => x !== from));
    unshow(from, readTabs().tabs.filter((x) => x !== from), 0);
  }, [unshow]);
  const newFile = useCallback(async () => openTab(await api.invoke("file:new")), [openTab]);
  const open = useCallback(async () => { const p = await api.invoke("file:openDialog"); if (p) openTab(p); }, [openTab]);
  const goHome = useCallback(() => setHome(true), []);
  const toggleTheme = useCallback(() => {
    const next = dark ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    setDark(next === "dark"); // each pane follows
  }, [dark]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", esc); };
  }, [menu]);

  if (!panes.length) return <div className="app" />;
  const split = panes.length === 2;
  const menuItem = (label: string, run: () => void, disabled = false) => (
    <button disabled={disabled} onPointerDown={(e) => e.stopPropagation()} onClick={() => { setMenu(null); run(); }}>{label}</button>
  );
  return (
    <div className={"app" + (dark ? " dark" : "")}>
      <div className="tabs" role="tablist">
        <button className={"tab home" + (home ? " on" : "")} role="tab" aria-selected={home} onClick={goHome} title="Drawings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
        </button>
        {tabs.map((t) => {
          const on = !home && t === panes[focus], shown = !home && !on && panes.includes(t);
          return (
            <div key={t} className={"tab" + (on ? " on" : "") + (shown ? " shown" : "")} role="tab" aria-selected={on} onClick={() => openTab(t)} onContextMenu={(e) => { e.preventDefault(); setMenu({ tab: t, x: e.clientX, y: e.clientY }); }} title={t}>
              <span className="tab-name">{shortName(t)}</span>
              <button className="tab-x" aria-label={`Close ${shortName(t)}`} onClick={(e) => { e.stopPropagation(); closeTab(t); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          );
        })}
        <button className="tab plus" onClick={goHome} title="New tab" aria-label="New tab">+</button>
        <button className="tab theme" onClick={toggleTheme} title={dark ? "Light mode" : "Dark mode"} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={dark}>
          {dark
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>}
        </button>
      </div>
      {menu && (
        <div className="gmenu tabmenu" role="menu" style={{ left: menu.x, top: menu.y }}>
          {split && panes.includes(menu.tab)
            ? menuItem("Close split view", closeSplit)
            : menuItem("Open in split view", () => openSplit(menu.tab), !split && menu.tab === panes[0])}
          {menuItem("Close tab", () => closeTab(menu.tab))}
        </div>
      )}
      <div className={"canvas-wrap" + (split ? " split" : "")}>
        {panes.map((p, i) => (
          <Pane key={p} ref={(h) => { handles.current[i] = h; }} file={p} dark={dark} focused={i === focus}
            onFocus={() => setFocus(i)} onMoved={relocate} onDark={setDark} onHome={goHome} onNew={newFile} onOpen={open} />
        ))}
        {home && <Gallery current={panes[focus]} onOpen={openTab} onRelocate={relocate} />}
      </div>
    </div>
  );
}
