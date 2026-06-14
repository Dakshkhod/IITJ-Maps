/**
 * Enrich the bundled roads with navigation classification metadata and rebuild
 * road-graph.json without regenerating unrelated map datasets.
 */
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');
const RoadClassifier = require('./road-classifier');

const ROOT = path.join(__dirname, '..', '..');
const WEB_DATA = path.join(ROOT, 'web', 'data');
const BACKEND_DATA = path.join(ROOT, 'backend', 'data');
const OSM_FILE = path.join(ROOT, 'map.osm');

const ROAD_TAG_KEYS = [
  'surface', 'lit', 'lanes', 'oneway', 'service', 'access', 'vehicle',
  'motor_vehicle', 'motorcar', 'foot', 'bicycle', 'width',
];

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJSON(file, data, pretty) {
  fs.writeFileSync(file, JSON.stringify(data, null, pretty ? 2 : 0));
}

function readOsmRoadTags() {
  const xml = fs.readFileSync(OSM_FILE, 'utf8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const tagsById = new Map();

  for (const way of Array.from(doc.getElementsByTagName('way'))) {
    const tags = {};
    for (const tag of Array.from(way.getElementsByTagName('tag'))) {
      tags[tag.getAttribute('k')] = tag.getAttribute('v');
    }
    if (!tags.highway) continue;
    const id = way.getAttribute('id');
    tagsById.set(String(id), tags);
  }
  return tagsById;
}

function mergeOsmTags(feature, tagsById) {
  const p = { ...(feature.properties || {}) };
  const tags = tagsById.get(String(p.osm_id));
  if (!tags) return { ...feature, properties: p };

  p.name = p.name && p.name !== p.highway_type ? p.name : (tags.name || tags.highway || p.name);
  p.highway_type = tags.highway || p.highway_type;
  for (const key of ROAD_TAG_KEYS) p[key] = tags[key] || null;
  return { ...feature, properties: p };
}

function main() {
  const tagsById = readOsmRoadTags();
  const source = readJSON(path.join(WEB_DATA, 'roads.geojson'));
  const roads = {
    type: 'FeatureCollection',
    features: source.features
      .map(f => mergeOsmTags(f, tagsById))
      .map(RoadClassifier.enrichRoadFeature),
  };
  const { graph, nodeCoords } = RoadClassifier.buildRoadGraph(roads.features);
  const audit = RoadClassifier.buildRoadAudit(roads.features);

  writeJSON(path.join(BACKEND_DATA, 'roads.geojson'), roads, true);
  writeJSON(path.join(BACKEND_DATA, 'road-graph.json'), { graph, nodeCoords }, true);
  writeJSON(path.join(BACKEND_DATA, 'road-audit.json'), audit, true);

  writeJSON(path.join(WEB_DATA, 'roads.geojson'), roads, false);
  writeJSON(path.join(WEB_DATA, 'road-graph.json'), { graph, nodeCoords }, false);
  writeJSON(path.join(WEB_DATA, 'road-audit.json'), audit, false);

  console.log(`Roads classified: ${roads.features.length}`);
  console.log(`Graph nodes     : ${Object.keys(graph).length}`);
  console.log(`Audit classes   : ${Object.keys(audit.summary).length}`);
}

main();
