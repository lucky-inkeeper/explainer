import path from "node:path";

// The UI is loaded from the web, so the main process treats every IPC call as untrusted input.

/** True when `p` resolves to a path inside `dir` (not `dir` itself). */
export const insideDir = (dir: string, p: unknown): boolean => {
  if (typeof p !== "string" || !p) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** True when `url` has exactly the origin `origin` (scheme, host and port). */
export const sameOrigin = (url: unknown, origin: string): boolean => {
  try { return typeof url === "string" && new URL(url).origin === origin; } catch { return false; }
};
