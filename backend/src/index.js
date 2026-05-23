/**
 * IITJ Maps — Backend API Server
 * Serves map data, places, search, and road-network routing.
 */

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'web')));

// ============================================================
// Load Data
// ============================================================
const dataDir = path.join(__dirname, '..', 'data');
const places = JSON.parse(fs.readFileSync(path.join(dataDir, 'places.geojson'), 'utf-8'));
const buildings = JSON.parse(fs.readFileSync(path.join(dataDir, 'buildings.geojson'), 'utf-8'));
const roads = JSON.parse(fs.readFileSync(path.join(dataDir, 'roads.geojson'), 'utf-8'));
const areas = JSON.parse(fs.readFileSync(path.join(dataDir, 'areas.geojson'), 'utf-8'));
const searchIndex = JSON.parse(fs.readFileSync(path.join(dataDir, 'search-index.json'), 'utf-8'));
const categories = JSON.parse(fs.readFileSync(path.join(dataDir, 'categories.json'), 'utf-8'));
const roadGraphData = JSON.parse(fs.readFileSync(path.join(dataDir, 'road-graph.json'), 'utf-8'));

const { graph: roadGraph, nodeCoords } = roadGraphData;

// Build search tokens
const searchTokens = searchIndex.map(entry => ({
  ...entry,
  tokens: [
    entry.name.toLowerCase(),
    ...(entry.keywords || []).map(k => k.toLowerCase()),
    entry.category.toLowerCase(),
    (entry.description || '').toLowerCase()
  ].join(' ')
}));

// ============================================================
// API Routes
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '3.0.0',
    places: searchIndex.length,
    buildings: buildings.features.length,
    roads: roads.features.length,
    areas: areas.features.length,
    graphNodes: Object.keys(roadGraph).length
  });
});

app.get('/api/v1/categories', (req, res) => res.json(categories));

app.get('/api/v1/places', (req, res) => {
  const { category, bbox } = req.query;
  let features = places.features;

  if (category) {
    features = features.filter(f => f.properties.category === category);
  }

  if (bbox) {
    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);
    features = features.filter(f => {
      const c = f.centroid || {};
      return c.lat >= minLat && c.lat <= maxLat && c.lng >= minLng && c.lng <= maxLng;
    });
  }

  res.json({ type: 'FeatureCollection', features });
});

app.get('/api/v1/places/:id', (req, res) => {
  const feature = places.features.find(f =>
    String(f.properties.osm_id) === req.params.id ||
    f.properties.id === req.params.id ||
    f.properties.name === req.params.id
  );
  if (!feature) return res.status(404).json({ error: 'Place not found' });
  res.json(feature);
});

app.get('/api/v1/search', (req, res) => {
  const { q, limit = 10 } = req.query;
  if (!q || q.length < 1) return res.json([]);

  const query = q.toLowerCase().trim();
  const words = query.split(/\s+/);

  const results = searchTokens
    .map(entry => {
      let score = 0;
      const nameL = entry.name.toLowerCase();

      if (nameL === query) score += 100;
      else if (nameL.startsWith(query)) score += 80;
      else if (nameL.includes(query)) score += 60;

      for (const word of words) {
        if (word.length < 2) continue;
        if (nameL.includes(word)) score += 30;
        if (entry.tokens.includes(word)) score += 15;
        const tokenWords = entry.tokens.split(/\s+/);
        for (const tw of tokenWords) {
          if (tw.startsWith(word)) score += 10;
          if (word.length >= 3 && tw.length >= 3 && levenshteinLite(word, tw) <= 1) score += 5;
        }
      }

      return { ...entry, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, parseInt(limit));

  res.json(results);
});

app.get('/api/v1/nearby', (req, res) => {
  const { lat, lng, radius = 500, limit = 10 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const maxDist = parseFloat(radius);

  const results = searchIndex
    .map(entry => ({
      ...entry,
      distance: haversine(userLat, userLng, entry.lat, entry.lng)
    }))
    .filter(r => r.distance <= maxDist)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, parseInt(limit));

  res.json(results);
});

app.get('/api/v1/map/buildings', (req, res) => res.json(buildings));
app.get('/api/v1/map/roads', (req, res) => res.json(roads));
app.get('/api/v1/map/areas', (req, res) => res.json(areas));

// ============================================================
// Routing — Dijkstra on Real Road Network
// ============================================================
app.get('/api/v1/route', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required (lat,lng)' });

  const [fromLat, fromLng] = from.split(',').map(Number);
  const [toLat, toLng] = to.split(',').map(Number);

  if ([fromLat, fromLng, toLat, toLng].some(isNaN)) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  // Campus bounds check
  const bounds = { minLat: 26.45, maxLat: 26.49, minLng: 73.09, maxLng: 73.14 };
  const inBounds = (lat, lng) =>
    lat >= bounds.minLat && lat <= bounds.maxLat &&
    lng >= bounds.minLng && lng <= bounds.maxLng;

  if (!inBounds(fromLat, fromLng) || !inBounds(toLat, toLng)) {
    return res.status(400).json({ error: 'Coordinates outside campus bounds' });
  }

  const route = computeRoute(fromLat, fromLng, toLat, toLng);
  res.json(route);
});

function computeRoute(fromLat, fromLng, toLat, toLng) {
  // Find nearest road nodes to from/to
  const fromNode = findNearestNode(fromLat, fromLng);
  const toNode = findNearestNode(toLat, toLng);

  let routeCoords = [];
  let routeDistance = 0;
  let usingGraph = false;

  if (fromNode && toNode && fromNode !== toNode) {
    const path = dijkstra(fromNode, toNode);
    if (path && path.nodes.length >= 2) {
      usingGraph = true;
      // Build route: user start → first road node → ... → last road node → destination
      routeCoords = [[fromLng, fromLat]];
      for (const nodeId of path.nodes) {
        const c = nodeCoords[nodeId];
        if (c) routeCoords.push(c);
      }
      routeCoords.push([toLng, toLat]);
      routeDistance = path.distance +
        haversine(fromLat, fromLng, nodeCoords[fromNode][1], nodeCoords[fromNode][0]) +
        haversine(toLat, toLng, nodeCoords[toNode][1], nodeCoords[toNode][0]);
    }
  }

  // Fallback: interpolated straight-line
  if (!usingGraph) {
    routeDistance = haversine(fromLat, fromLng, toLat, toLng);
    const steps = Math.max(5, Math.round(routeDistance / 20));
    routeCoords = [[fromLng, fromLat]];
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      routeCoords.push([fromLng + (toLng - fromLng) * t, fromLat + (toLat - fromLat) * t]);
    }
    routeCoords.push([toLng, toLat]);
  }

  const walkingSpeedMps = 1.4;
  const etaSeconds = Math.round(routeDistance / walkingSpeedMps);
  const etaMinutes = Math.max(1, Math.round(etaSeconds / 60));

  const instructions = generateInstructions(routeCoords, routeDistance, etaMinutes);

  return {
    distance: Math.round(routeDistance),
    duration: etaSeconds,
    eta_minutes: etaMinutes,
    geometry: { type: 'LineString', coordinates: routeCoords },
    instructions,
    profile: 'walking',
    using_road_network: usingGraph
  };
}

function findNearestNode(lat, lng) {
  let nearest = null;
  let minDist = Infinity;
  const SEARCH_RADIUS = 400; // metres

  for (const [nodeId, coords] of Object.entries(nodeCoords)) {
    const d = haversine(lat, lng, coords[1], coords[0]);
    if (d < minDist && d < SEARCH_RADIUS) {
      minDist = d;
      nearest = nodeId;
    }
  }
  return nearest;
}

// Binary min-heap priority queue for Dijkstra
class MinHeap {
  constructor() { this.data = []; }
  push(item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  }
  pop() {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }
  get size() { return this.data.length; }
  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent].dist <= this.data[i].dist) break;
      [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
      i = parent;
    }
  }
  _sinkDown(i) {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.data[l].dist < this.data[smallest].dist) smallest = l;
      if (r < n && this.data[r].dist < this.data[smallest].dist) smallest = r;
      if (smallest === i) break;
      [this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]];
      i = smallest;
    }
  }
}

function dijkstra(startId, endId) {
  const dist = { [startId]: 0 };
  const prev = {};
  const visited = new Set();
  const heap = new MinHeap();
  heap.push({ id: startId, dist: 0 });

  while (heap.size > 0) {
    const { id: current, dist: currentDist } = heap.pop();

    if (visited.has(current)) continue;
    visited.add(current);

    if (current === endId) break;

    const neighbors = roadGraph[current] || [];
    for (const { id: neighbor, dist: edgeDist } of neighbors) {
      if (visited.has(neighbor)) continue;
      const newDist = currentDist + edgeDist;
      if (newDist < (dist[neighbor] ?? Infinity)) {
        dist[neighbor] = newDist;
        prev[neighbor] = current;
        heap.push({ id: neighbor, dist: newDist });
      }
    }
  }

  if (dist[endId] === undefined) return null;

  // Reconstruct path
  const nodes = [];
  let cur = endId;
  while (cur !== undefined) {
    nodes.unshift(cur);
    cur = prev[cur];
  }

  return { nodes, distance: dist[endId] };
}

// ============================================================
// Turn-by-turn Instructions
// ============================================================
function generateInstructions(coords, totalDistance, etaMinutes) {
  if (coords.length < 2) {
    return [{ type: 'arrive', text: 'You have arrived', distance: 0 }];
  }

  const instructions = [];
  const initialBearing = getBearing(coords[0][1], coords[0][0], coords[1][1], coords[1][0]);
  instructions.push({
    type: 'depart',
    text: `Head ${bearingToCompass(initialBearing)}`,
    distance: 0,
    bearing: Math.round(initialBearing)
  });

  // Detect significant turns
  let segmentDist = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const d = haversine(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
    segmentDist += d;

    const b1 = getBearing(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    const b2 = getBearing(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
    const turn = ((b2 - b1 + 540) % 360) - 180;

    if (Math.abs(turn) > 25 && segmentDist > 30) {
      const turnDir = turn > 0 ? 'right' : 'left';
      const sharpness = Math.abs(turn) > 100 ? 'Sharp ' : (Math.abs(turn) > 60 ? '' : 'Slight ');
      instructions.push({
        type: 'turn',
        text: `${sharpness}Turn ${turnDir}`,
        distance: Math.round(segmentDist),
        bearing: Math.round(b2)
      });
      segmentDist = 0;
    }
  }

  instructions.push({
    type: 'arrive',
    text: `Arrive at destination (${Math.round(totalDistance)}m · ${etaMinutes} min walk)`,
    distance: Math.round(totalDistance)
  });

  return instructions;
}

// ============================================================
// Utilities
// ============================================================
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBearing(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function bearingToCompass(bearing) {
  const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return dirs[Math.round(bearing / 45) % 8];
}

function levenshteinLite(a, b) {
  if (a.length > b.length) [a, b] = [b, a];
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist + (b.length - a.length);
}

// ============================================================
// Start Server
// ============================================================
app.listen(PORT, () => {
  console.log(`\n🗺️  IITJ Maps Server v3 running at http://localhost:${PORT}`);
  console.log(`   📍 ${searchIndex.length} places loaded`);
  console.log(`   🏗️  ${buildings.features.length} buildings`);
  console.log(`   🛤️  ${roads.features.length} roads`);
  console.log(`   🌳 ${areas.features.length} named areas`);
  console.log(`   🔀 ${Object.keys(roadGraph).length} road graph nodes`);
  console.log(`   📂 ${categories.length} categories\n`);
});
