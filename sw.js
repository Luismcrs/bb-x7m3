/* Bolets Bages · funcionamiento sin conexión */
const V = "bb-v6";
const SHELL = ["./", "index.html", "app.css", "app.js", "model.js", "manifest.webmanifest", "vendor/leaflet.js", "vendor/leaflet.css",
  "vendor/images/layers.png", "vendor/images/layers-2x.png", "vendor/images/marker-icon.png", "vendor/images/marker-shadow.png",
  "icons/icon-192.png", "icons/icon-512.png", "data/meta.json", "data/terrain.png", "data/forest.png", "data/elev.png", "data/meteo-fallback.json", "data/munis.png", "data/munis.json", "data/cover1.png", "data/cover2.png",
  ...[0, 1, 2].flatMap(r => [0, 1, 2, 3].map(c => "data/lc/" + r + "_" + c + ".png"))];
const TILE_HOSTS = /(geoserveis\.icgc\.cat|tile\.opentopomap\.org|server\.arcgisonline\.com|tile\.openstreetmap\.org)/;
const MAX_TILES = 3000;

self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== "bb-tiles").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trimTiles() { const c = await caches.open("bb-tiles"); const ks = await c.keys(); for (let i = 0; i < ks.length - MAX_TILES; i++) await c.delete(ks[i]); }
let n = 0;
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (TILE_HOSTS.test(url.hostname)) { // mapas de fondo: caché primero, y se guardan los que ves
    e.respondWith(caches.open("bb-tiles").then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try { const r = await fetch(req); if (r.ok || r.type === "opaque") { c.put(req, r.clone()); if (++n % 100 === 0) trimTiles(); } return r; }
      catch (err) { return hit || Response.error(); }
    }));
    return;
  }
  if (url.origin !== location.origin) return; // APIs (meteo, caminos): siempre a la red
  if (url.pathname.includes("/data/") || url.pathname.includes("/vendor/") || url.pathname.includes("/icons/")) {
    e.respondWith(caches.match(req).then(h => h || fetch(req).then(r => { const cl = r.clone(); caches.open(V).then(c => c.put(req, cl)); return r; })));
    return;
  }
  // app: se sirve la copia guardada y se actualiza en segundo plano
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
