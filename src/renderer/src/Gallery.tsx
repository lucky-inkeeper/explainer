import { useCallback, useEffect, useRef, useState } from "react";
import { exportToBlob, restoreElements } from "@excalidraw/excalidraw";
import { api } from "./api";
import type { DrawingInfo, DrawingList } from "../../shared/types";

const ALL = "\0all", ROOT = "\0root";
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

export function Gallery({ current, onOpen, onClose }: { current: string | null; onOpen: (path: string) => void; onClose: () => void }) {
  const [list, setList] = useState<DrawingList>({ folders: [], files: [] });
  const [filter, setFilter] = useState<string>(ALL);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !renaming && !addingFolder) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, renaming, addingFolder]);

  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); await reload(); } catch (e: any) { setError(e?.message?.replace(/^.*Error: /, "") ?? String(e)); } };
  const rename = (f: DrawingInfo, name: string) => { setRenaming(null); if (name.trim() && name.trim() !== f.name) act(async () => { const p = await api.invoke("drawings:rename", f.path, name); if (f.path === current) onOpen(p); }); };
  const move = (f: DrawingInfo, folder: string | null) => act(async () => { const p = await api.invoke("drawings:move", f.path, folder); if (f.path === current) onOpen(p); });
  const remove = (f: DrawingInfo) => { if (!confirm(`Move "${f.name}" to the Trash?`)) return; act(async () => { await api.invoke("drawings:delete", f.path); if (f.path === current) onOpen(await api.invoke("file:new")); }); };
  const create = () => act(async () => onOpen(await api.invoke("file:new", filter === ALL || filter === ROOT ? null : filter)));

  const visible = list.files.filter((f) => filter === ALL || (filter === ROOT ? f.folder === null : f.folder === filter));
  const tab = (key: string, label: string, count: number) => (
    <button key={key} className={"gtab" + (filter === key ? " on" : "")} onClick={() => setFilter(key)}>{label}<span>{count}</span></button>
  );

  return (
    <div className="gallery" role="dialog" aria-label="Drawings">
      <header className="ghead">
        <div className="gtabs">
          {tab(ALL, "All", list.files.length)}
          {tab(ROOT, "No folder", list.files.filter((f) => f.folder === null).length)}
          {list.folders.map((d) => tab(d, d, list.files.filter((f) => f.folder === d).length))}
          {addingFolder ? (
            <input className="gnew" autoFocus placeholder="Folder name" onKeyDown={(e) => { if (e.key === "Enter") { const v = e.currentTarget.value; setAddingFolder(false); if (v.trim()) act(() => api.invoke("drawings:newFolder", v)); } if (e.key === "Escape") setAddingFolder(false); }} onBlur={() => setAddingFolder(false)} />
          ) : <button className="gtab plus" onClick={() => setAddingFolder(true)}>+ folder</button>}
        </div>
        <div className="gactions">
          <button className="gprimary" onClick={create}>+ New drawing</button>
          <button className="gclose" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </header>
      {error && <div className="gerror">{error}</div>}
      <div className="ggrid">
        {visible.map((f) => {
          const t = thumbs[`${f.path}@${f.mtime}`];
          return (
            <article key={f.path} className={"gcard" + (f.path === current ? " current" : "")}>
              <button className="gthumb" onClick={() => onOpen(f.path)} title={`Open ${f.name}`}>
                {t ? <img src={t} alt="" /> : <span className="gempty">{t === "" ? "empty" : ""}</span>}
              </button>
              <div className="gmeta">
                {renaming === f.path ? (
                  <input className="gname" autoFocus defaultValue={f.name} onKeyDown={(e) => { if (e.key === "Enter") rename(f, e.currentTarget.value); if (e.key === "Escape") setRenaming(null); }} onBlur={(e) => rename(f, e.currentTarget.value)} />
                ) : (
                  <button className="gname" onClick={() => onOpen(f.path)} onDoubleClick={() => setRenaming(f.path)} title="Open (double-click to rename)">{f.name}</button>
                )}
                <div className="gfoot">
                  <select value={f.folder ?? ""} onChange={(e) => move(f, e.target.value || null)} title="Folder">
                    <option value="">No folder</option>
                    {list.folders.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <span className="gdate" title={new Date(f.mtime).toLocaleString()}>{f.hasSession ? "● " : ""}{when(f.mtime)}</span>
                  <button className="gicon" onClick={() => setRenaming(f.path)} title="Rename" aria-label="Rename">✎</button>
                  <button className="gicon" onClick={() => remove(f)} title="Move to Trash" aria-label="Move to Trash">🗑</button>
                </div>
              </div>
            </article>
          );
        })}
        {!visible.length && <div className="gnone">No drawings here yet.</div>}
      </div>
    </div>
  );
}
