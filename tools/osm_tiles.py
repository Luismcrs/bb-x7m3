"""Caminos de OpenStreetMap del Bages y el Berguedà en teselas estáticas para la app (data/osm/).
Se ejecuta en GitHub Actions (cada mes). Así la app no depende de los servidores públicos de Overpass,
que se saturan a menudo. Cada tesela: {"w": [[id, tags, nodos, [lat, lon, ...]], ...], "p": [[lat, lon, nombre, cima], ...]}."""
import json, os, time, urllib.request, urllib.parse, math, sys
S0, N0, W0, E0 = 41.55, 42.37, 1.50, 2.12          # zona de la app y un margen para llegar en coche
DLAT, DLON = 0.06, 0.08
ROWS, COLS = math.ceil(round((N0 - S0) / DLAT, 6)), math.ceil(round((E0 - W0) / DLON, 6))
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'osm')
SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
KEEP = {'highway', 'tracktype', 'surface', 'smoothness', 'access', 'motor_vehicle', 'motorcar', 'vehicle', '4wd_only', 'foot', 'bridge',
        'tunnel', 'ford', 'railway', 'waterway', 'barrier', 'natural', 'name', 'service', 'layer', 'rack'}
HW = 'way["highway"]["highway"!~"^(proposed|construction|platform|corridor|elevator|bus_stop|raceway|abandoned|razed|services|rest_area)$"]["footway"!~"^(sidewalk|crossing)$"]["area"!="yes"]'
def query(bb):
    return ('[out:json][timeout:120];(' + HW + '(' + bb + ');way["railway"~"^(rail|narrow_gauge|light_rail|funicular|monorail|preserved|subway|tram)$"](' + bb + ');'
            'way["waterway"~"^(river|canal)$"](' + bb + ');way["barrier"~"^(fence|wall)$"](' + bb + ');way["natural"="cliff"](' + bb + '););out body geom qt;'
            'node["place"~"^(village|hamlet|isolated_dwelling|farm|locality|neighbourhood|town)$"]["name"](' + bb + ');node["natural"="peak"]["name"](' + bb + ');out body qt;')
def fetch(q):
    last = None
    for attempt in range(8):
        url = SERVERS[attempt % len(SERVERS)]
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'bolets-bages/1.0 (github.com/Luismcrs/bb-x7m3)'})
            with urllib.request.urlopen(req, timeout=200) as r:
                j = json.load(r)
            if j.get('remark') and ('runtime error' in j['remark'] or 'timed out' in j['remark']):
                raise RuntimeError(j['remark'])
            return j
        except Exception as e:
            last = e; print('  reintento', attempt + 1, url.split('/')[2], str(e)[:120], flush=True); time.sleep(20 * (attempt + 1))
    raise RuntimeError(last)
os.makedirs(OUT, exist_ok=True)
tiles, total = [], 0
for r in range(ROWS):
    for c in range(COLS):
        s, w = S0 + r * DLAT, W0 + c * DLON
        bb = f'{s:.4f},{w:.4f},{s + DLAT:.4f},{w + DLON:.4f}'
        t0 = time.time(); j = fetch(query(bb))
        ways = [[e['id'], {k: v for k, v in (e.get('tags') or {}).items() if k in KEEP}, e.get('nodes', []),
                 [round(x, 6) for g in e['geometry'] for x in (g['lat'], g['lon'])]] for e in j['elements'] if e['type'] == 'way' and e.get('geometry')]
        places = [[round(e['lat'], 6), round(e['lon'], 6), e['tags']['name'], 1 if e['tags'].get('natural') == 'peak' else 0]
                  for e in j['elements'] if e['type'] == 'node' and e.get('tags', {}).get('name')]
        name = f'{r}_{c}.json'
        with open(os.path.join(OUT, name), 'w') as f: json.dump({'w': ways, 'p': places}, f, ensure_ascii=False, separators=(',', ':'))
        size = os.path.getsize(os.path.join(OUT, name)); total += size; tiles.append([r, c])
        print(f'{name}: {len(ways)} caminos, {len(places)} lugares, {size // 1024} KB, {time.time() - t0:.0f} s', flush=True)
        time.sleep(4)
json.dump({'s': S0, 'w': W0, 'dlat': DLAT, 'dlon': DLON, 'rows': ROWS, 'cols': COLS, 'tiles': tiles,
           'generated': time.strftime('%Y-%m-%d'), 'source': '© OpenStreetMap contributors (ODbL)'},
          open(os.path.join(OUT, 'index.json'), 'w'))
print('hecho', len(tiles), 'teselas,', total // 1024 // 1024, 'MB')
