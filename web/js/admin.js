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
const LAST_PUBLISH_KEY = 'iitj-last-publish-v1';
// Baseline: change ids that have been "cleared" and must never re-surface on a
// future sync. Set by "Clear log", it lets an admin wipe the whole review log
// and treat the current OSM state as the zero point, so only edits made from
// that moment on appear. Stored as a plain array of change ids.
const BASELINE_KEY = 'iitj-baseline-v1';

// Stale keys from earlier admin auth designs (client-side passphrase gate,
// then a browser-stored GitHub PAT). Both stored real secrets in plaintext
// localStorage; purge them from any browser that still has them, regardless
// of which version it was last used with.
const STALE_LOCALSTORAGE_KEYS = ['iitj-admin-passphrase', 'iitj-github-config-v1'];
function purgeStaleSecrets() {
  for (const k of STALE_LOCALSTORAGE_KEYS) {
    try { localStorage.removeItem(k); } catch (_) { /* ignore */ }
  }
}

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

// Baseline = the set of change ids we've decided to permanently suppress
// (see BASELINE_KEY). Returned as a Set for O(1) membership checks in the diff.
function loadBaseline() {
  try { return new Set(JSON.parse(localStorage.getItem(BASELINE_KEY) || '[]')); } catch (_) { return new Set(); }
}
function saveBaseline(set) {
  localStorage.setItem(BASELINE_KEY, JSON.stringify([...set]));
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

  // Per-mirror timeout so a mirror that accepts the connection but then stalls
  // can't hang the whole sync (fetch has no default timeout). A dead mirror is
  // abandoned after this and we fall through to the next one.
  const PER_MIRROR_TIMEOUT_MS = 30000;

  // Record EVERY mirror's outcome, not just the last one. Overpass mirrors are
  // flaky and region-dependent (some hosts are blocked on campus/ISP networks),
  // so "it failed" is useless — the admin needs to see which host did what to
  // tell a network block apart from a mirror simply being overloaded.
  const results = [];
  for (const url of OVERPASS_ENDPOINTS) {
    const host = new URL(url).host;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_MIRROR_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
      if (!res.ok) {
        // 504 / 429 → try the next mirror instead of giving up
        results.push(`${host} — HTTP ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (e) {
      // Distinguish our own timeout abort from a genuine network/CORS failure.
      // "Failed to fetch" (a TypeError) means the request never completed at
      // all: offline, DNS/firewall block, connection refused, or CORS rejection.
      const reason = e.name === 'AbortError'
        ? `timed out (>${PER_MIRROR_TIMEOUT_MS / 1000}s)`
        : (e.message || 'network / CORS error');
      results.push(`${host} — ${reason}`);
      console.warn(`[Overpass] ${host} failed:`, e.message || e);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    `All ${OVERPASS_ENDPOINTS.length} OpenStreetMap (Overpass) mirrors failed:\n` +
    results.map(r => '· ' + r).join('\n') +
    `\n\nThis is almost always a network problem, not the app — you're offline, ` +
    `or a campus/ISP firewall is blocking these mirrors. Check your connection ` +
    `and try again in a minute.`
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
// opts.snapshot === true → return EVERY current OSM-vs-base difference,
// ignoring the pending log AND the baseline. Used by "Clear log" so the
// baseline captures the FRESH id of every current diff (the normal pending
// dedup would otherwise hide already-logged items from the snapshot, leaving
// their fresh ids un-baselined so the backlog resurfaces on the next sync).
async function computeDiff(osmFeatures, opts = {}) {
  const snapshot = opts.snapshot === true;
  // We diff OSM against what the APP ACTUALLY RENDERS = the base bundle with the
  // admin overlay applied on top (bundled overlay.json + this browser's accepted
  // -but-unpublished changes). Comparing against the raw base alone makes every
  // feature already accepted into the overlay — i.e. already live in the app —
  // re-surface as a brand-new "change" on every sync.
  const [places, buildings, roads, areas] = await Promise.all([
    fetch('data/places.geojson').then(r => r.json()),
    fetch('data/buildings.geojson').then(r => r.json()),
    fetch('data/roads.geojson').then(r => r.json()),
    fetch('data/areas.geojson').then(r => r.json()),
  ]);
  const base = { places, buildings, roads, areas };

  // Effective overlay = bundled overlay.json merged with the local (this-browser)
  // overlay, local winning. Read fresh each call so just-accepted changes count.
  const bundledOverlay = await IITJOverlay.loadBundled();
  const localOverlay   = IITJOverlay.loadLocal();
  const KINDS = ['buildings', 'places', 'roads', 'areas'];
  const override = {}, overlayDeleted = {};
  for (const kind of KINDS) {
    override[kind] = { ...(bundledOverlay[kind] || {}), ...(localOverlay[kind] || {}) };
    overlayDeleted[kind] = new Set([
      ...(bundledOverlay.deleted?.[kind] || []).map(String),
      ...(localOverlay.deleted?.[kind]   || []).map(String),
    ]);
  }

  // Index the EFFECTIVE (base + overlay) features by osm_id per kind.
  const localById = { buildings: {}, places: {}, roads: {}, areas: {} };
  for (const kind of KINDS) {
    for (const f of base[kind].features || []) {
      const id = String(f.properties?.osm_id || '');
      if (!id || overlayDeleted[kind].has(id)) continue; // admin removed it from the app
      localById[kind][id] = f;
    }
    for (const [id, f] of Object.entries(override[kind])) {  // overrides + net-new accepts
      localById[kind][String(id)] = f;
    }
  }

  // Index OSM features by osm_id per kind
  const osmById = { buildings: {}, places: {}, roads: {}, areas: {} };
  for (const f of osmFeatures) {
    const kind = f._kind;
    osmById[kind][f.properties.osm_id] = f;
  }

  const pending = loadPending();
  const decisionByOsm = new Map(); // osm_id|contentHash → most-recent decision row
  for (const p of pending) decisionByOsm.set(`${p.osm_id}|${p.contentHash}`, p);
  const baseline = loadBaseline(); // change ids permanently cleared via "Clear log"

  const newChanges = [];

  // ── Added & Modified ────────────────────────────────────────
  for (const kind of Object.keys(osmById)) {
    for (const [id, osmF] of Object.entries(osmById[kind])) {
      if (overlayDeleted[kind].has(id)) continue; // admin deleted it in the overlay — don't re-add
      const local = localById[kind][id];
      const osmHash = hashFeature(osmF.properties, osmF.geometry, kind);
      const dedupKey = `${id}|${osmHash}`;

      if (!local) {
        // Net new
        if (!snapshot && decisionByOsm.has(dedupKey)) continue;
        const ch = makeChange('added', kind, osmF, null, osmHash);
        if (!snapshot && baseline.has(ch.id)) continue;
        newChanges.push(ch);
      } else {
        const localHash = hashFeature(local.properties, local.geometry, kind);
        if (localHash !== osmHash) {
          if (!snapshot && decisionByOsm.has(dedupKey)) continue;
          const ch = makeChange('modified', kind, osmF, local, osmHash);
          if (!snapshot && baseline.has(ch.id)) continue;
          newChanges.push(ch);
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
      if (!snapshot && decisionByOsm.has(dedupKey)) continue;
      const ch = makeChange('deleted', kind, null, localF, 'del-' + localHash);
      if (!snapshot && baseline.has(ch.id)) continue;
      newChanges.push(ch);
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
// Clear log — wipe the entire review log and set the current OSM
// state as the baseline, so only edits made from now on will appear.
// ============================================================
async function resetLog() {
  const pending = loadPending();
  const ok = window.confirm(
    `Clear the review log?\n\n` +
    `This removes all ${pending.length} logged change${pending.length === 1 ? '' : 's'} ` +
    `(pending, approved and rejected) and records the current OpenStreetMap state as the ` +
    `baseline — so only edits made from now on will appear on future syncs.\n\n` +
    `Accepted changes already written to the overlay are NOT affected.`
  );
  if (!ok) return;

  const btn = document.getElementById('btn-clear');
  if (btn) btn.disabled = true;

  try {
    // Snapshot the current OSM state FIRST — we can only baseline what we can
    // see. computeDiff returns every current OSM-vs-base difference (its fresh
    // ids also cover any log entries written under older hashing). If OSM is
    // unreachable we abort WITHOUT clearing, rather than wipe the log into a
    // half-known baseline that would resurface the backlog on the next sync.
    showToast('Snapshotting current OSM as baseline…', 'info');
    const data = await fetchFromOverpass();
    const features = (data.elements || []).map(overpassToFeature).filter(Boolean);
    // snapshot mode: every current OSM-vs-base diff (pending dedup OFF), so the
    // baseline records each item's FRESH id — otherwise already-logged items are
    // hidden from the snapshot and resurface on the next sync.
    const current = await computeDiff(features, { snapshot: true });

    const baseline = loadBaseline();
    for (const p of pending) baseline.add(p.id);   // everything currently logged
    for (const c of current) baseline.add(c.id);   // + every current OSM-vs-base diff
    saveBaseline(baseline);
    savePending([]);

    _selectedId = null;
    document.getElementById('detail-content').classList.add('hidden');
    document.getElementById('detail-empty').classList.remove('hidden');
    render();
    showToast('Review log cleared — only new OSM changes will appear from now on.', 'success');
  } catch (e) {
    console.warn('[Clear log] failed:', e.message);
    showToast(`Couldn't reach OSM to set the baseline — nothing was cleared. Try again in a minute.`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
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
          <span class="change-row-kind">${escapeHtml(c.kind)}</span>
          <span class="change-row-status ${escapeHtml(c.status)}">${escapeHtml(c.status)}</span>
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
// ── Server-side publishing client ─────────────────────────────────────────
// The GitHub credentials live ONLY in the serverless function's environment
// (see /api/admin.js); they never reach the browser. The client holds, at
// most, a short-lived signed session token IN MEMORY (never localStorage),
// obtained by logging in with the admin password. Nothing sensitive persists
// client-side, so there is no token for an XSS to steal.
const ADMIN_API = '/api/admin';
let _adminSession = null;             // { token, exp } in-memory only
let _pendingPublishAfterLogin = false;

function hasValidSession() {
  return !!(_adminSession && _adminSession.token && Date.now() < _adminSession.exp - 5000);
}

async function adminApi(action, payload = {}) {
  let res;
  try {
    res = await fetch(ADMIN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (_) {
    throw new Error('Network error contacting the server');
  }
  let body = null;
  try { body = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error((body && body.error) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body || {};
}

async function adminLogin(password) {
  const out = await adminApi('login', { password });
  _adminSession = { token: out.token, exp: Date.now() + (out.expiresInSec || 0) * 1000 };
}

function updatePublishButton() {
  const btn = document.getElementById('btn-publish');
  const label = document.getElementById('btn-publish-label');
  if (!btn) return;
  btn.disabled = false;
  btn.title = 'Publish the accepted overlay to the live site (asks for the admin password)';
  const last = localStorage.getItem(LAST_PUBLISH_KEY);
  label.textContent = last
    ? `Publish to live site · last ${timeAgo(last)}`
    : 'Publish to live site';
}

async function publishOverlay() {
  // No client credentials: if we have no live session, log in first, then the
  // login handler re-invokes publish.
  if (!hasValidSession()) {
    _pendingPublishAfterLogin = true;
    openSettings();
    return;
  }
  const btn = document.getElementById('btn-publish');
  const label = document.getElementById('btn-publish-label');
  btn.disabled = true;
  label.textContent = 'Publishing…';

  try {
    const overlay = IITJOverlay.loadLocal();
    const counts = countOverlayEntries(overlay);
    const message = `Update admin overlay (${counts.total} feature${counts.total === 1 ? '' : 's'}` +
      ` across ${counts.kinds.length} kind${counts.kinds.length === 1 ? '' : 's'})`;
    // The server holds the GitHub token, computes the base64 + sha, and commits.
    await adminApi('publish', { token: _adminSession.token, overlay, message });

    localStorage.setItem(LAST_PUBLISH_KEY, new Date().toISOString());
    showToast('Published — Vercel will redeploy in ~30 seconds', 'success');
  } catch (e) {
    if (e.status === 401) {
      _adminSession = null;
      _pendingPublishAfterLogin = true;
      showToast('Session expired — log in again', 'warn');
      openSettings();
    } else if (e.status === 503) {
      showToast('Server publishing is not configured yet (set the admin env vars in Vercel).', 'error');
    } else {
      showToast(`Publish failed: ${e.message}`, 'error');
    }
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

// ── Login modal ───────────────────────────────────────────────
function openSettings() {
  const pw = document.getElementById('cfg-password');
  if (pw) pw.value = '';
  showSettingsStatus('', '');
  document.getElementById('settings-modal').classList.remove('hidden');
  if (pw) pw.focus();
}
function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
  const pw = document.getElementById('cfg-password');
  if (pw) pw.value = '';                 // never leave the password in the DOM
}
function showSettingsStatus(msg, kind) {
  const el = document.getElementById('settings-status');
  if (!el) return;
  el.className = 'form-status ' + (kind || '');
  el.textContent = msg;
}
async function submitLogin() {
  const input = document.getElementById('cfg-password');
  const pw = input ? input.value : '';
  if (!pw) { showSettingsStatus('Enter the admin password.', 'warn'); return; }
  showSettingsStatus('Logging in…', 'warn');
  try {
    await adminLogin(pw);
    if (input) input.value = '';
    showSettingsStatus('Logged in.', 'ok');
    closeSettings();
    if (_pendingPublishAfterLogin) { _pendingPublishAfterLogin = false; publishOverlay(); }
  } catch (e) {
    if (e.status === 503) showSettingsStatus('Server publishing is not configured (set the admin env vars in Vercel).', 'error');
    else showSettingsStatus(e.status === 401 ? 'Incorrect password.' : `Login failed: ${e.message}`, 'error');
  }
}
function adminLogout() {
  _adminSession = null;
  _pendingPublishAfterLogin = false;
  showSettingsStatus('Logged out.', 'ok');
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

// Persistent status log. Messages stay pinned to the side until the admin
// dismisses them or they're pushed out of the capped stack — an error or a
// success no longer flashes past before it can be read. Newest on top.
const STATUS_MAX = 6;
function showToast(msg, type = 'info') {
  const stack = document.getElementById('status-stack');
  if (!stack) return;

  const card = document.createElement('div');
  card.className = 'status-card status-' + type;

  const bodyEl = document.createElement('div');
  bodyEl.className = 'status-body';
  const msgEl = document.createElement('div');
  msgEl.className = 'status-msg';
  msgEl.textContent = msg;              // textContent: never inject markup
  const timeEl = document.createElement('div');
  timeEl.className = 'status-time';
  timeEl.textContent = new Date().toLocaleTimeString();
  bodyEl.appendChild(msgEl);
  bodyEl.appendChild(timeEl);

  const close = document.createElement('button');
  close.className = 'status-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => card.remove());

  card.appendChild(bodyEl);
  card.appendChild(close);
  stack.prepend(card);                  // newest at the top

  // Cap the stack so messages don't pile up forever; oldest drops off the end.
  while (stack.children.length > STATUS_MAX) {
    stack.removeChild(stack.lastElementChild);
  }
}

// ============================================================
// Boot
// ============================================================
function boot() {
  purgeStaleSecrets();
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('btn-sync').addEventListener('click', runSync);
  document.getElementById('btn-clear').addEventListener('click', resetLog);
  document.getElementById('btn-export').addEventListener('click', exportOverlay);
  document.getElementById('btn-publish').addEventListener('click', publishOverlay);
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.querySelector('#settings-modal .modal-backdrop').addEventListener('click', closeSettings);
  const loginForm = document.getElementById('login-form');
  if (loginForm) loginForm.addEventListener('submit', (e) => { e.preventDefault(); submitLogin(); });
  const logoutBtn = document.getElementById('settings-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', adminLogout);
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

document.addEventListener('DOMContentLoaded', boot);
