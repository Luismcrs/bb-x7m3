/* Bolets Bages y Berguedà · app */
"use strict";
const VERSION = "1.8 · 30-10-2026";
const $ = s => document.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
const App = {
  prefs: Object.assign({}, DEFAULT_PREFS, LS.get("bb.prefs", {})),
  grid: null, raw: null, summ: null, scores: null, th: null, me: null, heading: null, follow: false,
  ways: null, analysis: LS.get("bb.lastAnalysis", null), diary: LS.get("bb.diary", []), guide: null, fc: null, meteoInfo: null,
  date: null, plan: null, ratings: LS.get("bb.ratings", {}), home: LS.get("bb.home", { lat: 41.7245, lon: 1.8265, n: "Manresa" }), munis: null, muniArr: null
};
const isToday = d => !d || dayKey(d) === dayKey(new Date());
const dayName = d => isToday(d) ? "hoy" : dayKey(d) === dayKey(addDays(new Date(), 1)) ? "mañana" : d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" });
const fmt = (v, d = 0) => v == null || isNaN(v) ? "–" : Number(v).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDist = m => m == null ? "–" : m < 1000 ? fmt(Math.round(m / 10) * 10) + " m" : fmt(m / 1000, 1) + " km";
const DIRS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"], DIRL = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"];
const dirIdx = a => Math.round(((a % 360) + 360) % 360 / 45) % 8;
const LV_COL = ["#9aa79d", "#c9b26b", "#e0b000", "#f27f1a", "#c01e0d"];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastT = null;
function toast(msg, ms = 3500) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }
function setStatus(txt, cls) { $("#statusTxt").textContent = txt; $("#status .dot").className = "dot " + (cls || ""); }
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
async function fetchJSON(url, ms = 20000, opts = {}) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, Object.assign({ signal: ac.signal }, opts)); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

/* ---------- Mapa ---------- */
const map = L.map("map", { zoomControl: false, minZoom: 9, maxZoom: 19, maxBounds: [[41.2, 1.1], [42.75, 2.6]], tap: true }).setView([41.96, 1.82], 10);
map.createPane("prob").style.zIndex = 350;
const ICGC = L.TileLayer.extend({
  getTileUrl(c) {
    // formato REST (el KVP con TILEMATRIXSET devuelve «unknown tilematrixset» desde 2026)
    return "https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wmts/" + this.options.layer + "/MON3857NW/" + c.z + "/" + c.x + "/" + c.y + ".png";
  }
});
const bases = {
  "Topográfico (ICGC)": new ICGC("", { layer: "topografic", maxNativeZoom: 19, maxZoom: 19, attribution: "© ICGC" }),
  "Ortofoto (ICGC)": new ICGC("", { layer: "orto", maxNativeZoom: 19, maxZoom: 19, attribution: "© ICGC" }),
  "OpenTopoMap": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxNativeZoom: 17, maxZoom: 19, subdomains: "abc", attribution: "© OpenStreetMap, SRTM · OpenTopoMap (CC-BY-SA)" }),
  "Satélite (Esri)": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 18, maxZoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics" }),
  "OpenStreetMap": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxNativeZoom: 19, maxZoom: 19, attribution: "© OpenStreetMap" })
};
let baseName = LS.get("bb.base", "Topográfico (ICGC)"); if (!bases[baseName]) baseName = "Topográfico (ICGC)";
bases[baseName].addTo(map);
// Si el mapa del ICGC falla al arrancar, se cambia solo a OpenTopoMap
let tileErr = 0, tileOk = 0; bases[baseName].on("tileload", () => tileOk++);
bases[baseName].on("tileerror", () => { if (++tileErr === 12 && tileOk === 0 && baseName.includes("ICGC") && navigator.onLine !== false) { map.removeLayer(bases[baseName]); baseName = "OpenTopoMap"; bases[baseName].addTo(map); toast("El mapa del ICGC no responde: cambio a OpenTopoMap"); } });
map.on("baselayerchange", e => { baseName = e.name; LS.set("bb.base", baseName); });
const layerProb = L.layerGroup(), layerCar = L.layerGroup(), layerSpots = L.layerGroup().addTo(map), layerFinds = L.layerGroup().addTo(map), layerPlan = L.layerGroup().addTo(map);
L.control.layers(bases, { "Probabilidad": layerProb, "Accesos en coche (OSM)": layerCar, "Puntos": layerSpots, "Diario": layerFinds }, { position: "topright", collapsed: true }).addTo(map);
layerProb.addTo(map); layerCar.addTo(map);
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);

/* ---------- Datos de relieve y bosque ---------- */
async function loadPixels(url) {
  const img = new Image(); img.decoding = "async"; img.src = url; await img.decode();
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext("2d", { willReadFrequently: true }); if (!x) throw new Error("sin memoria para el mapa");
  x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data;
  c.width = c.height = 0; img.src = ""; // libera la memoria del lienzo enseguida (el iPhone tiene un tope muy bajo)
  return d;
}
async function loadGrid() {
  setStatus("Cargando relieve y bosque…");
  const meta = await fetchJSON("data/meta.json"), g = new Grid(meta);
  // una imagen cada vez y se suelta enseguida: así el móvil no tiene varias descomprimidas a la vez
  g.setForest(await loadPixels("data/forest.png"));
  g.setElev(await loadPixels("data/elev.png"));
  if (!(await loadTerrainCache(g))) { setStatus("Calculando pendientes y orientaciones (solo la primera vez)…"); await new Promise(r => setTimeout(r, 30)); g.computeTerrain(); saveTerrainCache(g); }
  g.setCover1(await loadPixels("data/cover1.png"));
  g.setCover2(await loadPixels("data/cover2.png"));
  try { g.setPines(await loadPixels("data/pines.png")); } catch (e) { console.warn("pinos", e); }
  const mu = await loadPixels("data/munis.png"); App.muniArr = new Uint8Array(g.n); for (let i = 0, p = 0; i < g.n; i++, p += 4) App.muniArr[i] = mu[p];
  App.munis = await fetchJSON("data/munis.json");
  App.grid = g;
}
// El relieve calculado se guarda en el móvil (unos 16 MB) para no recalcularlo cada vez que abres la app
const terrKey = g => "derived/terrain-" + g.W + "x" + g.H + "-" + g.lat0 + "-" + g.lon0;
async function loadTerrainCache(g) {
  try {
    if (!("caches" in window)) return false;
    const r = await (await caches.open("bb-derived")).match(terrKey(g)); if (!r) return false;
    const b = new Uint8Array(await r.arrayBuffer()); if (b.length !== 3 * g.n) return false;
    g.sl4.set(b.subarray(0, g.n)); g.asp.set(b.subarray(g.n, 2 * g.n)); g.tpi8.set(new Int8Array(b.buffer, b.byteOffset + 2 * g.n, g.n)); return true;
  } catch (e) { return false; }
}
function saveTerrainCache(g) {
  try {
    if (!("caches" in window)) return;
    const b = new Uint8Array(3 * g.n); b.set(g.sl4, 0); b.set(g.asp, g.n); b.set(new Uint8Array(g.tpi8.buffer, g.tpi8.byteOffset, g.n), 2 * g.n);
    caches.open("bb-derived").then(c => c.put(terrKey(g), new Response(b, { headers: { "Content-Type": "application/octet-stream" } }))).catch(() => { });
  } catch (e) { }
}

/* Mapa de cubiertas del ICGC a 10 m, en 12 trozos que se cargan solo cuando hacen falta */
const lcTiles = new Map();
function lcTile(r, c) {
  const key = r + "_" + c;
  if (lcTiles.has(key)) { const p = lcTiles.get(key); lcTiles.delete(key); lcTiles.set(key, p); return p; } // el más reciente, al final
  while (lcTiles.size >= 6) lcTiles.delete(lcTiles.keys().next().value); // como mucho 6 trozos en memoria (~12 MB)
  const m = App.grid.lc10, p = loadPixels("data/lc/" + key + ".png").then(px => { const a = new Uint8Array(m.tileW * m.tileH); for (let i = 0, q = 0; i < a.length; i++, q += 4) a[i] = px[q]; return a; });
  p.catch(() => lcTiles.delete(key)); lcTiles.set(key, p); return p;
}
async function lcWindowFor(box) {
  const m = App.grid.lc10, w = walkWindow(m, box, App.prefs), cls = new Uint8Array(w.w * w.h);
  const r0 = Math.floor(w.i0 / m.tileH), r1 = Math.floor((w.i0 + w.h - 1) / m.tileH), c0 = Math.floor(w.j0 / m.tileW), c1 = Math.floor((w.j0 + w.w - 1) / m.tileW);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const a = await lcTile(r, c), ti0 = r * m.tileH, tj0 = c * m.tileW;
    const ia = Math.max(w.i0, ti0), ib = Math.min(w.i0 + w.h, ti0 + m.tileH), ja = Math.max(w.j0, tj0), jb = Math.min(w.j0 + w.w, tj0 + m.tileW);
    for (let i = ia; i < ib; i++) cls.set(a.subarray((i - ti0) * m.tileW + ja - tj0, (i - ti0) * m.tileW + jb - tj0), (i - w.i0) * w.w + ja - w.j0);
  }
  return Object.assign(w, { cls, lat0: m.lat0, lon0: m.lon0, dlat: m.dlat, dlon: m.dlon });
}
async function lcClassAt(lat, lon) {
  const m = App.grid && App.grid.lc10; if (!m) return null;
  const i = Math.floor((lat - m.lat0) / m.dlat), j = Math.floor((lon - m.lon0) / m.dlon); if (i < 0 || j < 0 || i >= m.H || j >= m.W) return null;
  const r = Math.floor(i / m.tileH), c = Math.floor(j / m.tileW), a = await lcTile(r, c); return a[(i - r * m.tileH) * m.tileW + j - c * m.tileW];
}

/* ---------- Meteo (Meteocat en directo, con copia de seguridad) ---------- */
/* Estaciones de Meteocat de la zona (Bages, Berguedà y alrededores), leídas de los metadatos de la XEMA.
   Se guardan una semana. Si no se pueden leer, se usan las de la lista fija. */
const ST_BOX = { s: 41.42, n: 42.5, w: 1.3, e: 2.32 };
async function discoverStations() {
  const cached = LS.get("bb.stations", null);
  if (cached && Date.now() - cached.t < 7 * 86400e3) { Object.assign(STATIONS, cached.st); return; }
  try {
    const rows = await fetchJSON("https://analisi.transparenciacatalunya.cat/resource/yqwd-vj5e.json?$limit=2000", 15000), st = {};
    for (const r of rows) {
      const c = r.codi_estacio, lat = parseFloat(r.latitud), lon = parseFloat(r.longitud);
      if (!c || !(lat > ST_BOX.s && lat < ST_BOX.n && lon > ST_BOX.w && lon < ST_BOX.e)) continue;
      const alt = parseFloat(r.altitud);
      st[c] = { n: r.nom_estacio || r.nom_municipi || c, lat, lon, alt: alt >= 0 ? alt : null };
    }
    if (Object.keys(st).length >= 3) { LS.set("bb.stations", { t: Date.now(), st }); Object.assign(STATIONS, st); }
  } catch (e) { console.warn("estaciones", e); }
}
// Altitud de las estaciones que no la traen: la del modelo del terreno
function fixStationAlts() { const g = App.grid; for (const st of Object.values(STATIONS)) if (st.alt == null) { const k = g ? g.idx(st.lat, st.lon) : -1; st.alt = k >= 0 ? g.z(k) : 500; } }
async function fetchMeteoLive() {
  const codes = Object.keys(STATIONS), today = new Date();
  const inList = codes.map(c => "'" + c + "'").join(",");
  const since = dayKey(addDays(today, -40));
  const base = "https://analisi.transparenciacatalunya.cat/resource/nzvn-apee.json?";
  const q = (sel, varc, from) => base + new URLSearchParams({ "$select": sel, "$where": "codi_variable='" + varc + "' AND codi_estacio IN(" + inList + ") AND data_lectura>='" + from + "T00:00:00'", "$group": "codi_estacio,d", "$limit": "20000" }).toString();
  const [rain, temp] = await Promise.all([
    fetchJSON(q("codi_estacio,date_trunc_ymd(data_lectura) AS d,sum(valor_lectura) AS v", "35", since)),
    fetchJSON(q("codi_estacio,date_trunc_ymd(data_lectura) AS d,min(valor_lectura) AS mn,max(valor_lectura) AS mx", "32", since))
  ]);
  const st = {}; for (const c of codes) st[c] = { rain: {}, tmin: {}, tmax: {} };
  let last = "";
  for (const r of rain) { const k = String(r.d).slice(0, 10); if (st[r.codi_estacio]) st[r.codi_estacio].rain[k] = Math.round(parseFloat(r.v) * 10) / 10; if (k > last) last = k; }
  for (const r of temp) { const k = String(r.d).slice(0, 10); if (st[r.codi_estacio]) { st[r.codi_estacio].tmin[k] = parseFloat(r.mn); st[r.codi_estacio].tmax[k] = parseFloat(r.mx); } }
  for (const c of codes) if (!Object.keys(st[c].rain).length) delete st[c];
  if (Object.keys(st).length < 3) throw new Error("pocas estaciones");
  return { stations: st, fetched: new Date().toISOString(), lastDay: last, source: "Meteocat en directo" };
}
async function loadMeteo(force) {
  const cached = LS.get("bb.meteo", null);
  if (!force && cached && cached.v === 4 && Date.now() - new Date(cached.fetched) < 2 * 3600e3) { App.raw = cached; registerModel(App.raw); return; }
  setStatus("Descargando meteo de Meteocat…");
  try {
    const raw = await fetchMeteoLive(); raw.v = 4;
    setStatus("Descargando la lluvia por zona…");
    // el modelo se renueva cada 6 h (gasta muchas consultas gratuitas de Open-Meteo); entre medias se reutiliza
    const fresh = cached && cached.model && cached.modelAt && Date.now() - new Date(cached.modelAt) < 6 * 3600e3;
    try { if (fresh) { for (const c in cached.model) raw.stations[c] = cached.stations[c]; raw.model = cached.model; raw.modelBias = cached.modelBias; raw.modelAt = cached.modelAt; } else await addModelField(raw); } catch (e) { console.warn("modelo", e); if (cached && cached.model) { for (const c in cached.model) raw.stations[c] = cached.stations[c]; raw.model = cached.model; raw.modelOld = true; } }
    App.raw = raw; registerModel(raw); LS.set("bb.meteo", raw);
  } catch (e) {
    if (cached) { App.raw = cached; registerModel(cached); toast("Sin conexión con Meteocat: uso la última meteo guardada"); }
    else { App.raw = await fetchJSON("data/meteo-fallback.json"); toast("Sin conexión con Meteocat: uso datos guardados del " + App.raw.lastDay); }
  }
}
/* Lluvia por zona: rejilla de 91 puntos (cada ~7 km) del modelo de Open-Meteo, corregida con las estaciones de Meteocat */
const FIELD_BOX = { s: 41.62, n: 42.32, w: 1.58, e: 2.06, dlat: .06, dlon: .08 };
async function addModelField(raw) {
  const pts = fieldPoints(FIELD_BOX), codes = Object.keys(raw.stations).filter(c => STATIONS[c] && !STATIONS[c].model);
  const all = pts.concat(codes.map(c => ({ lat: STATIONS[c].lat, lon: STATIONS[c].lon })));
  const ll = a => "latitude=" + a.map(p => p.lat.toFixed(3)).join(",") + "&longitude=" + a.map(p => p.lon.toFixed(3)).join(",");
  const base = "https://api.open-meteo.com/v1/forecast?" , tz = "&timezone=Europe%2FMadrid";
  const [om, soil] = await Promise.all([
    fetchJSON(base + ll(all) + "&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&past_days=31&forecast_days=8" + tz, 30000),
    fetchJSON(base + ll(pts) + "&hourly=soil_moisture_3_to_9cm&past_days=10&forecast_days=8" + tz, 30000).catch(() => null)
  ]);
  const arr = Array.isArray(om) ? om : [om], sarr = soil ? (Array.isArray(soil) ? soil : [soil]) : null;
  const f = buildModelField(pts, arr, sarr, raw.stations, STATIONS, dayKey(new Date()));
  if (Object.keys(f.stations).length < 10) throw new Error("modelo incompleto");
  Object.assign(raw.stations, f.stations); raw.model = f.meta; raw.modelBias = f.bias; raw.modelAt = new Date().toISOString();
}
function registerModel(raw) { if (raw && raw.model) Object.assign(STATIONS, raw.model); }
function summaryAt(raw, date) { const o = {}; for (const [c, st] of Object.entries(raw.stations)) o[c] = stationSummary(st, date); return o; }
function summarize() {
  const d = App.date || new Date();
  App.summ = summaryAt(!isToday(d) && App.plan ? App.plan.ext : App.raw, d);
}

/* ---------- Cálculo y capa de probabilidad ---------- */
const merc = la => Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360));
const imerc = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
let overlay = null;
function recompute() {
  const t0 = performance.now();
  App.scores = computeScores(App.grid, App.summ, App.prefs, App.date || new Date());
  App.th = thresholds(App.grid, App.scores);
  // «lo mejor del Bages» = la mejor zona (percentil 99 de su municipio), igual que en Planear
  const zr = App.munis ? zoneRanking(App.grid, App.scores, App.muniArr, App.munis, 2) : [];
  App.bestQ = zr.length ? zr[0].q : App.th.max; App.bestZone = zr[0] || null;
  renderOverlay(); updateSummary();
  if (App.ways) runAnalysis(false);
  console.log("cálculo", Math.round(performance.now() - t0), "ms");
}
function renderOverlay() {
  const g = App.grid, sc = App.scores, th = App.th, W = g.W, H = g.H;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"), img = x.createImageData(W, H), d = img.data;
  const N = g.lat0, S = g.lat0 + H * g.dlat, mN = merc(N), mS = merc(S);
  const col = [null, [255, 214, 90, 150], [242, 127, 26, 195], [192, 30, 13, 230]], minL = App.prefs.minLevel;
  for (let r = 0; r < H; r++) {
    const lat = imerc(mN + (r + .5) / H * (mS - mN)), i = Math.floor((lat - g.lat0) / g.dlat); if (i < 0 || i >= H) continue;
    const b = i * W, o = r * W * 4;
    for (let j = 0; j < W; j++) {
      const v = sc[b + j]; if (!(v > 0)) continue;
      const L = v >= th.t3 ? 3 : v >= th.t2 ? 2 : v >= th.t1 ? 1 : 0; if (L < minL) continue;
      const q = o + j * 4, cc = col[L]; d[q] = cc[0]; d[q + 1] = cc[1]; d[q + 2] = cc[2]; d[q + 3] = cc[3];
    }
  }
  x.putImageData(img, 0, 0);
  c.toBlob(b => {
    c.width = c.height = 0;
    const url = URL.createObjectURL(b);
    if (overlay) { const old = overlay._url; overlay.setUrl(url); setTimeout(() => URL.revokeObjectURL(old), 4000); }
    else { overlay = L.imageOverlay(url, [[S, g.lon0], [N, g.lon0 + W * g.dlon]], { pane: "prob", className: "prob", opacity: App.prefs.opacity, interactive: false }); layerProb.addLayer(overlay); }
  }, "image/png");
}
function cellInfo(lat, lon) {
  const g = App.grid; const k = g.idx(lat, lon); if (k < 0 || !g.inb(k)) return null;
  const v = App.scores[k]; return { k, v, level: v > 0 ? absLevel(v) : 0, rel: v > 0 ? levelOf(v, App.th) : 0, slope: g.slope(k), aspect: g.aspect(k), z: g.z(k), tree: g.tree(k), edge: g.edge(k) };
}
function updateSummary() {
  const s = SPECIES[App.prefs.sp], mx = App.bestQ, lv = absLevel(mx);
  let t = s.n + " " + dayName(App.date) + ": probabilidad " + ABS_NAMES[lv].toLowerCase() + (lv <= 1 ? " incluso" : "") + " en la mejor zona" + (App.bestZone ? " (" + App.bestZone.n + ", índice " + fmt(mx) + ")" : " (índice " + fmt(mx) + ")");
  if (!isToday(App.date)) t += " · el mapa muestra la previsión de ese día";
  if (App.me) { const ci = cellInfo(App.me.lat, App.me.lon); if (ci) t += " · donde estás: " + fmt(ci.v) + " (" + ABS_NAMES[ci.level].toLowerCase() + ")"; }
  if (App.fcBest) t += " · mejor día próximo: " + App.fcBest;
  $("#summary").textContent = t;
}
function meteoStatus() {
  const c = map.getCenter(); const m = meteoAt(c.lat, c.lng, App.summ);
  const when = new Date(App.raw.fetched);
  let txt = (App.raw.source === "Meteocat en directo" ? "Meteo de " : "Meteo guardada de ") + when.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + " " + when.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (m && m.lastRain) txt += " · última lluvia fuerte aquí hace " + m.lastRain.age + " días (" + m.lastRain.mm + " mm)";
  const age = (Date.now() - when) / 3600e3;
  setStatus(txt, age < 6 ? "ok" : "old");
}

/* ---------- Puntos con caminos reales (Overpass) ---------- */
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* Descarga de OpenStreetMap. Los servidores públicos limitan las consultas seguidas (responden «ocupado»):
   si uno está ocupado o tarda, prueba el siguiente y, si todos fallan, espera un poco y lo intenta otra vez. */
async function overpass(q, status) {
  let err = null;
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < OVERPASS.length; i++) {
      status("Descargando caminos" + (round || i ? " (servidor " + (i + 1) + " de " + OVERPASS.length + ")" : "") + "…");
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 50000);
      try {
        const r = await fetch(OVERPASS[i], { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ac.signal });
        if (r.status === 429 || r.status === 504 || r.status === 503) { err = Object.assign(new Error("servidor ocupado"), { busy: true }); continue; }
        if (!r.ok) { err = new Error("HTTP " + r.status); continue; }
        const j = await r.json();
        if (j.remark && /runtime error|timed out|out of memory|rate_limited/i.test(j.remark)) { err = Object.assign(new Error("servidor ocupado"), { busy: true }); continue; } // datos a medias
        return j;
      } catch (e) { err = e.name === "AbortError" ? Object.assign(new Error("el servidor tarda demasiado"), { busy: true }) : e; }
      finally { clearTimeout(t); }
    }
    if (round === 0) for (let k = 15; k > 0; k--) { status("Servidores de caminos ocupados: reintento en " + k + " s…"); await sleep(1000); }
  }
  throw err;
}
/* Zonas ya descargadas: la actual y las 2 anteriores (las más viejas se borran para no llenar la memoria del móvil).
   Si vuelves a buscar dentro de una de ellas, no hace falta descargar nada. */
const zoneCache = [];
const ZONE_MAX = 3, ZONE_WAYS_MAX = 60000;
function cachedZone(box) {
  const T = .002, z = zoneCache.find(z => box.n <= z.box.n + T && box.s >= z.box.s - T && box.w >= z.box.w - T && box.e <= z.box.e + T);
  if (z) { zoneCache.splice(zoneCache.indexOf(z), 1); zoneCache.push(z); }
  return z;
}
function storeZone(z) {
  zoneCache.push(z);
  const total = () => zoneCache.reduce((a, x) => a + x.ways.length, 0);
  while (zoneCache.length > ZONE_MAX || (zoneCache.length > 1 && total() > ZONE_WAYS_MAX)) zoneCache.shift();
}
function analysisBox() {
  const b = map.getBounds(), c = map.getCenter(), g = App.grid;
  let n = b.getNorth(), s = b.getSouth(), w = b.getWest(), e = b.getEast();
  const ML = .05, MO = .065;
  if (n - s > ML) { n = c.lat + ML / 2; s = c.lat - ML / 2; }
  if (e - w > MO) { e = c.lng + MO / 2; w = c.lng - MO / 2; }
  const gN = g.lat0, gS = g.lat0 + g.H * g.dlat, gW = g.lon0, gE = g.lon0 + g.W * g.dlon;
  n = Math.min(n, gN); s = Math.max(s, gS); w = Math.max(w, gW); e = Math.min(e, gE);
  if (n <= s || e <= w) return null;
  return { n, s, w, e };
}
let boxLayer = null, analyzing = false;
// Mientras se busca en otra zona, los puntos anteriores se ven apagados
function dimSpots(on) {
  layerSpots.eachLayer(l => { if (l.setOpacity) l.setOpacity(on ? .35 : 1); else if (l.setStyle) { if (l.options.op0 == null) l.options.op0 = l.options.opacity; l.setStyle({ opacity: on ? .25 : l.options.op0 }); } });
}
async function analyze() {
  if (!App.scores || analyzing) return;
  const box = analysisBox(); if (!box) { toast("Esa zona queda fuera del Bages y el Berguedà"); return; }
  const btn = $("#analyzeBtn"), status = t => { btn.textContent = t; };
  analyzing = true; btn.disabled = true; App.anaError = null; dimSpots(true);
  try {
    let z = cachedZone(box) || await offlineZone(box);
    if (!z && navigator.onLine === false) throw Object.assign(new Error("sin conexión"), { offline: true });
    if (!z) {
      const bb = [box.s, box.w, box.n, box.e].map(v => v.toFixed(5)).join(","), M = .02;
      const bx = [box.s - M, box.w - M * 1.3, box.n + M, box.e + M * 1.3].map(v => v.toFixed(5)).join(",");
      // caminos de la zona (y un margen para aparcar fuera), carreteras para llegar, y lo que no se cruza andando.
      // Se dejan fuera aceras, pasos de peatones y obras: en los pueblos pesan mucho y no sirven para buscar setas.
      const W2 = .009, bw = [box.s - W2, box.w - W2 * 1.3, box.n + W2, box.e + W2 * 1.3].map(v => v.toFixed(5)).join(",");
      const HW = "way[\"highway\"][\"highway\"!~\"^(proposed|construction|platform|corridor|elevator|bus_stop|raceway|abandoned|razed|services|rest_area)$\"][\"footway\"!~\"^(sidewalk|crossing)$\"][\"area\"!=\"yes\"]";
      const q = "[out:json][timeout:45];(" + HW + "(" + bw + ");way[\"highway\"~\"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|road)\"][\"service\"!~\"^(parking_aisle|driveway)$\"](" + bx + ");" +
        "way[\"railway\"~\"^(rail|narrow_gauge|light_rail|funicular|monorail|preserved|subway|tram)$\"](" + bw + ");way[\"waterway\"~\"^(river|canal)$\"](" + bw + ");way[\"barrier\"~\"^(fence|wall)$\"](" + bw + ");way[\"natural\"=\"cliff\"](" + bw + "););out body geom qt;" +
        "node[\"place\"~\"^(village|hamlet|isolated_dwelling|farm|locality|neighbourhood|town)$\"][\"name\"](" + bx + ");node[\"natural\"=\"peak\"][\"name\"](" + bx + ");out body qt;";
      const data = await overpass(q, status);
      z = { box, ways: data.elements.filter(x => x.type === "way" && x.geometry),
        places: data.elements.filter(x => x.type === "node" && x.tags && x.tags.name).map(x => ({ lat: x.lat, lon: x.lon, n: x.tags.name, peak: x.tags.natural === "peak" })) };
      storeZone(z);
    }
    App.ways = { box, ways: z.ways, places: z.places };
    status("Calculando rutas a pie…");
    await runAnalysis(true);
  } catch (e) {
    console.error(e);
    App.anaError = e.offline ? "Sin cobertura, y esta zona no está guardada. Las zonas guardadas se ven en Ajustes." : e.busy ? "Los servidores de OpenStreetMap están saturados y no he podido descargar los caminos de esta zona." : "No he podido descargar los caminos de esta zona (" + (navigator.onLine === false ? "sin conexión" : e.message) + ").";
    dimSpots(false); renderSpotList(); openSheet("cerca");
    toast(App.anaError + " Prueba otra vez en un minuto.", 6000);
  } finally { analyzing = false; btn.disabled = false; btn.textContent = "Buscar los mejores puntos en lo que veo"; }
}
let anaRun = 0;
function runAnalysis(fit) { return runAnalysisAsync(fit).catch(e => { console.error(e); toast("No he podido calcular las rutas a pie: " + e.message); }); }
async function runAnalysisAsync(fit) {
  const { box, ways } = App.ways, run = ++anaRun;
  seedRatings(ways);
  const lc = await lcWindowFor(box); if (run !== anaRun) return; // se ha pedido otro cálculo mientras tanto
  await new Promise(r => setTimeout(r, 30)); // deja pintar el aviso antes del cálculo
  const res = analyzeWindow(App.grid, App.scores, App.th, box, ways, Object.assign({}, App.prefs, { ratings: App.ratings }), App.me, lc);
  App.net = res.net;
  drawRoads(ways, res.net);
  if (!res.net.hasPaved) toast("No encuentro carretera asfaltada cerca de esta zona: mueve el mapa o amplía la búsqueda");
  if (boxLayer) map.removeLayer(boxLayer);
  boxLayer = L.rectangle([[box.s, box.w], [box.n, box.e]], { color: "#1f2a22", weight: 1, dashArray: "4 6", fill: false, interactive: false }).addTo(map);
  App.analysis = { box, spots: res.spots, when: new Date().toISOString(), sp: App.prefs.sp }; App.anaError = null;
  LS.set("bb.lastAnalysis", App.analysis);
  drawSpots(); renderSpotList(); updateSaveBtn();
  if (fit) {
    if (!res.spots.length) toast("No hay zonas buenas que cumplan tus ajustes aquí. Prueba a subir la distancia andando o a mover el mapa.");
    else { openSheet("cerca"); }
  }
}
const ROAD_COL = ["#1a5fb4", "#2e8b57", "#e08a00", "#c0392b"], roadRenderer = L.canvas({ padding: .3, tolerance: 8 });
function drawRoads(ways, net) {
  layerCar.clearLayers(); const ok = new Set(net.reach.map(s => s.way)), lvl = App.prefs.carLevel;
  for (const wy of ways) {
    if (!wy.tags || !wy.tags.highway) continue;
    const c = wy._cls; if (c == null || c < 0 || !wy.geometry) { if (c === -1 && App.ratings[wy.id] === "no") L.polyline(wy.geometry.map(p => [p.lat, p.lon]), { color: "#666", weight: 3, dashArray: "2 6", renderer: roadRenderer }).on("click", e => ratePopup(wy, e.latlng)).addTo(layerCar); continue; }
    const reach = ok.has(wy.id);
    L.polyline(wy.geometry.map(p => [p.lat, p.lon]), { color: ROAD_COL[c], weight: reach ? 4 : 3, opacity: reach ? .85 : .5, dashArray: reach ? null : "5 7", renderer: roadRenderer })
      .on("click", e => { L.DomEvent.stop(e); ratePopup(wy, e.latlng); }).addTo(layerCar);
  }
}
function ratePopup(wy, ll) {
  const t = wy.tags || {}, c = roadClass(t), r = App.ratings[wy.id];
  const div = document.createElement("div"); div.className = "pop";
  const osm = [t.tracktype ? "tipo " + t.tracktype.replace("grade", "grado ") : "", t.surface ? "firme " + t.surface : "", t.smoothness ? "estado " + t.smoothness : ""].filter(Boolean).join(", ");
  div.innerHTML = "<b>" + esc(t.name || (t.highway === "track" ? "Pista" : "Camino")) + "</b><div>" + (c >= 0 ? ROAD_CLASS[c] : "No apto o prohibido para coches") + " según OpenStreetMap" + (osm ? " (" + esc(osm) + ")" : " (sin datos de estado)") + "</div><div>Tu valoración: <b>" + ({ ok: "bien", limite: "al límite", no: "no pasa" }[r] || "ninguna") + '</b></div><div class="acts"></div>';
  const acts = div.querySelector(".acts");
  const set = v => { if (v) App.ratings[wy.id] = v; else delete App.ratings[wy.id]; LS.set("bb.ratings", App.ratings); map.closePopup(); runAnalysis(false); toast("Valoración guardada"); };
  acts.append(mkBtn("Bien", () => set("ok")), mkBtn("Al límite", () => set("limite")), mkBtn("No pasa", () => set("no")));
  if (r) acts.append(mkBtn("Quitar", () => set(null)));
  L.popup({ maxWidth: 300 }).setLatLng(ll).setContent(div).openOn(map);
}
// Valoración que diste el 25-10-2026: el camino de los hornos de yeso (Súria), hasta 41,83062, 1,77162, «al límite» para tu coche
function seedRatings(ways) {
  if (LS.get("bb.seed1", false)) return;
  const P = { lat: 41.8306221, lon: 1.7716212 }; let n = 0;
  for (const w of ways) {
    const c = roadClass(w.tags || {}); if (c < 1 || !w.geometry || App.ratings[w.id]) continue;
    const named = /guix|forns|hornos/i.test((w.tags && w.tags.name) || "");
    const near = w.geometry.some(g => kmDist(g.lat, g.lon, P.lat, P.lon) < .06);
    if (named || near) { App.ratings[w.id] = "limite"; n++; }
  }
  if (n) { LS.set("bb.ratings", App.ratings); LS.set("bb.seed1", true); toast("He marcado como «al límite» el camino de los hornos de yeso. Tócalo en el mapa para cambiarlo.", 6000); }
}
function spotIcon(n, level) { return L.divIcon({ className: "", html: '<div class="spot-ico" style="background:' + LV_COL[level] + '">' + n + "</div>", iconSize: [26, 26], iconAnchor: [13, 13] }); }
const parkIcon = L.divIcon({ className: "", html: '<div class="park-ico">P</div>', iconSize: [22, 22], iconAnchor: [11, 11] });
function drawSpots() {
  layerSpots.clearLayers(); const A = App.analysis; if (!A) return;
  A.spots.forEach((s, i) => {
    const m = L.marker([s.lat, s.lon], { icon: spotIcon(i + 1, s.level) }).addTo(layerSpots);
    m.on("click", () => showSpotPopup(i));
    if (s.park) {
      L.marker([s.park.lat, s.park.lon], { icon: parkIcon, interactive: false }).addTo(layerSpots);
      if (s.route && s.route.length > 1) { // ruta a pie real (sin cruzar vías, ríos ni vallas)
        L.polyline(s.route, { color: "#fff", weight: 6, opacity: .8, interactive: false }).addTo(layerSpots);
        L.polyline(s.route, { color: "#7a3fb0", weight: 3, opacity: .95, interactive: false }).addTo(layerSpots);
      } else L.polyline([[s.park.lat, s.park.lon], [s.lat, s.lon]], { color: "#1a5fb4", weight: 2, dashArray: "3 6", interactive: false }).addTo(layerSpots);
    }
  });
}
const carUrl = (la, lo) => "https://www.google.com/maps/dir/?api=1&destination=" + la.toFixed(5) + "," + lo.toFixed(5) + "&travelmode=driving";
function muniOf(lat, lon) { const k = App.grid ? App.grid.idx(lat, lon) : -1; const m = k >= 0 && App.munis ? App.munis.find(x => x.id === App.muniArr[k]) : null; return m ? m.n : ""; }
function spotPlace(s) {
  let t = muniOf(s.lat, s.lon), best = null, bd = 4000;
  for (const p of (App.ways && App.ways.places) || []) { const d = kmDist(s.lat, s.lon, p.lat, p.lon) * 1000; if (d < bd) { bd = d; best = p; } }
  if (best) t += (t ? " · " : "") + (bd < 120 ? "junto a " + best.n : fmtDist(bd) + " al " + DIRL[dirIdx(bearing(best, s))] + " de " + best.n);
  return t || (s.lat.toFixed(4) + ", " + s.lon.toFixed(4));
}
function wayName(id) { const w = App.ways && App.ways.ways.find(x => x.id === id); return w && w.tags && w.tags.name ? w.tags.name : ""; }
const CROWD = c => c < .33 ? "poca gente probable" : c < .6 ? "afluencia media probable" : "zona concurrida probable";
function spotLine(s) {
  const d = dirIdx(s.aspect), bits = [];
  if (App.me) bits.push("a " + fmtDist(kmDist(App.me.lat, App.me.lon, s.lat, s.lon) * 1000) + " de ti");
  if (s.walk != null) bits.push((s.route ? "ruta a pie de " : "") + fmtDist(s.walk) + " desde el coche");
  if (s.park) { const wn = wayName(s.park.way); bits.push((s.park.dirt > 30 ? "en coche, " + fmtDist(s.park.dirt) + " de tierra desde el asfalto" : "aparcas junto al asfalto") + (wn ? " (" + wn + ")" : "")); }
  if (s.prof) bits.push(s.prof.up + s.prof.down < 15 ? "casi sin desnivel" : "sube " + s.prof.up + " m y baja " + s.prof.down + " m");
  if (s.cover != null) bits.push(LC_CLASS_NAMES[s.cover] + (s.pine && s.pine.f > .3 ? " de " + PINE_NAMES[s.pine.t] : "") + ", " + fmt(s.forest * 100) + " % de bosque bueno alrededor");
  if (s.crowd != null) bits.push(CROWD(s.crowd));
  bits.push((s.slope < 6 ? "llano" : s.slope < 12 ? "suave" : "inclinado") + " (" + fmt(s.slope) + "°)" + (s.slope >= 4 ? ", mira al " + DIRL[d] : ""));
  bits.push(fmtDist(s.dPath) + " del camino o sendero más cercano");
  return bits.join(" · ");
}
function renderSpotList() {
  const ol = $("#spots"); ol.innerHTML = ""; const A = App.analysis;
  if (App.anaError) {
    const li = document.createElement("li"); li.className = "hint warn";
    li.textContent = App.anaError + (A && A.spots.length ? " Los puntos de abajo son de la búsqueda anterior." : " ");
    li.append(mkBtn("Reintentar", analyze, "small")); ol.append(li);
  }
  if (!A) { ol.innerHTML = '<li class="hint">Todavía no hay puntos. Acerca el mapa a una zona y pulsa el botón.</li>'; return; }
  if (!A.spots.length) { ol.innerHTML = '<li class="hint">Con tus ajustes de coche y de distancia andando no llegas a ninguna zona buena aquí. Prueba a aceptar más camino de tierra, a andar más o a mover el mapa.</li>'; return; }
  if (A.sp !== App.prefs.sp) ol.insertAdjacentHTML("beforeend", '<li class="hint">Estos puntos son de otra especie. Vuelve a buscar.</li>');
  A.spots.forEach((s, i) => {
    const li = document.createElement("li"); li.className = "spot";
    li.innerHTML = '<div class="hd"><span class="n" style="background:' + LV_COL[s.level] + '">' + (i + 1) + '</span><span class="tt"><b>' + esc(spotPlace(s)) + "</b><small>" + ABS_NAMES[s.level] + " · " + esc(spotLine(s)) + '</small></span><span class="sc" title="Índice ajustado a tus preferencias">' + fmt(s.adj) + '</span></div><div class="acts"></div>';
    const acts = li.querySelector(".acts");
    if (s.park) acts.append(mkBtn("Ir en coche", () => window.open(carUrl(s.park.lat, s.park.lon), "_blank"), "primary small"));
    acts.append(mkBtn("Guiarme a pie", () => startGuide(s.lat, s.lon, "Punto " + (i + 1) + " · " + spotPlace(s), s.route), "small"));
    acts.append(mkBtn("Ver", () => { map.flyTo([s.lat, s.lon], 16); showSpotPopup(i); }, "small"));
    ol.append(li);
  });
}
function mkBtn(txt, fn, cls) { const b = document.createElement("button"); b.type = "button"; b.className = "btn " + (cls || ""); b.textContent = txt; b.onclick = fn; return b; }
function showSpotPopup(i) {
  const s = App.analysis.spots[i]; const div = document.createElement("div"); div.className = "pop";
  div.innerHTML = "<b>Punto " + (i + 1) + " · " + esc(spotPlace(s)) + "</b><div>" + ABS_NAMES[s.level] + " (índice " + fmt(s.score) + ")</div><div>" + esc(spotLine(s)) + "</div><dl><dt>Altitud</dt><dd>" + fmt(s.z) + " m</dd><dt>Bosque</dt><dd>" + (s.cover != null ? esc(LC_CLASS_NAMES[s.cover]) + ", " : "") + fmtDist(s.edge) + " dentro del bosque</dd></dl><div class=\"acts\"></div>";
  const acts = div.querySelector(".acts");
  if (s.park) acts.append(mkBtn("Ir en coche", () => window.open(carUrl(s.park.lat, s.park.lon), "_blank"), "primary"));
  acts.append(mkBtn("Guiarme a pie", () => { map.closePopup(); startGuide(s.lat, s.lon, "Punto " + (i + 1), s.route); }));
  L.popup({ maxWidth: 290 }).setLatLng([s.lat, s.lon]).setContent(div).openOn(map);
}

/* ---------- Tocar el mapa ---------- */
map.on("click", e => {
  if (!App.scores) return;
  const ci = cellInfo(e.latlng.lat, e.latlng.lng); const div = document.createElement("div"); div.className = "pop";
  if (!ci) { div.textContent = "Fuera del Bages y el Berguedà."; }
  else {
    const d = dirIdx(ci.aspect);
    div.innerHTML = "<b>" + (ci.v > 0 ? ABS_NAMES[ci.level] + " · índice " + fmt(ci.v) + " de 100" : "Sin bosque o terreno no apto") + "</b>" + (ci.v > 0 ? "<div>" + ["", "Entre el 25 % mejor del bosque hoy", "Entre el 10 % mejor del bosque hoy", "Entre el 3 % mejor del bosque hoy"][ci.rel] + "</div>" : "") + "<dl><dt>Terreno</dt><dd>" + (ci.slope < 6 ? "llano" : ci.slope < 12 ? "suave" : "inclinado") + " (" + fmt(ci.slope) + "°)" + (ci.slope >= 4 ? ", mira al " + DIRL[d] : "") + "</dd><dt>Altitud</dt><dd>" + fmt(ci.z) + " m</dd><dt>Bosque</dt><dd>" + fmt(ci.tree * 100) + " % arbolado" + (ci.edge > 0 ? ", " + fmtDist(ci.edge) + " dentro" : "") + "</dd><dt>Aquí mismo</dt><dd class=\"lcc\">…</dd>" + (() => { const pi = App.grid.pineOf(ci.k); return pi && pi.f > .2 ? "<dt>Pinar</dt><dd>" + PINE_NAMES[pi.t] + " (mapa forestal)</dd>" : ""; })() + "</dl><div class=\"acts\"></div>";
    lcClassAt(e.latlng.lat, e.latlng.lng).then(c => { const dd = div.querySelector(".lcc"); if (dd) dd.textContent = c == null ? "–" : LC_CLASS_NAMES[c] + " (ICGC)"; }).catch(() => { });
    const acts = div.querySelector(".acts"), la = e.latlng.lat, lo = e.latlng.lng;
    acts.append(mkBtn("Guiarme a pie", () => { map.closePopup(); startGuide(la, lo, "Punto marcado"); }));
    acts.append(mkBtn("Ir en coche", () => goByCar(la, lo), "primary"));
    acts.append(mkBtn("Apuntar aquí", () => { map.closePopup(); openFindForm({ lat: la, lon: lo }); }));
  }
  L.popup({ maxWidth: 290 }).setLatLng(e.latlng).setContent(div).openOn(map);
});
async function goByCar(lat, lon) {
  // camino más cercano con coche: de la última búsqueda, o del enrutador OSRM
  let park = null;
  if (App.net && App.ways) { const p = nearestParking(lat, lon, App.net); if (p && p.dist < 2000) park = p; }
  if (!park) {
    try { const r = await fetchJSON("https://router.project-osrm.org/nearest/v1/driving/" + lon.toFixed(5) + "," + lat.toFixed(5), 12000); const w = r.waypoints && r.waypoints[0]; if (w) park = { lat: w.location[1], lon: w.location[0], dist: w.distance }; } catch (e) { }
  }
  if (park) { toast("Te llevo al camino más cercano: luego " + fmtDist(park.dist * 1.3) + " andando"); window.open(carUrl(park.lat, park.lon), "_blank"); }
  else window.open(carUrl(lat, lon), "_blank");
}
function nearestOnSegmentsApp(lat, lon, segs) {
  const cx = Math.cos(lat * Math.PI / 180) * 111320, cy = 110540; let best = null, bd = 1e12;
  for (const g of segs) for (let i = 1; i < g.length; i++) {
    const ax = (g[i - 1].lon - lon) * cx, ay = (g[i - 1].lat - lat) * cy, bx = (g[i].lon - lon) * cx, by = (g[i].lat - lat) * cy;
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L2)) : 0;
    const px = ax + t * vx, py = ay + t * vy, d = px * px + py * py; if (d < bd) { bd = d; best = { lat: lat + py / cy, lon: lon + px / cx, dist: Math.sqrt(d) }; }
  }
  return best;
}

/* ---------- Zonas guardadas para usar sin cobertura ----------
   Se guardan en el móvil: los caminos de OpenStreetMap de la zona (para buscar puntos y rutas) y el mapa
   topográfico del ICGC (zooms 13 a 16, con margen; sin conexión se amplía el 16). Las teselas se piden al ICGC,
   que permite este uso; OpenStreetMap y OpenTopoMap no permiten descargas masivas. */
const OFF = "bb-offline", offIndex = () => LS.get("bb.offZones", []);
const t2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const t2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
function tileRanges(box) {
  const R = {};
  for (let z = 13; z <= 16; z++) { const m = .01; R[z] = [t2x(box.w - m * 1.3, z), t2x(box.e + m * 1.3, z), t2y(box.n + m, z), t2y(box.s - m, z)]; }
  return R;
}
function tileUrls(R) { const L0 = bases["Topográfico (ICGC)"], out = []; for (const z in R) { const [x0, x1, y0, y1] = R[z]; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(L0.getTileUrl({ x, y, z: +z })); } return out; }
const KB_Z = { 13: 360, 14: 340, 15: 290, 16: 100 }; // tamaño medio de las teselas del mapa topográfico del ICGC (medido)
function estMB(R) { let kb = 0; for (const z in R) { const [x0, x1, y0, y1] = R[z]; kb += (x1 - x0 + 1) * (y1 - y0 + 1) * (KB_Z[z] || 60); } return kb / 1000; }
function boxIn(a, b, T = .002) { return a.n <= b.n + T && a.s >= b.s - T && a.w >= b.w - T && a.e <= b.e + T; }
async function offlineZone(box) {
  const z = offIndex().find(o => boxIn(box, o.box) && Date.now() - o.t < 45 * 86400e3); if (!z || !("caches" in window)) return null;
  try { const r = await (await caches.open(OFF)).match("offline/" + z.id + ".json"); if (!r) return null; const d = await r.json(); const zz = { box: d.box, ways: d.ways, places: d.places, saved: z.id }; storeZone(zz); return zz; } catch (e) { return null; }
}
let saving = false;
function updateSaveBtn() {
  const b = $("#saveZone"); if (!b) return; const box = App.ways && App.ways.box;
  const saved = box && offIndex().find(o => boxIn(box, o.box));
  b.hidden = !box || !("caches" in window); b.disabled = saving || !!saved;
  if (!saving && box) b.textContent = saved ? "Zona guardada para usar sin cobertura ✓" : "Guardar esta zona para usarla sin cobertura (~" + Math.max(3, Math.round(estMB(tileRanges(box)))) + " MB)";
}
async function saveZoneOffline() {
  if (!App.ways || saving) return; saving = true; const b = $("#saveZone"); b.disabled = true;
  const src = zoneCache.find(z => z.ways === App.ways.ways) || App.ways, box = src.box, id = "z" + Date.now().toString(36);
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
    const c = await caches.open(OFF);
    await c.put("offline/" + id + ".json", new Response(JSON.stringify({ box, ways: src.ways.map(w => ({ type: "way", id: w.id, tags: w.tags, nodes: w.nodes, geometry: w.geometry })), places: src.places }), { headers: { "Content-Type": "application/json" } }));
    const R = tileRanges(box), urls = tileUrls(R); let i = 0, done = 0, bytes = 0, fail = 0;
    const worker = async () => {
      while (i < urls.length) {
        const u = urls[i++];
        try {
          if (await c.match(u, { ignoreVary: true })) { done++; continue; }
          const seen = await caches.match(u, { ignoreVary: true }); // ya visto en el mapa: se copia tal cual
          if (seen) { await c.put(u, seen); bytes += seen.type === "opaque" ? 60000 : (+seen.headers.get("content-length") || 60000); done++; continue; }
          const r = await fetch(u, { mode: "cors" }); if (!r.ok) { fail++; continue; }
          const bl = await r.blob(); bytes += bl.size; await c.put(u, new Response(bl, { headers: { "Content-Type": bl.type || "image/png" } })); done++;
        } catch (e) { fail++; }
        b.textContent = "Guardando el mapa… " + Math.round((done + fail) / urls.length * 100) + " %";
      }
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    const name = muniOf((box.n + box.s) / 2, (box.w + box.e) / 2) || "Zona";
    const idx = offIndex(); idx.unshift({ id, box, n: name, t: Date.now(), R, tiles: urls.length, fail, mb: Math.round(bytes / 1e5) / 10 }); LS.set("bb.offZones", idx);
    toast(fail > urls.length * .1 ? "Zona guardada, pero faltan " + fail + " trozos del mapa: vuelve a intentarlo con mejor conexión" : "Zona guardada: caminos y mapa topográfico del ICGC listos para usar sin cobertura", 6000);
  } catch (e) { console.error(e); toast("No he podido guardar la zona: " + e.message); }
  finally { saving = false; updateSaveBtn(); renderOffZones(); }
}
async function deleteOffZone(id) {
  const idx = offIndex(), z = idx.find(o => o.id === id); if (!z) return;
  const rest = idx.filter(o => o.id !== id), keep = new Set(rest.flatMap(o => tileUrls(o.R)));
  try { const c = await caches.open(OFF); await c.delete("offline/" + id + ".json"); for (const u of tileUrls(z.R)) if (!keep.has(u)) await c.delete(u, { ignoreVary: true }); } catch (e) { }
  LS.set("bb.offZones", rest); renderOffZones(); updateSaveBtn(); toast("Zona borrada del móvil");
}
function renderOffZones() {
  const ol = $("#offZones"); if (!ol) return; ol.innerHTML = ""; const idx = offIndex();
  if (!idx.length) { ol.innerHTML = '<li class="hint">Ninguna. Después de «Buscar puntos», en «Cerca», pulsa «Guardar esta zona».</li>'; return; }
  for (const z of idx) {
    const li = document.createElement("li"); const d = new Date(z.t), old = Date.now() - z.t > 45 * 86400e3;
    li.innerHTML = '<span class="tt"><b>' + esc(z.n) + "</b><br><small>" + d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + " · " + fmt(z.mb, 1) + " MB" + (old ? " · caminos antiguos: vuelve a guardarla" : "") + "</small></span>";
    const go = mkBtn("◎", () => { map.fitBounds([[z.box.s, z.box.w], [z.box.n, z.box.e]]); collapseSheet(); }); go.setAttribute("aria-label", "Ver en el mapa");
    const del = mkBtn("×", () => { if (confirmDel(z)) deleteOffZone(z.id); }); del.setAttribute("aria-label", "Borrar");
    li.append(go, del); ol.append(li);
  }
}
// Sin conexión, el mapa topográfico se amplía desde el zoom 16 guardado en vez de pedir zooms que no hay
function setOfflineMap(off) { const L0 = bases["Topográfico (ICGC)"]; L0.options.maxNativeZoom = off ? 16 : 19; if (map.hasLayer(L0)) L0.redraw(); }
window.addEventListener("offline", () => { setOfflineMap(true); toast(baseName === "Topográfico (ICGC)" ? "Sin cobertura: uso lo guardado en el móvil" : "Sin cobertura: cambia al mapa «Topográfico (ICGC)», que es el que se guarda con las zonas", 6000); });
window.addEventListener("online", () => setOfflineMap(false));
if (navigator.onLine === false) setOfflineMap(true);

/* ---------- GPS y brújula ---------- */
let meMarker = null, accCircle = null, watchId = null, firstFix = null;
function meIcon() {
  const h = App.heading;
  const cone = h == null ? "" : '<svg class="me-cone" viewBox="0 0 40 40" style="transform:rotate(' + h + 'deg)"><path d="M20 39 L6 6 Q20 0 34 6 Z" fill="rgba(26,115,232,.28)"/></svg>';
  return L.divIcon({ className: "", html: '<div class="me-wrap">' + cone + '<div class="me-dot"></div></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
}
function drawMe() {
  const p = [App.me.lat, App.me.lon];
  if (!meMarker) { meMarker = L.marker(p, { icon: meIcon(), interactive: false, zIndexOffset: 1000 }).addTo(map); accCircle = L.circle(p, { radius: App.me.acc, color: "#1a73e8", weight: 1, fillOpacity: .08, interactive: false }).addTo(map); }
  else { meMarker.setLatLng(p); accCircle.setLatLng(p).setRadius(App.me.acc); }
}
function startGPS(fly) {
  if (!navigator.geolocation) { toast("Este navegador no da la posición"); return; }
  if (fly) firstFix = true;
  if (watchId != null) { if (fly && App.me) map.flyTo([App.me.lat, App.me.lon], Math.max(map.getZoom(), 15)); return; }
  watchId = navigator.geolocation.watchPosition(p => {
    App.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
    if (p.coords.heading != null && !isNaN(p.coords.heading) && p.coords.speed > 1) App.heading = p.coords.heading;
    drawMe(); if (meMarker) meMarker.setIcon(meIcon());
    if (firstFix) { map.flyTo([App.me.lat, App.me.lon], Math.max(map.getZoom(), 15)); firstFix = false; }
    else if (App.follow) map.panTo([App.me.lat, App.me.lon], { animate: true });
    updateGuide(); if (App.scores) updateSummary();
    LS.set("bb.gpsOk", true);
  }, e => { toast(e.code === 1 ? "Sin permiso de ubicación: actívalo en los ajustes del navegador" : "No encuentro tu posición"); }, { enableHighAccuracy: true, maximumAge: 4000, timeout: 25000 });
}
let compassOn = false;
function startCompass() {
  if (compassOn) return; compassOn = true;
  const on = e => {
    let h = null;
    if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
    if (h != null) { const so = (screen.orientation && screen.orientation.angle) || 0; App.heading = (h + so) % 360; if (meMarker) meMarker.setIcon(meIcon()); updateGuide(); }
  };
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission().then(r => { if (r === "granted") window.addEventListener("deviceorientation", on, true); }).catch(() => { });
  } else { window.addEventListener("deviceorientationabsolute", on, true); window.addEventListener("deviceorientation", on, true); }
}
$("#locBtn").onclick = () => { startGPS(true); startCompass(); };
$("#followBtn").onclick = () => { App.follow = !App.follow; $("#followBtn").setAttribute("aria-pressed", App.follow); if (App.follow) { startGPS(true); startCompass(); } };
map.on("dragstart", () => { if (App.follow) { App.follow = false; $("#followBtn").setAttribute("aria-pressed", "false"); } });

/* ---------- Guía a pie ---------- */
let guideLine = null;
function bearing(a, b) { const f1 = a.lat * Math.PI / 180, f2 = b.lat * Math.PI / 180, dl = (b.lon - a.lon) * Math.PI / 180; const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
function startGuide(lat, lon, label, route) {
  App.guide = { lat, lon, label, route: route && route.length > 1 ? route : null }; $("#guide").hidden = false; startGPS(false); startCompass(); collapseSheet(); updateGuide();
}
// Posición sobre la ruta: punto más cercano, distancia que queda por la ruta y punto al que apuntar (unos 25 m por delante)
function routeProgress(me, R) {
  const cx = Math.cos(me.lat * Math.PI / 180) * 111320, cy = 110540, P = R.map(p => [(p[1] - me.lon) * cx, (p[0] - me.lat) * cy]);
  const len = [0]; for (let i = 1; i < P.length; i++) len.push(len[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  let best = { d: 1e12, at: 0, i: 0, t: 0 };
  for (let i = 1; i < P.length; i++) {
    const [ax, ay] = P[i - 1], [bx, by] = P[i], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L2)) : 0;
    const d = Math.hypot(ax + t * vx, ay + t * vy); if (d < best.d) best = { d, at: len[i - 1] + t * Math.sqrt(L2), i, t };
  }
  const total = len[len.length - 1], ahead = Math.min(total, best.at + 25);
  let k = 1; while (k < len.length - 1 && len[k] < ahead) k++;
  const f = len[k] > len[k - 1] ? (ahead - len[k - 1]) / (len[k] - len[k - 1]) : 1, A = R[k - 1], B = R[k];
  const proj = R[best.i - 1].map((v, j) => v + (R[best.i][j] - v) * best.t);
  return { off: best.d, left: total - best.at, target: { lat: A[0] + (B[0] - A[0]) * f, lon: A[1] + (B[1] - A[1]) * f }, proj, rest: [proj, ...R.slice(best.i)] };
}
function updateGuide() {
  const G = App.guide; if (!G) return;
  if (!App.me) { $("#gDist").textContent = "–"; $("#gInfo").textContent = G.label + " · buscando señal GPS…"; return; }
  const direct = kmDist(App.me.lat, App.me.lon, G.lat, G.lon) * 1000;
  let d = direct, tgt = G, pts = [[App.me.lat, App.me.lon], [G.lat, G.lon]], note = "";
  if (G.route) {
    const rp = routeProgress(App.me, G.route);
    if (rp.off > 60 && direct < rp.left) { note = "fuera de la ruta"; } // ya estás en el bosque, cerca del punto: directo
    else {
      d = rp.left + (rp.off > 15 ? rp.off : 0); tgt = rp.off > 15 ? { lat: rp.proj[0], lon: rp.proj[1] } : rp.target;
      pts = rp.off > 15 ? [[App.me.lat, App.me.lon], ...rp.rest] : rp.rest;
      note = rp.off > 15 ? (rp.off > 100 ? "ve a la ruta, a " : "vuelve a la ruta, a ") + fmtDist(rp.off) : "siguiendo la ruta";
    }
  }
  const br = bearing(App.me, tgt), rot = App.heading == null ? br : br - App.heading;
  $("#gArrow").style.transform = "rotate(" + rot + "deg)";
  $("#gDist").textContent = direct < 20 ? "¡Aquí!" : fmtDist(d);
  $("#gInfo").textContent = G.label + (note ? " · " + note : "") + " · hacia el " + DIRL[dirIdx(br)] + " · " + Math.max(1, Math.round(d * 1.15 / 60)) + " min · " + (App.heading == null ? "flecha respecto al norte (sin brújula)" : "brújula activa") + " · GPS ±" + Math.round(App.me.acc) + " m";
  const style = G.route ? { color: "#7a3fb0", weight: 4, opacity: .9, interactive: false } : { color: "#b4531f", weight: 3, dashArray: "6 6", interactive: false };
  if (!guideLine) guideLine = L.polyline(pts, style).addTo(map); else guideLine.setLatLngs(pts).setStyle(style);
}
$("#gStop").onclick = () => { App.guide = null; $("#guide").hidden = true; if (guideLine) { map.removeLayer(guideLine); guideLine = null; } };

/* ---------- Previsión ---------- */
async function loadForecast() {
  if (!App.grid) return;
  const c = App.me && App.grid.idx(App.me.lat, App.me.lon) >= 0 ? { lat: App.me.lat, lng: App.me.lon } : map.getCenter();
  $("#fcWhere").textContent = (App.me && c.lat === App.me.lat ? "Previsión para donde estás" : "Previsión para el centro del mapa") + ". Índice de la mejor ladera posible de la zona para " + SPECIES[App.prefs.sp].n.toLowerCase() + ".";
  let fc = null;
  try {
    fc = await fetchJSON("https://api.open-meteo.com/v1/forecast?latitude=" + c.lat.toFixed(3) + "&longitude=" + c.lng.toFixed(3) + "&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=Europe%2FMadrid&forecast_days=10", 15000);
    LS.set("bb.fc", { at: Date.now(), fc, lat: c.lat, lon: c.lng });
  } catch (e) { const cc = LS.get("bb.fc", null); if (cc) { fc = cc.fc; toast("Sin conexión: muestro la última previsión guardada"); } }
  if (!fc) { $("#fcText").textContent = "No he podido descargar la previsión."; return; }
  const days = forecastIndex(c.lat, c.lng, fc); renderForecast(days);
}
function forecastIndex(lat, lon, fc) {
  const s = SPECIES[App.prefs.sp], g = App.grid, k0 = g.idx(lat, lon), z = k0 >= 0 ? g.z(k0) : 450;
  const mix = forestMix(lat, lon, g.zones); let Hf = 0; for (const t in mix) Hf += mix[t] * (s.aff[t] || 0);
  const D = fc.daily, adj = -.006 * (z - (fc.elevation ?? z)), todayK = dayKey(new Date());
  // Serie diaria en el punto: lluvia y máxima observadas (interpoladas de las estaciones) + previsión desde mañana
  const W = {}; let ws = 0;
  for (const c of Object.keys(App.raw.stations)) { const st = STATIONS[c]; if (!st) continue; const d = Math.max(kmDist(lat, lon, st.lat, st.lon), 1.5); W[c] = 1 / (d * d); ws += W[c]; }
  const rain = {}, tmaxS = {}, keys = new Set();
  for (const c in W) for (const k in App.raw.stations[c].rain) keys.add(k);
  for (const k of keys) {
    let r = 0, t = 0, wt = 0;
    for (const c in W) { const st = App.raw.stations[c]; r += W[c] * (+st.rain[k] || 0); if (st.tmax && st.tmax[k] != null) { t += W[c] * (st.tmax[k] - .006 * (z - STATIONS[c].alt)); wt += W[c]; } }
    rain[k] = r / ws; if (wt) tmaxS[k] = t / wt;
  }
  D.time.forEach((t, f) => { if (t > todayK) { rain[t] = D.precipitation_sum[f] || 0; tmaxS[t] = D.temperature_2m_max[f] + adj; } });
  return D.time.map((t, k) => {
    const target = parseDay(t), summ = {};
    for (const [cde, st] of Object.entries(App.raw.stations)) summ[cde] = stationSummary(st, target);
    const m = meteoAt(lat, lon, summ, null);
    const rs = rainScore(rain, tmaxS, target, s);
    let rain7 = 0, dry = 99; for (const kk in rain) { const a = daysBetween(parseDay(kk), target); if (a >= 0 && a <= 6) rain7 += rain[kk]; if (a >= 0 && rain[kk] >= 2 && a < dry) dry = a; }
    const fT = []; for (let f = Math.max(0, k - 6); f <= k; f++) fT.push([D.temperature_2m_min[f] + adj, D.temperature_2m_max[f] + adj]);
    const nObs = 7 - fT.length, tmo = m.t0min - .006 * z, txo = m.t0max - .006 * z;
    const tmin = (tmo * nObs + fT.reduce((a, v) => a + v[0], 0)) / 7, tmax = (txo * nObs + fT.reduce((a, v) => a + v[1], 0)) / 7;
    const f = meteoFactors(s, { R: rs.R, rain7, dryDays: dry, t0min: tmin + .006 * z, t0max: tmax + .006 * z }, z, target);
    const best = (1 + Math.max(0, f.a)) * (1 + .3 * s.hollow);
    return { t, date: target, idx: Math.max(0, Math.min(100, 100 * Hf * f.S * f.R * f.D * f.T * best / 1.15)), ev: rs.best, rain: D.precipitation_sum[k] || 0, tmin: D.temperature_2m_min[k], tmax: D.temperature_2m_max[k] };
  });
}
function renderForecast(days) {
  const box = $("#fcBars"); box.innerHTML = ""; const mx = Math.max(60, ...days.map(d => d.idx)); let best = 0;
  days.forEach((d, i) => { if (d.idx > days[best].idx) best = i; });
  days.forEach((d, i) => {
    const lv = absLevel(d.idx);
    const el = document.createElement("div"); el.className = "bar" + (i === best ? " best" : "");
    el.innerHTML = "<b>" + fmt(d.idx) + '</b><i style="height:' + Math.max(4, d.idx / mx * 80) + "px;background:" + LV_COL[lv] + '"></i><span>' + d.date.toLocaleDateString("es-ES", { weekday: "short" }).slice(0, 2) + " " + d.date.getDate() + "</span><span>" + (d.rain >= 1 ? "💧" + fmt(d.rain) : "&nbsp;") + "</span>";
    box.append(el);
  });
  const b = days[best], wd = b.date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" });
  App.fcBest = best === 0 ? "hoy" : wd; updateSummary();
  const lvTxt = v => ABS_NAMES[absLevel(v)].toLowerCase();
  let txt = (best === 0 ? "Hoy es el mejor día de los próximos diez" : "Mejor día de los próximos diez: " + wd) + ", con probabilidad " + lvTxt(b.idx) + " (índice " + fmt(b.idx) + " de 100). Hoy: " + lvTxt(days[0].idx) + " (" + fmt(days[0].idx) + ").";
  const e0 = days[best].ev;
  if (e0) txt += " Cuenta sobre todo la lluvia que acabó el " + parseDay(e0.date).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) + " (" + e0.mm + " mm)" + (e0.dryF < .8 ? ", que pierde fuerza por los días secos que vinieron después" : "") + ".";
  else txt += " No hay ninguna lluvia reciente suficiente para que salgan setas.";
  const big = days.findIndex((d, i) => i > 0 && d.rain >= 10);
  if (big > 0) { const from = addDays(days[big].date, 10); txt += " Se espera lluvia el " + days[big].date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" }) + " (" + fmt(days[big].rain) + " mm): las setas de esa lluvia saldrían hacia el " + from.toLocaleDateString("es-ES", { day: "numeric", month: "long" }) + "."; }
  $("#fcText").textContent = txt;
}
function renderMeteoTable() {
  const s = SPECIES[App.prefs.sp], today = new Date();
  const rows = Object.entries(App.summ).filter(([c]) => STATIONS[c] && !STATIONS[c].model).map(([c, m]) => { const rs = rainScore(m.rain, m.tmax, today, s); return "<tr><td>" + esc(STATIONS[c].n) + "</td><td>" + fmt(m.rain21, 0) + "</td><td>" + (m.lastRain ? m.lastRain.age + " d" : "–") + "</td><td>" + fmt(rs.R * 100) + "</td><td>" + fmt(m.tmin7, 1) + " / " + fmt(m.tmax7, 1) + "</td></tr>"; }).join("");
  $("#meteoTable").innerHTML = "<thead><tr><th>Estación</th><th>Lluvia 21 d (mm)</th><th>Última lluvia fuerte</th><th>Lluvia útil hoy</th><th>Mín / máx 7 d</th></tr></thead><tbody>" + rows + "</tbody>";
  const mp = Object.keys(App.raw.model || {}).length;
  $("#fieldNote").textContent = mp ? "Además de estas estaciones, la lluvia de cada zona sale de " + mp + " puntos del modelo de Open-Meteo (uno cada ~7 km), corregidos con " + (App.raw.modelBias || 0) + " estaciones" + (App.raw.modelOld ? ". Son de la última descarga: ahora no he podido actualizarlos." : ". También uso la humedad del suelo del modelo: si se está secando, baja el índice.") : "Solo estaciones: no he podido descargar la lluvia por zona del modelo.";
}

/* ---------- Diario ---------- */
const FIND_COL = { rovello: "#d2691e", pinetell: "#e8811a", llenega: "#333", fredolic: "#7a7a7a", camagroc: "#e0b000", molsa: "#c9a227", ceps: "#8b5a2b", otra: "#5b8def", nada: "#bbb" };
const FIND_N = { rovello: "Rovelló", pinetell: "Pinetell", llenega: "Llenega negra", fredolic: "Fredolic", camagroc: "Camagroc", molsa: "Molsa", ceps: "Cep", otra: "Otra", nada: "Nada" };
let findAt = null;
function openFindForm(at) {
  openSheet("diario");
  findAt = at || (App.me ? { lat: App.me.lat, lon: App.me.lon } : (() => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; })());
  $("#findForm").hidden = false; $("#fSp").value = App.prefs.sp in SPECIES ? App.prefs.sp : "rovello";
  $("#fWhere").textContent = (at ? "En el punto marcado" : App.me ? "En tu posición (±" + Math.round(App.me.acc) + " m)" : "En el centro del mapa (no tengo tu GPS)") + ": " + findAt.lat.toFixed(5) + ", " + findAt.lon.toFixed(5);
}
$("#addFind").onclick = () => openFindForm(null);
$("#fCancel").onclick = () => { $("#findForm").hidden = true; };
$("#findForm").onsubmit = e => {
  e.preventDefault(); const ci = cellInfo(findAt.lat, findAt.lon);
  App.diary.unshift({ id: Date.now().toString(36), t: new Date().toISOString(), lat: +findAt.lat.toFixed(6), lon: +findAt.lon.toFixed(6), sp: $("#fSp").value, qty: +$("#fQty").value, note: $("#fNote").value.trim(), idx: ci ? Math.round(ci.v) : null });
  LS.set("bb.diary", App.diary); $("#findForm").hidden = true; $("#fNote").value = ""; renderDiary(); toast("Guardado en el diario");
};
function renderDiary() {
  const ol = $("#finds"); ol.innerHTML = ""; layerFinds.clearLayers();
  if (!App.diary.length) ol.innerHTML = '<li class="hint">Aún no hay hallazgos. Cuando encuentres algo (o nada), apúntalo: me sirve para afinar el modelo.</li>';
  for (const f of App.diary) {
    const li = document.createElement("li"); const d = new Date(f.t);
    li.innerHTML = '<span class="sw" style="background:' + (FIND_COL[f.sp] || "#888") + '"></span><span class="tt"><b>' + esc(FIND_N[f.sp] || f.sp) + "</b> · " + ["ninguna", "pocas", "bastantes", "muchas"][f.qty] + "<br><small>" + d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) + (f.idx != null ? " · índice " + f.idx : "") + (f.note ? " · " + esc(f.note) : "") + "</small></span>";
    const go = mkBtn("◎", () => map.flyTo([f.lat, f.lon], 16)); go.setAttribute("aria-label", "Ver en el mapa");
    const del = mkBtn("×", () => { if (confirmDel(f)) { App.diary = App.diary.filter(x => x.id !== f.id); LS.set("bb.diary", App.diary); renderDiary(); } }); del.setAttribute("aria-label", "Borrar");
    li.append(go, del); ol.append(li);
    L.marker([f.lat, f.lon], { icon: L.divIcon({ className: "", html: '<div class="find-ico" style="background:' + (FIND_COL[f.sp] || "#888") + '"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }) })
      .bindPopup("<b>" + esc(FIND_N[f.sp] || f.sp) + "</b> · " + ["ninguna", "pocas", "bastantes", "muchas"][f.qty] + "<br>" + d.toLocaleString("es-ES") + (f.note ? "<br>" + esc(f.note) : "")).addTo(layerFinds);
  }
}
function confirmDel(f) { if (f._arm) return true; f._arm = true; toast("Toca × otra vez para borrarlo"); setTimeout(() => f._arm = false, 4000); return false; }
$("#exportBtn").onclick = async () => {
  const data = JSON.stringify({ app: "Bolets Bages y Berguedà", exported: new Date().toISOString(), diary: App.diary }, null, 1);
  const file = new File([data], "bolets-diario-" + dayKey(new Date()) + ".json", { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: "Diario de bolets" }); return; } catch (e) { if (e.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$("#importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const j = JSON.parse(await f.text()); const ids = new Set(App.diary.map(x => x.id)); let n = 0; for (const x of (j.diary || [])) if (x && x.id && !ids.has(x.id) && isFinite(x.lat) && isFinite(x.lon)) { App.diary.push(x); n++; } App.diary.sort((a, b) => b.t.localeCompare(a.t)); LS.set("bb.diary", App.diary); renderDiary(); toast("Importados " + n + " hallazgos"); }
  catch (err) { toast("Ese archivo no es un diario válido"); }
  e.target.value = "";
};

/* ---------- Planear la salida (antes de salir de casa) ---------- */
async function fetchStationsForecast() {
  const codes = Object.keys(App.raw.stations).filter(c => STATIONS[c] && !STATIONS[c].model);
  const lat = codes.map(c => STATIONS[c].lat.toFixed(3)).join(","), lon = codes.map(c => STATIONS[c].lon.toFixed(3)).join(",");
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon + "&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=Europe%2FMadrid&forecast_days=8";
  try {
    let j = await fetchJSON(url, 20000); if (!Array.isArray(j)) j = [j];
    const fc = {}; codes.forEach((c, i) => { if (j[i] && j[i].daily) fc[c] = j[i]; }); LS.set("bb.fcSt", { at: Date.now(), fc }); return fc;
  } catch (e) { const c = LS.get("bb.fcSt", null); return c && Date.now() - c.at < 24 * 3600e3 ? c.fc : null; }
}
const avgRain = (fc, k) => { const v = Object.values(fc).map(f => (f && f.daily.precipitation_sum[k]) || 0); return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length); };
const estDrive = z => Math.round(kmDist(App.home.lat, App.home.lon, z.lat, z.lon) * 1.35 / 50 * 60 + 6);
let planBusy = false, lastDrag = 0, planMark = 0; // planMark: cuándo pediste ver el plan (abrir, cambiar de día…)
map.on("dragstart zoomstart", e => { if (e.originalEvent || e.type === "dragstart") lastDrag = Date.now(); });
async function planInit(force) {
  if (!App.grid || !App.raw || !App.munis) return;
  planMark = Date.now();
  if (App.plan && !force && App.plan.sp === App.prefs.sp && App.plan.kids === App.prefs.kids && App.plan.day === dayKey(new Date())) { renderPlan(); return; }
  if (planBusy) return; planBusy = true;
  $("#planMsg").textContent = "Calculando las mejores zonas para los próximos días…"; $("#zones").innerHTML = ""; $("#planDays").innerHTML = "";
  try {
    const fc = await fetchStationsForecast();
    const today = new Date(), ext = fc ? extendStations(App.raw, fc, dayKey(today)) : App.raw, N = fc ? 7 : 1, days = [];
    for (let k = 0; k < N; k++) {
      const date = addDays(today, k), sc = computeScores(App.grid, summaryAt(ext, date), App.prefs, date, 3);
      const zones = zoneRanking(App.grid, sc, App.muniArr, App.munis, 3);
      days.push({ date, zones, best: zones.length ? zones[0].q : 0, rain: fc ? avgRain(fc, k) : 0 });
      await new Promise(r => setTimeout(r, 0));
    }
    App.plan = { days, ext, sel: App.plan ? Math.min(App.plan.sel, N - 1) : 0, sp: App.prefs.sp, kids: App.prefs.kids, day: dayKey(today), noFc: !fc, drive: {} };
    renderPlan();
  } catch (e) { console.error(e); $("#planMsg").textContent = "No he podido calcular el plan. Prueba otra vez en un momento."; }
  finally { planBusy = false; }
}
function renderPlan() {
  const P = App.plan; if (!P) return;
  $("#planFrom").textContent = "Salgo desde: " + App.home.n + ".";
  const box = $("#planDays"); box.innerHTML = "";
  P.days.forEach((d, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "day"; b.setAttribute("aria-pressed", i === P.sel);
    const lv = absLevel(d.best);
    b.innerHTML = "<b>" + (i === 0 ? "Hoy" : i === 1 ? "Mañana" : esc(d.date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" }))) + '</b><i style="background:' + LV_COL[lv] + '"></i><span>' + ABS_NAMES[lv] + "</span>" + (d.rain >= 1 ? "<span>💧" + fmt(d.rain) + " mm</span>" : "");
    b.onclick = () => { P.sel = i; planMark = Date.now(); renderPlan(); };
    box.append(b);
  });
  const d = P.days[P.sel], maxD = App.prefs.maxDrive;
  const zs = d.zones.map(z => Object.assign({}, z, { drive: P.drive[z.id + "@" + P.sel] ?? null, est: estDrive(z) }));
  const show = zs.filter(z => (z.drive ?? z.est) <= maxD).slice(0, 6);
  const bestDay = P.days.reduce((a, x, i) => x.best > P.days[a].best ? i : a, 0);
  let msg = "Para " + dayName(d.date) + ", lo mejor de la zona tiene probabilidad " + ABS_NAMES[absLevel(d.best)].toLowerCase() + " (índice " + fmt(d.best) + ").";
  if (absLevel(d.best) <= 1) msg += " No merece mucho la pena salir.";
  if (bestDay !== P.sel && P.days[bestDay].best > d.best + 5) msg += " El mejor día de la semana es " + dayName(P.days[bestDay].date) + " (" + ABS_NAMES[absLevel(P.days[bestDay].best)].toLowerCase() + ").";
  if (P.noFc) msg += " Sin conexión con la previsión: solo puedo calcular hoy.";
  msg += show.length ? " Estas son las mejores zonas a menos de " + maxD + " min:" : " No hay zonas a menos de " + maxD + " min: sube el máximo en coche.";
  $("#planMsg").textContent = msg;
  const ol = $("#zones"); ol.innerHTML = ""; layerPlan.clearLayers();
  show.forEach((z, i) => {
    L.marker([z.lat, z.lon], { icon: L.divIcon({ className: "", html: '<div class="zone-ico" style="background:' + LV_COL[absLevel(z.q)] + '">' + (i + 1) + "</div>", iconSize: [28, 28], iconAnchor: [14, 14] }) })
      .bindTooltip(z.n + " · " + ABS_NAMES[absLevel(z.q)]).on("click", () => openPlanZone(z, d.date)).addTo(layerPlan);
    const li = document.createElement("li"); li.className = "spot"; const lv = absLevel(z.q), dI = dirIdx(z.aspect);
    const drive = (z.drive != null ? z.drive : "~" + z.est) + " min en coche";
    const ha = Math.round(z.good * .071);
    li.innerHTML = '<div class="hd"><span class="n" style="background:' + LV_COL[lv] + '">' + (i + 1) + '</span><span class="tt"><b>' + esc(z.n) + " · " + ABS_NAMES[lv] + '</b><small><span data-zone="' + z.id + '"></span>' + esc(drive + " · mejor sitio: " + (z.slope < 6 ? "llano" : z.slope < 12 ? "suave" : "inclinado") + (z.slope >= 4 ? ", mira al " + DIRL[dI] : "") + ", " + fmtDist(z.edge) + " dentro del bosque" + (ha > 0 ? " · " + fmt(ha) + " ha de zona media o mejor" : "")) + '</small></span><span class="sc">' + fmt(z.q) + '</span></div><div class="acts"></div>';
    const acts = li.querySelector(".acts");
    acts.append(mkBtn("Ver zona", () => openPlanZone(z, d.date), "primary small"));
    acts.append(mkBtn("Ir en coche", () => goByCar(z.lat, z.lon), "small"));
    ol.append(li);
  });
  // solo se encuadra si sigues en «Planear» y no has movido el mapa mientras se calculaba
  if (show.length && !sheet.classList.contains("collapsed") && !$("#p-plan").hidden && lastDrag < planMark) {
    const sh = window.innerWidth >= 760 ? 0 : sheet.getBoundingClientRect().height, sw = window.innerWidth >= 760 ? 420 : 0;
    map.fitBounds(L.latLngBounds(show.map(z => [z.lat, z.lon])).pad(.15), { paddingTopLeft: [sw + 20, 70], paddingBottomRight: [60, sh + 20], maxZoom: 12 });
  }
  driveTimes(show, P.sel); fillZonePlaces(show);
}
const geoCache = LS.get("bb.geo", {});
let geoQ = Promise.resolve();
function placeName(lat, lon) {
  const key = lat.toFixed(3) + "," + lon.toFixed(3); if (key in geoCache) return Promise.resolve(geoCache[key]);
  geoQ = geoQ.then(async () => {
    if (key in geoCache) return geoCache[key];
    try {
      const r = await fetchJSON("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=15&accept-language=ca,es&lat=" + lat.toFixed(5) + "&lon=" + lon.toFixed(5), 10000);
      const a = r.address || {}; geoCache[key] = a.hamlet || a.isolated_dwelling || a.farm || a.locality || a.village || a.suburb || a.town || a.city || null; LS.set("bb.geo", geoCache);
    } catch (e) { return null; }
    await new Promise(r => setTimeout(r, 1100)); return geoCache[key];
  });
  return geoQ;
}
async function fillZonePlaces(zs) {
  for (const z of zs) {
    const n = await placeName(z.lat, z.lon); z.place = n;
    const el = document.querySelector('#zones [data-zone="' + z.id + '"]'); if (el && n && n !== z.n) el.textContent = "cerca de " + n + " · ";
  }
}
async function driveTimes(zs, sel) {
  const P = App.plan, need = zs.filter(z => P.drive[z.id + "@" + sel] == null); if (!need.length) return;
  const coords = [App.home.lon.toFixed(5) + "," + App.home.lat.toFixed(5)].concat(need.map(z => z.lon.toFixed(5) + "," + z.lat.toFixed(5))).join(";");
  try {
    const r = await fetchJSON("https://router.project-osrm.org/table/v1/driving/" + coords + "?sources=0&annotations=duration", 15000);
    need.forEach((z, i) => { const s = r.durations && r.durations[0][i + 1]; P.drive[z.id + "@" + sel] = s != null ? Math.round(s / 60) : estDrive(z); });
    if (App.plan === P && P.sel === sel) renderPlan();
  } catch (e) { need.forEach(z => P.drive[z.id + "@" + sel] = estDrive(z)); }
}
function openPlanZone(z, date) {
  layerPlan.clearLayers();
  const changed = (App.date ? dayKey(App.date) : dayKey(new Date())) !== dayKey(date);
  App.date = isToday(date) ? null : date;
  if (changed) { summarize(); recompute(); }
  collapseSheet();
  map.flyTo([z.lat, z.lon], 14, { duration: 1.2 });
  map.once("moveend", () => toast("Zona de " + z.n + (z.place ? " (" + z.place + ")" : "") + ". Si quieres puntos concretos, abre «Cerca» y pulsa «Buscar puntos».", 5000));
}
$("#homeHere").onclick = () => {
  if (!App.me) { startGPS(false); toast("Buscando tu posición… vuelve a pulsar cuando aparezca el punto azul"); return; }
  App.home = { lat: App.me.lat, lon: App.me.lon, n: "tu casa (guardada)" }; LS.set("bb.home", App.home);
  if (App.plan) App.plan.drive = {}; renderPlan(); toast("Casa guardada");
};

/* ---------- Ajustes ---------- */
const SL = {
  flat: v => v < .15 ? "da igual" : v < .5 ? "algo" : v < .85 ? "bastante" : "mucho",
  interior: v => v == 0 ? "da igual" : "pleno a " + v + " m del borde",
  pathMin: v => v == 0 ? "da igual" : "mejor a más de " + v + " m",
  walkMax: v => fmtDist(v), shade: v => fmt(v * 100) + " %", hollow: v => fmt(v * 100) + " %",
  minLevel: v => ["", "25 % mejor", "10 % mejor", "3 % mejor"][v], opacity: v => fmt(v * 100) + " %",
  maxDrive: v => v + " min",
  carLevel: v => CAR_LEVELS[v], dirtMax: v => v == 0 ? "nada de tierra" : fmtDist(v),
  climbMax: v => (App.prefs.kids && v > 40 ? "40 m (modo niños)" : v + " m"), minWalk: v => v == 0 ? "da igual" : "al menos " + fmtDist(v)
};
const HEAVY = new Set(["flat", "interior", "shade", "hollow"]);
let rcT = null;
function bindPrefs() {
  for (const k of Object.keys(SL)) {
    const el = $("#" + k); el.value = App.prefs[k]; $("#" + k + "V").textContent = SL[k](+el.value);
    el.oninput = () => {
      App.prefs[k] = +el.value; $("#" + k + "V").textContent = SL[k](+el.value); LS.set("bb.prefs", App.prefs);
      if (k === "opacity") { if (overlay) overlay.setOpacity(App.prefs.opacity); return; }
      if (k === "maxDrive") { planMark = Date.now(); renderPlan(); return; }
      if (k === "carLevel" || k === "dirtMax" || k === "climbMax" || k === "minWalk") { clearTimeout(rcT); rcT = setTimeout(() => { if (App.ways) runAnalysis(false); }, 300); return; }
      clearTimeout(rcT);
      rcT = setTimeout(() => { if (HEAVY.has(k)) recompute(); else if (k === "minLevel") renderOverlay(); else if (App.ways) runAnalysis(false); }, 300);
    };
  }
  const kd = $("#kids"); kd.checked = !!App.prefs.kids;
  kd.onchange = () => {
    App.prefs.kids = kd.checked;
    if (kd.checked) { App.prefs.walkMax = Math.min(App.prefs.walkMax, 300); App.prefs.pathMin = Math.min(App.prefs.pathMin, 30); }
    LS.set("bb.prefs", App.prefs); bindPrefs(); recompute(); App.plan = null;
  };
  const ac = $("#avoidCrowd"); ac.checked = !!App.prefs.avoidCrowd;
  ac.onchange = () => { App.prefs.avoidCrowd = ac.checked; LS.set("bb.prefs", App.prefs); if (App.ways) runAnalysis(false); toast(ac.checked ? "Evito las zonas más concurridas" : "Ya no evito las zonas concurridas"); };
}
$("#resetPrefs").onclick = () => { const sp = App.prefs.sp; App.prefs = Object.assign({}, DEFAULT_PREFS, { sp }); LS.set("bb.prefs", App.prefs); bindPrefs(); if (overlay) overlay.setOpacity(App.prefs.opacity); recompute(); toast("Ajustes por defecto"); };
$("#refreshMeteo").onclick = async () => { await loadMeteo(true); summarize(); recompute(); meteoStatus(); renderMeteoTable(); toast("Meteo actualizada"); };

/* ---------- Especie ---------- */
function renderSpMenu() {
  const m = $("#spMenu"); m.innerHTML = "";
  for (const [k, s] of Object.entries(SPECIES)) {
    const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", k === App.prefs.sp);
    b.innerHTML = esc(s.n) + "<small>" + esc(s.lat) + "</small>";
    b.onclick = () => { App.prefs.sp = k; LS.set("bb.prefs", App.prefs); $("#spName").textContent = s.n; m.hidden = true; recompute(); renderSpotList(); if (!$("#p-dias").hidden) loadForecast(); if (!$("#p-plan").hidden) planInit(); };
    m.append(b);
  }
}
$("#spBtn").onclick = () => { renderSpMenu(); $("#spMenu").hidden = !$("#spMenu").hidden; };
map.on("click", () => { $("#spMenu").hidden = true; });

/* ---------- Panel inferior ---------- */
const sheet = $("#sheet");
function setSheetVar() { document.documentElement.style.setProperty("--sheet-h", (window.innerWidth >= 760 ? 0 : sheet.getBoundingClientRect().height) + "px"); }
new ResizeObserver(setSheetVar).observe(sheet);
function openSheet(tab) {
  sheet.classList.remove("collapsed");
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach(p => p.hidden = p.id !== "p-" + tab);
  if (tab === "dias") { loadForecast(); if (App.summ) renderMeteoTable(); }
  if (tab === "plan") planInit();
}
function collapseSheet() { sheet.classList.add("collapsed"); }
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  const open = !sheet.classList.contains("collapsed"), cur = b.getAttribute("aria-selected") === "true";
  if (open && cur) collapseSheet(); else openSheet(b.dataset.tab);
});
$("#grab").onclick = () => sheet.classList.contains("collapsed") ? openSheet(document.querySelector('.tabs [aria-selected="true"]').dataset.tab) : collapseSheet();
$("#analyzeBtn").onclick = analyze;
$("#saveZone").onclick = saveZoneOffline;

/* ---------- Arranque ---------- */
window.addEventListener("error", e => console.warn(e.message));
(async function init() {
  $("#version").textContent = "Versión " + VERSION;
  $("#spName").textContent = SPECIES[App.prefs.sp].n;
  bindPrefs(); renderDiary(); renderSpotList(); renderOffZones();
  if (LS.get("bb.gpsOk", false)) startGPS(false);
  try {
    await Promise.all([loadGrid(), discoverStations().then(() => loadMeteo(false))]);
    fixStationAlts();
    summarize(); recompute(); meteoStatus(); drawSpots(); openSheet("plan");
    map.on("moveend", () => { if (App.summ) meteoStatus(); });
  } catch (e) { console.error(e); setStatus("Error al cargar los datos: " + e.message, "err"); }
  if ("serviceWorker" in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch(() => { });
    let reloading = false; navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloading || !hadController) return; reloading = true; toast("App actualizada", 2000); setTimeout(() => location.reload(), 800); });
  }
})();
