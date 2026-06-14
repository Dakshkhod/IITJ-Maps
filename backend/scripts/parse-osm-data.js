/**
 * IITJ Maps — OSM + KML Data Pipeline
 * Uses proper DOM parsing to extract all buildings, roads, places from OSM+KML.
 */

const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');

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
  if (lower.includes('hostel') || lower.includes('housing')) return 'hostel';
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

    // Buildings — skip non-building types (berms, walls, etc.)
    if (tags.building && !NON_BUILDING_TYPES.has(tags.building)) {
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
          source: 'osm'
        },
        geometry: { type: 'LineString', coordinates: coords }
      };
      roads.push(feature);
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
  if (CODE.test(name)) {
    const real = [tags['name:en'], tags.alt_name].map(s => (s || '').trim())
      .find(s => s && !CODE.test(s));
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
  '1412399746': [[73.1114458,26.4709836],[73.1115934,26.4708878],
                 [73.1117448,26.4707963],[73.1118999,26.4707094],
                 [73.1120585,26.4706275],[73.1122202,26.4705510],
                 [73.1123850,26.4704803],[73.1125527,26.4704157],
                 [73.1127229,26.4703576]],
  '1412399747': [[73.1097881,26.4734200],[73.1098133,26.4733116],
                 [73.1098401,26.4732031],[73.1098685,26.4730947],
                 [73.1098989,26.4729866],[73.1099315,26.4728789],
                 [73.1099664,26.4727718],[73.1100039,26.4726656],
                 [73.1100442,26.4725603],[73.1100875,26.4724561],
                 [73.1101340,26.4723533],[73.1101839,26.4722519],
                 [73.1102375,26.4721522],[73.1102949,26.4720544],
                 [73.1103563,26.4719586]],
};

// Same ribbon polygons as web/js/landmarks-3d.js BERM_RINGS — keep in sync.
const BERM_RINGS = {
  '1412399743': [[73.117733,26.4727959],[73.1178463,26.4727654],[73.1177744,26.4724535],[73.1176562,26.4721503],[73.1175188,26.4718615],[73.1172994,26.4715234],[73.1170802,26.4712965],[73.1169912,26.471402],[73.1170366,26.4714546],[73.1171465,26.4715819],[73.1172265,26.4716826],[73.1173085,26.4717857],[73.1173776,26.4719096],[73.1174429,26.4720267],[73.1175339,26.4722111],[73.1175838,26.4723123],[73.1176505,26.4725056],[73.1176792,26.4725889],[73.117733,26.4727959]],
  '1412399744': [[73.1179478,26.474843],[73.1180613,26.4748463],[73.1180082,26.4740353],[73.1179024,26.4732503],[73.1178203,26.4732742],[73.1179022,26.4739014],[73.1179517,26.4746114],[73.1179484,26.4748081],[73.1179478,26.474843]],
  '1412399745': [[73.1178945,26.4767757],[73.1179645,26.4767812],[73.1180186,26.4759883],[73.118021,26.4751844],[73.1179529,26.4751885],[73.1178945,26.4767757]],
  '1412399746': [[73.1116091,26.4708164],[73.1126945,26.4703236],[73.112598,26.4701985],[73.1125679,26.4701577],[73.1123051,26.4702554],[73.1120644,26.4703543],[73.1117632,26.4705091],[73.111571,26.4706248],[73.1114776,26.4706763],[73.1116091,26.4708164]],
  '1412399747': [[73.1097023,26.4734068],[73.1098739,26.4734332],[73.1099403,26.473175],[73.1100196,26.4728522],[73.1100912,26.4725725],[73.1102595,26.4722394],[73.1104473,26.4719164],[73.1102701,26.4718617],[73.1101139,26.4720856],[73.1099781,26.4724125],[73.1098461,26.4727336],[73.1097671,26.4730857],[73.1097023,26.4734068]],
  '1412399748': [[73.1101124,26.4754538],[73.1102332,26.4754159],[73.109961,26.4746136],[73.1098391,26.4736512],[73.1096974,26.4736895],[73.1097645,26.4742996],[73.1099837,26.4750886],[73.1101124,26.4754538]],
  '1412399749': [[73.1113913,26.4769578],[73.1113187,26.4770228],[73.1110057,26.4767499],[73.110748,26.4764467],[73.1106143,26.4762576],[73.1104756,26.4760705],[73.110272,26.4756992],[73.110378,26.4756517],[73.11056,26.4759775],[73.1107758,26.4762772],[73.1110001,26.4765252],[73.1111476,26.4766884],[73.1113094,26.4768672],[73.1113913,26.4769578]],
  '1412399750': [[73.1123273,26.4779731],[73.1124156,26.4779137],[73.1120658,26.477542],[73.1116396,26.477188],[73.1115727,26.4772691],[73.1119737,26.477645],[73.1123273,26.4779731]],
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
  return _moduleMidpointsFromMetric(samples, cx, cy, mLng, mLat, moduleW);
}

// Step gates along a hand-tuned centerline (lng/lat polyline). Used for ribbons
// that have a BERM_CL_OVERRIDE so the snap targets match the rendered 3D mesh.
function pathGateCenters(path, moduleW = 7.5) {
  let cx = 0, cy = 0;
  path.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= path.length; cy /= path.length;
  const mLng = 111320 * Math.cos(cy * Math.PI/180), mLat = 111320;
  const samples = path.map(p => [(p[0]-cx)*mLng, (p[1]-cy)*mLat]);
  return _moduleMidpointsFromMetric(samples, cx, cy, mLng, mLat, moduleW);
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
  return gates;
}

function snapPerimeterCodes(places) {
  // Two-stage gating. A point is treated as "on the berm" only if its nearest
  // gate is ≤ ELIGIBILITY_M (filters out interior labs like E-1..E-8 that sit
  // 60–300 m from any berm). Once eligible, the candidate may spill to gates
  // up to OVERFLOW_M away — needed because OSM puts 8-10 societies at near-
  // identical coords that have to share 7 adjacent arches.
  const ELIGIBILITY_M = 25;
  const OVERFLOW_M    = 120;

  // 1. Collect every sandstone-gate center across all berm ribbons. For
  //    ribbons 746/747 the 3D mesh is built from BERM_CL_OVERRIDE (not the
  //    raw OSM polygon centerline), so step gates along that path instead.
  const gates = [];
  for (const id of Object.keys(BERM_RINGS)) {
    const centers = BERM_CL_OVERRIDE[id]
      ? pathGateCenters(BERM_CL_OVERRIDE[id])
      : ribbonGateCenters(BERM_RINGS[id]);
    for (const [lng, lat] of centers) gates.push({ lng, lat, ribbonId: id, used: false });
  }

  // 2. Candidates = every named point POI. Anything within SNAP_RADIUS_M of a
  //    gate is eligible; the 25 m cap means features genuinely inside the
  //    academic block (E-1..E-8 etc.) and other off-berm landmarks stay put.
  //    Bare codes *and* named clubs/societies are handled the same way so the
  //    "Music Society", "Dance Society", … cluster — which OSM places at
  //    near-identical coords — spreads 1-per-arch across consecutive gates.
  const candidates = places
    .map((place, idx) => ({ place, idx }))
    .filter(({ place }) => (place.properties.name || '').trim()
      && place.geometry.type === 'Point');

  // 3. For each candidate compute distance to its nearest gate. Only
  //    candidates whose nearest gate is ≤ ELIGIBILITY_M qualify as berm POIs.
  //    Build pairs from those candidates to every gate within OVERFLOW_M so
  //    over-clustered ones can spill to neighbouring gates.
  const cosLat = Math.cos(26.473 * Math.PI/180);
  const pairs = [];
  for (const cand of candidates) {
    const [lng, lat] = cand.place.geometry.coordinates;
    const dists = gates.map((g, gi) => {
      const dx = (g.lng - lng) * 111320 * cosLat;
      const dy = (g.lat - lat) * 111320;
      return { gi, d: Math.hypot(dx, dy) };
    });
    const nearest = dists.reduce((a, b) => a.d < b.d ? a : b);
    if (nearest.d > ELIGIBILITY_M) continue;     // off-berm POI, skip
    for (const { gi, d } of dists) {
      if (d <= OVERFLOW_M) pairs.push({ cand, gi, d });
    }
  }

  // 4. Greedy 1:1 assignment by ascending distance — guarantees each W-N or
  //    E-N lands on its own sandstone gate, no two codes on the same arch.
  pairs.sort((a, b) => a.d - b.d);
  const assignedCands = new Set();
  let snapped = 0;
  for (const { cand, gi } of pairs) {
    if (assignedCands.has(cand.idx) || gates[gi].used) continue;
    const g = gates[gi];
    cand.place.geometry.coordinates = [g.lng, g.lat];
    if (cand.place.centroid) cand.place.centroid = { lat: g.lat, lng: g.lng };
    gates[gi].used = true;
    assignedCands.add(cand.idx);
    snapped++;
  }
  console.log(`  Perimeter snap: ${snapped} berm POIs anchored to sandstone gates`);
  return places;
}

// ============================================================
// Main
// ============================================================
function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  IITJ Maps — GIS Data Pipeline v2');
  console.log('═══════════════════════════════════════════\n');

  const osmPath = path.join(__dirname, '..', '..', 'map.osm');
  const kmlPath = path.join(__dirname, '..', '..', 'Copy of Phase 3B.kml');
  const outDir = path.join(__dirname, '..', 'data');

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // 1. Parse OSM
  const osmData = parseOSM(osmPath);
  const { buildings, roads, areas, allPlaces } = extractFeatures(osmData);

  // 2. Parse KML
  const kmlFeatures = parseKML(kmlPath);

  // 3. Curated places (only those NOT already in OSM, with verified coordinates)
  const curatedPlaces = getHardcodedPlaces();

  // 4. Merge & deduplicate places (OSM first, then KML, then curated as fallback)
  const mergedPlaces = deduplicatePlaces([...allPlaces, ...kmlFeatures, ...curatedPlaces]);

  // 4b. Snap perimeter W/E unit codes to their sandstone-gate module centers
  //     so each dot anchors precisely to its respective arched bay on the 3D
  //     berm (instead of drifting based on raw OSM placement).
  snapPerimeterCodes(mergedPlaces);

  // 5. Build road graph and save
  const { graph, nodeCoords } = buildRoadGraph(roads);

  // 6. Write output files
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

  console.log('\n✅ Output files written to:', outDir);
  console.log(`   buildings.geojson : ${buildings.length} features`);
  console.log(`   roads.geojson     : ${roads.length} features`);
  console.log(`   areas.geojson     : ${areas.length} features`);
  console.log(`   places.geojson    : ${mergedPlaces.length} features`);
  console.log(`   search-index.json : ${dedupedIndex.length} entries`);
  console.log(`   road-graph.json   : ${Object.keys(graph).length} graph nodes`);
  console.log(`   categories.json   : ${getCategories().length} categories`);
}

main();
