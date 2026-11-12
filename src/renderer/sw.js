// Offline copy of the UI (ADR-0009). The build fills in BUILD and FILES (electron.vite.config.ts), so every deploy installs a new worker.
const CACHE = "ui-__BUILD__", EXT = "ext", FILES = __FILES__;
// fonts only: never cache Vercel Blob (sync, share) or any other request
const EXT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "esm.sh"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", ...FILES])).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== EXT).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (req.mode === "navigate" && url.origin === location.origin)
    // network first: online always gets the newest deploy
    return e.respondWith(fetch(req).catch(() => caches.match("/", { cacheName: CACHE })));
  if (url.origin === location.origin) return e.respondWith(caches.match(req, { cacheName: CACHE }).then((hit) => hit ?? fetch(req)));
  if (EXT_HOSTS.includes(url.hostname)) return e.respondWith(caches.open(EXT).then((c) => c.match(req).then((hit) => hit ?? fetch(req).then((res) => {
    if (res.ok || res.type === "opaque") c.put(req, res.clone());
    return res;
  }))));
});
