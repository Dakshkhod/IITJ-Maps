/**
 * IITJ Maps — Main Application v3
 * 3D buildings (fill-extrusion) + road-network routing + GPS
 * No HTML markers — all places rendered as MapLibre circle+label layers
 */

// Legacy API base kept for reference — all calls replaced with local modules (IITJData, IITJRouter)
const CAMPUS_CENTER = [73.1147, 26.4727];
const CAMPUS_ZOOM = 15.5;
const CAMPUS_BOUNDS = [[73.0900, 26.4450], [73.1350, 26.4950]];

// Category display config (for UI only — not used in map expressions)
const CATEGORY_STYLES = {
  academic:       { abbr: 'AC', label: 'Academic' },
  hostel:         { abbr: 'HO', label: 'Hostel' },
  dining:         { abbr: 'FD', label: 'Dining' },
  sports:         { abbr: 'SP', label: 'Sports' },
  medical:        { abbr: 'MD', label: 'Medical' },
  gate:           { abbr: 'GT', label: 'Gate' },
  parking:        { abbr: 'PK', label: 'Parking' },
  utility:        { abbr: 'UT', label: 'Utility' },
  administrative: { abbr: 'AD', label: 'Admin' },
  transport:      { abbr: 'TR', label: 'Transport' },
  recreation:     { abbr: 'RC', label: 'Recreation' },
  residential:    { abbr: 'RS', label: 'Residential' },
  bank:           { abbr: 'BK', label: 'Bank/ATM' },
  building:       { abbr: 'BL', label: 'Building' },
  university:     { abbr: 'UN', label: 'University' },
  poi:            { abbr: 'PO', label: 'POI' },
  other:          { abbr: 'OT', label: 'Other' },
};

function categoryAbbr(category) {
  return (CATEGORY_STYLES[category] || CATEGORY_STYLES.other).abbr;
}

// MapLibre match expression for category → color (used in map layers)
function categoryColorExpr() {
  return ['match', ['get', 'category'],
    'academic',       '#2563eb',
    'hostel',         '#ea580c',
    'dining',         '#dc2626',
    'sports',         '#16a34a',
    'medical',        '#be123c',
    'gate',           '#7c3aed',
    'parking',        '#0284c7',
    'utility',        '#64748b',
    'administrative', '#334155',
    'transport',      '#0d9488',
    'recreation',     '#9333ea',
    'residential',    '#b45309',
    'bank',           '#059669',
    'university',     '#2563eb',
    '#6b7280'
  ];
}

// 3D extrusion height by category (metres)
function buildingHeightExpr() {
  return [
    'case',
    // If OSM levels data exists, use it (3.2m per floor)
    ['all', ['has', 'levels'], ['!=', ['get', 'levels'], null]],
    ['*', ['to-number', ['get', 'levels'], 3], 3.2],
    // Otherwise fall back to category defaults
    ['match', ['get', 'category'],
      'academic',       15,
      'hostel',         18,
      'administrative', 12,
      'dining',          8,
      'sports',          7,
      'medical',        10,
      'residential',    14,
      'university',     15,
      9  // default
    ]
  ];
}

function labelPaint() {
  const onSatellite = isSatellite;
  return {
    'text-color': onSatellite ? '#ffffff' : (isDark ? '#e2e8f0' : '#374151'),
    'text-halo-color': onSatellite ? 'rgba(0,0,0,0.85)' : (isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.9)'),
    'text-halo-width': onSatellite ? 2 : 1.5
  };
}

function buildLabeledNames(areasRes, buildingsRes) {
  const names = new Set([
    ...areasRes.features.map(f => (f.properties.name || '').toLowerCase().trim()),
    ...buildingsRes.features
      .filter(f => f.geometry.type === 'Polygon' && f.properties.name)
      .map(f => f.properties.name.toLowerCase().trim()),
  ].filter(Boolean));
  if (typeof Landmarks3D !== 'undefined' && Landmarks3D.landmarkLabelNames) {
    for (const n of Landmarks3D.landmarkLabelNames()) names.add(n);
  }
  return names;
}

function syncLandmarkLabels() {
  if (!map || typeof Landmarks3D === 'undefined') return;
  Landmarks3D.init(map);
  Landmarks3D.syncLabels({
    satellite: isSatellite,
    dark: isDark,
    is3D,
    visible: LAYERS.buildings,
  });
}

/** Retry until the deferred landmarks script has loaded. */
function ensureLandmarkLabelsLayer(attempts = 0) {
  if (!map) return;
  if (typeof Landmarks3D === 'undefined') {
    if (attempts < 120) setTimeout(() => ensureLandmarkLabelsLayer(attempts + 1), 50);
    return;
  }
  syncLandmarkLabels();
}

function buildingFillOpacity() {
  if (isSatellite) return 0;
  return ['interpolate', ['linear'], ['zoom'], 14, 0.5, 17, 0.65];
}

function buildingFillColor() {
  return isDark ? '#475569' : '#f1f5f9';
}

function areaFillOpacity() {
  return isSatellite ? 0 : 0.35;
}

function buildingOutlineOpacity() {
  return isSatellite ? 0 : 0.95;
}

function areaOutlineOpacity() {
  return isSatellite ? 0 : 0.5;
}

function markerCircleOpacity() {
  return isSatellite ? 0 : 0.95;
}

function formatHighwayType(type) {
  const labels = {
    footway: 'Footpath', path: 'Walking Path', steps: 'Steps', cycleway: 'Cycle Path',
    service: 'Service Road', residential: 'Campus Road', unclassified: 'Campus Road',
    tertiary: 'Main Road', secondary: 'Main Road', primary: 'Main Road',
    track: 'Track', living_street: 'Living Street',
  };
  return labels[type] || (type ? type.replace(/_/g, ' ') : 'Path');
}

// Shared map interaction handlers (re-bound after each style reload)
function tryDirectionsMapPick(e, name) {
  if (!directionsPickTarget) return false;
  _layerClickHandled = true;
  const lat = typeof e.lngLat.lat === 'number' ? e.lngLat.lat : e.lngLat.getLat();
  const lng = typeof e.lngLat.lng === 'number' ? e.lngLat.lng : e.lngLat.getLng();
  setDirectionsPoint(directionsPickTarget, {
    lat, lng,
    name: name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
  });
  clearDirectionsPickMode();
  return true;
}

function shouldSuppressMapUI() {
  return directionsOpen && !directionsPickTarget;
}

const mapHandlers = {
  onBuildingClick(e) {
    _layerClickHandled = true;
    if (!e.features?.length) return;
    const p = e.features[0].properties;
    if (tryDirectionsMapPick(e, p.name)) return;
    if (shouldSuppressMapUI()) return;
    showCoordPin(e.lngLat, {
      name: p.name,
      category: p.category || 'building',
      description: p.description || p.amenity || p.building_type || '',
    });
  },
  onRoadClick(e) {
    _layerClickHandled = true;
    if (!e.features?.length) return;
    if (tryDirectionsMapPick(e)) return;
    if (shouldSuppressMapUI()) return;
    // Roads are background — first tap closes any open sheet
    if (selectedPlace) { closePlaceSheet(); return; }
    const p = e.features[0].properties;
    const hasName = p.name && p.name !== p.highway_type;
    showCoordPin(e.lngLat, {
      name: hasName ? p.name : formatHighwayType(p.highway_type),
      category: 'transport',
      description: [
        formatHighwayType(p.highway_type),
        p.surface ? `Surface: ${p.surface}` : '',
        p.lit === 'yes' ? 'Lit at night' : '',
      ].filter(Boolean).join(' · '),
    });
  },
  onAreaClick(e) {
    _layerClickHandled = true;
    if (!e.features?.length) return;
    const p = e.features[0].properties;
    if (tryDirectionsMapPick(e, p.name)) return;
    if (shouldSuppressMapUI()) return;
    // Areas cover the whole campus — first tap anywhere closes any open sheet
    if (selectedPlace) { closePlaceSheet(); return; }
    showCoordPin(e.lngLat, {
      name: p.name,
      category: p.category || 'recreation',
      description: p.area_type ? p.area_type.replace(/_/g, ' ') : 'Campus area',
    });
  },
  onPlaceClick(e) {
    _layerClickHandled = true;
    if (!e.features?.length) return;
    const p = e.features[0].properties;
    const c = e.features[0].geometry.coordinates;
    if (tryDirectionsMapPick({ lngLat: { lat: c[1], lng: c[0] } }, p.name)) return;
    if (shouldSuppressMapUI()) return;
    showCoordPin({ lat: c[1], lng: c[0] }, {
      name: p.name,
      category: p.category,
      description: p.description,
      is_proposed: p.is_proposed,
    });
  },
  onPointer() { map.getCanvas().style.cursor = 'pointer'; },
  onPointerLeave() { map.getCanvas().style.cursor = ''; },
};

function bindMapLayer(layerId, events) {
  if (!map.getLayer(layerId)) return;
  for (const [event, fn] of Object.entries(events)) {
    try { map.off(event, layerId, fn); } catch (_) {}
    map.on(event, layerId, fn);
  }
}

function bindMapInteractions() {
  bindMapLayer('buildings-fill', {
    click: mapHandlers.onBuildingClick,
    mouseenter: mapHandlers.onPointer,
    mouseleave: mapHandlers.onPointerLeave,
  });
  bindMapLayer('buildings-3d', {
    click: mapHandlers.onBuildingClick,
    mouseenter: mapHandlers.onPointer,
    mouseleave: mapHandlers.onPointerLeave,
  });
  bindMapLayer('campus-roads-hit', {
    click: mapHandlers.onRoadClick,
    mouseenter: mapHandlers.onPointer,
    mouseleave: mapHandlers.onPointerLeave,
  });
  bindMapLayer('areas-fill', {
    click: mapHandlers.onAreaClick,
    mouseenter: mapHandlers.onPointer,
    mouseleave: mapHandlers.onPointerLeave,
  });
  bindMapLayer('places-circles', {
    click: mapHandlers.onPlaceClick,
    mouseenter: mapHandlers.onPointer,
    mouseleave: mapHandlers.onPointerLeave,
  });
}

function finishMapLayers() {
  bindMapInteractions();
  ensureLandmarkLabelsLayer();
  restoreLocationLayer();
  if (directionsOpen) updateDirectionsMarkers();
}

const LAYERS = { buildings: true, roads: true, markers: true };

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

async function fetchGeoJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`API ${url} returned ${res.status}`);
      return EMPTY_FC;
    }
    return res.json();
  } catch (err) {
    console.warn(`API ${url} failed:`, err);
    return EMPTY_FC;
  }
}
let map, userLocation, selectedPlace, activeCategory;
// Set to true by layer click handlers so the general map.on('click') doesn't double-handle
let _layerClickHandled = false;
let locationMarker = null;
let locationAccuracyMarker = null;   // accuracy circle HTML el
let headingDeg = null;               // device compass bearing
let autoFollow = false;              // map pans to keep user centred
let watchId = null;                  // geolocation watchPosition handle
let isDark = false, is3D = false, isSatellite = false;
let labeledNames = new Set();
let searchTimeout;
let currentRoute = null;
let navDestination = null;           // preserved so re-route works after sheet close
let navigationActive = false;
let navInstructionIndex = 0;

// Directions panel state
let directionsOpen = false;
let directionsPickTarget = null; // 'from' | 'to' | null
let directionsFrom = null;
let directionsTo = null;
let directionsFromMarker = null;
let directionsToMarker = null;
let dirSearchTimeout = null;
let directionsMode = 'drive';  // 'drive' (main roads only) | 'walk' (shortcuts allowed)

// ============================================================
// Initialize
// ============================================================
async function init() {
  map = new maplibregl.Map({
    container: 'map',
    style: getMapStyle(),
    center: CAMPUS_CENTER,
    zoom: CAMPUS_ZOOM,
    maxBounds: CAMPUS_BOUNDS,
    minZoom: 13,
    maxZoom: 19,
    pitch: 0,
    bearing: 0,
    attributionControl: false,
    pitchWithRotate: true,
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 150, unit: 'metric' }), 'bottom-left');

  map.dragRotate.enable();

  // Disable auto-follow when user manually pans
  map.on('dragstart', () => {
    if (autoFollow) {
      setAutoFollow(false);
      document.getElementById('btn-locate').classList.remove('location-follow');
    }
  });

  map.on('error', (e) => console.error('MapLibre error:', e.error?.message || e));

  map.on('load', async () => {
    await loadMapData();
    hideSplash();
    setupEventListeners();
    handleDeepLink();
    requestUserLocation();
  });
}

// ============================================================
// Map Style — streets (light/dark) or satellite imagery
// ============================================================
function getMapStyle() {
  if (isSatellite) {
    return {
      version: 8,
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      sources: {
        'satellite-tiles': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© Esri, Maxar, Earthstar Geographics, GIS User Community'
        }
      },
      layers: [{
        id: 'satellite-tiles',
        type: 'raster',
        source: 'satellite-tiles',
        paint: { 'raster-opacity': 1, 'raster-brightness-min': 0, 'raster-brightness-max': 1 },
      }]
    };
  }

  const tiles = isDark
    ? [
        'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
      ]
    : [
        'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
      ];

  return {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: {
      'carto-tiles': {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution: '© OpenStreetMap contributors © CARTO'
      }
    },
    layers: [{
      id: 'carto-tiles',
      type: 'raster',
      source: 'carto-tiles',
    }]
  };
}

let styleLoadGeneration = 0;

// User-added overlay sources (and the layers that read from them). MapLibre's
// setStyle diff can preserve these across a base-style swap, which causes the
// add* helpers to short-circuit on their `getSource(...)` check and reuse stale
// paint properties baked for the previous isSatellite/isDark state. We wipe
// them before re-adding so the create-fresh path runs every time.
const OVERLAY_LAYER_IDS = [
  'greens-fill',
  'campus-roads-casing', 'campus-roads-line', 'campus-roads-ped',
  'campus-roads-hit', 'campus-roads-labels',
  'areas-fill', 'areas-outline', 'areas-labels',
  'buildings-fill', 'buildings-outline', 'buildings-3d', 'buildings-labels',
  'buildings-highlight-fill', 'buildings-highlight-outline',
  'places-circles', 'places-labels',
];
const OVERLAY_SOURCE_IDS = [
  'campus-greens', 'campus-roads', 'named-areas', 'area-labels-src', 'buildings', 'places-points',
];

function clearOverlayLayers() {
  for (const id of OVERLAY_LAYER_IDS) {
    if (map.getLayer(id)) {
      try { map.removeLayer(id); } catch (_) {}
    }
  }
  for (const id of OVERLAY_SOURCE_IDS) {
    if (map.getSource(id)) {
      try { map.removeSource(id); } catch (_) {}
    }
  }
}

// Reload base map tiles and restore all overlay layers
async function applyMapStyle() {
  const savedCenter  = map.getCenter();
  const savedZoom    = map.getZoom();
  const savedPitch   = map.getPitch();
  const savedBearing = map.getBearing();
  const generation   = ++styleLoadGeneration;

  return new Promise((resolve) => {
    let restored = false;

    const restoreOverlays = async () => {
      if (restored || generation !== styleLoadGeneration) return;
      restored = true;

      try {
        const placesRes    = IITJData.getPlaces(activeCategory || null);
        const buildingsRes = IITJData.getBuildings();
        const roadsRes     = IITJData.getRoads();
        const areasRes     = IITJData.getAreas();

        labeledNames = buildLabeledNames(areasRes, buildingsRes);

        clearOverlayLayers();

        addGreensLayer(IITJData.getGreens());
        addRoadsLayer(roadsRes);
        addAreasLayer(areasRes);
        addBuildingsLayer(buildingsRes);
        addPlacesLayer(placesRes.features || []);
        ensureLandmarkLabelsLayer();
        if (currentRoute) drawRoute(currentRoute.geometry);

        map.jumpTo({ center: savedCenter, zoom: savedZoom, pitch: savedPitch, bearing: savedBearing });

        if (is3D && !isSatellite) {
          if (map.getLayer('buildings-fill'))    map.setLayoutProperty('buildings-fill',    'visibility', 'none');
          if (map.getLayer('buildings-outline')) map.setLayoutProperty('buildings-outline', 'visibility', 'none');
          if (map.getLayer('buildings-3d'))      map.setLayoutProperty('buildings-3d',      'visibility', 'visible');
          showLandmarks3D();
        }

        updateBaseMapButtons();
        finishMapLayers();
        syncLandmarkLabels();
        restoreLocationLayer();
      } catch (err) {
        console.error('Failed to restore map layers after style change:', err);
      } finally {
        resolve();
      }
    };

    const waitForStyle = () => {
      if (generation !== styleLoadGeneration) { resolve(); return; }
      if (map.isStyleLoaded()) {
        restoreOverlays();
      } else {
        // 'idle' requires ALL tiles loaded — can take many seconds or never fire.
        // 'sourcedata' fires quickly once setStyle has applied the new style spec,
        // at which point addSource/addLayer calls succeed without "Style not loaded".
        let _fired = false;
        const doRestore = () => {
          if (_fired) return;
          _fired = true;
          map.off('sourcedata', doRestore);
          if (generation !== styleLoadGeneration) { resolve(); return; }
          restoreOverlays();
        };
        map.once('sourcedata', doRestore);
        setTimeout(doRestore, 2000); // Fallback if sourcedata never fires
      }
    };

    map.setStyle(getMapStyle());
    waitForStyle();
  });
}

function updateBaseMapButtons() {
  document.getElementById('btn-satellite').classList.toggle('active', isSatellite);
  document.getElementById('btn-dark').classList.toggle('active', isDark && !isSatellite);
  document.getElementById('btn-dark').disabled = isSatellite;
  document.getElementById('btn-dark').style.opacity = isSatellite ? '0.45' : '';
}

// ============================================================
// Load Map Data
// ============================================================
async function loadMapData() {
  try {
    // All data loaded locally via IITJData (no backend required)
    await IITJData.init();
    await IITJRouter.init();

    const placesRes    = IITJData.getPlaces();
    const buildingsRes = IITJData.getBuildings();
    const roadsRes     = IITJData.getRoads();
    const areasRes     = IITJData.getAreas();
    const categoriesRes = IITJData.getCategories();

    // Names already labeled on buildings/areas/landmark layers — exclude from point markers
    labeledNames = buildLabeledNames(areasRes, buildingsRes);

    addGreensLayer(IITJData.getGreens());
    addRoadsLayer(roadsRes);
    addAreasLayer(areasRes);
    addBuildingsLayer(buildingsRes);
    addPlacesLayer(placesRes.features || []);
    ensureLandmarkLabelsLayer();
    renderCategoryChips(categoriesRes);
    finishMapLayers();
  } catch (err) {
    console.error('Failed to load map data:', err);
  }
}

// ============================================================
// Remove all custom layers (used on style/dark-mode reload)
// ============================================================
function removeCustomLayers() {
  const layers = [
    'areas-fill', 'areas-outline', 'areas-labels',
    'campus-roads-casing', 'campus-roads-line', 'campus-roads-ped', 'campus-roads-hit', 'campus-roads-labels',
    'buildings-fill', 'buildings-outline', 'buildings-3d', 'buildings-labels',
    'landmark-labels',
    'places-circles', 'places-labels',
    'route-glow', 'route-casing', 'route-line',
    ...((typeof Landmarks3D !== 'undefined' && Landmarks3D.listIds) ? Landmarks3D.listIds() : ['brain-tree-3d']),
  ];
  const sources = ['named-areas', 'area-labels-src', 'campus-roads', 'buildings', 'landmark-labels-src', 'places-points', 'route'];
  layers.forEach(id => { try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {} });
  sources.forEach(id => { try { if (map.getSource(id)) map.removeSource(id); } catch (_) {} });
}

// ============================================================
// Named Areas Layer (grounds, gardens, pitches — label only, no heavy fill)
// ============================================================
function dedupeAreaLabels(features) {
  const groups = new Map();
  for (const f of features) {
    if (!f.centroid || !f.properties.name) continue;
    const key = f.properties.name.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, { name: f.properties.name, category: f.properties.category, lats: [], lngs: [] });
    const g = groups.get(key);
    g.lats.push(f.centroid.lat);
    g.lngs.push(f.centroid.lng);
  }
  return [...groups.values()].map(g => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [g.lngs.reduce((a, b) => a + b, 0) / g.lngs.length, g.lats.reduce((a, b) => a + b, 0) / g.lats.length]
    },
    properties: { name: g.name, category: g.category }
  }));
}

// Flat green ground patches from OSM grass / park / pitch / forest polygons
// (the same source F4Map paints green). Rendered at the very bottom of the
// overlay stack so roads, areas and buildings sit on top. Hidden on
// satellite (the imagery already shows real grass).
function addGreensLayer(data) {
  if (map.getSource('campus-greens')) {
    map.getSource('campus-greens').setData(data);
    return;
  }
  map.addSource('campus-greens', { type: 'geojson', data });
  map.addLayer({
    id: 'greens-fill',
    type: 'fill',
    source: 'campus-greens',
    layout: { visibility: isSatellite ? 'none' : 'visible' },
    paint: {
      'fill-color': [
        'match', ['get', 'g'],
        'forest', isDark ? '#36502f' : '#a9c78f',
        'scrub',  isDark ? '#33502f' : '#bcd49a',
        'pitch',  isDark ? '#2f4a36' : '#bcd996',
        /* grass */ isDark ? '#2f4632' : '#c8e0a6'
      ],
      'fill-opacity': isSatellite ? 0 : (isDark ? 0.5 : 0.9),
      'fill-antialias': true
    }
  });
}

function addAreasLayer(data) {
  const labelFeatures = dedupeAreaLabels(data.features);
  const labelData = { type: 'FeatureCollection', features: labelFeatures };

  if (map.getSource('named-areas')) {
    map.getSource('named-areas').setData(data);
    if (map.getSource('area-labels-src')) map.getSource('area-labels-src').setData(labelData);
    return;
  }

  map.addSource('named-areas', { type: 'geojson', data });

  // Transparent on satellite; tinted on normal map
  map.addLayer({
    id: 'areas-fill',
    type: 'fill',
    source: 'named-areas',
    layout: { visibility: 'visible' },
    paint: {
      'fill-color': [
        'match', ['get', 'category'],
        'sports',     '#bbf7d0',
        'recreation', '#d1fae5',
        'residential','#fef3c7',
        'academic',   '#dbeafe',
        '#e5e7eb'
      ],
      'fill-opacity': areaFillOpacity()
    }
  });

  map.addLayer({
    id: 'areas-outline',
    type: 'line',
    source: 'named-areas',
    layout: { visibility: 'visible' },
    paint: {
      'line-color': [
        'match', ['get', 'category'],
        'sports',     '#16a34a',
        'recreation', '#059669',
        'residential','#d97706',
        'academic',   '#2563eb',
        '#6b7280'
      ],
      'line-width': 1,
      'line-opacity': areaOutlineOpacity(),
      'line-dasharray': [3, 2]
    }
  });

  // One label per unique area name (deduped centroids)
  map.addSource('area-labels-src', { type: 'geojson', data: labelData });

  map.addLayer({
    id: 'areas-labels',
    type: 'symbol',
    source: 'area-labels-src',
    minzoom: 15,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 13],
      'text-font': ['Open Sans Regular'],
      'text-anchor': 'center',
      'text-max-width': 10,
      'text-allow-overlap': false,
      'text-optional': true,
      'text-padding': 6,
      visibility: 'visible'
    },
    paint: labelPaint()
  });
}

// ============================================================
// Roads Layer — styled for map & satellite, clickable, labeled
// ============================================================
function addRoadsLayer(data) {
  const roadVis = LAYERS.roads ? 'visible' : 'none';
  const pedFilter = ['any',
    ['==', ['get', 'highway_type'], 'footway'],
    ['==', ['get', 'highway_type'], 'path'],
    ['==', ['get', 'highway_type'], 'steps'],
  ];
  const vehFilter = ['!', ['any',
    ['==', ['get', 'highway_type'], 'footway'],
    ['==', ['get', 'highway_type'], 'path'],
    ['==', ['get', 'highway_type'], 'steps'],
  ]];

  if (map.getSource('campus-roads')) {
    map.getSource('campus-roads').setData(data);
    return;
  }

  map.addSource('campus-roads', { type: 'geojson', data });

  // Type-aware vehicle-road widths (metres-ish, scaled by zoom) so the wide
  // entrance avenue / ring road read correctly against the narrow service
  // lanes, matching the satellite. The casing is a few px wider than the
  // surface to form a curb edge.
  // Wide, type-aware road widths so the carriageways read like F4Map's broad
  // asphalt ribbons. The casing is a few px wider than the surface to form a
  // crisp dark kerb edge.
  const surfaceW = ['interpolate', ['linear'], ['zoom'],
    13, ['match', ['get', 'highway_type'], 'trunk', 4.4, 'trunk_link', 3.0, 'primary', 4.2, 'unclassified', 3.6, 'residential', 2.8, 2.6],
    16, ['match', ['get', 'highway_type'], 'trunk', 9.5, 'trunk_link', 6.5, 'primary', 9.0, 'unclassified', 7.6, 'residential', 5.6, 5.2],
    19, ['match', ['get', 'highway_type'], 'trunk', 17,  'trunk_link', 11,  'primary', 16,  'unclassified', 13.5,'residential', 10,  9.0],
  ];
  const casingW = ['interpolate', ['linear'], ['zoom'],
    13, ['match', ['get', 'highway_type'], 'trunk', 6.0, 'trunk_link', 4.4, 'primary', 5.8, 'unclassified', 5.2, 'residential', 4.2, 4.0],
    16, ['match', ['get', 'highway_type'], 'trunk', 12.5,'trunk_link', 9.0, 'primary', 12,  'unclassified', 10.4,'residential', 8.0, 7.6],
    19, ['match', ['get', 'highway_type'], 'trunk', 22,  'trunk_link', 15,  'primary', 21,  'unclassified', 18,  'residential', 13.5,12.5],
  ];

  map.addLayer({
    id: 'campus-roads-casing',
    type: 'line',
    source: 'campus-roads',
    layout: {
      'line-join': 'round', 'line-cap': 'round',
      visibility: roadVis
    },
    paint: isSatellite ? {
      'line-color': '#ffffff',
      'line-width': 0,
      'line-opacity': 0
    } : {
      // Dark kerb edge that frames every road, like F4Map's road outline.
      'line-color': isDark ? '#0b1220' : '#5f6368',
      'line-width': casingW,
      'line-opacity': 1
    }
  });

  map.addLayer({
    id: 'campus-roads-line',
    type: 'line',
    source: 'campus-roads',
    filter: vehFilter,
    layout: {
      'line-join': 'round', 'line-cap': 'round',
      visibility: roadVis
    },
    paint: isSatellite ? {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.2, 16, 3, 19, 5],
      'line-opacity': 0.92
    } : {
      // Medium asphalt-grey carriageway, like F4Map — clearly darker than the
      // ground, with main roads a touch darker than the minor service lanes.
      'line-color': isDark
        ? ['match', ['get', 'highway_type'], 'service', '#3b475b', 'residential', '#374254', '#3f4c61']
        : ['match', ['get', 'highway_type'], 'service', '#9ca1a6', 'residential', '#989da2', '#8d9298'],
      'line-width': surfaceW,
      'line-opacity': 1
    }
  });

  map.addLayer({
    id: 'campus-roads-ped',
    type: 'line',
    source: 'campus-roads',
    filter: pedFilter,
    layout: {
      'line-join': 'round', 'line-cap': 'round',
      visibility: roadVis
    },
    paint: isSatellite ? {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 16, 2, 19, 3],
      'line-opacity': 0.75,
      'line-dasharray': [2, 1.5]
    } : {
      'line-color': isDark ? '#94a3b8' : '#64748b',
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 16, 2.5, 19, 4],
      'line-opacity': 0.85,
      'line-dasharray': [2, 1.5]
    }
  });

  map.addLayer({
    id: 'campus-roads-hit',
    type: 'line',
    source: 'campus-roads',
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: roadVis },
    paint: {
      'line-color': '#000000',
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 8, 16, 14, 19, 18],
      'line-opacity': 0
    }
  });

  map.addLayer({
    id: 'campus-roads-labels',
    type: 'symbol',
    source: 'campus-roads',
    minzoom: 16,
    filter: ['all',
      ['has', 'name'],
      ['!=', ['get', 'name'], ''],
      ['!=', ['get', 'name'], ['get', 'highway_type']]
    ],
    layout: {
      'symbol-placement': 'line',
      'text-field': ['get', 'name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 18, 12],
      'text-font': ['Open Sans Regular'],
      'text-max-angle': 30,
      'text-allow-overlap': false,
      'text-optional': true,
      'text-padding': 4,
      visibility: roadVis
    },
    paint: labelPaint()
  });
}

// ============================================================
// Buildings Layer: 2D fill + 3D extrusion + labels
// ============================================================
function addBuildingsLayer(data) {
  if (map.getSource('buildings')) {
    map.getSource('buildings').setData(data);
    return;
  }

  map.addSource('buildings', { type: 'geojson', data });

  const colorExpr = categoryColorExpr();
  const polyFilter = ['==', ['geometry-type'], 'Polygon'];

  // Light uniform fill; category colour on boundary only
  map.addLayer({
    id: 'buildings-fill',
    type: 'fill',
    source: 'buildings',
    filter: polyFilter,
    layout: { visibility: (LAYERS.buildings && !is3D) ? 'visible' : 'none' },
    paint: {
      'fill-color': buildingFillColor(),
      'fill-opacity': buildingFillOpacity()
    }
  });

  map.addLayer({
    id: 'buildings-outline',
    type: 'line',
    source: 'buildings',
    filter: polyFilter,
    layout: { visibility: (LAYERS.buildings && !is3D) ? 'visible' : 'none' },
    paint: {
      'line-color': colorExpr,
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.5, 17, 3],
      'line-opacity': buildingOutlineOpacity()
    }
  });

  // Buildings replaced by a detailed 3D model (Library etc.) — hide their
  // plain extrusion so the GLB sits cleanly on the ground instead of poking
  // through a featureless white box.
  const replacedIds = (typeof Landmarks3D !== 'undefined' && Landmarks3D.replacedBuildingIds)
    ? Landmarks3D.replacedBuildingIds() : [];
  const extrusionFilter = replacedIds.length
    ? ['all', polyFilter, ['!', ['in', ['get', 'osm_id'], ['literal', replacedIds]]]]
    : polyFilter;

  map.addLayer({
    id: 'buildings-3d',
    type: 'fill-extrusion',
    source: 'buildings',
    filter: extrusionFilter,
    layout: { visibility: (LAYERS.buildings && is3D && !isSatellite) ? 'visible' : 'none' },
    paint: {
      'fill-extrusion-color': buildingFillColor(),
      'fill-extrusion-height': buildingHeightExpr(),
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.82,
      'fill-extrusion-vertical-gradient': true
    }
  });

  // Name labels at high zoom — hide labels for buildings replaced by a 3D
  // landmark so the text doesn't float underneath the model.
  const labelsFilter = replacedIds.length
    ? ['all', polyFilter, ['!=', ['get', 'name'], ''], ['!', ['in', ['get', 'osm_id'], ['literal', replacedIds]]]]
    : ['all', polyFilter, ['!=', ['get', 'name'], '']];
  map.addLayer({
    id: 'buildings-labels',
    type: 'symbol',
    source: 'buildings',
    filter: labelsFilter,
    minzoom: 17,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 17, 10, 19, 13],
      'text-font': ['Open Sans Regular'],
      'text-anchor': 'center',
      'text-max-width': 8,
      'text-optional': true,
      'text-padding': 6,
      visibility: LAYERS.buildings ? 'visible' : 'none'
    },
    paint: labelPaint()
  });

  // Highlight fill — glowing colour for the active category (hidden by default)
  const NEVER = ['==', ['literal', 1], 0]; // filter that never matches
  map.addLayer({
    id: 'buildings-highlight-fill',
    type: 'fill',
    source: 'buildings',
    filter: NEVER,
    layout: { visibility: 'visible' },
    paint: {
      'fill-color': categoryHighlightColorExpr(),
      'fill-opacity': 0.55,
    }
  });

  // Highlight outline — thick bright border (above fill)
  map.addLayer({
    id: 'buildings-highlight-outline',
    type: 'line',
    source: 'buildings',
    filter: NEVER,
    layout: { visibility: 'visible' },
    paint: {
      'line-color': categoryHighlightColorExpr(),
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 17, 4.5, 19, 6],
      'line-opacity': 1.0,
      'line-blur': 1.5,
    }
  });
}

// Returns a MapLibre match expression: category → bright highlight colour
function categoryHighlightColorExpr() {
  return ['match', ['get', 'category'],
    'academic',       '#3b82f6',   // blue
    'hostel',         '#f97316',   // orange
    'dining',         '#ef4444',   // red
    'sports',         '#22c55e',   // green
    'medical',        '#ec4899',   // pink
    'administrative', '#8b5cf6',   // purple
    'residential',    '#eab308',   // yellow
    '#6366f1'                      // fallback indigo
  ];
}

// ─── Category highlight / pulse ───────────────────────────────────────────────
let _pulseTimer = null;
let _pulseHigh = true;

function startBuildingHighlight(categoryId) {
  stopBuildingHighlight();
  if (!categoryId) return;

  const polyFilter = ['all',
    ['==', ['geometry-type'], 'Polygon'],
    ['==', ['get', 'category'], categoryId]
  ];

  if (map.getLayer('buildings-highlight-fill')) {
    map.setFilter('buildings-highlight-fill',    polyFilter);
    map.setFilter('buildings-highlight-outline', polyFilter);
  }

  // Pulsing opacity animation
  _pulseHigh = true;
  _pulseTimer = setInterval(() => {
    _pulseHigh = !_pulseHigh;
    if (!map.getLayer('buildings-highlight-fill')) return;
    map.setPaintProperty('buildings-highlight-fill',    'fill-opacity',  _pulseHigh ? 0.55 : 0.18);
    map.setPaintProperty('buildings-highlight-outline', 'line-opacity',  _pulseHigh ? 1.0  : 0.35);
    map.setPaintProperty('buildings-highlight-outline', 'line-width',
      ['interpolate', ['linear'], ['zoom'], 14, _pulseHigh ? 2 : 1, 17, _pulseHigh ? 4.5 : 2.5]);
  }, 700);
}

function stopBuildingHighlight() {
  if (_pulseTimer) { clearInterval(_pulseTimer); _pulseTimer = null; }
  const NEVER = ['==', ['literal', 1], 0];
  if (map.getLayer('buildings-highlight-fill')) {
    map.setFilter('buildings-highlight-fill',    NEVER);
    map.setFilter('buildings-highlight-outline', NEVER);
    map.setPaintProperty('buildings-highlight-fill',    'fill-opacity',  0.55);
    map.setPaintProperty('buildings-highlight-outline', 'line-opacity',  1.0);
  }
}

// ============================================================
// Places Layer — MapLibre circles + text labels (no HTML markers)
// ============================================================
function addPlacesLayer(features) {
  // Point POIs only — skip anything already labeled on buildings/areas layers
  const pointFeatures = features.map(f => {
    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') return null;

    const name = (f.properties.name || '').trim();
    if (!name) return null;
    if (labeledNames.has(name.toLowerCase())) return null;

    let coords;
    if (f.geometry.type === 'Point') {
      coords = f.geometry.coordinates;
    } else if (f.centroid) {
      coords = [f.centroid.lng, f.centroid.lat];
    } else return null;

    if (!coords || isNaN(coords[0]) || isNaN(coords[1])) return null;

    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: {
        name,
        category:    f.properties.category || 'other',
        description: f.properties.description || '',
        source:      f.properties.source || 'osm',
        is_proposed: f.properties.is_proposed || false,
      }
    };
  }).filter(Boolean);

  const data = { type: 'FeatureCollection', features: pointFeatures };

  // Update existing source if present
  if (map.getSource('places-points')) {
    map.getSource('places-points').setData(data);
    return;
  }

  map.addSource('places-points', { type: 'geojson', data });

  const colorExpr = categoryColorExpr();

  map.addLayer({
    id: 'places-circles',
    type: 'circle',
    source: 'places-points',
    layout: { visibility: LAYERS.markers ? 'visible' : 'none' },
    paint: {
      'circle-color': colorExpr,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4, 16, 7, 19, 10],
      'circle-stroke-width': isSatellite ? 0 : ['interpolate', ['linear'], ['zoom'], 13, 1.5, 17, 2.5],
      'circle-stroke-color': '#ffffff',
      'circle-opacity': markerCircleOpacity(),
    }
  });

  // Text labels (shown at zoom 16+, with collision avoidance)
  map.addLayer({
    id: 'places-labels',
    type: 'symbol',
    source: 'places-points',
    minzoom: 16,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 18, 13],
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-max-width': 9,
      'text-font': ['Open Sans Regular'],
      'text-allow-overlap': false,
      'text-optional': true,
      'text-padding': 4,
      visibility: LAYERS.markers ? 'visible' : 'none'
    },
    paint: labelPaint()
  });
}

// ============================================================
// 3D Toggle
// ============================================================
function toggle3D() {
  is3D = !is3D;
  document.getElementById('btn-3d').classList.toggle('active', is3D);

  if (is3D) {
    if (!isSatellite && LAYERS.buildings) {
      if (map.getLayer('buildings-fill'))    map.setLayoutProperty('buildings-fill',    'visibility', 'none');
      if (map.getLayer('buildings-outline')) map.setLayoutProperty('buildings-outline', 'visibility', 'none');
      if (map.getLayer('buildings-3d'))      map.setLayoutProperty('buildings-3d',      'visibility', 'visible');
    }
    // Custom 3D landmark models are only shown on the vector base map, not
    // over satellite imagery (matches buildings-3d behaviour).
    if (!isSatellite) showLandmarks3D();
    else if (typeof Landmarks3D !== 'undefined') Landmarks3D.hide();
    syncLandmarkLabels();
    map.easeTo({ pitch: 52, bearing: 0, duration: 900 });
    showToast('3D view — drag to rotate', 'info');
  } else {
    if (map.getLayer('buildings-3d')) map.setLayoutProperty('buildings-3d', 'visibility', 'none');
    if (typeof Landmarks3D !== 'undefined') Landmarks3D.hide();
    if (!isSatellite && LAYERS.buildings) {
      if (map.getLayer('buildings-fill'))    map.setLayoutProperty('buildings-fill',    'visibility', 'visible');
      if (map.getLayer('buildings-outline')) map.setLayoutProperty('buildings-outline', 'visibility', 'visible');
    }
    syncLandmarkLabels();
    map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
  }
}

// Lazy-init 3D landmark layers (waits for three.js + loaders to be ready)
function showLandmarks3D(attempts = 0) {
  if (typeof Landmarks3D === 'undefined') return;
  if (typeof THREE === 'undefined' || !THREE.OBJLoader || !THREE.GLTFLoader) {
    if (attempts < 50) setTimeout(() => showLandmarks3D(attempts + 1), 100);
    return;
  }
  Landmarks3D.init(map);
  syncLandmarkLabels();
  Landmarks3D.show();
}

// ============================================================
// Layer Toggle Panel
// ============================================================
function toggleLayer(layerName) {
  LAYERS[layerName] = !LAYERS[layerName];
  const vis = LAYERS[layerName] ? 'visible' : 'none';

  const layerMap = {
    buildings: is3D
      ? ['buildings-3d', 'buildings-labels', 'landmark-labels']
      : ['buildings-fill', 'buildings-outline', 'buildings-labels', 'landmark-labels'],
    roads: ['campus-roads-casing', 'campus-roads-line', 'campus-roads-ped', 'campus-roads-hit', 'campus-roads-labels'],
    markers: ['places-circles', 'places-labels'],
  };

  for (const id of (layerMap[layerName] || [])) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  }
  if (layerName === 'buildings') syncLandmarkLabels();
}

function showLayerPanel() {
  const panel = document.getElementById('layer-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    document.getElementById('layer-toggle-buildings').checked = LAYERS.buildings;
    document.getElementById('layer-toggle-roads').checked     = LAYERS.roads;
    document.getElementById('layer-toggle-markers').checked  = LAYERS.markers;
  }
}

// ============================================================
// Category Filter Chips
// ============================================================
function renderCategoryChips(categoriesData) {
  const container = document.getElementById('category-chips');
  container.appendChild(createChip('All', null, true));
  for (const cat of categoriesData) {
    if (['other', 'building'].includes(cat.id)) continue;
    container.appendChild(createChip(cat.name, cat.id, false));
  }
}

function createChip(name, categoryId, isActive) {
  const chip = document.createElement('div');
  chip.className = `category-chip${isActive ? ' active' : ''}`;
  chip.textContent = name;
  chip.addEventListener('click', () => filterByCategory(categoryId, chip));
  return chip;
}

async function filterByCategory(categoryId, chipEl) {
  document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
  chipEl.classList.add('active');
  activeCategory = categoryId;

  const data = IITJData.getPlaces(categoryId || null);
  addPlacesLayer(data.features);

  // Highlight / pulse matching buildings; clear when "All" selected
  if (categoryId) {
    startBuildingHighlight(categoryId);
  } else {
    stopBuildingHighlight();
  }
}

// ============================================================
// Search
// ============================================================
function setupSearch() {
  const input   = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  const clearBtn = document.getElementById('search-clear');

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.classList.toggle('hidden', !q.length);
    clearTimeout(searchTimeout);
    if (!q) { results.classList.add('hidden'); return; }
    searchTimeout = setTimeout(() => performSearch(q), 250);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) performSearch(input.value.trim());
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    results.classList.add('hidden');
    clearBtn.classList.add('hidden');
    input.focus();
  });

  map.on('click', (e) => {
    results.classList.add('hidden');
    document.getElementById('layer-panel').classList.add('hidden');

    if (directionsPickTarget) {
      _layerClickHandled = false;
      setDirectionsPoint(directionsPickTarget, {
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
        name: `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`,
      });
      clearDirectionsPickMode();
      return;
    }

    // A layer handler (building/place/area/road) already dealt with this click
    if (_layerClickHandled) {
      _layerClickHandled = false;
      return;
    }

    // Genuine empty-space tap
    if (shouldSuppressMapUI()) return;
    if (selectedPlace) { closePlaceSheet(); return; }
    removeCoordPin();
    showCoordPin(e.lngLat);
  });
}

async function performSearch(query) {
  const results = document.getElementById('search-results');
  try {
    const data = IITJData.search(query, 8);

    if (!data.length) {
      results.innerHTML = `<div class="search-empty"><div class="empty-text">No results for "<strong>${escapeHtml(query)}</strong>"</div></div>`;
      results.classList.remove('hidden');
      return;
    }

    results.innerHTML = data.map(item => {
      const style = CATEGORY_STYLES[item.category] || CATEGORY_STYLES.other;
      const dist  = userLocation ? `<span class="result-distance">${formatDist(haversine(userLocation.lat, userLocation.lng, item.lat, item.lng))}</span>` : '';
      const badge = item.is_proposed ? `<span class="proposed-badge">Proposed</span>` : '';
      return `
        <div class="search-result-item"
             data-lat="${item.lat}" data-lng="${item.lng}"
             data-name="${escapeHtml(item.name)}"
             data-category="${item.category}"
             data-desc="${escapeHtml(item.description || '')}">
          <div class="result-icon">${style.abbr}</div>
          <div class="result-info">
            <div class="result-name">${escapeHtml(item.name)}${badge}</div>
            <div class="result-category">${style.label || item.category}</div>
          </div>
          ${dist}
        </div>`;
    }).join('');

    results.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const lat = parseFloat(el.dataset.lat);
        const lng = parseFloat(el.dataset.lng);
        results.classList.add('hidden');
        document.getElementById('search-input').value = el.dataset.name;
        map.flyTo({ center: [lng, lat], zoom: 17, duration: 1000 });
        // Drop pin at the search result's exact location
        showCoordPin({ lat, lng }, { name: el.dataset.name, category: el.dataset.category, description: el.dataset.desc });
      });
    });

    results.classList.remove('hidden');
  } catch (err) {
    console.error('Search error:', err);
  }
}

// ============================================================
// Place Detail Bottom Sheet
// ============================================================
let sheetHistoryActive = false;

function resetSheetTransform() {
  const sheet = document.getElementById('place-sheet');
  sheet.style.transform = '';
  sheet.style.transition = '';
  sheet.classList.remove('sheet-closing');
}

function closePlaceSheetInternal() {
  const sheet = document.getElementById('place-sheet');
  if (sheet.classList.contains('hidden')) return false;
  sheet.classList.add('hidden');
  resetSheetTransform();
  selectedPlace = null;
  removeCoordPin();
  return true;
}

function openPlaceSheetHistory() {
  if (!sheetHistoryActive) {
    history.pushState({ iitjSheet: true }, '');
    sheetHistoryActive = true;
  }
}

function closePlaceSheet() {
  const didClose = closePlaceSheetInternal();
  if (!didClose) return;
  if (sheetHistoryActive) {
    sheetHistoryActive = false;
    history.back();
  }
}

function closePlaceSheetAnimated() {
  const sheet = document.getElementById('place-sheet');
  if (sheet.classList.contains('hidden')) return;
  sheet.classList.add('sheet-closing');
  sheet.style.transition = 'transform 0.22s ease';
  sheet.style.transform = 'translateY(100%)';
  const onEnd = () => {
    sheet.removeEventListener('transitionend', onEnd);
    closePlaceSheet();
  };
  sheet.addEventListener('transitionend', onEnd);
}

function setupSheetGestures() {
  const sheet = document.getElementById('place-sheet');
  let dragStartY = 0;
  let dragCurrentY = 0;
  let dragging = false;

  function canStartDrag(target) {
    return target.closest('.sheet-drag-zone') || target.closest('.sheet-header');
  }

  sheet.addEventListener('touchstart', (e) => {
    if (sheet.classList.contains('hidden')) return;
    if (!canStartDrag(e.target)) return;
    dragStartY = e.touches[0].clientY;
    dragCurrentY = 0;
    dragging = true;
    sheet.style.transition = 'none';
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const delta = e.touches[0].clientY - dragStartY;
    if (delta < 0) return;
    dragCurrentY = delta;
    sheet.style.transform = `translateY(${delta}px)`;
  }, { passive: true });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    const threshold = Math.min(100, sheet.offsetHeight * 0.22);
    if (dragCurrentY > threshold) {
      closePlaceSheetAnimated();
    } else {
      sheet.style.transition = 'transform 0.22s ease';
      sheet.style.transform = '';
      sheet.addEventListener('transitionend', () => {
        sheet.style.transition = '';
      }, { once: true });
    }
  }

  sheet.addEventListener('touchend', endDrag);
  sheet.addEventListener('touchcancel', endDrag);

  window.addEventListener('popstate', () => {
    const el = document.getElementById('place-sheet');
    if (!el.classList.contains('hidden')) {
      sheetHistoryActive = false;
      closePlaceSheetInternal();
    }
  });
}

function showPlaceDetail(place) {
  removeCoordPin(); // remove any old pin before new one is created by showCoordPin
  selectedPlace = place;
  const sheet = document.getElementById('place-sheet');
  const wasHidden = sheet.classList.contains('hidden');
  resetSheetTransform();
  const style = CATEGORY_STYLES[place.category] || CATEGORY_STYLES.other;

  document.getElementById('sheet-badge').textContent = style.label || place.category;
  document.getElementById('sheet-title').textContent = place.name;

  let desc = place.description || `${style.label || place.category} at IIT Jodhpur`;
  if (place.is_proposed) desc = 'Proposed — ' + desc;
  document.getElementById('sheet-description').textContent = desc;

  if (userLocation) {
    const d = haversine(userLocation.lat, userLocation.lng, place.lat, place.lng);
    document.getElementById('sheet-distance').textContent = `${formatDist(d)} · ${Math.max(1, Math.round(d / 83))} min walk`;
  } else {
    document.getElementById('sheet-distance').textContent = 'Enable GPS for distance';
  }

  if (place.lat != null && place.lng != null) {
    const coordText = `${Number(place.lat).toFixed(6)}, ${Number(place.lng).toFixed(6)}`;
    document.getElementById('sheet-coords-text').textContent = coordText;
    document.getElementById('sheet-coords').style.display = 'flex';
    const copyBtn = document.getElementById('sheet-coords-copy');
    copyBtn.onclick = () => {
      navigator.clipboard?.writeText(coordText).then(() => showToast('Coordinates copied', 'info'))
        .catch(() => showToast(coordText, 'info'));
    };
  } else {
    document.getElementById('sheet-coords').style.display = 'none';
  }

  document.getElementById('place-sheet').classList.remove('hidden');
  if (wasHidden) openPlaceSheetHistory();
  if (!place._noFly) map.flyTo({ center: [place.lng, place.lat], zoom: 17, duration: 800 });
}

// ============================================================
// Coordinate Pin — drops on every map tap, shows place sheet
// ============================================================
let coordMarker = null;

function removeCoordPin() {
  if (coordMarker) { coordMarker.remove(); coordMarker = null; }
}

/**
 * Drop a visible location pin at lngLat and open the place sheet.
 * @param {object} lngLat  — { lat, lng } or maplibregl.LngLat
 * @param {object} info    — optional { name, category, description, is_proposed }
 */
function showCoordPin(lngLat, info = {}) {
  // showPlaceDetail calls removeCoordPin internally, so call it first
  // then create the new marker so it survives that removal
  showPlaceDetail({
    name: info.name || 'Dropped Pin',
    category: info.category || 'poi',
    description: info.description || null,
    lat: typeof lngLat.lat === 'number' ? lngLat.lat : lngLat.getLat(),
    lng: typeof lngLat.lng === 'number' ? lngLat.lng : lngLat.getLng(),
    is_proposed: info.is_proposed || false,
    _noFly: info._noFly ?? !!info.name,
  });

  // Create the SVG drop-pin marker AFTER showPlaceDetail (which calls removeCoordPin)
  const el = document.createElement('div');
  el.className = 'coord-pin-wrapper';
  // viewBox "0 0 24 27": path tip is at (12,27) = exact bottom of viewBox,
  // so anchor:'bottom' places the pin tip precisely on the clicked coordinate.
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 27" width="32" height="36">
    <defs>
      <filter id="pshadow" x="-40%" y="-20%" width="180%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="rgba(0,0,0,0.40)"/>
      </filter>
    </defs>
    <path d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 18 9 18s9-11.25 9-18c0-4.97-4.03-9-9-9z"
          fill="#0a0a0a" filter="url(#pshadow)"/>
    <circle cx="12" cy="9" r="4" fill="white"/>
  </svg>`;
  coordMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, 0] })
    .setLngLat([
      typeof lngLat.lng === 'number' ? lngLat.lng : lngLat.getLng(),
      typeof lngLat.lat === 'number' ? lngLat.lat : lngLat.getLat(),
    ])
    .addTo(map);
}

// ============================================================
// Directions Panel — start/end by search or map pick
// ============================================================
function openDirectionsPanel(initial = {}) {
  directionsOpen = true;
  closePlaceSheet();
  removeCoordPin();
  document.getElementById('search-container').classList.add('hidden');
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('directions-panel').classList.remove('hidden');
  expandDirectionsPanel();

  if (initial.from) setDirectionsPoint('from', initial.from, false);
  else if (!directionsFrom) document.getElementById('dir-from').value = '';

  if (initial.to) setDirectionsPoint('to', initial.to, false);
  else if (!directionsTo) document.getElementById('dir-to').value = '';

  updateDirectionsGoButton();
  updateDirectionsMarkers();
  clearDirectionsPickMode();
  // Sync the mode toggle visuals with the current mode state
  document.querySelectorAll('.dir-mode-btn').forEach(b => {
    const active = b.dataset.mode === directionsMode;
    b.classList.toggle('dir-mode-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function expandDirectionsPanel() {
  document.getElementById('directions-panel').classList.remove('minimized');
}

function minimizeDirectionsPanel() {
  const panel = document.getElementById('directions-panel');
  panel.classList.add('minimized');
  document.getElementById('dir-collapsed-route').textContent =
    `${directionsFrom?.name || 'Start'} → ${directionsTo?.name || 'End'}`;
  document.getElementById('dir-collapsed-meta').textContent =
    document.getElementById('dir-summary-text').textContent || '';
  hideAllDirResults();
  clearDirectionsPickMode();
}

function closeDirectionsPanel() {
  directionsOpen = false;
  clearDirectionsPickMode();
  document.getElementById('directions-panel').classList.add('hidden');
  document.getElementById('directions-panel').classList.remove('minimized');
  document.getElementById('search-container').classList.remove('hidden');
  hideAllDirResults();
  document.getElementById('dir-summary').classList.add('hidden');
  clearRoute();
  removeDirectionsMarkers();
  directionsFrom = null;
  directionsTo = null;
  document.getElementById('dir-from').value = '';
  document.getElementById('dir-to').value = '';
}

function setDirectionsPoint(target, point, autoRoute = true) {
  if (target === 'from') {
    directionsFrom = { lat: point.lat, lng: point.lng, name: point.name };
    document.getElementById('dir-from').value = point.name;
  } else {
    directionsTo = { lat: point.lat, lng: point.lng, name: point.name };
    document.getElementById('dir-to').value = point.name;
  }
  updateDirectionsMarkers();
  updateDirectionsGoButton();
  hideDirResults(target);
  if (autoRoute && directionsFrom && directionsTo) calculateDirectionsRoute();
}

function updateDirectionsGoButton() {
  document.getElementById('dir-go').disabled = !(directionsFrom && directionsTo);
}

function setDirectionsPickMode(target) {
  directionsPickTarget = target;
  document.querySelectorAll('.dir-pick-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pick === target);
  });
  const hint = document.getElementById('dir-pick-hint');
  hint.textContent = target === 'from'
    ? 'Tap the map to set starting point'
    : 'Tap the map to set destination';
  hint.classList.remove('hidden');
  showToast(hint.textContent, 'info');
}

function clearDirectionsPickMode() {
  directionsPickTarget = null;
  document.querySelectorAll('.dir-pick-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('dir-pick-hint').classList.add('hidden');
}

function removeDirectionsMarkers() {
  if (directionsFromMarker) { directionsFromMarker.remove(); directionsFromMarker = null; }
  if (directionsToMarker) { directionsToMarker.remove(); directionsToMarker = null; }
}

function updateDirectionsMarkers() {
  removeDirectionsMarkers();
  if (directionsFrom) {
    const el = document.createElement('div');
    el.className = 'dir-from-marker';
    directionsFromMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([directionsFrom.lng, directionsFrom.lat]).addTo(map);
  }
  if (directionsTo) {
    const el = document.createElement('div');
    el.className = 'dir-to-marker';
    directionsToMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([directionsTo.lng, directionsTo.lat]).addTo(map);
  }
}

function swapDirectionsPoints() {
  [directionsFrom, directionsTo] = [directionsTo, directionsFrom];
  document.getElementById('dir-from').value = directionsFrom?.name || '';
  document.getElementById('dir-to').value = directionsTo?.name || '';
  updateDirectionsMarkers();
  updateDirectionsGoButton();
  if (directionsFrom && directionsTo) calculateDirectionsRoute();
}

function hideDirResults(target) {
  document.getElementById(`dir-${target}-results`).classList.add('hidden');
}

function hideAllDirResults() {
  hideDirResults('from');
  hideDirResults('to');
}

function renderDirResults(target, query) {
  const container = document.getElementById(`dir-${target}-results`);
  if (!query || query.length < 1) {
    container.classList.add('hidden');
    return;
  }
  const data = IITJData.search(query, 6);
  if (!data.length) {
    container.innerHTML = `<div class="dir-result-item"><span class="result-name">No results</span></div>`;
    container.classList.remove('hidden');
    return;
  }
  container.innerHTML = data.map(item => {
    const style = CATEGORY_STYLES[item.category] || CATEGORY_STYLES.other;
    return `<div class="dir-result-item" data-lat="${item.lat}" data-lng="${item.lng}" data-name="${escapeHtml(item.name)}">
      <div class="result-icon">${style.abbr}</div>
      <div class="result-info"><div class="result-name">${escapeHtml(item.name)}</div>
      <div class="result-category">${style.label || item.category}</div></div>
    </div>`;
  }).join('');
  container.querySelectorAll('.dir-result-item[data-lat]').forEach(el => {
    el.addEventListener('click', () => {
      setDirectionsPoint(target, {
        lat: parseFloat(el.dataset.lat),
        lng: parseFloat(el.dataset.lng),
        name: el.dataset.name,
      });
    });
  });
  container.classList.remove('hidden');
  hideDirResults(target === 'from' ? 'to' : 'from');
}

function setupDirectionsPanel() {
  const fromInput = document.getElementById('dir-from');
  const toInput   = document.getElementById('dir-to');

  fromInput.addEventListener('input', () => {
    directionsFrom = null;
    updateDirectionsGoButton();
    clearTimeout(dirSearchTimeout);
    dirSearchTimeout = setTimeout(() => renderDirResults('from', fromInput.value.trim()), 200);
  });
  toInput.addEventListener('input', () => {
    directionsTo = null;
    updateDirectionsGoButton();
    clearTimeout(dirSearchTimeout);
    dirSearchTimeout = setTimeout(() => renderDirResults('to', toInput.value.trim()), 200);
  });

  fromInput.addEventListener('focus', () => hideDirResults('to'));
  toInput.addEventListener('focus', () => hideDirResults('from'));

  document.querySelectorAll('.dir-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => setDirectionsPickMode(btn.dataset.pick));
  });

  document.getElementById('dir-swap').addEventListener('click', swapDirectionsPoints);
  document.getElementById('dir-go').addEventListener('click', calculateDirectionsRoute);
  document.getElementById('dir-close').addEventListener('click', closeDirectionsPanel);
  document.getElementById('dir-close-mini').addEventListener('click', closeDirectionsPanel);
  document.getElementById('dir-expand').addEventListener('click', expandDirectionsPanel);
  document.getElementById('dir-expand-icon').addEventListener('click', expandDirectionsPanel);

  document.getElementById('dir-your-location').addEventListener('click', () => {
    if (!userLocation) {
      showToast('Enable GPS first', 'warn');
      if (!watchId) requestUserLocation();
      return;
    }
    setDirectionsPoint('from', {
      lat: userLocation.lat,
      lng: userLocation.lng,
      name: 'Your location',
    });
  });

  document.querySelectorAll('.dir-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode === 'walk' ? 'walk' : 'drive';
      if (directionsMode === mode) return;
      directionsMode = mode;
      document.querySelectorAll('.dir-mode-btn').forEach(b => {
        const active = b.dataset.mode === mode;
        b.classList.toggle('dir-mode-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      // Recompute on-the-fly if a route is already on screen
      if (currentRoute && directionsFrom && directionsTo) calculateDirectionsRoute();
    });
  });
}

async function calculateDirectionsRoute() {
  if (!directionsFrom || !directionsTo) {
    showToast('Set both starting point and destination', 'warn');
    return;
  }

  closePlaceSheet();
  clearDirectionsPickMode();
  showLoadingToast('Calculating route…');

  try {
    // Snap to the registered entrance gate if the destination has one
    // (e.g. hostels route to their actual entry gate, not the building centroid)
    const fromEntry = IITJData.getEntrance(directionsFrom.name);
    const toEntry   = IITJData.getEntrance(directionsTo.name);
    const routeFromLat = fromEntry ? fromEntry.lat : directionsFrom.lat;
    const routeFromLng = fromEntry ? fromEntry.lng : directionsFrom.lng;
    const routeToLat   = toEntry   ? toEntry.lat   : directionsTo.lat;
    const routeToLng   = toEntry   ? toEntry.lng   : directionsTo.lng;

    const route = IITJRouter.computeRoute(
      routeFromLat, routeFromLng,
      routeToLat,   routeToLng,
      directionsMode
    );

    hideLoadingToast();
    if (route.error) { showToast(route.error, 'error'); return; }

    currentRoute        = route;
    navInstructionIndex = 0;
    navigationActive    = true;
    navDestination      = { ...directionsTo };

    drawRoute(route.geometry);

    document.getElementById('dir-summary').classList.remove('hidden');
    const travelVerb = route.profile === 'driving' ? 'drive' : 'walk';
    document.getElementById('dir-summary-text').textContent =
      `${formatDist(route.distance)} · ${route.eta_minutes} min ${travelVerb}`;
    let summaryType;
    if (!route.using_road_network) summaryType = 'Direct path · no road nearby';
    else if (route.fell_back_to_walk) summaryType = 'Walking · no drivable road here';
    else summaryType = route.profile === 'driving' ? 'Driving · main roads' : 'Walking · campus paths';
    document.getElementById('dir-summary-type').textContent = summaryType;

    document.getElementById('nav-destination').textContent = directionsTo.name;
    document.getElementById('nav-eta').textContent =
      `${route.eta_minutes} min ${route.profile === 'driving' ? 'drive' : 'walk'}`;
    document.getElementById('nav-distance').textContent = formatDist(route.distance);
    updateNavInstruction(route.instructions[0]?.distance ?? null);
    _showOffRoute(false);
    _showRerouting(false);
    document.getElementById('nav-panel').classList.remove('hidden');

    minimizeDirectionsPanel();

    const coords = route.geometry.coordinates;
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: { top: 72, bottom: 200, left: 40, right: 40 }, duration: 1000 });

    showToast(
      route.using_road_network ? 'Best route found' : 'Direct route (no road nearby)',
      route.using_road_network ? 'success' : 'warn'
    );
  } catch (err) {
    hideLoadingToast();
    console.error('Routing error:', err);
    showToast('Could not calculate route', 'error');
  }
}

// ============================================================
// Navigation — route markers + progress tracking + rerouting
// ============================================================
let routeOriginMarker = null;   // blue dot at start
let routeDestMarker   = null;   // red pin at destination
let _rerouteCooldown  = false;  // prevents spam-rerouting

async function reRoute() {
  if (!navDestination || _rerouteCooldown) return;
  _rerouteCooldown = true;
  setTimeout(() => { _rerouteCooldown = false; }, 8000);

  _showRerouting(true);
  if (directionsFrom && directionsTo) {
    // Update from-point to current GPS if available
    if (userLocation) directionsFrom = { lat: userLocation.lat, lng: userLocation.lng, name: 'Your location' };
    await calculateDirectionsRoute();
  } else if (userLocation) {
    selectedPlace = navDestination;
    await startNavigation();
  }
  _showRerouting(false);
}

async function startNavigation() {
  if (!selectedPlace) return;
  const to = { lat: selectedPlace.lat, lng: selectedPlace.lng, name: selectedPlace.name };
  const from = userLocation
    ? { lat: userLocation.lat, lng: userLocation.lng, name: 'Your location' }
    : null;
  closePlaceSheet();
  openDirectionsPanel({ from, to });
  if (from && to) calculateDirectionsRoute();
  else if (!from) {
    showToast('Set starting point or enable GPS', 'warn');
    if (!watchId) requestUserLocation();
  }
}

function _removeRouteMarkers() {
  if (routeOriginMarker) { routeOriginMarker.remove(); routeOriginMarker = null; }
  if (routeDestMarker)   { routeDestMarker.remove();   routeDestMarker   = null; }
}

function _addRouteMarkers(startCoord, endCoord) {
  _removeRouteMarkers();

  // ── Start: blue circle ──
  const startEl = document.createElement('div');
  startEl.className = 'route-origin-marker';
  routeOriginMarker = new maplibregl.Marker({ element: startEl, anchor: 'center' })
    .setLngLat(startCoord).addTo(map);

  // ── End: red teardrop pin ──
  const endEl = document.createElement('div');
  endEl.className = 'route-dest-marker';
  routeDestMarker = new maplibregl.Marker({ element: endEl, anchor: 'bottom' })
    .setLngLat(endCoord).addTo(map);
}

function drawRoute(geometry) {
  const data = { type: 'Feature', geometry };

  // Remove old route layers so they can be re-added on top after style reload
  ['route-traveled', 'route-glow', 'route-casing', 'route-line'].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  ['route', 'route-traveled-src'].forEach(id => {
    if (map.getSource(id)) map.removeSource(id);
  });

  map.addSource('route', { type: 'geojson', data });

  // Traveled portion source (updated as user moves)
  map.addSource('route-traveled-src', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });

  // Outer soft glow
  map.addLayer({
    id: 'route-glow', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#007AFF', 'line-width': 18, 'line-opacity': 0.18, 'line-blur': 4 }
  });
  // White casing
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 1 }
  });
  // Core bright blue
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#007AFF', 'line-width': 6.5, 'line-opacity': 1 }
  });
  // Gray overlay for already-traveled portion (on top)
  map.addLayer({
    id: 'route-traveled', type: 'line', source: 'route-traveled-src',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#9ca3af', 'line-width': 6.5, 'line-opacity': 0.85 }
  });

  // Place start/end markers
  const coords = geometry.coordinates;
  _addRouteMarkers(coords[0], coords[coords.length - 1]);
}

// Update the "traveled" gray overlay up to segIdx/t on the route
function _updateTraveledOverlay(segIdx, t, coords) {
  if (!map.getSource('route-traveled-src')) return;
  const traveled = coords.slice(0, segIdx + 1);
  if (t > 0 && segIdx < coords.length - 1) {
    const [x1, y1] = coords[segIdx], [x2, y2] = coords[segIdx + 1];
    traveled.push([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]);
  }
  map.getSource('route-traveled-src').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: traveled }
  });
}

// ── Direction arrow SVG icons ─────────────────────────────────
const NAV_ARROWS = {
  straight: '↑',
  'turn-right': '↱',
  'turn-left':  '↰',
  'sharp-right':'⬏',
  'sharp-left': '⬎',
  arrive:       '⬤',
  depart:       '↑',
};

function _instrArrow(instr) {
  if (instr.type === 'arrive') return NAV_ARROWS.arrive;
  const t = instr.text.toLowerCase();
  if (t.includes('sharp') && t.includes('right')) return NAV_ARROWS['sharp-right'];
  if (t.includes('sharp') && t.includes('left'))  return NAV_ARROWS['sharp-left'];
  if (t.includes('right'))  return NAV_ARROWS['turn-right'];
  if (t.includes('left'))   return NAV_ARROWS['turn-left'];
  return NAV_ARROWS.straight;
}

function _showRerouting(show) {
  document.getElementById('nav-rerouting')?.classList.toggle('hidden', !show);
}
function _showOffRoute(show) {
  document.getElementById('nav-offroute')?.classList.toggle('hidden', !show);
}

// Project user onto nearest segment of route; return { segIdx, t, dist }
function _nearestOnRoute(lat, lng, coords) {
  let minDist = Infinity, bestSeg = 0, bestT = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i], [x2, y2] = coords[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((lng - x1) * dx + (lat - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const nx = x1 + t * dx, ny = y1 + t * dy;
    const d = haversine(lat, lng, ny, nx);
    if (d < minDist) { minDist = d; bestSeg = i; bestT = t; }
  }
  return { segIdx: bestSeg, t: bestT, dist: minDist };
}

// Remaining distance along route from a given segment/t
function _remainingDist(segIdx, t, coords) {
  let d = 0;
  if (segIdx < coords.length - 1) {
    const [x1, y1] = coords[segIdx], [x2, y2] = coords[segIdx + 1];
    const mx = x1 + t * (x2 - x1), my = y1 + t * (y2 - y1);
    d += haversine(my, mx, y2, x2);
  }
  for (let i = segIdx + 1; i < coords.length - 1; i++) {
    d += haversine(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  return d;
}

function updateNavInstruction(distToNextTurn) {
  if (!currentRoute?.instructions) return;
  const instr = currentRoute.instructions[navInstructionIndex];
  if (!instr) return;

  // Arrow icon
  document.getElementById('nav-arrow-icon').textContent = _instrArrow(instr);

  // Distance to next turn
  const distEl = document.getElementById('nav-turn-dist');
  if (distToNextTurn != null && distToNextTurn > 0) {
    distEl.textContent = formatDist(distToNextTurn);
  } else {
    distEl.textContent = instr.type === 'arrive' ? 'Arriving' : (instr.distance ? formatDist(instr.distance) : '—');
  }

  // Instruction text
  document.getElementById('nav-text').textContent = instr.text;

  // Next instruction
  const next  = currentRoute.instructions[navInstructionIndex + 1];
  const bar   = document.getElementById('nav-next-bar');
  if (next && next.type !== 'arrive') {
    document.getElementById('nav-next-arrow').textContent = _instrArrow(next);
    document.getElementById('nav-next').textContent = next.text;
    bar?.classList.remove('hidden');
  } else {
    bar?.classList.add('hidden');
  }

  // Progress bar
  const pct = Math.round(navInstructionIndex / Math.max(1, currentRoute.instructions.length - 1) * 100);
  document.getElementById('nav-progress').style.width = `${pct}%`;
}

function clearRoute() {
  navigationActive = false;
  currentRoute     = null;
  navDestination   = null;
  _rerouteCooldown = false;
  _showOffRoute(false);
  _showRerouting(false);
  document.getElementById('nav-panel').classList.add('hidden');
  ['route-traveled', 'route-glow', 'route-casing', 'route-line'].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  ['route', 'route-traveled-src'].forEach(id => {
    if (map.getSource(id)) map.removeSource(id);
  });
  _removeRouteMarkers();
}

function endNavigation() {
  clearRoute();
  showToast('Navigation ended', 'info');
}

// ============================================================
// User Location — accuracy circle, heading, auto-follow
// ============================================================
function requestUserLocation() {
  if (!navigator.geolocation) { showToast('Location not supported on this device', 'error'); return; }
  if (watchId !== null) return; // already watching

  showToast('Finding your location…', 'info');

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const loc = {
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        heading:  pos.coords.heading,
        speed:    pos.coords.speed,
      };

      // ── Live navigation tracking ──────────────────────────────
      if (navigationActive && currentRoute) {
        const coords = currentRoute.geometry.coordinates;
        const instrs = currentRoute.instructions;

        // Project user onto nearest route segment
        const { segIdx, t, dist: distToRoute } = _nearestOnRoute(loc.lat, loc.lng, coords);

        // Update gray "traveled" overlay
        _updateTraveledOverlay(segIdx, t, coords);

        if (distToRoute > 45) {
          // Off-route: show warning and reroute
          _showOffRoute(true);
          reRoute();
        } else {
          _showOffRoute(false);

          // Advance instruction index based on coordinate position
          while (
            navInstructionIndex < instrs.length - 1 &&
            segIdx >= (instrs[navInstructionIndex + 1].coord_index ?? Infinity)
          ) {
            navInstructionIndex++;
          }

          // Calculate distance to next instruction's coordinate
          const nextInstr = instrs[navInstructionIndex + 1];
          let distToTurn = null;
          if (nextInstr && nextInstr.coord_index != null) {
            const nCoord = coords[nextInstr.coord_index];
            const midLng = coords[segIdx][0] + t * (coords[segIdx + 1]?.[0] - coords[segIdx][0] || 0);
            const midLat = coords[segIdx][1] + t * (coords[segIdx + 1]?.[1] - coords[segIdx][1] || 0);
            // Sum distance from current snap to next instruction coord
            distToTurn = haversine(midLat, midLng, coords[segIdx + 1]?.[1] ?? midLat, coords[segIdx + 1]?.[0] ?? midLng);
            for (let k = segIdx + 1; k < nextInstr.coord_index; k++) {
              distToTurn += haversine(coords[k][1], coords[k][0], coords[k + 1][1], coords[k + 1][0]);
            }
          }

          // Remaining distance and ETA
          const remDist = _remainingDist(segIdx, t, coords);
          const walkMps = currentRoute.profile === 'driving' ? 8.3 : 1.4;
          const remMin  = Math.max(1, Math.round(remDist / walkMps / 60));
          const verb    = currentRoute.profile === 'driving' ? 'drive' : 'walk';
          document.getElementById('nav-eta').textContent       = `${remMin} min ${verb}`;
          document.getElementById('nav-distance').textContent  = formatDist(remDist);

          updateNavInstruction(distToTurn);

          // Auto-pan to follow user heading if autoFollow is on
          if (autoFollow && loc.heading != null) {
            map.easeTo({ center: [loc.lng, loc.lat], bearing: loc.heading, duration: 500 });
          }
        }
      }

      const firstFix = !userLocation;
      userLocation = loc;
      if (loc.heading != null) headingDeg = loc.heading;

      updateLocationMarker();

      if (firstFix) {
        showToast('Location found', 'success');
        setAutoFollow(true);
        document.getElementById('btn-locate').classList.add('location-active');
      } else if (autoFollow) {
        map.easeTo({ center: [loc.lng, loc.lat], duration: 400 });
      }
    },
    (err) => {
      watchId = null;
      const msgs = { 1: 'Location access denied — enable in browser settings', 2: 'Location unavailable', 3: 'Location request timed out' };
      showToast(msgs[err.code] || 'Location error', 'warn');
      document.getElementById('btn-locate').classList.remove('location-active', 'location-follow');
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );

  // Compass heading on mobile
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
  window.addEventListener('deviceorientationabsolute', onDeviceOrientation, { passive: true });
  window.addEventListener('deviceorientation',         onDeviceOrientation, { passive: true });
}

function onDeviceOrientation(e) {
  const deg = e.alpha != null ? (360 - e.alpha) % 360 : null;
  if (deg != null) {
    headingDeg = deg;
    const dot = document.querySelector('.location-dot');
    if (dot) dot.style.transform = `rotate(${deg}deg)`;
  }
}

function updateLocationMarker() {
  if (!userLocation) return;

  const lngLat = [userLocation.lng, userLocation.lat];

  // Accuracy circle — MapLibre circle layer for precision
  const accuracyGeoJSON = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: lngLat } }]
  };
  if (map.getSource('user-accuracy')) {
    map.getSource('user-accuracy').setData(accuracyGeoJSON);
    const metersPerPx = 156543.03392 * Math.cos(userLocation.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
    const radiusPx = Math.max(8, (userLocation.accuracy || 10) / metersPerPx);
    if (map.getLayer('user-accuracy-circle')) map.setPaintProperty('user-accuracy-circle', 'circle-radius', radiusPx);
  } else if (map.isStyleLoaded()) {
    map.addSource('user-accuracy', { type: 'geojson', data: accuracyGeoJSON });
    const metersPerPx = 156543.03392 * Math.cos(userLocation.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
    const radiusPx = Math.max(8, (userLocation.accuracy || 10) / metersPerPx);
    map.addLayer({
      id: 'user-accuracy-circle', type: 'circle', source: 'user-accuracy',
      paint: { 'circle-color': '#0a0a0a', 'circle-opacity': 0.1, 'circle-radius': radiusPx, 'circle-stroke-width': 1, 'circle-stroke-color': '#525252', 'circle-stroke-opacity': 0.3 }
    });
  }

  // User location dot marker
  if (locationMarker) {
    locationMarker.setLngLat(lngLat);
  } else {
    const el = document.createElement('div');
    el.className = 'location-marker';
    el.innerHTML = `<div class="location-dot"></div><div class="location-pulse"></div>`;
    locationMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(lngLat).addTo(map);
  }

  // Update zoom-based accuracy circle radius when zoom changes
  if (!map._locationZoomBound) {
    map._locationZoomBound = true;
    map.on('zoom', () => {
      if (!userLocation || !map.getLayer('user-accuracy-circle')) return;
      const mpp = 156543.03392 * Math.cos(userLocation.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
      map.setPaintProperty('user-accuracy-circle', 'circle-radius', Math.max(8, (userLocation.accuracy || 10) / mpp));
    });
  }
}

function setAutoFollow(on) {
  autoFollow = on;
  const btn = document.getElementById('btn-locate');
  btn.classList.toggle('location-follow', on);
  if (on && userLocation) map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 17, duration: 800 });
}

function flyToUserLocation() {
  if (!watchId) {
    requestUserLocation();
    return;
  }
  if (autoFollow) {
    setAutoFollow(false);
    showToast('Auto-follow off', 'info');
  } else {
    setAutoFollow(true);
    if (!userLocation) showToast('Waiting for GPS signal…', 'info');
    else showToast('Following your location', 'info');
  }
}

// Re-add location layers after style reload
function restoreLocationLayer() {
  if (!userLocation) return;
  // Must remove old marker from map before nulling — it persists across style reloads
  if (locationMarker) { locationMarker.remove(); locationMarker = null; }
  if (map.getSource('user-accuracy')) {
    try { map.removeLayer('user-accuracy-circle'); } catch (_) {}
    try { map.removeSource('user-accuracy'); } catch (_) {}
  }
  updateLocationMarker();
}

// ============================================================
// Base map toggles — satellite / dark mode
// ============================================================
// Esri World Imagery tiles become "not yet available" above zoom 17
const SATELLITE_MAX_ZOOM = 17;

async function toggleSatellite() {
  stopBuildingHighlight(); // clear pulse before style swap
  isSatellite = !isSatellite;
  if (isSatellite) {
    isDark = false;
    document.documentElement.removeAttribute('data-theme');
    map.setMaxZoom(SATELLITE_MAX_ZOOM);
    if (map.getZoom() > SATELLITE_MAX_ZOOM) map.zoomTo(SATELLITE_MAX_ZOOM);
    // Hide custom 3D models before the style swap so the styledata
    // re-add hook doesn't bring them back over the imagery.
    if (typeof Landmarks3D !== 'undefined') Landmarks3D.hide();
  } else {
    map.setMaxZoom(19);
  }
  showToast(isSatellite ? 'Satellite view' : 'Map view', 'info');
  await applyMapStyle();
}

async function toggleDarkMode() {
  if (isSatellite) {
    isSatellite = false;
    showToast('Switched to map view', 'info');
  }
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : '');
  await applyMapStyle();
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(msg, type = 'info', duration = 2800) {
  const old = document.getElementById('toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.id = 'toast';
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-dot"></span><span>${msg}</span>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('visible'));
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, duration);
}

function showLoadingToast(msg) {
  const old = document.getElementById('toast-loading');
  if (old) old.remove();
  const t = document.createElement('div');
  t.id = 'toast-loading';
  t.className = 'toast toast-info';
  t.innerHTML = `<span class="toast-spinner"></span><span>${msg}</span>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('visible'));
}

function hideLoadingToast() {
  const t = document.getElementById('toast-loading');
  if (t) { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }
}

// ============================================================
// Event Listeners
// ============================================================
function setupEventListeners() {
  setupSearch();
  setupSheetGestures();
  setupDirectionsPanel();

  document.getElementById('btn-open-directions').addEventListener('click', () => openDirectionsPanel());
  document.getElementById('menu-directions').addEventListener('click', () => {
    closeMenu();
    openDirectionsPanel();
  });

  document.getElementById('btn-locate').addEventListener('click',   flyToUserLocation);
  document.getElementById('btn-satellite').addEventListener('click', toggleSatellite);
  document.getElementById('btn-dark').addEventListener('click',     toggleDarkMode);
  document.getElementById('btn-layers').addEventListener('click',    showLayerPanel);
  document.getElementById('btn-3d').addEventListener('click',        toggle3D);

  document.getElementById('layer-toggle-buildings').addEventListener('change', () => toggleLayer('buildings'));
  document.getElementById('layer-toggle-roads').addEventListener('change',     () => toggleLayer('roads'));
  document.getElementById('layer-toggle-markers').addEventListener('change',   () => toggleLayer('markers'));

  document.getElementById('btn-directions').addEventListener('click', startNavigation);
  document.getElementById('btn-share').addEventListener('click', () => {
    if (selectedPlace) sharePlaceOrLocation(selectedPlace);
  });
  document.getElementById('sheet-close').addEventListener('click', closePlaceSheet);

  document.getElementById('nav-close-btn')?.addEventListener('click', endNavigation);
  document.getElementById('nav-end-btn')?.addEventListener('click',   endNavigation);

  document.getElementById('menu-btn').addEventListener('click',     openMenu);
  document.getElementById('menu-close').addEventListener('click',   closeMenu);
  document.getElementById('menu-overlay').addEventListener('click', closeMenu);

  document.getElementById('menu-explore').addEventListener('click', () => {
    closeMenu();
    map.flyTo({ center: CAMPUS_CENTER, zoom: CAMPUS_ZOOM, duration: 900 });
  });
  document.getElementById('menu-share-location').addEventListener('click', () => {
    closeMenu();
    shareMyLocation();
  });
  document.getElementById('menu-about').addEventListener('click', () => {
    closeMenu();
    showToast('IITJ Maps v3 — Campus Navigation, IIT Jodhpur', 'info');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeMenu();
      if (directionsOpen) closeDirectionsPanel();
      else closePlaceSheet();
      removeCoordPin();
      document.getElementById('search-results').classList.add('hidden');
      document.getElementById('layer-panel').classList.add('hidden');
    }
    if (e.key === '/' && document.activeElement !== document.getElementById('search-input')) {
      e.preventDefault();
      document.getElementById('search-input').focus();
    }
  });
}

function openMenu()  { document.getElementById('side-menu').classList.remove('hidden'); document.getElementById('menu-overlay').classList.remove('hidden'); }
function closeMenu() { document.getElementById('side-menu').classList.add('hidden');    document.getElementById('menu-overlay').classList.add('hidden');    }

// ============================================================
// Utilities
// ============================================================
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const a = Math.sin((lat2-lat1)*Math.PI/360)**2 +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin((lng2-lng1)*Math.PI/360)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDist(m) { return m < 1000 ? `${Math.round(m)}m` : `${(m/1000).toFixed(1)}km`; }

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ============================================================
// Deep Linking — ?lat=&lng=&place=&zoom=
// ============================================================
function handleDeepLink() {
  const p = new URLSearchParams(location.search);
  const lat  = parseFloat(p.get('lat'));
  const lng  = parseFloat(p.get('lng'));
  const placeParam = p.get('place');
  const zoom = parseFloat(p.get('zoom')) || 17;

  if (!isNaN(lat) && !isNaN(lng)) {
    map.flyTo({ center: [lng, lat], zoom, duration: 800 });
    const info = { _noFly: true };
    if (placeParam) {
      info.name = placeParam;
      const cat = p.get('category');
      if (cat) info.category = cat;
      const desc = p.get('desc');
      if (desc) info.description = desc;
    }
    // Wait for flyTo, then drop pin + open place sheet (named shares included)
    setTimeout(() => showCoordPin({ lat, lng }, info), 900);
  }
}

function buildShareURL(place) {
  const base = `${location.origin}${location.pathname}`;
  const params = new URLSearchParams({
    lat:  place.lat.toFixed(6),
    lng:  place.lng.toFixed(6),
    zoom: 17,
    ...(place.name        ? { place: place.name }        : {}),
    ...(place.category    ? { category: place.category } : {}),
    ...(place.description ? { desc: place.description }  : {}),
  });
  return `${base}?${params}`;
}

function sharePlaceOrLocation(place) {
  const url  = buildShareURL(place);
  const text = place.name ? `${place.name} — IITJ Maps` : 'Location on IITJ Maps';
  if (navigator.share) {
    navigator.share({ title: text, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url)
      .then(() => showToast('Share link copied!', 'success'))
      .catch(() => showToast(url, 'info'));
  }
}

function shareMyLocation() {
  if (!userLocation) {
    showToast('Enable GPS first', 'warn');
    return;
  }
  sharePlaceOrLocation({ lat: userLocation.lat, lng: userLocation.lng, name: 'My Location' });
}

function hideSplash() {
  const splash = document.getElementById('splash');
  splash.style.transition = 'opacity 0.5s ease';
  splash.style.opacity = '0';
  document.getElementById('app').classList.remove('hidden');
  setTimeout(() => splash.remove(), 500);
}

document.addEventListener('DOMContentLoaded', init);
