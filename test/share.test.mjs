// Self-check: the share payload must decode with Excalidraw's own format (port of decompressData).
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflate } from "pako";
import { shareScene } from "../src/main/share.ts";

const split = (buf) => {
  const dv = new DataView(buf.buffer, buf.byteOffset);
  assert.equal(dv.getUint32(0), 1, "concat version");
  const out = []; let c = 4;
  while (c < buf.byteLength) { const len = dv.getUint32(c); c += 4; out.push(buf.slice(c, c + len)); c += len; }
  return out;
};

test("share payload round-trips through Excalidraw's encrypted format", async () => {
  let captured;
  globalThis.fetch = async (_url, { body }) => { captured = body; return { json: async () => ({ id: "abc123" }) }; };
  const json = JSON.stringify({ type: "excalidraw", elements: [{ type: "rectangle", id: "r1", x: 1, y: 2 }] });
  const r = await shareScene(json);
  assert.match(r.url, /^https:\/\/excalidraw\.com\/#json=abc123,[A-Za-z0-9_-]{22}$/);
  const key = r.url.split(",")[1];

  const [meta, iv, encrypted] = split(captured);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(meta)), { version: 2, compression: "pako@1", encryption: "AES-GCM" });
  const cryptoKey = await crypto.subtle.importKey("jwk", { alg: "A128GCM", ext: true, k: key, key_ops: ["encrypt", "decrypt"], kty: "oct" }, { name: "AES-GCM", length: 128 }, false, ["decrypt"]);
  const plain = inflate(new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, encrypted)));
  const [contentsMeta, contents] = split(plain);
  assert.equal(new TextDecoder().decode(contentsMeta), "null");
  assert.equal(new TextDecoder().decode(contents), json);
});
