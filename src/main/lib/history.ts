/**
 * The .history safety copies of a drawing: when to keep one, its file name, and which old copies to prune.
 * Pure: the caller reads and writes the files (src/main/index.ts writeDrawing).
 */

/** Live (not deleted) elements in a scene's JSON; -1 when the text is not a scene. */
export const liveCount = (text: string): number => {
  try { return (JSON.parse(text).elements ?? []).filter((e: any) => !e.isDeleted).length; } catch { return -1; }
};

export const KEEP = 30;
const EVERY_MS = 5 * 60_000;

/**
 * The name suffix of the copy to keep before `next` replaces `prev`, or null for no copy.
 * A copy before an empty or a >30 percent smaller scene always; otherwise at most every 5 min.
 */
export function backupSuffix(prev: string, next: string, msSinceLast: number): string | null {
  const prevLive = liveCount(prev), nextLive = liveCount(next);
  if (prev === next || prevLive <= 0) return null;
  if (nextLive === 0) return "-before-clear";
  if (nextLive > 0 && nextLive < prevLive * 0.7) return "-before-shrink";
  return msSinceLast > EVERY_MS ? "" : null;
}

const stampOf = (now: number) => new Date(now).toISOString().replace(/[:.]/g, "-");
export const historyName = (base: string, now: number, suffix: string) => `${base}-${stampOf(now)}${suffix}.excalidraw`;

/** True for a copy of `base` only: "Untitled-2026-…" is a copy of Untitled, "Untitled-1-2026-…" is not. */
export function isCopyOf(base: string, file: string): boolean {
  const rest = file.startsWith(`${base}-`) ? file.slice(base.length + 1) : "";
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-before-(clear|shrink))?\.excalidraw$/.test(rest);
}

/** The copies of `base` to delete so that the newest KEEP stay. Other drawings' copies are never listed. */
export function toPrune(base: string, files: string[]): string[] {
  const mine = files.filter((f) => isCopyOf(base, f)).sort();
  return mine.slice(0, Math.max(0, mine.length - KEEP));
}
