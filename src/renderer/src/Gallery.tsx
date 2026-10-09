import { useCallback, useEffect, useRef, useState } from "react";
import { exportToBlob, restoreElements } from "@excalidraw/excalidraw";
import { api } from "./api";
import type { DrawingInfo, DrawingList } from "../../shared/types";

/** "20 hours ago", Figma style. */
const ago = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000), m = s / 60, h = m / 60, d = h / 24;
  if (m < 1) return "just now";
  if (h < 1) return `${Math.floor(m)} min ago`;
  if (d < 1) return `${Math.floor(h)} hour${h < 2 ? "" : "s"} ago`;
  if (d < 2) return "yesterday";
  if (d < 30) return `${Math.floor(d)} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} month${d < 60 ? "" : "s"} ago`;
  return `${Math.floor(d / 365)} year${d < 730 ? "" : "s"} ago`;
};
const edited = (ms: number) => `Edited ${ago(ms)}`;

/** Thumbnail from the file on disk, cached by the main process per path + mtime. */
async function thumbnail(f: DrawingInfo): Promise<string | null> {
  const cached = await api.invoke("drawings:thumb", f.path, f.mtime);
  if (cached) return cached;
  const text = await api.invoke("file:read", f.path);
  if (!text) return null;
  try {
    const json = JSON.parse(text);
    const elements = restoreElements(json.elements ?? [], null).filter((e) => !e.isDeleted);
    if (!elements.length) return "";
    const blob = await exportToBlob({ elements, appState: { exportBackground: true, viewBackgroundColor: "#ffffff" }, files: json.files ?? null, maxWidthOrHeight: 640, mimeType: "image/jpeg", quality: 0.8 });
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
    await api.invoke("drawings:thumbSet", f.path, f.mtime, url);
    return url;
  } catch (e) { console.error("thumbnail failed", f.path, e); return null; }
}

const VIEW_KEY = "explainer-gallery"; // { kind, sort, view }
type Prefs = { kind: "all" | "files" | "folders"; sort: "modified" | "created" | "name"; dir: "asc" | "desc"; view: "grid" | "list" };
const DEFAULT_PREFS: Prefs = { kind: "all", sort: "modified", dir: "desc", view: "grid" };
const readPrefs = (): Prefs => { try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") }; } catch { return DEFAULT_PREFS; } };

const FolderIcon = () => (
  <svg viewBox="0 0 64 48" width="72" height="54" aria-hidden="true"><path d="M4 8a4 4 0 0 1 4-4h16l6 6h26a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#dcdcff" stroke="#8e8bd6" strokeWidth="2" /><path d="M4 18h56" stroke="#8e8bd6" strokeWidth="2" /></svg>
);
const Dots = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>;

type MenuItem = { label: string; onClick: () => void; danger?: boolean; head?: boolean };

export function Gallery({ current, onOpen, onRelocate }: { current: string | null; onOpen: (path: string) => void; onRelocate: (from: string, to: string | null) => void }) {
  const [list, setList] = useState<DrawingList>({ folders: [], files: [] });
  const [cwd, setCwd] = useState<string | null>(null); // folder name, or null at the root
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null); // file path or "folder:<name>"
  const [menu, setMenu] = useState<string | null>(null); // same keys
  const [addingFolder, setAddingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // file paths ticked for a bulk action
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const setPref = (patch: Partial<Prefs>) => setPrefs((p) => { const n = { ...p, ...patch }; localStorage.setItem(VIEW_KEY, JSON.stringify(n)); return n; });
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const l = await api.invoke("drawings:list");
    setList(l);
    for (const f of l.files) {
      if (!alive.current) return;
      const key = `${f.path}@${f.mtime}`;
      if (thumbs[key] !== undefined) continue;
      const url = await thumbnail(f); // ponytail: one at a time; fine for a few dozen drawings
      if (url !== null) setThumbs((t) => ({ ...t, [key]: url }));
    }
  }, [thumbs]);

  useEffect(() => { alive.current = true; reload(); return () => { alive.current = false; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key !== "Escape") return; if (menu) setMenu(null); else if (selected.size) setSelected(new Set()); };
    const onClick = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".gmenu, .gmore")) setMenu(null); };
    window.addEventListener("keydown", onKey); window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, [menu, selected]);

  const act = async (fn: () => Promise<unknown>) => { setMenu(null); setError(null); try { await fn(); await reload(); } catch (e: any) { setError(e?.message?.replace(/^.*Error: /, "") ?? String(e)); } };
  const renameFile = (f: DrawingInfo, name: string) => { setRenaming(null); if (name.trim() && name.trim() !== f.name) act(async () => onRelocate(f.path, await api.invoke("drawings:rename", f.path, name))); };
  const inFolder = (d: string) => list.files.filter((f) => f.folder === d);
  const renameFolder = (d: string, name: string) => { setRenaming(null); const next = name.trim(); if (next && next !== d) act(async () => { await api.invoke("drawings:renameFolder", d, next); for (const f of inFolder(d)) onRelocate(f.path, f.path.replace(`/${d}/`, `/${next}/`)); if (cwd === d) setCwd(next); }); };
  const move = (f: DrawingInfo, folder: string | null) => act(async () => onRelocate(f.path, await api.invoke("drawings:move", f.path, folder)));
  const removeFile = (f: DrawingInfo) => { setMenu(null); if (!confirm(`Move "${f.name}" to the Trash?`)) return; act(async () => { await api.invoke("drawings:delete", f.path); onRelocate(f.path, null); }); };
  const removeFolder = (d: string) => { setMenu(null); const n = inFolder(d).length; if (!confirm(`Move the folder "${d}"${n ? ` and its ${n} drawing${n > 1 ? "s" : ""}` : ""} to the Trash?`)) return; act(async () => { const files = inFolder(d); await api.invoke("drawings:deleteFolder", d); for (const f of files) onRelocate(f.path, null); if (cwd === d) setCwd(null); }); };
  const picked = list.files.filter((f) => selected.has(f.path));
  const toggle = (p: string) => setSelected((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const bulkTrash = () => { if (!confirm(`Move ${picked.length} drawing${picked.length > 1 ? "s" : ""} to the Trash?`)) return; act(async () => { for (const f of picked) { await api.invoke("drawings:delete", f.path); onRelocate(f.path, null); } setSelected(new Set()); }); };
  const bulkMove = (folder: string | null) => act(async () => { for (const f of picked) if (f.folder !== folder) onRelocate(f.path, await api.invoke("drawings:move", f.path, folder)); setSelected(new Set()); });
  const create = () => act(async () => onOpen(await api.invoke("file:new", cwd)));

  const cmp = (a: DrawingInfo, b: DrawingInfo) => (prefs.sort === "name" ? a.name.localeCompare(b.name) : prefs.sort === "created" ? a.ctime - b.ctime : a.mtime - b.mtime);
  const files = list.files.filter((f) => f.folder === cwd && prefs.kind !== "folders").sort((a, b) => (prefs.dir === "asc" ? cmp(a, b) : -cmp(a, b)));
  /** Header click: new column sorts its natural way (names A to Z, times newest first); the same column again flips the direction. */
  const sortBy = (col: Prefs["sort"]) => setPref(prefs.sort === col ? { dir: prefs.dir === "asc" ? "desc" : "asc" } : { sort: col, dir: col === "name" ? "asc" : "desc" });
  const arrow = (col: Prefs["sort"]) => prefs.sort === col && <span className="garrow">{prefs.dir === "asc" ? "↑" : "↓"}</span>;
  const folders = cwd === null && prefs.kind !== "files" ? list.folders : [];
  const folderItems = (d: string): MenuItem[] => [
    { label: "Open", onClick: () => { setMenu(null); setCwd(d); } },
    { label: "Rename", onClick: () => { setMenu(null); setRenaming(`folder:${d}`); } },
    { label: "Move to Trash", onClick: () => removeFolder(d), danger: true },
  ];
  const fileItems = (f: DrawingInfo): MenuItem[] => {
    const targets = [null, ...list.folders].filter((d) => d !== f.folder);
    return [
      { label: "Open", onClick: () => onOpen(f.path) },
      { label: "Rename", onClick: () => { setMenu(null); setRenaming(f.path); } },
      ...(targets.length ? [{ label: "Move to", onClick: () => {}, head: true }, ...targets.map((d) => ({ label: d ?? "No folder", onClick: () => move(f, d) }))] : []),
      { label: "Move to Trash", onClick: () => removeFile(f), danger: true },
    ];
  };
  /** The whole card (or list row) opens its drawing or folder, except its checkbox, its menu and a name being edited. */
  const opens = (fn: () => void) => (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest(".gpick, .gmore, .gmenu, input.gname")) fn(); };
  const Name = ({ id, value, onRename }: { id: string; value: string; onRename: (v: string) => void }) => renaming === id ? (
    <input className="gname" autoFocus defaultValue={value} onKeyDown={(e) => { if (e.key === "Enter") onRename(e.currentTarget.value); if (e.key === "Escape") setRenaming(null); }} onBlur={(e) => onRename(e.currentTarget.value)} />
  ) : <button className="gname" onDoubleClick={() => setRenaming(id)} title="Open (double-click to rename)">{value}</button>;
  const Menu = ({ id, items }: { id: string; items: MenuItem[] }) => (
    <>
      <button className="gmore" onClick={() => setMenu(menu === id ? null : id)} aria-label="More" title="More"><Dots /></button>
      {menu === id && (
        <div className="gmenu" role="menu">
          {items.map((it, i) => it.head ? <div key={i} className="ghead-item">{it.label}</div> : <button key={i} role="menuitem" className={it.danger ? "danger" : ""} onClick={it.onClick}>{it.label}</button>)}
        </div>
      )}
    </>
  );

  return (
    <div className="gallery" role="dialog" aria-label="Drawings">
      <header className="ghead">
        <div className="gfilters">
          <select className="gselect" value={prefs.kind} onChange={(e) => setPref({ kind: e.target.value as Prefs["kind"] })} title="Show">
            <option value="all">All files</option>
            <option value="files">Drawings</option>
            <option value="folders">Folders</option>
          </select>
          <select className="gselect" value={prefs.sort} onChange={(e) => sortBy(e.target.value as Prefs["sort"])} title="Sort">
            <option value="modified">Last modified</option>
            <option value="created">Date created</option>
            <option value="name">Alphabetical</option>
          </select>
          <div className="gview" role="group" aria-label="View">
            <button className={prefs.view === "grid" ? "on" : ""} onClick={() => setPref({ view: "grid" })} title="Grid" aria-pressed={prefs.view === "grid"}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
            </button>
            <button className={prefs.view === "list" ? "on" : ""} onClick={() => setPref({ view: "list" })} title="List" aria-pressed={prefs.view === "list"}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>
            </button>
          </div>
        </div>
        <div className="gactions">
          {cwd !== null && (
            <nav className="gcrumbs" aria-label="Folder">
              <button className="gcrumb back" onClick={() => setCwd(null)} title="All drawings" aria-label="Back to all drawings">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <span className="gcrumb on">{cwd}</span>
            </nav>
          )}
          {cwd === null && (addingFolder ? (
            <input className="gnew" autoFocus placeholder="Folder name" onKeyDown={(e) => { if (e.key === "Enter") { const v = e.currentTarget.value; setAddingFolder(false); if (v.trim()) act(() => api.invoke("drawings:newFolder", v)); } if (e.key === "Escape") setAddingFolder(false); }} onBlur={() => setAddingFolder(false)} />
          ) : <button className="gsecondary" onClick={() => setAddingFolder(true)}>+ Folder</button>)}
          <button className="gprimary" onClick={create}>+ New drawing</button>
        </div>
      </header>
      {error && <div className="gerror">{error}</div>}
      {picked.length > 0 && (
        <div className="gbulk">
          <span>{picked.length} selected</span>
          <select value="" onChange={(e) => bulkMove(e.target.value === "\0root" ? null : e.target.value)} title="Move the selected drawings">
            <option value="" disabled>Move to…</option>
            <option value="\0root">No folder</option>
            {list.folders.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button className="gdanger" onClick={bulkTrash}>Move to Trash</button>
          <button className="gsecondary" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {prefs.view === "list" ? (
        <div className="glist" role="table">
          <div className="grow head" role="row">
            <span />
            <button className={"gcol" + (prefs.sort === "name" ? " on" : "")} onClick={() => sortBy("name")}>Name{arrow("name")}</button>
            <button className={"gcol" + (prefs.sort === "modified" ? " on" : "")} onClick={() => sortBy("modified")}>Last modified{arrow("modified")}</button>
            <button className={"gcol" + (prefs.sort === "created" ? " on" : "")} onClick={() => sortBy("created")}>Created{arrow("created")}</button>
            <span />
          </div>
          {folders.map((d) => {
            const key = `folder:${d}`, n = list.files.filter((f) => f.folder === d).length;
            return (
              <div key={key} className="grow folder" role="row" onClick={opens(() => setCwd(d))}>
                <span />
                <div className="gcell name">
                  <button className="gthumb" title={`Open ${d}`}><FolderIcon /></button>
                  <Name id={key} value={d} onRename={(v) => renameFolder(d, v)} />
                </div>
                <span className="gcell dim">{n} drawing{n === 1 ? "" : "s"}</span>
                <span className="gcell dim" />
                <span className="gcell"><Menu id={key} items={folderItems(d)} /></span>
              </div>
            );
          })}
          {files.map((f) => {
            const t = thumbs[`${f.path}@${f.mtime}`];
            return (
              <div key={f.path} className={"grow" + (f.path === current ? " current" : "") + (selected.has(f.path) ? " picked" : "")} role="row" onClick={opens(() => onOpen(f.path))}>
                <input type="checkbox" className="gpick" checked={selected.has(f.path)} onChange={() => toggle(f.path)} aria-label={`Select ${f.name}`} />
                <div className="gcell name">
                  <button className="gthumb" title={`Open ${f.name}`}>{t ? <img src={t} alt="" /> : <span className="gempty">{t === "" ? "empty" : ""}</span>}</button>
                  <Name id={f.path} value={f.name} onRename={(v) => renameFile(f, v)} />
                </div>
                <span className="gcell" title={new Date(f.mtime).toLocaleString()}>{ago(f.mtime)}</span>
                <span className="gcell" title={new Date(f.ctime).toLocaleString()}>{ago(f.ctime)}</span>
                <span className="gcell"><Menu id={f.path} items={fileItems(f)} /></span>
              </div>
            );
          })}
          {!folders.length && !files.length && <div className="gnone">No drawings here yet.</div>}
        </div>
      ) : (
      <div className="ggrid">
        {folders.map((d) => {
          const key = `folder:${d}`, n = list.files.filter((f) => f.folder === d).length;
          return (
            <article key={key} className="gcard folder" onClick={opens(() => setCwd(d))}>
              <button className="gthumb" title={`Open ${d}`}><FolderIcon /></button>
              <div className="gmeta">
                <Name id={key} value={d} onRename={(v) => renameFolder(d, v)} />
                <div className="gfoot">
                  <span className="gdate">{n} drawing{n === 1 ? "" : "s"}</span>
                  <Menu id={key} items={folderItems(d)} />
                </div>
              </div>
            </article>
          );
        })}
        {files.map((f) => {
          const t = thumbs[`${f.path}@${f.mtime}`];
          return (
            <article key={f.path} className={"gcard" + (f.path === current ? " current" : "") + (selected.has(f.path) ? " picked" : "")} onClick={opens(() => onOpen(f.path))}>
              <input type="checkbox" className="gpick" checked={selected.has(f.path)} onChange={() => toggle(f.path)} aria-label={`Select ${f.name}`} title="Select for a bulk action" />
              <button className="gthumb" title={`Open ${f.name}`}>
                {t ? <img src={t} alt="" /> : <span className="gempty">{t === "" ? "empty" : ""}</span>}
              </button>
              <div className="gmeta">
                <Name id={f.path} value={f.name} onRename={(v) => renameFile(f, v)} />
                <div className="gfoot">
                  <span className="gdate" title={new Date(f.mtime).toLocaleString()}>{edited(f.mtime)}</span>
                  <Menu id={f.path} items={fileItems(f)} />
                </div>
              </div>
            </article>
          );
        })}
        {!folders.length && !files.length && <div className="gnone">No drawings here yet.</div>}
      </div>
      )}
    </div>
  );
}
