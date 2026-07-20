/**
 * Pipeline-side road classification + graph building.
 *
 * The CLASSIFICATION core now lives in web/js/road-classifier.js so the browser
 * router can re-classify admin-overlay roads with the EXACT same rules the
 * prebuilt graph was generated with. This file re-exports that core unchanged
 * and adds the pipeline-only builders (graph + audit), which the browser never
 * needs. Do not fork the classification rules back into this file.
 */
const core = require('../../web/js/road-classifier.js');
const {
  CAMPUS_BOUNDS, haversine, featureLengthM, isInsideCampus,
  oneWayValue, classifyRoadFeature, enrichRoadFeature,
} = core;


function buildRoadGraph(roads) {
  const graph = {};
  const nodeCoords = {};
  let edgeCount = 0;

  function pushEdge(fromId, toId, road, dist, onewayReverse) {
    const p = road.properties || {};
    if (!graph[fromId]) graph[fromId] = [];
    graph[fromId].push({
      id: toId,
      dist,
      osm_id: String(p.osm_id || ''),
      type: p.highway_type || p.highway || 'unknown',
      highway_type: p.highway_type || p.highway || 'unknown',
      name: p.name || '',
      navigation_class: p.navigation_class || 'unknown',
      vehicle_access: p.vehicle_access || 'no',
      walk_access: p.walk_access || 'yes',
      drive_confidence: Number(p.drive_confidence || 0),
      drive_penalty: p.drive_penalty == null ? null : Number(p.drive_penalty),
      oneway: oneWayValue(p.oneway),
      oneway_reverse: !!onewayReverse,
    });
  }

  for (const rawRoad of roads) {
    const road = rawRoad.properties?.navigation_class ? rawRoad : enrichRoadFeature(rawRoad);
    const coords = road.geometry.coordinates;
    if (coords.length < 2) continue;
    const isOneWay = oneWayValue(road.properties?.oneway);

    for (let i = 0; i < coords.length - 1; i++) {
      const fromId = `${coords[i][1].toFixed(6)},${coords[i][0].toFixed(6)}`;
      const toId = `${coords[i + 1][1].toFixed(6)},${coords[i + 1][0].toFixed(6)}`;

      nodeCoords[fromId] = coords[i];
      nodeCoords[toId] = coords[i + 1];

      const dist = haversine(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);

      if (!graph[fromId]) graph[fromId] = [];
      if (!graph[toId]) graph[toId] = [];
      pushEdge(fromId, toId, road, dist, false);
      pushEdge(toId, fromId, road, dist, isOneWay);
      edgeCount++;
    }
  }

  return { graph, nodeCoords, edgeCount };
}

function buildRoadAudit(roads) {
  const summary = {};
  const uncertain = [];
  const excludedVehicle = [];

  for (const road of roads) {
    const p = road.properties || {};
    const cls = p.navigation_class || 'unknown';
    summary[cls] = (summary[cls] || 0) + 1;
    const item = {
      osm_id: String(p.osm_id || ''),
      name: p.name || '',
      highway_type: p.highway_type || '',
      navigation_class: cls,
      vehicle_access: p.vehicle_access || 'no',
      drive_confidence: Number(p.drive_confidence || 0),
      drive_note: p.drive_note || '',
      length_m: p.length_m || Math.round(featureLengthM(road)),
    };
    if ((p.vehicle_access === 'destination') || (p.vehicle_access === 'yes' && Number(p.drive_confidence || 0) < 0.7)) {
      uncertain.push(item);
    }
    if (p.vehicle_access === 'no') excludedVehicle.push(item);
  }

  uncertain.sort((a, b) => a.drive_confidence - b.drive_confidence || b.length_m - a.length_m);
  excludedVehicle.sort((a, b) => a.highway_type.localeCompare(b.highway_type) || b.length_m - a.length_m);

  return {
    generated_at: new Date().toISOString(),
    summary,
    uncertain_vehicle_segments: uncertain,
    excluded_from_vehicle_routing: excludedVehicle,
  };
}

module.exports = {
  CAMPUS_BOUNDS,
  classifyRoadFeature,
  enrichRoadFeature,
  buildRoadGraph,
  buildRoadAudit,
  haversine,
};
