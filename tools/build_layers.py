"""Bolets Bages + Berguedà + Moianès · construcción de las capas de datos de la app (copia de referencia: se ejecutó en un
entorno de trabajo con las descargas del ICGC y del Mapa Forestal en /tmp/claude-0/bg; no lo usa el trabajo mensual).
Rejilla de 1" (~30 m): lon 1.54–2.25, lat 41.58–42.34 (hasta 2.08 hasta la v1.17; la franja este es para el Moianès). Rejilla de 10 m (1/3") para las teselas de cubiertas.
Fuentes: ICGC MET (WCS, 30 m) y ICGC Cobertes del Sòl 2024 (WMS, píxel de 1/6"), límites comarcales y municipales.
Recetas comprobadas contra la versión anterior (solo Bages): pendiente = gradiente central del MDE suavizado (gauss σ=1);
orientación = atan2(-gx, -gy); TPI = z − media de 25×33 celdas; fracciones = medias de bloques 6×6 de 5 m;
clases de 10 m = bloques 2×2 (agua manda, luego vía/industria, si no la mayoría); borde = EDT del bosque a 10 m, media 3×3."""
import json, glob, os, numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, uniform_filter, distance_transform_edt, binary_dilation
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling
import rasterio.features as rf
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
Image.MAX_IMAGE_PIXELS = None
OUT = '/tmp/claude-0/bg/out/'; os.makedirs(OUT + 'lc', exist_ok=True)
LON0, LON1, LAT0, LAT1 = 1.54, 2.25, 42.34, 41.58          # LAT0 = borde norte
D = 1 / 3600; W = int(round((LON1 - LON0) / D)); H = int(round((LAT0 - LAT1) / D))
TR = from_origin(LON0, LAT0, D, D); print('rejilla', H, W)
dy = 111320 / 3600; dx = dy * np.cos(np.radians(41.78))

# ---------- 1) MDE del ICGC (teselas ArcGrid en ETRS89 UTM 31N) → rejilla geográfica ----------
tiles = []
for f in glob.glob('/tmp/claude-0/bg/dem/d_*.asc') + glob.glob('/tmp/claude-0/bg/moia/d_*.asc'):
    L = open(f).read().split('\n', 6); hd = {l.split()[0].upper(): float(l.split()[1]) for l in L[:6]}
    tiles.append((hd, f))
cs = tiles[0][0]['CELLSIZE']; xs = [t[0]['XLLCORNER'] for t in tiles]; ys = [t[0]['YLLCORNER'] for t in tiles]
n = int(tiles[0][0]['NCOLS']); X0, Y0 = min(xs), min(ys); X1, Y1 = max(xs) + n * cs, max(ys) + n * cs
UW, UH = int(round((X1 - X0) / cs)), int(round((Y1 - Y0) / cs)); U = np.full((UH, UW), np.nan, np.float32)
for hd, f in tiles:
    a = np.loadtxt(f, skiprows=6, dtype=np.float32); a[a <= -9998] = np.nan
    c = int(round((hd['XLLCORNER'] - X0) / cs)); r = int(round((Y1 - (hd['YLLCORNER'] + n * cs)) / cs)); U[r:r + n, c:c + n] = a
print('MDE UTM', U.shape, 'sin datos', np.isnan(U).mean().round(4))
z = np.zeros((H, W), np.float32)
reproject(U, z, src_transform=from_origin(X0, Y1, cs, cs), src_crs='EPSG:25831', dst_transform=TR, dst_crs='EPSG:4326',
          resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
print('z', np.nanmin(z), np.nanmax(z), 'nan', np.isnan(z).mean().round(5))
z = np.where(np.isnan(z), np.nanmean(z), z).astype(np.float64)
zs = gaussian_filter(z, 1); gy, gx = np.gradient(zs); gx = gx / dx; gy = -gy / dy
slope = np.degrees(np.arctan(np.hypot(gx, gy))); aspect = (np.degrees(np.arctan2(-gx, -gy)) + 360) % 360
tpi = z - uniform_filter(z, (25, 33), mode='nearest')
terrain = np.zeros((H, W, 4), np.uint8); terrain[..., 3] = 255
terrain[..., 0] = np.clip(np.round(slope * 4), 0, 255); terrain[..., 1] = np.round(aspect / 360 * 255) % 256
terrain[..., 2] = np.clip(np.round(tpi), -128, 127) + 128
elev = np.zeros((H, W, 4), np.uint8); elev[..., 3] = 255; zi = np.clip(np.round(z), 0, 65535).astype(np.int64)  # metros enteros: el móvil calcula el relieve a partir de aquí
elev[..., 0] = zi >> 8; elev[..., 1] = zi & 255
np.save('/tmp/claude-0/bg/z.npy', z.astype(np.float32))

# ---------- 2) Cubiertas: clases de 10 m y fracciones de 30 m ----------
CACHE = '/tmp/claude-0/bg/stage2_v2.npz'
C5 = '/tmp/claude-0/bg/cls5_v2.npy'
if not os.path.exists(CACHE) and not os.path.exists(C5):
    # clases de 5 m: lo que ya había (hasta lon 2.08) + la franja del Moianès (WMS del ICGC, colores → clase con lut.json)
    old = np.load('/tmp/claude-0/bg/cls5_all.npy', mmap_mode='r'); new = np.lib.format.open_memmap(C5 + '.tmp', 'w+', np.uint8, (H * 6, W * 6))
    for r0 in range(0, old.shape[0], 2048): new[r0:r0 + 2048, :old.shape[1]] = old[r0:r0 + 2048]
    lut = {int(k, 16): v for k, v in json.load(open('/tmp/claude-0/bg/lut.json')).items()}
    R0, C0 = int(round((LAT0 - 41.94) * 21600)), int(round((2.08 - LON0) * 21600))
    for r in range(3):
        for c in range(2):
            a = np.array(Image.open(f'/tmp/claude-0/bg/moia/lc_{r}_{c}.png').convert('RGB')).astype(np.int64)
            rgb = (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]; u, inv = np.unique(rgb, return_inverse=True)
            cl = np.array([lut.get(int(x), 0) for x in u], np.uint8)[inv.reshape(rgb.shape)]
            new[R0 + r * 1872:R0 + (r + 1) * 1872, C0 + c * 1836:C0 + (c + 1) * 1836] = cl
    new.flush(); del new; os.replace(C5 + '.tmp', C5); print('clases de 5 m ampliadas')
if os.path.exists(CACHE):
    S2 = np.load(CACHE); FR = {k[3:]: S2[k] for k in S2.files if k.startswith('fr_')}; c10 = S2['c10']; edge30 = S2['edge30']
else:
  c5 = np.load(C5, mmap_mode='r'); M41 = np.load('/tmp/claude-0/bg/map41.npy')
  assert c5.shape == (H * 6, W * 6), c5.shape
  GROUPS = {'dp': [7], 'sp': [11], 'db': [8, 9], 'sb': [12, 13, 15], 'sc': [10], 'no': [27, 29, 30, 33, 34, 35, 36, 37, 38, 39, 40, 41],
            'urb': [21, 22, 23, 24, 25, 31], 'forest': [7, 8, 9, 11, 12, 13, 15]}
  FR = {k: np.zeros((H, W), np.float32) for k in GROUPS}; c10 = np.zeros((H * 3, W * 3), np.uint8)
  for r0 in range(0, H, 96):
      r1 = min(H, r0 + 96); blk = np.array(c5[r0 * 6:r1 * 6]); h = r1 - r0
      b6 = blk.reshape(h, 6, W, 6).transpose(0, 2, 1, 3).reshape(h, W, 36)
      for k, S in GROUPS.items(): FR[k][r0:r1] = np.isin(b6, S).mean(-1)
      m = M41[blk].reshape(h * 3, 2, W * 3, 2).transpose(0, 2, 1, 3).reshape(h * 3, W * 3, 4)
      cnt = np.stack([(m == k).sum(-1) for k in range(11)], -1); o = cnt.argmax(-1).astype(np.uint8)
      o[(m == 9).any(-1)] = 9; o[(m == 8).any(-1)] = 8; c10[r0 * 3:r1 * 3] = o
  print('fracciones y clases de 10 m listas')
  fm = (c10 >= 1) & (c10 <= 4)
  dy10, dx10 = 111320 / 10800, 111320 / 10800 * np.cos(np.radians(41.78))
  E = distance_transform_edt(fm, sampling=(dy10, dx10)).astype(np.float32); del fm
  edge30 = E.reshape(H, 3, W, 3).mean((1, 3)); del E

  np.savez(CACHE, c10=c10, edge30=edge30, **{'fr_' + k: v for k, v in FR.items()})
# ---------- 3) Comarcas y municipios ----------
def topo_geoms(path, name):
    t = json.load(open(path)); sc, tr_ = t['transform']['scale'], t['transform']['translate']; arcs = []
    for a in t['arcs']:
        x = y = 0; pts = []
        for dx_, dy_ in a: x += dx_; y += dy_; pts.append((x * sc[0] + tr_[0], y * sc[1] + tr_[1]))
        arcs.append(pts)
    def ring(ix):
        out = []
        for i in ix:
            p = arcs[i] if i >= 0 else arcs[~i][::-1]
            out += p if not out else p[1:]
        return out
    ok = lambda rs: [r for r in rs if len(r) >= 4]
    res = []
    for g in t['objects'][name]['geometries']:
        if g['type'] == 'Polygon': geo = {'type': 'Polygon', 'coordinates': ok([ring(r) for r in g['arcs']])}
        elif g['type'] == 'MultiPolygon': geo = {'type': 'MultiPolygon', 'coordinates': [ok([ring(r) for r in p]) for p in g['arcs'] if len(ring(p[0])) >= 4]}
        else: continue
        res.append((g.get('properties', {}), shape(geo).buffer(0)))
    return res
comarques = json.load(open('/tmp/claude-0/dl/catalonia-cartography/shapefiles_catalunya_comarcas.geojson'))
berg = [shape(f['geometry']).buffer(0) for f in comarques['features'] if f['properties']['nom_comar'] == 'Berguedà'][0]
bages = shape(json.load(open('/tmp/claude-0/gis/bages.geojson'))['geometry']).buffer(0)
mun = topo_geoms('/tmp/claude-0/dl/catalonia-cartography/cat-municipis.json', 'municipis')
moia = unary_union([g for p, g in mun if p.get('comarca') == 42])
region = unary_union([bages, berg, moia])
inb = rf.rasterize([(region, 1)], out_shape=(H, W), transform=TR, fill=0, dtype='uint8')
munis_old = [m for m in json.load(open('/tmp/claude-0/app/data/munis.json')) if m.get('com', 'Bages') != 'Moianès']
norm = lambda s: s.lower().replace("’", "'").strip()
byname = {norm(p['nom']): (p, g) for p, g in mun}
munis, shapes = [], []
for m in munis_old:
    p, g = byname[norm(m['n'])]; munis.append(dict(m, com=m.get('com', 'Bages'))); shapes.append((g, m['id']))
nid = max(m['id'] for m in munis_old) + 1
if not any(m['com'] == 'Berguedà' for m in munis_old):
  for p, g in sorted([(p, g) for p, g in mun if p.get('comarca') == 14], key=lambda x: x[0]['nom']):
    pt = g.representative_point(); munis.append({'id': nid, 'n': p['nom'], 'lat': round(pt.y, 5), 'lon': round(pt.x, 5), 'com': 'Berguedà'})
    shapes.append((g, nid)); nid += 1
for p, g in sorted([(p, g) for p, g in mun if p.get('comarca') == 42], key=lambda x: x[0]['nom']):
    pt = g.representative_point(); munis.append({'id': nid, 'n': p['nom'], 'lat': round(pt.y, 5), 'lon': round(pt.x, 5), 'com': 'Moianès'})
    shapes.append((g, nid)); nid += 1
mu = rf.rasterize(shapes, out_shape=(H, W), transform=TR, fill=0, dtype='uint8')
mu[inb == 0] = 0
print('municipios', len(munis), 'Berguedà', sum(1 for m in munis if m['com'] == 'Berguedà'), 'Moianès', sum(1 for m in munis if m['com'] == 'Moianès'))

# ---------- 4) Escritura ----------
flags = inb.astype(np.uint8) | (((FR['urb'] + FR['no']) > .3).astype(np.uint8) << 1)
forest = np.zeros((H, W, 4), np.uint8); forest[..., 3] = 255
forest[..., 0] = np.round(FR['forest'] * 255); forest[..., 1] = np.clip(np.round(edge30 / 4), 0, 255); forest[..., 2] = flags * 80
cov1 = np.zeros((H, W, 4), np.uint8); cov1[..., 3] = 255; cov2 = cov1.copy()
for a, k, ch in [(cov1, 'dp', 0), (cov1, 'sp', 1), (cov1, 'db', 2), (cov2, 'sb', 0), (cov2, 'sc', 1), (cov2, 'no', 2)]: a[..., ch] = np.round(FR[k] * 255)
mp = np.zeros((H, W, 4), np.uint8); mp[..., 3] = 255; mp[..., 0] = mu
for nm, a in [('terrain', terrain), ('elev', elev), ('forest', forest), ('cover1', cov1), ('cover2', cov2), ('munis', mp)]:
    Image.fromarray(a, 'RGBA').save(OUT + nm + '.png', optimize=True); print(nm, os.path.getsize(OUT + nm + '.png'))
# 10 m: fuera de las comarcas + 1 km = 0; teselas 6 × 6 (columnas de 0,118°)
reg10 = rf.rasterize([(region.buffer(0.0125), 1)], out_shape=(H * 3, W * 3), transform=from_origin(LON0, LAT0, D / 3, D / 3), fill=0, dtype='uint8')
c10[reg10 == 0] = 0
NX = 6; TW, TH = W * 3 // NX, H * 3 // 6; tiles10 = []; assert TW * NX == W * 3
for r in range(6):
    for c in range(NX):
        t = c10[r * TH:(r + 1) * TH, c * TW:(c + 1) * TW]
        if t.max() == 0: continue
        Image.fromarray(np.ascontiguousarray(t), 'L').save(OUT + f'lc/{r}_{c}.png', optimize=True); tiles10.append([r, c])
print('teselas 10 m', len(tiles10), sum(os.path.getsize(OUT + f'lc/{r}_{c}.png') for r, c in tiles10))
np.save('/tmp/claude-0/bg/c10.npy', c10)
json.dump(munis, open(OUT + 'munis.json', 'w'), ensure_ascii=False)
meta = json.load(open('/tmp/claude-0/app/data/meta.json'))
meta.update({'W': W, 'H': H, 'lon0': LON0, 'dlon': D, 'lat0': LAT0, 'dlat': -D, 'bounds': [[LAT1, LON0], [LAT0, LON1]],
             'sources': 'Relieve: ICGC, Model d\'Elevacions del Terreny (MET). Cobertes del sòl: ICGC 2024 (1 m, CC BY 4.0). Límites: ICGC. Pinares por especie: Mapa Forestal de España (MITECO).'})
meta['lc10'].update({'W': W * 3, 'H': H * 3, 'lon0': LON0, 'lat0': LAT0, 'dlon': D / 3, 'dlat': -D / 3, 'tileW': TW, 'tileH': TH, 'nx': NX, 'ny': 6, 'tiles': tiles10})
json.dump(meta, open(OUT + 'meta.json', 'w'), ensure_ascii=False)
# ---------- 5) Pinares por especie (Mapa Forestal de España) ----------
# Recetas de la versión anterior: píxel de 10 m con el polígono pintado (alfa > 127), fracción = media de 3 × 3.
# pb = pino carrasco (+ piñonero + pinaster), pn = pino salgareño (pinassa), ps = pino albar (pi roig) + pino negro.
P0 = np.load('/tmp/claude-0/bg/pines30.npz'); pin = {k: np.zeros((H, W), np.float32) for k in ('pb', 'pn', 'ps')}
for k in pin: pin[k][:, :P0[k].shape[1]] = P0[k]
GR = {'pb': ['pinar_pino_carrasco', 'pinar_pino_pinonero', 'pinar_pino_pinaster_reg_mediterranea'], 'pn': ['pinar_pino_salgareno'], 'ps': ['pinar_pino_albar', 'pinar_pino_negro']}
r30, c30 = int(round((LAT0 - 41.94) * 3600)), int(round((2.08 - LON0) * 3600))
for r in range(2):
    for k, names in GR.items():
        m = None
        for nm in names:
            a = np.array(Image.open(f'/tmp/claude-0/bg/moia/mfe_{nm}_{r}.png').convert('RGBA'))[..., 3] > 127
            m = a if m is None else (m | a)
        f = m.reshape(1404 // 3, 3, 1836 // 3, 3).mean((1, 3)); i0 = r30 + r * 468
        pin[k][i0:i0 + 468, c30:c30 + 612] = f[:, :min(612, W - c30)]
pm = np.zeros((H, W, 4), np.uint8); pm[..., 3] = 255
for k, ch in (('pb', 0), ('pn', 1), ('ps', 2)): pm[..., ch] = np.round(pin[k] * 255)
Image.fromarray(pm, 'RGBA').save(OUT + 'pines.png', optimize=True); print('pines', os.path.getsize(OUT + 'pines.png'))
# zona de mezcla forestal del Moianès (respaldo cuando una celda no tiene especie en el mapa forestal): pinos del mapa forestal
# y frondosas del mapa de cubiertas, dentro de la comarca
mm = rf.rasterize([(moia, 1)], out_shape=(H, W), transform=TR, fill=0, dtype='uint8') > 0
sh = {k: float(pin[k][mm].sum()) for k in pin}; fr = float(FR['db'][mm].sum() + FR['sb'][mm].sum()); tot = sum(sh.values()) + fr
mix = {k: round(v / tot, 2) for k, v in sh.items()}; mix['al'] = round(fr / tot * .5, 2); mix['ro'] = round(fr / tot * .5, 2)
meta['zones'] = [z for z in meta['zones'] if z['id'] != 'moianes'] + [{'id': 'moianes', 'lat': 41.81, 'lon': 2.1, 'f': mix}]
print('mezcla Moianès', mix)
json.dump(meta, open(OUT + 'meta.json', 'w'), ensure_ascii=False)
print('hecho')
