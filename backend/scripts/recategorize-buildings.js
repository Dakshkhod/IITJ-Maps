/**
 * One-off re-categorisation of buildings (and faculty-housing POIs) from OSM
 * metadata, fixing the old KML classifier that mapped any name containing
 * "housing" to `hostel`.
 *
 * Buildings get a full tag+amenity+name reclassification, never downgrading a
 * specific category to generic. Hand-curated POIs are left alone except:
 * building-derived POIs stay in sync with their building, and a `hostel` POI
 * clearly named faculty housing/quarters becomes `residential`.
 *
 * Run with --apply to write files; otherwise it's a dry run.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const APPLY = process.argv.includes('--apply');

// Building classifier (metadata-driven)
function classifyBuilding(p) {
  const name = (p.name || '').toLowerCase();
  const bt   = (p.building_type || '').toLowerCase();
  const am   = (p.amenity || '').toLowerCase();
  const desc = (p.description || '').toLowerCase();
  const has  = re => re.test(name);

  if (['restaurant', 'cafe', 'fast_food', 'food_court', 'canteen'].includes(am)) return 'dining';
  if (['hospital', 'clinic', 'pharmacy', 'doctors'].includes(am)) return 'medical';
  if (am === 'library') return 'academic';
  if (am === 'place_of_worship') return 'place_of_worship';
  if (am === 'parking') return 'parking';
  if (am === 'bank' || am === 'atm') return 'bank';

  if (has(/\b(phc|health centre|health center|hospital|dispensary|infirmary)\b/)) return 'medical';
  if (bt === 'temple' || has(/\b(temple|mandir|mosque|masjid|church|gurudwara|chapel)\b/)) return 'place_of_worship';
  if (has(/\bsub[\s-]?station|substation|water treatment|sewage|\bstp\b|pump house|powerhouse|transformer\b/)) return 'utility';

  if (bt === 'hostel' || bt === 'dormitory') return 'hostel';
  if (has(/\bhostel\b/)) return 'hostel';

  if (has(/\bhousing\b/)) return 'residential';
  if (has(/\bquarter|quaters\b/)) return 'residential';
  if (has(/\btype[\s-]?[a-z]\b/)) return 'residential';
  if (has(/\bbungalow\b/)) return 'residential';
  if (has(/\bguest house\b/)) return 'residential';
  if (['bungalow', 'apartments', 'residential', 'detached', 'semidetached_house', 'terrace'].includes(bt)) return 'residential';
  if (bt === 'house' && !has(/\banimal\b/)) return 'residential';

  if (has(/\b(mess|canteen|cafe|café|tapri|dhaba|restaurant|kitchen|dining|food court|tuck shop)\b/)) return 'dining';
  if (has(/\bclean\s*room\b/) || has(/\banimal house\b/)) return 'academic';

  if (['university', 'college', 'school'].includes(bt) || am === 'university' || am === 'college') {
    if (has(/\boffice of (administration|students|the registrar)\b/) || has(/\bregistrar\b/)) return 'administrative';
    return 'academic';
  }
  if (has(/\b(lhc|lecture hall|department|dept\.?|laborator|\blab\b|school of|centre for|center for|institute|classroom|seminar|workshop)\b/) ||
      /\b(laborator|department)\b/.test(desc)) return 'academic';

  if (bt === 'office' || p.office || has(/\b(office|administration|admin|directorate|estate office|cpwd|incubation|innovation|start[\s-]?up)\b/)) return 'administrative';
  if (bt === 'security_booth' || has(/\b(security|check[\s-]?post|checking|guard room|gate)\b/)) return 'gate';
  if (bt === 'parking' || has(/\bparking\b/)) return 'parking';
  if (has(/\b(gym|gymnasium|stadium|sports|swimming|pool|pavilion|court)\b/)) return 'sports';
  if (has(/\b(atm|bank|sbi|canara)\b/)) return 'bank';
  if (has(/\b(cycle|repair|service|store|stationery|salon|barber|laundry|supermarket|convenience)\b/) ||
      /\b(store|shop|convenience|supermarket|grocery|stationery)\b/.test(desc)) return 'utility';
  if (['commercial', 'retail', 'kiosk'].includes(bt)) return 'utility';

  return 'building';
}

// Never downgrade a specific existing category to generic 'building'.
function recategorize(p) {
  const next = classifyBuilding(p);
  if (next === 'building' && p.category && p.category !== 'building') return p.category;
  return next;
}

// Buildings → category, keyed by id and name (used to sync places + search).
const byId = new Map();
const byName = new Map();

// Places are curated. Keep building-derived POIs in sync; otherwise only fix a
// faculty/quarters POI wrongly marked hostel. Leave all other POIs untouched.
function recategorizePlace(p) {
  if (p.osm_id && byId.has(String(p.osm_id))) return byId.get(String(p.osm_id));
  const name = (p.name || '').toLowerCase();
  if (p.category === 'hostel' && (/\b(faculty|housing|quarter|quaters)\b/.test(name) || /\btype[\s-]?[a-z]\b/.test(name))) {
    return 'residential';
  }
  return p.category;
}

// Files
const files = {
  webBuildings:     path.join(ROOT, 'web/data/buildings.geojson'),
  backendBuildings: path.join(ROOT, 'backend/data/buildings.geojson'),
  webPlaces:        path.join(ROOT, 'web/data/places.geojson'),
  backendPlaces:    path.join(ROOT, 'backend/data/places.geojson'),
  webSearch:        path.join(ROOT, 'web/data/search-index.json'),
  backendSearch:    path.join(ROOT, 'backend/data/search-index.json'),
};
const read = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;

const webB = read(files.webBuildings);
const webP = read(files.webPlaces);

// Pass 1: building categories (populates byId / byName).
for (const f of webB.features) {
  const next = recategorize(f.properties);
  if (f.properties.osm_id) byId.set(String(f.properties.osm_id), next);
  if (f.properties.name) byName.set(f.properties.name, next);
}

function printDiff(fc, fn, label) {
  const changes = [];
  for (const f of fc.features) {
    const next = fn(f.properties);
    if (next !== f.properties.category) changes.push({ name: f.properties.name, from: f.properties.category, to: next, bt: f.properties.building_type, am: f.properties.amenity });
  }
  console.log(`\n${changes.length} ${label} category change(s):\n`);
  const grouped = {};
  for (const c of changes) { const k = `${c.from} → ${c.to}`; (grouped[k] = grouped[k] || []).push(c); }
  for (const k of Object.keys(grouped).sort()) {
    console.log(`  [${k}]  ×${grouped[k].length}`);
    for (const c of grouped[k]) console.log(`     ${c.name}  (bt=${c.bt} am=${c.am})`);
  }
}
printDiff(webB, recategorize, 'building');
printDiff(webP, recategorizePlace, 'place');

if (!APPLY) { console.log('\n(dry run — re-run with --apply to write)\n'); process.exit(0); }

// Apply
function applyFC(fc, fn) {
  let n = 0;
  for (const f of fc.features) { const next = fn(f.properties); if (f.properties.category !== next) { f.properties.category = next; n++; } }
  return n;
}
function applySearch(arr) {
  let n = 0;
  for (const e of arr) {
    const next = (e.id && byId.get(String(e.id))) || byName.get(e.name);
    if (next && e.category !== next) { e.category = next; n++; }
  }
  return n;
}
const writeMin = (f, d) => fs.writeFileSync(f, JSON.stringify(d));
const writePretty = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const report = [];
report.push(`web buildings: ${applyFC(webB, recategorize)}`);            writeMin(files.webBuildings, webB);
report.push(`web places: ${applyFC(webP, recategorizePlace)}`);         writeMin(files.webPlaces, webP);
const webS = read(files.webSearch); if (webS) { report.push(`web search-index: ${applySearch(webS)}`); writeMin(files.webSearch, webS); }
const beB = read(files.backendBuildings); if (beB) { report.push(`backend buildings: ${applyFC(beB, recategorize)}`); writePretty(files.backendBuildings, beB); }
const beP = read(files.backendPlaces);    if (beP) { report.push(`backend places: ${applyFC(beP, recategorizePlace)}`); writePretty(files.backendPlaces, beP); }
const beS = read(files.backendSearch);    if (beS) { report.push(`backend search-index: ${applySearch(beS)}`); writePretty(files.backendSearch, beS); }

console.log('\nApplied (changed counts):\n  ' + report.join('\n  ') + '\n');
