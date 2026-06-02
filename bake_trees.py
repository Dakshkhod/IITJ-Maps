import json, math, random

random.seed(42)
veg = json.load(open('veg_geom.json'))
b = json.load(open('web/data/buildings.geojson', encoding='utf-8'))
areas = json.load(open('web/data/areas.geojson', encoding='utf-8'))

# Building footprints (lng/lat rings) for exclusion
bpolys = []
for f in b['features']:
    g = f['geometry']
    if g['type'] == 'Polygon':
        bpolys.append(g['coordinates'][0])

# Also exclude trees inside residential / built area polygons (e.g. the
# General Quarters), so scrub/forest polygons that overlap housing do not
# scatter trees on top of the quarters — matches F4Map, which keeps trees
# off buildings.
# NOTE: only residential — the 'academic' university boundary covers the
# whole campus, so excluding it would remove every tree.
for f in areas['features']:
    if f['properties'].get('category') == 'residential' and f['geometry']['type'] == 'Polygon':
        bpolys.append(f['geometry']['coordinates'][0])

def pip(x, y, poly):
    inside = False; n = len(poly); j = n-1
    for i in range(n):
        xi, yi = poly[i][0], poly[i][1]; xj, yj = poly[j][0], poly[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj-xi)*(y-yi)/(yj-yi)+xi):
            inside = not inside
        j = i
    return inside

def bbox(poly):
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)

# per-type density (m^2 per tree) and min spacing (m)
CFG = {
    'forest': (270, 7.5, 'full'),
    'scrub':  (380, 9.0, 'bush'),
    'park':   (140, 6.0, 'full'),
    'garden': (140, 6.0, 'full'),
}
MLAT = 111000.0

full = []; bush = []
for e in veg['elements']:
    t = e.get('tags', {})
    kind = t.get('landuse') or t.get('natural') or t.get('leisure')
    if kind not in CFG: continue
    poly = [(g['lon'], g['lat']) for g in e['geometry']]
    if len(poly) < 4: continue
    dens, spacing, cls = CFG[kind]
    minx, miny, maxx, maxy = bbox(poly)
    cy = (miny+maxy)/2
    mlng = MLAT*math.cos(math.radians(cy))
    # area
    A = 0
    for i in range(len(poly)-1):
        A += poly[i][0]*poly[i+1][1]-poly[i+1][0]*poly[i][1]
    A = abs(A)/2*(MLAT*mlng)
    target = int(A/dens)
    placed = []
    attempts = 0; maxatt = target*40
    sp2 = (spacing)**2
    while len(placed) < target and attempts < maxatt:
        attempts += 1
        x = random.uniform(minx, maxx); y = random.uniform(miny, maxy)
        if not pip(x, y, poly): continue
        # min spacing (convert deg->m roughly)
        ok = True
        for (px, py) in placed:
            dx = (x-px)*mlng; dy = (y-py)*MLAT
            if dx*dx+dy*dy < sp2: ok = False; break
        if not ok: continue
        # exclude building footprints (+ small buffer via point test only)
        inb = False
        for bp in bpolys:
            bminx=min(p[0] for p in bp); bmaxx=max(p[0] for p in bp)
            bminy=min(p[1] for p in bp); bmaxy=max(p[1] for p in bp)
            if x<bminx-0.00003 or x>bmaxx+0.00003 or y<bminy-0.00003 or y>bmaxy+0.00003: continue
            if pip(x, y, bp): inb = True; break
        if inb: continue
        placed.append((x, y))
    arr = full if cls == 'full' else bush
    for (x, y) in placed:
        arr.append(round(x, 5)); arr.append(round(y, 5))

print('full trees:', len(full)//2, 'bush:', len(bush)//2, 'total:', (len(full)+len(bush))//2)
json.dump({'full': full, 'bush': bush}, open('web/data/trees.json', 'w'))
import os
print('file size:', os.path.getsize('web/data/trees.json'), 'bytes')
