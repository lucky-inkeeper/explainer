// Self-check: the IPC guards that keep a remote UI inside data/drawings and on its own origin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insideDir, sameOrigin } from "../src/main/guard.ts";

test("insideDir", () => {
  const d = "/data/drawings";
  assert.ok(insideDir(d, "/data/drawings/a.excalidraw"));
  assert.ok(insideDir(d, "/data/drawings/f/a.excalidraw"));
  assert.ok(!insideDir(d, "/data/drawings"));
  assert.ok(!insideDir(d, "/data/drawings/../app/state.json"));
  assert.ok(!insideDir(d, "/data/drawings-evil/a.excalidraw"));
  assert.ok(!insideDir(d, "/Users/me/.ssh/id_rsa"));
  assert.ok(!insideDir(d, "relative.excalidraw"));
  assert.ok(!insideDir(d, undefined));
});

test("sameOrigin", () => {
  const o = "https://explainer-pearl.vercel.app";
  assert.ok(sameOrigin("https://explainer-pearl.vercel.app/", o));
  assert.ok(sameOrigin("https://explainer-pearl.vercel.app/x?y#z", o));
  assert.ok(!sameOrigin("https://explainer-pearl.vercel.app.evil.com/", o));
  assert.ok(!sameOrigin("http://explainer-pearl.vercel.app/", o));
  assert.ok(!sameOrigin("data:text/html,hi", o));
  assert.ok(!sameOrigin("not a url", o));
});
