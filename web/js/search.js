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
  let _greens      = null;   // OSM grass / park / pitch / forest polygons
  let _searchTokens = null;
  let _ready       = false;
  const _readyCallbacks = [];

  // ── Loader ──────────────────────────────────────────────────
  async function init() {
    const base = '/data';
    const [places, buildings, roads, areas, searchIndex, categories, entrances, greens] = await Promise.all([
      fetch(`${base}/places.geojson`).then(r => r.json()),
      fetch(`${base}/buildings.geojson`).then(r => r.json()),
      fetch(`${base}/roads.geojson`).then(r => r.json()),
      fetch(`${base}/areas.geojson`).then(r => r.json()),
      fetch(`${base}/search-index.json`).then(r => r.json()),
      fetch(`${base}/categories.json`).then(r => r.json()),
      fetch(`${base}/entrances.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`${base}/greens.geojson`).then(r => r.ok ? r.json() : null).catch(() => null),
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
    _greens     = greens || { type: 'FeatureCollection', features: [] };

    // Pre-build search token strings once
    _searchTokens = searchIndex.map(entry => ({
      ...entry,
      _tokens: [
        entry.name.toLowerCase(),
        ...(entry.keywords || []).map(k => k.toLowerCase()),
        entry.category.toLowerCase(),
        (entry.description || '').toLowerCase(),
      ].join(' '),
    }));

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
    const query  = q.toLowerCase().trim();
    const words  = query.split(/\s+/);

    return _searchTokens
      .map(entry => {
        let score = 0;
        const nameL = entry.name.toLowerCase();

        if (nameL === query)            score += 100;
        else if (nameL.startsWith(query)) score += 80;
        else if (nameL.includes(query))  score += 60;

        for (const word of words) {
          if (word.length < 2) continue;
          if (nameL.includes(word))        score += 30;
          if (entry._tokens.includes(word)) score += 15;
          for (const tw of entry._tokens.split(/\s+/)) {
            if (tw.startsWith(word)) score += 10;
            if (word.length >= 3 && tw.length >= 3 && levenshteinLite(word, tw) <= 1) score += 5;
          }
        }
        return { ...entry, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
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
  function getGreens()    { return _greens    || { type: 'FeatureCollection', features: [] }; }
  function getCategories(){ return _categories || []; }

  // Returns the entry-point coordinates for a destination if one is mapped
  // (e.g. "Hostel B1" → { lat, lng } of its gate). Otherwise null.
  function getEntrance(name) {
    if (!_entrances || !name) return null;
    return _entrances[name] || _entrances[name.trim()] || null;
  }

  function nearby(lat, lng, radiusM = 500, limit = 10) {
    if (!_searchTokens) return [];
    return _searchTokens
      .map(entry => ({ ...entry, distance: haversine(lat, lng, entry.lat, entry.lng) }))
      .filter(r => r.distance <= radiusM)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  function isReady() { return _ready; }

  return { init, onReady, isReady, search, getPlaces, getBuildings, getRoads, getAreas, getGreens, getCategories, getEntrance, nearby };
})();
