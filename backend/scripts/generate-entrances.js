/**
 * Generate web/data/entrances.json — maps a destination's display name to the
 * lat/lng of its real entry gate, so drive/walk routing ends at the building's
 * entrance instead of its centroid (consumed by IITJData.getEntrance() in
 * web/js/search.js → app.js calculateDirectionsRoute()).
 *
 * Sources, in priority order, per building:
 *   1. A named OSM gate node "<code> gate" whose code matches the building
 *      (e.g. "B-1 gate" → "Hostel B1", "Akaash Complex gate" → "Akaash Complex").
 *   2. An entrance=* node that is a vertex of the building's footprint ring
 *      (entrance=main preferred over entrance=yes).
 * Curated campus main gates (Gate 1 / Gate 2) are carried over from the
 * existing file so the two principal vehicle entrances keep working.
 */
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');

const ROOT = path.join(__dirname, '..', '..');
const WEB_DATA = path.join(ROOT, 'web', 'data');
const OSM_FILE = path.join(ROOT, 'map.osm');

const doc = new DOMParser().parseFromString(fs.readFileSync(OSM_FILE, 'utf8'), 'text/xml');

// ── Parse nodes + ways ───────────────────────────────────────────────────────
const nodes = {};
for (const el of Array.from(doc.getElementsByTagName('node'))) {
  const id = el.getAttribute('id');
  const tags = {};
  for (const t of Array.from(el.getElementsByTagName('tag'))) tags[t.getAttribute('k')] = t.getAttribute('v');
  nodes[id] = { lat: parseFloat(el.getAttribute('lat')), lng: parseFloat(el.getAttribute('lon')), tags };
}
const ways = [];
for (const el of Array.from(doc.getElementsByTagName('way'))) {
  const id = el.getAttribute('id');
  const ndIds = Array.from(el.getElementsByTagName('nd')).map(n => n.getAttribute('ref'));
  const tags = {};
  for (const t of Array.from(el.getElementsByTagName('tag'))) tags[t.getAttribute('k')] = t.getAttribute('v');
  ways.push({ id, ndIds, tags });
}

const r7 = (n) => Math.round(n * 1e7) / 1e7;
const bestBuildingName = (tags) => (tags.name || tags['name:en'] || '').trim();
// normalise a building/gate code for matching: drop "Hostel", spaces, dashes
const codeKey = (s) => (s || '').replace(/hostel/ig, '').replace(/[-\s]/g, '').toUpperCase();

// ── Named buildings (closed, named ways with a building tag) ──────────────────
const buildings = [];
for (const w of ways) {
  const name = bestBuildingName(w.tags);
  if (!w.tags.building || !name) continue;
  const ring = w.ndIds.filter(id => nodes[id]);
  if (ring.length < 3) continue;
  let lat = 0, lng = 0;
  for (const id of ring) { lat += nodes[id].lat; lng += nodes[id].lng; }
  buildings.push({ id: w.id, name, ndSet: new Set(w.ndIds), lat: lat / ring.length, lng: lng / ring.length });
}

// ── Gate / entrance nodes ─────────────────────────────────────────────────────
const namedGates = [];   // { id, name, base, key, lat, lng }
const entranceNodes = []; // { id, lat, lng, kind }  (kind: 'main' | 'yes' | other)
for (const [id, n] of Object.entries(nodes)) {
  const name = (n.tags.name || '').trim();
  if (/(^|\s)gate$/i.test(name)) {
    const base = name.replace(/\s*gate$/i, '').trim();
    namedGates.push({ id, name, base, key: codeKey(base), lat: r7(n.lat), lng: r7(n.lng) });
  } else if (n.tags.entrance) {
    entranceNodes.push({ id, lat: r7(n.lat), lng: r7(n.lng), kind: n.tags.entrance });
  }
}

// ── Assign each building an entrance ──────────────────────────────────────────
const out = {};
const report = [];
const usedGate = new Set();

// 1. Named gate ↔ building by matching code (Hostel B1 ↔ "B-1 gate", etc.)
for (const b of buildings) {
  const bKey = codeKey(b.name);
  const g = namedGates.find(g => !usedGate.has(g.id) &&
    (g.key === bKey || codeKey('Hostel ' + g.base) === bKey || g.base.toLowerCase() === b.name.toLowerCase()));
  if (g) {
    out[b.name] = { lat: g.lat, lng: g.lng, osm_id: g.id, gate_name: g.name };
    usedGate.add(g.id);
    report.push(`gate   ${b.name.padEnd(22)} ← ${g.name}`);
  }
}

// 2. Buildings without a named gate: use an entrance node on their footprint ring
for (const b of buildings) {
  if (out[b.name]) continue;
  const ringEntrances = entranceNodes.filter(e => b.ndSet.has(e.id));
  if (!ringEntrances.length) continue;
  const e = ringEntrances.find(e => e.kind === 'main') || ringEntrances[0];
  out[b.name] = { lat: e.lat, lng: e.lng, osm_id: e.id, gate_name: `${b.name} entrance` };
  report.push(`ring   ${b.name.padEnd(22)} ← entrance node ${e.id} (${e.kind})`);
}

// 3. Carry over curated campus entrances from the old file (skip removed POIs).
const CURATED_ENTRANCE_SKIP = new Set([
  'Gate 1 (Main Gate - NH62)',
  'Gate 2 (South Gate)',
]);
let carried = 0;
try {
  const prev = JSON.parse(fs.readFileSync(path.join(WEB_DATA, 'entrances.json'), 'utf8'));
  for (const [k, v] of Object.entries(prev)) {
    if (!v.osm_id && !out[k] && !CURATED_ENTRANCE_SKIP.has(k)) {
      out[k] = v; carried++; report.push(`keep   ${k.padEnd(22)} ← curated`);
    }
  }
} catch (_) {}

// 4. Berm sandstone-gate entrances override gate/ring/curated entries — these
// are hand-placed on the campus-facing road and match the POI coordinates.
let bermMerged = 0;
for (const bermPath of [
  path.join(WEB_DATA, 'berm-entrances.json'),
  path.join(ROOT, 'backend', 'data', 'berm-entrances.json'),
]) {
  if (!fs.existsSync(bermPath)) continue;
  const berm = JSON.parse(fs.readFileSync(bermPath, 'utf8'));
  for (const [k, v] of Object.entries(berm)) {
    const replaced = !!out[k];
    out[k] = v;
    bermMerged++;
    report.push(`${replaced ? 'berm!' : 'berm  '} ${k.padEnd(22)} ← sandstone gate`);
  }
  break;
}

fs.writeFileSync(path.join(WEB_DATA, 'entrances.json'), JSON.stringify(out, null, 2));

console.log('Buildings scanned     :', buildings.length);
console.log('Named gates           :', namedGates.length, '(used ' + usedGate.size + ')');
console.log('Entrance nodes         :', entranceNodes.length);
console.log('Curated carried over   :', carried);
console.log('Entrances written      :', Object.keys(out).length);
console.log('\n' + report.sort().join('\n'));
