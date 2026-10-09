// Self-check: the sync decision table (who changed what since the last sync) and the blob path filter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, relOf } from "../src/main/sync.ts";

const run = (local, remote, state) => Object.fromEntries(plan(new Map(Object.entries(local)), new Map(Object.entries(remote)), state).map((a) => [a.rel, a.ifMatch ? `${a.do}:${a.ifMatch}` : a.do]));
const L = (hash) => ({ hash, mtime: 1 }), R = (etag) => ({ etag }), S = (hash, etag) => ({ hash, etag, mtime: 1 });

test("plan", () => {
  assert.deepEqual(run({ a: L("h1") }, { a: R("e1") }, { a: S("h1", "e1") }), {}, "nothing changed");
  assert.deepEqual(run({ a: L("h2") }, { a: R("e1") }, { a: S("h1", "e1") }), { a: "upload:e1" }, "changed here");
  assert.deepEqual(run({ a: L("h1") }, { a: R("e2") }, { a: S("h1", "e1") }), { a: "download" }, "changed on another Mac");
  assert.deepEqual(run({ a: L("h2") }, { a: R("e2") }, { a: S("h1", "e1") }), { a: "conflict" }, "changed on both");
  assert.deepEqual(run({ a: L("h1") }, { a: R("e1") }, {}), { a: "merge" }, "both have it, never synced");
  assert.deepEqual(run({ a: L("h1") }, {}, {}), { a: "upload" }, "new here");
  assert.deepEqual(run({}, { a: R("e1") }, {}), { a: "download" }, "new on another Mac");
  assert.deepEqual(run({ a: L("h1") }, {}, { a: S("h1", "e1") }), { a: "trashLocal" }, "deleted on another Mac");
  assert.deepEqual(run({ a: L("h2") }, {}, { a: S("h1", "e1") }), { a: "upload" }, "deleted there, edited here: keep");
  assert.deepEqual(run({}, { a: R("e1") }, { a: S("h1", "e1") }), { a: "deleteRemote" }, "deleted here");
  assert.deepEqual(run({}, { a: R("e2") }, { a: S("h1", "e1") }), { a: "download" }, "deleted here, edited there: keep");
  assert.deepEqual(run({}, {}, { a: S("h1", "e1") }), { a: "forget" }, "deleted on both");
});

test("relOf", () => {
  assert.equal(relOf("drawings/a.excalidraw"), "a.excalidraw");
  assert.equal(relOf("drawings/f/a.excalidraw"), "f/a.excalidraw");
  assert.equal(relOf("drawings/f/g/a.excalidraw"), null, "one folder level only");
  assert.equal(relOf("drawings/../a.excalidraw"), null);
  assert.equal(relOf("drawings/.history/a.excalidraw"), null);
  assert.equal(relOf("drawings/a.json"), null);
  assert.equal(relOf("other/a.excalidraw"), null);
});
