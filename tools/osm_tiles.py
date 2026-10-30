"""Caminos de OpenStreetMap del Bages y el Berguedà en teselas estáticas para la app (data/osm/).
Se ejecuta en GitHub Actions (cada mes y a mano). Así la app no depende de los servidores públicos de Overpass,
que se saturan a menudo. Cada tesela: {"w": [[id, tags, nodos, [lat, lon, ...]], ...], "p": [[lat, lon, nombre, cima], ...]}.
Va guardando lo hecho: primero las teselas que faltan o son más viejas, y si una falla la deja para la próxima vez."""
import json, os, time, urllib.request, urllib.parse, math, subprocess, sys
S0, N0, W0, E0 = 41.55, 42.37, 1.50, 2.12          # zona de la app y un margen para llegar en coche
DLAT, DLON = 0.06, 0.08
ROWS, COLS = math.ceil(round((N0 - S0) / DLAT, 6)), math.ceil(round((E0 - W0) / DLON, 6))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'osm')
SERVERS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
KEEP = {'highway', 'tracktype', 'surface', 'smoothness', 'access', 'motor_vehicle', 'motorcar', 'vehicle', '4wd_only', 'foot', 'bridge',
        'tunnel', 'ford', 'railway', 'waterway', 'barrier', 'natural', 'name', 'service', 'layer', 'rack'}
HW = 'way["highway"]["highway"!~"^(proposed|construction|platform|corridor|elevator|bus_stop|raceway|abandoned|razed|services|rest_area)$"]["footway"!~"^(sidewalk|crossing)$"]["area"!="yes"]'
COMMIT_EVERY = int(os.environ.get('COMMIT_EVERY', '0'))   # en GitHub Actions: publica cada N teselas
MAX_MIN = float(os.environ.get('MAX_MIN', '150'))         # para antes de que GitHub corte el trabajo
def notice(msg): print(('::notice::' if os.environ.get('GITHUB_ACTIONS') else '') + msg, flush=True)
def query(bb):
    return ('[out:json][timeout:90];(' + HW + '(' + bb + ');way["railway"~"^(rail|narrow_gauge|light_rail|funicular|monorail|preserved|subway|tram)$"](' + bb + ');'
            'way["waterway"~"^(river|canal)$"](' + bb + ');way["barrier"~"^(fence|wall)$"](' + bb + ');way["natural"="cliff"](' + bb + '););out body geom qt;'
            'node["place"~"^(village|hamlet|isolated_dwelling|farm|locality|neighbourhood|town)$"]["name"](' + bb + ');node["natural"="peak"]["name"](' + bb + ');out body qt;')
def fetch(q):
    last = None
    for attempt in range(4):
        url = SERVERS[attempt % len(SERVERS)]
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'bolets-bages/1.0 (github.com/Luismcrs/bb-x7m3)'})
            with urllib.request.urlopen(req, timeout=120) as r: j = json.load(r)
            if j.get('remark') and ('runtime error' in j['remark'] or 'timed out' in j['remark']): raise RuntimeError(j['remark'][:100])
            return j
        except Exception as e:
            last = e; print('  reintento', attempt + 1, url.split('/')[2], str(e)[:120], flush=True); time.sleep(15 * (attempt + 1))
    raise RuntimeError(last)
def publish(msg):
    if not COMMIT_EVERY: return
    subprocess.run('git add data/osm && (git commit -q -m "' + msg + '" || true) && git pull -q --rebase origin main && git push -q origin HEAD:main && git push -q --force origin HEAD:gh-pages', shell=True)
os.makedirs(OUT, exist_ok=True)
idx_path = os.path.join(OUT, 'index.json')
old = json.load(open(idx_path)) if os.path.exists(idx_path) else {}
done_at = {f'{t[0]}_{t[1]}': t[2] if len(t) > 2 else '' for t in old.get('tiles', [])}
todo = sorted([(r, c) for r in range(ROWS) for c in range(COLS)], key=lambda t: done_at.get(f'{t[0]}_{t[1]}', ''))  # primero las que faltan o son más viejas
t_start, n_ok, n_fail, since = time.time(), 0, 0, 0
def write_index():
    tiles = [[int(k.split('_')[0]), int(k.split('_')[1]), d] for k, d in sorted(done_at.items()) if os.path.exists(os.path.join(OUT, k + '.json'))]
    json.dump({'s': S0, 'w': W0, 'dlat': DLAT, 'dlon': DLON, 'rows': ROWS, 'cols': COLS, 'tiles': tiles,
               'generated': time.strftime('%Y-%m-%d-%H%M'), 'source': '© OpenStreetMap contributors (ODbL)'}, open(idx_path, 'w'))
for r, c in todo:
    if (time.time() - t_start) / 60 > MAX_MIN: notice('Tiempo agotado: sigue en la próxima ejecución'); break
    s, w = S0 + r * DLAT, W0 + c * DLON
    bb = f'{s:.4f},{w:.4f},{s + DLAT:.4f},{w + DLON:.4f}'
    t0 = time.time()
    try: j = fetch(query(bb))
    except Exception as e: n_fail += 1; notice(f'{r}_{c}: falla ({str(e)[:80]}), queda para la próxima vez'); continue
    ways = [[e['id'], {k: v for k, v in (e.get('tags') or {}).items() if k in KEEP}, e.get('nodes', []),
             [round(x, 6) for g in e['geometry'] for x in (g['lat'], g['lon'])]] for e in j['elements'] if e['type'] == 'way' and e.get('geometry')]
    places = [[round(e['lat'], 6), round(e['lon'], 6), e['tags']['name'], 1 if e['tags'].get('natural') == 'peak' else 0]
              for e in j['elements'] if e['type'] == 'node' and e.get('tags', {}).get('name')]
    with open(os.path.join(OUT, f'{r}_{c}.json'), 'w') as f: json.dump({'w': ways, 'p': places}, f, ensure_ascii=False, separators=(',', ':'))
    done_at[f'{r}_{c}'] = time.strftime('%Y-%m-%d'); n_ok += 1; since += 1
    print(f'{r}_{c}: {len(ways)} caminos, {len(places)} lugares, {time.time() - t0:.0f} s', flush=True)
    if COMMIT_EVERY and since >= COMMIT_EVERY:
        write_index(); publish(f'Caminos de OpenStreetMap: {len(done_at)} de {ROWS * COLS} teselas'); notice(f'{len(done_at)} de {ROWS * COLS} teselas publicadas'); since = 0
    time.sleep(3)
write_index(); publish(f'Caminos de OpenStreetMap: {len(done_at)} de {ROWS * COLS} teselas')
notice(f'Hecho: {n_ok} teselas nuevas, {n_fail} fallidas, {len(done_at)} de {ROWS * COLS} en total')
