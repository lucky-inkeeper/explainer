/** Port of excalidraw-app exportToBackend: same encrypted payload format, same share-link URL. */
import { deflate } from "pako";

const POST_URL = "https://json.excalidraw.com/api/v2/post/";

const concat = (...bufs: Uint8Array[]) => {
  const out = new Uint8Array(4 + bufs.reduce((n, b) => n + 4 + b.byteLength, 0));
  const dv = new DataView(out.buffer);
  let c = 0;
  dv.setUint32(c, 1); c += 4; // CONCAT_BUFFERS_VERSION
  for (const b of bufs) { dv.setUint32(c, b.byteLength); c += 4; out.set(b, c); c += b.byteLength; }
  return out;
};

export async function shareScene(json: string): Promise<{ url: string } | { error: string }> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.generateKey({ name: "AES-GCM", length: 128 }, true, ["encrypt", "decrypt"]);
  const k = (await subtle.exportKey("jwk", key)).k!;
  const enc = new TextEncoder();
  const inner = concat(enc.encode("null"), enc.encode(json));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, deflate(inner)));
  const payload = concat(enc.encode(JSON.stringify({ version: 2, compression: "pako@1", encryption: "AES-GCM" })), iv, encrypted);
  try {
    const res = await fetch(POST_URL, { method: "POST", body: payload });
    const body: any = await res.json();
    if (body.id) return { url: `https://excalidraw.com/#json=${body.id},${k}` };
    if (body.error_class === "RequestTooLargeError") return { error: "Scene too big for a share link. Export as file instead." };
    return { error: `Share failed: ${JSON.stringify(body).slice(0, 200)}` };
  } catch (e: any) {
    return { error: `Share failed: ${e?.message ?? e}` };
  }
}
