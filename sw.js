/* Bolets Bages · funcionamiento sin conexión
   La instalación solo guarda el código (pocos cientos de KB), así se actualiza rápido y no falla por falta de
   espacio. Los datos (relieve, bosque, pinos…) se guardan la primera vez que la app los pide y se renuevan
   con cada versión. */
const V = "bb-v15";
const SHELL = ["./", "index.html", "app.css", "app.js", "model.js", "manifest.webmanifest", "vendor/leaflet.js", "vendor/leaflet.css",
  "vendor/images/layers.png", "vendor/images/layers-2x.png", "vendor/images/marker-icon.png", "vendor/images/marker-shadow.png",
  "icons/icon-192.png", "icons/icon-512.png", "data/meta.json", "data/meteo-fallback.json", "data/munis.json"];
const TILE_HOSTS = /(geoserveis\.icgc\.cat|tile\.opentopomap\.org|server\.arcgisonline\.com|tile\.openstreetmap\.org)/;
const MAX_TILES = 800;

self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
// Al activar se borran las versiones anteriores y el mapa de fondo visto hasta ahora (las versiones viejas lo
// guardaban en un formato que en Android ocupa muchísimo); las zonas guardadas sin cobertura se conservan.
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== "bb-offline" && k !== "bb-tiles2").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trimTiles() { const c = await caches.open("bb-tiles2"); const ks = await c.keys(); for (let i = 0; i < ks.length - MAX_TILES; i++) await c.delete(ks[i]); }
let n = 0;
self.addEventListener("message", e => { if (e.data === "version") e.source && e.source.postMessage({ version: V }); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (TILE_HOSTS.test(url.hostname)) { // mapas de fondo: primero lo guardado (zonas sin cobertura y lo ya visto)
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreVary: true }); if (hit && !(req.mode === "cors" && hit.type === "opaque")) return hit;
      try {
        const r = await fetch(req);
        if (r.ok && r.type !== "opaque") { const c = await caches.open("bb-tiles2"); c.put(req, r.clone()); if (++n % 50 === 0) trimTiles(); }
        return r;
      } catch (err) { return Response.error(); }
    })());
    return;
  }
  if (url.origin !== location.origin) return; // APIs (meteo, caminos): siempre a la red
  if (url.pathname.endsWith("/data/osm/index.json")) { // índice de caminos: primero la red (cambia cada mes)
    e.respondWith(caches.open(V).then(async c => { try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; } catch (err) { return (await c.match(req, { ignoreSearch: true })) || Response.error(); } }));
    return;
  }
  if (url.pathname.includes("/data/") || url.pathname.includes("/vendor/") || url.pathname.includes("/icons/")) {
    e.respondWith(caches.open(V).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r;
    }));
    return;
  }
  // app: se sirve la copia guardada y se actualiza en segundo plano
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
