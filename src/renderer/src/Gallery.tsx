import { useCallback, useEffect, useRef, useState } from "react";
import { exportToBlob, restoreElements } from "@excalidraw/excalidraw";
import { api } from "./api";
import type { DrawingInfo, DrawingList } from "../../shared/types";

const when = (ms: number) => {
  const d = new Date(ms), today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};

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

const FolderIcon = () => (
  <svg viewBox="0 0 64 48" width="72" height="54" aria-hidden="true"><path d="M4 8a4 4 0 0 1 4-4h16l6 6h26a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="#dcdcff" stroke="#8e8bd6" strokeWidth="2" /><path d="M4 18h56" stroke="#8e8bd6" strokeWidth="2" /></svg>
);
const Dots = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>;

type MenuItem = { label: string; onClick: () => void; danger?: boolean; head?: boolean };

export function Gallery({ current, onOpen, onRelocate, onClose }: { current: string | null; onOpen: (path: string) => void; onRelocate: (from: string, to: string | null) => void; onClose?: () => void }) {
  const [list, setList] = useState<DrawingList>({ folders: [], files: [] });
  const [cwd, setCwd] = useState<string | null>(null); // folder name, or null at the root
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null); // file path or "folder:<name>"
  const [menu, setMenu] = useState<string | null>(null); // same keys
  const [addingFolder, setAddingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // file paths ticked for a bulk action
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
    const onKey = (e: KeyboardEvent) => { if (e.key !== "Escape") return; if (menu) setMenu(null); else if (selected.size) setSelected(new Set()); else if (!renaming && !addingFolder) onClose?.(); };
    const onClick = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".gmenu, .gmore")) setMenu(null); };
    window.addEventListener("keydown", onKey); window.addEventListener("mousedown", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick); };
  }, [onClose, renaming, addingFolder, menu, selected]);

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

  const files = list.files.filter((f) => f.folder === cwd);
  const folders = cwd === null ? list.folders : [];
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
        <nav className="gcrumbs" aria-label="Folder">
          <button className={"gcrumb" + (cwd === null ? " on" : "")} onClick={() => setCwd(null)}>Drawings</button>
          {cwd !== null && <><span className="gsep">/</span><span className="gcrumb on">{cwd}</span></>}
        </nav>
        <div className="gactions">
          {cwd === null && (addingFolder ? (
            <input className="gnew" autoFocus placeholder="Folder name" onKeyDown={(e) => { if (e.key === "Enter") { const v = e.currentTarget.value; setAddingFolder(false); if (v.trim()) act(() => api.invoke("drawings:newFolder", v)); } if (e.key === "Escape") setAddingFolder(false); }} onBlur={() => setAddingFolder(false)} />
          ) : <button className="gsecondary" onClick={() => setAddingFolder(true)}>+ Folder</button>)}
          <button className="gprimary" onClick={create}>+ New drawing</button>
          {onClose && <button className="gclose" onClick={onClose} aria-label="Back to the drawing" title="Back to the drawing (Esc)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>}
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
      <div className="ggrid">
        {folders.map((d) => {
          const key = `folder:${d}`, n = list.files.filter((f) => f.folder === d).length;
          return (
            <article key={key} className="gcard folder">
              <button className="gthumb" onClick={() => setCwd(d)} title={`Open ${d}`}><FolderIcon /></button>
              <div className="gmeta">
                {renaming === key ? (
                  <input className="gname" autoFocus defaultValue={d} onKeyDown={(e) => { if (e.key === "Enter") renameFolder(d, e.currentTarget.value); if (e.key === "Escape") setRenaming(null); }} onBlur={(e) => renameFolder(d, e.currentTarget.value)} />
                ) : <button className="gname" onClick={() => setCwd(d)} onDoubleClick={() => setRenaming(key)}>{d}</button>}
                <div className="gfoot">
                  <span className="gdate">{n} drawing{n === 1 ? "" : "s"}</span>
                  <Menu id={key} items={[
                    { label: "Open", onClick: () => { setMenu(null); setCwd(d); } },
                    { label: "Rename", onClick: () => { setMenu(null); setRenaming(key); } },
                    { label: "Move to Trash", onClick: () => removeFolder(d), danger: true },
                  ]} />
                </div>
              </div>
            </article>
          );
        })}
        {files.map((f) => {
          const t = thumbs[`${f.path}@${f.mtime}`];
          const targets = [null, ...list.folders].filter((d) => d !== f.folder);
          return (
            <article key={f.path} className={"gcard" + (f.path === current ? " current" : "") + (selected.has(f.path) ? " picked" : "")}>
              <input type="checkbox" className="gpick" checked={selected.has(f.path)} onChange={() => toggle(f.path)} aria-label={`Select ${f.name}`} title="Select for a bulk action" />
              <button className="gthumb" onClick={() => onOpen(f.path)} title={`Open ${f.name}`}>
                {t ? <img src={t} alt="" /> : <span className="gempty">{t === "" ? "empty" : ""}</span>}
              </button>
              <div className="gmeta">
                {renaming === f.path ? (
                  <input className="gname" autoFocus defaultValue={f.name} onKeyDown={(e) => { if (e.key === "Enter") renameFile(f, e.currentTarget.value); if (e.key === "Escape") setRenaming(null); }} onBlur={(e) => renameFile(f, e.currentTarget.value)} />
                ) : <button className="gname" onClick={() => onOpen(f.path)} onDoubleClick={() => setRenaming(f.path)} title="Open (double-click to rename)">{f.name}</button>}
                <div className="gfoot">
                  <span className="gdate" title={new Date(f.mtime).toLocaleString()}>{f.hasSession ? "● " : ""}{when(f.mtime)}</span>
                  <Menu id={f.path} items={[
                    { label: "Open", onClick: () => onOpen(f.path) },
                    { label: "Rename", onClick: () => { setMenu(null); setRenaming(f.path); } },
                    ...(targets.length ? [{ label: "Move to", onClick: () => {}, head: true }, ...targets.map((d) => ({ label: d ?? "No folder", onClick: () => move(f, d) }))] : []),
                    { label: "Move to Trash", onClick: () => removeFile(f), danger: true },
                  ]} />
                </div>
              </div>
            </article>
          );
        })}
        {!folders.length && !files.length && <div className="gnone">No drawings here yet.</div>}
      </div>
    </div>
  );
}
