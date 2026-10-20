import { useEffect, useState } from "react";
import { Excalidraw, loadFromBlob } from "@excalidraw/excalidraw";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import "./layout"; // registers the Playpen Sans / Inter font ids

/** Only blobs of a Vercel Blob store: the page never fetches a URL a link maker picked elsewhere. */
const isBlob = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" && x.hostname.endsWith(".public.blob.vercel-storage.com"); } catch { return false; } };

/** Read-only page for a shared drawing (ADR-0008): pan, zoom, export; no edits, nothing saved. */
export function Viewer({ src }: { src: string }) {
  const [data, setData] = useState<ExcalidrawInitialDataState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isBlob(src)) { setError("This is not an Explainer share link."); return; }
    (async () => {
      const r = await fetch(src, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 404 ? "This drawing is no longer shared." : `Could not load the drawing (HTTP ${r.status}).`);
      const d: any = await loadFromBlob(await r.blob(), null, null);
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      setData({ ...d, appState: { ...d.appState, theme: dark ? "dark" : "light", viewModeEnabled: true }, scrollToContent: true });
      document.title = "Shared drawing · Explainer";
    })().catch((e) => setError(e?.message ?? String(e)));
  }, [src]);
  if (error) return <div className="viewer-msg">{error}</div>;
  if (!data) return <div className="viewer-msg">Loading…</div>;
  return <div className="app"><Excalidraw initialData={data} viewModeEnabled UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, clearCanvas: false } }} /></div>;
}
