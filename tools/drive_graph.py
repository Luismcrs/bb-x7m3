"""Red de carreteras y pistas para calcular en el móvil el tiempo en coche desde casa (data/drive.bin.gz), para «Planear».
Lee las teselas de caminos (data/osm2). Solo vías por las que puede ir un coche (mismos criterios que roadClass en
model.js), partidas en tramos de como mucho ~250 m para poder aparcar cerca de cualquier sitio.
Velocidades parecidas a las de Google Maps: el límite de la vía (o el típico de su tipo) por un factor según el tipo,
y velocidades bajas en pista (buena 25, normal 15, mala 8 km/h).

Formato (data/drive.bin.gz, gzip, little endian): Int32 versión, N nodos, E tramos, lat0, lon0 (1e-5 grados), paso K ·
Uint16 (lat−lat0)/K, (lon−lon0)/K por nodo · Uint32 origen · Int32 destino−origen · Uint16 metros · Uint8 km/h ·
Uint8 bits: 0-1 firme (0 asfalto, 1 pista buena, 2 normal, 3 mala), 2 se puede ir de origen a destino, 3 al revés."""
import json, os, re, math, struct
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, '..', 'data')
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

# límite típico (si la vía no lo tiene) y factor para pasar del límite a la velocidad media real
LIMIT = {'motorway': 120, 'trunk': 100, 'primary': 90, 'secondary': 90, 'tertiary': 80, 'unclassified': 60, 'road': 50,
         'residential': 40, 'living_street': 20, 'service': 30, 'track': 40}
FACTOR = {'motorway': .95, 'trunk': .93, 'primary': .88, 'secondary': .85, 'tertiary': .8, 'unclassified': .72, 'road': .7,
          'residential': .65, 'living_street': .6, 'service': .55, 'track': .55}
DIRT = {1: 25, 2: 15, 3: 8}

def maxspeed(v):
    if not v: return None
    v = v.strip().lower()
    m = re.match(r'^(\d+)(\s*mph)?$', v)
    if m: return int(m.group(1)) * (1.609 if m.group(2) else 1)
    return {'es:urban': 50, 'es:rural': 90, 'es:motorway': 120, 'es:trunk': 100, 'es:living_street': 20, 'walk': 10}.get(v)

def speed(t, cls):
    h = t.get('highway', ''); link = h.endswith('_link'); base = h[:-5] if link else h
    lim = maxspeed(t.get('maxspeed')) or LIMIT.get(base, 40)
    if link: lim = min(lim, 60)
    v = lim * FACTOR.get(base, .6) * (.85 if link else 1)
    if cls >= 1: v = min(v, DIRT[cls])
    return max(5, min(250, round(v)))

def direction(t):
    o = t.get('oneway', ''); h = t.get('highway', '')
    if o in ('yes', 'true', '1') or t.get('junction') in ('roundabout', 'circular') or (h in ('motorway', 'motorway_link') and o != 'no'): return 1
    if o == '-1': return -1
    return 0

idx = json.load(open(os.path.join(DATA, 'osm2', 'index.json')))
ways = {}
for r, c, *_ in idx['tiles']:
    t = json.load(open(os.path.join(DATA, 'osm2', f'{r}_{c}.json')))
    for wid, tags, nd, g in t['w']:
        if wid in ways: continue
        cl = road_class(tags)
        if cl < 0: continue
        nodes = list(np.cumsum(nd)); la = np.cumsum(g[0::2]); lo = np.cumsum(g[1::2])
        ways[wid] = (tags, cl, nodes, la, lo)
use = {}
for tags, cl, nodes, la, lo in ways.values():
    for n in nodes: use[n] = use.get(n, 0) + 1
cy = 110540.0; cx = 111320.0 * math.cos(math.radians(41.96))
vid = {}; coords = []
def vert(n, a, b):
    if n not in vid: vid[n] = len(coords); coords.append((int(a), int(b)))
    return vid[n]
U, V, L, S, F = [], [], [], [], []
for tags, cl, nodes, la, lo in ways.values():
    sp = speed(tags, cl); d = direction(tags)
    fl = cl | (4 if d >= 0 else 0) | (8 if d <= 0 else 0)
    start = 0; acc = 0.0
    for i in range(1, len(nodes)):
        acc += math.hypot((la[i] - la[i - 1]) / 1e5 * cy, (lo[i] - lo[i - 1]) / 1e5 * cx)
        if i == len(nodes) - 1 or use[nodes[i]] > 1 or acc >= 250:
            U.append(vert(nodes[start], la[start], lo[start])); V.append(vert(nodes[i], la[i], lo[i]))
            L.append(max(1, round(acc))); S.append(sp); F.append(fl); start = i; acc = 0.0
N, E = len(coords), len(U)
C = np.array(coords, np.int64); lat0, lon0 = int(C[:, 0].min()), int(C[:, 1].min())
K = max(1, math.ceil(max(C[:, 0].max() - lat0, C[:, 1].max() - lon0) / 65535))  # paso en 1e-5 grados (~1-2 m)
Q = np.round((C - [lat0, lon0]) / K).astype('<u2')
U = np.array(U, np.int64); V = np.array(V, np.int64)
raw = b''.join([struct.pack('<6i', 2, N, E, lat0, lon0, K), Q.tobytes(),
                U.astype('<u4').tobytes(), (V - U).astype('<i4').tobytes(),  # destino como diferencia: comprime mucho mejor
                np.array(L, '<u2').tobytes(), np.array(S, 'u1').tobytes(), np.array(F, 'u1').tobytes()])
import gzip
with open(os.path.join(DATA, 'drive.bin.gz'), 'wb') as f: f.write(gzip.compress(raw, 9, mtime=0))
print('red en coche:', len(ways), 'vías,', N, 'nodos,', E, 'tramos,', len(raw) // 1024, 'KB →', os.path.getsize(os.path.join(DATA, 'drive.bin.gz')) // 1024, 'KB comprimido')
