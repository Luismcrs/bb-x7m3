/* Bolets Bages · app */
"use strict";
const VERSION = "1.1 · 24-10-2026";
const $ = s => document.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
const App = {
  prefs: Object.assign({}, DEFAULT_PREFS, LS.get("bb.prefs", {})),
  grid: null, raw: null, summ: null, scores: null, th: null, me: null, heading: null, follow: false,
  ways: null, analysis: LS.get("bb.lastAnalysis", null), diary: LS.get("bb.diary", []), guide: null, fc: null, meteoInfo: null
};
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
const map = L.map("map", { zoomControl: false, minZoom: 9, maxZoom: 19, maxBounds: [[41.2, 1.1], [42.4, 2.6]], tap: true }).setView([41.80, 1.83], 11);
map.createPane("prob").style.zIndex = 350;
const ICGC = L.TileLayer.extend({
  getTileUrl(c) {
    return "https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=" + this.options.layer +
      "&STYLE=default&TILEMATRIXSET=MON3857NW&TILEMATRIX=" + String(c.z).padStart(2, "0") + "&TILEROW=" + c.y + "&TILECOL=" + c.x + "&FORMAT=image/png";
  }
});
const bases = {
  "Topográfico (ICGC)": new ICGC("", { layer: "topografic", maxNativeZoom: 18, maxZoom: 19, attribution: "© ICGC" }),
  "Ortofoto (ICGC)": new ICGC("", { layer: "orto", maxNativeZoom: 18, maxZoom: 19, attribution: "© ICGC" }),
  "OpenTopoMap": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxNativeZoom: 17, maxZoom: 19, subdomains: "abc", attribution: "© OpenStreetMap, SRTM · OpenTopoMap (CC-BY-SA)" }),
  "Satélite (Esri)": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 18, maxZoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics" }),
  "OpenStreetMap": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxNativeZoom: 19, maxZoom: 19, attribution: "© OpenStreetMap" })
};
let baseName = LS.get("bb.base", "Topográfico (ICGC)"); if (!bases[baseName]) baseName = "Topográfico (ICGC)";
bases[baseName].addTo(map);
// Si el mapa del ICGC falla al arrancar, se cambia solo a OpenTopoMap
let tileErr = 0, tileOk = 0; bases[baseName].on("tileload", () => tileOk++);
bases[baseName].on("tileerror", () => { if (++tileErr === 12 && tileOk === 0 && baseName.includes("ICGC")) { map.removeLayer(bases[baseName]); baseName = "OpenTopoMap"; bases[baseName].addTo(map); toast("El mapa del ICGC no responde: cambio a OpenTopoMap"); } });
map.on("baselayerchange", e => { baseName = e.name; LS.set("bb.base", baseName); });
const layerProb = L.layerGroup(), layerCar = L.layerGroup(), layerSpots = L.layerGroup().addTo(map), layerFinds = L.layerGroup().addTo(map);
L.control.layers(bases, { "Probabilidad": layerProb, "Accesos en coche (OSM)": layerCar, "Puntos": layerSpots, "Diario": layerFinds }, { position: "topright", collapsed: true }).addTo(map);
layerProb.addTo(map); layerCar.addTo(map);
L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);

/* ---------- Datos de relieve y bosque ---------- */
async function loadPixels(url) {
  const img = new Image(); img.decoding = "async"; img.src = url; await img.decode();
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0);
  return x.getImageData(0, 0, c.width, c.height).data;
}
async function loadGrid() {
  setStatus("Cargando relieve y bosque…");
  const meta = await fetchJSON("data/meta.json");
  const [t, f, e] = await Promise.all(["data/terrain.png", "data/forest.png", "data/elev.png"].map(loadPixels));
  App.grid = new Grid(meta, t, f, e);
}

/* ---------- Meteo (Meteocat en directo, con copia de seguridad) ---------- */
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
  if (!force && cached && cached.v === 2 && Date.now() - new Date(cached.fetched) < 2 * 3600e3) { App.raw = cached; return; }
  setStatus("Descargando meteo de Meteocat…");
  try { App.raw = await fetchMeteoLive(); App.raw.v = 2; LS.set("bb.meteo", App.raw); }
  catch (e) {
    if (cached) { App.raw = cached; toast("Sin conexión con Meteocat: uso la última meteo guardada"); }
    else { App.raw = await fetchJSON("data/meteo-fallback.json"); toast("Sin conexión con Meteocat: uso datos guardados del " + App.raw.lastDay); }
  }
}
function summarize() {
  const today = new Date(); App.summ = {};
  for (const [c, st] of Object.entries(App.raw.stations)) App.summ[c] = stationSummary(st, today);
}

/* ---------- Cálculo y capa de probabilidad ---------- */
const merc = la => Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360));
const imerc = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
let overlay = null;
function recompute() {
  const t0 = performance.now();
  App.scores = computeScores(App.grid, App.summ, App.prefs, new Date());
  App.th = thresholds(App.grid, App.scores);
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
  const s = SPECIES[App.prefs.sp], mx = App.th.max;
  let t = s.n + " hoy: probabilidad " + ABS_NAMES[absLevel(mx)].toLowerCase() + " incluso en las mejores zonas del Bages (índice máx. " + fmt(mx) + " de 100)";
  if (App.me) { const ci = cellInfo(App.me.lat, App.me.lon); if (ci) t += " · donde estás: " + fmt(ci.v) + " (" + ABS_NAMES[ci.level].toLowerCase() + ")"; }
  if (App.fcBest) t += " · mejor día próximo: " + App.fcBest;
  $("#summary").textContent = t;
}
function meteoStatus() {
  const c = map.getCenter(); const m = meteoAt(c.lat, c.lng, App.summ);
  const when = new Date(App.raw.fetched);
  let txt = (App.raw.source === "Meteocat en directo" ? "Meteo de " : "Meteo guardada de ") + when.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + " " + when.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (m && m.lastRain) txt += " · última lluvia fuerte hace " + m.lastRain.age + " días (" + m.lastRain.mm + " mm)";
  const age = (Date.now() - when) / 3600e3;
  setStatus(txt, age < 6 ? "ok" : "old");
}

/* ---------- Puntos con caminos reales (Overpass) ---------- */
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
async function overpass(q) {
  let err;
  for (const u of OVERPASS) {
    try { return await fetchJSON(u, 40000, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }); }
    catch (e) { err = e; }
  }
  throw err;
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
let boxLayer = null;
async function analyze() {
  if (!App.scores) return;
  const box = analysisBox(); if (!box) { toast("Esa zona queda fuera del Bages"); return; }
  const btn = $("#analyzeBtn"); btn.disabled = true; btn.textContent = "Descargando caminos…";
  try {
    const q = "[out:json][timeout:30];way[\"highway\"](" + [box.s, box.w, box.n, box.e].map(v => v.toFixed(5)).join(",") + ");out tags geom;";
    const data = await overpass(q);
    App.ways = { box, ways: data.elements.filter(x => x.type === "way" && x.geometry) };
    runAnalysis(true);
  } catch (e) {
    toast("No he podido descargar los caminos de OpenStreetMap. Prueba otra vez en un momento.");
  } finally { btn.disabled = false; btn.textContent = "Buscar los mejores puntos en lo que veo"; }
}
function runAnalysis(fit) {
  const { box, ways } = App.ways;
  const res = analyzeWindow(App.grid, App.scores, App.th, box, ways, App.prefs, App.me);
  // resaltar accesos en coche
  layerCar.clearLayers();
  for (const wy of ways) if (isDrivable(wy.tags || {})) L.polyline(wy.geometry.map(p => [p.lat, p.lon]), { color: "#1a5fb4", weight: 3, opacity: .55, interactive: false }).addTo(layerCar);
  if (boxLayer) map.removeLayer(boxLayer);
  boxLayer = L.rectangle([[box.s, box.w], [box.n, box.e]], { color: "#1f2a22", weight: 1, dashArray: "4 6", fill: false, interactive: false }).addTo(map);
  App.analysis = { box, spots: res.spots, when: new Date().toISOString(), sp: App.prefs.sp };
  LS.set("bb.lastAnalysis", App.analysis);
  drawSpots(); renderSpotList();
  if (fit) {
    if (!res.spots.length) toast("No hay zonas buenas que cumplan tus ajustes aquí. Prueba a subir la distancia andando o a mover el mapa.");
    else { openSheet("cerca"); }
  }
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
      L.polyline([[s.park.lat, s.park.lon], [s.lat, s.lon]], { color: "#1a5fb4", weight: 2, dashArray: "3 6", interactive: false }).addTo(layerSpots);
    }
  });
}
const carUrl = (la, lo) => "https://www.google.com/maps/dir/?api=1&destination=" + la.toFixed(5) + "," + lo.toFixed(5) + "&travelmode=driving";
function spotLine(s) {
  const d = dirIdx(s.aspect), bits = [];
  if (App.me) bits.push("a " + fmtDist(kmDist(App.me.lat, App.me.lon, s.lat, s.lon) * 1000) + " de ti");
  if (s.walk != null) bits.push(fmtDist(s.walk) + " andando desde el coche");
  bits.push((s.slope < 6 ? "llano" : s.slope < 12 ? "suave" : "inclinado") + " (" + fmt(s.slope) + "°)" + (s.slope >= 4 ? ", mira al " + DIRL[d] : ""));
  bits.push(fmtDist(s.dPath) + " del camino o sendero más cercano");
  return bits.join(" · ");
}
function renderSpotList() {
  const ol = $("#spots"); ol.innerHTML = ""; const A = App.analysis;
  if (!A || !A.spots.length) { ol.innerHTML = '<li class="hint">Todavía no hay puntos. Acerca el mapa a una zona y pulsa el botón.</li>'; return; }
  if (A.sp !== App.prefs.sp) ol.insertAdjacentHTML("beforeend", '<li class="hint">Estos puntos son de otra especie. Vuelve a buscar.</li>');
  A.spots.forEach((s, i) => {
    const li = document.createElement("li"); li.className = "spot";
    li.innerHTML = '<div class="hd"><span class="n" style="background:' + LV_COL[s.level] + '">' + (i + 1) + '</span><span class="tt"><b>' + ABS_NAMES[s.level] + "</b><small>" + esc(spotLine(s)) + '</small></span><span class="sc" title="Índice ajustado a tus preferencias">' + fmt(s.adj) + '</span></div><div class="acts"></div>';
    const acts = li.querySelector(".acts");
    if (s.park) acts.append(mkBtn("Ir en coche", () => window.open(carUrl(s.park.lat, s.park.lon), "_blank"), "primary small"));
    acts.append(mkBtn("Guiarme a pie", () => startGuide(s.lat, s.lon, "Punto " + (i + 1)), "small"));
    acts.append(mkBtn("Ver", () => { map.flyTo([s.lat, s.lon], 16); showSpotPopup(i); }, "small"));
    ol.append(li);
  });
}
function mkBtn(txt, fn, cls) { const b = document.createElement("button"); b.type = "button"; b.className = "btn " + (cls || ""); b.textContent = txt; b.onclick = fn; return b; }
function showSpotPopup(i) {
  const s = App.analysis.spots[i]; const div = document.createElement("div"); div.className = "pop";
  div.innerHTML = "<b>Punto " + (i + 1) + " · " + ABS_NAMES[s.level] + " (índice " + fmt(s.score) + ")</b><div>" + esc(spotLine(s)) + "</div><dl><dt>Altitud</dt><dd>" + fmt(s.z) + " m</dd><dt>Bosque</dt><dd>" + fmt(s.tree * 100) + " % arbolado, " + fmtDist(s.edge) + " dentro</dd></dl><div class=\"acts\"></div>";
  const acts = div.querySelector(".acts");
  if (s.park) acts.append(mkBtn("Ir en coche", () => window.open(carUrl(s.park.lat, s.park.lon), "_blank"), "primary"));
  acts.append(mkBtn("Guiarme a pie", () => { map.closePopup(); startGuide(s.lat, s.lon, "Punto " + (i + 1)); }));
  L.popup({ maxWidth: 290 }).setLatLng([s.lat, s.lon]).setContent(div).openOn(map);
}

/* ---------- Tocar el mapa ---------- */
map.on("click", e => {
  if (!App.scores) return;
  const ci = cellInfo(e.latlng.lat, e.latlng.lng); const div = document.createElement("div"); div.className = "pop";
  if (!ci) { div.textContent = "Fuera del Bages."; }
  else {
    const d = dirIdx(ci.aspect);
    div.innerHTML = "<b>" + (ci.v > 0 ? ABS_NAMES[ci.level] + " · índice " + fmt(ci.v) + " de 100" : "Sin bosque o terreno no apto") + "</b>" + (ci.v > 0 ? "<div>" + ["", "Entre el 25 % mejor del Bages hoy", "Entre el 10 % mejor del Bages hoy", "Entre el 3 % mejor del Bages hoy"][ci.rel] + "</div>" : "") + "<dl><dt>Terreno</dt><dd>" + (ci.slope < 6 ? "llano" : ci.slope < 12 ? "suave" : "inclinado") + " (" + fmt(ci.slope) + "°)" + (ci.slope >= 4 ? ", mira al " + DIRL[d] : "") + "</dd><dt>Altitud</dt><dd>" + fmt(ci.z) + " m</dd><dt>Bosque</dt><dd>" + fmt(ci.tree * 100) + " % arbolado" + (ci.edge > 0 ? ", " + fmtDist(ci.edge) + " dentro" : "") + "</dd></dl><div class=\"acts\"></div>";
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
  if (App.ways) { const segs = App.ways.ways.filter(w => isDrivable(w.tags || {})).map(w => w.geometry); if (segs.length) { const p = nearestOnSegmentsApp(lat, lon, segs); if (p && p.dist < 2000) park = p; } }
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
function startGuide(lat, lon, label) {
  App.guide = { lat, lon, label }; $("#guide").hidden = false; startGPS(false); startCompass(); collapseSheet(); updateGuide();
}
function updateGuide() {
  const G = App.guide; if (!G) return;
  if (!App.me) { $("#gDist").textContent = "–"; $("#gInfo").textContent = G.label + " · buscando señal GPS…"; return; }
  const d = kmDist(App.me.lat, App.me.lon, G.lat, G.lon) * 1000, br = bearing(App.me, G);
  const rot = App.heading == null ? br : br - App.heading;
  $("#gArrow").style.transform = "rotate(" + rot + "deg)";
  $("#gDist").textContent = d < 20 ? "¡Aquí!" : fmtDist(d);
  $("#gInfo").textContent = G.label + " · al " + DIRL[dirIdx(br)] + " · " + Math.max(1, Math.round(d * 1.3 / 60)) + " min · " + (App.heading == null ? "flecha respecto al norte (sin brújula)" : "brújula activa") + " · GPS ±" + Math.round(App.me.acc) + " m";
  const pts = [[App.me.lat, App.me.lon], [G.lat, G.lon]];
  if (!guideLine) guideLine = L.polyline(pts, { color: "#b4531f", weight: 3, dashArray: "6 6", interactive: false }).addTo(map); else guideLine.setLatLngs(pts);
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
  const rows = Object.entries(App.summ).map(([c, m]) => { const rs = rainScore(m.rain, m.tmax, today, s); return "<tr><td>" + esc(STATIONS[c].n) + "</td><td>" + fmt(m.rain21, 0) + "</td><td>" + (m.lastRain ? m.lastRain.age + " d" : "–") + "</td><td>" + fmt(rs.R * 100) + "</td><td>" + fmt(m.tmin7, 1) + " / " + fmt(m.tmax7, 1) + "</td></tr>"; }).join("");
  $("#meteoTable").innerHTML = "<thead><tr><th>Estación</th><th>Lluvia 21 d (mm)</th><th>Última lluvia fuerte</th><th>Lluvia útil hoy</th><th>Mín / máx 7 d</th></tr></thead><tbody>" + rows + "</tbody>";
}

/* ---------- Diario ---------- */
const FIND_COL = { rovello: "#d2691e", llenega: "#333", fredolic: "#7a7a7a", camagroc: "#e0b000", molsa: "#c9a227", ceps: "#8b5a2b", otra: "#5b8def", nada: "#bbb" };
const FIND_N = { rovello: "Rovelló", llenega: "Llenega negra", fredolic: "Fredolic", camagroc: "Camagroc", molsa: "Molsa", ceps: "Cep", otra: "Otra", nada: "Nada" };
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
  const data = JSON.stringify({ app: "Bolets Bages", exported: new Date().toISOString(), diary: App.diary }, null, 1);
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

/* ---------- Ajustes ---------- */
const SL = {
  flat: v => v < .15 ? "da igual" : v < .5 ? "algo" : v < .85 ? "bastante" : "mucho",
  interior: v => v == 0 ? "da igual" : "pleno a " + v + " m del borde",
  pathMin: v => v == 0 ? "da igual" : "mejor a más de " + v + " m",
  walkMax: v => fmtDist(v), shade: v => fmt(v * 100) + " %", hollow: v => fmt(v * 100) + " %",
  minLevel: v => ["", "25 % mejor", "10 % mejor", "3 % mejor"][v], opacity: v => fmt(v * 100) + " %"
};
const HEAVY = new Set(["flat", "interior", "shade", "hollow"]);
let rcT = null;
function bindPrefs() {
  for (const k of Object.keys(SL)) {
    const el = $("#" + k); el.value = App.prefs[k]; $("#" + k + "V").textContent = SL[k](+el.value);
    el.oninput = () => {
      App.prefs[k] = +el.value; $("#" + k + "V").textContent = SL[k](+el.value); LS.set("bb.prefs", App.prefs);
      if (k === "opacity") { if (overlay) overlay.setOpacity(App.prefs.opacity); return; }
      clearTimeout(rcT);
      rcT = setTimeout(() => { if (HEAVY.has(k)) recompute(); else if (k === "minLevel") renderOverlay(); else if (App.ways) runAnalysis(false); }, 300);
    };
  }
  const kd = $("#kids"); kd.checked = !!App.prefs.kids;
  kd.onchange = () => {
    App.prefs.kids = kd.checked;
    if (kd.checked) { App.prefs.walkMax = Math.min(App.prefs.walkMax, 300); App.prefs.pathMin = Math.min(App.prefs.pathMin, 30); }
    LS.set("bb.prefs", App.prefs); bindPrefs(); recompute();
  };
}
$("#resetPrefs").onclick = () => { const sp = App.prefs.sp; App.prefs = Object.assign({}, DEFAULT_PREFS, { sp }); LS.set("bb.prefs", App.prefs); bindPrefs(); if (overlay) overlay.setOpacity(App.prefs.opacity); recompute(); toast("Ajustes por defecto"); };
$("#refreshMeteo").onclick = async () => { await loadMeteo(true); summarize(); recompute(); meteoStatus(); renderMeteoTable(); toast("Meteo actualizada"); };

/* ---------- Especie ---------- */
function renderSpMenu() {
  const m = $("#spMenu"); m.innerHTML = "";
  for (const [k, s] of Object.entries(SPECIES)) {
    const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", k === App.prefs.sp);
    b.innerHTML = esc(s.n) + "<small>" + esc(s.lat) + "</small>";
    b.onclick = () => { App.prefs.sp = k; LS.set("bb.prefs", App.prefs); $("#spName").textContent = s.n; m.hidden = true; recompute(); renderSpotList(); if (!$("#p-dias").hidden) loadForecast(); };
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
}
function collapseSheet() { sheet.classList.add("collapsed"); }
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  const open = !sheet.classList.contains("collapsed"), cur = b.getAttribute("aria-selected") === "true";
  if (open && cur) collapseSheet(); else openSheet(b.dataset.tab);
});
$("#grab").onclick = () => sheet.classList.contains("collapsed") ? openSheet(document.querySelector('.tabs [aria-selected="true"]').dataset.tab) : collapseSheet();
$("#analyzeBtn").onclick = analyze;

/* ---------- Arranque ---------- */
window.addEventListener("error", e => console.warn(e.message));
(async function init() {
  $("#version").textContent = "Versión " + VERSION;
  $("#spName").textContent = SPECIES[App.prefs.sp].n;
  bindPrefs(); renderDiary(); renderSpotList();
  if (LS.get("bb.gpsOk", false)) startGPS(false);
  try {
    await Promise.all([loadGrid(), loadMeteo(false)]);
    summarize(); recompute(); meteoStatus(); drawSpots();
    map.on("moveend", () => { if (App.summ) meteoStatus(); });
  } catch (e) { console.error(e); setStatus("Error al cargar los datos: " + e.message, "err"); }
  if ("serviceWorker" in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch(() => { });
    let reloading = false; navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloading || !hadController) return; reloading = true; toast("App actualizada", 2000); setTimeout(() => location.reload(), 800); });
  }
})();
