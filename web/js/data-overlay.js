/**
 * Merges admin-approved OSM changes into the bundled GeoJSON at runtime, from
 * two optional layers: /data/overlay.json (shared with all users) then
 * localStorage[iitj-overlay-v1] (admin-only, accepted in this browser since the
 * last export). So admins see their pending work; end-users see only the bundle.
 *
 * Both use the same shape: { buildings|places|roads|areas: { [osm_id]: Feature },
 * deleted: { buildings|places|roads|areas: [osm_id] }, version, updatedAt }.
 */
const IITJOverlay = (() => {
  const LS_KEY = 'iitj-overlay-v1';

  function emptyOverlay() {
    return {
      buildings: {}, places: {}, roads: {}, areas: {},
      deleted: { buildings: [], places: [], roads: [], areas: [] },
      version: 1,
      updatedAt: null,
    };
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return emptyOverlay();
      const o = JSON.parse(raw);
      // Forward-compat: backfill any missing fields
      return {
        ...emptyOverlay(),
        ...o,
        deleted: { ...emptyOverlay().deleted, ...(o.deleted || {}) },
      };
    } catch (_) {
      return emptyOverlay();
    }
  }

  function saveLocal(overlay) {
    overlay.updatedAt = new Date().toISOString();
    localStorage.setItem(LS_KEY, JSON.stringify(overlay));
  }

  async function loadBundled() {
    try {
      const res = await fetch('data/overlay.json', { cache: 'no-cache' });
      if (!res.ok) return emptyOverlay();
      const o = await res.json();
      return {
        ...emptyOverlay(),
        ...o,
        deleted: { ...emptyOverlay().deleted, ...(o.deleted || {}) },
      };
    } catch (_) {
      return emptyOverlay();
    }
  }

  // Merge two overlays — local takes precedence over bundled (admin sees their
  // freshest decisions before they commit).
  function combine(a, b) {
    const out = emptyOverlay();
    for (const kind of ['buildings', 'places', 'roads', 'areas']) {
      out[kind] = { ...(a[kind] || {}), ...(b[kind] || {}) };
      out.deleted[kind] = [
        ...new Set([...(a.deleted?.[kind] || []), ...(b.deleted?.[kind] || [])]),
      ];
    }
    return out;
  }

  let _combined = emptyOverlay();
  let _initialised = false;

  async function init() {
    if (_initialised) return _combined;
    const bundled = await loadBundled();
    const local   = loadLocal();
    _combined = combine(bundled, local);
    _initialised = true;
    return _combined;
  }

  // Apply overlay to a FeatureCollection in place: drop deleted, replace
  // modified by osm_id, append additions.
  function apply(fc, kind) {
    if (!fc || !fc.features) return fc;
    const overrides = _combined[kind] || {};
    const deletedSet = new Set((_combined.deleted?.[kind]) || []);
    const overrideIds = new Set(Object.keys(overrides));

    const features = [];
    const seen = new Set();
    for (const f of fc.features) {
      const id = String(f.properties?.osm_id || '');
      if (id && deletedSet.has(id)) continue;
      if (id && overrideIds.has(id)) {
        features.push(overrides[id]);
        seen.add(id);
      } else {
        features.push(f);
      }
    }
    // Net-new additions (osm_ids not in the base)
    for (const [id, f] of Object.entries(overrides)) {
      if (!seen.has(id)) features.push(f);
    }
    return { ...fc, features };
  }

  return {
    init,
    apply,
    loadLocal,
    saveLocal,
    loadBundled,
    emptyOverlay,
    combined: () => _combined,
  };
})();
