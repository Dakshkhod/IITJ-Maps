/**
 * IITJ Maps — Client-side Search & Data Module
 * Replaces /api/v1/search, /api/v1/places, /api/v1/nearby, /api/v1/categories
 * All data loaded once from /data/*.json at startup.
 */

const IITJData = (() => {
  // ── State ───────────────────────────────────────────────────
  let _places      = null;
  let _buildings   = null;
  let _roads       = null;
  let _areas       = null;
  let _categories  = null;
  let _entrances   = null;   // { "Hostel B1": { lat, lng, gate_name, osm_id } }
  let _berms       = null;   // perimeter berm ribbon footprints (2D normal view)
  let _greens      = null;   // OSM grass / park / pitch / forest polygons
  let _searchTokens = null;
  let _ready       = false;
  const _readyCallbacks = [];

  // ── Loader ──────────────────────────────────────────────────
  async function init() {
    const base = '/data';
    const [places, buildings, roads, areas, searchIndex, categories, entrances, berms, greens] = await Promise.all([
      fetch(`${base}/places.geojson?v=46`).then(r => r.json()),
      fetch(`${base}/buildings.geojson?v=35`).then(r => r.json()),
      fetch(`${base}/roads.geojson?v=35`).then(r => r.json()),
      fetch(`${base}/areas.geojson?v=34`).then(r => r.json()),
      fetch(`${base}/search-index.json?v=42`).then(r => r.json()),
      fetch(`${base}/categories.json`).then(r => r.json()),
      fetch(`${base}/entrances.json?v=41`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`${base}/berms.geojson?v=3`).then(r => r.ok ? r.json() : { type: 'FeatureCollection', features: [] }).catch(() => ({ type: 'FeatureCollection', features: [] })),
      fetch(`${base}/greens.geojson?v=4`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    // Apply admin-approved OSM overlay (bundled + this browser's localStorage)
    // BEFORE we save the FCs — every downstream getter then sees the merged set.
    if (typeof IITJOverlay !== 'undefined') {
      try { await IITJOverlay.init(); } catch (_) {}
      _places    = IITJOverlay.apply(places,    'places');
      _buildings = IITJOverlay.apply(buildings, 'buildings');
      _roads     = IITJOverlay.apply(roads,     'roads');
      _areas     = IITJOverlay.apply(areas,     'areas');
    } else {
      _places = places; _buildings = buildings; _roads = roads; _areas = areas;
    }
    _categories = categories;
    _entrances  = entrances || {};
    _berms      = berms || { type: 'FeatureCollection', features: [] };
    _greens     = greens || { type: 'FeatureCollection', features: [] };

    // Pre-build search token strings once. `_nameNorm`/`_tokensNorm` are the
    // alphanumeric-only forms (no spaces, hyphens or dots) so codes like "E-6",
    // "Hostel B1" or "C.S.E." match when typed as "e6", "hostelb1", "cse".
    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    _searchTokens = searchIndex.map(entry => {
      const tokens = [
        entry.name.toLowerCase(),
        ...(entry.keywords || []).map(k => k.toLowerCase()),
        entry.category.toLowerCase(),
        (entry.description || '').toLowerCase(),
      ].join(' ');
      return {
        ...entry,
        _tokens: tokens,
        _nameNorm: norm(entry.name),
        _tokensNorm: tokens.split(/\s+/).map(norm).filter(Boolean),
      };
    });

    _ready = true;
    _readyCallbacks.forEach(cb => cb());
  }

  function onReady(cb) {
    if (_ready) cb();
    else _readyCallbacks.push(cb);
  }

  // ── Helpers ──────────────────────────────────────────────────
  function levenshteinLite(a, b) {
    if (a.length > b.length) [a, b] = [b, a];
    let dist = 0;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) dist++; }
    return dist + (b.length - a.length);
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const a = Math.sin((lat2 - lat1) * Math.PI / 360) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin((lng2 - lng1) * Math.PI / 360) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Public API ───────────────────────────────────────────────
  function search(q, limit = 10) {
    if (!_searchTokens || !q || q.length < 1) return [];
    const query     = q.toLowerCase().trim();
    const queryNorm = query.replace(/[^a-z0-9]/g, '');
    const words     = query.split(/\s+/);

    const seen = new Set();
    return _searchTokens
      .map(entry => {
        let score = 0;
        const nameL = entry.name.toLowerCase();

        if (nameL === query)            score += 100;
        else if (nameL.startsWith(query)) score += 80;
        else if (nameL.includes(query))  score += 60;

        // Separator-insensitive match on the whole query ("e6" → "E-6").
        const nameNorm = entry._nameNorm;
        if (queryNorm.length >= 2 && nameNorm) {
          if (nameNorm === queryNorm)            score += 95;
          else if (nameNorm.startsWith(queryNorm)) score += 72;
          else if (nameNorm.includes(queryNorm))   score += 48;
        }

        for (const word of words) {
          if (word.length < 2) continue;
          const wNorm = word.replace(/[^a-z0-9]/g, '');
          if (nameL.includes(word))        score += 30;
          if (entry._tokens.includes(word)) score += 15;
          for (const tw of entry._tokens.split(/\s+/)) {
            if (tw.startsWith(word)) score += 10;
            if (word.length >= 3 && tw.length >= 3 && levenshteinLite(word, tw) <= 1) score += 5;
          }
          // normalized per-token prefix match ("b1" → "Hostel B1")
          if (wNorm.length >= 2) {
            for (const tw of entry._tokensNorm) {
              if (tw === wNorm) { score += 12; break; }
              if (tw.startsWith(wNorm)) { score += 7; break; }
            }
          }
        }
        return { ...entry, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      // Collapse any same-name duplicates (e.g. a building + its POI point).
      .filter(r => { const k = r.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, limit);
  }

  function getPlaces(category = null) {
    if (!_places) return { type: 'FeatureCollection', features: [] };
    const features = category
      ? _places.features.filter(f => f.properties.category === category)
      : _places.features;
    return { type: 'FeatureCollection', features };
  }

  function getBuildings() { return _buildings || { type: 'FeatureCollection', features: [] }; }
  function getRoads()     { return _roads     || { type: 'FeatureCollection', features: [] }; }
  function getAreas()     { return _areas     || { type: 'FeatureCollection', features: [] }; }
  function getBerms()    { return _berms    || { type: 'FeatureCollection', features: [] }; }
  function getGreens()   { return _greens   || { type: 'FeatureCollection', features: [] }; }
  function getCategories(){ return _categories || []; }

  // Returns the entry-point coordinates for a destination if one is mapped
  // (e.g. "Hostel B1" → { lat, lng } of its gate). Otherwise null.
  function getEntrance(name) {
    if (!_entrances || !name) return null;
    return _entrances[name] || _entrances[name.trim()] || null;
  }

  // Berm POIs (W/E codes, societies on the blue wave-berms) route via their
  // sandstone-gate arch on the campus-facing side, not the rear service road.
  function isBermDestination(name, lat, lng) {
    if (!name) return false;
    const e = getEntrance(name);
    if (e && e.berm) return true;
    const n = name.trim();
    if (/^W-\d+$/i.test(n) || /^E-\d+$/i.test(n)) return true;
    if (lat == null || lng == null) return false;
    // West blue berm (ribbon 9748 / shopping row)
    if (lng < 73.1115 && lat > 26.474 && lat < 26.4772) return true;
    // East blue berms (ribbons 9743–9745 / 9749–9750)
    if (lng > 73.1175 && lat > 26.4725 && lat < 26.4775) return true;
    // SW berm bridge (ribbon 9746)
    if (lng > 73.1112 && lng < 73.1129 && lat > 26.4700 && lat < 26.4712) return true;
    return false;
  }

  function nearby(lat, lng, radiusM = 500, limit = 10) {
    if (!_searchTokens) return [];
    return _searchTokens
      .map(entry => ({ ...entry, distance: haversine(lat, lng, entry.lat, entry.lng) }))
      .filter(r => r.distance <= radiusM)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  // Resolve a place by (case-insensitive) name — exact match first, then the
  // best fuzzy search hit. Used for ?place=Name deep links and "open now".
  function getPlaceByName(name) {
    if (!name || !_searchTokens) return null;
    const n = String(name).toLowerCase().trim();
    let entry = _searchTokens.find(e => e.name.toLowerCase() === n);
    if (!entry) entry = search(name, 1)[0];
    if (!entry) return null;
    const { _tokens, _nameNorm, _tokensNorm, score, ...clean } = entry;
    return { ...clean, opening_hours: getOpeningHours(entry.name) };
  }

  // OSM opening_hours string for a place, looked up by name from the full
  // places FC (the search index doesn't carry it).
  function getOpeningHours(name) {
    if (!_places || !name) return null;
    const n = String(name).toLowerCase().trim();
    const f = _places.features.find(ft => (ft.properties && ft.properties.name || '').toLowerCase() === n);
    return f && f.properties ? (f.properties.opening_hours || null) : null;
  }

  function isReady() { return _ready; }

  return { init, onReady, isReady, search, getPlaces, getBuildings, getRoads, getAreas, getGreens, getBerms, getCategories, getEntrance, isBermDestination, nearby, getPlaceByName, getOpeningHours };
})();
