"""Distancia a donde se puede dejar el coche, para «Planear» (data/road.png).
Lee las teselas de caminos (data/osm2) y, en la rejilla de 30 m de la app, calcula la distancia en línea recta a la
vía más cercana por la que puede ir un coche normal según el firme (mismos criterios que roadClass en model.js):
  R: asfalto · G: asfalto o pista buena · B: asfalto, pista buena o pista normal.
Solo se guardan las celdas que usa «Planear» (una de cada 3 × 3, las de fila y columna múltiplos de 3): 648 × 912.
Valor = distancia / 10 m (máximo 255 = 2,55 km o más). No cuenta autovías (no se aparca) ni caminos cerrados a coches."""
import json, os, re, math
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, '..', 'data')
meta = json.load(open(os.path.join(DATA, 'meta.json')))
W, H, LAT0, LON0, DLAT, DLON = meta['W'], meta['H'], meta['lat0'], meta['lon0'], meta['dlat'], meta['dlon']
NO_CAR = re.compile(r'^(no|private|forestry|agricultural|delivery|customers|permit)$')
PAVED = re.compile(r'^(asphalt|concrete|paved|concrete:plates|concrete:lanes|paving_stones|sett|chipseal)$')
GOODU = re.compile(r'^(compacted|fine_gravel)$')
BADU = re.compile(r'^(ground|dirt|earth|grass|mud|sand|rock|rocks|pebblestone|woodchips|gravel_turf)$')
DRIVE = re.compile(r'^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|road)(_link)?$')

def road_class(t):
    h = t.get('highway', '')
    if not DRIVE.match(h): return -1
    for k in ('access', 'motor_vehicle', 'motorcar', 'vehicle'):
        if t.get(k) and NO_CAR.match(t[k]): return -1
    s, sm, tt = t.get('surface', ''), t.get('smoothness', ''), t.get('tracktype', '')
    if t.get('4wd_only') == 'yes' or re.match(r'^(very_bad|horrible|very_horrible|impassable)$', sm) or re.search(r'grade[45]', tt) or BADU.match(s): return 3
    if PAVED.match(s): return 0
    if h != 'track': return (1 if GOODU.match(s) else 2) if re.match(r'^(unpaved|gravel|compacted|fine_gravel)$', s) else 0
    if tt == 'grade1' or GOODU.match(s) or re.match(r'^(excellent|good|intermediate)$', sm): return 1
    return 2

idx = json.load(open(os.path.join(DATA, 'osm2', 'index.json')))
masks = [np.zeros((H, W), bool) for _ in range(3)]
seen = set(); nways = 0
cy = 110540.0; cx = 111320.0 * math.cos(math.radians(41.96))
for r, c, *_ in idx['tiles']:
    t = json.load(open(os.path.join(DATA, 'osm2', f'{r}_{c}.json')))
    for wid, tags, nd, g in t['w']:
        if wid in seen: continue
        seen.add(wid)
        cl = road_class(tags)
        if cl < 0 or cl > 2 or re.match(r'^(motorway|trunk)', tags.get('highway', '')): continue
        la = np.cumsum(g[0::2]) / 1e5; lo = np.cumsum(g[1::2]) / 1e5
        for i in range(1, len(la)):
            L = math.hypot((la[i] - la[i - 1]) * cy, (lo[i] - lo[i - 1]) * cx); n = max(2, int(L / 8) + 2)
            ts = np.linspace(0, 1, n)
            rows = np.floor((la[i - 1] + (la[i] - la[i - 1]) * ts - LAT0) / DLAT).astype(int)
            cols = np.floor((lo[i - 1] + (lo[i] - lo[i - 1]) * ts - LON0) / DLON).astype(int)
            ok = (rows >= 0) & (rows < H) & (cols >= 0) & (cols < W)
            for m in range(cl, 3): masks[m][rows[ok], cols[ok]] = True
        nways += 1
dy = abs(DLAT) * 111320; dx = abs(DLON) * 111320 * math.cos(math.radians(41.96))
out = np.zeros((H // 3, W // 3, 3), np.uint8)
for m in range(3):
    d = distance_transform_edt(~masks[m], sampling=(dy, dx))
    out[:, :, m] = np.clip(np.round(d[0:H:3, 0:W:3][:H // 3, :W // 3] / 10), 0, 255).astype(np.uint8)
Image.fromarray(out, 'RGB').save(os.path.join(DATA, 'road.png'), optimize=True)
print('vías con coche', nways, '·', 'road.png', out.shape[1], '×', out.shape[0], os.path.getsize(os.path.join(DATA, 'road.png')) // 1024, 'KB')
