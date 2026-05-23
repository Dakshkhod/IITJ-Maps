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
  }

  // Point POIs (named nodes)
  for (const [id, node] of Object.entries(nodes)) {
    if (!node.tags.name) continue;
    allPlaces.push({
      type: 'Feature',
      properties: {
        osm_id: id,
        name: node.tags.name,
        category: classifyAmenity(node.tags),
        source: 'osm',
        ...extractUsefulTags(node.tags)
      },
      geometry: { type: 'Point', coordinates: [node.lon, node.lat] },
      centroid: { lat: node.lat, lng: node.lon }
    });
  }

  console.log(`  Extracted: ${buildings.length} buildings, ${roads.length} roads, ${areas.length} areas, ${allPlaces.length} named places`);
  return { buildings, roads, areas, allPlaces };
}

function classifyBuilding(tags) {
  if (tags.amenity === 'university' || tags.building === 'university' || tags.building === 'college') return 'academic';
  if (tags.building === 'dormitory' || tags.tourism === 'hostel' || tags.building === 'hostel') return 'hostel';
  if (tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'food_court') return 'dining';
  if (tags.amenity === 'hospital' || tags.amenity === 'clinic' || tags.amenity === 'pharmacy') return 'medical';
  if (tags.amenity === 'parking' || tags.building === 'parking') return 'parking';
  if (tags.leisure === 'sports_centre' || tags.leisure === 'stadium') return 'sports';
  if (tags.building === 'temple' || tags.amenity === 'place_of_worship') return 'place_of_worship';
  if (tags.building === 'commercial' || tags.shop) return 'dining';
  if (tags.amenity === 'library') return 'academic';
  if (tags.building === 'office' || tags.office) return 'administrative';
  if (tags.building === 'security_booth') return 'gate';
  if (tags.building === 'bungalow' || tags.building === 'apartments') return 'residential';
  return 'building';
}

function classifyAmenity(tags) {
  if (tags.amenity === 'university' || tags.amenity === 'college' || tags.amenity === 'library') return 'academic';
  if (tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'fast_food') return 'dining';
  if (tags.amenity === 'hospital' || tags.amenity === 'clinic') return 'medical';
  if (tags.amenity === 'parking') return 'parking';
  if (tags.amenity === 'bank' || tags.amenity === 'atm') return 'bank';
  if (tags.amenity === 'place_of_worship') return 'place_of_worship';
  if (tags.leisure === 'sports_centre' || tags.sport || tags.leisure === 'stadium' || tags.leisure === 'swimming_pool') return 'sports';
  if (tags.leisure === 'garden' || tags.leisure === 'park') return 'recreation';
  if (tags.tourism === 'hostel' || tags.tourism === 'hotel') return 'hostel';
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
  const keepKeys = ['opening_hours', 'phone', 'website', 'wheelchair', 'operator', 'addr:street', 'levels', 'height', 'description'];
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
    { name: "Primary Health Centre (PHC)", category: "medical", lat: 26.4822, lng: 73.1195, keywords: ["medical", "hospital", "doctor", "ambulance", "emergency", "phc", "health"], description: "24x7 medical facility and emergency services" },
    { name: "ATM (SBI)", category: "bank", lat: 26.4718, lng: 73.1133, keywords: ["atm", "cash", "money", "bank", "withdraw", "sbi"], description: "SBI ATM near academic area" },
    { name: "Post Office", category: "utility", lat: 26.4716, lng: 73.1131, keywords: ["post", "mail", "courier", "letter"], description: "Campus post office" },
    { name: "Bus Stop (Main Gate)", category: "transport", lat: 26.4591, lng: 73.1106, keywords: ["bus", "stop", "transport", "bus stop"], description: "Main campus bus stop near Gate 1" },
    { name: "Amphitheatre", category: "recreation", lat: 26.4762, lng: 73.1152, keywords: ["amphitheatre", "stage", "performance", "cultural"], description: "Open-air amphitheatre for cultural events" },
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
  return [
    { id: 'academic', name: 'Academic', icon: '🏛️', color: '#4A90D9' },
    { id: 'hostel', name: 'Hostels', icon: '🏠', color: '#E67E22' },
    { id: 'dining', name: 'Food & Dining', icon: '🍽️', color: '#E74C3C' },
    { id: 'sports', name: 'Sports', icon: '⚽', color: '#2ECC71' },
    { id: 'medical', name: 'Medical', icon: '🏥', color: '#E74C3C' },
    { id: 'gate', name: 'Gates', icon: '🚪', color: '#8E44AD' },
    { id: 'parking', name: 'Parking', icon: '🅿️', color: '#3498DB' },
    { id: 'utility', name: 'Utilities', icon: '🔧', color: '#95A5A6' },
    { id: 'administrative', name: 'Admin', icon: '🏢', color: '#34495E' },
    { id: 'transport', name: 'Transport', icon: '🚌', color: '#1ABC9C' },
    { id: 'recreation', name: 'Recreation', icon: '🎭', color: '#9B59B6' },
    { id: 'residential', name: 'Residential', icon: '🏘️', color: '#D35400' },
    { id: 'bank', name: 'Bank / ATM', icon: '🏦', color: '#059669' },
    { id: 'building', name: 'Buildings', icon: '🏗️', color: '#7F8C8D' },
    { id: 'other', name: 'Other', icon: '📍', color: '#BDC3C7' }
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
function deduplicatePlaces(places) {
  const result = [];
  const seen = new Set();

  for (const place of places) {
    const name = (place.properties.name || '').toLowerCase().trim();
    if (!name || name === 'unknown' || name === 'unnamed') continue;

    const lat = place.centroid?.lat ||
      (place.geometry.type === 'Point' ? place.geometry.coordinates[1] : 0);
    const lng = place.centroid?.lng ||
      (place.geometry.type === 'Point' ? place.geometry.coordinates[0] : 0);

    // Round to ~100m grid for dedup
    const key = `${name}_${Math.round(lat * 1000)}_${Math.round(lng * 1000)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(place);
    }
  }

  return result;
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
