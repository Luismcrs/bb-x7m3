/* Bolets Bages · motor del modelo (se ejecuta en el móvil)
   Probabilidad de cada celda de ~30 m = meteo × tipo de bosque × factores del terreno. */
"use strict";

const STATIONS = {
  CL: { n: "Sant Salvador de Guardiola", lat: 41.67403, lon: 1.76797, alt: 347 },
  MQ: { n: "Cardona", lat: 41.92044, lon: 1.69586, alt: 402 },
  U4: { n: "Castellnou de Bages", lat: 41.83094, lon: 1.84699, alt: 507 },
  WN: { n: "Montserrat – Sant Dimes", lat: 41.59539, lon: 1.8375, alt: 918 },
  WW: { n: "Artés", lat: 41.79424, lon: 1.93683, alt: 287 },
  VP: { n: "Pinós", lat: 41.80483, lon: 1.53853, alt: 660 },
  MW: { n: "Navès", lat: 42.00707, lon: 1.65239, alt: 549 },
  H1: { n: "Òdena", lat: 41.5864, lon: 1.65308, alt: 333 },
  VU: { n: "Rellinars", lat: 41.63285, lon: 1.91718, alt: 429 },
  VV: { n: "Sant Llorenç Savall", lat: 41.68136, lon: 2.02655, alt: 530 },
  CY: { n: "Muntanyola", lat: 41.8781, lon: 2.17875, alt: 816 },
  XT: { n: "Solsona", lat: 41.98762, lon: 1.51159, alt: 692 },
  CR: { n: "la Quar", lat: 42.08032, lon: 1.96244, alt: 872 },
  V5: { n: "Perafita", lat: 42.03947, lon: 2.11993, alt: 777 },
  D2: { n: "Vacarisses", lat: 41.59251, lon: 1.91499, alt: 343 }
};

const SPECIES = {
  rovello:  { n: "Rovelló",       lat: "Lactarius sanguifluus", aff: { pb: 1, pn: .9, ps: .8, al: .1, ro: .1 },  tmin: [5, 14], tmax: [13, 23], season: ["09-15", "10-10", "11-20", "12-20"], rainMin: 15, rainFull: 70, asp: 0,   hollow: .5 },
  llenega:  { n: "Llenega negra", lat: "Hygrophorus latitatus", aff: { pb: .8, pn: 1, ps: .9, al: .2, ro: .2 },  tmin: [2, 12], tmax: [10, 20], season: ["10-01", "10-25", "12-10", "01-15"], rainMin: 15, rainFull: 70, asp: .05, hollow: .6 },
  fredolic: { n: "Fredolic",      lat: "Tricholoma terreum",    aff: { pb: .7, pn: 1, ps: 1, al: .4, ro: .5 },  tmin: [2, 11], tmax: [9, 19],  season: ["10-10", "11-01", "12-15", "01-31"], rainMin: 15, rainFull: 65, asp: 0,   hollow: .5 },
  camagroc: { n: "Camagroc",      lat: "Craterellus lutescens", aff: { pb: .55, pn: .8, ps: 1, al: .65, ro: .6 }, tmin: [3, 12], tmax: [9, 20],  season: ["10-05", "10-30", "01-10", "02-15"], rainMin: 25, rainFull: 90, asp: .15, hollow: 1 }
};

const DEFAULT_PREFS = { sp: "rovello", flat: 0.7, interior: 90, shade: 1, hollow: 1, pathMin: 60, walkMax: 600, minLevel: 1, opacity: 0.7, kids: false };

// La lluvia pesa según los días que hace que cayó: máximo entre 10 y 18 días.
const LAGX = [0, 5, 10, 18, 24, 30], LAGY = [.1, .35, 1, 1, .6, 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}
const lagW = age => age < 0 ? 0 : interp(age, LAGX, LAGY);
const dayKey = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const parseDay = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((parseDay(dayKey(b)) - parseDay(dayKey(a))) / 86400000);
function mdToDay(md) { const [m, d] = md.split("-").map(Number); const y = m >= 9 ? 2001 : 2002; return Math.round((new Date(y, m - 1, d) - new Date(2001, 8, 1)) / 86400000); }
function seasonF(s, date) {
  const y = date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
  const t = Math.round((parseDay(dayKey(date)) - new Date(y, 8, 1)) / 86400000);
  const [a, b, c, e] = s.season.map(mdToDay);
  if (t < a || t > e) return .05; if (t < b) return .35 + .65 * (t - a) / (b - a); if (t <= c) return 1; return .35 + .65 * (e - t) / (e - c);
}
const band = (v, lo, hi, m = 6) => { const d = v < lo ? lo - v : v > hi ? v - hi : 0; return clamp(1 - d / m * .8, .2, 1); };
const kmDist = (la1, lo1, la2, lo2) => Math.hypot((la1 - la2) * 111.32, (lo1 - lo2) * 111.32 * Math.cos(41.78 * Math.PI / 180));

/* ---------- Meteo por estación ----------
   raw = { stations: { CL: { rain: {"2026-10-18": 11, ...}, tmin: {...}, tmax: {...} }, ... } }
   o bien (copia de seguridad) rain + tmin7/tmax7 ya agregados. */
function stationSummary(st, target, extraRain) {
  const rain = Object.assign({}, st.rain || {}, extraRain || {});
  let reff = 0, rain7 = 0, dry = 99, last = null;
  const keys = Object.keys(rain).sort();
  for (const k of keys) {
    const age = daysBetween(parseDay(k), target); const v = +rain[k] || 0;
    if (age < 0) continue;
    reff += v * lagW(age); if (age <= 6) rain7 += v;
    if (v >= 2 && age < dry) dry = age;
  }
  // último episodio de lluvia de al menos 10 mm (días seguidos)
  for (let i = keys.length - 1; i >= 0; i--) {
    const age = daysBetween(parseDay(keys[i]), target); if (age < 0) continue;
    if ((+rain[keys[i]] || 0) < 1) continue;
    let j = i, mm = 0; while (j >= 0 && (+rain[keys[j]] || 0) >= 1) { mm += +rain[keys[j]]; j--; }
    if (mm >= 10) { last = { age, mm: Math.round(mm), date: keys[i] }; break; } i = j;
  }
  let tmin7 = st.tmin7, tmax7 = st.tmax7;
  if (st.tmin && Object.keys(st.tmin).length) {
    // últimos 7 días completos (el de hoy aún no tiene su máxima)
    const tk = Object.keys(st.tmin).filter(k => { const a = daysBetween(parseDay(k), target); return a >= 1 && a <= 7; });
    if (tk.length) { tmin7 = tk.reduce((s, k) => s + st.tmin[k], 0) / tk.length; tmax7 = tk.reduce((s, k) => s + (st.tmax[k] ?? st.tmin[k]), 0) / tk.length; }
  }
  return { reff, rain7, dryDays: dry, lastRain: last, tmin7, tmax7, rain21: keys.filter(k => { const a = daysBetween(parseDay(k), target); return a >= 0 && a <= 20; }).reduce((s, k) => s + (+rain[k] || 0), 0) };
}

/* Meteo interpolada en un punto (IDW potencia 2). Las temperaturas se llevan a nivel del mar (−0,6 °C/100 m). */
function meteoAt(lat, lon, summ) {
  let w = 0, acc = { reff: 0, rain7: 0, t0min: 0, t0max: 0 }, near = null, nd = 1e9, wt = 0;
  for (const [k, st] of Object.entries(STATIONS)) {
    const m = summ[k]; if (!m) continue;
    const d = Math.max(kmDist(lat, lon, st.lat, st.lon), 1.5), wi = 1 / (d * d);
    if (d < nd) { nd = d; near = k; }
    acc.reff += wi * m.reff; acc.rain7 += wi * m.rain7; w += wi;
    if (m.tmin7 != null && m.tmax7 != null) { acc.t0min += wi * (m.tmin7 + .006 * st.alt); acc.t0max += wi * (m.tmax7 + .006 * st.alt); wt += wi; }
  }
  if (!w) return null;
  return { reff: acc.reff / w, rain7: acc.rain7 / w, t0min: wt ? acc.t0min / wt : 16, t0max: wt ? acc.t0max / wt : 24, near, nearKm: nd, dryDays: summ[near].dryDays, lastRain: summ[near].lastRain };
}
function forestMix(lat, lon, zones) {
  const mix = { pb: 0, pn: 0, ps: 0, al: 0, ro: 0 }; let w = 0;
  for (const z of zones) { const d = Math.max(kmDist(lat, lon, z.lat, z.lon), 1), wi = 1 / (d * d); w += wi; for (const t in mix) mix[t] += wi * (z.f[t] || 0); }
  for (const t in mix) mix[t] /= w; return mix;
}
// Factores de meteo para una especie en un punto (sin el terreno)
function meteoFactors(s, m, alt, date) {
  const R = clamp((m.reff - s.rainMin) / (s.rainFull - s.rainMin), .05, 1);
  const tmin = m.t0min - .006 * alt, tmax = m.t0max - .006 * alt;
  let D = 1, a;
  if (m.rain7 < 3) D = tmax > 24 ? .7 : tmax > 20 ? .82 : .92;
  if (tmin < 4) a = -.25;
  else if (m.rain7 < 3 && tmax > 20) a = .35;
  else if (m.rain7 < 3) a = .25;
  else if (m.dryDays >= 4 && tmax > 17) { a = .25; D = .92; }
  else a = .12;
  let T = (band(tmin, ...s.tmin) + band(tmax, ...s.tmax)) / 2; if (tmin < 0) T *= .4;
  return { R, D, T, a: a + s.asp, S: seasonF(s, date), tmin, tmax };
}

/* ---------- Rejilla ---------- */
class Grid {
  // Se guarda en formato compacto (7 bytes por celda) para no agotar la memoria del móvil.
  constructor(meta, terrain, forest, elev) {
    Object.assign(this, meta); const n = meta.W * meta.H; this.n = n;
    this.sl4 = new Uint8Array(n); this.asp = new Uint8Array(n); this.tpi8 = new Int8Array(n);
    this.tr8 = new Uint8Array(n); this.ed4 = new Uint8Array(n); this.flags = new Uint8Array(n); this.zz = new Uint16Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      this.sl4[i] = terrain[p]; this.asp[i] = terrain[p + 1]; this.tpi8[i] = terrain[p + 2] - 128;
      this.tr8[i] = forest[p]; this.ed4[i] = forest[p + 1]; this.flags[i] = Math.round(forest[p + 2] / 80);
      this.zz[i] = elev[p] * 256 + elev[p + 1];
    }
    this.cosAsp = new Float32Array(256); for (let a = 0; a < 256; a++) this.cosAsp[a] = Math.cos(a / 255 * 2 * Math.PI);
  }
  slope(k) { return this.sl4[k] / 4; } aspect(k) { return this.asp[k] / 255 * 360; } tpi(k) { return this.tpi8[k]; }
  tree(k) { return this.tr8[k] / 255; } edge(k) { return this.ed4[k] * 4; } z(k) { return this.zz[k]; }
  inb(k) { return this.flags[k] & 1; } built(k) { return (this.flags[k] & 2) ? 1 : 0; }
  latOf(i) { return this.lat0 + (i + .5) * this.dlat; }
  lonOf(j) { return this.lon0 + (j + .5) * this.dlon; }
  rowOf(lat) { return Math.floor((lat - this.lat0) / this.dlat); }
  colOf(lon) { return Math.floor((lon - this.lon0) / this.dlon); }
  idx(lat, lon) { const i = this.rowOf(lat), j = this.colOf(lon); return (i < 0 || j < 0 || i >= this.H || j >= this.W) ? -1 : i * this.W + j; }
}

/* Índice 0–100 de toda la rejilla para una especie, fecha y preferencias. */
function computeScores(grid, summ, prefs, date) {
  const s = SPECIES[prefs.sp], W = grid.W, H = grid.H, BS = 16;
  const out = new Float32Array(grid.n).fill(NaN);
  const flat = prefs.kids ? 1 : prefs.flat, inter = prefs.interior, shade = prefs.shade, hol = prefs.hollow * s.hollow;
  const SLX = [0, 6, 12, 18, 25, 35, 90], SLY = [1, 1, .9, .72, .5, .3, .2];
  for (let bi = 0; bi < H; bi += BS) for (let bj = 0; bj < W; bj += BS) {
    const la = grid.latOf(Math.min(H - 1, bi + BS / 2)), lo = grid.lonOf(Math.min(W - 1, bj + BS / 2));
    const m = meteoAt(la, lo, summ); if (!m) continue;
    const mix = forestMix(la, lo, grid.zones); let Hf = 0; for (const t in mix) Hf += mix[t] * (s.aff[t] || 0);
    const S = seasonF(s, date), R = clamp((m.reff - s.rainMin) / (s.rainFull - s.rainMin), .05, 1);
    for (let i = bi; i < Math.min(H, bi + BS); i++) for (let j = bj; j < Math.min(W, bj + BS); j++) {
      const k = i * W + j, fl = grid.flags[k]; if (!(fl & 1)) continue;
      if (fl & 2) { out[k] = 0; continue; }
      const Ff = clamp((grid.tr8[k] / 255 - .35) / .45, 0, 1); if (Ff <= 0) { out[k] = 0; continue; }
      const z = grid.zz[k], tmin = m.t0min - .006 * z, tmax = m.t0max - .006 * z;
      let D = 1, a;
      if (m.rain7 < 3) D = tmax > 24 ? .7 : tmax > 20 ? .82 : .92;
      if (tmin < 4) a = -.25; else if (m.rain7 < 3 && tmax > 20) a = .35; else if (m.rain7 < 3) a = .25;
      else if (m.dryDays >= 4 && tmax > 17) { a = .25; D = .92; } else a = .12;
      a += s.asp;
      let T = (band(tmin, s.tmin[0], s.tmin[1]) + band(tmax, s.tmax[0], s.tmax[1])) / 2; if (tmin < 0) T *= .4;
      const sl = grid.sl4[k] / 4;
      let Sl = 1 - flat * (1 - interp(sl, SLX, SLY)); if (prefs.kids && sl > 20) Sl *= .5;
      const I = inter > 0 ? .5 + .5 * clamp(grid.ed4[k] * 4 / inter, 0, 1) : 1;
      const A = 1 + a * shade * grid.cosAsp[grid.asp[k]] * Math.min(1, sl / 10);
      const Wh = 1 + clamp(-grid.tpi8[k] / 20, -.3, .3) * hol;
      out[k] = clamp(100 * Hf * S * R * D * T * Ff * I * Sl * A * Wh / 1.15, 0, 100);
    }
  }
  return out;
}
// Umbrales relativos: 25 %, 10 % y 3 % mejor del bosque del Bages
function thresholds(grid, sc) {
  const hist = new Uint32Array(1001); let tot = 0;
  for (let k = 0; k < grid.n; k++) { const v = sc[k]; if (v > 0) { hist[Math.min(1000, Math.round(v * 10))]++; tot++; } }
  const q = p => { let c = 0, lim = tot * (1 - p); for (let i = 0; i <= 1000; i++) { c += hist[i]; if (c >= lim) return i / 10; } return 100; };
  return { t1: q(.25), t2: q(.10), t3: q(.03), max: (() => { for (let i = 1000; i >= 0; i--) if (hist[i]) return i / 10; return 0; })() };
}
const levelOf = (v, th) => v >= th.t3 ? 3 : v >= th.t2 ? 2 : v >= th.t1 ? 1 : 0;
const LEVEL_NAMES = ["Baja", "Media", "Alta", "Muy alta"];

/* ---------- Análisis de una ventana con caminos reales (OpenStreetMap vía Overpass) ---------- */
const NO_CAR = /^(no|private|forestry|agricultural|delivery|customers|permit)$/;
function isDrivable(t) {
  const h = t.highway || "";
  if (!/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|road)(_link)?$/.test(h)) return false;
  for (const k of ["access", "motor_vehicle", "motorcar", "vehicle"]) if (t[k] && NO_CAR.test(t[k])) return false;
  if (h === "track" && /grade[45]/.test(t.tracktype || "")) return false;
  return true;
}
// Distancia aproximada (chamfer 3-4) en metros desde celdas marcadas
function chamfer(mask, w, h, dx, dy) {
  const INF = 1e9, d = new Float32Array(w * h); const dd = Math.hypot(dx, dy);
  for (let k = 0; k < w * h; k++) d[k] = mask[k] ? 0 : INF;
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { const k = i * w + j; let v = d[k];
    if (j > 0) v = Math.min(v, d[k - 1] + dx); if (i > 0) { v = Math.min(v, d[k - w] + dy); if (j > 0) v = Math.min(v, d[k - w - 1] + dd); if (j < w - 1) v = Math.min(v, d[k - w + 1] + dd); } d[k] = v; }
  for (let i = h - 1; i >= 0; i--) for (let j = w - 1; j >= 0; j--) { const k = i * w + j; let v = d[k];
    if (j < w - 1) v = Math.min(v, d[k + 1] + dx); if (i < h - 1) { v = Math.min(v, d[k + w] + dy); if (j < w - 1) v = Math.min(v, d[k + w + 1] + dd); if (j > 0) v = Math.min(v, d[k + w - 1] + dd); } d[k] = v; }
  return d;
}
function nearestOnSegments(lat, lon, segs) {
  const cx = Math.cos(lat * Math.PI / 180) * 111320, cy = 110540; let best = null, bd = 1e12;
  for (const g of segs) for (let i = 1; i < g.length; i++) {
    const ax = (g[i - 1].lon - lon) * cx, ay = (g[i - 1].lat - lat) * cy, bx = (g[i].lon - lon) * cx, by = (g[i].lat - lat) * cy;
    const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy; const t = L ? clamp(-(ax * vx + ay * vy) / L, 0, 1) : 0;
    const px = ax + t * vx, py = ay + t * vy, d = px * px + py * py;
    if (d < bd) { bd = d; best = { lat: lat + py / cy, lon: lon + px / cx, dist: Math.sqrt(d) }; }
  }
  return best;
}
/* ways: elementos 'way' de Overpass con geometry y tags. Devuelve puntos ordenados. */
function analyzeWindow(grid, sc, th, bbox, ways, prefs, me) {
  const i0 = clamp(grid.rowOf(bbox.n), 0, grid.H - 1), i1 = clamp(grid.rowOf(bbox.s), 0, grid.H - 1);
  const j0 = clamp(grid.colOf(bbox.w), 0, grid.W - 1), j1 = clamp(grid.colOf(bbox.e), 0, grid.W - 1);
  const w = j1 - j0 + 1, h = i1 - i0 + 1; const dx = Math.abs(grid.dlon) * 111320 * Math.cos(41.78 * Math.PI / 180), dy = Math.abs(grid.dlat) * 111320;
  const allM = new Uint8Array(w * h), carM = new Uint8Array(w * h); const carSegs = [];
  const mark = (M, la1, lo1, la2, lo2) => { // Bresenham sobre la ventana
    let y0 = grid.rowOf(la1) - i0, x0 = grid.colOf(lo1) - j0; const y1 = grid.rowOf(la2) - i0, x1 = grid.colOf(lo2) - j0;
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let ex = Math.abs(x1 - x0), ey = -Math.abs(y1 - y0), err = ex + ey, guard = 0;
    while (guard++ < 20000) { if (x0 >= 0 && y0 >= 0 && x0 < w && y0 < h) M[y0 * w + x0] = 1; if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= ey) { err += ey; x0 += sx; } if (e2 <= ex) { err += ex; y0 += sy; } }
  };
  for (const wy of ways) {
    const g = wy.geometry; if (!g || g.length < 2) continue; const car = isDrivable(wy.tags || {});
    for (let i = 1; i < g.length; i++) { mark(allM, g[i - 1].lat, g[i - 1].lon, g[i].lat, g[i].lon); if (car) mark(carM, g[i - 1].lat, g[i - 1].lon, g[i].lat, g[i].lon); }
    if (car) carSegs.push(g);
  }
  const dPath = chamfer(allM, w, h, dx, dy), dCar = chamfer(carM, w, h, dx, dy);
  const adj = new Float32Array(w * h);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
    const k = (i0 + i) * grid.W + (j0 + j), q = i * w + j, v = sc[k]; if (!(v > 0)) continue;
    const walk = dCar[q] * 1.3; if (walk > prefs.walkMax) continue;
    const pf = prefs.pathMin > 0 ? .6 + .4 * clamp(dPath[q] / prefs.pathMin, 0, 1) : 1;
    adj[q] = v * pf;
  }
  // suavizado 3×3 y máximos locales separados ≥ 300 m
  const sm = new Float32Array(w * h);
  for (let i = 1; i < h - 1; i++) for (let j = 1; j < w - 1; j++) { let s = 0, c = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const v = adj[(i + a) * w + j + b]; if (v > 0) { s += v; c++; } } sm[i * w + j] = c >= 6 ? s / 9 : 0; }
  const cand = []; for (let q = 0; q < w * h; q++) if (sm[q] > 0) cand.push(q);
  cand.sort((a, b) => sm[b] - sm[a]);
  const picks = [], sep = 300;
  for (const q of cand) {
    const i = Math.floor(q / w), j = q % w;
    if (picks.every(p => Math.hypot((p.i - i) * dy, (p.j - j) * dx) >= sep)) { picks.push({ q, i, j }); if (picks.length >= 15) break; }
  }
  return {
    window: { i0, j0, w, h }, nWays: ways.length, nCar: carSegs.length,
    spots: picks.map(p => {
      const k = (i0 + p.i) * grid.W + (j0 + p.j), lat = grid.latOf(i0 + p.i), lon = grid.lonOf(j0 + p.j);
      const park = carSegs.length ? nearestOnSegments(lat, lon, carSegs) : null;
      return { lat, lon, score: sc[k], adj: sm[p.q], level: levelOf(sc[k], th), slope: grid.slope(k), aspect: grid.aspect(k), z: grid.z(k), edge: grid.edge(k), tree: grid.tree(k),
        dPath: Math.round(dPath[p.q]), walk: park ? Math.round(park.dist * 1.3) : null, park, fromMe: me ? kmDist(me.lat, me.lon, lat, lon) : null };
    })
  };
}

if (typeof module !== "undefined") module.exports = { STATIONS, SPECIES, DEFAULT_PREFS, lagW, seasonF, stationSummary, meteoAt, meteoFactors, forestMix, Grid, computeScores, thresholds, levelOf, LEVEL_NAMES, analyzeWindow, isDrivable, dayKey, parseDay, daysBetween, kmDist };
