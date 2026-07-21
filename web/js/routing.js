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
    const data = await fetch('/data/road-graph.json?v=38').then(r => r.json());
    _graph = data.graph;
    _nodeCoords = data.nodeCoords;
    await applyOverlayToGraph();
    _loaded = true;
  }

  // ── Admin overlay → routing graph ─────────────────────────────
  // road-graph.json is generated OFFLINE by the pipeline, so an admin-accepted
  // OSM retag used to change only what the map DREW: the router kept the stale
  // edge and happily drove cars over ways OSM had retagged to cycleway/footway.
  // Here the overlay is folded into the in-memory graph at load time.
  //
  // The overlay stores raw OSM tags (highway/foot/bicycle) but NOT the derived
  // routing fields (vehicle_access, drive_confidence, drive_penalty), so those
  // are re-derived through web/js/road-classifier.js — the very module the
  // pipeline used to build the graph, so patched edges and baked edges agree.
  function _nodeId(lng, lat) {
    return `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  }

  function _isOneWay(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return s === 'yes' || s === '1' || s === 'true';
  }

  // Mirrors pushEdge() in backend/scripts/road-classifier.js.
  function _makeEdge(toId, dist, p, onewayReverse) {
    const t = p.highway_type || p.highway || 'unknown';
    return {
      id: toId,
      dist,
      osm_id: String(p.osm_id || ''),
      type: t,
      highway_type: t,
      name: p.name || '',
      navigation_class: p.navigation_class || 'unknown',
      vehicle_access: p.vehicle_access || 'no',
      walk_access: p.walk_access || 'yes',
      drive_confidence: Number(p.drive_confidence || 0),
      drive_penalty: p.drive_penalty == null ? null : Number(p.drive_penalty),
      oneway: _isOneWay(p.oneway),
      oneway_reverse: !!onewayReverse,
    };
  }

  async function applyOverlayToGraph() {
    const stats = { patched: 0, removed: 0, added: 0, isolated: 0, skipped: 0 };
    if (!_graph || typeof IITJOverlay === 'undefined') return stats;

    const RC = (typeof IITJRoadClassifier !== 'undefined') ? IITJRoadClassifier : null;
    if (!RC) {
      // Fail loud but keep routing on the baked graph rather than dying.
      console.warn('[router] road-classifier.js not loaded — admin overlay NOT applied to routing.');
      return stats;
    }

    let overlay;
    try { overlay = await IITJOverlay.init(); } catch (_) { return stats; }
    if (!overlay) return stats;

    const overrides = overlay.roads || {};
    const deleted = new Set(((overlay.deleted && overlay.deleted.roads) || []).map(String));
    if (!Object.keys(overrides).length && !deleted.size) return stats;

    const classify = (f) => {
      const cls = RC.classifyRoadFeature(f);
      return { ...(f.properties || {}), ...cls };
    };

    // 1. Deleted roads — drop their edges entirely (not routable on foot either).
    if (deleted.size) {
      for (const n of Object.keys(_graph)) {
        const before = _graph[n].length;
        _graph[n] = _graph[n].filter(e => !deleted.has(String(e.osm_id)));
        stats.removed += before - _graph[n].length;
      }
    }

    // 2. Roads already in the graph — re-classify and patch every edge in place.
    const present = new Set();
    for (const n of Object.keys(_graph)) {
      for (const e of _graph[n]) {
        const id = String(e.osm_id);
        const f = overrides[id];
        if (!f || deleted.has(id)) continue;
        present.add(id);
        let p;
        try { p = classify(f); } catch (_) { stats.skipped++; continue; }
        const t = p.highway_type || p.highway || e.type;
        e.type = t;
        e.highway_type = t;
        e.navigation_class = p.navigation_class || e.navigation_class;
        e.vehicle_access = p.vehicle_access || 'no';
        e.walk_access = p.walk_access || 'yes';
        e.drive_confidence = Number(p.drive_confidence || 0);
        e.drive_penalty = p.drive_penalty == null ? null : Number(p.drive_penalty);
        stats.patched++;
      }
    }

    // 3. Net-new roads — splice in using the pipeline's node-id scheme, so a way
    //    that shares a vertex with an existing road connects to the network.
    //    One that touches nothing is counted as isolated and reported, never
    //    silently dropped (it would be unreachable and skew nothing but noise).
    for (const [id, f] of Object.entries(overrides)) {
      if (present.has(id) || deleted.has(id)) continue;
      const g = f && f.geometry;
      const coords = g && g.type === 'LineString' ? g.coordinates : null;
      if (!coords || coords.length < 2) { stats.skipped++; continue; }

      let p;
      try { p = classify(f); } catch (_) { stats.skipped++; continue; }
      const oneway = _isOneWay(p.oneway);
      let connects = false;

      for (let i = 0; i < coords.length - 1; i++) {
        const aId = _nodeId(coords[i][0], coords[i][1]);
        const bId = _nodeId(coords[i + 1][0], coords[i + 1][1]);
        if (_graph[aId] || _graph[bId]) connects = true;
        _nodeCoords[aId] = coords[i];
        _nodeCoords[bId] = coords[i + 1];
        if (!_graph[aId]) _graph[aId] = [];
        if (!_graph[bId]) _graph[bId] = [];
        const dist = haversine(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
        _graph[aId].push(_makeEdge(bId, dist, p, false));
        _graph[bId].push(_makeEdge(aId, dist, p, oneway));
        stats.added++;
      }
      if (!connects) stats.isolated++;
    }

    if (stats.patched || stats.removed || stats.added) {
      console.info('[router] admin overlay applied to routing graph:', stats);
    }
    if (stats.isolated) {
      console.warn(`[router] ${stats.isolated} overlay road(s) share no vertex with the ` +
        `existing network — they are added but unreachable. Re-run the offline ` +
        `pipeline (merge-roads.js) to stitch them in properly.`);
    }
    return stats;
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

  function projectOntoSegment(lat, lng, lat1, lng1, lat2, lng2) {
    const dx = lng2 - lng1, dy = lat2 - lat1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((lng - lng1) * dx + (lat - lat1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    return { lat: lat1 + t * dy, lng: lng1 + t * dx, t };
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

  // Legacy fallback for old graph files. Current road-graph.json carries
  // explicit vehicle_access / drive_penalty fields generated by
  // backend/scripts/road-classifier.js.
  const DRIVABLE_TYPES = new Set([
    'trunk', 'trunk_link', 'primary', 'primary_link',
    'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
    'residential', 'service', 'unclassified',
  ]);

  function isAllowedEdge(edge, mode, opts = {}) {
    if (mode === 'walk') return edge.walk_access !== 'no';

    // OSM one-way service spurs into security gates block the reverse edge in
    // the graph, but vehicles routinely exit the gate back onto the trunk link.
    if (edge.oneway_reverse) {
      if (opts.allowGateExit
        && edge.navigation_class === 'campus_service_connector'
        && edge.vehicle_access === 'yes') {
        return (Number(edge.drive_confidence) || 0) >= 0.5;
      }
      return false;
    }
    if (edge.vehicle_access === 'yes') {
      return (Number(edge.drive_confidence) || 0) >= 0.5;
    }
    if (edge.vehicle_access === 'destination') {
      return !!opts.allowDestination && (Number(edge.drive_confidence) || 0) >= 0.5;
    }
    if (edge.vehicle_access === 'no') return false;

    return DRIVABLE_TYPES.has(edge.type || edge.highway_type);
  }

  function edgeCost(edge, mode, curId, nbId) {
    if (mode === 'walk') return edge.dist;
    let cost = edge.dist;
    const p = Number(edge.drive_penalty);
    if (Number.isFinite(p) && p > 0) cost *= p;
    else {
      const t = edge.type || edge.highway_type;
      if (t === 'service') cost *= 3.0;
      else if (t === 'residential') cost *= 1.25;
      else if (t === 'unclassified') cost *= 1.1;
    }
    return cost;
  }

  function _bearingDelta(b1, b2) {
    let delta = Math.abs(b1 - b2);
    if (delta > 180) delta = 360 - delta;
    return delta;
  }

  // India keeps left — Brain Tree roundabout must be circled on the west side
  // when approaching from the south gate toward north-campus destinations.
  const BRAIN_TREE_CENTER = { lat: 26.4692796, lng: 73.1141633 };
  const BRAIN_TREE_WEST_VIA = '26.469129,73.113752'; // west ring, ~270° from centre
  // Short cuts across the ring that skip the left-side circulation (both directions).
  const ROUNDABOUT_CHORDS = new Set([
    '26.468769,73.114261|26.468827,73.114328',
    '26.468827,73.114328|26.468769,73.114261',
  ]);

  function _isRoundaboutChord(curId, nbId) {
    return ROUNDABOUT_CHORDS.has(`${curId}|${nbId}`);
  }

  function _needsBrainTreeWestArc(fromLat, fromLng, toLat, toLng) {
    if (fromLat >= BRAIN_TREE_CENTER.lat - 0.0008) return false;
    if (toLat <= BRAIN_TREE_CENTER.lat + 0.0012) return false;
    const dFrom = haversine(fromLat, fromLng, BRAIN_TREE_CENTER.lat, BRAIN_TREE_CENTER.lng);
    const dTo = haversine(toLat, toLng, BRAIN_TREE_CENTER.lat, BRAIN_TREE_CENTER.lng);
    return dFrom > 75 && dTo > 75;
  }

  // Prithvi Missile roundabout — India keeps left, so a car entering from the
  // south gate / Security Checkpost and heading north must circle the monument
  // CLOCKWISE (south-west / left side), not cut counter-clockwise up the
  // east/right side. The route enters the ring at its SE node and would short-
  // cut up the east; forcing the ring's SW node as a via makes leg 1 take the
  // short clockwise (left) arc, and leg 2 carries on clockwise to the NW exit.
  const PRITHVI_CENTER = { lat: 26.4669087, lng: 73.1147901 };
  const PRITHVI_WEST_VIA = '26.466828,73.114663'; // SW node of the missile ring (node 5729732486)
  function _needsPrithviWestArc(fromLat, fromLng, toLat, toLng) {
    if (fromLat >= PRITHVI_CENTER.lat + 0.0003) return false;     // start at/south of missile
    if (toLat <= PRITHVI_CENTER.lat + 0.0009) return false;       // destination clearly north
    const dFrom = haversine(fromLat, fromLng, PRITHVI_CENTER.lat, PRITHVI_CENTER.lng);
    return dFrom < 180;                                           // only when starting by the missile
  }

  // Penalise the first graph hop when it points away from the destination.
  // Without this, Dijkstra leaves a gate via a cheaper service spur toward a
  // monument (Prithvi) even though the trunk road is right ahead.
  function _departHopMultiplier(curId, nbId, fromLat, fromLng, toLat, toLng) {
    if (fromLat == null || toLat == null) return 1;
    const c0 = _nodeCoords[curId], c1 = _nodeCoords[nbId];
    if (!c0 || !c1) return 1;
    const hopB = getBearing(c0[1], c0[0], c1[1], c1[0]);
    const destB = getBearing(fromLat, fromLng, toLat, toLng);
    const delta = _bearingDelta(hopB, destB);
    if (delta <= 50) return 1;
    if (delta <= 90) return 2.5;
    return 8;
  }

  // ── Dijkstra ──────────────────────────────────────────────────
  function dijkstra(startId, endId, mode = 'drive', opts = {}) {
    const dist = { [startId]: 0 };
    const physicalDist = { [startId]: 0 };
    const prev = {};
    const visited = new Set();
    const heap = new MinHeap();
    heap.push({ id: startId, dist: 0 });
    const departBias = opts.departFromLat != null && opts.departToLat != null;

    while (heap.size > 0) {
      const { id: cur, dist: curDist } = heap.pop();
      if (visited.has(cur)) continue;
      visited.add(cur);
      if (cur === endId) break;

      for (const edge of (_graph[cur] || [])) {
        if (!isAllowedEdge(edge, mode, opts)) continue;
        if (mode === 'drive' && _isRoundaboutChord(cur, edge.id)) continue;
        const nb = edge.id;
        if (visited.has(nb)) continue;
        let step = edgeCost(edge, mode, cur, nb);
        if (departBias && cur === startId) {
          step *= _departHopMultiplier(
            cur, nb, opts.departFromLat, opts.departFromLng, opts.departToLat, opts.departToLng
          );
        }
        const nd = curDist + step;
        if (nd < (dist[nb] ?? Infinity)) {
          dist[nb] = nd;
          physicalDist[nb] = (physicalDist[cur] ?? 0) + edge.dist;
          prev[nb] = cur;
          heap.push({ id: nb, dist: nd });
        }
      }
    }

    if (dist[endId] === undefined) return null;
    const nodes = [];
    let cur = endId;
    while (cur !== undefined) { nodes.unshift(cur); cur = prev[cur]; }
    return { nodes, distance: physicalDist[endId] ?? dist[endId], cost: dist[endId] };
  }

  // Force keep-left circulation through the south-campus rings when driving
  // from the south gate / Security Checkpost to north campus. A trip can pass
  // BOTH the Prithvi Missile roundabout (first, nearer the gate) and the Brain
  // Tree ring (further north), so chain the via-waypoints south→north in order.
  function routeGraph(startId, endId, mode, opts, fromLat, fromLng, toLat, toLng) {
    const vias = [];
    if (mode === 'drive') {
      if (_needsPrithviWestArc(fromLat, fromLng, toLat, toLng)) vias.push(PRITHVI_WEST_VIA);
      if (_needsBrainTreeWestArc(fromLat, fromLng, toLat, toLng)) vias.push(BRAIN_TREE_WEST_VIA);
    }
    if (!vias.length) return dijkstra(startId, endId, mode, opts);

    const waypoints = [startId, ...vias, endId];
    const legs = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const leg = dijkstra(waypoints[i], waypoints[i + 1], mode, opts);
      if (!leg) return dijkstra(startId, endId, mode, opts); // any leg fails → plain route
      legs.push(leg);
    }

    let nodes = legs[0].nodes;
    let distance = legs[0].distance;
    for (let i = 1; i < legs.length; i++) {
      nodes = [...nodes, ...legs[i].nodes.slice(1)];
      distance += legs[i].distance;
    }
    return { nodes, distance, cost: distance };
  }

  // Campus centroid — berm shops must be approached from the campus-facing
  // sandstone-gate road, not the service road behind the berm ribbons.
  const CAMPUS_CENTER = { lng: 73.1147, lat: 26.4727 };

  // Score a candidate snap node. Lower is better. Nodes that lie behind the
  // user relative to the destination (or campus centre) are heavily penalised
  // so a gate on the south perimeter doesn't snap to the outer service road
  // behind it when the campus entry road is right ahead.
  function _nodeSnapScore(lat, lng, coords, distM, opts = {}) {
    let dLng, dLat;
    // Berm destinations must snap to the campus-facing road — never let a
    // toward-origin vector override that (it picks the rear service road on
    // east/west perimeter ribbons when coming from a gate).
    if (opts.preferCampusSide) {
      dLng = CAMPUS_CENTER.lng - lng;
      dLat = CAMPUS_CENTER.lat - lat;
    } else if (opts.towardLat != null && opts.towardLng != null) {
      dLng = opts.towardLng - lng;
      dLat = opts.towardLat - lat;
    } else {
      return distM;
    }
    const magSq = dLng * dLng + dLat * dLat;
    if (magSq < 1e-14) return distM;
    const dot = (coords[0] - lng) * dLng + (coords[1] - lat) * dLat;
    if (dot <= 0) return distM + 120;
    const align = dot / (Math.sqrt(magSq) * Math.max(distM, 1));
    return distM - align * 20;
  }

  // India keeps left — on the final approach the destination should sit on the
  // driver's left, not the right-hand (outer) carriageway / berm backside.
  function _isDestOnLeft(travelBearingDeg, atLat, atLng, destLat, destLng) {
    const rad = travelBearingDeg * Math.PI / 180;
    const fx = Math.sin(rad);
    const fy = Math.cos(rad);
    const dLng = (destLng - atLng) * Math.cos(atLat * Math.PI / 180);
    const dLat = destLat - atLat;
    return (fx * dLat - fy * dLng) > 0;
  }

  // True when a graph node lies on the campus-interior side of the destination
  // (west of east-berm POIs, east of west-berm POIs, etc.).
  function _nodeOnCampusSideOf(coords, destLat, destLng) {
    const toCampusLng = CAMPUS_CENTER.lng - destLng;
    const toCampusLat = CAMPUS_CENTER.lat - destLat;
    const nodeLng = coords[0] - destLng;
    const nodeLat = coords[1] - destLat;
    return (nodeLng * toCampusLng + nodeLat * toCampusLat) > 0;
  }

  function _pathArrivalPenalty(pathNodes, destLat, destLng, mode, preferCampusSide) {
    if (mode !== 'drive' || pathNodes.length < 2) return 0;
    const prev = _nodeCoords[pathNodes[pathNodes.length - 2]];
    const last = _nodeCoords[pathNodes[pathNodes.length - 1]];
    if (!prev || !last) return 0;

    const bearing = getBearing(prev[1], prev[0], last[1], last[0]);
    const endPt = projectOntoSegment(destLat, destLng, prev[1], prev[0], last[1], last[0]);
    let penalty = 0;

    if (!_isDestOnLeft(bearing, endPt.lat, endPt.lng, destLat, destLng)) {
      penalty += 280;
    }
    if (preferCampusSide && !_nodeOnCampusSideOf(last, destLat, destLng)) {
      penalty += 450;
    }
    return penalty;
  }

  // Nearest node that participates in at least one edge allowed by the mode.
  // towardLat/towardLng — prefer nodes on the destination side of the point.
  // preferCampusSide — prefer nodes toward CAMPUS_CENTER (berm gates, S entry).
  function findNearestNode(lat, lng, radiusM = 400, mode = 'drive', opts = {}) {
    let best = null, bestScore = Infinity;
    for (const [id, coords] of Object.entries(_nodeCoords)) {
      const edges = _graph[id] || [];
      if (!edges.some(e => isAllowedEdge(e, mode, opts))) continue;
      const d = haversine(lat, lng, coords[1], coords[0]);
      if (d >= radiusM) continue;
      const score = _nodeSnapScore(lat, lng, coords, d, opts);
      if (score < bestScore) { bestScore = score; best = id; }
    }
    return best;
  }

  // Top-K snap candidates for multi-path selection at the origin. Always
  // includes every node within LOCAL_RADIUS_M so a gate 35 m from a cluster
  // of nearer-but-wrong service-road nodes is still considered.
  const LOCAL_RADIUS_M = 55;
  // Never pick a graph node farther than this beyond the user's nearest snap —
  // otherwise departure-progress scoring drags the route start 50–60 m away
  // (e.g. Security Checkpost puck → Prithvi Missile road).
  const ORIGIN_SNAP_EXTRA_M = 20;
  const ORIGIN_SNAP_MAX_M = 35;

  function findCandidateNodes(lat, lng, radiusM = 400, mode = 'drive', opts = {}, limit = 6) {
    const byScore = [];
    const local = [];
    for (const [id, coords] of Object.entries(_nodeCoords)) {
      const edges = _graph[id] || [];
      if (!edges.some(e => isAllowedEdge(e, mode, opts))) continue;
      const d = haversine(lat, lng, coords[1], coords[0]);
      if (d >= radiusM) continue;
      const entry = { id, dist: d, score: _nodeSnapScore(lat, lng, coords, d, opts) };
      byScore.push(entry);
      if (d <= LOCAL_RADIUS_M) local.push(entry);
    }
    byScore.sort((a, b) => a.score - b.score || a.dist - b.dist);

    const seen = new Set();
    const merged = [];
    for (const entry of [...local, ...byScore.slice(0, limit)]) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      merged.push(entry);
    }
    return merged;
  }

  // Always include the closest drivable snap so destinations like E-15 don't
  // land on a distant road node just because it has a cheaper graph path.
  function ensureNearestSnap(candidates, lat, lng, mode, opts, withinM = 20) {
    let nearest = null, nearestD = Infinity;
    for (const [id, coords] of Object.entries(_nodeCoords)) {
      const edges = _graph[id] || [];
      if (!edges.some(e => isAllowedEdge(e, mode, opts))) continue;
      const d = haversine(lat, lng, coords[1], coords[0]);
      if (d < nearestD) { nearestD = d; nearest = { id, dist: d, score: _nodeSnapScore(lat, lng, coords, d, opts) }; }
    }
    if (!nearest || nearestD > withinM) return candidates;
    if (candidates.some(c => c.id === nearest.id)) return candidates;
    return [nearest, ...candidates];
  }

  // Smallest outbound bearing error from a node toward the destination.
  function _minDepartDelta(nodeId, fromLat, fromLng, toLat, toLng, mode, opts) {
    const c0 = _nodeCoords[nodeId];
    if (!c0) return 180;
    const destB = getBearing(fromLat, fromLng, toLat, toLng);
    let best = 180;
    for (const e of (_graph[nodeId] || [])) {
      if (!isAllowedEdge(e, mode, opts)) continue;
      const c1 = _nodeCoords[e.id];
      if (!c1) continue;
      const hopB = getBearing(c0[1], c0[0], c1[1], c1[0]);
      best = Math.min(best, _bearingDelta(hopB, destB));
    }
    return best;
  }

  function _firstHopMisalignment(fromNodeId, pathNodes, fromLat, fromLng, toLat, toLng) {
    if (pathNodes.length < 2) return 0;
    const c0 = _nodeCoords[fromNodeId];
    const c1 = _nodeCoords[pathNodes[1]];
    if (!c0 || !c1) return 0;
    const hopB = getBearing(c0[1], c0[0], c1[1], c1[0]);
    const destB = getBearing(fromLat, fromLng, toLat, toLng);
    return _bearingDelta(hopB, destB);
  }

  // When the nearest snap is a one-way gate spur (only backward departures),
  // shift the origin to a nearby junction that faces the destination.
  function _forwardGateSnapNode(fromLat, fromLng, toLat, toLng, mode, opts) {
    const destB = getBearing(fromLat, fromLng, toLat, toLng);
    let nearest = null, nearestD = Infinity, nearestMis = 180;
    let forward = null, forwardScore = Infinity;

    for (const [id, coords] of Object.entries(_nodeCoords)) {
      const d = haversine(fromLat, fromLng, coords[1], coords[0]);
      if (d > 45) continue;
      const edges = _graph[id] || [];
      if (!edges.some(e => isAllowedEdge(e, mode, opts))) continue;
      const mis = _minDepartDelta(id, fromLat, fromLng, toLat, toLng, mode, opts);
      if (d < nearestD) { nearestD = d; nearest = id; nearestMis = mis; }
      if (mis > 50) continue;
      const score = d + mis * 0.6;
      if (score < forwardScore) { forwardScore = score; forward = id; }
    }

    if (!forward || forward === nearest) return null;
    if (nearestMis <= 55) return null;
    return forward;
  }

  // Score how much the first few hops move toward the destination. Campus
  // graphs often need a short connector before the main road — a pure bearing
  // check on hop 1 rejects those valid departures.
  function _departureProgress(fromNodeId, pathNodes, toLat, toLng, hops = 3) {
    const c0 = _nodeCoords[fromNodeId];
    if (!c0) return 0;
    const dLat = toLat - c0[1], dLng = toLng - c0[0];
    const magSq = dLat * dLat + dLng * dLng;
    if (magSq < 1e-14) return 0;
    let lat = c0[1], lng = c0[0], progress = 0;
    for (let i = 1; i < Math.min(hops + 1, pathNodes.length); i++) {
      const c = _nodeCoords[pathNodes[i]];
      if (!c) break;
      progress += (c[1] - lat) * dLat + (c[0] - lng) * dLng;
      lat = c[1];
      lng = c[0];
    }
    return progress / magSq;
  }

  // ── Turn instructions ─────────────────────────────────────────
  //
  // LEFT/RIGHT turn-by-turn guidance is intentionally NOT produced.
  //
  // The campus graph is hand-digitised, and the drive routes are deliberately
  // forced around the Brain Tree and Prithvi Missile roundabouts with via-
  // waypoints to keep left (India). That circulation is a loop, and on a loop
  // the "side" of a maneuver is genuinely ambiguous — the same arc can read as
  // a left or a right depending on which straight runs you compare. Every
  // method we tried (adjacent vertices, then arc-length straight-run baselines)
  // still flipped the reported side on those loops. Rather than announce a
  // turn direction that might be wrong, guidance is limited to the initial
  // travel heading + live distance/ETA, then arrival. No `turn` steps are
  // emitted, so nothing downstream (banner, "Then" line, voice) can announce
  // a left/right that we can't stand behind.
  function generateInstructions(coords, totalDistance, etaMinutes) {
    if (coords.length < 2) return [{ type: 'arrive', text: 'You have arrived', distance: 0 }];

    const n = coords.length;

    // Initial travel bearing over roughly the first W metres of the route.
    // This is a compass heading ("Head north-west"), not a left/right turn, so
    // it stays accurate regardless of the roundabout geometry above.
    const W = 16;
    let acc = 0, far = coords[n - 1];
    for (let i = 1; i < n; i++) {
      acc += haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
      if (acc >= W) { far = coords[i]; break; }
    }
    const initBearing = getBearing(coords[0][1], coords[0][0], far[1], far[0]);

    return [
      { type: 'depart', text: `Head ${bearingToCompass(initBearing)}`, distance: 0, bearing: Math.round(initBearing), coord_index: 0 },
      { type: 'arrive', text: 'You have arrived', distance: Math.round(totalDistance), bearing: 0, coord_index: n - 1 },
    ];
  }

  // ── Public: compute route ─────────────────────────────────────
  // mode: 'drive' (default — main roads only, car-passable) or 'walk' (also
  // uses footways, cycleways, paths — shortcuts allowed).
  function computeRoute(fromLat, fromLng, toLat, toLng, mode = 'drive', routeOpts = {}) {
    if (!_loaded) throw new Error('IITJRouter not initialised — call IITJRouter.init() first');
    if (mode !== 'walk') mode = 'drive';

    const preferCampusSideTo = !!routeOpts.preferCampusSideTo;
    let coords = [], distance = 0, usingGraph = false, fellBackToWalk = false, usedDestinationAccess = false;

    const southGateOrigin = fromLat < CAMPUS_CENTER.lat - 0.002;
    const fromSnapOpts = {
      towardLat: toLat,
      towardLng: toLng,
      preferCampusSide: southGateOrigin,
    };
    const toSnapOpts = preferCampusSideTo
      ? { preferCampusSide: true }
      : { towardLat: fromLat, towardLng: fromLng };

    function tryMode(m, opts = {}) {
      let toCandidates = findCandidateNodes(
        toLat, toLng, 400, m, { ...opts, ...toSnapOpts }, preferCampusSideTo ? 8 : 6
      );
      toCandidates = ensureNearestSnap(toCandidates, toLat, toLng, m, { ...opts, ...toSnapOpts });
      if (!toCandidates.length) return null;
      const nearestToDist = Math.min(...toCandidates.map(c => c.dist));
      // Prefer snaps within ~35 m of the destination; avoids overshooting to a
      // campus-interior node past the building (e.g. E-15 berm).
      const nearDest = toCandidates.filter(c => c.dist <= 35);
      const toPool = nearDest.length ? nearDest : toCandidates;

      const routeOpts = {
        ...opts,
        allowGateExit: southGateOrigin && m === 'drive',
        departFromLat: fromLat,
        departFromLng: fromLng,
        departToLat: toLat,
        departToLng: toLng,
      };

      const fromCandidates = findCandidateNodes(fromLat, fromLng, 400, m, { ...opts, ...fromSnapOpts });
      if (!fromCandidates.length) return null;

      const gateSnap = _forwardGateSnapNode(fromLat, fromLng, toLat, toLng, m, routeOpts);
      if (gateSnap) {
        const existing = fromCandidates.find(c => c.id === gateSnap);
        if (existing) {
          existing.gateForward = true;
        } else {
          const c = _nodeCoords[gateSnap];
          fromCandidates.unshift({
            id: gateSnap,
            dist: haversine(fromLat, fromLng, c[1], c[0]),
            score: _nodeSnapScore(fromLat, fromLng, c, haversine(fromLat, fromLng, c[1], c[0]), fromSnapOpts),
            gateForward: true,
          });
        }
      }

      const nearestDist = Math.min(...fromCandidates.map(c => c.dist));
      const snapBand = Math.min(nearestDist + ORIGIN_SNAP_EXTRA_M, ORIGIN_SNAP_MAX_M);
      const viable = fromCandidates.filter(c => c.dist <= snapBand || c.gateForward || c.id === gateSnap);
      const pool = viable.length ? viable : fromCandidates;

      let best = null;
      let fallback = null;
      for (const cand of pool) {
        for (const toCand of toPool) {
          if (cand.id === toCand.id) continue;
          const path = routeGraph(
            cand.id, toCand.id, m, routeOpts, fromLat, fromLng, toLat, toLng
          );
          if (!path || path.nodes.length < 2) continue;
          const progress = _departureProgress(cand.id, path.nodes, toLat, toLng);
          const hopMis = _firstHopMisalignment(cand.id, path.nodes, fromLat, fromLng, toLat, toLng);
          const arrivalPenalty = _pathArrivalPenalty(path.nodes, toLat, toLng, m, preferCampusSideTo);
          const toNodeCoords = _nodeCoords[toCand.id];
          const campusSnapPenalty = (preferCampusSideTo && toNodeCoords &&
            !_nodeOnCampusSideOf(toNodeCoords, toLat, toLng)) ? 200 : 0;
          const rank = path.distance
            + (cand.dist - nearestDist) * 4
            + toCand.dist * 25
            + cand.score * 0.15
            + toCand.score * 0.1
            + arrivalPenalty
            + campusSnapPenalty
            + (progress < 0 ? hopMis * 12 : 0)
            - progress * 20;
          const entry = {
            path, fromNode: cand.id, toNode: toCand.id, opts: routeOpts, rank, progress, hopMis,
            arrivalPenalty,
          };
          if (hopMis <= 95 && progress >= -0.00002 && arrivalPenalty < 200) {
            if (!best || rank < best.rank) best = entry;
          } else if (!fallback || rank < fallback.rank) {
            fallback = entry;
          }
        }
      }
      return best || fallback;
    }

    let result = mode === 'drive'
      ? (tryMode('drive', { allowDestination: false }) || tryMode('drive', { allowDestination: true }))
      : tryMode('walk');
    usedDestinationAccess = !!result?.opts?.allowDestination;
    if (!result && mode === 'drive') {
      return {
        error: 'No reliable drivable campus-road route found near the selected points. Try walking mode for pedestrian shortcuts.',
        distance: 0,
        duration: 0,
        eta_minutes: 0,
        geometry: { type: 'LineString', coordinates: [] },
        instructions: [],
        profile: 'driving',
        requested_mode: mode,
        fell_back_to_walk: false,
        used_destination_access: false,
        using_road_network: false,
      };
    }

    if (result) {
      usingGraph = true;
      const { path, fromNode, toNode } = result;
      const nodeList = path.nodes;

      const firstNc = _nodeCoords[fromNode];
      const secondNc = nodeList.length > 1 ? _nodeCoords[nodeList[1]] : null;
      const lastNc = _nodeCoords[toNode];
      const prevNc = nodeList.length > 1 ? _nodeCoords[nodeList[nodeList.length - 2]] : null;

      // Snap departure onto the first road segment — never draw a straight
      // chord across open ground; every leg after that follows graph edges.
      const startPt = secondNc
        ? projectOntoSegment(fromLat, fromLng, firstNc[1], firstNc[0], secondNc[1], secondNc[0])
        : { lat: firstNc[1], lng: firstNc[0], t: 0 };
      const endPt = prevNc
        ? projectOntoSegment(toLat, toLng, prevNc[1], prevNc[0], lastNc[1], lastNc[0])
        : { lat: lastNc[1], lng: lastNc[0], t: 0 };

      const startNodeIdx = secondNc && startPt.t > 0.35 ? 1 : 0;

      // The destination often sits alongside a road that CONTINUES past the
      // final graph node rather than the segment the route arrived on, and
      // projectOntoSegment clamps to that arrival segment — so the line stopped
      // at the node and visibly fell short of the pin. Look one edge beyond the
      // end: if the destination projects onto a road the route may legally
      // carry on along, follow it to that projection. Only a strictly closer
      // (>1 m) landing wins, so ordinary arrivals are left untouched.
      // Walk up to TAIL_MAX_HOPS edges: when the projection lands on the far
      // node the destination is still further along, so traverse it and look
      // again. Bounded so a bad snap can't send the line wandering the campus.
      const TAIL_MAX_HOPS = 3;
      let tailPt = null;
      const tailCoords = [];
      let bestGap = haversine(toLat, toLng, endPt.lat, endPt.lng);
      let tailNodeId = toNode;
      let tailPrevId = nodeList.length > 1 ? nodeList[nodeList.length - 2] : null;
      const tailSeen = new Set([toNode]);
      for (let hop = 0; hop < TAIL_MAX_HOPS; hop++) {
        const anchor = _nodeCoords[tailNodeId];
        if (!anchor) break;
        let step = null;
        for (const e of (_graph[tailNodeId] || [])) {
          if (e.id === tailPrevId || tailSeen.has(e.id)) continue;   // never double back
          if (!isAllowedEdge(e, mode, result.opts || {})) continue;
          const nb = _nodeCoords[e.id];
          if (!nb) continue;
          const p = projectOntoSegment(toLat, toLng, anchor[1], anchor[0], nb[1], nb[0]);
          if (p.t <= 0) continue;                                    // no progress along it
          const gap = haversine(toLat, toLng, p.lat, p.lng);
          if (gap < bestGap - 1 && (!step || gap < step.gap)) step = { gap, p, id: e.id, nb };
        }
        if (!step) break;
        bestGap = step.gap;
        tailPt = step.p;
        // Landed short of the far node — that projection is the end of the line.
        if (step.p.t < 0.999) break;
        tailCoords.push(step.nb);
        tailSeen.add(step.id);
        tailPrevId = tailNodeId;
        tailNodeId = step.id;
      }

      // Symmetric to the start: when the destination projects before the last
      // graph node (the snap node sits past the building, e.g. a berm POI
      // between two road nodes), end at the projection instead of routing all
      // the way to that node and visibly backtracking to it. Drop the node only
      // when keeping it would add a noticeable (>4 m) overshoot/backtrack.
      // A tail extension needs that node as its anchor, so keep it in that case.
      const lastSegLen = prevNc ? haversine(prevNc[1], prevNc[0], lastNc[1], lastNc[0]) : 0;
      const endNodeIdx = (!tailPt && prevNc && nodeList.length >= 3 && (1 - endPt.t) * lastSegLen > 4)
        ? nodeList.length - 2 : nodeList.length - 1;
      coords = [[startPt.lng, startPt.lat]];
      for (let i = startNodeIdx; i <= endNodeIdx; i++) {
        const c = _nodeCoords[nodeList[i]];
        if (c) coords.push(c);
      }
      for (const c of tailCoords) coords.push(c);
      coords.push(tailPt ? [tailPt.lng, tailPt.lat] : [endPt.lng, endPt.lat]);

      // Drop consecutive duplicate / near-duplicate vertices (avoids zero-length u-turn legs).
      coords = coords.filter((c, i) => {
        if (i === 0) return true;
        const p = coords[i - 1];
        return haversine(p[1], p[0], c[1], c[0]) > 1.5;
      });

      distance = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        distance += haversine(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
      }
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
      used_destination_access: usedDestinationAccess,
      using_road_network: usingGraph,
    };
  }

  function isLoaded() { return _loaded; }

  return { init, computeRoute, isLoaded };
})();
