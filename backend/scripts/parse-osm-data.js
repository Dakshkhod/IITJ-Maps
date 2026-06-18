/**
 * IITJ Maps — OSM + KML Data Pipeline
 * Uses proper DOM parsing to extract all buildings, roads, places from OSM+KML.
 */

const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');
const RoadClassifier = require('./road-classifier');

const CAMPUS_BOUNDS = {
  minLat: 26.4500, maxLat: 26.4900,
  minLng: 73.0900, maxLng: 73.1300
};

// ============================================================
// OSM Parser (DOM-based, reliable)
// ============================================================
function parseOSM(filePath) {
  console.log('📖 Parsing OSM file:', filePath);
  const xml = fs.readFileSync(filePath, 'utf-8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const nodes = {};
  const ways = [];

  // Parse all nodes
  const nodeEls = doc.getElementsByTagName('node');
  for (let i = 0; i < nodeEls.length; i++) {
    const el = nodeEls[i];
    const id = el.getAttribute('id');
    const lat = parseFloat(el.getAttribute('lat'));
    const lon = parseFloat(el.getAttribute('lon'));
    if (!id || isNaN(lat) || isNaN(lon)) continue;

    const tags = {};
    const tagEls = el.getElementsByTagName('tag');
    for (let j = 0; j < tagEls.length; j++) {
      tags[tagEls[j].getAttribute('k')] = tagEls[j].getAttribute('v');
    }
    nodes[id] = { lat, lon, tags };
  }
  console.log(`  Parsed ${Object.keys(nodes).length} nodes`);

  // Parse all ways
  const wayEls = doc.getElementsByTagName('way');
  for (let i = 0; i < wayEls.length; i++) {
    const el = wayEls[i];
    const id = el.getAttribute('id');

    const nodeIds = [];
    const ndEls = el.getElementsByTagName('nd');
    for (let j = 0; j < ndEls.length; j++) {
      nodeIds.push(ndEls[j].getAttribute('ref'));
    }

    const tags = {};
    const tagEls = el.getElementsByTagName('tag');
    for (let j = 0; j < tagEls.length; j++) {
      tags[tagEls[j].getAttribute('k')] = tagEls[j].getAttribute('v');
    }

    if (nodeIds.length > 0) {
      ways.push({ id, nodeIds, tags });
    }
  }
  console.log(`  Parsed ${ways.length} ways`);

  return { nodes, ways };
}

// ============================================================
// KML Parser
// ============================================================
function parseKML(filePath) {
  console.log('📖 Parsing KML file:', filePath);
  const xml = fs.readFileSync(filePath, 'utf-8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const placemarks = doc.getElementsByTagName('Placemark');
  const features = [];

  for (let i = 0; i < placemarks.length; i++) {
    const pm = placemarks[i];
    const nameEl = pm.getElementsByTagName('name')[0];
    const name = nameEl ? nameEl.textContent.trim() : 'Unknown';

    // Polygon
    const polygon = pm.getElementsByTagName('Polygon')[0];
    if (polygon) {
      const coordsEl = polygon.getElementsByTagName('coordinates')[0];
      if (coordsEl) {
        const coords = coordsEl.textContent.trim()
          .split(/\s+/)
          .map(c => {
            const parts = c.split(',');
            return [parseFloat(parts[0]), parseFloat(parts[1])];
          })
          .filter(c => !isNaN(c[0]) && !isNaN(c[1]));

        if (coords.length >= 3) {
          const centroid = computeCentroid(coords);
          features.push({
            type: 'Feature',
            properties: {
              name,
              source: 'kml',
              category: classifyKMLPlace(name),
              is_proposed: name.toLowerCase().includes('proposed'),
              description: name
            },
            geometry: { type: 'Polygon', coordinates: [coords] },
            centroid
          });
        }
      }
    }

    // Point
    const point = pm.getElementsByTagName('Point')[0];
    if (point) {
      const coordsEl = point.getElementsByTagName('coordinates')[0];
      if (coordsEl) {
        const parts = coordsEl.textContent.trim().split(',');
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        if (!isNaN(lng) && !isNaN(lat)) {
          features.push({
            type: 'Feature',
            properties: {
              name,
              source: 'kml',
              category: classifyKMLPlace(name),
              is_proposed: name.toLowerCase().includes('proposed'),
              description: name
            },
            geometry: { type: 'Point', coordinates: [lng, lat] },
            centroid: { lat, lng }
          });
        }
      }
    }
  }

  console.log(`  Found ${features.length} KML placemarks`);
  return features;
}

function classifyKMLPlace(name) {
  const lower = name.toLowerCase();
  // Faculty/staff residential first, so "Faculty Housing"/quarters/Type-X don't
  // fall into the student-hostel bucket.
  if (lower.includes('housing') || lower.includes('quarter') || lower.includes('quater') ||
      lower.includes('bungalow') || /\btype[\s-]?[a-z]\b/.test(lower)) return 'residential';
  if (lower.includes('hostel')) return 'hostel';
  if (lower.includes('dining') || lower.includes('mess') || lower.includes('d-5') || lower.includes('d-6')) return 'dining';
  if (lower.includes('parking')) return 'parking';
  if (lower.includes('admin')) return 'administrative';
  if (lower.includes('academic') || lower.includes('tech park') || lower.includes('lhb')) return 'academic';
  if (lower.includes('auditorium') || lower.includes('skating')) return 'recreation';
  if (lower.includes('visitor')) return 'hostel';
  if (lower.includes('type b') || lower.includes('type c') || lower.includes('type d')) return 'residential';
  return 'building';
}

function computeCentroid(coords) {
  let latSum = 0, lngSum = 0;
  coords.forEach(c => { lngSum += c[0]; latSum += c[1]; });
  return { lat: latSum / coords.length, lng: lngSum / coords.length };
}

// ============================================================
// OSM Feature Extraction
// ============================================================
// Building types that are NOT real buildings and should not get the building fill treatment
const NON_BUILDING_TYPES = new Set(['berms', 'wall', 'fence', 'hedge', 'retaining_wall']);

function extractFeatures(osmData) {
  const { nodes, ways } = osmData;
  const buildings = [];
  const roads = [];
  const areas = [];    // named open areas: grounds, gardens, pitches, etc.
  const allPlaces = [];

  for (const way of ways) {
    const coords = way.nodeIds
      .filter(nid => nodes[nid])
      .map(nid => [nodes[nid].lon, nodes[nid].lat]);

    if (coords.length < 2) continue;

    const tags = way.tags;
    const name = tags.name || tags['name:en'] || '';
    const isClosed = coords.length >= 4 &&
      coords[0][0] === coords[coords.length - 1][0] &&
      coords[0][1] === coords[coords.length - 1][1];

    // Buildings — skip non-building types (berms, walls, etc.). Perimeter
    // berms are tagged inconsistently in OSM (building=berms on some, building=
    // public on others) but are all earthworks rendered by the 3D berm meshes,
    // never as 2D building boxes — exclude any name="Berms" way regardless.
    const isBerm = name === 'Berms' || tags.building === 'berms';
    if (tags.building && !NON_BUILDING_TYPES.has(tags.building) && !isBerm) {
      const centroid = computeCentroid(coords);
      const category = classifyBuilding(tags);
      const feature = {
        type: 'Feature',
        properties: {
          osm_id: way.id,
          name: name || `Building ${way.id}`,
          category,
          source: 'osm',
          building_type: tags.building,
          amenity: tags.amenity || null,
          levels: tags['building:levels'] || tags.levels || null,
          ...extractUsefulTags(tags)
        },
        geometry: {
          type: isClosed ? 'Polygon' : 'LineString',
          coordinates: isClosed ? [coords] : coords
        },
        centroid
      };
      buildings.push(feature);
      if (name) allPlaces.push(feature);
    }

    // Roads and paths
    if (tags.highway) {
      const feature = {
        type: 'Feature',
        properties: {
          osm_id: way.id,
          name: name || tags.highway,
          highway_type: tags.highway,
          surface: tags.surface || null,
          lit: tags.lit || null,
          lanes: tags.lanes || null,
          oneway: tags.oneway || null,
          service: tags.service || null,
          access: tags.access || null,
          vehicle: tags.vehicle || null,
          motor_vehicle: tags.motor_vehicle || null,
          motorcar: tags.motorcar || null,
          foot: tags.foot || null,
          bicycle: tags.bicycle || null,
          width: tags.width || null,
          source: 'osm'
        },
        geometry: { type: 'LineString', coordinates: coords }
      };
      roads.push(RoadClassifier.enrichRoadFeature(feature));
    }

    // Named open areas: landuse, leisure, natural, sport pitches
    // These get their own label layer but NOT building-style fills
    const isNamedArea = name && (tags.landuse || tags.leisure || tags.natural ||
      tags.sport || tags.amenity === 'college' || tags.amenity === 'university');
    if (isNamedArea && !tags.building && isClosed && coords.length >= 4) {
      const centroid = computeCentroid(coords);
      const areaType = tags.leisure || tags.landuse || tags.natural || tags.sport || tags.amenity || 'area';
      areas.push({
        type: 'Feature',
        properties: {
          osm_id: way.id,
          name,
          area_type: areaType,
          category: classifyArea(tags),
          source: 'osm'
        },
        geometry: { type: 'Polygon', coordinates: [coords] },
        centroid
      });
      // Areas are searchable via areas.geojson + search-index — no duplicate point entry
    }

    // Named POI ways with amenity/shop/tourism but no building footprint
    // (e.g. a restaurant mapped as a standalone polygon). The POI loop below
    // only scans nodes, so without this these named ways would be dropped.
    const isPoiWay = name && !tags.building && !tags.highway && !isNamedArea &&
      (tags.amenity || tags.shop || tags.tourism) && !skipPoi(tags);
    if (isPoiWay) {
      const centroid = computeCentroid(coords);
      allPlaces.push({
        type: 'Feature',
        properties: buildPoiProperties(way.id, tags),
        geometry: { type: 'Point', coordinates: [centroid.lng, centroid.lat] },
        centroid
      });
    }
  }

  // Point POIs (named nodes)
  for (const [id, node] of Object.entries(nodes)) {
    const tags = node.tags;
    if (!tags.name || skipPoi(tags)) continue;
    allPlaces.push({
      type: 'Feature',
      properties: buildPoiProperties(id, tags),
      geometry: { type: 'Point', coordinates: [node.lon, node.lat] },
      centroid: { lat: node.lat, lng: node.lon }
    });
  }

  console.log(`  Extracted: ${buildings.length} buildings, ${roads.length} roads, ${areas.length} areas, ${allPlaces.length} named places`);
  return { buildings, roads, areas, allPlaces };
}

function classifyBuilding(tags) {
  // Name-based hints for buildings whose OSM tags lack a category-defining amenity
  const nameLower = (tags.name || tags['name:en'] || '').toLowerCase();
  if (/\b(phc|primary health centre|primary health center|health centre|hospital|clinic)\b/.test(nameLower)) return 'medical';
  if (tags.amenity === 'university' || tags.building === 'university' || tags.building === 'college') return 'academic';
  if (tags.building === 'dormitory' || tags.tourism === 'hostel' || tags.building === 'hostel') return 'hostel';
  if (/\bhostel\b/.test(nameLower)) return 'hostel';
  // Faculty/staff residential: housing, quarters, Type-X blocks, bungalows.
  if (/\b(housing|quarter|quaters|bungalow)\b/.test(nameLower) || /\btype[\s-]?[a-z]\b/.test(nameLower)) return 'residential';
  if (tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'food_court') return 'dining';
  if (tags.amenity === 'hospital' || tags.amenity === 'clinic' || tags.amenity === 'pharmacy') return 'medical';
  if (tags.amenity === 'parking' || tags.building === 'parking') return 'parking';
  if (tags.leisure === 'sports_centre' || tags.leisure === 'stadium' || tags.leisure === 'fitness_centre') return 'sports';
  if (tags.building === 'temple' || tags.amenity === 'place_of_worship') return 'place_of_worship';
  if (tags.building === 'commercial' || tags.shop) return 'dining';
  if (tags.amenity === 'library') return 'academic';
  if (tags.building === 'office' || tags.office) return 'administrative';
  if (tags.building === 'security_booth') return 'gate';
  if (tags.building === 'bungalow' || tags.building === 'apartments') return 'residential';
  return 'building';
}

// POIs we deliberately keep OFF the campus overview map: bare entrance "gate"
// nodes (redundant with the hostel/facility they front + entrances.json
// routing) and off-campus settlement labels. Indoor rooms are kept — they're
// useful destinations, just rendered at high zoom only (see label_priority).
function skipPoi(tags) {
  const name = (tags.name || '').trim();
  if (tags.place === 'village' || tags.place === 'hamlet' || tags.place === 'town') return true;
  const isGate = /(^|\s)gate$/i.test(name);
  if (isGate && !tags.amenity && !tags.shop && !tags.office && !tags.tourism && !tags.leisure) return true;
  return false;
}

// Pick the most human-readable name. OSM often uses a bare unit code as `name`
// ("E-16", "W-28") while the real name lives in name:en / alt_name — surface
// that and keep the code as `ref`.
function bestName(tags) {
  const CODE = /^[A-Za-z]{1,4}[-\s]?\d+[A-Za-z]?$/;
  const name = (tags.name || tags['name:en'] || '').trim();
  // Berm / perimeter unit codes (E-14, W-21, …) stay as the map label; society
  // names remain searchable via keywords from alt_name / name:en.
  if (CODE.test(name.replace(/\s+/g, ''))) {
    return { name, ref: tags.ref || null };
  }
  if (CODE.test(name)) {
    const real = [tags['name:en'], tags.alt_name].map(s => (s || '').trim())
      .find(s => s && !CODE.test(s.replace(/\s+/g, '')));
    if (real) return { name: real, ref: name };
  }
  return { name, ref: tags.ref || null };
}

const titleize = s => String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Human-readable "what is this" line built from OSM tags, for labels/popups.
function describePoi(tags) {
  // Indoor rooms first — a lab tagged `office=yes` should read as the lab,
  // not as the generic "Office" fallback further down.
  if (tags.room === 'laboratory' || tags.healthcare === 'laboratory') {
    return tags.department ? `${tags.department} laboratory` : 'Laboratory';
  }
  if (tags.room === 'classroom') {
    return tags.department ? `${tags.department} classroom` : 'Classroom';
  }
  if (tags.indoor === 'room') {
    return tags.department || titleize(tags.room || 'indoor room');
  }
  if (tags.amenity) {
    const m = { restaurant: 'Restaurant', cafe: 'Café', fast_food: 'Fast food', food_court: 'Food court',
      bank: 'Bank', atm: 'ATM', community_centre: 'Community centre', place_of_worship: 'Place of worship',
      fountain: 'Fountain', pharmacy: 'Pharmacy', hospital: 'Hospital', clinic: 'Clinic', library: 'Library',
      parking: 'Parking' };
    const base = m[tags.amenity] || titleize(tags.amenity);
    return tags.cuisine ? `${base} · ${titleize(tags.cuisine.split(';')[0])}` : base;
  }
  if (tags.shop) {
    const m = { convenience: 'Convenience store', laundry: 'Laundry', hairdresser: 'Salon',
      institute_store: 'Institute store', instiute_store: 'Institute store', institue_store: 'Institute store',
      yes: 'Shop' };
    return m[tags.shop] || `${titleize(tags.shop)} shop`;
  }
  if (tags.club) {
    if (tags.sport) return `${titleize(tags.sport.split(';')[0])} club`;
    const m = { sport: 'Sports club', culture: 'Cultural club', art: 'Art club', music: 'Music club', yes: 'Club / Society' };
    return m[tags.club] || `${titleize(tags.club)} club`;
  }
  if (tags.office) {
    const m = { security: 'Security office', government: 'Government office', engineer: 'Engineering office',
      educational_institution: 'Institute office', yes: 'Office' };
    return m[tags.office] || `${titleize(tags.office)} office`;
  }
  if (tags.tourism === 'artwork') return 'Public artwork';
  if (tags.tourism === 'hostel') return 'Hostel';
  if (tags.police === 'checkpoint') return 'Security checkpost';
  if (tags.leisure) return titleize(tags.leisure);
  return '';
}

// Build enriched place properties shared by node POIs and named POI-ways.
function buildPoiProperties(id, tags) {
  const { name, ref } = bestName(tags);
  const keywords = [];
  for (const k of [tags.name, tags['name:en'], tags.alt_name, ref, tags.ref]) {
    const v = (k || '').trim();
    if (v && v !== name && !keywords.includes(v)) keywords.push(v);
  }
  const props = {
    osm_id: id,
    name,
    category: classifyAmenity(tags),
    source: 'osm',
    ...extractUsefulTags(tags),
  };
  if (ref) props.ref = ref;
  const description = tags.description || describePoi(tags);
  if (description) props.description = description;
  if (keywords.length) props.keywords = keywords;
  // Mark interior features so the perimeter-berm snap leaves them alone —
  // a lab labelled "E-1" inside the academic block must not migrate to the
  // nearest sandstone-gate arch on the outer berm.
  if (tags.indoor === 'room' || tags.indoor === 'yes' ||
      tags.room === 'laboratory' || tags.room === 'classroom') {
    props.indoor = true;
  }
  return props;
}

function classifyAmenity(tags) {
  if (tags.amenity === 'university' || tags.amenity === 'college' || tags.amenity === 'library') return 'academic';
  if (tags.room === 'laboratory' || tags.room === 'classroom' || tags.healthcare === 'laboratory') return 'academic';
  if (tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'fast_food' || tags.amenity === 'food_court') return 'dining';
  if (tags.amenity === 'hospital' || tags.amenity === 'clinic' || tags.amenity === 'pharmacy') return 'medical';
  if (tags.amenity === 'parking') return 'parking';
  if (tags.amenity === 'bank' || tags.amenity === 'atm') return 'bank';
  if (tags.amenity === 'place_of_worship') return 'place_of_worship';
  if (tags.police === 'checkpoint') return 'gate';
  if (tags.leisure === 'sports_centre' || tags.sport || tags.club === 'sport' || tags.leisure === 'stadium' || tags.leisure === 'swimming_pool') return 'sports';
  if (tags.leisure === 'garden' || tags.leisure === 'park') return 'recreation';
  if (tags.club || tags.tourism === 'artwork') return 'recreation';
  if (tags.tourism === 'hostel' || tags.tourism === 'hotel') return 'hostel';
  if (tags.shop) return 'utility';
  if (tags.office) return 'administrative';
  if (tags.landuse === 'residential') return 'residential';
  if (tags.amenity) return tags.amenity;
  return 'poi';
}

function classifyArea(tags) {
  if (tags.leisure === 'pitch' || tags.sport) return 'sports';
  if (tags.leisure === 'garden' || tags.leisure === 'park') return 'recreation';
  if (tags.leisure === 'sports_centre') return 'sports';
  if (tags.landuse === 'grass' || tags.landuse === 'grassland' || tags.natural === 'grassland') return 'recreation';
  if (tags.landuse === 'residential') return 'residential';
  if (tags.amenity === 'university' || tags.amenity === 'college') return 'academic';
  return 'area';
}

function extractUsefulTags(tags) {
  const useful = {};
  const keepKeys = ['opening_hours', 'phone', 'website', 'wheelchair', 'operator', 'addr:street', 'levels', 'height', 'description', 'alt_name'];
  for (const key of keepKeys) {
    if (tags[key]) useful[key] = tags[key];
  }
  return useful;
}

// ============================================================
// Curated Hardcoded Places (verified IITJ locations)
// ============================================================
function getHardcodedPlaces() {
  // Only include places NOT already in OSM data with verified coordinates.
  // OSM already has: LHC, Library, Hostels B1-B4, G1-G6, I1-I4, Y1-Y4,
  // Cricket/Basketball/Football grounds, Tapri, Mess, Admin building.
  // These curated entries fill genuine gaps.
  return [
    { name: "Gate 1 (Main Gate - NH62)", category: "gate", lat: 26.4587, lng: 73.1103, keywords: ["gate", "entrance", "exit", "main gate", "nh62", "security"], description: "Principal campus entrance from NH-62" },
    { name: "Gate 2 (South Gate)", category: "gate", lat: 26.4666, lng: 73.1078, keywords: ["gate 2", "south gate", "entrance", "exit"], description: "South campus gate" },
    { name: "ATM (SBI)", category: "bank", lat: 26.4718, lng: 73.1133, keywords: ["atm", "cash", "money", "bank", "withdraw", "sbi"], description: "SBI ATM near academic area" },
    { name: "Post Office", category: "utility", lat: 26.4716, lng: 73.1131, keywords: ["post", "mail", "courier", "letter"], description: "Campus post office" },
    { name: "Bus Stop (Main Gate)", category: "transport", lat: 26.4591, lng: 73.1106, keywords: ["bus", "stop", "transport", "bus stop"], description: "Main campus bus stop near Gate 1" },
    { name: "Parking (4-Wheeler)", category: "parking", lat: 26.4668, lng: 73.1115, keywords: ["parking", "car", "4 wheeler", "vehicle"], description: "4-wheeler parking area" },
    { name: "Parking (2-Wheeler)", category: "parking", lat: 26.4671, lng: 73.1110, keywords: ["parking", "bike", "2 wheeler", "scooter", "motorcycle"], description: "2-wheeler parking area" },
    { name: "Visitor's Hostel", category: "hostel", lat: 26.4682, lng: 73.1127, keywords: ["visitor", "guest house", "accommodation", "visitors hostel"], description: "Guest accommodation for campus visitors" },
  ].map((p, i) => ({
    type: 'Feature',
    properties: {
      id: `curated_${i}`,
      name: p.name,
      category: p.category,
      description: p.description,
      keywords: p.keywords,
      source: 'curated'
    },
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    centroid: { lat: p.lat, lng: p.lng }
  }));
}

// ============================================================
// Categories
// ============================================================
function getCategories() {
  // Palette designed for clear category-at-a-glance reading. Hues are spread
  // around the wheel so neighbouring dots stay distinguishable, conventional
  // associations are kept where possible (food=red, sports=green, academic=
  // blue), and previously-clashing pairs (medical/dining both red, parking/
  // academic both blue, bank/sports both green, gate/recreation both purple)
  // are pulled apart.
  return [
    { id: 'academic',       name: 'Academic',       icon: '🏛️', color: '#2563eb' }, // royal blue
    { id: 'hostel',         name: 'Hostels',        icon: '🏠', color: '#ea580c' }, // orange
    { id: 'dining',         name: 'Food & Dining',  icon: '🍽️', color: '#dc2626' }, // red
    { id: 'sports',         name: 'Sports',         icon: '⚽', color: '#16a34a' }, // emerald
    { id: 'medical',        name: 'Medical',        icon: '🏥', color: '#db2777' }, // pink
    { id: 'gate',           name: 'Gates',          icon: '🚪', color: '#4f46e5' }, // indigo
    { id: 'parking',        name: 'Parking',        icon: '🅿️', color: '#0369a1' }, // deep blue
    { id: 'utility',        name: 'Utilities',      icon: '🔧', color: '#64748b' }, // slate
    { id: 'administrative', name: 'Admin',          icon: '🏢', color: '#475569' }, // dark slate
    { id: 'transport',      name: 'Transport',      icon: '🚌', color: '#0d9488' }, // teal
    { id: 'recreation',     name: 'Recreation',     icon: '🎭', color: '#9333ea' }, // violet
    { id: 'residential',    name: 'Residential',    icon: '🏘️', color: '#92400e' }, // brown
    { id: 'bank',           name: 'Bank / ATM',     icon: '🏦', color: '#d97706' }, // amber
    { id: 'building',       name: 'Buildings',      icon: '🏗️', color: '#7f8c8d' }, // gray
    { id: 'other',          name: 'Other',          icon: '📍', color: '#94a3b8' }, // light slate
  ];
}

// ============================================================
// Build Road Graph for routing
// ============================================================
function buildRoadGraph(roads) {
  const graph = {}; // nodeId -> [{nodeId, distance}]
  const nodeCoords = {}; // nodeId -> [lng, lat]

  let edgeCount = 0;
  for (const road of roads) {
    const coords = road.geometry.coordinates;
    if (coords.length < 2) continue;

    for (let i = 0; i < coords.length - 1; i++) {
      const fromId = `${coords[i][1].toFixed(6)},${coords[i][0].toFixed(6)}`;
      const toId = `${coords[i + 1][1].toFixed(6)},${coords[i + 1][0].toFixed(6)}`;

      nodeCoords[fromId] = coords[i];
      nodeCoords[toId] = coords[i + 1];

      const dist = haversine(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);

      if (!graph[fromId]) graph[fromId] = [];
      if (!graph[toId]) graph[toId] = [];
      graph[fromId].push({ id: toId, dist });
      graph[toId].push({ id: fromId, dist }); // bidirectional
      edgeCount++;
    }
  }

  console.log(`  Road graph: ${Object.keys(graph).length} nodes, ${edgeCount} edges`);
  return { graph, nodeCoords };
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================
// Deduplication
// ============================================================
// Strip a parenthetical suffix, dashes, and spaces so "W-1" and "W1 (ID Card)"
// collapse to "w1" — OSM has both for the same physical perimeter office
// because the new W-N sequence was added without removing the legacy entry.
function normalizeForDedup(name) {
  return (name || '').toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/[-\s]/g, '')
    .trim();
}

function deduplicatePlaces(places) {
  // Prefer the shorter (canonical) name when two entries collide — keeps "W-1"
  // and drops "W1 (ID Card)". The dropped entry's name + description survive
  // on the winner as keywords so search still finds the legacy form.
  places = [...places].sort((a, b) => {
    const an = (a.properties.name || '').length, bn = (b.properties.name || '').length;
    return an - bn;
  });

  const result = [];
  const seen = new Map();   // key -> index in result

  for (const place of places) {
    const rawName = (place.properties.name || '').trim();
    if (!rawName || rawName.toLowerCase() === 'unknown' || rawName.toLowerCase() === 'unnamed') continue;

    const lat = place.centroid?.lat ||
      (place.geometry.type === 'Point' ? place.geometry.coordinates[1] : 0);
    const lng = place.centroid?.lng ||
      (place.geometry.type === 'Point' ? place.geometry.coordinates[0] : 0);

    // ~100m grid so nearby duplicates collide even if not exactly co-located
    const key = `${normalizeForDedup(rawName)}_${Math.round(lat * 1000)}_${Math.round(lng * 1000)}`;

    if (!seen.has(key)) {
      seen.set(key, result.length);
      result.push(place);
    } else {
      // Fold the dropped entry's distinguishing info into the survivor.
      const winner = result[seen.get(key)];
      const wp = winner.properties, lp = place.properties;
      const kws = new Set(wp.keywords || []);
      if (lp.name && lp.name !== wp.name) kws.add(lp.name);
      (lp.keywords || []).forEach(k => kws.add(k));
      if (kws.size) wp.keywords = [...kws];
      // Prefer the longer (more specific) description so a generic "Office"
      // upgrades to "Security office" when the dropped legacy entry knew.
      const lpd = (lp.description || '').trim(), wpd = (wp.description || '').trim();
      if (lpd && lpd.length > wpd.length) wp.description = lpd;
    }
  }

  return result;
}

// ============================================================
// Perimeter-berm gate snap
// ============================================================
// The OSM-coded W-N / E-N nodes that ring the campus are mapped roughly along
// the perimeter berm but their exact coords drift away from each gate, so dots
// look "scattered" in 3D. Snap each code to the nearest *unique* sandstone-
// gate module center, derived with the same centerline + parabolic-fit math
// that landmarks-3d.js uses to build the 3D berm meshes. Codes that aren't
// near a berm (the E-1..E-13 indoor labs inside the academic block) are left
// alone — their nearest gate is > 25 m away.

// Hand-tuned centerline overrides for ribbons whose 3D mesh is drawn at a
// different position than the OSM polygon's natural centerline (because the
// landscape designers nudged the rendered berm to land smoothly against the
// adjacent green retaining walls). Keep in sync with landmarks-3d.js
// BERM_CL_OVERRIDE — without this our snap would put dots off the visible
// berm body in 3D.
const BERM_CL_OVERRIDE = {
  '1412399747': [[73.1097881,26.4734200],[73.1098133,26.4733116],
                 [73.1098401,26.4732031],[73.1098685,26.4730947],
                 [73.1098989,26.4729866],[73.1099315,26.4728789],
                 [73.1099664,26.4727718],[73.1100039,26.4726656],
                 [73.1100442,26.4725603],[73.1100875,26.4724561],
                 [73.1101340,26.4723533],[73.1101839,26.4722519],
                 [73.1102375,26.4721522],[73.1102949,26.4720544],
                 [73.1103563,26.4719586]],
  // 746 — SW berm bridging green West and green Central. Hermite curve aligned
  // to both green neighbours so it follows the perimeter (see landmarks-3d.js).
  // Snap dots step along THIS path so they sit on the visibly rendered berm.
  '1412399746': [[73.1114458,26.4709836],[73.1114937,26.4709531],
                 [73.1115532,26.4709178],[73.1116230,26.4708784],
                 [73.1117015,26.4708356],[73.1117870,26.4707903],
                 [73.1118780,26.4707431],[73.1119728,26.4706951],
                 [73.1120697,26.4706469],[73.1121670,26.4705995],
                 [73.1122631,26.4705536],[73.1123563,26.4705101],
                 [73.1124450,26.4704699],[73.1125275,26.4704338],
                 [73.1126023,26.4704025],[73.1126678,26.4703769],
                 [73.1127229,26.4703576]],
  // 744 — east hostel berm: OSM ribbon midline (not a single parabolic fit) so the
  // 3D wave follows the real curved footprint; north cap extended to the NW
  // vertex so Designing / Photography clubs sit on arches, not past the berm.
  '1412399744': [[73.1178625,26.4732272],[73.1178267,26.4732736],[73.1178357,26.4733457],
                 [73.1178453,26.4734181],[73.1178549,26.4734906],[73.1178645,26.4735631],
                 [73.1178741,26.4736355],[73.1178837,26.4737080],[73.1178933,26.4737804],
                 [73.1179029,26.4738529],[73.1179109,26.4739255],[73.1179182,26.4739981],
                 [73.1179240,26.4740709],[73.1179289,26.4741437],[73.1179338,26.4742166],
                 [73.1179388,26.4742894],[73.1179437,26.4743622],[73.1179486,26.4744351],
                 [73.1179536,26.4745079],[73.1179575,26.4745808],[73.1179599,26.4746537],
                 [73.1179607,26.4747266],[73.1179766,26.4747872],[73.1180214,26.4748232],
                 [73.1179940,26.4748215],[73.1179665,26.4748202],[73.1179390,26.4748199],
                 [73.1179079,26.4748199]],
};

// Same ribbon polygons as web/js/landmarks-3d.js BERM_RINGS — keep in sync.
const BERM_RINGS = {
  '1412399742': [[73.1139971,26.4701581],[73.1139281,26.4701139],[73.1139366,26.4700285],[73.1139922,26.469976],[73.1140381,26.4699263],[73.1140918,26.4698968],[73.1141389,26.4698746],[73.1148684,26.4699108],[73.1157954,26.4701812],[73.1163295,26.4704777],[73.1167736,26.4708228],[73.1169739,26.4709971],[73.1169005,26.471106],[73.1167947,26.4711843],[73.1165963,26.4710369],[73.1163303,26.4708558],[73.1162936,26.4708343],[73.1160235,26.470676],[73.1159413,26.4706279],[73.1154878,26.4704133],[73.1153832,26.4703871],[73.1149697,26.4702837],[73.1148301,26.4702488],[73.114562,26.4702127],[73.1142636,26.4701726],[73.1141367,26.4701657],[73.1139971,26.4701581]],
  '1412399743': [[73.1176865,26.472778],[73.1177998,26.4727475],[73.1177279,26.4724356],[73.1176097,26.4721324],[73.1174723,26.4718436],[73.1172529,26.4715055],[73.1170337,26.4712786],[73.1169447,26.4713841],[73.1169901,26.4714367],[73.1171,26.471564],[73.1171751,26.4716691],[73.117262,26.4717678],[73.1173311,26.4718917],[73.1173964,26.4720088],[73.1174874,26.4721932],[73.1175373,26.4722944],[73.117604,26.4724877],[73.1176327,26.472571],[73.1176865,26.472778]],
  '1412399744': [[73.1179079,26.4748199],[73.1180214,26.4748232],[73.1179683,26.4740122],[73.1178625,26.4732272],[73.1177804,26.4732511],[73.1178367,26.4736818],[73.1178489,26.4737752],[73.1178587,26.4738503],[73.1178623,26.4738783],[73.1178651,26.4739187],[73.1178686,26.4739689],[73.1178922,26.4743067],[73.1179021,26.4744482],[73.117907,26.4745189],[73.1179118,26.4745883],[73.1179119,26.4746403],[73.1179119,26.4746584],[73.117912,26.4746811],[73.117912,26.4746931],[73.117912,26.4746993],[73.1179116,26.4747082],[73.1179113,26.474717],[73.1179108,26.4747279],[73.1179101,26.474745],[73.1179098,26.4747544],[73.1179089,26.4747756],[73.1179085,26.474785],[73.1179084,26.474791],[73.1179082,26.4748009],[73.1179079,26.4748199]],
  '1412399745': [[73.1178945,26.4767757],[73.1179645,26.4767812],[73.1180186,26.4759883],[73.118021,26.4751844],[73.1178836,26.4751876],[73.1178945,26.4767757]],
  '1412399746': [[73.1116108,26.4709223],[73.1127329,26.470358],[73.1126364,26.4702329],[73.1126063,26.4701921],[73.1123435,26.4702898],[73.1121028,26.4703887],[73.1118016,26.4705435],[73.1116094,26.4706592],[73.1114447,26.4707397],[73.1116108,26.4709223]],
  '1412399747': [[73.1097023,26.4734068],[73.1098739,26.4734332],[73.1099403,26.473175],[73.1100196,26.4728522],[73.1100912,26.4725725],[73.1102595,26.4722394],[73.1104473,26.4719164],[73.1102701,26.4718617],[73.1101139,26.4720856],[73.1099781,26.4724125],[73.1098461,26.4727336],[73.1097671,26.4730857],[73.1097023,26.4734068]],
  '1412399748': [[73.1101619,26.4754659],[73.1102827,26.475428],[73.1102425,26.4753096],[73.1101577,26.4750596],[73.1100728,26.4748093],[73.1100105,26.4746257],[73.1099899,26.4744632],[73.1099481,26.4741328],[73.1099109,26.4738396],[73.1098886,26.4736633],[73.1097469,26.4737016],[73.109814,26.4743117],[73.1100332,26.4751007],[73.1101619,26.4754659]],
  '1412399749': [[73.1114299,26.4769472],[73.1113573,26.4770122],[73.1110443,26.4767393],[73.1107866,26.4764361],[73.1106529,26.476247],[73.1105142,26.4760599],[73.1103106,26.4756886],[73.1104166,26.4756411],[73.1105986,26.4759669],[73.1108144,26.4762666],[73.1110387,26.4765146],[73.1111862,26.4766778],[73.111348,26.4768566],[73.1114299,26.4769472]],
  '1412399750': [[73.1123453,26.4779449],[73.1124336,26.4778855],[73.1123054,26.4777493],[73.1120838,26.4775138],[73.1116576,26.4771598],[73.1115907,26.4772409],[73.1119917,26.4776168],[73.1123453,26.4779449]],
  '1412399756': [[73.1127515,26.4703585],[73.1128339,26.4703545],[73.1129424,26.4703204],[73.1131518,26.4702481],[73.1134613,26.4701893],[73.1136596,26.4701332],[73.1137171,26.4700415],[73.1136962,26.4699356],[73.1136208,26.4698849],[73.1135007,26.4698348],[73.1132565,26.4698697],[73.112922,26.4699581],[73.1125958,26.4700771],[73.1127515,26.4703585]],
  '1412399757': [[73.1107668,26.4715451],[73.1112284,26.4711812],[73.111584,26.4709459],[73.1113248,26.4707369],[73.1110033,26.4709451],[73.1108141,26.4711119],[73.1105554,26.4713678],[73.1107668,26.4715451]],
};

function _resampleXY(chain, K) {
  if (chain.length === 1) return new Array(K).fill(chain[0]);
  const arc = [0];
  for (let i = 1; i < chain.length; i++) arc.push(arc[i-1] + Math.hypot(chain[i][0]-chain[i-1][0], chain[i][1]-chain[i-1][1]));
  const total = arc[arc.length-1] || 1;
  const out = [];
  for (let k = 0; k < K; k++) {
    const s = (k/(K-1)) * total;
    let seg = 0;
    while (seg < arc.length-2 && arc[seg+1] <= s) seg++;
    const sl = arc[seg+1]-arc[seg] || 1, t = (s-arc[seg])/sl;
    out.push([chain[seg][0] + t*(chain[seg+1][0]-chain[seg][0]),
              chain[seg][1] + t*(chain[seg+1][1]-chain[seg][1])]);
  }
  return out;
}

function _solve3(M, r) {
  const a = M.map((row, i) => row.concat(r[i]));
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let i = c+1; i < 3; i++) if (Math.abs(a[i][c]) > Math.abs(a[p][c])) p = i;
    [a[c], a[p]] = [a[p], a[c]];
    const piv = a[c][c] || 1e-9;
    for (let j = c; j < 4; j++) a[c][j] /= piv;
    for (let i = 0; i < 3; i++) if (i !== c) { const f = a[i][c]; for (let j = c; j < 4; j++) a[i][j] -= f*a[c][j]; }
  }
  return [a[0][3], a[1][3], a[2][3]];
}

function _quadFit(T, W) {
  let s0 = T.length, s1 = 0, s2 = 0, s3 = 0, s4 = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < T.length; i++) {
    const t = T[i], w = W[i], t2 = t*t;
    s1 += t; s2 += t2; s3 += t2*t; s4 += t2*t2;
    b0 += w; b1 += w*t; b2 += w*t2;
  }
  const [A, B, C] = _solve3([[s4,s3,s2],[s3,s2,s1],[s2,s1,s0]], [b2,b1,b0]);
  return { A, B, C };
}

// Sample the centerline of a ribbon ring in metric coords (PCA long axis with
// a parabolic across-axis fit) and return the lng/lat midpoint of each module.
function ribbonGateCenters(ring, moduleW = 7.5) {
  const pts = ring.slice(0, ring.length-1);
  const n = pts.length;
  let cx = 0, cy = 0;
  pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= n; cy /= n;
  const mLng = 111320 * Math.cos(cy * Math.PI/180), mLat = 111320;
  const P = pts.map(p => [(p[0]-cx)*mLng, (p[1]-cy)*mLat]);
  let sxx = 0, sxy = 0, syy = 0;
  P.forEach(([x,y]) => { sxx += x*x; sxy += x*y; syy += y*y; });
  const theta = 0.5 * Math.atan2(2*sxy, sxx - syy);
  const ax = Math.cos(theta), ay = Math.sin(theta), bx = -ay, by = ax;
  const t = P.map(([x,y]) => x*ax + y*ay);
  let iMin = 0, iMax = 0;
  t.forEach((v,i) => { if (v < t[iMin]) iMin = i; if (v > t[iMax]) iMax = i; });
  const chain = (from, to) => { const c = []; let i = from; for (;;) { c.push(P[i]); if (i === to) break; i = (i+1)%n; } return c; };
  const K = 22;
  const ra = _resampleXY(chain(iMin, iMax), K);
  const rb = _resampleXY(chain(iMax, iMin).reverse(), K);
  const T = [], W = [];
  for (let i = 0; i < K; i++) {
    const mx = (ra[i][0]+rb[i][0])/2, my = (ra[i][1]+rb[i][1])/2;
    T.push(mx*ax + my*ay); W.push(mx*bx + my*by);
  }
  const f = _quadFit(T, W);
  const tMin = Math.min(...T), tMax = Math.max(...T);
  // Dense centerline samples in metric coords
  const dense = 200;
  const samples = [];
  for (let i = 0; i < dense; i++) {
    const tt = tMin + (tMax-tMin)*i/(dense-1);
    const ww = f.A*tt*tt + f.B*tt + f.C;
    samples.push([tt*ax + ww*bx, tt*ay + ww*by]);
  }
  return _moduleMidpointsFromMetric(samples, cx, cy, mLng, mLat, moduleW).gates;
}

// Step gates along a hand-tuned centerline (lng/lat polyline). Used for ribbons
// that have a BERM_CL_OVERRIDE so the snap targets match the rendered 3D mesh.
function pathGateCenters(path, moduleW = 7.5) {
  let cx = 0, cy = 0;
  path.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= path.length; cy /= path.length;
  const mLng = 111320 * Math.cos(cy * Math.PI/180), mLat = 111320;
  const samples = path.map(p => [(p[0]-cx)*mLng, (p[1]-cy)*mLat]);
  return _moduleMidpointsFromMetric(samples, cx, cy, mLng, mLat, moduleW).gates;
}

function _moduleMidpointsFromMetric(samples, cx, cy, mLng, mLat, moduleW) {
  let total = 0;
  const arc = [0];
  for (let i = 1; i < samples.length; i++) {
    total += Math.hypot(samples[i][0]-samples[i-1][0], samples[i][1]-samples[i-1][1]);
    arc.push(total);
  }
  const nMods = Math.max(1, Math.round(total / moduleW));
  const stepW = total / nMods;
  const gates = [];
  for (let m = 0; m < nMods; m++) {
    const targetS = (m + 0.5) * stepW;
    let seg = 0;
    while (seg < arc.length-2 && arc[seg+1] <= targetS) seg++;
    const sl = arc[seg+1]-arc[seg] || 1, u = (targetS-arc[seg])/sl;
    const lx = samples[seg][0] + u*(samples[seg+1][0]-samples[seg][0]);
    const ly = samples[seg][1] + u*(samples[seg+1][1]-samples[seg][1]);
    gates.push([cx + lx/mLng, cy + ly/mLat]);
  }
  const centerline = [];
  for (let i = 0; i < samples.length; i++) {
    centerline.push([cx + samples[i][0]/mLng, cy + samples[i][1]/mLat]);
  }
  return { gates, centerline, total, moduleW, minModules: nMods };
}

function _ringMidlineCenterline(ring, K = 48) {
  const pts = ring.slice(0, ring.length - 1);
  const n = pts.length;
  let cx = 0, cy = 0;
  pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= n; cy /= n;
  const mLng = 111320 * Math.cos(cy * Math.PI / 180), mLat = 111320;
  const P = pts.map(p => [(p[0] - cx) * mLng, (p[1] - cy) * mLat]);
  let sxx = 0, sxy = 0, syy = 0;
  P.forEach(([x, y]) => { sxx += x * x; sxy += x * y; syy += y * y; });
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ax = Math.cos(theta), ay = Math.sin(theta), bx = -ay, by = ax;
  const t = P.map(([x, y]) => x * ax + y * ay);
  let iMin = 0, iMax = 0;
  t.forEach((v, i) => { if (v < t[iMin]) iMin = i; if (v > t[iMax]) iMax = i; });
  const chain = (from, to) => {
    const c = []; let i = from;
    for (;;) { c.push(P[i]); if (i === to) break; i = (i + 1) % n; }
    return c;
  };
  const ra = _resampleXY(chain(iMin, iMax), K);
  const rb = _resampleXY(chain(iMax, iMin).reverse(), K);
  const centerline = [];
  for (let i = 0; i < K; i++) {
    centerline.push([
      cx + (ra[i][0] + rb[i][0]) / 2 / mLng,
      cy + (ra[i][1] + rb[i][1]) / 2 / mLat,
    ]);
  }
  let total = 0;
  for (let i = 1; i < centerline.length; i++) {
    total += _distPairM(centerline[i - 1], centerline[i]);
  }
  return { centerline, total, cx, cy, mLng, mLat };
}

function _distPairM(a, b) {
  const cosLat = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * 111320 * cosLat, (b[1] - a[1]) * 111320);
}

function _denseMetricSamples(ring, overridePath) {
  if (overridePath) {
    let cx = 0, cy = 0;
    overridePath.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= overridePath.length; cy /= overridePath.length;
    const mLng = 111320 * Math.cos(cy * Math.PI/180), mLat = 111320;
    const samples = overridePath.map(p => [(p[0]-cx)*mLng, (p[1]-cy)*mLat]);
    return { samples, cx, cy, mLng, mLat };
  }
  const { centerline, cx, cy, mLng, mLat } = _ringMidlineCenterline(ring, 56);
  const samples = centerline.map(p => [(p[0] - cx) * mLng, (p[1] - cy) * mLat]);
  return { samples, cx, cy, mLng, mLat };
}

function ribbonGatesForRibbon(ring, overridePath, moduleW = 7.5, minCount = 0) {
  const MIN_W = 5.25;
  let w = moduleW;
  let result;
  do {
    const { samples, cx, cy, mLng, mLat } = _denseMetricSamples(ring, overridePath);
    result = _moduleMidpointsFromMetric(samples, cx, cy, mLng, mLat, w);
  } while (result.gates.length < minCount && (w -= 0.25) >= MIN_W);
  return result;
}

// Metric arc-length along a lng/lat centerline — used to project OSM POIs onto
// the berm ribbon so nearest-unused-gate assignment follows berm order, not
// crow-flight distance (which lets southern POIs steal northern arches).
function _centerlineMetric(centerline) {
  const refLat = centerline[0][1];
  const mLng = 111320 * Math.cos(refLat * Math.PI / 180);
  const mLat = 111320;
  const pts = centerline.map(([lng, lat]) => [lng * mLng, lat * mLat]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum, mLng, mLat };
}

function _projectArcS(lng, lat, centerline) {
  const { pts, cum, mLng, mLat } = _centerlineMetric(centerline);
  const px = lng * mLng, py = lat * mLat;
  let bestS = 0, bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1];
    const bx = pts[i][0], by = pts[i][1];
    const abx = bx - ax, aby = by - ay;
    const ab2 = abx * abx + aby * aby || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / ab2));
    const qx = ax + t * abx, qy = ay + t * aby;
    const d = Math.hypot(px - qx, py - qy);
    if (d < bestD) {
      bestD = d;
      bestS = cum[i - 1] + t * Math.sqrt(ab2);
    }
  }
  return bestS;
}

function _centerlineTotal(centerline) {
  const { cum } = _centerlineMetric(centerline);
  return cum[cum.length - 1];
}

// Lng/lat on the berm centerline at arc-length s (extrapolates past the end).
function _lngLatAtArcS(s, centerline) {
  const { pts, cum, mLng, mLat } = _centerlineMetric(centerline);
  const total = cum[cum.length - 1];
  if (s <= total) {
    let i = 1;
    while (i < cum.length && cum[i] < s) i++;
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(pts.length - 1, i0 + 1);
    const sl = cum[i1] - cum[i0] || 1;
    const t = (s - cum[i0]) / sl;
    return [
      (pts[i0][0] + t * (pts[i1][0] - pts[i0][0])) / mLng,
      (pts[i0][1] + t * (pts[i1][1] - pts[i0][1])) / mLat,
    ];
  }
  const n = pts.length;
  const ax = pts[n - 2][0], ay = pts[n - 2][1];
  const bx = pts[n - 1][0], by = pts[n - 1][1];
  const dx = bx - ax, dy = by - ay;
  const segLen = Math.hypot(dx, dy) || 1;
  const extra = s - total;
  return [(bx + (dx / segLen) * extra) / mLng, (by + (dy / segLen) * extra) / mLat];
}

function _extendCenterlineArc(centerline, targetS) {
  const total = _centerlineTotal(centerline);
  if (targetS <= total + 0.5) return { centerline, lengthM: total };
  const extended = centerline.slice();
  let cur = total;
  const step = 3.5;
  while (cur < targetS) {
    cur += step;
    extended.push(_lngLatAtArcS(cur, extended));
  }
  return { centerline: extended, lengthM: cur };
}

// Keep every POI gate on the berm arc — shift or compress along the curve
// instead of extrapolating straight past the OSM footprint.
function _fitGateArcsToBerm(poiBindings, centerline, minSpacing) {
  if (!poiBindings.length) return;
  const total = _centerlineTotal(centerline);
  const endPad = minSpacing * 0.4;
  const startPad = minSpacing * 0.25;

  let maxS = poiBindings[poiBindings.length - 1].s;
  if (maxS > total - endPad) {
    const shift = maxS - (total - endPad);
    poiBindings.forEach(b => { b.s = Math.max(startPad, b.s - shift); });
  }

  for (let i = 1; i < poiBindings.length; i++) {
    if (poiBindings[i].s - poiBindings[i - 1].s < minSpacing * 0.92) {
      poiBindings[i].s = poiBindings[i - 1].s + minSpacing;
    }
  }

  maxS = poiBindings[poiBindings.length - 1].s;
  if (maxS > total - endPad && poiBindings.length > 1) {
    const span = maxS - poiBindings[0].s;
    const avail = total - endPad - poiBindings[0].s;
    if (span > avail) {
      const scale = avail / span;
      for (let i = 1; i < poiBindings.length; i++) {
        poiBindings[i].s = poiBindings[0].s + (poiBindings[i].s - poiBindings[0].s) * scale;
      }
    }
  }
}

// One dedicated gate per POI on the berm centerline; spread clusters so labels
// never stack, then add filler arches only in wide gaps for a continuous 3D mesh.
function _poiGateLayoutFromPOIs(list, centerline, minSpacing = 7.25, fillGap = 12) {
  const sorted = list
    .map((item, idx) => ({ ...item, idx, s: _projectArcS(item.lng, item.lat, centerline) }))
    .sort((a, b) => a.s - b.s
      || a.lng - b.lng
      || (a.cand.place.properties.name || '').localeCompare(b.cand.place.properties.name || ''));

  const poiBindings = [];
  let lastS = -Infinity;
  for (const item of sorted) {
    const s = poiBindings.length === 0
      ? Math.max(0, item.s)
      : Math.max(item.s, lastS + minSpacing);
    poiBindings.push({ poiIdx: item.idx, s });
    lastS = s;
  }

  _fitGateArcsToBerm(poiBindings, centerline, minSpacing);

  const moduleArcs = [];
  const pushArc = (s) => {
    if (!moduleArcs.length || Math.abs(s - moduleArcs[moduleArcs.length - 1]) > 0.5) {
      moduleArcs.push(s);
    }
  };

  for (let i = 0; i < poiBindings.length; i++) {
    if (i > 0) {
      const gap = poiBindings[i].s - poiBindings[i - 1].s;
      if (gap > fillGap) {
        const nFill = Math.max(1, Math.round(gap / minSpacing) - 1);
        for (let f = 1; f <= nFill; f++) {
          pushArc(poiBindings[i - 1].s + (gap * f) / (nFill + 1));
        }
      }
    }
    pushArc(poiBindings[i].s);
  }

  return { poiBindings, moduleArcs };
}

// Minimum-cost bipartite matching: n POIs → m gates (n ≤ m). Hungarian
// algorithm — globally optimal 1:1 assignment minimizing total distance.
function minCostGateAssign(cost) {
  const n = cost.length;
  if (!n) return [];
  const m = cost[0].length;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      const row = cost[i0 - 1];
      for (let j = 1; j <= m; j++) {
        if (!used[j]) {
          const cur = row[j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const ans = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j]) ans[p[j] - 1] = j - 1;
  }
  return ans;
}

// Pull berm ribbon polygons from OSM (map-new.osm refresh) — falls back to BERM_RINGS.
function extractOsmBermRings(osmData) {
  const { nodes, ways } = osmData;
  const rings = {};
  for (const way of ways) {
    const tags = way.tags || {};
    const name = tags.name || '';
    if (!(name === 'Berms' || name === 'W Berms' || tags.building === 'berms')) continue;
    const coords = way.nodeIds
      .filter(nid => nodes[nid])
      .map(nid => [nodes[nid].lon, nodes[nid].lat]);
    if (coords.length < 4) continue;
    const closed = coords[0][0] === coords[coords.length-1][0]
      && coords[0][1] === coords[coords.length-1][1];
    rings[way.id] = closed ? coords : [...coords, coords[0]];
  }
  return rings;
}

function buildBermGateLayout(osmData, defaultModuleW = 7.5) {
  const osmRings = extractOsmBermRings(osmData);
  const mergedRings = { ...BERM_RINGS, ...osmRings };
  const GREEN_BERM_IDS = new Set(['1412399742', '1412399756', '1412399757']);
  const layout = {};
  for (const id of Object.keys(mergedRings)) {
    if (GREEN_BERM_IDS.has(id)) continue;
    const ring = mergedRings[id];
    const override = BERM_CL_OVERRIDE[id];
    const spec = ribbonGatesForRibbon(ring, override, defaultModuleW, 0);
    layout[id] = {
      gates: spec.gates.map(([lng, lat]) => ({ lng, lat })),
      centerline: spec.centerline,
      moduleW: spec.moduleW,
      minModules: spec.minModules,
      lengthM: spec.total,
    };
  }
  return { layout, mergedRings };
}

function snapPerimeterCodes(places, osmData) {
  const ELIGIBILITY_M = 25;
  const GREEN_BERM_IDS = new Set(['1412399742', '1412399756', '1412399757']);

  const { layout, mergedRings } = buildBermGateLayout(osmData);
  const flatGates = [];
  for (const [ribbonId, spec] of Object.entries(layout)) {
    spec.gates.forEach((g, gi) => {
      flatGates.push({ ...g, ribbonId, gi, used: false });
    });
  }

  const candidates = places
    .map((place, idx) => ({ place, idx }))
    .filter(({ place }) => (place.properties.name || '').trim()
      && place.geometry.type === 'Point'
      && !/^(Hockey Ground|Pronite Ground|Informal Grounds)$/i.test((place.properties.name || '').trim()));

  const cosLat = Math.cos(26.473 * Math.PI/180);
  const distM = (lng, lat, g) => {
    const dx = (g.lng - lng) * 111320 * cosLat;
    const dy = (g.lat - lat) * 111320;
    return Math.hypot(dx, dy);
  };

  // Group eligible candidates by home berm ribbon.
  const byRibbon = new Map();
  for (const cand of candidates) {
    const [lng, lat] = cand.place.geometry.coordinates;
    let nearest = null, minD = Infinity;
    for (const g of flatGates) {
      const d = distM(lng, lat, g);
      if (d < minD) { minD = d; nearest = g; }
    }
    if (!nearest || minD > ELIGIBILITY_M) continue;
    const homeRibbon = nearest.ribbonId;
    const list = byRibbon.get(homeRibbon) || [];
    list.push({ cand, lat, lng, minD });
    byRibbon.set(homeRibbon, list);
  }

  const bermEntrances = {};
  let snapped = 0;

  for (const [ribbonId, list] of byRibbon) {
    const poiCount = list.length;
    const ring = mergedRings[ribbonId];
    const override = BERM_CL_OVERRIDE[ribbonId];
    const baseSpec = ribbonGatesForRibbon(ring, override, layout[ribbonId].moduleW, 0);
    const gateSpacing = baseSpec.moduleW;
    let centerline = override || baseSpec.centerline;
    let { poiBindings, moduleArcs } = _poiGateLayoutFromPOIs(list, centerline, gateSpacing);
    let lengthM = _centerlineTotal(centerline);
    const maxArc = poiBindings[poiBindings.length - 1].s + gateSpacing * 0.5;
    if (maxArc > lengthM - gateSpacing * 0.4) {
      centerline = _extendCenterlineArc(centerline, maxArc).centerline;
      lengthM = _centerlineTotal(centerline);
      ({ poiBindings, moduleArcs } = _poiGateLayoutFromPOIs(list, centerline, gateSpacing));
    }

    const gates = moduleArcs.map(s => {
      const [lng, lat] = _lngLatAtArcS(s, centerline);
      return { lng, lat, s };
    });

    layout[ribbonId].gates = gates.map(({ lng, lat }) => ({ lng, lat }));
    layout[ribbonId].centerline = centerline;
    layout[ribbonId].moduleArcs = moduleArcs;
    layout[ribbonId].poiGateArcs = poiBindings.map(b => b.s);
    layout[ribbonId].moduleW = gateSpacing;
    layout[ribbonId].minModules = moduleArcs.length;
    layout[ribbonId].lengthM = lengthM;
    layout[ribbonId].poiCount = poiCount;
    layout[ribbonId].poiDriven = true;

    const listByIdx = list.slice();
    for (const { poiIdx, s } of poiBindings) {
      const { cand } = listByIdx[poiIdx];
      const [lng, lat] = _lngLatAtArcS(s, centerline);
      cand.place.geometry.coordinates = [lng, lat];
      if (cand.place.centroid) cand.place.centroid = { lat, lng };
      const name = (cand.place.properties.name || '').trim();
      if (name) {
        bermEntrances[name] = { lat, lng, gate_name: 'sandstone gate', berm: true };
      }
      snapped++;
    }
  }

  console.log(`  Perimeter layout: ${snapped} berm POIs on dedicated sandstone gates`);
  return { places, bermEntrances, bermLayout: layout };
}

// Blue wave-berm ribbons rendered in 3D (landmarks-3d.js BERM_IDS) — keep in sync.
const WAVE_BERM_IDS = new Set([
  '1412399743', '1412399744', '1412399745', '1412399746',
  '1412399747', '1412399748', '1412399749', '1412399750',
]);
// South-edge green terraced landscape berms (not blue wave ribbons).
const LANDSCAPE_BERM_IDS = new Set(['1412399742', '1412399756', '1412399757']);

function bermTypeForId(id) {
  if (LANDSCAPE_BERM_IDS.has(id)) return 'landscape';
  if (WAVE_BERM_IDS.has(id)) return 'wave';
  return 'landscape';
}

// Build berms.geojson for the 2D map. OSM berm ways are the primary source;
// any ribbon missing from the extract (e.g. map-new.osm drops the west cluster)
// is filled from BERM_RINGS so normal view always matches the 3D berm layout.
function buildBermsGeoJSON(osmData) {
  const { nodes, ways } = osmData;
  const features = [];
  const seen = new Set();

  for (const way of ways) {
    const tags = way.tags || {};
    const name = tags.name || tags['name:en'] || '';
    const isBerm = name === 'Berms' || name === 'W Berms' || tags.building === 'berms';
    if (!isBerm) continue;

    const coords = way.nodeIds
      .filter(nid => nodes[nid])
      .map(nid => [nodes[nid].lon, nodes[nid].lat]);
    if (coords.length < 4) continue;
    const closed = coords[0][0] === coords[coords.length - 1][0]
      && coords[0][1] === coords[coords.length - 1][1];
    const ring = closed ? coords : [...coords, coords[0]];

    seen.add(way.id);
    features.push({
      type: 'Feature',
      properties: {
        osm_id: way.id,
        name: name || 'Berms',
        berm_type: bermTypeForId(way.id),
        category: 'berm',
        source: 'osm',
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
      centroid: computeCentroid(ring),
    });
  }

  for (const [id, ring] of Object.entries(BERM_RINGS)) {
    if (seen.has(id)) continue;
    const coords = ring.slice();
    if (coords.length < 4) continue;
    features.push({
      type: 'Feature',
      properties: {
        osm_id: id,
        name: 'Berms',
        berm_type: bermTypeForId(id),
        category: 'berm',
        source: 'berm_rings',
      },
      geometry: { type: 'Polygon', coordinates: [coords] },
      centroid: computeCentroid(coords),
    });
  }

  return { type: 'FeatureCollection', features };
}

// ============================================================
// Main
// ============================================================
function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  IITJ Maps — GIS Data Pipeline v2');
  console.log('═══════════════════════════════════════════\n');

  const osmPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', '..', 'map.osm');
  const mapNewPath = path.join(__dirname, '..', '..', 'map-new.osm');
  const kmlPath = path.join(__dirname, '..', '..', 'Copy of Phase 3B.kml');
  const outDir = path.join(__dirname, '..', 'data');

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // 1. Parse OSM
  console.log('📖 OSM source:', osmPath);
  const osmData = parseOSM(osmPath);
  const { buildings, roads, areas, allPlaces } = extractFeatures(osmData);
  const bermOsmPath = (!process.argv[2] && fs.existsSync(mapNewPath)) ? mapNewPath : osmPath;
  const bermOsmData = bermOsmPath === osmPath ? osmData : parseOSM(bermOsmPath);
  const berms = buildBermsGeoJSON(bermOsmData);
  if (bermOsmPath !== osmPath) {
    console.log(`  Berm layout OSM  : ${bermOsmPath} (${berms.features.filter(f => f.properties.source === 'osm').length} ways + BERM_RINGS fill)`);
  }

  // 2. Parse KML
  const kmlFeatures = parseKML(kmlPath);

  // 3. Curated places (only those NOT already in OSM, with verified coordinates)
  const curatedPlaces = getHardcodedPlaces();

  // 4. Merge & deduplicate places (OSM first, then KML, then curated as fallback)
  const mergedPlaces = deduplicatePlaces([...allPlaces, ...kmlFeatures, ...curatedPlaces]);

  // 4b. Snap perimeter POIs (W-codes, E-codes, berm societies) to the nearest
  //     sandstone-gate arch center. OSM places these nodes on the access road
  //     next to the berm, not at the actual gate openings, so without this snap
  //     their dots appear on the flat ground rather than on the berm structure.
  //     homeRibbon constraint prevents cross-berm overflow (e.g. Designing Club
  //     staying on berm 744 instead of spilling onto 745).
  const { bermEntrances, bermLayout } = snapPerimeterCodes(mergedPlaces, bermOsmData);
  const webDataDir = path.join(__dirname, '..', '..', 'web', 'data');
  const bermEntrancesPath = path.join(outDir, 'berm-entrances.json');
  fs.writeFileSync(bermEntrancesPath, JSON.stringify(bermEntrances, null, 2));
  fs.writeFileSync(path.join(webDataDir, 'berm-entrances.json'), JSON.stringify(bermEntrances, null, 2));
  fs.writeFileSync(path.join(outDir, 'berm-layout.json'), JSON.stringify(bermLayout, null, 2));
  fs.writeFileSync(path.join(webDataDir, 'berm-layout.json'), JSON.stringify(bermLayout, null, 2));
  const layout9744 = bermLayout['1412399744'];
  if (layout9744) {
    console.log(`  Berm 9744 layout  : ${layout9744.poiCount || 0} POIs → ${layout9744.minModules} arches @ ${layout9744.moduleW}m`);
  }
  console.log(`  Berm entrances    : ${Object.keys(bermEntrances).length} routing gates`);

  // 5. Build road graph and save
  const { graph, nodeCoords } = RoadClassifier.buildRoadGraph(roads);
  const roadAudit = RoadClassifier.buildRoadAudit(roads);

  // 6. Write output files
  fs.writeFileSync(path.join(outDir, 'berms.geojson'), JSON.stringify(berms, null, 2));
  fs.writeFileSync(path.join(webDataDir, 'berms.geojson'), JSON.stringify(berms, null, 2));

  fs.writeFileSync(path.join(outDir, 'buildings.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: buildings }, null, 2));
  fs.writeFileSync(path.join(outDir, 'roads.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: roads }, null, 2));
  fs.writeFileSync(path.join(outDir, 'places.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: mergedPlaces }, null, 2));
  fs.writeFileSync(path.join(outDir, 'areas.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: areas }, null, 2));
  fs.writeFileSync(path.join(outDir, 'categories.json'),
    JSON.stringify(getCategories(), null, 2));
  fs.writeFileSync(path.join(outDir, 'road-graph.json'),
    JSON.stringify({ graph, nodeCoords }, null, 2));
  fs.writeFileSync(path.join(outDir, 'road-audit.json'),
    JSON.stringify(roadAudit, null, 2));

  // Build search index (places + areas)
  const allSearchable = [
    ...mergedPlaces,
    ...areas.map(a => ({
      ...a,
      centroid: a.centroid,
      properties: { ...a.properties, description: a.properties.area_type || '' }
    }))
  ];
  const searchIndex = allSearchable.map(f => ({
    id: f.properties.osm_id || f.properties.id || f.properties.name,
    name: f.properties.name,
    category: f.properties.category,
    description: f.properties.description || f.properties.area_type || '',
    keywords: f.properties.keywords || [],
    lat: f.centroid?.lat || (f.geometry.type === 'Point' ? f.geometry.coordinates[1] : null),
    lng: f.centroid?.lng || (f.geometry.type === 'Point' ? f.geometry.coordinates[0] : null),
    source: f.properties.source || 'osm',
    is_proposed: f.properties.is_proposed || false
  })).filter(p => p.lat && p.lng);

  // Deduplicate search index by name
  const siSeen = new Set();
  const dedupedIndex = searchIndex.filter(p => {
    const k = p.name.toLowerCase().trim();
    if (siSeen.has(k)) return false;
    siSeen.add(k);
    return true;
  });

  fs.writeFileSync(path.join(outDir, 'search-index.json'),
    JSON.stringify(dedupedIndex, null, 2));

  // Mirror key campus layers to web/data (frontend reads from here).
  for (const fname of ['places.geojson', 'search-index.json', 'buildings.geojson', 'roads.geojson', 'areas.geojson']) {
    fs.copyFileSync(path.join(outDir, fname), path.join(webDataDir, fname));
  }

  console.log('\n✅ Output files written to:', outDir);
  console.log(`   berms.geojson     : ${berms.features.length} features`);
  console.log(`   buildings.geojson : ${buildings.length} features`);
  console.log(`   roads.geojson     : ${roads.length} features`);
  console.log(`   areas.geojson     : ${areas.length} features`);
  console.log(`   places.geojson    : ${mergedPlaces.length} features`);
  console.log(`   search-index.json : ${dedupedIndex.length} entries`);
  console.log(`   road-graph.json   : ${Object.keys(graph).length} graph nodes`);
  console.log(`   categories.json   : ${getCategories().length} categories`);
}

main();
