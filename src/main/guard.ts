import path from "node:path";

// The main process treats every IPC call as untrusted input: a check here holds even if the UI page is compromised.

/** True when `p` resolves to a path inside `dir` (not `dir` itself). */
export const insideDir = (dir: string, p: unknown): boolean => {
  if (typeof p !== "string" || !p) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Scheme, host and port of `url`. Not URL.origin: that is "null" for the app:// scheme of the UI. */
export const originOf = (url: string): string => { const u = new URL(url); return `${u.protocol}//${u.host}`; };

/** True when `url` has exactly the origin `origin` (scheme, host and port). */
export const sameOrigin = (url: unknown, origin: string): boolean => {
  try { return typeof url === "string" && originOf(url) === origin; } catch { return false; }
};
