/**
 * IITJ Maps — Client-side Routing Module
 * Replaces /api/v1/route backend endpoint.
 * Requires road-graph.json to be loaded via IITJData.init() (search.js).
 */

const IITJRouter = (() => {
  let _graph = null;
  let _nodeCoords = null;
  let _loaded = false;

  async function init() {
    const data = await fetch('/data/road-graph.json').then(r => r.json());
    _graph = data.graph;
    _nodeCoords = data.nodeCoords;
    _loaded = true;
  }

  // ── Geometry helpers ──────────────────────────────────────────
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const a = Math.sin((lat2 - lat1) * Math.PI / 360) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin((lng2 - lng1) * Math.PI / 360) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
      Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }

  function bearingToCompass(b) {
    const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
    return dirs[Math.round(b / 45) % 8];
  }

  // ── Binary min-heap ───────────────────────────────────────────
  class MinHeap {
    constructor() { this.data = []; }
    push(item) { this.data.push(item); this._up(this.data.length - 1); }
    pop() {
      const top = this.data[0];
      const last = this.data.pop();
      if (this.data.length) { this.data[0] = last; this._down(0); }
      return top;
    }
    get size() { return this.data.length; }
    _up(i) {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.data[p].dist <= this.data[i].dist) break;
        [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
        i = p;
      }
    }
    _down(i) {
      const n = this.data.length;
      while (true) {
        let s = i, l = 2 * i + 1, r = 2 * i + 2;
        if (l < n && this.data[l].dist < this.data[s].dist) s = l;
        if (r < n && this.data[r].dist < this.data[s].dist) s = r;
        if (s === i) break;
        [this.data[s], this.data[i]] = [this.data[i], this.data[s]];
        i = s;
      }
    }
  }

  // Drivable highway types — anything a car can navigate on campus.
  // Walking mode adds footway/cycleway/path on top of these.
  const DRIVABLE_TYPES = new Set([
    'trunk', 'trunk_link', 'primary', 'primary_link',
    'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
    'residential', 'service', 'unclassified', 'track', 'road', 'unknown',
  ]);

  function isAllowedEdge(edge, mode) {
    if (mode === 'walk') return true;
    return DRIVABLE_TYPES.has(edge.type);
  }

  // ── Dijkstra ──────────────────────────────────────────────────
  function dijkstra(startId, endId, mode = 'drive') {
    const dist = { [startId]: 0 };
    const prev = {};
    const visited = new Set();
    const heap = new MinHeap();
    heap.push({ id: startId, dist: 0 });

    while (heap.size > 0) {
      const { id: cur, dist: curDist } = heap.pop();
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (cur === endId) break;

      for (const edge of (_graph[cur] || [])) {
        if (!isAllowedEdge(edge, mode)) continue;
        const nb = edge.id;
        if (visited.has(nb)) continue;
        const nd = curDist + edge.dist;
        if (nd < (dist[nb] ?? Infinity)) {
          dist[nb] = nd;
          prev[nb] = cur;
          heap.push({ id: nb, dist: nd });
        }
      }
    }

    if (dist[endId] === undefined) return null;
    const nodes = [];
    let cur = endId;
    while (cur !== undefined) { nodes.unshift(cur); cur = prev[cur]; }
    return { nodes, distance: dist[endId] };
  }

  // Nearest node that participates in at least one edge allowed by the mode.
  function findNearestNode(lat, lng, radiusM = 400, mode = 'drive') {
    let nearest = null, minDist = Infinity;
    for (const [id, coords] of Object.entries(_nodeCoords)) {
      const edges = _graph[id] || [];
      if (!edges.some(e => isAllowedEdge(e, mode))) continue;
      const d = haversine(lat, lng, coords[1], coords[0]);
      if (d < minDist && d < radiusM) { minDist = d; nearest = id; }
    }
    return nearest;
  }

  // ── Turn instructions ─────────────────────────────────────────
  function generateInstructions(coords, totalDistance, etaMinutes) {
    if (coords.length < 2) return [{ type: 'arrive', text: 'You have arrived', distance: 0 }];

    const instructions = [];
    const initBearing = getBearing(coords[0][1], coords[0][0], coords[1][1], coords[1][0]);
    instructions.push({ type: 'depart', text: `Head ${bearingToCompass(initBearing)}`, distance: 0, bearing: Math.round(initBearing) });

    let segDist = 0;
    for (let i = 1; i < coords.length - 1; i++) {
      segDist += haversine(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
      const b1 = getBearing(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
      const b2 = getBearing(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
      const turn = ((b2 - b1 + 540) % 360) - 180;
      if (Math.abs(turn) > 25 && segDist > 30) {
        const dir = turn > 0 ? 'right' : 'left';
        const sharp = Math.abs(turn) > 100 ? 'Sharp ' : (Math.abs(turn) > 60 ? '' : 'Slight ');
        instructions.push({ type: 'turn', text: `${sharp}Turn ${dir}`, distance: Math.round(segDist), bearing: Math.round(b2) });
        segDist = 0;
      }
    }

    instructions.push({ type: 'arrive', text: `Arrive at destination (${Math.round(totalDistance)}m · ${etaMinutes} min walk)`, distance: Math.round(totalDistance) });
    return instructions;
  }

  // ── Public: compute route ─────────────────────────────────────
  // mode: 'drive' (default — main roads only, car-passable) or 'walk' (also
  // uses footways, cycleways, paths — shortcuts allowed).
  function computeRoute(fromLat, fromLng, toLat, toLng, mode = 'drive') {
    if (!_loaded) throw new Error('IITJRouter not initialised — call IITJRouter.init() first');
    if (mode !== 'walk') mode = 'drive';

    let coords = [], distance = 0, usingGraph = false, fellBackToWalk = false;

    function tryMode(m) {
      const fromNode = findNearestNode(fromLat, fromLng, 400, m);
      const toNode   = findNearestNode(toLat,   toLng,   400, m);
      if (!fromNode || !toNode || fromNode === toNode) return null;
      const path = dijkstra(fromNode, toNode, m);
      if (!path || path.nodes.length < 2) return null;
      return { path, fromNode, toNode };
    }

    let result = tryMode(mode);
    // Driving may fail when one endpoint is only reachable by a footway
    // (e.g. inside hostel quad). Fall back to walking so the user still
    // gets a route, but flag it so the UI can mention it.
    if (!result && mode === 'drive') {
      result = tryMode('walk');
      if (result) fellBackToWalk = true;
    }

    if (result) {
      usingGraph = true;
      const { path, fromNode, toNode } = result;
      coords = [[fromLng, fromLat]];
      for (const id of path.nodes) { const c = _nodeCoords[id]; if (c) coords.push(c); }
      coords.push([toLng, toLat]);
      distance = path.distance
        + haversine(fromLat, fromLng, _nodeCoords[fromNode][1], _nodeCoords[fromNode][0])
        + haversine(toLat, toLng,     _nodeCoords[toNode][1],   _nodeCoords[toNode][0]);
    }

    // Straight-line fallback (no graph reachable at all)
    if (!usingGraph) {
      distance = haversine(fromLat, fromLng, toLat, toLng);
      const steps = Math.max(5, Math.round(distance / 20));
      coords = [[fromLng, fromLat]];
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        coords.push([fromLng + (toLng - fromLng) * t, fromLat + (toLat - fromLat) * t]);
      }
      coords.push([toLng, toLat]);
    }

    // Driving ≈ 25 km/h on internal campus roads (≈7 m/s); walking ≈ 1.4 m/s
    const effectiveMode = fellBackToWalk ? 'walk' : mode;
    const speedMps = effectiveMode === 'drive' ? 7 : 1.4;
    const etaSec = Math.round(distance / speedMps);
    const etaMin = Math.max(1, Math.round(etaSec / 60));

    return {
      distance: Math.round(distance),
      duration: etaSec,
      eta_minutes: etaMin,
      geometry: { type: 'LineString', coordinates: coords },
      instructions: generateInstructions(coords, distance, etaMin),
      profile: effectiveMode === 'drive' ? 'driving' : 'walking',
      requested_mode: mode,
      fell_back_to_walk: fellBackToWalk,
      using_road_network: usingGraph,
    };
  }

  function isLoaded() { return _loaded; }

  return { init, computeRoute, isLoaded };
})();
