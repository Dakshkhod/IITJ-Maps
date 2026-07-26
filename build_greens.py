"""Build web/data/greens.geojson from OSM green-area polygons.

Source (same data F4Map renders): query Overpass for the campus bbox and
save the raw result to greens_raw.json, e.g.

  curl -s -A "IITJMaps/1.0" -G "https://overpass-api.de/api/interpreter" \
    --data-urlencode 'data=[out:json][timeout:90];(
      way["landuse"="grass"](26.46,73.104,26.483,73.123);
      way["landuse"="meadow"](26.46,73.104,26.483,73.123);
      way["landuse"="recreation_ground"](26.46,73.104,26.483,73.123);
      way["landuse"="village_green"](26.46,73.104,26.483,73.123);
      way["natural"="grassland"](26.46,73.104,26.483,73.123);
      way["leisure"="pitch"](26.46,73.104,26.483,73.123);
      way["leisure"="park"](26.46,73.104,26.483,73.123);
      way["leisure"="garden"](26.46,73.104,26.483,73.123);
      way["landuse"="forest"](26.46,73.104,26.483,73.123);
      way["natural"="wood"](26.46,73.104,26.483,73.123);
    );out geom;' -o greens_raw.json

Then run this script. Each polygon is tagged with a colour class `g`
(forest | pitch | grass) consumed by the greens-fill layer in app.js.
"""
import json
import math


def cls(t):
    k = t.get('landuse') or t.get('natural') or t.get('leisure')
    if k in ('forest', 'wood'):
        return 'forest'
    if k == 'scrub':
        return 'scrub'
    if k == 'pitch':
        return 'pitch'
    return 'grass'   # grassland, park, garden, meadow, recreation_ground, village_green


# Merge the greens result with veg_geom.json (the bake_trees source), which
# carries natural=scrub polygons the query above omits — without them those scrub
# areas scatter trees over bare ground. Dedupe by OSM id (greens_raw wins) so
# every tree-bearing polygon ends up with a matching green patch.
elements = {}
for src in ('greens_raw.json', 'veg_geom.json'):
    try:
        data = json.load(open(src))
    except FileNotFoundError:
        continue
    for e in data['elements']:
        if e.get('type') == 'way' and e.get('geometry'):
            elements.setdefault(e['id'], e)

feats = []
for e in elements.values():
    geom = e.get('geometry', [])
    if len(geom) < 4:
        continue
    ring = [[round(g['lon'], 6), round(g['lat'], 6)] for g in geom]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    feats.append({
        'type': 'Feature',
        'properties': {'g': cls(e.get('tags', {}))},
        'geometry': {'type': 'Polygon', 'coordinates': [ring]},
    })

# Manual green patches (not in OSM), kept here so they survive every rebuild. The
# greens layer sits at the bottom of the map stack, so roads/buildings/area tints
# render on top and generous coverage only fills the bare cream gaps.
def _circle(lng, lat, r_m, n=40):
    mlat = 111132.0
    mlng = 111320.0 * math.cos(math.radians(lat))
    ring = [[round(lng + (r_m * math.cos(2 * math.pi * i / n)) / mlng, 6),
             round(lat + (r_m * math.sin(2 * math.pi * i / n)) / mlat, 6)]
            for i in range(n)]
    ring.append(ring[0])
    return ring


MANUAL = [
    # Brain Tree roundabout island — green the white ring inside the circle.
    ('grass', _circle(73.1141633, 26.4692796, 30)),
    # No median/berm strip by the IITJ Fountain & Informal Grounds: the OSM grass
    # polygons and area fills already cover that arc, and a patch there spills
    # south past the ring road into Informal Grounds.
]
for _g, _ring in MANUAL:
    feats.append({'type': 'Feature', 'properties': {'g': _g},
                  'geometry': {'type': 'Polygon', 'coordinates': [_ring]}})

json.dump({'type': 'FeatureCollection', 'features': feats},
          open('web/data/greens.geojson', 'w'))
by_cls = {}
for f in feats:
    by_cls[f['properties']['g']] = by_cls.get(f['properties']['g'], 0) + 1
print('greens features:', len(feats), by_cls)
