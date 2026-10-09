import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";

// Sync of data/drawings with a Vercel Blob store, so several Macs share the drawings (ADR-0007).
// Each drawing is one public blob at drawings/<folder?>/<name>.excalidraw. The state file remembers, per drawing,
// the content hash and blob etag at the last sync, so each side can tell who changed. On a conflict the cloud keeps
// the name and the local version is kept next to it as "<name> (conflict <host> <time>)"; nothing is overwritten unseen.

export interface Seen { etag: string; hash: string; mtime: number }
export type SyncState = Record<string, Seen>;
export interface Local { hash: string; mtime: number }
export interface Remote { etag: string }
export type Action =
  | { do: "upload"; rel: string; ifMatch?: string }
  | { do: "download"; rel: string }
  | { do: "merge"; rel: string } // both sides have it, never synced here: download and compare
  | { do: "conflict"; rel: string }
  | { do: "trashLocal"; rel: string }
  | { do: "deleteRemote"; rel: string }
  | { do: "forget"; rel: string };

/** What to do for each drawing, from the local files, the blobs and the last-sync state. Pure. */
export function plan(local: Map<string, Local>, remote: Map<string, Remote>, state: SyncState): Action[] {
  const out: Action[] = [];
  for (const rel of new Set([...local.keys(), ...remote.keys(), ...Object.keys(state)])) {
    const L = local.get(rel), R = remote.get(rel), S = state[rel];
    const lc = !!L && (!S || L.hash !== S.hash), rc = !!R && (!S || R.etag !== S.etag);
    if (L && R) {
      if (!S) out.push({ do: "merge", rel });
      else if (lc && rc) out.push({ do: "conflict", rel });
      else if (lc) out.push({ do: "upload", rel, ifMatch: S.etag });
      else if (rc) out.push({ do: "download", rel });
    } else if (L) out.push(S && !lc ? { do: "trashLocal", rel } : { do: "upload", rel }); // gone from the cloud: deleted on another Mac, unless changed here since
    else if (R) out.push(S && !rc ? { do: "deleteRemote", rel } : { do: "download", rel }); // gone here: deleted on this Mac, unless changed on another since
    else out.push({ do: "forget", rel });
  }
  return out;
}

/** A blob pathname as a drawing path relative to data/drawings, or null when it is not a drawing this app writes. */
export function relOf(pathname: string): string | null {
  const m = /^drawings\/((?:[^/]+\/)?[^/]+\.excalidraw)$/.exec(pathname);
  if (!m || m[1].split("/").some((s) => s === "." || s === ".." || s.startsWith(".") || s.includes("\\"))) return null;
  return m[1];
}

const sha1 = (s: string | Buffer) => createHash("sha1").update(s).digest("hex");
const stamp = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`; }; // local time

export interface SyncDeps {
  dir: string; // data/drawings
  stateFile: string;
  token: string;
  write: (p: string, text: string) => void; // atomic write with .history backup
  trash: (p: string) => Promise<void>;
  changed: (paths: string[]) => void; // drawings this sync wrote, moved or trashed
}

export function startSync(d: SyncDeps) {
  const readState = (): SyncState => { try { return JSON.parse(fs.readFileSync(d.stateFile, "utf8")); } catch { return {}; } };
  const abs = (rel: string) => path.join(d.dir, ...rel.split("/"));
  const opts = { token: d.token };

  function scanLocal(state: SyncState): Map<string, Local> {
    const out = new Map<string, Local>();
    const add = (rel: string) => {
      const mtime = fs.statSync(abs(rel)).mtimeMs, S = state[rel];
      out.set(rel, { mtime, hash: S && S.mtime === mtime ? S.hash : sha1(fs.readFileSync(abs(rel))) });
    };
    for (const e of fs.readdirSync(d.dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) { for (const f of fs.readdirSync(path.join(d.dir, e.name))) if (f.endsWith(".excalidraw") && !f.startsWith(".")) add(`${e.name}/${f}`); }
      else if (e.name.endsWith(".excalidraw")) add(e.name);
    }
    return out;
  }
  async function scanRemote(): Promise<Map<string, Remote>> {
    const out = new Map<string, Remote>();
    let cursor: string | undefined;
    do {
      const r = await list({ ...opts, prefix: "drawings/", cursor, limit: 1000 });
      for (const b of r.blobs) { const rel = relOf(b.pathname); if (rel) out.set(rel, { etag: b.etag }); }
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return out;
  }
  /** The blob as `list()` saw it. A read can lag an overwrite for a while (CDN), so a read of another version is refused; the next sweep retries. */
  async function fetchText(rel: string, want: string): Promise<{ text: string; etag: string }> {
    const r = await get(`drawings/${rel}`, { ...opts, access: "public", useCache: false });
    if (!r || r.statusCode !== 200) throw new Error(`blob drawings/${rel} not found`);
    const etag = r.blob.etag.replace(/^W\//, ""); // get() returns a weak etag; list() and ifMatch use the strong one
    if (etag !== want) throw new Error(`read ${etag}, listed ${want}: stale read, retry next sweep`);
    return { text: await new Response(r.stream).text(), etag };
  }
  const seen = (rel: string, etag: string, text: string | Buffer): Seen => ({ etag, hash: sha1(text), mtime: fs.statSync(abs(rel)).mtimeMs });
  /** A free name next to `rel` for the local copy that lost a conflict. */
  const conflictRel = (rel: string) => {
    const base = rel.replace(/\.excalidraw$/, ""), host = os.hostname().replace(/\.local$/, "").replace(/[\/\\:]/g, "-");
    let r = `${base} (conflict ${host} ${stamp()}).excalidraw`;
    for (let i = 2; fs.existsSync(abs(r)); i++) r = `${base} (conflict ${host} ${stamp()} ${i}).excalidraw`;
    return r;
  };

  async function run(a: Action, state: SyncState, remote: Map<string, Remote>, touched: string[]) {
    const p = abs(a.rel);
    switch (a.do) {
      case "upload": {
        const text = fs.readFileSync(p);
        const r = await put(`drawings/${a.rel}`, text, { ...opts, access: "public", contentType: "application/json", addRandomSuffix: false, cacheControlMaxAge: 60, ...(a.ifMatch ? { ifMatch: a.ifMatch } : { allowOverwrite: false }) });
        state[a.rel] = seen(a.rel, r.etag, text);
        return;
      }
      case "download": case "merge": case "conflict": {
        const { text, etag } = await fetchText(a.rel, remote.get(a.rel)!.etag);
        if (fs.existsSync(p) && sha1(fs.readFileSync(p)) !== sha1(text)) {
          if (a.do !== "download") { const c = conflictRel(a.rel); fs.renameSync(p, abs(c)); touched.push(abs(c)); } // the local version survives under a new name; the next sweep uploads it
        }
        if (!fs.existsSync(p) || sha1(fs.readFileSync(p)) !== sha1(text)) { fs.mkdirSync(path.dirname(p), { recursive: true }); d.write(p, text); touched.push(p); }
        state[a.rel] = seen(a.rel, etag, text);
        return;
      }
      case "trashLocal": await d.trash(p); delete state[a.rel]; touched.push(p); return;
      case "deleteRemote": await del(`drawings/${a.rel}`, opts); delete state[a.rel]; return;
      case "forget": delete state[a.rel]; return;
    }
  }

  let running: Promise<void> | null = null, again = false;
  async function sweep() {
    const state = readState(), touched: string[] = [];
    const remote = await scanRemote(), actions = plan(scanLocal(state), remote, state);
    for (const a of actions) {
      try { await run(a, state, remote, touched); }
      catch (e: any) { if (!(e instanceof BlobPreconditionFailedError)) console.error(`[sync] ${a.do} ${a.rel}: ${e?.message ?? e}`); } // a precondition miss means another Mac won the race: the next sweep sees it
    }
    fs.writeFileSync(d.stateFile, JSON.stringify(state, null, 2));
    if (touched.length) d.changed(touched);
  }
  /** Run a sweep now, or once more after the one in progress. */
  function syncNow() {
    if (running) { again = true; return running; }
    running = sweep().catch((e) => console.error(`[sync] ${e?.message ?? e}`)).finally(() => { running = null; if (again) { again = false; syncNow(); } });
    return running;
  }
  let soon: NodeJS.Timeout | undefined;
  /** A local drawing changed: sync once the edits pause. */
  const syncSoon = () => { clearTimeout(soon); soon = setTimeout(syncNow, 3000); };
  setInterval(syncNow, 30_000); // ponytail: polling; a push channel if 30 s between Macs is too slow
  syncNow();
  return { syncNow, syncSoon };
}
