/**
 * Merge fresh campus roads (regenerated from the campus OSM extract) with the
 * previously-committed wider road network, then rebuild the routing graph.
 *
 * Why: web/data was historically built from a wider OSM pull than map.osm, so
 * web/data/roads.geojson carries ~256 off-campus roads (approach roads, NH-62,
 * ring road, city grid) used for routing context. A plain campus re-extract
 * would drop those. This script keeps them while letting the fresh campus
 * extract win for anything inside the campus bbox.
 *
 * Rule per old road (web/data) not present (by osm_id) in the new extract:
 *   - has a node inside CAMPUS_PULL_BBOX  -> it was deleted upstream  -> drop
 *   - no node inside the bbox             -> genuinely off-campus     -> keep
 */
const fs = require('fs');
const path = require('path');
const RoadClassifier = require('./road-classifier');

// Exact bbox used for the campus OSM /map pull. A way is in the campus extract
// iff it has at least one node here, so "not in extract + a node here" == deleted.
const CAMPUS_PULL_BBOX = {
  minLat: 26.4584700, maxLat: 26.4867500,
  minLng: 73.1076200, maxLng: 73.1259900,
};

const dataDir = path.join(__dirname, '..', 'data');
const webDir = path.join(__dirname, '..', '..', 'web', 'data');

const newRoads = JSON.parse(fs.readFileSync(path.join(dataDir, 'roads.geojson'), 'utf-8'));
const oldRoads = JSON.parse(fs.readFileSync(path.join(webDir, 'roads.geojson'), 'utf-8'));

const newIds = new Set(newRoads.features.map(f => String(f.properties.osm_id)));

function touchesCampus(feature) {
  const c = feature.geometry.coordinates;
  for (const [lng, lat] of c) {
    if (lat >= CAMPUS_PULL_BBOX.minLat && lat <= CAMPUS_PULL_BBOX.maxLat &&
        lng >= CAMPUS_PULL_BBOX.minLng && lng <= CAMPUS_PULL_BBOX.maxLng) {
      return true;
    }
  }
  return false;
}

const preserved = [];
let droppedDeleted = 0;
for (const f of oldRoads.features) {
  if (newIds.has(String(f.properties.osm_id))) continue;   // fresh version wins
  if (touchesCampus(f)) { droppedDeleted++; continue; }     // deleted upstream
  preserved.push(f);                                        // off-campus → keep
}

const merged = {
  type: 'FeatureCollection',
  features: [...newRoads.features, ...preserved].map(RoadClassifier.enrichRoadFeature),
};

const { graph, nodeCoords, edgeCount } = RoadClassifier.buildRoadGraph(merged.features);
const roadAudit = RoadClassifier.buildRoadAudit(merged.features);

fs.writeFileSync(path.join(dataDir, 'roads.geojson'), JSON.stringify(merged, null, 2));
fs.writeFileSync(path.join(dataDir, 'road-graph.json'), JSON.stringify({ graph, nodeCoords }, null, 2));
fs.writeFileSync(path.join(dataDir, 'road-audit.json'), JSON.stringify(roadAudit, null, 2));

console.log(`Fresh campus roads : ${newRoads.features.length}`);
console.log(`Off-campus kept    : ${preserved.length}`);
console.log(`Deleted-upstream   : ${droppedDeleted} (dropped)`);
console.log(`Merged roads       : ${merged.features.length}`);
console.log(`Road graph         : ${Object.keys(graph).length} nodes, ${edgeCount} edges`);
