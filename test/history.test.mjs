// The .history safety copies: when one is kept, and pruning never touches another drawing's copies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backupSuffix, historyName, isCopyOf, toPrune, KEEP } from "../src/main/lib/history.ts";

const scene = (n) => JSON.stringify({ elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}` })) });

test("backupSuffix: always before a clear or a big shrink, else at most every 5 min", () => {
  assert.equal(backupSuffix(scene(10), scene(0), 0), "-before-clear");
  assert.equal(backupSuffix(scene(10), scene(6), 0), "-before-shrink");
  assert.equal(backupSuffix(scene(10), scene(8), 0), null, "a small edit inside 5 min keeps no copy");
  assert.equal(backupSuffix(scene(10), scene(11), 6 * 60_000), "", "the 5-min copy");
  assert.equal(backupSuffix(scene(0), scene(5), 6 * 60_000), null, "nothing to keep from an empty scene");
  assert.equal(backupSuffix(scene(3), scene(3), 6 * 60_000), null, "same text");
  assert.equal(backupSuffix("not json", scene(1), 6 * 60_000), null);
});

test("history names round-trip, and pruning keeps other drawings' copies", () => {
  const t0 = Date.UTC(2026, 10, 11, 12, 0, 0);
  const name = historyName("Untitled", t0, "-before-clear");
  assert.equal(name, "Untitled-2026-11-11T12-00-00-000Z-before-clear.excalidraw");
  assert.ok(isCopyOf("Untitled", name));
  assert.ok(!isCopyOf("Untitled", historyName("Untitled-1", t0, "")), "Untitled-1's copy is not Untitled's");
  const mine = Array.from({ length: KEEP + 2 }, (_, i) => historyName("Untitled", t0 + i * 1000, ""));
  const theirs = Array.from({ length: 5 }, (_, i) => historyName("Untitled-1", t0 - i * 1000, ""));
  const gone = toPrune("Untitled", [...theirs, ...mine]);
  assert.deepEqual(gone, mine.slice(0, 2), "only the two oldest of Untitled's own copies");
});
