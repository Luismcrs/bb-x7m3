"""Caminos de OpenStreetMap del Bages y el Berguedà en teselas estáticas (data/osm/), a partir del extracto de
Cataluña de Geofabrik (pensado para descargas grandes; no depende de los servidores de Overpass).
Mismos filtros que la consulta de la app. Formato 2 (compacto): cada tesela {"w": [[id, tags, nodos, coords], ...], "p": [...]},
con los nodos como diferencias entre ids seguidos y las coordenadas en cienmilésimas de grado (~1 m), también como diferencias."""
import json, os, re, time, math, urllib.request, subprocess, sys
import osmium
S0, N0, W0, E0 = 41.55, 42.37, 1.50, 2.12
DLAT, DLON = 0.06, 0.08
ROWS, COLS = math.ceil(round((N0 - S0) / DLAT, 6)), math.ceil(round((E0 - W0) / DLON, 6))
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, '..', 'data', 'osm2')  # formato 2; las versiones viejas de la app leen data/osm
PBF_URL = 'https://download.geofabrik.de/europe/spain/cataluna-latest.osm.pbf'
KEEP = {'highway', 'tracktype', 'surface', 'smoothness', 'access', 'motor_vehicle', 'motorcar', 'vehicle', '4wd_only', 'foot', 'bridge',
        'tunnel', 'ford', 'railway', 'waterway', 'barrier', 'natural', 'name', 'service', 'layer', 'rack'}
HW_NO = re.compile(r'^(proposed|construction|platform|corridor|elevator|bus_stop|raceway|abandoned|razed|services|rest_area)$')
RAIL = re.compile(r'^(rail|narrow_gauge|light_rail|funicular|monorail|preserved|subway|tram)$')
PLACE = re.compile(r'^(village|hamlet|isolated_dwelling|farm|locality|neighbourhood|town)$')
def wanted(t):
    h = t.get('highway')
    if h and not HW_NO.match(h) and not re.match(r'^(sidewalk|crossing)$', t.get('footway', '')) and t.get('area') != 'yes': return True
    if t.get('railway') and RAIL.match(t['railway']): return True
    if t.get('waterway') in ('river', 'canal'): return True
    if t.get('barrier') in ('fence', 'wall'): return True
    return t.get('natural') == 'cliff'
tiles = {(r, c): {'w': [], 'p': []} for r in range(ROWS) for c in range(COLS)}
def tile_range(la0, la1, lo0, lo1):
    r0, r1 = max(0, math.floor((la0 - S0) / DLAT)), min(ROWS - 1, math.floor((la1 - S0) / DLAT))
    c0, c1 = max(0, math.floor((lo0 - W0) / DLON)), min(COLS - 1, math.floor((lo1 - W0) / DLON))
    return [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
class H(osmium.SimpleHandler):
    def __init__(self): super().__init__(); self.nw = 0; self.np = 0
    def node(self, n):
        t = n.tags; name = t.get('name')
        if not name or not n.location.valid(): return
        if not (PLACE.match(t.get('place', '')) or t.get('natural') == 'peak'): return
        la, lo = n.location.lat, n.location.lon
        if not (S0 <= la <= N0 and W0 <= lo <= E0): return
        r, c = min(ROWS - 1, int((la - S0) / DLAT)), min(COLS - 1, int((lo - W0) / DLON))
        tiles[(r, c)]['p'].append([round(la, 6), round(lo, 6), name, 1 if t.get('natural') == 'peak' else 0]); self.np += 1
    def way(self, w):
        t = {tg.k: tg.v for tg in w.tags}
        if not wanted(t): return
        try: pts = [(n.location.lat, n.location.lon) for n in w.nodes]
        except osmium.InvalidLocationError: return
        if len(pts) < 2: return
        las = [p[0] for p in pts]; los = [p[1] for p in pts]
        if max(las) < S0 or min(las) > N0 or max(los) < W0 or min(los) > E0: return
        refs = [n.ref for n in w.nodes]; q = [(round(a * 1e5), round(b * 1e5)) for a, b in pts]
        nd = [refs[0]] + [refs[i] - refs[i - 1] for i in range(1, len(refs))]
        cd = [q[0][0], q[0][1]] + [v for i in range(1, len(q)) for v in (q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1])]
        rec = [w.id, {k: v for k, v in t.items() if k in KEEP}, nd, cd]
        for rc in tile_range(min(las), max(las), min(los), max(los)): tiles[rc]['w'].append(rec)
        self.nw += 1
t0 = time.time()
src = os.path.join(HERE, 'cataluna.osm.pbf'); area = os.path.join(HERE, 'area.osm.pbf')
if not os.path.exists(src):
    print('descargando', PBF_URL, flush=True); urllib.request.urlretrieve(PBF_URL, src)
print('extracto', os.path.getsize(src) // 1024 // 1024, 'MB', flush=True)
subprocess.run(['osmium', 'extract', '--overwrite', '-b', f'{W0},{S0},{E0},{N0}', '--strategy', 'complete_ways', src, '-o', area], check=True)
h = H(); h.apply_file(area, locations=True)
print('caminos', h.nw, 'lugares', h.np, f'{time.time() - t0:.0f} s', flush=True)
os.makedirs(OUT, exist_ok=True); today = time.strftime('%Y-%m-%d'); total = 0; idx = []
for (r, c), d in sorted(tiles.items()):
    p = os.path.join(OUT, f'{r}_{c}.json')
    with open(p, 'w') as f: json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
    total += os.path.getsize(p); idx.append([r, c, today])
json.dump({'f': 2, 's': S0, 'w': W0, 'dlat': DLAT, 'dlon': DLON, 'rows': ROWS, 'cols': COLS, 'tiles': idx, 'generated': today,
           'source': '© OpenStreetMap contributors (ODbL), extracto de Geofabrik'}, open(os.path.join(OUT, 'index.json'), 'w'))
print('hecho', len(idx), 'teselas,', total // 1024 // 1024, 'MB', f'{time.time() - t0:.0f} s')
