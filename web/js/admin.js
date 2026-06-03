/**
 * IITJ Maps — Admin Review Panel
 * 100% client-side: Overpass API → diff engine → localStorage queue → UI.
 * No backend required; the only server roundtrip is the static asset host
 * serving the bundled GeoJSON.
 */

// ============================================================
// Config
// ============================================================
const CAMPUS_BBOX = '26.4500,73.0900,26.4900,73.1300'; // south,west,north,east

// Overpass mirrors that ship CORS headers (required for browser-origin POST).
// Listed in preferred order — we try each in turn so a temporary outage on
// one mirror doesn't break the workflow. The main overpass-api.de host is
// NOT CORS-friendly for cross-origin browser requests, so it goes last as a
// hail-mary; usually one of the earlier mirrors responds first.
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const PENDING_KEY  = 'iitj-pending-changes-v1';
const LAST_SYNC_KEY = 'iitj-last-sync-v1';
const GATE_KEY      = 'iitj-admin-passphrase';
const GH_CFG_KEY    = 'iitj-github-config-v1';   // { owner, repo, branch, path, token }
const LAST_PUBLISH_KEY = 'iitj-last-publish-v1';

// Tags we DIFF (everything else is metadata churn from the OSM editor)
const DIFF_TAGS = {
  buildings: ['name', 'building', 'amenity', 'levels', 'building:levels', 'building:use', 'wheelchair', 'operator', 'addr:street'],
  roads:     ['name', 'highway', 'surface', 'lit', 'lanes', 'oneway', 'access', 'foot', 'bicycle'],
  places:    ['name', 'amenity', 'leisure', 'shop', 'sport', 'tourism', 'historic', 'man_made'],
  areas:     ['name', 'leisure', 'landuse', 'natural', 'sport'],
};

// OSM tag → which kind it routes to in our data model
function classify(tags) {
  if (!tags) return null;
  if (tags.building) return 'buildings';
  if (tags.highway)  return 'roads';
  if (tags.leisure || tags.landuse || tags.natural) return 'areas';
  if (tags.amenity || tags.shop || tags.tourism || tags.historic || tags.man_made || tags.office) return 'places';
  return null;
}

// ============================================================
// Storage (single source of truth for pending changes)
// ============================================================
function loadPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch (_) { return []; }
}
function savePending(arr) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(arr));
}

// Stable id so re-syncs of unchanged OSM elements don't create duplicates.
// Includes a content hash so a tweaked tag set DOES register as a new change.
async function changeId(kind, osmId, contentHash) {
  return `${kind}-${osmId}-${contentHash.slice(0, 8)}`;
}

// Quick deterministic hash (FNV-1a — fast, good enough for de-dup)
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

// Map a feature's properties to a canonical OSM-tag-shape so a local feature
// and the OSM original hash to the same value when nothing has actually
// changed. The offline parse pipeline renames a handful of tags (`building` →
// `building_type`, `highway` → `highway_type`, `leisure` → `area_type`); we
// reverse those here, and drop derived/cosmetic fields the OSM source can't
// produce (`category`, `source`, `wikipedia` urls, etc.).
function normalizeProps(props, kind) {
  if (!props) return {};
  const p = { ...props };
  if (p.building_type && !p.building) p.building = p.building_type;
  if (p.highway_type  && !p.highway)  p.highway  = p.highway_type;
  if (p.area_type && !p.leisure && !p.landuse && !p.natural) p.leisure = p.area_type;
  const keep = {};
  for (const k of (DIFF_TAGS[kind] || [])) {
    if (p[k] != null && p[k] !== '') keep[k] = String(p[k]);
  }
  return keep;
}

// Round coords to a stable precision so float jitter doesn't trip the hash.
function normalizeGeom(geom) {
  if (!geom) return null;
  const round = c => +c.toFixed(7);
  const walk = (c) => Array.isArray(c[0]) ? c.map(walk) : c.map(round);
  return { type: geom.type, coordinates: walk(geom.coordinates) };
}

function hashFeature(props, geom, kind) {
  const keep = normalizeProps(props, kind);
  const geomHash = geom ? fnv1a(JSON.stringify(normalizeGeom(geom))) : '0';
  return fnv1a(JSON.stringify(keep) + '|' + geomHash);
}

// ============================================================
// Overpass fetch
// ============================================================
async function fetchFromOverpass() {
  const query = `
    [out:json][timeout:60];
    (
      way["building"](${CAMPUS_BBOX});
      way["highway"](${CAMPUS_BBOX});
      way["leisure"](${CAMPUS_BBOX});
      way["landuse"](${CAMPUS_BBOX});
      way["amenity"](${CAMPUS_BBOX});
      node["amenity"](${CAMPUS_BBOX});
      node["shop"](${CAMPUS_BBOX});
      node["tourism"](${CAMPUS_BBOX});
      node["historic"](${CAMPUS_BBOX});
    );
    out geom;
  `;
  const body = 'data=' + encodeURIComponent(query);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

  let lastErr = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) {
        // 504 / 429 → try the next mirror instead of giving up
        lastErr = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
        continue;
      }
      return await res.json();
    } catch (e) {
      // Network or CORS failure — try the next one
      lastErr = e;
      console.warn(`[Overpass] ${new URL(url).host} failed:`, e.message);
    }
  }
  throw new Error(
    `All Overpass mirrors failed${lastErr ? ' (last: ' + lastErr.message + ')' : ''}. ` +
    `Check your internet connection and try again in a minute.`
  );
}

// Convert one Overpass element into a GeoJSON Feature in our schema.
function overpassToFeature(el) {
  const tags = el.tags || {};
  const kind = classify(tags);
  if (!kind) return null;

  let geometry;
  let centroid;
  if (el.type === 'node') {
    geometry = { type: 'Point', coordinates: [el.lon, el.lat] };
    centroid = { lat: el.lat, lng: el.lon };
  } else if (el.type === 'way' && el.geometry) {
    const coords = el.geometry.map(p => [p.lon, p.lat]);
    if (!coords.length) return null;
    const closed = coords.length >= 4 &&
      coords[0][0] === coords[coords.length - 1][0] &&
      coords[0][1] === coords[coords.length - 1][1];
    if (closed && (kind === 'buildings' || kind === 'areas')) {
      geometry = { type: 'Polygon', coordinates: [coords] };
    } else {
      geometry = { type: 'LineString', coordinates: coords };
    }
    // Centroid = mean of vertices (fine for diff/preview)
    let sx = 0, sy = 0;
    for (const [x, y] of coords) { sx += x; sy += y; }
    centroid = { lng: sx / coords.length, lat: sy / coords.length };
  } else {
    return null;
  }

  const properties = {
    osm_id: String(el.id),
    name: tags.name || null,
    source: 'osm',
    ...tags,
  };
  // Aliases our app expects on building features
  if (kind === 'buildings') {
    properties.category      = inferCategory(tags) || 'building';
    properties.building_type = tags.building || null;
    properties.amenity       = tags.amenity || null;
    properties.levels        = tags['building:levels'] || tags.levels || null;
  } else if (kind === 'roads') {
    properties.highway_type  = tags.highway || null;
  } else if (kind === 'places') {
    properties.category      = inferCategory(tags) || 'poi';
  } else if (kind === 'areas') {
    properties.area_type     = tags.leisure || tags.landuse || tags.natural || null;
    properties.category      = inferCategory(tags) || 'recreation';
  }

  return { type: 'Feature', properties, geometry, centroid, _kind: kind };
}

// Best-effort category inference (mirrors backend/scripts/parse-osm-data.js)
function inferCategory(tags) {
  if (!tags) return null;
  if (tags.amenity === 'university' || tags.amenity === 'college' || tags.amenity === 'school' || tags.amenity === 'library') return 'academic';
  if (tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'fast_food' || tags.amenity === 'canteen') return 'dining';
  if (tags.amenity === 'hospital' || tags.amenity === 'clinic' || tags.amenity === 'pharmacy') return 'medical';
  if (tags.amenity === 'bank' || tags.amenity === 'atm') return 'bank';
  if (tags.amenity === 'parking') return 'parking';
  if (tags.leisure === 'sports_centre' || tags.leisure === 'pitch' || tags.sport) return 'sports';
  if (tags.tourism) return 'recreation';
  if (tags.building === 'dormitory' || tags['building:use'] === 'dormitory') return 'hostel';
  if (tags.building === 'residential' || tags['building:use'] === 'residential') return 'residential';
  if (tags.building === 'university' || tags.building === 'college') return 'academic';
  return null;
}

// ============================================================
// Diff engine — compare OSM snapshot against the current map
// ============================================================
async function computeDiff(osmFeatures) {
  // We diff against the BASE bundled data (not the overlay) — the admin's
  // earlier decisions are already captured as "approved" rows. Re-fetching
  // the same OSM state shouldn't re-surface things they already handled.
  const [places, buildings, roads, areas] = await Promise.all([
    fetch('data/places.geojson').then(r => r.json()),
    fetch('data/buildings.geojson').then(r => r.json()),
    fetch('data/roads.geojson').then(r => r.json()),
    fetch('data/areas.geojson').then(r => r.json()),
  ]);
  const base = { places, buildings, roads, areas };

  // Index local features by osm_id per kind
  const localById = { buildings: {}, places: {}, roads: {}, areas: {} };
  for (const kind of Object.keys(localById)) {
    for (const f of base[kind].features || []) {
      const id = f.properties?.osm_id;
      if (id) localById[kind][String(id)] = f;
    }
  }

  // Index OSM features by osm_id per kind
  const osmById = { buildings: {}, places: {}, roads: {}, areas: {} };
  for (const f of osmFeatures) {
    const kind = f._kind;
    osmById[kind][f.properties.osm_id] = f;
  }

  const pending = loadPending();
  const seenIds = new Set(pending.map(p => p.id));
  const decisionByOsm = new Map(); // osm_id|contentHash → most-recent decision row
  for (const p of pending) decisionByOsm.set(`${p.osm_id}|${p.contentHash}`, p);

  const newChanges = [];

  // ── Added & Modified ────────────────────────────────────────
  for (const kind of Object.keys(osmById)) {
    for (const [id, osmF] of Object.entries(osmById[kind])) {
      const local = localById[kind][id];
      const osmHash = hashFeature(osmF.properties, osmF.geometry, kind);
      const dedupKey = `${id}|${osmHash}`;

      if (!local) {
        // Net new
        if (decisionByOsm.has(dedupKey)) continue;
        newChanges.push(makeChange('added', kind, osmF, null, osmHash));
      } else {
        const localHash = hashFeature(local.properties, local.geometry, kind);
        if (localHash !== osmHash) {
          if (decisionByOsm.has(dedupKey)) continue;
          newChanges.push(makeChange('modified', kind, osmF, local, osmHash));
        }
      }
    }
  }

  // ── Deleted (in local with source:osm but missing from new fetch) ──
  for (const kind of Object.keys(localById)) {
    for (const [id, localF] of Object.entries(localById[kind])) {
      if (localF.properties?.source !== 'osm') continue;
      if (osmById[kind][id]) continue;
      const localHash = hashFeature(localF.properties, localF.geometry, kind);
      const dedupKey  = `${id}|del|${localHash}`;
      if (decisionByOsm.has(dedupKey)) continue;
      newChanges.push(makeChange('deleted', kind, null, localF, 'del-' + localHash));
    }
  }

  return newChanges;
}

function makeChange(type, kind, after, before, contentHash) {
  const osm_id = String((after || before).properties.osm_id);
  const name   = (after?.properties?.name) || (before?.properties?.name) || null;
  const id     = `${kind}-${osm_id}-${contentHash.slice(0, 8)}`;
  return {
    id, type, kind, osm_id, contentHash,
    name: name || `(unnamed ${kind.slice(0, -1)})`,
    before, after,
    status: 'pending',
    fetchedAt: new Date().toISOString(),
    decidedAt: null,
    reason: null,
  };
}

// ============================================================
// Sync — fetch + diff + persist (merge with existing pending)
// ============================================================
async function runSync() {
  setSyncing(true);
  try {
    showToast('Querying OpenStreetMap…', 'info');
    const data = await fetchFromOverpass();
    const features = (data.elements || [])
      .map(overpassToFeature)
      .filter(Boolean);

    const newChanges = await computeDiff(features);
    const pending = loadPending();
    // Merge: dedupe by change.id
    const byId = new Map(pending.map(p => [p.id, p]));
    for (const c of newChanges) byId.set(c.id, c);
    const merged = [...byId.values()];
    savePending(merged);
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());

    showToast(`Sync complete — ${newChanges.length} new change${newChanges.length === 1 ? '' : 's'}`, 'success');
    render();
  } catch (err) {
    console.error(err);
    showToast(`Sync failed: ${err.message}`, 'error');
  } finally {
    setSyncing(false);
  }
}

function setSyncing(on) {
  const btn = document.getElementById('btn-sync');
  const label = document.getElementById('btn-sync-label');
  btn.disabled = on;
  label.textContent = on ? 'Syncing…' : 'Sync from OSM';
}

// ============================================================
// Decisions: Accept / Reject
// ============================================================
function acceptChange(change) {
  const overlay = IITJOverlay.loadLocal();
  if (change.type === 'deleted') {
    // Mark the local feature as deleted in the overlay
    if (!overlay.deleted[change.kind]) overlay.deleted[change.kind] = [];
    if (!overlay.deleted[change.kind].includes(change.osm_id)) {
      overlay.deleted[change.kind].push(change.osm_id);
    }
    // Also drop any prior add/modify for the same id
    delete overlay[change.kind][change.osm_id];
  } else {
    // Added or modified — write the new feature into the overlay
    overlay[change.kind][change.osm_id] = stripInternal(change.after);
    // Ensure not also in deleted list
    overlay.deleted[change.kind] = (overlay.deleted[change.kind] || []).filter(id => id !== change.osm_id);
  }
  IITJOverlay.saveLocal(overlay);
  markDecision(change.id, 'approved');
  showToast(`Accepted — “${change.name}”`, 'success');
}

function rejectChange(change) {
  // Just mark rejected; we don't touch the overlay. The dedup-by-contentHash
  // means the same OSM state won't re-surface on next sync.
  markDecision(change.id, 'rejected');
  showToast(`Rejected — “${change.name}”`, 'warn');
}

function markDecision(id, status) {
  const arr = loadPending();
  const idx = arr.findIndex(c => c.id === id);
  if (idx === -1) return;
  arr[idx].status = status;
  arr[idx].decidedAt = new Date().toISOString();
  savePending(arr);
  render();
  // Reopen the same change to show its new state
  showDetail(arr[idx]);
}

// Drop internal fields before writing to the overlay (keeps it portable JSON)
function stripInternal(f) {
  if (!f) return f;
  const { _kind, ...rest } = f;
  return rest;
}

// ============================================================
// UI rendering
// ============================================================
let _filterStatus = 'pending';
let _filterKind   = 'all';
let _filterType   = 'all';
let _filterText   = '';
let _selectedId   = null;
let _miniMap      = null;

function render() {
  renderStats();
  renderList();
  updatePublishButton();
}

function renderStats() {
  const all = loadPending();
  document.getElementById('stat-pending').textContent  = all.filter(c => c.status === 'pending').length;
  document.getElementById('stat-approved').textContent = all.filter(c => c.status === 'approved').length;
  document.getElementById('stat-rejected').textContent = all.filter(c => c.status === 'rejected').length;
  const last = localStorage.getItem(LAST_SYNC_KEY);
  document.getElementById('stat-last-sync').textContent = last ? timeAgo(last) : 'never';
}

function renderList() {
  const list = document.getElementById('changes-list');
  const empty = document.getElementById('empty-state');

  const all = loadPending();
  const filtered = all
    .filter(c => _filterStatus === 'all' || c.status === _filterStatus)
    .filter(c => _filterKind   === 'all' || c.kind   === _filterKind)
    .filter(c => _filterType   === 'all' || c.type   === _filterType)
    .filter(c => !_filterText || matchesText(c, _filterText));

  // Newest first
  filtered.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));

  // Wipe existing rows but keep the empty-state in the DOM
  for (const el of [...list.children]) {
    if (el.id !== 'empty-state') el.remove();
  }

  if (!filtered.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const c of filtered) {
    const row = document.createElement('div');
    row.className = 'change-row' + (c.id === _selectedId ? ' active' : '');
    row.dataset.id = c.id;
    const initial = c.type === 'added' ? '+' : c.type === 'deleted' ? '−' : '~';
    row.innerHTML = `
      <div class="change-row-type ${c.type}">${initial}</div>
      <div class="change-row-main">
        <div class="change-row-name">${escapeHtml(c.name)}</div>
        <div class="change-row-meta">
          <span class="change-row-kind">${c.kind}</span>
          <span class="change-row-status ${c.status}">${c.status}</span>
          <span>· ${timeAgo(c.fetchedAt)}</span>
        </div>
      </div>
    `;
    row.addEventListener('click', () => showDetail(c));
    list.appendChild(row);
  }
}

function matchesText(c, text) {
  const t = text.toLowerCase();
  return (c.name && c.name.toLowerCase().includes(t)) || c.osm_id.includes(t);
}

function showDetail(change) {
  _selectedId = change.id;
  // Highlight the active row
  document.querySelectorAll('.change-row').forEach(r => {
    r.classList.toggle('active', r.dataset.id === change.id);
  });

  document.getElementById('detail-empty').classList.add('hidden');
  document.getElementById('detail-content').classList.remove('hidden');

  const typeEl = document.getElementById('detail-type');
  typeEl.className = 'detail-type ' + change.type;
  typeEl.textContent = change.type;

  document.getElementById('detail-title').textContent = change.name;
  document.getElementById('detail-kind').textContent  = change.kind;
  document.getElementById('detail-osm-id').textContent = `OSM ${change.osm_id}`;
  document.getElementById('detail-fetched').textContent = `fetched ${timeAgo(change.fetchedAt)}`;

  // Diff table
  renderDiffTable(change);

  // Map preview
  renderMiniMap(change);

  // Buttons
  const accept = document.getElementById('btn-accept');
  const reject = document.getElementById('btn-reject');
  if (change.status === 'pending') {
    accept.disabled = false; reject.disabled = false;
    accept.style.display = ''; reject.style.display = '';
    accept.onclick = () => acceptChange(change);
    reject.onclick = () => rejectChange(change);
  } else {
    accept.style.display = 'none'; reject.style.display = 'none';
  }

  // Decision log
  const log = document.getElementById('decision-log');
  if (change.status !== 'pending') {
    log.classList.remove('hidden');
    log.innerHTML = `<strong>${change.status === 'approved' ? 'Accepted' : 'Rejected'}</strong> on ${new Date(change.decidedAt).toLocaleString()}`;
  } else {
    log.classList.add('hidden');
  }
}

function renderDiffTable(change) {
  const tbl = document.getElementById('diff-table');
  tbl.innerHTML = '';

  // Compare on the SAME normalized canonical shape that the hasher uses.
  // That way the table reflects only real OSM-side differences (not artefacts
  // from our local schema renaming `building` → `building_type` etc.).
  const beforeProps = normalizeProps(change.before?.properties, change.kind);
  const afterProps  = normalizeProps(change.after?.properties,  change.kind);

  // Show diff-relevant tags in DIFF_TAGS declaration order
  const orderedKeys = (DIFF_TAGS[change.kind] || []).filter(
    k => beforeProps[k] != null || afterProps[k] != null
  );

  const header = document.createElement('div');
  header.className = 'diff-row-header';
  header.innerHTML = `<span>key</span><span>before</span><span>after</span>`;
  header.style.display = 'grid';
  header.style.gridTemplateColumns = '140px 1fr 1fr';
  tbl.appendChild(header);

  let nChanged = 0;
  for (const k of orderedKeys) {
    const bef = beforeProps[k];
    const aft = afterProps[k];
    let cls = 'diff-same';
    if (change.type === 'added')   cls = aft != null ? 'diff-added' : 'diff-same';
    else if (change.type === 'deleted') cls = bef != null ? 'diff-removed' : 'diff-same';
    else if (bef !== aft) {
      if (bef == null)      cls = 'diff-added';
      else if (aft == null) cls = 'diff-removed';
      else                  cls = 'diff-changed';
    }

    if (cls !== 'diff-same') nChanged++;

    const row = document.createElement('div');
    row.className = `diff-row ${cls}`;
    row.innerHTML = `
      <div class="diff-key">${escapeHtml(k)}</div>
      <div class="diff-val diff-before">${bef == null ? '<em style="color:#9aa0a6">—</em>' : escapeHtml(String(bef))}</div>
      <div class="diff-val diff-after">${aft == null ? '<em style="color:#9aa0a6">—</em>' : escapeHtml(String(aft))}</div>
    `;
    tbl.appendChild(row);
  }

  if (orderedKeys.length === 0) {
    const row = document.createElement('div');
    row.className = 'diff-row diff-same';
    row.style.gridTemplateColumns = '1fr';
    row.innerHTML = '<em style="color:#9aa0a6; padding: 0 16px;">No tag changes — geometry-only update</em>';
    tbl.appendChild(row);
  }

  // Geometry diff summary
  const beforeG = change.before?.geometry;
  const afterG  = change.after?.geometry;
  let geomLabel = 'unchanged';
  if (change.type === 'added')        geomLabel = 'new geometry';
  else if (change.type === 'deleted') geomLabel = 'will be removed';
  else if (JSON.stringify(beforeG) !== JSON.stringify(afterG)) geomLabel = 'geometry changed';

  document.getElementById('diff-summary').textContent =
    `${nChanged} tag${nChanged === 1 ? '' : 's'} changed · ${geomLabel}`;
}

function renderMiniMap(change) {
  // Fresh container — destroying and recreating is safer than mutating
  const c = document.getElementById('mini-map');
  if (_miniMap) { try { _miniMap.remove(); } catch (_) {} _miniMap = null; }
  c.innerHTML = '';

  const beforeF = change.before;
  const afterF  = change.after;
  const focus   = (afterF || beforeF);
  if (!focus) return;
  const center = focus.centroid ? [focus.centroid.lng, focus.centroid.lat] : null;
  if (!center) return;

  _miniMap = new maplibregl.Map({
    container: 'mini-map',
    style: {
      version: 8,
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      sources: {
        carto: {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors © CARTO',
        },
      },
      layers: [{ id: 'base', type: 'raster', source: 'carto' }],
    },
    center,
    zoom: 17.5,
    attributionControl: { compact: true },
  });

  _miniMap.on('load', () => {
    if (beforeF) drawFeatureOnMini(beforeF, 'current', '#6b7280');
    if (afterF)  drawFeatureOnMini(afterF,  'new',     '#1a73e8');
    // Fit to whichever geometries are present
    fitMiniToFeatures([beforeF, afterF].filter(Boolean));
  });
}

function drawFeatureOnMini(feature, name, color) {
  const srcId = 'feat-' + name;
  const data = { type: 'FeatureCollection', features: [feature] };
  if (_miniMap.getSource(srcId)) {
    _miniMap.getSource(srcId).setData(data);
  } else {
    _miniMap.addSource(srcId, { type: 'geojson', data });
  }

  const g = feature.geometry;
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    _miniMap.addLayer({ id: srcId + '-fill', type: 'fill', source: srcId,
      paint: { 'fill-color': color, 'fill-opacity': name === 'new' ? 0.32 : 0.18 } });
    _miniMap.addLayer({ id: srcId + '-line', type: 'line', source: srcId,
      paint: { 'line-color': color, 'line-width': name === 'new' ? 3 : 2, 'line-dasharray': name === 'current' ? [3, 2] : [1] } });
  } else if (g.type === 'LineString' || g.type === 'MultiLineString') {
    _miniMap.addLayer({ id: srcId + '-line', type: 'line', source: srcId,
      paint: { 'line-color': color, 'line-width': name === 'new' ? 4 : 3, 'line-dasharray': name === 'current' ? [3, 2] : [1] } });
  } else if (g.type === 'Point') {
    _miniMap.addLayer({ id: srcId + '-pt', type: 'circle', source: srcId,
      paint: { 'circle-color': color, 'circle-radius': name === 'new' ? 8 : 6,
               'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
  }
}

function fitMiniToFeatures(feats) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      minLng = Math.min(minLng, coords[0]); maxLng = Math.max(maxLng, coords[0]);
      minLat = Math.min(minLat, coords[1]); maxLat = Math.max(maxLat, coords[1]);
    } else for (const c of coords) walk(c);
  };
  for (const f of feats) if (f.geometry?.coordinates) walk(f.geometry.coordinates);
  if (minLng === Infinity) return;
  _miniMap.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
    padding: 60, duration: 0, maxZoom: 18.5,
  });
}

// ============================================================
// GitHub publish — commits overlay.json straight to the repo so
// Vercel redeploys without the admin ever touching a git client.
// ============================================================
function loadGhConfig() {
  try {
    const o = JSON.parse(localStorage.getItem(GH_CFG_KEY) || '{}');
    return {
      owner:  o.owner  || '',
      repo:   o.repo   || '',
      branch: o.branch || 'main',
      path:   o.path   || 'web/data/overlay.json',
      token:  o.token  || '',
    };
  } catch (_) {
    return { owner: '', repo: '', branch: 'main', path: 'web/data/overlay.json', token: '' };
  }
}
function saveGhConfig(cfg) { localStorage.setItem(GH_CFG_KEY, JSON.stringify(cfg)); }
function ghConfigured() {
  const c = loadGhConfig();
  return !!(c.owner && c.repo && c.token);
}

function updatePublishButton() {
  const btn = document.getElementById('btn-publish');
  const label = document.getElementById('btn-publish-label');
  if (!btn) return;
  if (!ghConfigured()) {
    btn.disabled = false; // still clickable — opens settings
    btn.title = 'Click to set up GitHub publishing (one-time configuration)';
    label.textContent = 'Publish to live site';
  } else {
    btn.disabled = false;
    btn.title = 'Commit the accepted overlay to GitHub; Vercel will redeploy automatically';
    const last = localStorage.getItem(LAST_PUBLISH_KEY);
    label.textContent = last
      ? `Publish to live site · last ${timeAgo(last)}`
      : 'Publish to live site';
  }
}

// Base64 encoder that handles UTF-8 cleanly (btoa alone breaks on non-ASCII).
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function ghRequest(cfg, path, init = {}) {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Authorization': `Bearer ${cfg.token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = body?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function publishOverlay() {
  if (!ghConfigured()) {
    showToast('Set up GitHub publishing first', 'warn');
    openSettings();
    return;
  }
  const cfg = loadGhConfig();
  const btn = document.getElementById('btn-publish');
  const label = document.getElementById('btn-publish-label');
  btn.disabled = true;
  label.textContent = 'Publishing…';

  try {
    const overlay = IITJOverlay.loadLocal();
    const content = JSON.stringify(overlay, null, 2);
    const base64  = utf8ToBase64(content);

    // 1. Look up the existing file's sha (required by GitHub to update)
    let existingSha = null;
    try {
      const meta = await ghRequest(cfg,
        `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}?ref=${encodeURIComponent(cfg.branch)}`);
      existingSha = meta.sha;
    } catch (e) {
      // 404 is fine — the file just doesn't exist yet on that branch
      if (e.status !== 404) throw e;
    }

    // 2. Commit (create or update) — uses Contents API which is one HTTP call
    const counts = countOverlayEntries(overlay);
    const commitMsg = `Update admin overlay (${counts.total} feature${counts.total === 1 ? '' : 's'}` +
      ` across ${counts.kinds.length} kind${counts.kinds.length === 1 ? '' : 's'})`;
    await ghRequest(cfg,
      `/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(cfg.path)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: commitMsg,
          content: base64,
          branch: cfg.branch,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      }
    );

    localStorage.setItem(LAST_PUBLISH_KEY, new Date().toISOString());
    showToast('Published — Vercel will redeploy in ~30 seconds', 'success');
  } catch (e) {
    console.error('[publish]', e);
    const hint = e.status === 401 ? ' (check your token — it may be expired or wrong-scoped)'
               : e.status === 403 ? ' (token lacks Contents: Read & write on this repo)'
               : e.status === 404 ? ' (owner/repo/branch path is wrong)'
               : '';
    showToast(`Publish failed: ${e.message}${hint}`, 'error');
  } finally {
    updatePublishButton();
  }
}

function countOverlayEntries(o) {
  const kinds = [];
  let total = 0;
  for (const k of ['buildings', 'places', 'roads', 'areas']) {
    const n = Object.keys(o[k] || {}).length + (o.deleted?.[k]?.length || 0);
    if (n) { kinds.push(k); total += n; }
  }
  return { total, kinds };
}

// ── Settings modal ────────────────────────────────────────────
function openSettings() {
  const cfg = loadGhConfig();
  document.getElementById('cfg-owner').value  = cfg.owner;
  document.getElementById('cfg-repo').value   = cfg.repo;
  document.getElementById('cfg-branch').value = cfg.branch;
  document.getElementById('cfg-path').value   = cfg.path;
  document.getElementById('cfg-token').value  = cfg.token;
  document.getElementById('settings-status').textContent = '';
  document.getElementById('settings-status').className = 'form-status';
  document.getElementById('settings-modal').classList.remove('hidden');
}
function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}
function readSettingsForm() {
  return {
    owner:  document.getElementById('cfg-owner').value.trim(),
    repo:   document.getElementById('cfg-repo').value.trim(),
    branch: document.getElementById('cfg-branch').value.trim() || 'main',
    path:   document.getElementById('cfg-path').value.trim() || 'web/data/overlay.json',
    token:  document.getElementById('cfg-token').value.trim(),
  };
}
function showSettingsStatus(msg, kind) {
  const el = document.getElementById('settings-status');
  el.className = 'form-status ' + (kind || '');
  el.textContent = msg;
}
async function testGhConnection() {
  const cfg = readSettingsForm();
  if (!cfg.owner || !cfg.repo || !cfg.token) {
    showSettingsStatus('Fill in owner, repo, and token first.', 'warn');
    return;
  }
  showSettingsStatus('Testing…', 'warn');
  try {
    const repo = await ghRequest(cfg, `/repos/${cfg.owner}/${cfg.repo}`);
    if (!repo.permissions?.push) {
      showSettingsStatus('Token can read the repo but lacks push permission. Re-create it with Contents: Read & write.', 'error');
      return;
    }
    showSettingsStatus(`Connected to ${repo.full_name} on branch ${cfg.branch}. Permissions look good.`, 'ok');
  } catch (e) {
    showSettingsStatus(`${e.message}${e.status === 401 ? ' — token rejected' : ''}`, 'error');
  }
}

// ============================================================
// Export / Import overlay
// ============================================================
function exportOverlay() {
  const overlay = IITJOverlay.loadLocal();
  const blob = new Blob([JSON.stringify(overlay, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `iitj-overlay-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  showToast('Overlay exported — commit it to web/data/overlay.json to share', 'success');
}

function importOverlay(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      const current = IITJOverlay.loadLocal();
      // Merge — imported wins per-feature
      const merged = {
        ...IITJOverlay.emptyOverlay(),
        ...current, ...imported,
        deleted: {
          buildings: [...new Set([...(current.deleted?.buildings || []), ...(imported.deleted?.buildings || [])])],
          places:    [...new Set([...(current.deleted?.places    || []), ...(imported.deleted?.places    || [])])],
          roads:     [...new Set([...(current.deleted?.roads     || []), ...(imported.deleted?.roads     || [])])],
          areas:     [...new Set([...(current.deleted?.areas     || []), ...(imported.deleted?.areas     || [])])],
        },
      };
      IITJOverlay.saveLocal(merged);
      showToast('Overlay imported', 'success');
      render();
    } catch (e) {
      showToast('Import failed: ' + e.message, 'error');
    }
  };
  reader.readAsText(file);
}

// ============================================================
// Helpers
// ============================================================
function timeAgo(iso) {
  const t = new Date(iso).getTime();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60)         return `${s}s ago`;
  if (s < 3600)       return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)      return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

let _toastTimer = null;
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.className = 'toast visible toast-' + type;
  t.textContent = msg;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('visible'), 2800);
}

// ============================================================
// Gate (client-side passphrase deterrent)
// ============================================================
function checkGate() {
  const stored = localStorage.getItem(GATE_KEY);
  if (stored) {
    document.getElementById('gate').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    boot();
    return;
  }
  document.getElementById('gate-btn').addEventListener('click', () => {
    const v = document.getElementById('gate-input').value.trim();
    if (!v) return;
    localStorage.setItem(GATE_KEY, v);
    document.getElementById('gate').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    boot();
  });
  document.getElementById('gate-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('gate-btn').click();
  });
}

// ============================================================
// Boot
// ============================================================
function boot() {
  document.getElementById('btn-sync').addEventListener('click', runSync);
  document.getElementById('btn-export').addEventListener('click', exportOverlay);
  document.getElementById('btn-publish').addEventListener('click', publishOverlay);
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.querySelector('#settings-modal .modal-backdrop').addEventListener('click', closeSettings);
  document.getElementById('settings-save').addEventListener('click', () => {
    const cfg = readSettingsForm();
    if (!cfg.owner || !cfg.repo) { showSettingsStatus('Owner and repo are required.', 'error'); return; }
    saveGhConfig(cfg);
    showSettingsStatus('Saved.', 'ok');
    updatePublishButton();
    setTimeout(closeSettings, 600);
  });
  document.getElementById('settings-test').addEventListener('click', testGhConnection);
  document.getElementById('settings-forget').addEventListener('click', () => {
    const cfg = loadGhConfig();
    cfg.token = '';
    saveGhConfig(cfg);
    document.getElementById('cfg-token').value = '';
    showSettingsStatus('Token cleared from this browser.', 'warn');
    updatePublishButton();
  });
  document.getElementById('import-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) importOverlay(f);
    e.target.value = '';
  });
  updatePublishButton();

  for (const grp of ['filter-status', 'filter-kind', 'filter-type']) {
    const el = document.getElementById(grp);
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      [...el.children].forEach(c => c.classList.remove('chip-active'));
      btn.classList.add('chip-active');
      if (grp === 'filter-status') _filterStatus = btn.dataset.status;
      if (grp === 'filter-kind')   _filterKind   = btn.dataset.kind;
      if (grp === 'filter-type')   _filterType   = btn.dataset.type;
      render();
    });
  }
  document.getElementById('filter-search').addEventListener('input', (e) => {
    _filterText = e.target.value.trim();
    render();
  });

  render();
}

document.addEventListener('DOMContentLoaded', checkGate);
