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

/* cov: afinidad con cada tipo de bosque del mapa de cubiertas del ICGC (pinar denso, pinar claro, frondosas o esclerófilas densas,
   bosque claro o de ribera, matorral). lc: peso de cada clase de 10 m al validar un punto (1 pinar denso, 2 pinar claro,
   3 frondosas densas, 4 bosque claro). aff: afinidad con cada especie de pino de la zona (afina dentro del pinar). */
const SPECIES = {
  rovello:  { n: "Rovelló",       lat: "Lactarius sanguifluus", aff: { pb: 1, pn: .9, ps: .8, al: .1, ro: .1 },  cov: { dp: 1, sp: .55, db: .12, sb: .1, sc: .12 },  lc: [0, 1, .5, 0, 0],   tmin: [5, 14], tmax: [13, 23], season: ["09-15", "10-10", "11-20", "12-20"], rainMin: 15, rainFull: 70, asp: 0,   hollow: .5 },
  pinetell: { n: "Pinetell",      lat: "Lactarius deliciosus",  aff: { pb: .7, pn: .9, ps: 1, al: .1, ro: .1 },   cov: { dp: 1, sp: .55, db: .12, sb: .1, sc: .12 },  lc: [0, 1, .5, 0, 0],   tmin: [4, 13], tmax: [11, 21], season: ["09-10", "10-05", "11-20", "12-15"], rainMin: 15, rainFull: 70, asp: .03, hollow: .5 },
  llenega:  { n: "Llenega negra", lat: "Hygrophorus latitatus", aff: { pb: .8, pn: 1, ps: .9, al: .2, ro: .2 },  cov: { dp: 1, sp: .5, db: .25, sb: .15, sc: .1 },   lc: [0, 1, .5, .2, 0],  tmin: [2, 12], tmax: [10, 20], season: ["10-01", "10-25", "12-10", "01-15"], rainMin: 15, rainFull: 70, asp: .05, hollow: .6 },
  fredolic: { n: "Fredolic",      lat: "Tricholoma terreum",    aff: { pb: .7, pn: 1, ps: 1, al: .4, ro: .5 },  cov: { dp: 1, sp: .6, db: .5, sb: .35, sc: .2 },    lc: [0, 1, .5, .7, .4], tmin: [2, 11], tmax: [9, 19],  season: ["10-10", "11-01", "12-15", "01-31"], rainMin: 15, rainFull: 65, asp: 0,   hollow: .5 },
  camagroc: { n: "Camagroc",      lat: "Craterellus lutescens", aff: { pb: .55, pn: .8, ps: 1, al: .65, ro: .6 }, cov: { dp: .85, sp: .4, db: .85, sb: .45, sc: .15 }, lc: [0, 1, .5, 1, .5], tmin: [3, 12], tmax: [9, 20],  season: ["10-05", "10-30", "01-10", "02-15"], rainMin: 25, rainFull: 90, asp: .15, hollow: 1, win: [0, 8, 12, 22, 30] }
};

const DEFAULT_PREFS = { sp: "rovello", flat: 0.7, interior: 90, shade: 1, hollow: 1, pathMin: 60, walkMax: 600, minLevel: 1, opacity: 0.7, kids: false, maxDrive: 45, carLevel: 2, dirtMax: 2000, climbMax: 100, avoidCrowd: false, minWalk: 300 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}
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

/* ---------- Lluvia: modelo por episodios ----------
   Cada episodio de lluvia (días seguidos con ≥1 mm, admitiendo un día seco en medio) da una salida de setas:
   - nada los primeros 7 días; plena entre los días 10 y 17 después de acabar; se apaga hacia el día 25;
   - cuanto más llueve, más potencial (rovelló: desde 15 mm, pleno a partir de ~56 mm);
   - si después vienen muchos días secos, la salida se malogra (más si hace calor): a partir del 5.º día seco
     resta un 15 % por día con máxima ≥22 °C, un 8 % entre 18 y 22 °C y un 4 % por debajo (mínimo, 30 %).
   No se suman episodios: cuenta el mejor, más un 30 % del segundo.
   Ajustado el 24-10-2026: tras ~70 mm entre el 29 sep y el 6 oct y 10 días secos, el 24 oct solo había molses. */
const WINX = [0, 7, 10, 17, 25], WINY = [0, 0, 1, 1, 0];
const addDaysM = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function rainScore(rain, tmax, target, s) {
  const keys = Object.keys(rain || {}).sort(); if (!keys.length) return { R: .05, best: null, events: [] };
  const start = parseDay(keys[0]), N = daysBetween(start, target); if (N < 0) return { R: .05, best: null, events: [] };
  const mm = new Float32Array(N + 1), tx = new Float32Array(N + 1).fill(NaN);
  for (const k of keys) { const i = daysBetween(start, parseDay(k)); if (i >= 0 && i <= N) mm[i] = +rain[k] || 0; }
  if (tmax) for (const k in tmax) { const i = daysBetween(start, parseDay(k)); if (i >= 0 && i <= N && tmax[k] != null) tx[i] = +tmax[k]; }
  const ev = []; let i = 0;
  while (i <= N) {
    if (mm[i] < 1) { i++; continue; }
    let tot = 0, end = i, j = i;
    while (j <= N) { if (mm[j] >= 1) { tot += mm[j]; end = j; j++; } else if (j + 1 <= N && mm[j + 1] >= 1) j++; else break; }
    ev.push({ end, tot }); i = j + 1;
  }
  const wx = s.win || WINX, span = (s.rainFull - s.rainMin) * .75, cs = [];
  for (const e of ev) {
    const P = clamp((e.tot - s.rainMin) / span, 0, 1); if (P <= 0) continue;
    const age = N - e.end, w = interp(age, wx, WINY); if (w <= 0) continue;
    let dry = 0, pen = 0;
    for (let d = e.end + 1; d <= Math.min(N, e.end + 10); d++) if (mm[d] < 1) { dry++; if (dry > 4) { const t = isNaN(tx[d]) ? 20 : tx[d]; pen += t >= 22 ? .15 : t >= 18 ? .08 : .04; } }
    const dd = clamp(1 - pen, .3, 1);
    cs.push({ c: P * w * dd, P, w, dryF: dd, mm: Math.round(e.tot), age, date: dayKey(addDaysM(start, e.end)) });
  }
  cs.sort((a, b) => b.c - a.c);
  const R = clamp((cs[0] ? cs[0].c : 0) + .3 * (cs[1] ? cs[1].c : 0), .05, 1);
  return { R, best: cs[0] || null, events: cs };
}
// Nivel absoluto del índice (no relativo): lo que se muestra en puntos y ventanas
const ABS = [[60, "Muy alta"], [45, "Alta"], [30, "Media"], [15, "Baja"], [0, "Muy baja"]];
const absLevel = v => { v = Math.round(v); for (let i = 0; i < ABS.length; i++) if (v >= ABS[i][0]) return 4 - i; return 0; };
const ABS_NAMES = ["Muy baja", "Baja", "Media", "Alta", "Muy alta"];

/* ---------- Meteo por estación ----------
   raw = { stations: { CL: { rain: {"2026-10-18": 11, ...}, tmin: {...}, tmax: {...} }, ... } }
   o bien (copia de seguridad) rain + tmin7/tmax7 ya agregados. */
function stationSummary(st, target, extraRain) {
  const rain = Object.assign({}, st.rain || {}, extraRain || {});
  let rain7 = 0, dry = 99, last = null;
  const keys = Object.keys(rain).sort();
  for (const k of keys) {
    const age = daysBetween(parseDay(k), target); const v = +rain[k] || 0;
    if (age < 0) continue;
    if (age <= 6) rain7 += v;
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
  return { rain, tmax: st.tmax || null, rain7, dryDays: dry, lastRain: last, tmin7, tmax7, rain21: keys.filter(k => { const a = daysBetween(parseDay(k), target); return a >= 0 && a <= 20; }).reduce((s, k) => s + (+rain[k] || 0), 0) };
}

/* Meteo interpolada en un punto (IDW potencia 2). Las temperaturas se llevan a nivel del mar (−0,6 °C/100 m). */
function meteoAt(lat, lon, summ, Rst) {
  let w = 0, acc = { R: 0, rain7: 0, t0min: 0, t0max: 0 }, near = null, nd = 1e9, wt = 0;
  for (const [k, st] of Object.entries(STATIONS)) {
    const m = summ[k]; if (!m) continue;
    const d = Math.max(kmDist(lat, lon, st.lat, st.lon), 1.5), wi = 1 / (d * d);
    if (d < nd) { nd = d; near = k; }
    acc.R += wi * (Rst && Rst[k] != null ? Rst[k] : 0); acc.rain7 += wi * m.rain7; w += wi;
    if (m.tmin7 != null && m.tmax7 != null) { acc.t0min += wi * (m.tmin7 + .006 * st.alt); acc.t0max += wi * (m.tmax7 + .006 * st.alt); wt += wi; }
  }
  if (!w) return null;
  return { R: acc.R / w, rain7: acc.rain7 / w, t0min: wt ? acc.t0min / wt : 16, t0max: wt ? acc.t0max / wt : 24, near, nearKm: nd, dryDays: summ[near].dryDays, lastRain: summ[near].lastRain };
}
function forestMix(lat, lon, zones) {
  const mix = { pb: 0, pn: 0, ps: 0, al: 0, ro: 0 }; let w = 0;
  for (const z of zones) { const d = Math.max(kmDist(lat, lon, z.lat, z.lon), 1), wi = 1 / (d * d); w += wi; for (const t in mix) mix[t] += wi * (z.f[t] || 0); }
  for (const t in mix) mix[t] /= w; return mix;
}
// Factores de meteo para una especie en un punto (sin el terreno)
function meteoFactors(s, m, alt, date) {
  const R = clamp(m.R, .05, 1);
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
  // Se guarda en formato compacto (unos 12 bytes por celda) para no agotar la memoria del móvil.
  // Se puede construir de golpe (pruebas) o capa a capa con setForest/setElev/setCover1/setCover2, para que el
  // móvil solo tenga una imagen descomprimida a la vez. Sin «terrain», la pendiente, la orientación y el TPI se
  // calculan aquí a partir de la altitud (ahorra 11 MB de descarga).
  constructor(meta, terrain, forest, elev, cover1, cover2) {
    Object.assign(this, meta); const n = meta.W * meta.H; this.n = n; this.hasCover = false;
    this.sl4 = new Uint8Array(n); this.asp = new Uint8Array(n); this.tpi8 = new Int8Array(n);
    this.tr8 = new Uint8Array(n); this.ed4 = new Uint8Array(n); this.flags = new Uint8Array(n); this.zz = new Uint16Array(n);
    this.cosAsp = new Float32Array(256); for (let a = 0; a < 256; a++) this.cosAsp[a] = Math.cos(a / 255 * 2 * Math.PI);
    if (forest) this.setForest(forest);
    if (elev) this.setElev(elev);
    if (cover1) this.setCover1(cover1);
    if (cover2) this.setCover2(cover2);
    if (terrain) this.setTerrain(terrain); else if (elev) this.computeTerrain();
  }
  setForest(f) { for (let i = 0, p = 0; i < this.n; i++, p += 4) { this.tr8[i] = f[p]; this.ed4[i] = f[p + 1]; this.flags[i] = Math.round(f[p + 2] / 80); } }
  setElev(e) { for (let i = 0, p = 0; i < this.n; i++, p += 4) this.zz[i] = e[p] * 256 + e[p + 1]; }
  setTerrain(t) { for (let i = 0, p = 0; i < this.n; i++, p += 4) { this.sl4[i] = t[p]; this.asp[i] = t[p + 1]; this.tpi8[i] = t[p + 2] - 128; } }
  setCover1(c) { const n = this.n; this.cdp = new Uint8Array(n); this.csp = new Uint8Array(n); this.cdb = new Uint8Array(n); for (let i = 0, p = 0; i < n; i++, p += 4) { this.cdp[i] = c[p]; this.csp[i] = c[p + 1]; this.cdb[i] = c[p + 2]; } this.hasCover = !!this.csb; }
  setCover2(c) { const n = this.n; this.csb = new Uint8Array(n); this.csc = new Uint8Array(n); for (let i = 0, p = 0; i < n; i++, p += 4) { this.csb[i] = c[p]; this.csc[i] = c[p + 1]; } this.hasCover = !!this.cdp; }
  /* Relieve desde la altitud, igual que se hacía antes en el ordenador:
     pendiente y orientación = gradiente central del modelo suavizado (gaussiana σ = 1 celda);
     TPI = altitud − media de un rectángulo de 25 × 33 celdas (~760 × 760 m). */
  computeTerrain() {
    const W = this.W, H = this.H, n = this.n, z = this.zz, dy = 111320 / 3600, dx = dy * Math.cos(41.78 * Math.PI / 180);
    const K = []; let ks = 0; for (let t = -4; t <= 4; t++) { const v = Math.exp(-t * t / 2); K.push(v); ks += v; } for (let t = 0; t < 9; t++) K[t] /= ks;
    const refl = (i, L) => { while (i < 0 || i >= L) i = i < 0 ? -i - 1 : 2 * L - i - 1; return i; };
    const tmp = new Float32Array(n), zs = new Float32Array(n), [k0, k1, k2, k3, k4] = [K[4], K[5], K[6], K[7], K[8]];
    for (let i = 0; i < H; i++) { // pasada horizontal (bordes con reflejo, interior sin comprobaciones)
      const o = i * W;
      for (let j = 0; j < W; j++) {
        if (j >= 4 && j < W - 4) { const q = o + j; tmp[q] = k0 * z[q] + k1 * (z[q - 1] + z[q + 1]) + k2 * (z[q - 2] + z[q + 2]) + k3 * (z[q - 3] + z[q + 3]) + k4 * (z[q - 4] + z[q + 4]); continue; }
        let v = 0; for (let t = -4; t <= 4; t++) v += K[t + 4] * z[o + refl(j + t, W)]; tmp[o + j] = v;
      }
    }
    for (let i = 0; i < H; i++) { // pasada vertical
      const o = i * W, inner = i >= 4 && i < H - 4, W2 = 2 * W, W3 = 3 * W, W4 = 4 * W;
      for (let j = 0; j < W; j++) {
        const q = o + j;
        if (inner) { zs[q] = k0 * tmp[q] + k1 * (tmp[q - W] + tmp[q + W]) + k2 * (tmp[q - W2] + tmp[q + W2]) + k3 * (tmp[q - W3] + tmp[q + W3]) + k4 * (tmp[q - W4] + tmp[q + W4]); continue; }
        let v = 0; for (let t = -4; t <= 4; t++) v += K[t + 4] * tmp[refl(i + t, H) * W + j]; zs[q] = v;
      }
    }
    const R2D = 180 / Math.PI;
    for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
      const k = i * W + j;
      const ddx = j === 0 ? zs[k + 1] - zs[k] : j === W - 1 ? zs[k] - zs[k - 1] : (zs[k + 1] - zs[k - 1]) / 2;
      const ddy = i === 0 ? zs[k + W] - zs[k] : i === H - 1 ? zs[k] - zs[k - W] : (zs[k + W] - zs[k - W]) / 2;
      const gx = ddx / dx, gy = -ddy / dy, sl = Math.atan(Math.sqrt(gx * gx + gy * gy)) * R2D;
      this.sl4[k] = sl >= 63.75 ? 255 : Math.round(sl * 4);
      let a = Math.atan2(-gx, -gy) * R2D; if (a < 0) a += 360;
      this.asp[k] = Math.round(a / 360 * 255) % 256;
    }
    // media móvil 25 × 33 con el borde repetido (como «nearest»)
    const RY = 12, RX = 16;
    for (let i = 0; i < H; i++) { const o = i * W; let s = 0; for (let t = -RX; t <= RX; t++) s += z[o + clamp(t, 0, W - 1)];
      for (let j = 0; j < W; j++) { tmp[o + j] = s; s += z[o + Math.min(W - 1, j + RX + 1)] - z[o + Math.max(0, j - RX)]; } }
    for (let j = 0; j < W; j++) { let s = 0; for (let t = -RY; t <= RY; t++) s += tmp[clamp(t, 0, H - 1) * W + j];
      for (let i = 0; i < H; i++) { const k = i * W + j; this.tpi8[k] = clamp(Math.round(z[k] - s / ((2 * RX + 1) * (2 * RY + 1))), -128, 127); s += tmp[Math.min(H - 1, i + RY + 1) * W + j] - tmp[Math.max(0, i - RY) * W + j]; } }
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
function computeScores(grid, summ, prefs, date, step = 1) {
  const s = SPECIES[prefs.sp], W = grid.W, H = grid.H, BS = 16;
  const out = new Float32Array(grid.n).fill(NaN);
  const Rst = {}; for (const k in summ) Rst[k] = rainScore(summ[k].rain, summ[k].tmax, date, s).R;
  const flat = prefs.kids ? 1 : prefs.flat, inter = prefs.interior, shade = prefs.shade, hol = prefs.hollow * s.hollow;
  const SLX = [0, 6, 12, 18, 25, 35, 90], SLY = [1, 1, .9, .72, .5, .3, .2];
  for (let bi = 0; bi < H; bi += BS) for (let bj = 0; bj < W; bj += BS) {
    const la = grid.latOf(Math.min(H - 1, bi + BS / 2)), lo = grid.lonOf(Math.min(W - 1, bj + BS / 2));
    const m = meteoAt(la, lo, summ, Rst); if (!m) continue;
    const mix = forestMix(la, lo, grid.zones); let Hf = 0; for (const t in mix) Hf += mix[t] * (s.aff[t] || 0);
    // dentro del pinar, la especie de pino de la zona afina un poco (pino carrasco, laricio, silvestre)
    const pw = mix.pb + mix.pn + mix.ps, pMod = pw > 0 ? (mix.pb * s.aff.pb + mix.pn * s.aff.pn + mix.ps * s.aff.ps) / pw : 1;
    const cv = s.cov, cdp = cv.dp * pMod / 255, csp = cv.sp * pMod / 255, cdb = cv.db / 255, csb = cv.sb / 255, csc = cv.sc / 255;
    const S = seasonF(s, date), R = clamp(m.R, .05, 1);
    for (let i = bi; i < Math.min(H, bi + BS); i++) for (let j = bj; j < Math.min(W, bj + BS); j++) {
      if (step > 1 && (i % step || j % step)) continue;
      const k = i * W + j, fl = grid.flags[k]; if (!(fl & 1)) continue;
      if (fl & 2) { out[k] = 0; continue; }
      // Bosque adecuado de verdad en la celda (mapa de cubiertas del ICGC, 1 m): un campo, un matorral o una franja de
      // árboles entre cultivos no puntúan. Pinar denso al 85 % o más = 1; por debajo del 25 % de bosque adecuado = 0.
      let Ff;
      if (grid.hasCover) { const Hc = grid.cdp[k] * cdp + grid.csp[k] * csp + grid.cdb[k] * cdb + grid.csb[k] * csb + grid.csc[k] * csc; Ff = clamp((Hc - .25) / .6, 0, 1); }
      else Ff = clamp((grid.tr8[k] / 255 - .35) / .45, 0, 1) * Hf;
      if (Ff <= 0) { out[k] = 0; continue; }
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
      out[k] = clamp(100 * S * R * D * T * Ff * I * Sl * A * Wh / 1.15, 0, 100);
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

/* ---------- Planificar la salida: ranking de municipios ----------
   muniArr: id de municipio por celda (0 = fuera). Devuelve, por municipio, el percentil 99 del índice
   (lo que vale lo mejor de la zona) y el mejor punto (máximo de la media 3×3 de la rejilla muestreada). */
function zoneRanking(grid, sc, muniArr, munis, step) {
  const W = grid.W, H = grid.H, vals = {}, best = {};
  for (let i = step; i < H - step; i += step) for (let j = step; j < W - step; j += step) {
    const k = i * W + j, v = sc[k], m = muniArr[k]; if (!m || !(v > 0)) continue;
    (vals[m] || (vals[m] = [])).push(v);
    let sum = 0, c = 0; for (let a = -step; a <= step; a += step) for (let b = -step; b <= step; b += step) { const u = sc[k + a * W + b]; if (u > 0) { sum += u; c++; } }
    const mv = c >= 6 ? sum / 9 : 0;
    if (!best[m] || mv > best[m].mv) best[m] = { mv, k, i, j };
  }
  const out = [];
  for (const mu of munis) {
    const v = vals[mu.id]; if (!v || v.length < 20 || !best[mu.id]) continue;
    v.sort((a, b) => a - b); const q = v[Math.min(v.length - 1, Math.floor(v.length * .99))]; // lo mejor de la zona
    const b = best[mu.id], k = b.k;
    out.push({ id: mu.id, n: mu.n, q, lat: grid.latOf(b.i), lon: grid.lonOf(b.j), slope: grid.slope(k), aspect: grid.aspect(k), edge: grid.edge(k), tree: grid.tree(k), z: grid.z(k), good: v.filter(x => x >= 30).length * step * step });
  }
  return out.sort((a, b) => b.q - a.q);
}
// Añade la previsión (desde mañana) a las series de cada estación: lluvia, mínima y máxima diarias
function extendStations(raw, fc, todayKey) {
  const st = {};
  for (const [c, s0] of Object.entries(raw.stations)) {
    const f = fc[c], s = { rain: Object.assign({}, s0.rain), tmin: Object.assign({}, s0.tmin || {}), tmax: Object.assign({}, s0.tmax || {}), tmin7: s0.tmin7, tmax7: s0.tmax7 };
    if (f) {
      const adj = -.006 * ((STATIONS[c] ? STATIONS[c].alt : 400) - (f.elevation ?? 400));
      f.daily.time.forEach((t, i) => { if (t > todayKey) { s.rain[t] = f.daily.precipitation_sum[i] || 0; s.tmin[t] = f.daily.temperature_2m_min[i] + adj; s.tmax[t] = f.daily.temperature_2m_max[i] + adj; } });
    }
    st[c] = s;
  }
  return Object.assign({}, raw, { stations: st });
}

/* ---------- Caminos: estado del firme y red accesible en coche (OpenStreetMap vía Overpass) ---------- */
const NO_CAR = /^(no|private|forestry|agricultural|delivery|customers|permit)$/;
const PAVED = /^(asphalt|concrete|paved|concrete:plates|concrete:lanes|paving_stones|sett|chipseal)$/;
const GOODU = /^(compacted|fine_gravel)$/;
const BADU = /^(ground|dirt|earth|grass|mud|sand|rock|rocks|pebblestone|woodchips|gravel_turf)$/;
const ROAD_CLASS = ["Asfalto", "Pista buena", "Pista normal", "Pista mala"];
const CAR_LEVELS = ["Solo asfalto", "Hasta pistas buenas", "Hasta pistas normales", "Cualquier pista (todoterreno)"];
// 0 asfalto · 1 pista buena · 2 pista normal o sin datos · 3 pista mala / 4×4 · −1 no apto o prohibido para coches
function roadClass(t) {
  const h = t.highway || "";
  if (!/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|road)(_link)?$/.test(h)) return -1;
  for (const k of ["access", "motor_vehicle", "motorcar", "vehicle"]) if (t[k] && NO_CAR.test(t[k])) return -1;
  const s = t.surface || "", sm = t.smoothness || "", tt = t.tracktype || "";
  if (t["4wd_only"] === "yes" || /^(very_bad|horrible|very_horrible|impassable)$/.test(sm) || /grade[45]/.test(tt) || BADU.test(s)) return 3;
  if (PAVED.test(s)) return 0;
  if (h !== "track") return /^(unpaved|gravel|compacted|fine_gravel)$/.test(s) ? (GOODU.test(s) ? 1 : 2) : 0;
  if (tt === "grade1" || GOODU.test(s) || /^(excellent|good|intermediate)$/.test(sm)) return 1;
  return 2;
}
const isDrivable = t => roadClass(t) >= 0;
// Clase efectiva con tu valoración: «bien» → pista buena, «al límite» → como pista mala, «no pasa» → cerrado
function effClass(w, ratings) {
  let c = roadClass(w.tags || {}); const r = ratings && ratings[w.id];
  if (c < 0) return c; if (r === "ok") return Math.min(c, 1); if (r === "limite") return 3; if (r === "no") return -1; return c;
}
/* Red de caminos que acepta tu coche y metros de tierra necesarios desde el asfalto más cercano (Dijkstra). */
function roadNetwork(ways, prefs) {
  const lvl = prefs.carLevel ?? 2, maxDirt = lvl === 0 ? 0 : (prefs.dirtMax ?? 2000), nodes = new Map(), segs = [];
  for (const w of ways) {
    const c = effClass(w, prefs.ratings); w._cls = c;
    if (c < 0 || c > lvl || !w.nodes || !w.geometry || w.nodes.length !== w.geometry.length) continue;
    for (let i = 0; i < w.nodes.length; i++) { const id = w.nodes[i]; let n = nodes.get(id); if (!n) { n = { lat: w.geometry[i].lat, lon: w.geometry[i].lon, adj: [], paved: false }; nodes.set(id, n); } if (c === 0) n.paved = true; }
    for (let i = 1; i < w.nodes.length; i++) {
      const a = w.nodes[i - 1], b = w.nodes[i], A = nodes.get(a), B = nodes.get(b), len = kmDist(A.lat, A.lon, B.lat, B.lon) * 1000, dirt = c === 0 ? 0 : len;
      A.adj.push([b, dirt]); B.adj.push([a, dirt]); segs.push({ a, b, c, way: w.id });
    }
  }
  const dist = new Map(), heap = [];
  const push = e => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const [id, n] of nodes) if (n.paved) { dist.set(id, 0); push([0, id]); }
  while (heap.length) {
    const [d, id] = pop(); if (d > (dist.get(id) ?? Infinity)) continue;
    for (const [nb, w] of nodes.get(id).adj) { const nd = d + w; if (nd <= maxDirt && nd < (dist.get(nb) ?? Infinity)) { dist.set(nb, nd); push([nd, nb]); } }
  }
  const reach = segs.filter(sg => dist.has(sg.a) && dist.has(sg.b));
  return { nodes, segs, reach, dist, maxDirt, hasPaved: [...nodes.values()].some(n => n.paved) };
}
// Punto de aparcamiento: el punto de la red accesible más cercano al sitio, con los metros de tierra para llegar
function nearestParking(lat, lon, net) {
  const cx = Math.cos(lat * Math.PI / 180) * 111320, cy = 110540; let best = null, bd = 1e12;
  for (const sg of net.reach) {
    const A = net.nodes.get(sg.a), B = net.nodes.get(sg.b);
    const ax = (A.lon - lon) * cx, ay = (A.lat - lat) * cy, bx = (B.lon - lon) * cx, by = (B.lat - lat) * cy;
    const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy, t = L ? clamp(-(ax * vx + ay * vy) / L, 0, 1) : 0;
    const px = ax + t * vx, py = ay + t * vy, d = px * px + py * py;
    if (d < bd) { bd = d; best = { lat: lat + py / cy, lon: lon + px / cx, dist: Math.sqrt(d), dirt: Math.round(net.dist.get(sg.a) * (1 - t) + net.dist.get(sg.b) * t), cls: sg.c, way: sg.way }; }
  }
  return best;
}
// Distancia aproximada (chamfer) en metros desde celdas marcadas
function chamfer(mask, w, h, dx, dy) {
  const INF = 1e9, d = new Float32Array(w * h); const dd = Math.hypot(dx, dy);
  for (let k = 0; k < w * h; k++) d[k] = mask[k] ? 0 : INF;
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { const k = i * w + j; let v = d[k];
    if (j > 0) v = Math.min(v, d[k - 1] + dx); if (i > 0) { v = Math.min(v, d[k - w] + dy); if (j > 0) v = Math.min(v, d[k - w - 1] + dd); if (j < w - 1) v = Math.min(v, d[k - w + 1] + dd); } d[k] = v; }
  for (let i = h - 1; i >= 0; i--) for (let j = w - 1; j >= 0; j--) { const k = i * w + j; let v = d[k];
    if (j < w - 1) v = Math.min(v, d[k + 1] + dx); if (i < h - 1) { v = Math.min(v, d[k + w] + dy); if (j < w - 1) v = Math.min(v, d[k + w + 1] + dd); if (j > 0) v = Math.min(v, d[k + w - 1] + dd); } d[k] = v; }
  return d;
}
function chamferV(mask, val, w, h, dx, dy) {
  const INF = 1e9, d = new Float32Array(w * h), v = new Float32Array(w * h), dd = Math.hypot(dx, dy);
  for (let k = 0; k < w * h; k++) { d[k] = mask[k] ? 0 : INF; v[k] = mask[k] ? val[k] : NaN; }
  const rel = (k, q, c) => { if (d[q] + c < d[k]) { d[k] = d[q] + c; v[k] = v[q]; } };
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { const k = i * w + j;
    if (j > 0) rel(k, k - 1, dx); if (i > 0) { rel(k, k - w, dy); if (j > 0) rel(k, k - w - 1, dd); if (j < w - 1) rel(k, k - w + 1, dd); } }
  for (let i = h - 1; i >= 0; i--) for (let j = w - 1; j >= 0; j--) { const k = i * w + j;
    if (j < w - 1) rel(k, k + 1, dx); if (i < h - 1) { rel(k, k + w, dy); if (j < w - 1) rel(k, k + w + 1, dd); if (j > 0) rel(k, k + w - 1, dd); } }
  return { d, v };
}
// Suma en un cuadrado de radio r (imagen integral)
function boxMean(src, w, h, r) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let i = 0; i < h; i++) { let row = 0; for (let j = 0; j < w; j++) { row += src[i * w + j]; I[(i + 1) * (w + 1) + j + 1] = I[i * (w + 1) + j + 1] + row; } }
  const out = new Float32Array(w * h);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
    const a = Math.max(0, i - r), b = Math.min(h, i + r + 1), c = Math.max(0, j - r), e = Math.min(w, j + r + 1);
    out[i * w + j] = (I[b * (w + 1) + e] - I[a * (w + 1) + e] - I[b * (w + 1) + c] + I[a * (w + 1) + c]) / ((b - a) * (e - c));
  }
  return out;
}
// Perfil en línea recta del coche al punto: metros que se suben y se bajan
function climbProfile(grid, a, b) {
  const L = kmDist(a.lat, a.lon, b.lat, b.lon) * 1000, n = Math.max(2, Math.ceil(L / 25)); let up = 0, down = 0, prev = null;
  for (let t = 0; t <= n; t++) { const k = grid.idx(a.lat + (b.lat - a.lat) * t / n, a.lon + (b.lon - a.lon) * t / n); if (k < 0) continue; const z = grid.z(k); if (prev != null) { if (z > prev) up += z - prev; else down += prev - z; } prev = z; }
  return { up: Math.round(up), down: Math.round(down) };
}
/* ---------- A pie: rejilla de 10 m con el mapa de cubiertas del ICGC ----------
   Clases de 10 m: 0 fuera · 1 pinar denso · 2 pinar claro · 3 frondosas o esclerófilas densas · 4 bosque claro o de ribera ·
   5 matorral · 6 abierto, cultivo o prado · 7 urbano o vial · 8 agua · 9 vía de tren, industria o minas · 10 roca.
   Coste relativo de andar campo a través por cada clase (Infinity = no se pasa). */
const WALK_COST = [1.3, 1, 1, 1.2, 1, 1.7, 1, 1.1, Infinity, Infinity, 3];
const LC_CLASS_NAMES = ["fuera del mapa", "pinar denso", "pinar claro", "bosque denso de frondosas", "bosque claro o de ribera", "matorral", "campo, cultivo o prado", "urbano o carretera", "agua", "vía de tren, industria o minas", "roca"];
// Ventana de 10 m: la caja de búsqueda más un margen para poder aparcar fuera de ella
function walkWindow(lcm, bbox, prefs) {
  const mLat = Math.min(prefs.walkMax ?? 600, 700) / 111320, mLon = mLat / Math.cos(41.78 * Math.PI / 180);
  const i0 = Math.max(0, Math.floor((bbox.n + mLat - lcm.lat0) / lcm.dlat)), i1 = Math.min(lcm.H - 1, Math.floor((bbox.s - mLat - lcm.lat0) / lcm.dlat));
  const j0 = Math.max(0, Math.floor((bbox.w - mLon - lcm.lon0) / lcm.dlon)), j1 = Math.min(lcm.W - 1, Math.floor((bbox.e + mLon - lcm.lon0) / lcm.dlon));
  return { i0, j0, w: j1 - j0 + 1, h: i1 - i0 + 1 };
}
const RAIL = /^(rail|narrow_gauge|light_rail|funicular|monorail|preserved|subway|tram)$/;
const yes = v => v != null && v !== "no";
// Barreras que no se cruzan andando salvo por un paso: tren, autovía, río o canal, valla, cortado
function barrierKind(t) {
  if (t.railway && RAIL.test(t.railway) && !yes(t.bridge) && !yes(t.tunnel)) return "tren";
  if (/^(motorway|trunk)(_link)?$/.test(t.highway || "") && !yes(t.bridge) && !yes(t.tunnel)) return "autovía";
  if (/^(river|canal)$/.test(t.waterway || "") && !yes(t.tunnel) && !yes(t.bridge)) return "río";
  if (t.barrier === "fence") return "valla";
  if (t.natural === "cliff") return "cortado";
  return null;
}
const WALKABLE = /^(track|path|footway|bridleway|steps|pedestrian|cycleway|unclassified|residential|living_street|service|tertiary|secondary|road|primary)(_link)?$/;
function walkableKind(t) {
  const h = t.highway || ""; if (!WALKABLE.test(h)) return 0;
  if (t.foot === "no" || (t.access === "no" && !/^(yes|designated|permissive)$/.test(t.foot || ""))) return 0;
  return /^primary/.test(h) ? 2 : 1; // 2: carretera principal (se puede cruzar, pero mejor no ir por ella)
}
// Rejilla de prioridad (montículo binario con arrays tipados)
function Heap(cap) {
  let k = new Float64Array(cap), v = new Int32Array(cap), n = 0;
  return {
    get size() { return n; },
    push(key, val) {
      if (n === k.length) { const k2 = new Float64Array(n * 2), v2 = new Int32Array(n * 2); k2.set(k); v2.set(v); k = k2; v = v2; }
      let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = val;
    },
    pop() { // devuelve el valor; la clave queda en this.key
      const topV = v[0]; this.key = k[0]; const lk = k[--n], lv = v[n]; let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv; return topV;
    }
  };
}
// Simplifica una polilínea (Douglas-Peucker) en metros locales
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const cx = Math.cos(41.78 * Math.PI / 180) * 111320, cy = 110540, keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const ax = pts[a][1] * cx, ay = pts[a][0] * cy, bx = pts[b][1] * cx, by = pts[b][0] * cy, vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
    for (let i = a + 1; i < b; i++) { const px = pts[i][1] * cx - ax, py = pts[i][0] * cy - ay, t = L ? clamp((px * vx + py * vy) / L, 0, 1) : 0, d = Math.hypot(px - t * vx, py - t * vy); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
/* Mejores puntos a los que se llega con tu coche y luego andando de verdad.
   ways: elementos 'way' de Overpass (caminos, y además vías de tren, ríos, vallas y cortados).
   lc: ventana de 10 m del mapa de cubiertas { cls, i0, j0, w, h, lat0, lon0, dlat, dlon }.
   1) Con la red de caminos y tu coche, dónde puedes aparcar (roadNetwork).
   2) Ruta a pie más corta en esfuerzo desde cualquier sitio donde aparcar (Dijkstra sobre la rejilla de 10 m):
      no cruza vías de tren, autovías, ríos, canales, vallas, cortados, agua ni zonas industriales, salvo por un camino que
      las cruce (puente, túnel o paso a nivel); evita pendientes fuertes y cuenta la subida.
   3) El punto tiene que estar en bosque adecuado de verdad: la celda y al menos el 60 % de lo que la rodea (~60 m). */
function analyzeWindow(grid, sc, th, bbox, ways, prefs, me, lc) {
  const s = SPECIES[prefs.sp], W = lc.w, H = lc.h, N = W * H, cls = lc.cls;
  const latOf = i => lc.lat0 + (lc.i0 + i + .5) * lc.dlat, lonOf = j => lc.lon0 + (lc.j0 + j + .5) * lc.dlon;
  const rowF = la => (la - lc.lat0) / lc.dlat - lc.i0, colF = lo => (lo - lc.lon0) / lc.dlon - lc.j0;
  const cosL = Math.cos(41.78 * Math.PI / 180), dx = Math.abs(lc.dlon) * 111320 * cosL, dy = Math.abs(lc.dlat) * 111320, dd = Math.hypot(dx, dy);
  const gr = new Int32Array(H), gc = new Int32Array(W);
  for (let i = 0; i < H; i++) gr[i] = clamp(grid.rowOf(latOf(i)), 0, grid.H - 1);
  for (let j = 0; j < W; j++) gc[j] = clamp(grid.colOf(lonOf(j)), 0, grid.W - 1);
  const k30 = q => { const i = (q / W) | 0; return gr[i] * grid.W + gc[q - i * W]; };
  // Dibujo de líneas en la rejilla (paso a paso en 4 direcciones, sin huecos en diagonal); thick = pincel 3×3
  const put = (M, v, y, x, thick) => {
    if (!thick) { if (x >= 0 && y >= 0 && x < W && y < H) M[y * W + x] = v; return; }
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const yy = y + a, xx = x + b; if (xx >= 0 && yy >= 0 && xx < W && yy < H) M[yy * W + xx] = v; }
  };
  const seg = (M, v, la1, lo1, la2, lo2, thick) => {
    let y = Math.floor(rowF(la1)), x = Math.floor(colF(lo1)); const y1 = Math.floor(rowF(la2)), x1 = Math.floor(colF(lo2));
    if ((y < -2 && y1 < -2) || (x < -2 && x1 < -2) || (y > H + 1 && y1 > H + 1) || (x > W + 1 && x1 > W + 1)) return;
    const nx = Math.abs(x1 - x), ny = Math.abs(y1 - y), sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
    put(M, v, y, x, thick);
    for (let ix = 0, iy = 0; (ix < nx || iy < ny) && ix + iy < 60000;) { if ((.5 + ix) / nx < (.5 + iy) / ny) { x += sx; ix++; } else { y += sy; iy++; } put(M, v, y, x, thick); }
  };
  const drawWay = (M, v, g, thick) => { for (let i = 1; i < g.length; i++) seg(M, v, g[i - 1].lat, g[i - 1].lon, g[i].lat, g[i].lon, thick); };

  // 1) Coche
  const net = roadNetwork(ways, prefs);
  const carSeg = new Int32Array(N).fill(-1), pavM = new Uint8Array(N), byId = new Map(ways.map(x => [x.id, x]));
  net.reach.forEach((sg, n) => {
    const A = net.nodes.get(sg.a), B = net.nodes.get(sg.b), w = byId.get(sg.way), h = (w && w.tags && w.tags.highway) || "";
    if (sg.c === 0) seg(pavM, 1, A.lat, A.lon, B.lat, B.lon, false);
    if (/^(motorway|trunk)/.test(h)) return; // en una autovía no se aparca
    seg(carSeg, n, A.lat, A.lon, B.lat, B.lon, false);
  });
  // 2) Caminos (para andar y para apartarse de lo pisado) y barreras
  const wayM = new Uint8Array(N), walkM = new Uint8Array(N), bridgeM = new Uint8Array(N), barM = new Uint8Array(N), wallM = new Uint8Array(N);
  const barNodes = new Map(), barriers = [];
  for (const wy of ways) {
    const t = wy.tags || {}, g = wy.geometry; if (!g || g.length < 2) continue;
    const bk = barrierKind(t);
    if (bk) { drawWay(barM, 1, g, true); barriers.push({ kind: bk, id: wy.id }); if (bk === "tren" || bk === "autovía" || bk === "río") (wy.nodes || []).forEach(n => barNodes.set(n, 1)); continue; }
    if (t.barrier === "wall") { drawWay(wallM, 1, g, false); continue; }
    if (!t.highway) continue;
    drawWay(wayM, 1, g, false);
    const wk = walkableKind(t); if (!wk) continue;
    drawWay(yes(t.bridge) || yes(t.tunnel) || t.ford === "yes" ? bridgeM : walkM, wk, g, false);
  }
  // pasos a nivel y vados: el camino comparte un nodo con la vía o el río → se abre la barrera en ese punto
  for (const wy of ways) {
    const t = wy.tags || {}; if (!t.highway || !walkableKind(t) || !wy.nodes || !wy.geometry) continue;
    wy.nodes.forEach((n, i) => {
      if (!barNodes.has(n)) return; const p = wy.geometry[i], y = Math.floor(rowF(p.lat)), x = Math.floor(colF(p.lon));
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const yy = y + a, xx = x + b; if (xx >= 0 && yy >= 0 && xx < W && yy < H && walkM[yy * W + xx]) bridgeM[yy * W + xx] = walkM[yy * W + xx]; }
    });
  }
  // Coste de cada celda
  const kids = !!prefs.kids, maxSl = kids ? 28 : 38, cost = new Float32Array(N), z = new Float32Array(N);
  for (let q = 0; q < N; q++) {
    const k = k30(q), sl = grid.sl4[k] / 4; let c;
    if (bridgeM[q]) c = bridgeM[q] === 2 ? 2.5 : .8;
    else if (barM[q]) c = Infinity;
    else if (walkM[q]) c = walkM[q] === 2 ? 2.5 : .8;
    else { const cl = cls[q]; c = WALK_COST[cl]; if (c < Infinity) { if (sl > maxSl || (cl === 10 && sl > 25)) c = Infinity; else c *= 1 + (sl / 22) * (sl / 22); } }
    if (wallM[q] && c < Infinity) c += 3;
    cost[q] = c;
  }
  // altitud a 10 m (interpolación bilineal del modelo de 30 m)
  for (let i = 0; i < H; i++) {
    const fy = (latOf(i) - grid.lat0) / grid.dlat - .5, y0 = clamp(Math.floor(fy), 0, grid.H - 2), ty = clamp(fy - y0, 0, 1);
    for (let j = 0; j < W; j++) {
      const fx = (lonOf(j) - grid.lon0) / grid.dlon - .5, x0 = clamp(Math.floor(fx), 0, grid.W - 2), tx = clamp(fx - x0, 0, 1), k = y0 * grid.W + x0;
      z[i * W + j] = (grid.zz[k] * (1 - tx) + grid.zz[k + 1] * tx) * (1 - ty) + (grid.zz[k + grid.W] * (1 - tx) + grid.zz[k + grid.W + 1] * tx) * ty;
    }
  }
  // 3) Ruta a pie de mínimo esfuerzo desde cualquier sitio donde aparcar
  const walkMax = prefs.walkMax ?? 600, upW = kids ? 10 : 7, capCost = walkMax * 3 + 600;
  const dist = new Float64Array(N).fill(Infinity), real = new Float32Array(N), up = new Float32Array(N), down = new Float32Array(N), par = new Int32Array(N).fill(-1);
  const heap = Heap(1 << 16);
  for (let q = 0; q < N; q++) if (carSeg[q] >= 0 && cost[q] < Infinity) { dist[q] = 0; heap.push(0, q); }
  const NB = [[0, 1, dx], [0, -1, dx], [1, 0, dy], [-1, 0, dy], [1, 1, dd], [1, -1, dd], [-1, 1, dd], [-1, -1, dd]];
  while (heap.size) {
    const q = heap.pop(), d = heap.key; if (d > dist[q]) continue; if (d > capCost) break;
    if (real[q] > walkMax) continue;
    const i = (q / W) | 0, j = q - i * W, cq = cost[q];
    for (const [di, dj, L] of NB) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= H || jj >= W) continue;
      const nq = ii * W + jj, c2 = cost[nq]; if (c2 === Infinity) continue;
      if (di && dj && (cost[i * W + jj] === Infinity || cost[ii * W + j] === Infinity)) continue; // sin colarse en diagonal
      const dz = z[nq] - z[q], nd = d + L * (cq + c2) / 2 + (dz > 0 ? upW * dz : -2 * dz);
      if (nd < dist[nq]) { dist[nq] = nd; par[nq] = q; real[nq] = real[q] + L; up[nq] = up[q] + Math.max(0, dz); down[nq] = down[q] + Math.max(0, -dz); heap.push(nd, nq); }
    }
  }
  // 4) Bosque adecuado alrededor (~60 m), lejanía de caminos y afluencia probable
  const wsrc = new Float32Array(N), bm = new Uint8Array(N);
  for (let q = 0; q < N; q++) { wsrc[q] = s.lc[cls[q]] || 0; bm[q] = (grid.flags[k30(q)] & 2) ? 1 : 0; }
  const S10 = boxMean(wsrc, W, H, 3), dPath = chamfer(wayM, W, H, dx, dy), dPav = chamfer(pavM, W, H, dx, dy);
  const builtNear = boxMean(bm, W, H, 75), pathDens = boxMean(wayM, W, H, 24);
  const crowdAt = q => clamp(.45 * clamp(1 - dPav[q] / 600, 0, 1) + .35 * clamp(pathDens[q] / .04, 0, 1) + .2 * clamp(builtNear[q] / .05, 0, 1) + .25 * clamp(1 - real[q] / 250, 0, 1), 0, 1);
  const climbMax = kids ? Math.min(prefs.climbMax ?? 100, 40) : (prefs.climbMax ?? 100);
  const minWalk = prefs.avoidCrowd ? (prefs.minWalk ?? 300) : 0, pathMin = prefs.avoidCrowd ? Math.max(prefs.pathMin, 120) : prefs.pathMin;
  const bi0 = Math.max(1, Math.ceil(rowF(bbox.n))), bi1 = Math.min(H - 2, Math.floor(rowF(bbox.s))), bj0 = Math.max(1, Math.ceil(colF(bbox.w))), bj1 = Math.min(W - 2, Math.floor(colF(bbox.e)));
  const sc3 = k => { let sum = 0, c = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const u = sc[k + a * grid.W + b]; if (u > 0) { sum += u; c++; } } return c >= 6 ? sum / 9 : 0; };
  const cand = [];
  for (let i = bi0; i <= bi1; i += 2) for (let j = bj0; j <= bj1; j += 2) {
    const q = i * W + j; if (dist[q] === Infinity || real[q] > walkMax || real[q] < minWalk) continue;
    if (Math.max(up[q], down[q]) > climbMax) continue;
    if ((s.lc[cls[q]] || 0) < .5 || S10[q] < .6) continue; // en bosque adecuado de verdad, no en un matorral ni en una franja
    const k = k30(q); if (!(sc[k] > 0)) continue; const v = sc3(k); if (!(v > 0)) continue;
    const pf = pathMin > 0 ? .6 + .4 * clamp(dPath[q] / pathMin, 0, 1) : 1;
    cand.push({ q, v: v * pf * (.6 + .4 * S10[q]) * (prefs.avoidCrowd ? 1 - .5 * crowdAt(q) : 1) });
  }
  cand.sort((a, b) => b.v - a.v);
  const picks = [], sep = 300;
  for (const c of cand) {
    const i = (c.q / W) | 0, j = c.q - i * W; if (!picks.every(p => Math.hypot((p.i - i) * dy, (p.j - j) * dx) >= sep)) continue;
    picks.push({ q: c.q, i, j, v: c.v }); if (picks.length >= 15) break;
  }
  const spots = picks.map(p => {
    const q = p.q, k = k30(q), lat = latOf(p.i), lon = lonOf(p.j);
    const cells = []; let r = q, guard = 0; while (r >= 0 && guard++ < 100000) { cells.push(r); if (par[r] < 0) break; r = par[r]; }
    const q0 = cells[cells.length - 1], i0 = (q0 / W) | 0, j0 = q0 - i0 * W;
    const park = nearestParking(latOf(i0), lonOf(j0), net);
    const pts = cells.reverse().map(c => { const ci = (c / W) | 0; return [latOf(ci), lonOf(c - ci * W)]; });
    if (park) pts.unshift([park.lat, park.lon]);
    const route = simplify(pts, 4).map(x => [Math.round(x[0] * 1e6) / 1e6, Math.round(x[1] * 1e6) / 1e6]);
    if (park) park.dist = Math.hypot((park.lat - latOf(i0)) * 110540, (park.lon - lonOf(j0)) * 111320 * cosL);
    return { lat, lon, score: sc[k], adj: p.v, level: absLevel(sc[k]), slope: grid.slope(k), aspect: grid.aspect(k), z: Math.round(z[q]), edge: grid.edge(k), tree: grid.tree(k),
      cover: cls[q], forest: Math.round(S10[q] * 100) / 100, dPath: Math.round(dPath[q]), walk: Math.round(real[q] + (park ? park.dist : 0)), park,
      prof: { up: Math.round(up[q]), down: Math.round(down[q]) }, route, crowd: crowdAt(q), fromMe: me ? kmDist(me.lat, me.lon, lat, lon) : null };
  });
  const out = { window: { i0: lc.i0, j0: lc.j0, w: W, h: H }, net, spots, barriers: barriers.length, reached: cand.length };
  if (prefs._debug) out.debug = { dist, real, cost, up, down, S10, carSeg, barM, walkM, bridgeM };
  return out;
}

if (typeof module !== "undefined") module.exports = { walkWindow, WALK_COST, LC_CLASS_NAMES, barrierKind, walkableKind, simplify, climbProfile, roadClass, roadNetwork, nearestParking, effClass, ROAD_CLASS, CAR_LEVELS, STATIONS, SPECIES, DEFAULT_PREFS, zoneRanking, extendStations, rainScore, absLevel, ABS_NAMES, seasonF, stationSummary, meteoAt, meteoFactors, forestMix, Grid, computeScores, thresholds, levelOf, LEVEL_NAMES, analyzeWindow, isDrivable, dayKey, parseDay, daysBetween, kmDist };
