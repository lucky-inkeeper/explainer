import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { runCanvasTool } from "./canvas";
import { Gallery } from "./Gallery";
import { Pane, THEME_KEY, type PaneHandle } from "./Pane";

const TABS_KEY = "explainer-tabs"; // { tabs: string[], active: string | null (null = Home), pairs: [string, string][] }
type SavedTabs = { tabs: string[]; active: string | null; pairs: string[][]; pair?: string[] | null; split?: string | null };
const readTabs = (): SavedTabs => { try { return { tabs: [], active: null, pairs: [], ...JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}") }; } catch { return { tabs: [], active: null, pairs: [] }; } };
/** The tab strip fades out at an edge only while more tabs hide past it. ponytail: no resize listener; the next scroll or tab change updates it. */
const fade = (l: HTMLElement) => { l.classList.toggle("fade-l", l.scrollLeft > 0); l.classList.toggle("fade-r", l.scrollLeft + l.clientWidth < l.scrollWidth - 1); };
const shortName = (p: string) => p.split("/").pop()?.replace(/\.excalidraw$/, "") ?? p;

export function App() {
  const [dark, setDark] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [home, setHome] = useState(true); // Home tab = the gallery; the panes stay mounted underneath
  // the drawings on screen: one pane, or two side by side (split view). Never the same file twice: two autosaves would fight
  const [panes, setPanes] = useState<string[]>([]);
  // split pairs (Firefox style): each is one tab entry for two drawings, kept while another tab is shown. A drawing is in one pair at most
  const [pairs, setPairs] = useState<string[][]>([]);
  const [focus, setFocus] = useState(0); // the pane the user touched last: tab clicks, the gallery and the agent's canvas calls go to it
  const [menu, setMenu] = useState<{ tab: string; x: number; y: number } | null>(null);
  const panesRef = useRef(panes); panesRef.current = panes;
  const focusRef = useRef(focus); focusRef.current = focus;
  const pairsRef = useRef(pairs); pairsRef.current = pairs;
  const handles = useRef<(PaneHandle | null)[]>([]);
  // tab drag and drop: `p` is the dragged drawing, `pair` = the whole pair (dragged by its grip)
  const drag = useRef<{ p: string; pair: boolean } | null>(null);
  const [drop, setDrop] = useState<{ at: string; after?: boolean; swap?: boolean } | null>(null);

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
      // older formats: `pair` (one pair), `split` (the drawing beside `active`)
      const raw = saved.pair ? [saved.pair] : saved.split ? [[saved.active ?? "", saved.split]] : saved.pairs;
      const ok: string[][] = [];
      for (const pr of raw) if (pr[0] !== pr[1] && pr.every((x) => alive.includes(x) && !ok.flat().includes(x))) ok.push(pr);
      const mine = ok.find((pr) => pr.includes(last));
      setPairs(ok);
      setPanes(mine ?? [last]);
      setFocus(mine ? mine.indexOf(last) : 0);
    })();
  }, []);
  useEffect(() => { if (panes.length) localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active: home ? null : panes[focus] ?? panes[0], pairs })); }, [tabs, home, panes, focus, pairs]);

  useEffect(() => {
    document.querySelector(".tab-list .tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const l = document.querySelector<HTMLElement>(".tab-list");
    if (l) fade(l);
  }, [panes, focus, home, tabs]);

  useEffect(() => api.on("canvas:call", async ({ callId, tool, args }) => {
    const ps = panesRef.current, onScreen = ps.map(shortName);
    const i = args?.drawing ? ps.findIndex((p) => p === args.drawing || shortName(p) === args.drawing) : focusRef.current;
    if (i < 0) return api.send("canvas:result", { callId, error: `drawing "${args.drawing}" is not on screen. On screen: ${onScreen.join(", ")}` });
    const h = handles.current[i];
    if (!h?.api) return api.send("canvas:result", { callId, error: "canvas not ready" });
    try {
      const result = await runCanvasTool(h.api, tool, args, h.selected);
      api.send("canvas:result", { callId, result: tool === "read_canvas" ? { drawing: onScreen[i], onScreen, ...result } : result });
    }
    catch (e: any) { api.send("canvas:result", { callId, error: e?.message ?? String(e) }); }
  }), []);

  /** Show a drawing: a pair member brings back the split view, any other drawing shows alone. Opens a tab when it has none. */
  const openTab = useCallback((p: string) => {
    setTabs((t) => (t.includes(p) ? t : [...t, p]));
    setHome(false);
    const ps = pairsRef.current.find((pr) => pr.includes(p)) ?? [p];
    setPanes(ps);
    setFocus(ps.indexOf(p));
  }, []);
  /** Right-click > Open in split view (only from a drawing shown alone): it and this drawing become a new pair. */
  const openSplit = useCallback((p: string) => {
    setTabs((t) => (t.includes(p) ? t : [...t, p]));
    setHome(false);
    const ps = [panesRef.current[0], p];
    setPairs((all) => [...all, ps]);
    setPanes(ps);
    setFocus(1);
  }, []);
  /** Right-click > Close split view: the pair of `p` goes back to two tabs; on screen, the focused drawing stays. */
  const closeSplit = useCallback((p: string) => {
    setPairs((all) => all.filter((pr) => !pr.includes(p)));
    const ps = panesRef.current;
    if (ps.includes(p) && ps.length === 2) { setPanes([ps[focusRef.current]]); setFocus(0); }
  }, []);
  /** A drawing leaves the screen: in split view its pane closes; alone, the pane shows the next tab (or Home). */
  const unshow = useCallback((p: string, rest: string[], i: number) => {
    const ps = panesRef.current;
    setPairs((all) => all.filter((pr) => !pr.includes(p)));
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
    if (to) { setTabs((t) => t.map((x) => (x === from ? to : x))); setPanes((ps) => ps.map((x) => (x === from ? to : x))); setPairs((all) => all.map((pr) => pr.map((x) => (x === from ? to : x)))); return; }
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
  /** Drop: move the dragged tab (or pair) before/after the entry holding `at`, or to the end. A pair member dragged out leaves its pair. */
  const moveTo = (at: string | null, after: boolean) => {
    const d = drag.current;
    if (!d) return;
    const pr = pairs.find((x) => x.includes(d.p)), moving = d.pair && pr ? pr : [d.p];
    if (at && moving.includes(at)) return;
    if (pr && !d.pair) closeSplit(d.p);
    const target = at ? pairs.find((x) => x.includes(at)) ?? [at] : [];
    setTabs((t) => {
      const rest = t.filter((x) => !moving.includes(x)), idx = target.map((x) => rest.indexOf(x)).filter((i) => i >= 0);
      const i = !idx.length ? rest.length : after ? Math.max(...idx) + 1 : Math.min(...idx);
      return [...rest.slice(0, i), ...moving, ...rest.slice(i)];
    });
  };
  /** Drop a pair member on the other one: left and right swap, on screen too. */
  const swap = (pr: string[]) => {
    setPairs((all) => all.map((x) => (x === pr ? [x[1], x[0]] : x)));
    if (panes.length === 2 && pr.includes(panes[0])) { setPanes([panes[1], panes[0]]); setFocus(1 - focus); }
  };
  const dropZone = (at: string) => ({
    onDragOver: (e: React.DragEvent) => { if (!drag.current) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDrop({ at, after: e.clientX > r.left + r.width / 2 }); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); moveTo(at, !!drop?.after); setDrop(null); },
  });
  const dragStart = (p: string, pair: boolean) => (e: React.DragEvent) => { e.stopPropagation(); drag.current = { p, pair }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p); };
  const dragEnd = () => { drag.current = null; setDrop(null); };
  const dropMark = (at: string) => (drop?.at === at ? (drop.swap ? " drop-swap" : drop.after ? " drop-after" : " drop-before") : "");
  const tab = (t: string, pr?: string[]) => {
    const on = !home && t === panes[focus], shown = !home && !on && panes.includes(t);
    // inside a pair: dropping the other member here swaps them; anything else bubbles to the pair's own drop zone
    const inPair = pr && {
      onDragOver: (e: React.DragEvent) => { const d = drag.current; if (!d || d.pair || !pr.includes(d.p)) return; e.stopPropagation(); if (d.p === t) return; e.preventDefault(); setDrop({ at: t, swap: true }); },
      onDrop: (e: React.DragEvent) => { const d = drag.current; if (!d || d.pair || !pr.includes(d.p)) return; e.preventDefault(); e.stopPropagation(); if (d.p !== t) swap(pr); setDrop(null); },
    };
    return (
      <div key={t} className={"tab" + (on ? " on" : "") + (shown ? " shown" : "") + (pr ? (drop?.swap ? dropMark(t) : "") : dropMark(t))} role="tab" aria-selected={on} onClick={() => openTab(t)} onContextMenu={(e) => { e.preventDefault(); setMenu({ tab: t, x: e.clientX, y: e.clientY }); }} title={t}
        draggable onDragStart={dragStart(t, false)} onDragEnd={dragEnd} {...(pr ? inPair : dropZone(t))}>
        <span className="tab-name">{shortName(t)}</span>
        <button className="tab-x" aria-label={`Close ${shortName(t)}`} onClick={(e) => { e.stopPropagation(); closeTab(t); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    );
  };
  return (
    <div className={"app" + (dark ? " dark" : "")}>
      <div className="tabs" role="tablist">
        <button className={"tab home" + (home ? " on" : "")} role="tab" aria-selected={home} onClick={goHome} title="Drawings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
        </button>
        {/* only this strip scrolls (no scrollbar), so the traffic-light gap, Home, + and theme stay put */}
        <div className="tab-list" onWheel={(e) => { if (!e.deltaX) e.currentTarget.scrollLeft += e.deltaY; }} onScroll={(e) => fade(e.currentTarget)}
          onDragOver={(e) => { if (drag.current && e.target === e.currentTarget) { e.preventDefault(); setDrop(null); } }}
          onDrop={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); moveTo(null, false); setDrop(null); } }}>
        {tabs.map((t) => {
          // split view, Firefox style: the two shown drawings sit side by side in one pill, at the first one's place
          const pr = pairs.find((x) => x.includes(t));
          if (pr) return t === tabs.find((x) => pr.includes(x))
            ? <div key={pr.join("|")} className={"tab-split" + (!home && pr.includes(panes[focus]) ? " on" : "") + (drop?.swap ? "" : dropMark(pr[0]))} {...dropZone(pr[0])}>
                <span className="tab-grip" draggable onDragStart={dragStart(pr[0], true)} onDragEnd={dragEnd} title="Drag to move the pair">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M12 5v14" /></svg>
                </span>
                {pr.map((x) => tab(x, pr))}
              </div>
            : null;
          return tab(t);
        })}
        </div>
        <button className="tab plus" onClick={goHome} title="New tab" aria-label="New tab">+</button>
        <button className="tab theme" onClick={toggleTheme} title={dark ? "Light mode" : "Dark mode"} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={dark}>
          {dark
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>}
        </button>
      </div>
      {menu && (
        <div className="gmenu tabmenu" role="menu" style={{ left: menu.x, top: menu.y }}>
          {pairs.some((pr) => pr.includes(menu.tab))
            ? menuItem("Close split view", () => closeSplit(menu.tab))
            : menuItem("Open in split view", () => openSplit(menu.tab), split || menu.tab === panes[0])}
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
