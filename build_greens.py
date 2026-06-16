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


def cls(t):
    k = t.get('landuse') or t.get('natural') or t.get('leisure')
    if k in ('forest', 'wood'):
        return 'forest'
    if k == 'scrub':
        return 'scrub'
    if k == 'pitch':
        return 'pitch'
    return 'grass'   # grassland, park, garden, meadow, recreation_ground, village_green


# Merge the greens Overpass result with veg_geom.json (the bake_trees source).
# veg_geom carries natural=scrub polygons that the greens query above omits, so
# without this those scrub areas scatter trees over BARE ground. Deduping by OSM
# id (greens_raw wins on shared ways) folds the scrub fills in and leaves every
# tree-bearing polygon with a matching green patch.
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

json.dump({'type': 'FeatureCollection', 'features': feats},
          open('web/data/greens.geojson', 'w'))
by_cls = {}
for f in feats:
    by_cls[f['properties']['g']] = by_cls.get(f['properties']['g'], 0) + 1
print('greens features:', len(feats), by_cls)
