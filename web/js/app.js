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

// MapLibre match expression for category → color (used in map layers).
// Hues are spread around the wheel so neighbouring dots stay distinguishable;
// the same palette drives categories.json (filter chips + 3D extrusions).
function categoryColorExpr() {
  return ['match', ['get', 'category'],
    'academic',       '#2563eb',   // royal blue
    'hostel',         '#ea580c',   // orange
    'dining',         '#dc2626',   // red
    'sports',         '#16a34a',   // emerald
    'medical',        '#db2777',   // pink
    'gate',           '#4f46e5',   // indigo
    'parking',        '#0369a1',   // deep blue
    'utility',        '#64748b',   // slate
    'administrative', '#475569',   // dark slate
    'transport',      '#0d9488',   // teal
    'recreation',     '#9333ea',   // violet
    'residential',    '#92400e',   // brown
    'bank',           '#d97706',   // amber
    'university',     '#2563eb',
    '#94a3b8'                      // other → light slate
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
  const onF4Day = !isSatellite && !isDark;
  return {
    'text-color': onSatellite ? '#ffffff' : (isDark ? '#e2e8f0' : (onF4Day ? '#2d3748' : '#374151')),
    'text-halo-color': onSatellite ? 'rgba(0,0,0,0.85)' : (isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.92)'),
    'text-halo-width': onSatellite ? 2 : (onF4Day ? 1.75 : 1.5)
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

// Three.js (~600 KB) stays off the critical path, but we pre-warm it in the
// background once the 2D map is interactive so the first 3D toggle is smooth.
let _landmarks3dPrewarmScheduled = false;

function canBackgroundPrewarm3D() {
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return true;
    if (conn.saveData) return false;
    const slow = conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g';
    if (slow) return false;
  } catch (_) {}
  return true;
}

function scheduleLandmarks3DPrewarm() {
  if (_landmarks3dPrewarmScheduled || !canBackgroundPrewarm3D()) return;
  if (typeof Landmarks3D === 'undefined') return;
  // Only flagship-tier devices pre-build + GPU-upload the 3D scene in the
  // background. On lower phones that background upload is what caused a 1–2s
  // stutter a few seconds after load, so they build 3D lazily on first tap.
  if (window.PerfTier && !PerfTier.prewarm3D) return;
  _landmarks3dPrewarmScheduled = true;

  const kick = () => {
    if (!map?.isStyleLoaded()) {
      map.once('sourcedata', kick);
      return;
    }
    Landmarks3D.init(map);
    Landmarks3D.load(() => {
      if (typeof Landmarks3D.prewarm === 'function') Landmarks3D.prewarm();
    });
  };

  // Give tiles and gestures a head start before the Three.js download.
  setTimeout(kick, 3000);
}

function buildingFillOpacity() {
  if (isSatellite) return 0;
  if (isDark) return ['interpolate', ['linear'], ['zoom'], 14, 0.72, 17, 0.9];
  return ['interpolate', ['linear'], ['zoom'], 14, 0.78, 17, 0.92];
}

/** Neutral white crown glow for 3D night extrusions (no category tint). */
function buildingGlowColorExpr() {
  return '#eef1f5';
}

function buildingExtrusionColorExpr() {
  if (isSatellite) return isDark ? '#475569' : '#f1f5f9';
  // Non-custom 3D buildings render plain white (softened a touch at night).
  if (is3D && !isSatellite) return isDark ? '#e9ebef' : '#ffffff';
  if (isDark) return '#9aa8bc';
  return '#fafaf8';
}

function buildingFillColor() {
  return buildingExtrusionColorExpr();
}

function buildingExtrusionOpacity() {
  if (isDark && is3D && !isSatellite) return 0.84;
  if (is3D && !isSatellite) return 0.96;
  return 0.82;
}

function buildingGlowHeightExpr() {
  return ['*', buildingHeightExpr(), 1.1];
}

function buildingGlowBaseExpr() {
  return ['*', buildingHeightExpr(), 0.88];
}

function buildingGlowOpacity() {
  return isDark ? 0.32 : 0.14;
}

function buildingOutlineColor() {
  if (isSatellite) return isDark ? '#e2e8f0' : '#ffffff';
  // Category colour on building footprints in 2D only.
  return categoryColorExpr();
}

function buildingGlowLayerVisible() {
  // The glow layer re-draws every building extrusion a second time; skip it on
  // low-tier devices (perf-tier.js) where that doubled overdraw isn't affordable.
  if (window.PerfTier && !PerfTier.buildingGlow) return false;
  return isDark && is3D && LAYERS.buildings && !isSatellite;
}

function roadLampVisibility() {
  return isDark && !isSatellite && LAYERS.roads ? 'visible' : 'none';
}

function buildingOutlineCasingColor() {
  if (isSatellite) return 'rgba(0,0,0,0.45)';
  return isDark ? '#1e293b' : '#c8c3b8';
}

function buildingOutlineWidth() {
  return ['interpolate', ['linear'], ['zoom'], 14, 2, 17, 3.2, 19, 4];
}

function buildingOutlineCasingWidth() {
  return ['interpolate', ['linear'], ['zoom'], 14, 3, 17, 4.4, 19, 5.2];
}

function areaFillOpacity() {
  if (isSatellite) return 0;
  // F4: grass + roads dominate; keep area tints barely visible.
  return 0.1;
}

function bermFillColor() {
  return [
    'match', ['get', 'berm_type'],
    'landscape', isDark ? '#5a7a48' : '#8aab6e',
    /* wave */   isDark ? '#5a7a9a' : '#8eb0d0',
  ];
}

function bermFillOpacity() {
  if (isSatellite) return 0.4;
  if (is3D) return isDark ? 0.38 : 0.28;
  return isDark ? 0.78 : 0.85;
}

function bermOutlineColor() {
  return [
    'match', ['get', 'berm_type'],
    'landscape', isDark ? '#3d5c32' : '#5c7e44',
    /* wave */   isDark ? '#3a5570' : '#4a6d8a',
  ];
}

function bermLayerVisible() {
  return LAYERS.buildings && !is3D && !isSatellite;
}

function buildingOutlineOpacity() {
  if (isSatellite) return 0.15;
  return 1;
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
  clearDirectionsPickMode(true);
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
      // Prefix the OSM unit code (e.g. "E-16") when the display name is the
      // real name, so users still see the on-campus signage reference.
      description: [p.ref, p.description].filter(Boolean).join(' · '),
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
  syncMapBodyClasses();
  refreshBuildingTheme();
}

/** Body classes drive F4-style canvas brightness (vector map day/night). */
function syncMapBodyClasses() {
  document.body.classList.toggle('map-vector', !isSatellite);
  document.body.classList.toggle('map-3d', is3D && !isSatellite);
  document.body.classList.toggle('map-dark', isDark && !isSatellite);
  document.body.classList.toggle('map-satellite', isSatellite);
}

/** True between 18:00 and 06:00 campus local time (IST). */
function isCampusNight(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: CAMPUS_TZ,
    hour: 'numeric',
    hour12: false,
  }).format(now));
  return hour < 6 || hour >= 18;
}

function desiredNightMode() {
  if (nightModeManual) return isDark;
  return isCampusNight();
}

async function syncAutoNightMode() {
  if (isSatellite) return;
  const wantDark = desiredNightMode();
  if (wantDark === isDark) {
    syncMapBodyClasses();
    refreshBuildingTheme();
    return;
  }
  isDark = wantDark;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : '');
  await applyMapStyle();
  syncMapBodyClasses();
  updateBaseMapButtons();
}

function scheduleAutoNightWatch() {
  if (_nightWatchTimer) clearInterval(_nightWatchTimer);
  _nightWatchTimer = setInterval(() => {
    if (!nightModeManual) syncAutoNightMode();
  }, 60_000);
}

/** Show 2D footprints or 3D extrusions — never both at once. */
function applyBuildingViewMode() {
  if (!map || isSatellite) return;
  const showFlat = LAYERS.buildings && !is3D;
  const show3d = LAYERS.buildings && is3D;
  const bermVis = bermLayerVisible() ? 'visible' : 'none';
  const set = (id, vis) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis); };
  set('berms-fill', bermVis);
  set('berms-outline', bermVis);
  set('buildings-fill', showFlat ? 'visible' : 'none');
  set('buildings-outline-casing', showFlat ? 'visible' : 'none');
  set('buildings-outline', showFlat ? 'visible' : 'none');
  set('buildings-3d', show3d ? 'visible' : 'none');
  set('buildings-3d-glow', buildingGlowLayerVisible() ? 'visible' : 'none');
  set('buildings-labels', LAYERS.buildings ? 'visible' : 'none');
  syncRoadLamps();
  if (activeCategory) startBuildingHighlight(activeCategory);
}

/** Live-update F4 cartography when 2D/3D / theme toggles (no style reload). */
function refreshBuildingTheme() {
  if (!map) return;
  const color = buildingFillColor();
  const extrusionOpacity = buildingExtrusionOpacity();
  const fillOpacity = buildingFillOpacity();
  const extrusionColor = buildingExtrusionColorExpr();
  if (map.getLayer('buildings-3d')) {
    map.setPaintProperty('buildings-3d', 'fill-extrusion-color', extrusionColor);
    map.setPaintProperty('buildings-3d', 'fill-extrusion-opacity', extrusionOpacity);
  }
  if (map.getLayer('buildings-3d-glow')) {
    map.setLayoutProperty('buildings-3d-glow', 'visibility', buildingGlowLayerVisible() ? 'visible' : 'none');
    map.setPaintProperty('buildings-3d-glow', 'fill-extrusion-color', buildingGlowColorExpr());
    map.setPaintProperty('buildings-3d-glow', 'fill-extrusion-opacity', buildingGlowOpacity());
    map.setPaintProperty('buildings-3d-glow', 'fill-extrusion-height', buildingGlowHeightExpr());
    map.setPaintProperty('buildings-3d-glow', 'fill-extrusion-base', buildingGlowBaseExpr());
  }
  if (map.getLayer('buildings-fill')) {
    map.setPaintProperty('buildings-fill', 'fill-color', color);
    map.setPaintProperty('buildings-fill', 'fill-opacity', fillOpacity);
  }
  if (map.getLayer('buildings-outline-casing')) {
    map.setPaintProperty('buildings-outline-casing', 'line-color', buildingOutlineCasingColor());
    map.setPaintProperty('buildings-outline-casing', 'line-width', buildingOutlineCasingWidth());
  }
  if (map.getLayer('buildings-outline')) {
    map.setPaintProperty('buildings-outline', 'line-color', buildingOutlineColor());
    map.setPaintProperty('buildings-outline', 'line-width', buildingOutlineWidth());
    map.setPaintProperty('buildings-outline', 'line-opacity', buildingOutlineOpacity());
  }
  if (map.getLayer('areas-fill')) {
    map.setPaintProperty('areas-fill', 'fill-opacity', areaFillOpacity());
  }
  if (map.getLayer('berms-fill')) {
    map.setPaintProperty('berms-fill', 'fill-color', bermFillColor());
    map.setPaintProperty('berms-fill', 'fill-opacity', bermFillOpacity());
  }
  if (map.getLayer('berms-outline')) {
    map.setPaintProperty('berms-outline', 'line-color', bermOutlineColor());
  }
  refreshMapLabelPaint();
  syncRoadLamps();
}

function refreshMapLabelPaint() {
  if (!map) return;
  const p = labelPaint();
  for (const id of ['buildings-labels', 'areas-labels', 'campus-roads-labels', 'places-labels']) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, 'text-color', p['text-color']);
    map.setPaintProperty(id, 'text-halo-color', p['text-halo-color']);
    map.setPaintProperty(id, 'text-halo-width', p['text-halo-width']);
  }
  syncLandmarkLabels();
  if (typeof Landmarks3D !== 'undefined' && typeof Landmarks3D.syncSceneLighting === 'function') {
    Landmarks3D.syncSceneLighting(isDark);
  }
}

const LAYERS = { buildings: true, roads: true, markers: true };

// Lower = higher label priority when markers collide (symbol-sort-key). Keeps
// the dense perimeter office/utility codes from crowding out real destinations.
// Gates / parking / transport are bumped into tier 1 when the curated set is
// small and people orient by those landmarks at campus-overview zoom.
const LABEL_PRIORITY = {
  medical: 0, dining: 0, bank: 0,
  academic: 1, sports: 1, hostel: 1, place_of_worship: 1,
  gate: 1, parking: 1, transport: 1,
  recreation: 2,
  administrative: 4, utility: 4, residential: 4, other: 5,
};

// Bare unit codes (W-1, E-15, B-3, etc.) — always lowest priority no matter
// what category they got tagged with, so they only label at high zoom and
// never crowd out real destinations. A name with a space, dot, or any letter
// run beyond the prefix counts as a real name.
const BARE_CODE_RE = /^[A-Za-z]{1,4}[-\s]?\d+[A-Za-z]?$/;

function computeLabelPriority(props) {
  const name = (props.name || '').trim();
  if (BARE_CODE_RE.test(name)) return 5;
  return LABEL_PRIORITY[props.category] ?? 5;
}

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
let _followRequested = false;        // user explicitly asked to follow (locate tap); OFF by default
let watchId = null;                  // geolocation watchPosition handle
let isDark = false, is3D = false, isSatellite = false;
let nightModeManual = false;         // true after user taps the dark-mode button
let _nightWatchTimer = null;
const CAMPUS_TZ = 'Asia/Kolkata';
let labeledNames = new Set();
let searchTimeout;
let currentRoute = null;
let navDestination = null;           // preserved so re-route works after sheet close
let navEntrance = null;              // registered entrance gate (+floor) of the destination, if any
let navigationActive = false;
let navInstructionIndex = 0;
// True only when the route origin is the user's live GPS position ("Your
// location"). When the user picked a fixed start that isn't where they are, nav
// must NOT follow their GPS, flag them off-route, or reroute from their real
// position — it's a static preview of the chosen A→B route.
let navFollowsUser = false;
let immersiveNav = false;            // true while in Google-Maps-style immersive 3D nav view
let preNavCameraState = null;        // saved pitch/bearing/zoom/center to restore on End
let pre3DState = false;              // saved is3D flag so we can restore on End
let _lastFadeKey = '';               // memo so we don't reapply identical occluder sets each GPS tick

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
// Slim top banner when the network drops — tiles and data can't load offline,
// so this explains a half-rendered map rather than leaving the user guessing.
function setupOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  let hideTimer = null;
  const apply = () => {
    if (navigator.onLine === false) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      banner.hidden = false;
      // next frame so the entry transition runs
      requestAnimationFrame(() => banner.classList.add('visible'));
    } else {
      banner.classList.remove('visible');
      hideTimer = setTimeout(() => { banner.hidden = true; }, 400);
    }
  };
  window.addEventListener('online', apply);
  window.addEventListener('offline', apply);
  apply();
}

async function init() {
  isDark = isCampusNight();
  if (isDark) document.documentElement.setAttribute('data-theme', 'dark');

  registerSatelliteOffsetProtocol();

  // Device-adaptive rendering: cap the render resolution (and pitch) per the
  // detected graphics tier so budget phones don't try to shade millions of
  // extra pixels. Falls back to sensible defaults if perf-tier.js didn't load.
  const _perf = window.PerfTier || { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), maxPitch: 60 };

  map = new maplibregl.Map({
    container: 'map',
    style: getMapStyle(),
    center: CAMPUS_CENTER,
    zoom: CAMPUS_ZOOM,
    maxBounds: CAMPUS_BOUNDS,
    minZoom: 13,
    maxZoom: 19,
    maxPitch: _perf.maxPitch,
    pixelRatio: _perf.pixelRatio,
    pitch: 0,
    bearing: 0,
    attributionControl: false,
    pitchWithRotate: true,
  });

  try { window.__map = map; } catch (e) {}
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 150, unit: 'metric' }), 'bottom-left');

  setupOfflineBanner();

  map.dragRotate.enable();

  // Any manual gesture — pan, zoom, rotate, or pitch — hands control back to
  // the user: exit auto-follow so the camera stops snapping back to the GPS
  // fix (and, in nav, stops re-forcing zoom/pitch every frame), letting the
  // user freely adjust and zoom while the puck still tracks live position.
  // The `originalEvent` guard is essential: the follow easeTo itself moves /
  // rotates / zooms the camera and fires these same events, but WITHOUT an
  // originalEvent — so only genuine user input cancels follow.
  function _exitFollowOnGesture(e) {
    if (e && e.originalEvent == null) return;   // programmatic camera move
    if (autoFollow) setAutoFollow(false);
    // In immersive nav, surface a Re-centre chip so the user can snap back
    if (immersiveNav) showRecenterBtn();
  }
  map.on('dragstart', _exitFollowOnGesture);
  map.on('zoomstart', _exitFollowOnGesture);
  map.on('rotatestart', _exitFollowOnGesture);
  map.on('pitchstart', _exitFollowOnGesture);

  map.on('error', (e) => console.error('MapLibre error:', e.error?.message || e));

  if (window.PerfTier && typeof PerfTier.attachWatchdog === 'function') {
    PerfTier.attachWatchdog(map);
  }

  map.on('load', async () => {
    await loadMapData();
    hideSplash();
    setupEventListeners();
    handleDeepLink();
    requestUserLocation();
    scheduleLandmarks3DPrewarm();
    syncMapBodyClasses();
    updateBaseMapButtons();
    scheduleAutoNightWatch();
  });
}

// ============================================================
// Satellite imagery offset correction
// ============================================================
// Esri World Imagery is georeferenced a few metres off from our OSM-derived
// footprints / 3D models in this region, so the raw imagery doesn't line up
// with the buildings. MapLibre can't nudge a raster XYZ layer, so we serve the
// imagery through a custom protocol that re-requests it from a bbox shifted by
// `satOffset` (Web-Mercator/EPSG:3857 metres added to the requested bbox).
// Calibrate live with Alt+Shift+Arrows in satellite view (see keydown handler).
// Calibrated against OSM building footprints + roads (Esri imagery sat ~6 m
// north of our data here); EPSG:3857 metres added to the requested bbox.
const SAT_OFFSET_DEFAULT = { x: 0, y: 7 };
const SAT_OFFSET_KEY = 'iitj_sat_offset';
const SAT_MERC_HALF = 20037508.342789244; // half the Web-Mercator world span (m)

let satOffset = (function loadSatOffset() {
  try {
    const s = JSON.parse(localStorage.getItem(SAT_OFFSET_KEY));
    if (s && isFinite(s.x) && isFinite(s.y)) return { x: s.x, y: s.y };
  } catch (e) {}
  return { ...SAT_OFFSET_DEFAULT };
})();

function saveSatOffset() {
  try { localStorage.setItem(SAT_OFFSET_KEY, JSON.stringify(satOffset)); } catch (e) {}
}

// The offset is baked into the tile URL so changing it busts MapLibre's cache
// and the (stateless) protocol can read it back per-request.
function satelliteTilesUrl() {
  return `esrioffset://${satOffset.x}/${satOffset.y}/{z}/{x}/{y}`;
}

let _satProtocolRegistered = false;
function registerSatelliteOffsetProtocol() {
  if (_satProtocolRegistered) return;
  _satProtocolRegistered = true;
  maplibregl.addProtocol('esrioffset', async (params, abortController) => {
    const p = params.url.replace('esrioffset://', '').split('/');
    const ox = parseFloat(p[0]) || 0, oy = parseFloat(p[1]) || 0;
    const z = +p[2], x = +p[3], y = +p[4];
    const span = (SAT_MERC_HALF * 2) / Math.pow(2, z);
    const minx = -SAT_MERC_HALF + x * span + ox;
    const maxx = -SAT_MERC_HALF + (x + 1) * span + ox;
    const maxy =  SAT_MERC_HALF - y * span + oy;
    const miny =  SAT_MERC_HALF - (y + 1) * span + oy;
    const url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export'
      + `?bbox=${minx},${miny},${maxx},${maxy}`
      + '&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&transparent=false&f=image';
    const resp = await fetch(url, { signal: abortController.signal });
    if (!resp.ok) throw new Error('Esri export failed: ' + resp.status);
    return { data: await resp.arrayBuffer() };
  });
}

// Re-create the satellite source/layer with the current offset so a calibration
// nudge takes effect immediately (kept at the bottom of the layer stack).
function refreshSatelliteTiles() {
  if (!map || !isSatellite) return;
  const id = 'satellite-tiles';
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  map.addSource(id, {
    type: 'raster',
    tiles: [satelliteTilesUrl()],
    tileSize: 256,
    maxzoom: 19,
    attribution: '© Esri, Maxar, Earthstar Geographics, GIS User Community'
  });
  const firstLayer = (map.getStyle().layers[0] || {}).id;
  map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 1 } }, firstLayer);
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
          tiles: [satelliteTilesUrl()],
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
  'campus-basemask',
  'greens-fill',
  'campus-roads-restricted',
  'campus-roads-service-casing', 'campus-roads-casing',
  'campus-roads-service', 'campus-roads-line', 'campus-roads-narrow',
  'campus-roads-ped', 'campus-roads-walkway', 'campus-roads-cycle', 'campus-roads-mixed',
  'campus-roads-hit', 'campus-roads-labels',
  'road-lamps-glow', 'road-lamps-pole', 'road-lamps',
  'areas-fill', 'areas-outline', 'areas-labels',
  'berms-fill', 'berms-outline',
  'buildings-fill', 'buildings-outline-casing', 'buildings-outline', 'buildings-3d-glow', 'buildings-3d', 'buildings-labels',
  'buildings-highlight-3d-glow', 'buildings-highlight-3d',
  'buildings-highlight-fill', 'buildings-highlight-outline',
  'places-circles', 'places-labels',
];
const OVERLAY_SOURCE_IDS = [
  'campus-greens', 'campus-roads', 'road-lamps', 'named-areas', 'area-labels-src', 'berms', 'buildings', 'places-points',
];
const ROAD_LAYER_IDS = [
  'campus-roads-restricted',
  'campus-roads-service-casing', 'campus-roads-casing',
  'campus-roads-service', 'campus-roads-line', 'campus-roads-narrow',
  'campus-roads-ped', 'campus-roads-walkway', 'campus-roads-cycle', 'campus-roads-mixed',
  'campus-roads-hit', 'campus-roads-labels',
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
        addBermsLayer(IITJData.getBerms());
        addBuildingsLayer(buildingsRes);
        addPlacesLayer(placesRes.features || []);
        ensureLandmarkLabelsLayer();
        if (currentRoute) {
          const dest = navDestination ? [navDestination.lng, navDestination.lat] : null;
          drawRoute(currentRoute.geometry, /*animate=*/false, dest);
        }

        map.jumpTo({ center: savedCenter, zoom: savedZoom, pitch: savedPitch, bearing: savedBearing });

        if (is3D && !isSatellite) {
          applyBuildingViewMode();
          showLandmarks3D();
        } else {
          applyBuildingViewMode();
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

    // Build the ambient road-snap index once, off the same FC the layer renders
    try { RoadSnap.build(roadsRes); } catch (e) { console.warn('[RoadSnap] build failed:', e); }

    // Names already labeled on buildings/areas/landmark layers — exclude from point markers
    labeledNames = buildLabeledNames(areasRes, buildingsRes);

    addGreensLayer(IITJData.getGreens());
    addRoadsLayer(roadsRes);
    addAreasLayer(areasRes);
    addBermsLayer(IITJData.getBerms());
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
    ...ROAD_LAYER_IDS,
    'buildings-fill', 'buildings-outline-casing', 'buildings-outline', 'buildings-3d', 'buildings-labels',
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
        // Exact F4map olive-green palette (grass #B7C088, forest #A4AF6A);
        // scrub/pitch interpolated between the two.
        'forest', isDark ? '#36502f' : '#a4af6a',
        'scrub',  isDark ? '#33502f' : '#aeb87e',
        'pitch',  isDark ? '#2f4a36' : '#b4be83',
        /* grass */ isDark ? '#2f4632' : '#b7c088'
      ],
      // Full opacity in light mode so the grass shows as the true F4map hue
      // rather than being lightened by the cream ground bleeding through.
      'fill-opacity': isSatellite ? 0 : (isDark ? 0.5 : 1),
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

  // Base-map mask — the CARTO raster bakes light-grey building footprints into
  // its tiles, which then "ghost" out from under our 3D models (CARTO's
  // generalised footprints are offset/larger than our OSM polygons, so a
  // per-building mask can't catch them). Painting the campus area polygons in
  // the exact CARTO land colour, just above the raster, hides every baked-in
  // footprint inside campus while leaving the basemap untouched off-campus.
  // Hidden on satellite (we want the imagery there).
  if (!isSatellite) {
    const landColor = isDark ? '#26282a' : '#f2efe7';
    map.addLayer({
      id: 'campus-basemask',
      type: 'fill',
      source: 'named-areas',
      paint: { 'fill-color': landColor, 'fill-opacity': 1 },
    }, map.getLayer('greens-fill') ? 'greens-fill' : undefined);
  }

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
        'parking',    '#bae6fd',
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
        'parking',    '#0369a1',
        '#6b7280'
      ],
      'line-width': 1,
      'line-opacity': areaOutlineOpacity(),
      'line-dasharray': [3, 2]
    }
  });

  // Category highlight (active filter chip) — glowing fill + border for the
  // matching areas. Parking, recreation and most sports live as area polygons,
  // not buildings, so the building-highlight layers never touch them; without
  // these, clicking those chips would visibly do nothing. Hidden by default.
  map.addLayer({
    id: 'areas-highlight-fill',
    type: 'fill',
    source: 'named-areas',
    filter: NEVER_BUILDING_FILTER,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': categoryHighlightColorExpr(),
      'fill-opacity': 0.5,
    }
  });

  map.addLayer({
    id: 'areas-highlight-outline',
    type: 'line',
    source: 'named-areas',
    filter: NEVER_BUILDING_FILTER,
    layout: { visibility: 'none' },
    paint: {
      'line-color': categoryHighlightColorExpr(),
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 4.5, 19, 6],
      'line-opacity': 1.0,
      'line-blur': 1.2,
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
  const navIn = (classes) => ['match', ['get', 'navigation_class'], classes, true, false];
  const typeIn = (types) => ['match', ['get', 'highway_type'], types, true, false];
  const propIn = (prop, values) => ['match', ['get', prop], values, true, false];

  const solidVehicleFilter = navIn([
    'major_vehicle_road', 'vehicle_connector',
    'campus_main_road', 'campus_standard_road',
    'local_through_road', 'local_street', 'vehicle_road',
  ]);
  const serviceFilter = navIn(['campus_service_road', 'campus_service_connector']);
  const narrowFilter = navIn(['narrow_service_road', 'service_access']);
  const footwayFilter = typeIn(['footway']);
  const cycleFilter = typeIn(['cycleway']);
  const mixedUseFilter = ['all',
    ['!', cycleFilter],
    ['any',
      navIn(['cycle_pedestrian']),
      ['all',
        typeIn(['path', 'footway', 'pedestrian']),
        ['any',
          propIn('bicycle', ['yes', 'designated', 'permissive']),
          propIn('cycleway', ['lane', 'track', 'shared_lane']),
        ],
      ],
    ],
  ];
  const walkwayFilter = ['all',
    navIn(['pedestrian_path', 'stairs']),
    ['!', footwayFilter],
    ['!', mixedUseFilter],
  ];
  const pedestrianFilter = ['any', footwayFilter, walkwayFilter, cycleFilter, mixedUseFilter];
  const restrictedFilter = ['all',
    ['!', pedestrianFilter],
    ['any',
      navIn(['restricted_vehicle', 'unpaved_service', 'maintenance_track', 'ambiguous_road', 'non_vehicle_route', 'unknown']),
      ['==', ['get', 'vehicle_access'], 'no'],
    ],
  ];
  const serviceAndNarrowFilter = ['any', serviceFilter, narrowFilter];

  if (map.getSource('campus-roads')) {
    map.getSource('campus-roads').setData(data);
    addRoadLampLayers(data);
    return;
  }

  map.addSource('campus-roads', { type: 'geojson', data });

  // Broader road geometry with a wide low-zoom floor: the z13 stop is kept
  // deliberately large so the campus network stays clearly visible when fully
  // zoomed out (maxBounds caps you near z14), not just up close.
  const vehicleSurfaceW = ['interpolate', ['linear'], ['zoom'],
    13, ['match', ['get', 'navigation_class'],
      ['major_vehicle_road'], 7.6,
      ['vehicle_connector'], 6.4,
      ['campus_main_road', 'local_through_road'], 6.1,
      ['campus_standard_road', 'local_street', 'vehicle_road'], 4.5,
      4.1],
    16, ['match', ['get', 'navigation_class'],
      ['major_vehicle_road'], 14.5,
      ['vehicle_connector'], 11.8,
      ['campus_main_road', 'local_through_road'], 11.5,
      ['campus_standard_road', 'local_street', 'vehicle_road'], 8.6,
      8.0],
    19, ['match', ['get', 'navigation_class'],
      ['major_vehicle_road'], 25,
      ['vehicle_connector'], 20.5,
      ['campus_main_road', 'local_through_road'], 21,
      ['campus_standard_road', 'local_street', 'vehicle_road'], 15.5,
      14],
  ];
  const vehicleCasingW = ['interpolate', ['linear'], ['zoom'],
    13, ['match', ['get', 'navigation_class'],
      ['major_vehicle_road'], 11.4,
      ['vehicle_connector'], 10.0,
      ['campus_main_road', 'local_through_road'], 9.7,
      ['campus_standard_road', 'local_street', 'vehicle_road'], 7.7,
      7.2],
    16, ['match', ['get', 'navigation_class'],
      ['major_vehicle_road'], 20.5,
      ['vehicle_connector'], 17.2,
      ['campus_main_road', 'local_through_road'], 17.0,
      ['campus_standard_road', 'local_street', 'vehicle_road'], 13.6,
      12.8],
    19, ['match', ['get', 'navigation_class'],
      ['major_vehicle_road'], 32,
      ['vehicle_connector'], 27,
      ['campus_main_road', 'local_through_road'], 27.5,
      ['campus_standard_road', 'local_street', 'vehicle_road'], 21.5,
      20],
  ];
  // Service roads now start at z13 (was z14) so they don't vanish when zoomed
  // out — they're a big part of the internal campus network.
  const serviceSurfaceW = ['interpolate', ['linear'], ['zoom'],
    13, ['match', ['get', 'navigation_class'], 'campus_service_road', 2.6, 'campus_service_connector', 2.0, 1.8],
    16, ['match', ['get', 'navigation_class'], 'campus_service_road', 5.8, 'campus_service_connector', 4.4, 3.9],
    19, ['match', ['get', 'navigation_class'], 'campus_service_road', 10, 'campus_service_connector', 8.0, 7.0],
  ];
  const serviceCasingW = ['interpolate', ['linear'], ['zoom'],
    13, ['match', ['get', 'navigation_class'], 'campus_service_road', 4.8, 'campus_service_connector', 4.0, 3.7],
    16, ['match', ['get', 'navigation_class'], 'campus_service_road', 9.2, 'campus_service_connector', 7.6, 6.9],
    19, ['match', ['get', 'navigation_class'], 'campus_service_road', 15.5, 'campus_service_connector', 12.8, 11.6],
  ];
  const narrowW = ['interpolate', ['linear'], ['zoom'],
    15, ['match', ['get', 'navigation_class'], 'narrow_service_road', 1.2, 'service_access', 1.0, 0.9],
    17, ['match', ['get', 'navigation_class'], 'narrow_service_road', 2.6, 'service_access', 2.1, 1.9],
    19, ['match', ['get', 'navigation_class'], 'narrow_service_road', 4.5, 'service_access', 3.7, 3.3],
  ];
  const pathW = ['interpolate', ['linear'], ['zoom'], 15, 0.8, 17, 1.7, 19, 3.1];
  const cycleW = ['interpolate', ['linear'], ['zoom'], 15, 1.0, 17, 2.2, 19, 3.8];
  const restrictedW = ['interpolate', ['linear'], ['zoom'], 15, 1.0, 17, 2.0, 19, 3.6];

  // F4map roads: darker grey asphalt with a crisp light casing that matches the
  // cream ground (#f2efe7) — the casing reads as a clear boundary, not a soft
  // gradient. Dark + satellite keep their own high-contrast palettes.
  const vehicleCasingColor = isSatellite
    ? 'rgba(0,0,0,0.62)'
    : (isDark
      ? '#0f172a'
      : '#ebe8e0');
  const vehicleSurfaceColor = isSatellite
    ? ['match', ['get', 'navigation_class'],
      ['major_vehicle_road', 'vehicle_connector'], '#ffd166',
      ['campus_main_road', 'local_through_road'], '#ffe8a3',
      '#ffffff']
    : (isDark
      ? ['match', ['get', 'navigation_class'],
        ['major_vehicle_road', 'vehicle_connector'], '#6b6358',
        ['campus_main_road', 'local_through_road'], '#5c6470',
        '#4a5568']
      : ['match', ['get', 'navigation_class'],
        ['major_vehicle_road', 'vehicle_connector'], '#525252',
        ['campus_main_road', 'local_through_road'], '#585858',
        '#5e5e5e']);
  const serviceCasingColor = isSatellite ? 'rgba(0,0,0,0.52)' : (isDark ? '#111827' : '#ebe8e0');
  const serviceSurfaceColor = isSatellite
    ? ['match', ['get', 'navigation_class'], 'campus_service_road', '#f8fafc', '#d9e2ec']
    : (isDark
      ? ['match', ['get', 'navigation_class'], 'campus_service_road', '#64748b', '#526174']
      : ['match', ['get', 'navigation_class'], 'campus_service_road', '#636363', '#6a6a6a']);
  const narrowColor = isSatellite ? '#ffffff' : (isDark ? '#94a3b8' : '#9c9c9c');
  const footwayColor = isSatellite ? '#9ff5bd' : (isDark ? '#5ee589' : '#1f9d55');
  const walkwayColor = isSatellite ? '#7ddce5' : (isDark ? '#22d3ee' : '#078a8f');
  const cycleColor = isSatellite ? '#8ec5ff' : (isDark ? '#60a5fa' : '#1a73e8');
  const mixedColor = isSatellite ? '#c5f06a' : (isDark ? '#a3e635' : '#65a30d');
  const restrictedColor = isSatellite
    ? ['match', ['get', 'navigation_class'], 'maintenance_track', '#d6a15f', 'unpaved_service', '#f6ad55', '#ff7a7a']
    : (isDark
      ? ['match', ['get', 'navigation_class'], 'maintenance_track', '#b08968', 'unpaved_service', '#d97706', '#f87171']
      : ['match', ['get', 'navigation_class'], 'maintenance_track', '#94613a', 'unpaved_service', '#b45309', '#dc2626']);

  map.addLayer({
    id: 'campus-roads-restricted',
    type: 'line',
    source: 'campus-roads',
    minzoom: 15,
    filter: restrictedFilter,
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: roadVis },
    paint: {
      'line-color': restrictedColor,
      'line-width': restrictedW,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, isSatellite ? 0.68 : 0.45, 17, isSatellite ? 0.82 : 0.68, 19, 0.86],
      'line-dasharray': [1.2, 1.2]
    }
  });

  map.addLayer({
    id: 'campus-roads-service-casing',
    type: 'line',
    source: 'campus-roads',
    minzoom: 13,
    filter: serviceAndNarrowFilter,
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: roadVis },
    paint: {
      'line-color': serviceCasingColor,
      'line-width': serviceCasingW,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, isSatellite ? 0.48 : 0.32, 16, isSatellite ? 0.72 : 0.58, 19, isSatellite ? 0.86 : 0.72]
    }
  });

  map.addLayer({
    id: 'campus-roads-casing',
    type: 'line',
    source: 'campus-roads',
    filter: solidVehicleFilter,
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: roadVis },
    paint: {
      'line-color': vehicleCasingColor,
      'line-width': vehicleCasingW,
      'line-opacity': ['match', ['get', 'navigation_class'],
        ['major_vehicle_road', 'vehicle_connector'], isSatellite ? 0.92 : 1,
        ['campus_main_road', 'local_through_road'], isSatellite ? 0.86 : 1,
        isSatellite ? 0.78 : 1]
    }
  });

  map.addLayer({
    id: 'campus-roads-service',
    type: 'line',
    source: 'campus-roads',
    minzoom: 13,
    filter: serviceFilter,
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: roadVis },
    paint: {
      'line-color': serviceSurfaceColor,
      'line-width': serviceSurfaceW,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, isSatellite ? 0.68 : 0.45, 16, isSatellite ? 0.88 : 0.78, 19, isSatellite ? 0.95 : 0.9]
    }
  });

  map.addLayer({
    id: 'campus-roads-line',
    type: 'line',
    source: 'campus-roads',
    filter: solidVehicleFilter,
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: roadVis },
    paint: {
      'line-color': vehicleSurfaceColor,
      'line-width': vehicleSurfaceW,
      'line-opacity': ['match', ['get', 'navigation_class'],
        ['major_vehicle_road', 'vehicle_connector'], isSatellite ? 0.96 : 1,
        ['campus_main_road', 'local_through_road'], isSatellite ? 0.92 : 0.96,
        isSatellite ? 0.88 : 0.94]
    }
  });

  map.addLayer({
    id: 'campus-roads-narrow',
    type: 'line',
    source: 'campus-roads',
    minzoom: 15,
    filter: narrowFilter,
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: roadVis },
    paint: {
      'line-color': narrowColor,
      'line-width': narrowW,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, isSatellite ? 0.68 : 0.42, 17, isSatellite ? 0.86 : 0.72, 19, isSatellite ? 0.92 : 0.82],
      'line-dasharray': [1.4, 1.1]
    }
  });

  map.addLayer({
    id: 'campus-roads-ped',
    type: 'line',
    source: 'campus-roads',
    minzoom: 15,
    filter: footwayFilter,
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: roadVis },
    paint: {
      'line-color': footwayColor,
      'line-width': pathW,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, isSatellite ? 0.72 : 0.5, 17, isSatellite ? 0.86 : 0.78, 19, 0.92],
      'line-dasharray': [1.0, 1.2]
    }
  });

  map.addLayer({
    id: 'campus-roads-walkway',
    type: 'line',
    source: 'campus-roads',
    minzoom: 15,
    filter: walkwayFilter,
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: roadVis },
    paint: {
      'line-color': walkwayColor,
      'line-width': pathW,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, isSatellite ? 0.7 : 0.48, 17, isSatellite ? 0.84 : 0.74, 19, 0.9],
      'line-dasharray': [0.4, 1.4]
    }
  });

  map.addLayer({
    id: 'campus-roads-cycle',
    type: 'line',
    source: 'campus-roads',
    minzoom: 15,
    filter: cycleFilter,
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: roadVis },
    paint: {
      'line-color': cycleColor,
      'line-width': cycleW,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, isSatellite ? 0.8 : 0.62, 17, isSatellite ? 0.92 : 0.84, 19, 0.96],
      'line-dasharray': [2.4, 1.0]
    }
  });

  map.addLayer({
    id: 'campus-roads-mixed',
    type: 'line',
    source: 'campus-roads',
    minzoom: 15,
    filter: mixedUseFilter,
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: roadVis },
    paint: {
      'line-color': mixedColor,
      'line-width': cycleW,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, isSatellite ? 0.76 : 0.58, 17, isSatellite ? 0.9 : 0.82, 19, 0.94],
      'line-dasharray': [1.2, 0.7, 3.0, 0.7]
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

  addRoadLampLayers(data);
}

// ============================================================
// Road lamps — warm pools of light along drivable roads at night
// ============================================================
// Every drawn campus road gets lamps at night — service connectors were the
// biggest gap (most internal spurs were skipped by the old allow-list).
const ROAD_LAMP_SKIP_CLASSES = new Set(['unknown', 'non_vehicle_route']);

function shouldPlaceRoadLamps(props = {}) {
  if (props.lit === 'no') return false;
  const nc = props.navigation_class;
  if (!nc || ROAD_LAMP_SKIP_CLASSES.has(nc)) return false;
  return true;
}

function roadLampSpacingM(nc) {
  // Wider spacing — roughly half the lamp count vs the prior dense layout.
  if (nc === 'pedestrian_path' || nc === 'stairs') return 88;
  if (nc === 'cycle_pedestrian') return 80;
  if (nc === 'campus_service_connector' || nc === 'narrow_service_road' || nc === 'service_access') return 72;
  if (nc === 'major_vehicle_road' || nc === 'vehicle_connector' || nc === 'campus_main_road') return 68;
  return 74;
}

function segmentBearingDeg(lat1, lng1, lat2, lng2) {
  const dl = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180)
    - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function offsetPointM(lat, lng, bearingDeg, distM) {
  const br = bearingDeg * Math.PI / 180;
  const dLat = (distM * Math.cos(br) / 6371000) * (180 / Math.PI);
  const dLng = (distM * Math.sin(br) / (6371000 * Math.cos(lat * Math.PI / 180))) * (180 / Math.PI);
  return [lng + dLng, lat + dLat];
}

function buildRoadLampGeoJSON(roadsFc) {
  const features = [];
  const OFFSET_M = 3.8;
  for (const f of roadsFc.features || []) {
    if (!shouldPlaceRoadLamps(f.properties)) continue;
    const spacingM = roadLampSpacingM(f.properties?.navigation_class);
    let coords = null;
    if (f.geometry?.type === 'LineString') coords = f.geometry.coordinates;
    else if (f.geometry?.type === 'MultiLineString') {
      for (const line of f.geometry.coordinates) {
        _sampleLampLine(line, features, spacingM, OFFSET_M);
      }
      continue;
    }
    if (!coords || coords.length < 2) continue;
    _sampleLampLine(coords, features, spacingM, OFFSET_M);
  }
  return { type: 'FeatureCollection', features };
}

function _sampleLampLine(coords, features, spacingM, offsetM) {
  let carried = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const segM = haversine(lat1, lng1, lat2, lng2);
    if (segM < 1) continue;
    const bearing = segmentBearingDeg(lat1, lng1, lat2, lng2);
    const side = i % 2 === 0 ? 1 : -1;
    let d = spacingM - carried;
    while (d < segM) {
      const t = d / segM;
      const lat = lat1 + (lat2 - lat1) * t;
      const lng = lng1 + (lng2 - lng1) * t;
      const [olng, olat] = offsetPointM(lat, lng, bearing + 90 * side, offsetM);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [olng, olat] },
        properties: {},
      });
      d += spacingM;
    }
    carried = (carried + segM) % spacingM;
  }
}

function addRoadLampLayers(roadsData) {
  const lampData = buildRoadLampGeoJSON(roadsData);
  if (map.getSource('road-lamps')) {
    map.getSource('road-lamps').setData(lampData);
    syncRoadLamps();
    return;
  }
  map.addSource('road-lamps', { type: 'geojson', data: lampData });
  const lampVis = roadLampVisibility();
  const beforeLabels = map.getLayer('campus-roads-labels') ? 'campus-roads-labels' : undefined;

  map.addLayer({
    id: 'road-lamps-glow',
    type: 'circle',
    source: 'road-lamps',
    minzoom: 13,
    layout: { visibility: lampVis },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.2, 14, 2.8, 17, 5.5, 19, 8],
      'circle-color': '#ffe6a3',
      'circle-opacity': 0.22,
      'circle-blur': 0.9,
    },
  }, beforeLabels);

  map.addLayer({
    id: 'road-lamps-pole',
    type: 'circle',
    source: 'road-lamps',
    minzoom: 15,
    layout: { visibility: lampVis },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 0.7, 17, 1.4, 19, 2],
      'circle-color': '#64748b',
      'circle-opacity': 0.85,
    },
  }, beforeLabels);

  map.addLayer({
    id: 'road-lamps',
    type: 'circle',
    source: 'road-lamps',
    minzoom: 13,
    layout: { visibility: lampVis },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 14, 1.0, 17, 1.8, 19, 2.4],
      'circle-color': '#fff8e1',
      'circle-opacity': 0.72,
      'circle-stroke-width': 0.4,
      'circle-stroke-color': '#fde68a',
    },
  }, beforeLabels);
}

function syncRoadLamps() {
  if (!map) return;
  const vis = roadLampVisibility();
  for (const id of ['road-lamps-glow', 'road-lamps-pole', 'road-lamps']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  }
}

// ============================================================
// Berms Layer: perimeter wave + landscape berm footprints (2D only)
// ============================================================
function addBermsLayer(data) {
  if (!data || !data.features || !data.features.length) return;

  if (map.getSource('berms')) {
    map.getSource('berms').setData(data);
    return;
  }

  map.addSource('berms', { type: 'geojson', data });
  const polyFilter = ['==', ['geometry-type'], 'Polygon'];
  const beforeId = map.getLayer('buildings-fill') ? 'buildings-fill' : undefined;

  map.addLayer({
    id: 'berms-fill',
    type: 'fill',
    source: 'berms',
    filter: polyFilter,
    layout: { visibility: bermLayerVisible() ? 'visible' : 'none' },
    paint: {
      'fill-color': bermFillColor(),
      'fill-opacity': bermFillOpacity(),
    },
  }, beforeId);

  map.addLayer({
    id: 'berms-outline',
    type: 'line',
    source: 'berms',
    filter: polyFilter,
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
      visibility: bermLayerVisible() ? 'visible' : 'none',
    },
    paint: {
      'line-color': bermOutlineColor(),
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.2, 17, 2, 19, 2.6],
      'line-opacity': isSatellite ? 0.7 : 0.95,
    },
  }, beforeId);
}

// ============================================================
// Buildings Layer: 2D fill + 3D extrusion + labels
// ============================================================
const NEVER_BUILDING_FILTER = ['==', ['literal', 1], 0];

function addBuildingsLayer(data) {
  if (map.getSource('buildings')) {
    map.getSource('buildings').setData(data);
    refreshBuildingTheme();
    applyBuildingViewMode();
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
    id: 'buildings-outline-casing',
    type: 'line',
    source: 'buildings',
    filter: polyFilter,
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
      visibility: (LAYERS.buildings && !is3D) ? 'visible' : 'none',
    },
    paint: {
      'line-color': buildingOutlineCasingColor(),
      'line-width': buildingOutlineCasingWidth(),
      'line-opacity': isSatellite ? 0.12 : (isDark ? 0.75 : 0.75),
    }
  });

  map.addLayer({
    id: 'buildings-outline',
    type: 'line',
    source: 'buildings',
    filter: polyFilter,
    layout: {
      'line-join': 'round',
      'line-cap': 'round',
      visibility: (LAYERS.buildings && !is3D) ? 'visible' : 'none',
    },
    paint: {
      'line-color': buildingOutlineColor(),
      'line-width': buildingOutlineWidth(),
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
      'fill-extrusion-color': buildingExtrusionColorExpr(),
      'fill-extrusion-height': buildingHeightExpr(),
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': buildingExtrusionOpacity(),
      'fill-extrusion-vertical-gradient': true,
    }
  });

  // Warm crown glow — sits above the wall mass at night (category-tinted).
  map.addLayer({
    id: 'buildings-3d-glow',
    type: 'fill-extrusion',
    source: 'buildings',
    filter: extrusionFilter,
    layout: { visibility: buildingGlowLayerVisible() ? 'visible' : 'none' },
    paint: {
      'fill-extrusion-color': buildingGlowColorExpr(),
      'fill-extrusion-height': buildingGlowHeightExpr(),
      'fill-extrusion-base': buildingGlowBaseExpr(),
      'fill-extrusion-opacity': buildingGlowOpacity(),
      'fill-extrusion-vertical-gradient': true,
    },
  });

  // Category pulse in 3D — bright extrusion on matching buildings (hidden by default).
  map.addLayer({
    id: 'buildings-highlight-3d',
    type: 'fill-extrusion',
    source: 'buildings',
    filter: NEVER_BUILDING_FILTER,
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': categoryHighlightColorExpr(),
      'fill-extrusion-height': buildingHeightExpr(),
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.62,
      'fill-extrusion-vertical-gradient': true,
    },
  });

  map.addLayer({
    id: 'buildings-highlight-3d-glow',
    type: 'fill-extrusion',
    source: 'buildings',
    filter: NEVER_BUILDING_FILTER,
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': categoryHighlightColorExpr(),
      'fill-extrusion-height': buildingGlowHeightExpr(),
      'fill-extrusion-base': buildingGlowBaseExpr(),
      'fill-extrusion-opacity': 0.36,
      'fill-extrusion-vertical-gradient': true,
    },
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

  // Highlight fill — glowing colour for the active category (2D only; hidden by default)
  map.addLayer({
    id: 'buildings-highlight-fill',
    type: 'fill',
    source: 'buildings',
    filter: NEVER_BUILDING_FILTER,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': categoryHighlightColorExpr(),
      'fill-opacity': 0.55,
    }
  });

  // Highlight outline — thick bright border (2D only; above fill)
  map.addLayer({
    id: 'buildings-highlight-outline',
    type: 'line',
    source: 'buildings',
    filter: NEVER_BUILDING_FILTER,
    layout: { visibility: 'none' },
    paint: {
      'line-color': categoryHighlightColorExpr(),
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 17, 4.5, 19, 6],
      'line-opacity': 1.0,
      'line-blur': 1.5,
    }
  });
}

// Returns a MapLibre match expression: category → vivid highlight colour
function categoryHighlightColorExpr() {
  return ['match', ['get', 'category'],
    'academic',       '#60a5fa',   // sky blue
    'hostel',         '#fb923c',   // bright orange
    'dining',         '#f87171',   // coral red
    'sports',         '#4ade80',   // mint green
    'medical',        '#f472b6',   // rose pink
    'gate',           '#818cf8',   // periwinkle
    'parking',        '#38bdf8',   // light cyan
    'utility',        '#94a3b8',   // slate
    'administrative', '#a78bfa',   // violet
    'transport',      '#2dd4bf',   // teal
    'recreation',     '#c084fc',   // purple
    'residential',    '#fbbf24',   // amber
    'bank',           '#f59e0b',   // gold
    'university',     '#60a5fa',
    '#818cf8'                      // fallback indigo
  ];
}

// ─── Category highlight / pulse ───────────────────────────────────────────────
let _pulseTimer = null;
let _pulseHigh = true;

function buildingHighlightUses3D() {
  return is3D && !isSatellite && LAYERS.buildings;
}

function buildingHighlight3dFilter(categoryId) {
  const polyFilter = ['all',
    ['==', ['geometry-type'], 'Polygon'],
    ['==', ['get', 'category'], categoryId],
  ];
  const replacedIds = (typeof Landmarks3D !== 'undefined' && Landmarks3D.replacedBuildingIds)
    ? Landmarks3D.replacedBuildingIds() : [];
  return replacedIds.length
    ? ['all', polyFilter, ['!', ['in', ['get', 'osm_id'], ['literal', replacedIds]]]]
    : polyFilter;
}

function _pulseBuildingHighlight(high) {
  if (buildingHighlightUses3D()) {
    if (map.getLayer('buildings-highlight-3d')) {
      map.setPaintProperty('buildings-highlight-3d', 'fill-extrusion-opacity', high ? 0.62 : 0.22);
    }
    if (map.getLayer('buildings-highlight-3d-glow')) {
      map.setPaintProperty('buildings-highlight-3d-glow', 'fill-extrusion-opacity', high ? 0.36 : 0.10);
    }
    if (typeof Landmarks3D !== 'undefined') Landmarks3D.pulseCategoryHighlight(high);
    _pulseAreaHighlight(high);
    return;
  }
  if (map.getLayer('buildings-highlight-fill')) {
    map.setPaintProperty('buildings-highlight-fill', 'fill-opacity', high ? 0.48 : 0.16);
    map.setPaintProperty('buildings-highlight-outline', 'line-opacity', high ? 0.88 : 0.28);
    map.setPaintProperty('buildings-highlight-outline', 'line-width',
      ['interpolate', ['linear'], ['zoom'], 14, high ? 2 : 1, 17, high ? 4.5 : 2.5]);
  }
  _pulseAreaHighlight(high);
}

// Pulse the active-category area highlight (parking/recreation/sports areas).
function _pulseAreaHighlight(high) {
  if (!map.getLayer('areas-highlight-fill')) return;
  map.setPaintProperty('areas-highlight-fill', 'fill-opacity', high ? 0.5 : 0.16);
  map.setPaintProperty('areas-highlight-outline', 'line-opacity', high ? 0.95 : 0.3);
  map.setPaintProperty('areas-highlight-outline', 'line-width',
    ['interpolate', ['linear'], ['zoom'], 13, high ? 2 : 1, 17, high ? 4.5 : 2.5]);
}

function startBuildingHighlight(categoryId) {
  stopBuildingHighlight();
  if (!categoryId) return;

  const polyFilter = ['all',
    ['==', ['geometry-type'], 'Polygon'],
    ['==', ['get', 'category'], categoryId],
  ];
  const use3d = buildingHighlightUses3D();
  const setVis = (id, vis) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis); };

  if (use3d) {
    setVis('buildings-highlight-fill', 'none');
    setVis('buildings-highlight-outline', 'none');
    const f3d = buildingHighlight3dFilter(categoryId);
    if (map.getLayer('buildings-highlight-3d')) {
      map.setFilter('buildings-highlight-3d', f3d);
      map.setFilter('buildings-highlight-3d-glow', f3d);
      setVis('buildings-highlight-3d', 'visible');
      setVis('buildings-highlight-3d-glow', 'visible');
    }
    if (typeof Landmarks3D !== 'undefined') Landmarks3D.setCategoryHighlight(categoryId);
  } else {
    setVis('buildings-highlight-3d', 'none');
    setVis('buildings-highlight-3d-glow', 'none');
    if (map.getLayer('buildings-highlight-fill')) {
      map.setFilter('buildings-highlight-fill', polyFilter);
      map.setFilter('buildings-highlight-outline', polyFilter);
      setVis('buildings-highlight-fill', 'visible');
      setVis('buildings-highlight-outline', 'visible');
    }
    if (typeof Landmarks3D !== 'undefined') Landmarks3D.clearCategoryHighlight();
  }

  // Area-polygon categories (parking, recreation, most sports) live in the
  // named-areas source, so highlight them too — flat fill works in 2D and 3D.
  // Exclude the campus-boundary polygons (area_type=university): they're tagged
  // academic but span the whole campus, so highlighting them lit up everything.
  if (map.getLayer('areas-highlight-fill')) {
    const areaFilter = ['all', polyFilter, ['!=', ['get', 'area_type'], 'university']];
    map.setFilter('areas-highlight-fill', areaFilter);
    map.setFilter('areas-highlight-outline', areaFilter);
    setVis('areas-highlight-fill', 'visible');
    setVis('areas-highlight-outline', 'visible');
  }

  _pulseHigh = true;
  _pulseBuildingHighlight(_pulseHigh);
  _pulseTimer = setInterval(() => {
    _pulseHigh = !_pulseHigh;
    _pulseBuildingHighlight(_pulseHigh);
  }, 700);
}

function stopBuildingHighlight() {
  if (_pulseTimer) { clearInterval(_pulseTimer); _pulseTimer = null; }
  const setVis = (id, vis) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis); };
  if (map.getLayer('buildings-highlight-fill')) {
    map.setFilter('buildings-highlight-fill', NEVER_BUILDING_FILTER);
    map.setFilter('buildings-highlight-outline', NEVER_BUILDING_FILTER);
    map.setPaintProperty('buildings-highlight-fill', 'fill-opacity', 0.55);
    map.setPaintProperty('buildings-highlight-outline', 'line-opacity', 1.0);
    setVis('buildings-highlight-fill', 'none');
    setVis('buildings-highlight-outline', 'none');
  }
  if (map.getLayer('buildings-highlight-3d')) {
    map.setFilter('buildings-highlight-3d', NEVER_BUILDING_FILTER);
    map.setFilter('buildings-highlight-3d-glow', NEVER_BUILDING_FILTER);
    map.setPaintProperty('buildings-highlight-3d', 'fill-extrusion-opacity', 0.62);
    map.setPaintProperty('buildings-highlight-3d-glow', 'fill-extrusion-opacity', 0.36);
    setVis('buildings-highlight-3d', 'none');
    setVis('buildings-highlight-3d-glow', 'none');
  }
  if (map.getLayer('areas-highlight-fill')) {
    map.setFilter('areas-highlight-fill', NEVER_BUILDING_FILTER);
    map.setFilter('areas-highlight-outline', NEVER_BUILDING_FILTER);
    map.setPaintProperty('areas-highlight-fill', 'fill-opacity', 0.5);
    map.setPaintProperty('areas-highlight-outline', 'line-opacity', 1.0);
    setVis('areas-highlight-fill', 'none');
    setVis('areas-highlight-outline', 'none');
  }
  if (typeof Landmarks3D !== 'undefined') Landmarks3D.clearCategoryHighlight();
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
        ref:         f.properties.ref || '',
        category:    f.properties.category || 'other',
        description: f.properties.description || '',
        source:      f.properties.source || 'osm',
        is_proposed: f.properties.is_proposed || false,
        // Collision priority: named destinations beat bare admin/office codes.
        label_priority: computeLabelPriority(f.properties),
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

  // Per-priority radius — top destinations get a slightly larger dot, low-
  // priority codes shrink to small markers so they read as accurate points
  // rather than the blob of fat dots that crowded the perimeter before.
  // Dots grow noticeably with zoom-in so high-zoom tap targets are easy to
  // hit on touch devices (≥ ~22 px diameter from z18).
  const radiusFor = (zSmall, zBig) => [
    'case',
    ['<=', ['get', 'label_priority'], 1], zBig,
    ['<=', ['get', 'label_priority'], 3], (zSmall + zBig) / 2,
    zSmall
  ];

  map.addLayer({
    id: 'places-circles',
    type: 'circle',
    source: 'places-points',
    layout: { visibility: LAYERS.markers ? 'visible' : 'none' },
    paint: {
      'circle-color': colorExpr,
      'circle-radius': ['interpolate', ['exponential', 1.4], ['zoom'],
        13, radiusFor(1.5, 2.5),
        15, radiusFor(2.5, 3.5),
        17, radiusFor(5, 7),
        19, radiusFor(8, 11),
        21, radiusFor(11, 15)
      ],
      'circle-stroke-width': isSatellite ? 0 : ['interpolate', ['linear'], ['zoom'], 13, 0.8, 16, 1.2, 19, 2],
      'circle-stroke-color': '#ffffff',
      'circle-opacity': markerCircleOpacity(),
    }
  });

  // Text labels — progressive disclosure by priority so the campus overview
  // stays readable while every code is still surfaced once you zoom in.
  //   priority 0–1 (food/medical/bank/academic/hostel/sports)       from z15
  //   priority 2–3 (recreation/transport/parking/gate)              from z16
  //   priority 4   (admin/utility with a real descriptive name)     from z17
  //   priority 5   (bare unit codes: W-1, E-15, indoor labs…)       from z18
  map.addLayer({
    id: 'places-labels',
    type: 'symbol',
    source: 'places-points',
    minzoom: 15,
    layout: {
      'text-field': ['step', ['zoom'],
        // z 15..16: only the top two priority bands
        ['case', ['<=', ['get', 'label_priority'], 1], ['get', 'name'], ''],
        16,
        ['case', ['<=', ['get', 'label_priority'], 3], ['get', 'name'], ''],
        17,
        ['case', ['<=', ['get', 'label_priority'], 4], ['get', 'name'], ''],
        18,
        ['get', 'name']
      ],
      'symbol-sort-key': ['get', 'label_priority'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 15, 9, 17, 11, 19, 13],
      'text-offset': [0, 0.85],
      'text-anchor': 'top',
      'text-max-width': 9,
      'text-font': ['Open Sans Regular'],
      'text-allow-overlap': false,
      'text-optional': true,
      'text-padding': 3,
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
    applyBuildingViewMode();
    // Custom 3D landmark models are only shown on the vector base map, not
    // over satellite imagery (matches buildings-3d behaviour). Defer one frame
    // so extrusion visibility + pitch animation start before the custom layer
    // attaches (scene is usually pre-built by scheduleLandmarks3DPrewarm).
    if (!isSatellite) {
      requestAnimationFrame(() => { if (is3D) showLandmarks3D(); });
    } else if (typeof Landmarks3D !== 'undefined') {
      Landmarks3D.hide();
    }
    syncLandmarkLabels();
    syncMapBodyClasses();
    refreshBuildingTheme();
    map.easeTo({ pitch: 52, bearing: 0, duration: 900 });
    showToast('3D view — drag to rotate', 'info');
  } else {
    if (typeof Landmarks3D !== 'undefined') Landmarks3D.hide();
    applyBuildingViewMode();
    syncLandmarkLabels();
    syncMapBodyClasses();
    refreshBuildingTheme();
    map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
    map.triggerRepaint();
  }
  if (activeCategory) startBuildingHighlight(activeCategory);
}

// Show the 3D landmark models. Three.js is loaded lazily here the first time
// the user enters 3D (not on every page load); the callback fires once the
// library is live, so 2D buildings appear instantly while the detailed models
// stream in a moment later. Subsequent calls are instant (already loaded).
function showLandmarks3D() {
  if (typeof Landmarks3D === 'undefined') return;
  Landmarks3D.load(() => {
    Landmarks3D.init(map);
    syncLandmarkLabels();
    Landmarks3D.show();
  });
}

// ============================================================
// Layer Toggle Panel
// ============================================================
function toggleLayer(layerName) {
  LAYERS[layerName] = !LAYERS[layerName];
  const vis = LAYERS[layerName] ? 'visible' : 'none';

  const layerMap = {
    buildings: is3D
      ? ['buildings-3d', 'buildings-3d-glow', 'buildings-labels', 'landmark-labels']
      : ['berms-fill', 'berms-outline', 'buildings-fill', 'buildings-outline-casing', 'buildings-outline', 'buildings-labels', 'landmark-labels'],
    roads: ROAD_LAYER_IDS,
    markers: ['places-circles', 'places-labels'],
  };

  for (const id of (layerMap[layerName] || [])) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  }
  if (layerName === 'buildings') {
    applyBuildingViewMode();
    syncLandmarkLabels();
  }
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
  container.replaceChildren();
  container.appendChild(createChip('All', null, true));
  for (const cat of categoriesData) {
    if (['other', 'building'].includes(cat.id)) continue;
    container.appendChild(createChip(cat.name, cat.id, false, cat.color));
  }
}

function createChip(name, categoryId, isActive, color) {
  const chip = document.createElement('div');
  chip.className = `category-chip${categoryId ? '' : ' chip-all'}${isActive ? ' active' : ''}`;
  if (color) chip.style.setProperty('--chip-color', color);
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
    if (!q) { renderQuickAccess(); return; }
    searchTimeout = setTimeout(() => performSearch(q), 250);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) performSearch(input.value.trim());
    else renderQuickAccess();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.add('hidden');
    input.focus();
    renderQuickAccess();
  });

  setupVoiceSearch();

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
      clearDirectionsPickMode(true);
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

// One result row — shared by search, quick-access (recents/favorites) and near-me.
function _placeItemHTML(item) {
  const style = CATEGORY_STYLES[item.category] || CATEGORY_STYLES.other;
  const dist  = userLocation ? `<span class="result-distance">${formatDist(haversine(userLocation.lat, userLocation.lng, item.lat, item.lng))}</span>` : '';
  const badge = item.is_proposed ? `<span class="proposed-badge">Proposed</span>` : '';
  return `
    <div class="search-result-item"
         data-lat="${item.lat}" data-lng="${item.lng}"
         data-name="${escapeHtml(item.name)}"
         data-category="${escapeHtml(item.category || 'other')}"
         data-desc="${escapeHtml(item.description || '')}">
      <div class="result-icon">${style.abbr}</div>
      <div class="result-info">
        <div class="result-name">${escapeHtml(item.name)}${badge}</div>
        <div class="result-category">${escapeHtml(style.label || item.category || '')}</div>
      </div>
      ${dist}
    </div>`;
}

function _wireResultClicks(results) {
  results.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => {
      const lat = parseFloat(el.dataset.lat);
      const lng = parseFloat(el.dataset.lng);
      results.classList.add('hidden');
      document.getElementById('search-input').value = el.dataset.name;
      map.flyTo({ center: [lng, lat], zoom: 17, duration: 1000 });
      showCoordPin({ lat, lng }, { name: el.dataset.name, category: el.dataset.category, description: el.dataset.desc });
    });
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

    results.innerHTML = data.map(_placeItemHTML).join('');
    _wireResultClicks(results);
    results.classList.remove('hidden');
  } catch (err) {
    console.error('Search error:', err);
  }
}

// Refresh the quick-access list in place, but ONLY when it's already on screen
// (empty search box) — so favoriting from the place sheet doesn't pop the
// search panel open unexpectedly.
function refreshQuickAccessIfOpen() {
  const results = document.getElementById('search-results');
  const input = document.getElementById('search-input');
  if (results && input && !results.classList.contains('hidden') && !input.value.trim()) {
    renderQuickAccess();
  }
}

// Quick-access view shown when the search box is empty/focused: Near-me action
// plus the user's Favorites and Recents.
function renderQuickAccess() {
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  if (input.value.trim()) return;
  const favs = getFavorites();
  const recents = getRecents();

  let html = `<div class="qa-actions">
      <button class="qa-chip" id="qa-near" type="button">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z"/></svg>
        Near me
      </button>
    </div>`;
  if (favs.length) {
    html += `<div class="qa-section"><div class="qa-head">★ Favorites</div>${favs.map(_placeItemHTML).join('')}</div>`;
  }
  if (recents.length) {
    html += `<div class="qa-section"><div class="qa-head">Recent</div>${recents.map(_placeItemHTML).join('')}</div>`;
  }
  if (!favs.length && !recents.length) {
    html += `<div class="qa-hint">Find a place, then tap ★ to save it here for quick access.</div>`;
  }

  results.innerHTML = html;
  _wireResultClicks(results);
  const near = document.getElementById('qa-near');
  if (near) near.addEventListener('click', showNearMe);
  results.classList.remove('hidden');
}

// "Near me" — nearest POIs to the live GPS fix.
function showNearMe() {
  const results = document.getElementById('search-results');
  if (!userLocation) {
    showToast('Turn on location to see what’s near you', 'warn');
    flyToUserLocation();
    return;
  }
  const items = IITJData.nearby(userLocation.lat, userLocation.lng, 700, 12);
  if (!items.length) {
    results.innerHTML = `<div class="search-empty"><div class="empty-text">Nothing mapped within 700&nbsp;m</div></div>`;
    results.classList.remove('hidden');
    return;
  }
  results.innerHTML = `<div class="qa-section"><div class="qa-head">Near you</div>${items.map(_placeItemHTML).join('')}</div>`;
  _wireResultClicks(results);
  results.classList.remove('hidden');
}

// Voice search via the Web Speech API. The mic button stays hidden on browsers
// that don't support it (notably Firefox), so it never looks broken.
function setupVoiceSearch() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById('btn-voice');
  if (!btn) return;
  if (!SR) { btn.hidden = true; return; }
  btn.hidden = false;

  const input = document.getElementById('search-input');
  let rec = null, listening = false;
  btn.addEventListener('click', () => {
    if (listening) { try { rec && rec.stop(); } catch (_) {} return; }
    rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => { listening = true; btn.classList.add('listening'); input.placeholder = 'Listening…'; };
    rec.onresult = (e) => {
      const txt = Array.from(e.results).map(r => r[0].transcript).join('');
      input.value = txt;
      document.getElementById('search-clear').classList.toggle('hidden', !txt.length);
      if (e.results[e.results.length - 1].isFinal) performSearch(txt.trim());
      else { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => performSearch(txt.trim()), 250); }
    };
    const done = () => { listening = false; btn.classList.remove('listening'); input.placeholder = 'Search buildings, departments…'; };
    rec.onerror = (e) => { done(); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') showToast('Microphone access blocked', 'warn'); };
    rec.onend = done;
    try { rec.start(); } catch (_) {}
  });
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

  // "Open now" status — only for places that carry opening_hours.
  const hoursEl = document.getElementById('sheet-hours');
  const oh = place.opening_hours || (place.name ? IITJData.getOpeningHours(place.name) : null);
  const status = getOpenStatus(oh);
  if (status) {
    hoursEl.className = 'sheet-hours ' + status.cls;
    hoursEl.querySelector('.hours-label').textContent = status.label;
    hoursEl.querySelector('.hours-sub').textContent = status.sub || '';
    hoursEl.style.display = 'flex';
  } else {
    hoursEl.style.display = 'none';
  }

  // Registered entrance gate (+ floor, when the data carries it). Directions
  // route to this gate; surfacing it here sets the "meet me at the door"
  // expectation before the user even starts navigating.
  const entEl = document.getElementById('sheet-entrance');
  const entrance = place.name ? IITJData.getEntrance(place.name) : null;
  if (entEl) {
    if (entrance && entrance.gate_name) {
      const floor = entrance.floor != null ? ` · ${_floorLabel(entrance.floor)}` : '';
      entEl.querySelector('.entrance-label').textContent = `Enter via ${entrance.gate_name}${floor}`;
      entEl.style.display = 'flex';
    } else {
      entEl.style.display = 'none';
    }
  }

  // Favorite toggle — hidden for ad-hoc dropped pins (nothing stable to save).
  const favBtn = document.getElementById('sheet-fav');
  const favable = place.name && place.name !== 'Dropped Pin' && place.lat != null && place.lng != null;
  favBtn.style.display = favable ? 'flex' : 'none';
  if (favable) {
    const sync = () => {
      const on = isFavorite(place);
      favBtn.classList.toggle('is-fav', on);
      favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      favBtn.title = on ? 'Remove from favorites' : 'Save to favorites';
    };
    sync();
    favBtn.onclick = () => {
      const added = toggleFavorite(place);
      sync();
      showToast(added ? 'Saved to favorites' : 'Removed from favorites', added ? 'success' : 'info');
      refreshQuickAccessIfOpen();
    };
    pushRecent(place);
    refreshQuickAccessIfOpen();
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
  else if (userLocation) {
    setDirectionsPoint('from', {
      lat: userLocation.lat,
      lng: userLocation.lng,
      name: 'Your location',
    }, false);
  }
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
  // Minimize is always available — the user can tuck the form away to see the
  // map even before a route is computed.
  document.getElementById('dir-minimize').classList.remove('hidden');
}

function minimizeDirectionsPanel() {
  const panel = document.getElementById('directions-panel');
  panel.classList.add('minimized');
  const from = directionsFrom && directionsFrom.name;
  const to   = directionsTo && directionsTo.name;
  document.getElementById('dir-collapsed-route').textContent =
    (from || to) ? `${from || 'Start'} → ${to || 'End'}` : 'Directions';
  // With a route, show the ETA/distance summary + the Start button; without
  // one, the slim bar is just a "tap to edit" handle.
  document.getElementById('dir-collapsed-meta').textContent =
    currentRoute ? (document.getElementById('dir-summary-text').textContent || '') : 'Tap to edit route';
  document.getElementById('dir-start-mini').style.display = currentRoute ? '' : 'none';
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
  const fromOk = directionsFrom || document.getElementById('dir-from').value.trim();
  const toOk = directionsTo || document.getElementById('dir-to').value.trim();
  document.getElementById('dir-go').disabled = !(fromOk && toOk);
}

/** Resolve a directions field from its stored point or typed search text. */
function resolveDirectionsEndpoint(target) {
  const existing = target === 'from' ? directionsFrom : directionsTo;
  if (existing) return existing;

  const input = document.getElementById(`dir-${target}`).value.trim();
  if (!input) return null;

  if (/^your\s+location$/i.test(input)) {
    if (!userLocation) return null;
    return { lat: userLocation.lat, lng: userLocation.lng, name: 'Your location' };
  }

  const place = IITJData.getPlaceByName(input);
  if (place) return { lat: place.lat, lng: place.lng, name: place.name };

  const hits = IITJData.search(input, 1);
  if (hits.length) return { lat: hits[0].lat, lng: hits[0].lng, name: hits[0].name };

  return null;
}

function setDirectionsPickMode(target) {
  directionsPickTarget = target;
  document.body.classList.add('dir-map-pick');
  document.querySelectorAll('.dir-pick-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pick === target);
  });
  const msg = target === 'from'
    ? 'Tap the map to set starting point'
    : 'Tap the map to set destination';
  showToast(msg, 'info');

  // Tuck the form into the slim bar so the map underneath is fully visible and
  // tappable. We add the class directly rather than calling
  // minimizeDirectionsPanel() — that helper clears the pick target we just set.
  const panel = document.getElementById('directions-panel');
  panel.classList.add('minimized');
  document.getElementById('dir-collapsed-route').textContent =
    target === 'from' ? 'Tap the map to set start' : 'Tap the map to set destination';
  document.getElementById('dir-collapsed-meta').textContent = 'Choosing on map…';
  document.getElementById('dir-start-mini').style.display = 'none';
  hideAllDirResults();
}

function clearDirectionsPickMode(restorePanel = false) {
  directionsPickTarget = null;
  document.body.classList.remove('dir-map-pick');
  document.querySelectorAll('.dir-pick-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('dir-pick-hint').classList.add('hidden');
  if (restorePanel) expandDirectionsPanel();
}

function removeDirectionsMarkers() {
  if (directionsFromMarker) { directionsFromMarker.remove(); directionsFromMarker = null; }
  if (directionsToMarker) { directionsToMarker.remove(); directionsToMarker = null; }
}

function updateDirectionsMarkers() {
  removeDirectionsMarkers();
  // Skip the from-marker when navigation is live AND the start is the
  // user's location — the live puck already marks that spot. Drawing a
  // second grey circle on top is a duplicate.
  const skipFrom = navigationActive && userLocation
    && directionsFrom?.name === 'Your location';
  if (directionsFrom && !skipFrom) {
    const el = document.createElement('div');
    el.className = 'dir-from-marker';
    directionsFromMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([directionsFrom.lng, directionsFrom.lat]).addTo(map);
  }
  // Likewise skip the to-marker once nav is live — the red route-dest pin
  // takes over.
  if (directionsTo && !navigationActive) {
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
      <div class="result-category">${escapeHtml(style.label || item.category)}</div></div>
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
  document.getElementById('dir-start').addEventListener('click', startImmersiveNavigation);
  document.getElementById('dir-start-mini').addEventListener('click', startImmersiveNavigation);
  document.getElementById('dir-close').addEventListener('click', closeDirectionsPanel);
  document.getElementById('dir-close-mini').addEventListener('click', closeDirectionsPanel);
  document.getElementById('dir-expand').addEventListener('click', expandDirectionsPanel);
  document.getElementById('dir-expand-icon').addEventListener('click', expandDirectionsPanel);
  document.getElementById('dir-minimize').addEventListener('click', minimizeDirectionsPanel);

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
  const fromResolved = resolveDirectionsEndpoint('from');
  const toResolved = resolveDirectionsEndpoint('to');
  if (!fromResolved || !toResolved) {
    if (!fromResolved && document.getElementById('dir-from').value.trim()) {
      showToast('Could not find starting point — pick from search results', 'warn');
    } else if (!toResolved && document.getElementById('dir-to').value.trim()) {
      showToast('Could not find destination — pick from search results', 'warn');
    } else {
      showToast('Set both starting point and destination', 'warn');
    }
    return;
  }
  directionsFrom = fromResolved;
  directionsTo = toResolved;
  document.getElementById('dir-from').value = directionsFrom.name;
  document.getElementById('dir-to').value = directionsTo.name;
  updateDirectionsMarkers();
  updateDirectionsGoButton();

  closePlaceSheet();
  clearDirectionsPickMode();
  // A reroute during immersive nav should NOT pop the user back to the
  // overview — preserve the in-flight state so we can resume seamlessly.
  const wasImmersive = immersiveNav;
  if (!wasImmersive) showLoadingToast('Calculating route…');

  try {
    // Snap to the registered entrance gate if the destination has one
    // (e.g. hostels route to their actual entry gate, not the building centroid)
    const fromEntry = IITJData.getEntrance(directionsFrom.name);
    const toEntry   = IITJData.getEntrance(directionsTo.name);
    navEntrance = toEntry || null;   // surfaced on arrival (visual + spoken)
    let routeFromLat = fromEntry ? fromEntry.lat : directionsFrom.lat;
    let routeFromLng = fromEntry ? fromEntry.lng : directionsFrom.lng;
    // Use live GPS only when the user explicitly chose "Your location".
    if (userLocation && directionsFrom.name === 'Your location') {
      routeFromLat = userLocation.lat;
      routeFromLng = userLocation.lng;
    }
    const routeToLat   = toEntry   ? toEntry.lat   : directionsTo.lat;
    const routeToLng   = toEntry   ? toEntry.lng   : directionsTo.lng;

    let route = IITJRouter.computeRoute(
      routeFromLat, routeFromLng,
      routeToLat,   routeToLng,
      directionsMode,
      { preferCampusSideTo: IITJData.isBermDestination(directionsTo.name, routeToLat, routeToLng) }
    );

    hideLoadingToast();
    if (route.error) { showToast(route.error, 'error'); return; }

    // Road graph may end at a gate node; extend to the POI label only when we
    // have no registered entrance (otherwise the line cuts through the building).
    if (!toEntry) {
      route = _extendRouteToPoi(route, directionsTo.lat, directionsTo.lng);
    }

    currentRoute        = route;
    navInstructionIndex = 0;
    navigationActive    = wasImmersive;   // routes are previews unless we're already navigating
    navDestination      = { ...directionsTo };

    const routeDestMarker = toEntry
      ? [toEntry.lng, toEntry.lat]
      : [directionsTo.lng, directionsTo.lat];
    drawRoute(route.geometry, true, routeDestMarker);

    // Mid-nav reroute: just refresh the line + ETA in the nav-panel; skip
    // the preview UI, the fitBounds, and the "best route" toast.
    if (wasImmersive) {
      document.getElementById('nav-destination').textContent = directionsTo.name;
      document.getElementById('nav-eta').textContent =
        `${route.eta_minutes} min ${route.profile === 'driving' ? 'drive' : 'walk'}`;
      document.getElementById('nav-distance').textContent = formatDist(route.distance);
      updateNavInstruction(route.instructions[0]?.distance ?? null);
      return;
    }

    document.getElementById('dir-summary').classList.remove('hidden');
    const travelVerb = route.profile === 'driving' ? 'drive' : 'walk';
    document.getElementById('dir-summary-text').textContent =
      `${formatDist(route.distance)} · ${route.eta_minutes} min ${travelVerb}`;
    let summaryType;
    if (!route.using_road_network) summaryType = 'Direct path · no road nearby';
    else if (route.fell_back_to_walk) summaryType = 'Walking · no drivable road here';
    else summaryType = route.profile === 'driving' ? 'Driving · main roads' : 'Walking · campus paths';
    document.getElementById('dir-summary-type').textContent = summaryType;

    // Collapse the form to a slim bar so the route stays visible on small
    // screens (Google Maps-style) — full form only needed while editing.
    minimizeDirectionsPanel();

    // Prime the nav-panel content so it's ready the moment Start is pressed,
    // but keep the panel hidden until then (Google Maps-style preview).
    document.getElementById('nav-destination').textContent = directionsTo.name;
    document.getElementById('nav-eta').textContent =
      `${route.eta_minutes} min ${route.profile === 'driving' ? 'drive' : 'walk'}`;
    document.getElementById('nav-distance').textContent = formatDist(route.distance);
    updateNavInstruction(route.instructions[0]?.distance ?? null);
    _showOffRoute(false);
    _showRerouting(false);

    const coords = route.geometry.coordinates;
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: { top: 72, bottom: 260, left: 40, right: 40 }, duration: 1000 });

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
let _offRouteSince    = 0;      // performance.now() the puck first crossed the off-route threshold; 0 when on-route

async function reRoute() {
  // Never reroute a fixed-start preview: the chosen origin must be respected,
  // not silently replaced with the user's live (off-route) position.
  if (!navFollowsUser) return;
  if (!navDestination || _rerouteCooldown) return;
  _rerouteCooldown = true;
  _offRouteSince   = 0;  // any in-flight off-route streak is now stale
  setTimeout(() => { _rerouteCooldown = false; }, 8000);

  _showRerouting(true);
  _resetNavVoiceState();
  NavVoice.speak('Rerouting');
  if (directionsFrom && directionsTo) {
    // Mid-nav reroute always recalculates from the live puck.
    if (userLocation && navigationActive) {
      directionsFrom = { lat: userLocation.lat, lng: userLocation.lng, name: 'Your location' };
    }
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

function _extendRouteToPoi(route, poiLat, poiLng) {
  if (!route?.geometry?.coordinates?.length || poiLat == null || poiLng == null) return route;
  const coords = route.geometry.coordinates.map(c => [...c]);
  const last = coords[coords.length - 1];
  const gap = haversine(last[1], last[0], poiLat, poiLng);
  if (gap <= 5 || gap > 200) return route;
  coords.push([poiLng, poiLat]);
  let dist = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    dist += haversine(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  const speed = route.profile === 'driving' ? 7 : 1.4;
  return {
    ...route,
    geometry: { type: 'LineString', coordinates: coords },
    distance: Math.round(dist),
    duration: Math.round(dist / speed),
    eta_minutes: Math.max(1, Math.round(dist / speed / 60)),
  };
}

function _removeRouteMarkers() {
  if (routeOriginMarker) { routeOriginMarker.remove(); routeOriginMarker = null; }
  if (routeDestMarker)   { routeDestMarker.remove();   routeDestMarker   = null; }
}

function _addRouteMarkers(startCoord, endCoord) {
  _removeRouteMarkers();

  // ── Start: blue circle. Skipped during active navigation because the
  // live user puck already sits at this position — drawing both was the
  // "two location pointers" bug the user saw.
  if (!navigationActive || !userLocation) {
    const startEl = document.createElement('div');
    startEl.className = 'route-origin-marker';
    routeOriginMarker = new maplibregl.Marker({ element: startEl, anchor: 'center' })
      .setLngLat(startCoord).addTo(map);
  }

  // ── End: red teardrop pin ──
  const endEl = document.createElement('div');
  endEl.className = 'route-dest-marker';
  routeDestMarker = new maplibregl.Marker({ element: endEl, anchor: 'bottom' })
    .setLngLat(endCoord).addTo(map);
}

function drawRoute(geometry, animate = true, destMarker = null) {
  const data = { type: 'Feature', geometry };

  // Cancel any in-flight draw animation from a previous route.
  if (_routeDrawRAF) { cancelAnimationFrame(_routeDrawRAF); _routeDrawRAF = null; }

  // Remove old route layers so they can be re-added on top after style reload
  ['route-traveled', 'route-glow', 'route-casing', 'route-line'].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });
  ['route', 'route-traveled-src'].forEach(id => {
    if (map.getSource(id)) map.removeSource(id);
  });

  // Grow the line from origin → destination on the first draw. During live
  // navigation / reroutes we skip it (the line should just be there), and we
  // honour prefers-reduced-motion.
  const doAnimate = animate && !navigationActive && !prefersReducedMotion()
    && geometry.type === 'LineString' && geometry.coordinates.length > 1;

  map.addSource('route', { type: 'geojson', data: doAnimate
    ? { type: 'Feature', geometry: { type: 'LineString', coordinates: [geometry.coordinates[0]] } }
    : data });

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
  _addRouteMarkers(coords[0], destMarker || coords[coords.length - 1]);

  if (doAnimate) _animateRouteDraw(geometry.coordinates);
}

// Reveal the route by growing its geometry from the origin to the destination.
// Cheap and robust: we re-`setData` a progressively longer slice each frame,
// which works with the existing glow/casing/line layers untouched.
let _routeDrawRAF = null;
function _animateRouteDraw(coords) {
  const src = map.getSource('route');
  if (!src) return;
  // Cumulative pixel-independent lengths so the reveal is evenly paced.
  const seg = [0];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    seg.push(total);
  }
  if (total <= 0) { src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }); return; }

  // Pace: longer routes draw a touch longer, but clamp so it always feels snappy.
  const duration = Math.min(900, Math.max(450, total * 1.6));
  const start = performance.now();
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const target = easeOut(p) * total;
    // Walk to the segment containing `target`, interpolating the final bit.
    let i = 1;
    while (i < seg.length && seg[i] < target) i++;
    const drawn = coords.slice(0, i);
    if (i < coords.length) {
      const segLen = seg[i] - seg[i - 1];
      const f = segLen > 0 ? (target - seg[i - 1]) / segLen : 0;
      const a = coords[i - 1], b = coords[i];
      drawn.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]);
    }
    src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: drawn } });
    if (p < 1) {
      _routeDrawRAF = requestAnimationFrame(tick);
    } else {
      _routeDrawRAF = null;
      src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });
    }
  };
  _routeDrawRAF = requestAnimationFrame(tick);
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

// ============================================================
// RoadSnap — ambient snap-to-road for the user puck
// ============================================================
// During free roaming (no active navigation) raw filtered GPS routinely
// drifts 5–25 m to either side of the road the user is actually walking
// on. We build a coarse spatial grid over every roads.geojson segment
// once at startup; per-frame we look up the 9 nearest cells, project
// the puck onto the closest segment, and render the projection if it's
// inside a small buffer (scaled by GPS accuracy so noisy fixes don't
// magnet onto unrelated paths).
const RoadSnap = (() => {
  const CELL_DEG = 0.0005;            // ~55 m at IITJ latitude — comfortably > snap radius
  const SNAP_RADIUS_M = 18;           // base snap buffer
  const SNAP_RADIUS_HARD_CAP_M = 30;  // even with bad accuracy, never snap past this
  const MAX_ACC_FOR_SNAP_M = 40;      // ignore snap when GPS is worse than this

  let _segs = null;       // [{ ax, ay, bx, by }, ...] flat list of segments
  let _grid = null;       // Map<cellKey, segIdx[]>
  let _built = false;

  function _cellKey(ix, iy) { return ix + '|' + iy; }
  function _cellOf(lng, lat) {
    return [Math.floor(lng / CELL_DEG), Math.floor(lat / CELL_DEG)];
  }

  // Add every cell the segment's bbox touches so a lookup near either
  // end (or in the middle of a long way) still finds it.
  function _indexSegment(idx, ax, ay, bx, by) {
    const [ix1, iy1] = _cellOf(Math.min(ax, bx), Math.min(ay, by));
    const [ix2, iy2] = _cellOf(Math.max(ax, bx), Math.max(ay, by));
    for (let ix = ix1; ix <= ix2; ix++) {
      for (let iy = iy1; iy <= iy2; iy++) {
        const k = _cellKey(ix, iy);
        let arr = _grid.get(k);
        if (!arr) { arr = []; _grid.set(k, arr); }
        arr.push(idx);
      }
    }
  }

  function build(roadsFC) {
    if (!roadsFC || !roadsFC.features) return;
    _segs = [];
    _grid = new Map();
    for (const f of roadsFC.features) {
      const g = f.geometry;
      if (!g) continue;
      // Skip non-walkable highway types if we ever add them; for now
      // every entry in roads.geojson is walkable (service / footway /
      // residential / etc.) so we accept them all.
      const lines = g.type === 'LineString' ? [g.coordinates]
                  : g.type === 'MultiLineString' ? g.coordinates
                  : null;
      if (!lines) continue;
      for (const coords of lines) {
        for (let i = 0; i < coords.length - 1; i++) {
          const [ax, ay] = coords[i], [bx, by] = coords[i + 1];
          if (!isFinite(ax) || !isFinite(ay) || !isFinite(bx) || !isFinite(by)) continue;
          _segs.push({ ax, ay, bx, by });
          _indexSegment(_segs.length - 1, ax, ay, bx, by);
        }
      }
    }
    _built = true;
  }

  // Project (lat,lng) onto the nearest segment in the 3×3 cell neighbourhood.
  // Returns { lat, lng, dist } when a segment was found, else null.
  function nearest(lat, lng) {
    if (!_built || !_segs || _segs.length === 0) return null;
    const [cx, cy] = _cellOf(lng, lat);
    let best = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = _grid.get(_cellKey(cx + dx, cy + dy));
        if (!arr) continue;
        for (const si of arr) {
          const s = _segs[si];
          const ux = s.bx - s.ax, uy = s.by - s.ay;
          const lenSq = ux * ux + uy * uy;
          let t = lenSq > 0 ? ((lng - s.ax) * ux + (lat - s.ay) * uy) / lenSq : 0;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          const px = s.ax + t * ux, py = s.ay + t * uy;
          const d = haversine(lat, lng, py, px);
          if (!best || d < best.dist) best = { lat: py, lng: px, dist: d };
        }
      }
    }
    return best;
  }

  // Snap a fix to the nearest road if (a) we have an index, (b) the
  // GPS accuracy isn't too poor to trust the snap, and (c) the road is
  // close enough. Returns the snapped point or null to fall through to
  // the raw filtered position.
  function snap(lat, lng, accuracyM, opts = {}) {
    if (accuracyM != null && accuracyM > MAX_ACC_FOR_SNAP_M) return null;
    const best = nearest(lat, lng);
    if (!best) return null;
    const buffer = Math.min(
      SNAP_RADIUS_HARD_CAP_M,
      Math.max(SNAP_RADIUS_M, (accuracyM || 0) * 0.6)
    );
    if (best.dist > buffer) return null;
    return best;
  }

  // Like snap(), but when several roads are equally close (e.g. berm service
  // path beside the main road) prefer the segment whose bearing best matches
  // the caller's preferred heading.
  function snapAligned(lat, lng, accuracyM, preferredBearingDeg) {
    if (preferredBearingDeg == null || accuracyM != null && accuracyM > MAX_ACC_FOR_SNAP_M) {
      return snap(lat, lng, accuracyM);
    }
    if (!_built || !_segs || _segs.length === 0) return null;
    const buffer = Math.min(
      SNAP_RADIUS_HARD_CAP_M,
      Math.max(SNAP_RADIUS_M, (accuracyM || 0) * 0.6)
    );
    const [cx, cy] = _cellOf(lng, lat);
    let best = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = _grid.get(_cellKey(cx + dx, cy + dy));
        if (!arr) continue;
        for (const si of arr) {
          const s = _segs[si];
          const ux = s.bx - s.ax, uy = s.by - s.ay;
          const lenSq = ux * ux + uy * uy;
          let t = lenSq > 0 ? ((lng - s.ax) * ux + (lat - s.ay) * uy) / lenSq : 0;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          const px = s.ax + t * ux, py = s.ay + t * uy;
          const d = haversine(lat, lng, py, px);
          if (d > buffer) continue;
          const segBearing = ((Math.atan2(ux * Math.cos(py * Math.PI / 180), uy) * 180 / Math.PI) + 360) % 360;
          let delta = Math.abs(segBearing - preferredBearingDeg);
          if (delta > 180) delta = 360 - delta;
          const score = d + delta * 0.35;
          if (!best || score < best.score) best = { lat: py, lng: px, dist: d, score };
        }
      }
    }
    return best;
  }

  function ready() { return _built; }

  return { build, nearest, snap, snapAligned, ready };
})();

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

  // Instruction text — arrival surfaces the registered entrance gate.
  document.getElementById('nav-text').textContent =
    (instr.type === 'arrive' && navEntrance && navEntrance.gate_name)
      ? `Arrive — enter via ${navEntrance.gate_name}${navEntrance.floor != null ? ' · ' + _floorLabel(navEntrance.floor) : ''}`
      : instr.text;

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

  // Point the departure arrow at the real travel direction right away.
  _updateNavArrowHeading();
}

// Compass for the "Head <compass>" departure step. Two coordinated rotations
// give us both behaviours at once:
//   • The frame spins with the map (rotate −mapBearing) so the "N" tick always
//     points at true north — while navigating (map follows heading) it visibly
//     turns in real time as you move/rotate.
//   • The needle points at the true travel bearing (frame-north + instr.bearing),
//     so it always matches the word ("northwest" reads as up-left on a north-up
//     map, and stays pinned to real northwest as the frame spins).
// Turn steps keep their fixed directional glyph.
let _navCompassAngle = 0;   // continuous (unwrapped) frame angle — never spin-flips
function _updateNavArrowHeading() {
  const wrap = document.getElementById('nav-arrow-wrap');
  if (!wrap) return;
  const instr = currentRoute?.instructions?.[navInstructionIndex];
  const live  = navigationActive && instr && instr.type === 'depart' && instr.bearing != null;
  if (!live) {
    wrap.classList.remove('compass-mode', 'nav-arrow-live');
    return;
  }
  // Bind a one-time map-rotate listener so the frame tracks as the camera turns.
  if (map && !map._navArrowRotateBound) {
    map._navArrowRotateBound = true;
    map.on('rotate', _updateNavArrowHeading);
  }
  wrap.classList.add('compass-mode', 'nav-arrow-live');

  // Frame: rotate opposite the map so N stays on true north. Step by the shortest
  // signed delta so the CSS transition takes the short arc across the 0/360 seam.
  const targetFrame = -(map ? map.getBearing() : 0);
  const delta = (((targetFrame - _navCompassAngle) % 360) + 540) % 360 - 180;
  _navCompassAngle += delta;
  document.getElementById('nav-compass').style.transform = `rotate(${_navCompassAngle}deg)`;

  // Needle: travel bearing within the (already north-aligned) frame.
  document.getElementById('nav-compass-needle').style.transform = `rotate(${instr.bearing}deg)`;
}

// ============================================================
// Immersive Navigation — Google-Maps-style first-person 3D view
// ============================================================
function _routeStartBearing() {
  const coords = currentRoute?.geometry?.coordinates;
  if (!coords || coords.length < 2) return 0;
  const [x1, y1] = coords[0], [x2, y2] = coords[1];
  // getBearing is defined inside IITJRouter; recompute locally to avoid coupling
  const lat1 = y1, lng1 = x1, lat2 = y2, lng2 = x2;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function startImmersiveNavigation() {
  if (!currentRoute) return;

  // Save state so End restores the user's prior view
  preNavCameraState = {
    center:  map.getCenter(),
    zoom:    map.getZoom(),
    pitch:   map.getPitch(),
    bearing: map.getBearing(),
  };
  pre3DState = is3D;

  navigationActive = true;
  immersiveNav     = true;
  // Live GPS nav only when the origin IS the user's location. A fixed chosen
  // start (any origin other than "Your location") is a static route preview:
  // no GPS follow, no off-route badge, no reroute-to-current-position.
  navFollowsUser = !!(userLocation && directionsFrom?.name === 'Your location');

  // Re-render the instruction now that navigationActive is true, so the compass
  // switches on immediately (on desktop / before the first GPS fix there's no
  // _navTick to do it, and the preview render happened while nav was inactive).
  // For a static preview, _navTick never runs, so seed the distance banner with
  // the whole-route distance to the destination here.
  updateNavInstruction(navFollowsUser ? (currentRoute.instructions?.[0]?.distance ?? null) : currentRoute.distance);
  if (!navFollowsUser) {
    const verb   = currentRoute.profile === 'driving' ? 'drive' : 'walk';
    const remMin = Math.max(1, Math.round((currentRoute.eta_minutes ?? (currentRoute.duration ? currentRoute.duration / 60 : 1))));
    document.getElementById('nav-eta').textContent      = `${remMin} min ${verb}`;
    document.getElementById('nav-distance').textContent = formatDist(currentRoute.distance);
  }

  // Re-evaluate route + directions markers now that navigationActive flipped
  // (so the duplicate-suppression in updateDirectionsMarkers/_addRouteMarkers
  // takes effect).
  updateDirectionsMarkers();
  if (currentRoute?.geometry?.coordinates) {
    const c = currentRoute.geometry.coordinates;
    _addRouteMarkers(c[0], c[c.length - 1]);
  }

  // Hide the form chrome so the 3D view is full-bleed; show the nav-panel
  document.body.classList.add('immersive-nav');
  document.getElementById('nav-panel').classList.remove('hidden');

  // Switch on 3D buildings/landmarks if not already
  if (!is3D && !isSatellite) {
    // Reuse the existing toggle so visibility/landmark layers stay consistent
    toggle3D();
  }

  // Buildings occlude the route line and the user puck at street-level pitch.
  // Fade ONLY the structures right around the start position (not everything).
  const focusCoord = (userLocation && directionsFrom?.name === 'Your location')
    ? [userLocation.lng, userLocation.lat]
    : currentRoute.geometry.coordinates[0];
  applyImmersiveBuildingFade(focusCoord);

  // Centre + tilt camera to first-person view. Use GPS if available,
  // otherwise pull up to the route's starting coord & bearing.
  const startCoord = (userLocation && directionsFrom?.name === 'Your location')
    ? [userLocation.lng, userLocation.lat]
    : currentRoute.geometry.coordinates[0];
  const bearing = (userLocation?.heading != null)
    ? userLocation.heading
    : (headingDeg ?? _routeStartBearing());

  // Bottom padding puts the user puck in the lower third of the screen,
  // matching Google Maps' "look ahead" framing. Set autoFollow directly
  // (don't call setAutoFollow — its built-in flyTo would race this easeTo).
  // Only follow when the nav tracks the live puck; a fixed-start preview stays
  // put at the route start so the user can drag through the 3D view.
  autoFollow = navFollowsUser;
  document.getElementById('btn-locate').classList.toggle('location-follow', navFollowsUser);
  map.easeTo({
    center: startCoord,
    zoom: 18,
    pitch: 65,
    bearing,
    padding: { top: 0, bottom: 280, left: 0, right: 0 },
    duration: 900,
  });

  hideRecenterBtn();

  // Compass: requested here because the Start tap is a user gesture — the only
  // context iOS 13+ accepts DeviceOrientationEvent.requestPermission() from.
  _enableCompassWithUX();

  // Spoken guidance: open with the departure heading. The only step after it is
  // arrival (no turn steps are produced), so we cue the distance to the
  // destination here rather than announcing "you have arrived" at the start —
  // the real arrival phrase fires from _voiceGuidance at the end of the route.
  _resetNavVoiceState();
  if (NavVoice.enabled() && currentRoute.instructions && currentRoute.instructions.length) {
    const first  = currentRoute.instructions[0];
    const second = currentRoute.instructions[1];
    let phrase = first?.text || 'Starting navigation';
    if (second && second.type === 'arrive' && second.distance) {
      phrase += `. Continue for ${_spokenDist(second.distance)} to your destination`;
    } else if (second && second.type !== 'arrive' && second.distance) {
      phrase += `. In ${_spokenDist(second.distance)}, ${_lower1(second.text)}`;
    }
    NavVoice.speak(phrase);
  }

  if (!navFollowsUser) {
    if (directionsFrom?.name === 'Your location') {
      // The user wanted live nav from their position but there's no GPS fix yet.
      showToast('Enable GPS for live navigation', 'info');
    } else {
      // A fixed start was chosen on purpose — this is a static route preview,
      // so the camera stays on the route instead of tracking the user.
      showToast(`Previewing route from ${directionsFrom?.name || 'the chosen start'}`, 'info');
    }
  }
}

function exitImmersiveNavigation() {
  if (!immersiveNav) return;
  immersiveNav = false;
  document.body.classList.remove('immersive-nav');
  hideRecenterBtn();
  setAutoFollow(false);

  // Restore full-opacity buildings before any 3D toggle so we don't fight
  // toggle3D's visibility writes mid-transition.
  applyImmersiveBuildingFade(null);

  const restore = preNavCameraState || {};
  map.easeTo({
    center:  restore.center  || CAMPUS_CENTER,
    zoom:    restore.zoom    ?? CAMPUS_ZOOM,
    pitch:   restore.pitch   ?? 0,
    bearing: restore.bearing ?? 0,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    duration: 700,
  });

  // Restore 3D toggle to whatever it was before nav
  if (is3D !== pre3DState) toggle3D();

  preNavCameraState = null;
}

// Find building osm_ids and landmark ids that occlude the view from `coord`.
// A building counts as an occluder if its centroid lies within `radiusM`
// metres of the camera focus point — i.e. it's right on top of the puck.
function _occludersNear(coord, radiusM = 35) {
  const [lng, lat] = coord;
  const buildingIds = [];
  const landmarkIds = [];

  const buildings = IITJData.getBuildings();
  for (const f of buildings.features || []) {
    if (f.geometry?.type !== 'Polygon' && f.geometry?.type !== 'MultiPolygon') continue;
    const c = f.centroid;
    if (!c) continue;
    if (haversine(lat, lng, c.lat, c.lng) <= radiusM) {
      const id = f.properties?.osm_id;
      if (id != null) buildingIds.push(String(id));
    }
  }

  if (typeof Landmarks3D !== 'undefined' && typeof Landmarks3D.getLandmarks === 'function') {
    for (const l of Landmarks3D.getLandmarks()) {
      if (haversine(lat, lng, l.lat, l.lng) <= radiusM) landmarkIds.push(l.id);
    }
  }

  return { buildingIds, landmarkIds };
}

// Make ONLY the structures occluding `coord` see-through. Pass coord=null
// to restore everything to full opacity (used on End).
//
// fill-extrusion-opacity is layer-wide (MapLibre doesn't support data-driven
// for it), so we fade individual features via fill-extrusion-color alpha
// instead — color expressions ARE data-driven.
function applyImmersiveBuildingFade(coord) {
  const labelsLayer = map.getLayer('buildings-labels');
  const fillLayer   = map.getLayer('buildings-3d');

  // Base solid color matches what addBuildingsLayer originally used.
  const baseColor = buildingFillColor();
  const fadeColor = isDark ? 'rgba(71,85,105,0.18)' : 'rgba(241,245,249,0.18)';

  if (!coord) {
    _lastFadeKey = '';
    if (fillLayer) map.setPaintProperty('buildings-3d', 'fill-extrusion-color', baseColor);
    if (labelsLayer) {
      map.setLayoutProperty('buildings-labels', 'visibility',
        LAYERS.buildings ? 'visible' : 'none');
    }
    if (typeof Landmarks3D !== 'undefined' && typeof Landmarks3D.setOpacity === 'function') {
      Landmarks3D.setOpacity(1.0);
    }
    return;
  }

  const { buildingIds, landmarkIds } = _occludersNear(coord);

  // Identical occluder set → skip the (expensive) repaint trigger
  const key = buildingIds.slice().sort().join(',') + '|' + landmarkIds.slice().sort().join(',');
  if (key === _lastFadeKey) return;
  _lastFadeKey = key;

  if (fillLayer) {
    if (buildingIds.length) {
      map.setPaintProperty('buildings-3d', 'fill-extrusion-color',
        ['case', ['in', ['get', 'osm_id'], ['literal', buildingIds]], fadeColor, baseColor]);
    } else {
      map.setPaintProperty('buildings-3d', 'fill-extrusion-color', baseColor);
    }
  }

  // Labels still get hidden globally — turn names overlap the turn arrow
  if (labelsLayer) map.setLayoutProperty('buildings-labels', 'visibility', 'none');

  if (typeof Landmarks3D !== 'undefined' && typeof Landmarks3D.setOpacity === 'function') {
    if (landmarkIds.length) Landmarks3D.setOpacity(0.25, landmarkIds);
    else Landmarks3D.setOpacity(1.0);
  }
}

function showRecenterBtn() {
  if (!immersiveNav) return;
  document.getElementById('nav-recenter-btn')?.classList.remove('hidden');
}
function hideRecenterBtn() {
  document.getElementById('nav-recenter-btn')?.classList.add('hidden');
}

function recenterImmersive() {
  if (!immersiveNav) return;
  const coords = currentRoute?.geometry?.coordinates;
  const center = userLocation
    ? [userLocation.lng, userLocation.lat]
    : (coords ? coords[0] : map.getCenter());
  const bearing = (userLocation?.heading != null)
    ? userLocation.heading
    : (headingDeg ?? _routeStartBearing());
  autoFollow = true;
  document.getElementById('btn-locate').classList.add('location-follow');
  map.easeTo({
    center,
    zoom: 18,
    pitch: 65,
    bearing,
    padding: { top: 0, bottom: 280, left: 0, right: 0 },
    duration: 500,
  });
  hideRecenterBtn();
}

function clearRoute() {
  // Make sure the immersive camera/style is restored before we tear down
  if (immersiveNav) exitImmersiveNavigation();
  navigationActive = false;
  navFollowsUser   = false;
  // Gyroscope is only ever on during nav — shut it off as soon as nav ends
  // so it doesn't keep firing in the background.
  LocationTracker.disableCompass();
  _resetNavVoiceState();
  currentRoute     = null;
  navDestination   = null;
  navEntrance      = null;
  _rerouteCooldown = false;
  _offRouteSince   = 0;
  _showOffRoute(false);
  _showRerouting(false);
  document.getElementById('nav-panel').classList.add('hidden');
  document.getElementById('dir-summary').classList.add('hidden');
  hideRecenterBtn();
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
// NavVoice — spoken turn-by-turn (Web Speech API speechSynthesis)
// ============================================================
// Announces the upcoming maneuver as the user approaches it, the maneuver
// itself at the turn, reroutes, and arrival. Feature-detected (no-ops where
// speechSynthesis is missing) and user-mutable; the preference persists.
const NavVoice = (() => {
  const PREF_KEY = 'iitj-nav-voice-v1';
  const synth = (typeof window !== 'undefined' && window.speechSynthesis) || null;
  let _enabled = synth ? (localStorage.getItem(PREF_KEY) !== 'off') : false;
  let _voice = null;

  // Voice announces only the honest steps: the departure heading, arrival, and
  // reroutes. No left/right is ever spoken because no `turn` steps are produced
  // (see generateInstructions in routing.js) — the roundabout keep-left routing
  // makes turn side ambiguous, so it's deliberately omitted.
  function supported() { return !!synth; }
  function enabled()   { return supported() && _enabled; }

  function _pickVoice() {
    if (!synth) return;
    const voices = synth.getVoices() || [];
    _voice = voices.find(v => /en[-_]IN/i.test(v.lang))
          || voices.find(v => /^en/i.test(v.lang))
          || voices[0] || null;
  }
  if (synth) {
    _pickVoice();
    // Chrome populates voices asynchronously.
    try { synth.addEventListener('voiceschanged', _pickVoice); } catch (_) {}
  }

  // flush=true cancels anything queued so a fresh turn supersedes a stale one.
  function speak(text, { flush = true } = {}) {
    if (!enabled() || !text) return;
    try {
      if (flush) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = (_voice && _voice.lang) || 'en-IN';
      if (_voice) u.voice = _voice;
      u.rate = 1.02; u.pitch = 1.0; u.volume = 1.0;
      synth.speak(u);
    } catch (_) {}
  }

  function setEnabled(on) {
    _enabled = !!on && supported();
    try { localStorage.setItem(PREF_KEY, _enabled ? 'on' : 'off'); } catch (_) {}
    if (!_enabled) stop();
    return _enabled;
  }
  function toggle() { return setEnabled(!_enabled); }
  function stop()   { if (synth) { try { synth.cancel(); } catch (_) {} } }

  return { supported, enabled, speak, setEnabled, toggle, stop };
})();

// Spoken-form distance — "90 metres" / "1.2 kilometres" reads better aloud.
function _spokenDist(m) {
  if (m == null) return '';
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} metres`;
  return `${(m / 1000).toFixed(1)} kilometres`;
}
// Lowercase the first letter so "In 90 metres, turn left" flows naturally.
function _lower1(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

function _floorLabel(f) {
  const n = Number(f);
  if (!isFinite(n)) return String(f);
  if (n === 0) return 'ground floor';
  const ord = n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
  return `${ord} floor`;
}

// Arrival phrase, entrance-aware: routes to a registered gate announce it.
function _arrivalPhrase() {
  if (navEntrance && navEntrance.gate_name) {
    const floor = navEntrance.floor != null ? `, ${_floorLabel(navEntrance.floor)}` : '';
    return `You have arrived. Enter via ${navEntrance.gate_name}${floor}.`;
  }
  return 'You have arrived at your destination.';
}

// Per-route announcement bookkeeping.
let _voiceNowIdx  = -1;     // last index announced "at the turn"
let _voicePreIdx  = -1;     // last upcoming-maneuver index pre-announced
let _voiceArrived = false;  // arrival announced once
function _resetNavVoiceState() {
  _voiceNowIdx = -1; _voicePreIdx = -1; _voiceArrived = false;
  NavVoice.stop();
}

// Drive spoken guidance off the per-frame nav state computed in _navTick.
function _voiceGuidance(instrs, idx, nextInstr, distToTurn, remDist) {
  if (!NavVoice.enabled()) return;
  const cur = instrs[idx];

  // At-the-turn: the index just advanced onto a new maneuver → say it.
  if (idx !== _voiceNowIdx) {
    _voiceNowIdx = idx;
    if (cur && cur.type === 'arrive') {
      if (!_voiceArrived) { _voiceArrived = true; NavVoice.speak(_arrivalPhrase()); }
    } else if (cur && cur.type !== 'depart') {
      NavVoice.speak(cur.text);
    }
  }

  // Pre-turn heads-up as we approach the next maneuver (once per maneuver).
  if (nextInstr && nextInstr.type !== 'arrive' && distToTurn != null) {
    const pre = currentRoute.profile === 'driving' ? 200 : 70;
    const upcoming = idx + 1;
    if (distToTurn <= pre && distToTurn > 25 && _voicePreIdx !== upcoming) {
      _voicePreIdx = upcoming;
      NavVoice.speak(`In ${_spokenDist(distToTurn)}, ${_lower1(nextInstr.text)}`);
    }
  }

  // Arrival by proximity, in case the arrive index never quite advances.
  if (!_voiceArrived && remDist != null && remDist <= 20) {
    _voiceArrived = true;
    NavVoice.speak(_arrivalPhrase());
  }
}

const _VOICE_ON_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/>' +
  '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const _VOICE_OFF_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"/>' +
  '<line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';

function setupVoiceToggle() {
  const btn = document.getElementById('nav-voice-btn');
  if (!btn) return;
  if (!NavVoice.supported()) { btn.style.display = 'none'; return; }

  const sync = () => {
    const on = NavVoice.enabled();
    btn.classList.toggle('is-muted', !on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? 'Voice guidance on' : 'Voice guidance off';
    btn.innerHTML = on ? _VOICE_ON_SVG : _VOICE_OFF_SVG;
  };
  sync();
  btn.addEventListener('click', () => {
    const on = NavVoice.toggle();
    sync();
    showToast(on ? 'Voice guidance on' : 'Voice guidance off', 'info');
    // Confirm the current step aloud so the user hears it engage.
    if (on && navigationActive && currentRoute?.instructions) {
      const cur = currentRoute.instructions[navInstructionIndex];
      if (cur && cur.type !== 'depart') NavVoice.speak(cur.text);
    }
  });
}

// ============================================================
// LocationTracker — Kalman-lite GPS pipeline (single source of truth)
// ============================================================
// One module owns the watchPosition handle, smooths raw fixes with a
// Kalman-lite filter, rejects outliers, fuses GPS heading with the
// compass, and runs a requestAnimationFrame loop that interpolates the
// rendered position toward the latest filtered estimate. Subscribers
// (marker, camera, nav) consume the smooth `display` position instead
// of the noisy raw `coords`.
const LocationTracker = (() => {
  // Tunables
  const PROCESS_NOISE_MPS        = 4;    // assumed motion model std-dev (m/s)
  const MAX_ACCEPTABLE_ACCURACY  = 200;  // throw out fixes worse than this (m)
  const MIN_ACCURACY             = 3;    // floor — phones report 0–1 sometimes
  const OUTLIER_SIGMA            = 4;    // jumps beyond Nσ get heavily down-weighted
  const POS_INTERP_FACTOR        = 0.22; // per-frame ease toward estimate
  const ACC_INTERP_FACTOR        = 0.15;
  const HEADING_INTERP_FACTOR    = 0.06; // gentle ease toward target bearing

  // Compass sensitivity controls — phones emit deviceorientation at 30–100Hz
  // and the raw alpha jitters by several degrees even when the device is
  // perfectly still. Throttle + smooth + deadzone so the camera doesn't
  // visibly twitch on every wobble.
  const COMPASS_MIN_INTERVAL_MS  = 120;  // hard rate limit on accepted samples
  const COMPASS_SMOOTH_FACTOR    = 0.15; // low-pass on raw compass input
  const COMPASS_DEADZONE_DEG     = 1.5;  // ignore sub-degree micro-rotations

  let _raw  = null;   // last accepted raw fix (lat,lng,accuracy,heading,speed,t)
  let _est  = null;   // Kalman estimate (lat,lng,variance,t)
  let _disp = null;   // smoothly interpolated render position (lat,lng,accuracy,heading)
  let _gpsHeading     = null;
  let _compassHeading = null;
  let _compassRaw     = null;  // smoothed raw bearing before deadzone gating
  let _compassLastT   = 0;
  let _compassEnabled = false;
  let _compassGotSample = false;  // a usable orientation event has actually arrived
  let _compassAccuracy  = null;   // webkitCompassAccuracy (deg); <0 or large = poor
  let _speed          = null;
  let _watchId = null;
  let _rafId   = 0;
  const _listeners = new Set();

  function _haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const a = Math.sin((lat2 - lat1) * Math.PI / 360) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin((lng2 - lng1) * Math.PI / 360) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Returns true if the fix was accepted into the filter.
  function _ingest(lat, lng, accuracy, tMs) {
    accuracy = Math.max(accuracy || 30, MIN_ACCURACY);
    if (accuracy > MAX_ACCEPTABLE_ACCURACY) return false;
    if (!isFinite(lat) || !isFinite(lng)) return false;

    if (!_est) {
      _est = { lat, lng, variance: accuracy * accuracy, t: tMs };
      return true;
    }

    const dt = Math.max(0.05, Math.min(10, (tMs - _est.t) / 1000));
    const procVar = (PROCESS_NOISE_MPS * dt) ** 2;
    const predVar = _est.variance + procVar;
    const measVar = accuracy * accuracy;

    // Outlier rejection: if the jump is way bigger than the expected
    // uncertainty, fold in only a small fraction so a bad fix can't yank
    // the puck off the road.
    const jumpM = _haversine(_est.lat, _est.lng, lat, lng);
    const sigma = Math.sqrt(predVar + measVar);
    let gain = predVar / (predVar + measVar);
    if (jumpM > OUTLIER_SIGMA * sigma) gain *= 0.12;

    _est.lat += gain * (lat - _est.lat);
    _est.lng += gain * (lng - _est.lng);
    _est.variance = (1 - gain) * predVar;
    _est.t = tMs;
    return true;
  }

  function _rotateAngle(from, to, factor) {
    let delta = to - from;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return ((from + delta * factor) + 360) % 360;
  }

  // Fuse GPS heading (good when moving) with compass heading (good at rest).
  function _bestHeading() {
    if (_speed != null && _speed > 1.4 && _gpsHeading != null && !isNaN(_gpsHeading)) return _gpsHeading;
    if (_compassHeading != null) return _compassHeading;
    if (_gpsHeading != null && !isNaN(_gpsHeading)) return _gpsHeading;
    return null;
  }

  function _frame() {
    _rafId = requestAnimationFrame(_frame);
    if (!_est) return;

    const targetAcc = Math.sqrt(_est.variance);
    const targetH   = _bestHeading();

    if (!_disp) {
      _disp = { lat: _est.lat, lng: _est.lng, accuracy: targetAcc, heading: targetH ?? 0 };
    } else {
      _disp.lat       += (_est.lat - _disp.lat) * POS_INTERP_FACTOR;
      _disp.lng       += (_est.lng - _disp.lng) * POS_INTERP_FACTOR;
      _disp.accuracy  += (targetAcc - _disp.accuracy) * ACC_INTERP_FACTOR;
      if (targetH != null) _disp.heading = _rotateAngle(_disp.heading, targetH, HEADING_INTERP_FACTOR);
    }

    for (const cb of _listeners) {
      try { cb(_disp, _raw); } catch (e) { console.error('[LocationTracker]', e); }
    }
  }

  function _onCompass(e) {
    let h = null;
    // iOS Safari provides webkitCompassHeading (true-north, 0..360) and a
    // companion accuracy in degrees (negative = uncalibrated).
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
      h = e.webkitCompassHeading;
      if (typeof e.webkitCompassAccuracy === 'number') _compassAccuracy = e.webkitCompassAccuracy;
    } else if (e.absolute === true && e.alpha != null && !isNaN(e.alpha)) {
      // Only trust alpha when the platform flags it absolute (true-north);
      // relative alpha drifts and would point the camera the wrong way.
      h = (360 - e.alpha) % 360;
    } else if (e.alpha != null && !isNaN(e.alpha) && e.absolute == null) {
      // Older Android Chrome fires plain `deviceorientation` with no
      // `absolute` flag but alpha is magnetometer-backed — accept it.
      h = (360 - e.alpha) % 360;
    }
    if (h == null) return;
    _compassGotSample = true;

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - _compassLastT < COMPASS_MIN_INTERVAL_MS) return;
    _compassLastT = now;

    // Low-pass filter on the raw input — flattens the high-frequency wobble
    // before it reaches the deadzone / interp stage.
    _compassRaw = (_compassRaw == null) ? h : _rotateAngle(_compassRaw, h, COMPASS_SMOOTH_FACTOR);

    // Deadzone — only publish a new heading when it moved meaningfully.
    if (_compassHeading == null) {
      _compassHeading = _compassRaw;
      return;
    }
    let d = _compassRaw - _compassHeading;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    if (Math.abs(d) < COMPASS_DEADZONE_DEG) return;
    _compassHeading = _compassRaw;
  }

  function start(onError) {
    if (_watchId !== null) return true;
    if (!navigator.geolocation) { onError?.({ code: 0, message: 'unsupported' }); return false; }

    _watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const tMs = pos.timestamp || Date.now();
        if (!_ingest(c.latitude, c.longitude, c.accuracy, tMs)) return;
        _raw = {
          lat: c.latitude, lng: c.longitude, accuracy: c.accuracy,
          heading: c.heading, speed: c.speed, t: tMs,
        };
        if (c.heading != null && !isNaN(c.heading)) _gpsHeading = c.heading;
        if (c.speed   != null && !isNaN(c.speed))   _speed      = c.speed;
      },
      (err) => { onError?.(err); },
      // maximumAge:0 — never accept a stale cached fix; that's the #1 source
      // of the "jumps back" bug on Chrome Android.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );

    if (!_rafId) _rafId = requestAnimationFrame(_frame);
    return true;
  }

  // Compass is OFF by default — it's only useful when the camera is following
  // bearing (i.e. during turn-by-turn nav). Attaching it always leaks the
  // gyroscope's twitchy input into the marker heading and any UI that reads
  // _bestHeading() at rest, which is what made the puck feel jittery.
  //
  // Returns a Promise resolving to one of:
  //   'attached'    — listeners attached (no permission gate on this platform)
  //   'granted'     — iOS permission prompt accepted, listeners attached
  //   'denied'      — iOS permission prompt rejected (caller falls back to GPS)
  //   'unsupported' — no DeviceOrientation API at all
  // MUST be invoked from a user gesture on iOS 13+, where requestPermission()
  // only resolves when triggered by a tap.
  function enableCompass() {
    if (_compassEnabled) return Promise.resolve('attached');
    if (typeof window === 'undefined' || !window.DeviceOrientationEvent) {
      return Promise.resolve('unsupported');
    }
    const attach = () => {
      _compassEnabled   = true;
      _compassGotSample = false;
      window.addEventListener('deviceorientationabsolute', _onCompass, { passive: true });
      window.addEventListener('deviceorientation',         _onCompass, { passive: true });
    };
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      return DeviceOrientationEvent.requestPermission()
        .then(state => {
          if (state === 'granted') { attach(); return 'granted'; }
          return 'denied';
        })
        .catch(() => 'denied');
    }
    attach();
    return Promise.resolve('attached');
  }

  function disableCompass() {
    if (!_compassEnabled) return;
    _compassEnabled   = false;
    _compassGotSample = false;
    _compassAccuracy  = null;
    window.removeEventListener('deviceorientationabsolute', _onCompass);
    window.removeEventListener('deviceorientation',         _onCompass);
    _compassHeading = null;
    _compassRaw     = null;
    _compassLastT   = 0;
  }

  function subscribe(cb) { _listeners.add(cb); return () => _listeners.delete(cb); }
  function getDisplay() { return _disp; }
  function getRaw()     { return _raw; }
  function hasFix()     { return !!_disp; }
  function watching()   { return _watchId !== null; }
  function compassEnabled()  { return _compassEnabled; }
  function compassActive()   { return _compassEnabled && _compassGotSample; }
  function compassAccuracy() { return _compassAccuracy; }

  return { start, subscribe, getDisplay, getRaw, hasFix, watching, enableCompass, disableCompass, compassEnabled, compassActive, compassAccuracy };
})();

// ============================================================
// User Location — marker, accuracy circle, auto-follow, nav tracking
// ============================================================
function requestUserLocation() {
  if (LocationTracker.watching()) return;
  if (!navigator.geolocation) { showToast('Location not supported on this device', 'error'); return; }
  showToast('Finding your location…', 'info');
  const started = LocationTracker.start((err) => {
    const msgs = { 1: 'Location access denied — enable in browser settings', 2: 'Location unavailable', 3: 'Location request timed out' };
    showToast(msgs[err.code] || 'Location error', 'warn');
    document.getElementById('btn-locate').classList.remove('location-active', 'location-follow');
  });
  if (!started) return;
  if (!_locationSubscribed) {
    _locationSubscribed = true;
    LocationTracker.subscribe(onLocationFrame);
  }
}

// One subscriber drives every consumer (marker + camera + nav) so there's
// no chance of out-of-order writes between watchPosition callbacks and the
// renderer. Runs at ~60Hz on the rAF loop.
let _locationSubscribed = false;
let _firstFixShown      = false;
let _easingTo           = false;   // throttle camera ease to one in-flight at a time

function onLocationFrame(disp, raw) {
  // Snap to route during active nav — uses smoothed estimate, NOT raw GPS.
  let renderLat = disp.lat, renderLng = disp.lng;
  let snapInfo  = null;

  if (navigationActive && currentRoute) {
    const coords = currentRoute.geometry.coordinates;
    snapInfo = _nearestOnRoute(disp.lat, disp.lng, coords);
    const routeSnapM = 35;
    if (snapInfo.dist < routeSnapM) {
      // Within road buffer → render the puck on the route line itself
      const [x1, y1] = coords[snapInfo.segIdx];
      const next    = coords[snapInfo.segIdx + 1] || coords[snapInfo.segIdx];
      renderLng = x1 + snapInfo.t * (next[0] - x1);
      renderLat = y1 + snapInfo.t * (next[1] - y1);
    } else if (RoadSnap.ready()) {
      // Parallel paths (berm service roads, etc.) can sit 25–35 m from the
      // suggested route. Bias ambient snap toward the current route bearing
      // so the puck doesn't drift onto the wrong parallel road.
      const [x1, y1] = coords[snapInfo.segIdx];
      const next = coords[snapInfo.segIdx + 1] || coords[snapInfo.segIdx];
      const routeBearing = ((Math.atan2(
        (next[0] - x1) * Math.cos(y1 * Math.PI / 180),
        next[1] - y1
      ) * 180 / Math.PI) + 360) % 360;
      const snapped = RoadSnap.snapAligned(disp.lat, disp.lng, disp.accuracy, routeBearing)
        || RoadSnap.snap(disp.lat, disp.lng, disp.accuracy);
      if (snapped) {
        renderLat = snapped.lat;
        renderLng = snapped.lng;
      }
    }
  } else if (RoadSnap.ready()) {
    // Free roaming — snap to nearest road in roads.geojson so the puck
    // doesn't drift onto grass / buildings while the user is on a path.
    const snapped = RoadSnap.snap(disp.lat, disp.lng, disp.accuracy);
    if (snapped) {
      renderLat = snapped.lat;
      renderLng = snapped.lng;
    }
  }

  userLocation = {
    lat: renderLat, lng: renderLng,
    accuracy: disp.accuracy, heading: disp.heading,
    raw, // keep raw available for sharing/precision-sensitive consumers
  };
  // Legacy global kept for code paths that still read it directly
  if (disp.heading != null) headingDeg = disp.heading;

  _renderLocationMarker(renderLat, renderLng, disp.accuracy, disp.heading);

  // Swing the departure compass arrow smoothly as the map/heading updates.
  if (navigationActive) _updateNavArrowHeading();

  if (!_firstFixShown) {
    _firstFixShown = true;
    showToast('Location found', 'success');
    document.getElementById('btn-locate').classList.add('location-active');
    // Follow is OFF by default — the camera only starts tracking once the user
    // taps the locate button (which arms _followRequested). Until then the blue
    // dot is shown but the map stays fully under the user's control.
    if (_followRequested) setAutoFollow(true);
  }

  // Drive nav side-effects (instruction advance / reroute / ETA / camera) ONCE
  // per frame, using the snapped position so off-road jitter doesn't trigger
  // false reroutes. Only when the nav follows the live puck — a fixed-start
  // preview must not advance/reroute off the user's real (off-route) position.
  if (navigationActive && currentRoute && snapInfo && navFollowsUser) {
    _navTick(renderLat, renderLng, snapInfo);
  } else if (autoFollow) {
    _cameraFollow(renderLat, renderLng, disp.heading, /*nav=*/false);
  }
}

function _renderLocationMarker(lat, lng, accuracyM, heading) {
  if (!map) return;
  const lngLat = [lng, lat];

  // Accuracy circle (single GeoJSON source, single layer; never duplicated)
  const data = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: lngLat } }] };
  if (map.getSource('user-accuracy')) {
    map.getSource('user-accuracy').setData(data);
  } else if (map.isStyleLoaded()) {
    map.addSource('user-accuracy', { type: 'geojson', data });
    map.addLayer({
      id: 'user-accuracy-circle', type: 'circle', source: 'user-accuracy',
      paint: {
        'circle-color': '#1a73e8', 'circle-opacity': 0.08,
        'circle-stroke-width': 1, 'circle-stroke-color': '#1a73e8', 'circle-stroke-opacity': 0.18,
        'circle-radius': 12,
      },
    });
  }
  if (map.getLayer('user-accuracy-circle')) {
    const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom());
    const r = Math.max(10, Math.min(120, accuracyM / mpp));
    map.setPaintProperty('user-accuracy-circle', 'circle-radius', r);
  }

  // Bind zoom listener exactly once
  if (!map._locationZoomBound) {
    map._locationZoomBound = true;
    map.on('zoom', () => {
      if (!userLocation || !map.getLayer('user-accuracy-circle')) return;
      const mpp = 156543.03392 * Math.cos(userLocation.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
      map.setPaintProperty('user-accuracy-circle', 'circle-radius',
        Math.max(10, Math.min(120, (userLocation.accuracy || 12) / mpp)));
    });
  }

  // Singleton HTML marker. We REUSE the existing element across updates,
  // which is why the "two pointers" bug could only ever come from a
  // different marker class (routeOriginMarker / directionsFromMarker) —
  // those are now hidden when navigation is active.
  if (!locationMarker) {
    const el = document.createElement('div');
    el.className = 'location-marker';
    el.innerHTML = '<div class="location-heading"></div><div class="location-dot"></div><div class="location-pulse"></div>';
    locationMarker = new maplibregl.Marker({ element: el, anchor: 'center', rotationAlignment: 'map' })
      .setLngLat(lngLat).addTo(map);
  } else {
    locationMarker.setLngLat(lngLat);
  }
  // Rotate the heading cone underneath the dot
  const wrapper = locationMarker.getElement();
  if (heading != null) {
    wrapper.style.setProperty('--loc-heading', `${heading}deg`);
    wrapper.classList.add('has-heading');
  } else {
    wrapper.classList.remove('has-heading');
  }
}

function _cameraFollow(lat, lng, heading, nav) {
  // Skip if a previous ease is still running — overlapping eases are the
  // source of the visible "stutter" the user reported.
  if (_easingTo) return;
  // While plainly following (not turn-by-turn nav), don't fire a fresh ease
  // unless the puck has actually drifted from screen centre. A stationary user
  // otherwise triggers a needless easeTo every frame, which keeps the map in
  // perpetual animation and makes it feel "frozen" / unresponsive to touch.
  // The dragstart/zoomstart handlers still release follow the instant the user
  // grabs the map, so this only removes idle churn.
  if (!nav && map) {
    const c = map.getCenter();
    if (haversine(c.lat, c.lng, lat, lng) < 8) return;   // ~8 m: below GPS jitter
  }
  _easingTo = true;
  const opts = { center: [lng, lat], duration: nav ? 700 : 400, easing: t => t };
  if (nav) {
    if (heading != null) opts.bearing = heading;
    opts.pitch = 65;
    opts.zoom = 18;
    opts.padding = { top: 0, bottom: 280, left: 0, right: 0 };
  } else if (heading != null) {
    opts.bearing = heading;
  }
  const onMoveEnd = () => { _easingTo = false; map.off('moveend', onMoveEnd); };
  map.once('moveend', onMoveEnd);
  map.easeTo(opts);
}

// Single-tick consolidated nav update — replaces the old in-line block
// inside watchPosition. Uses snapped position to avoid spurious reroutes.
function _navTick(lat, lng, snap) {
  const coords = currentRoute.geometry.coordinates;
  const instrs = currentRoute.instructions;
  const { segIdx, t, dist: distToRoute } = snap;

  _updateTraveledOverlay(segIdx, t, coords);

  // Off-route detection with hysteresis. The old 45 m threshold was too
  // loose for the campus: parallel paths are routinely 25-35 m apart,
  // so walking on the road next to the suggested one stayed silently
  // "on route". Now: above 25 m the badge appears immediately; if it
  // stays above 25 m for ~2 s of GPS fixes we trigger a real reroute.
  // This filters spurious one-fix outliers without ignoring a genuine
  // detour.
  const OFFROUTE_M       = 25;
  const OFFROUTE_HOLD_MS = 2000;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (distToRoute > OFFROUTE_M) {
    _showOffRoute(true);
    if (_offRouteSince === 0) _offRouteSince = now;
    if (now - _offRouteSince >= OFFROUTE_HOLD_MS) {
      _offRouteSince = 0;          // reset so the next streak measures itself
      showToast('Rerouting…', 'info');
      reRoute();
      return;
    }
  } else {
    _offRouteSince = 0;
    _showOffRoute(false);
  }

  while (
    navInstructionIndex < instrs.length - 1 &&
    segIdx >= (instrs[navInstructionIndex + 1].coord_index ?? Infinity)
  ) {
    navInstructionIndex++;
  }

  const nextInstr = instrs[navInstructionIndex + 1];
  let distToTurn = null;
  if (nextInstr && nextInstr.coord_index != null) {
    const next = coords[segIdx + 1];
    const midLng = coords[segIdx][0] + t * ((next?.[0] ?? coords[segIdx][0]) - coords[segIdx][0]);
    const midLat = coords[segIdx][1] + t * ((next?.[1] ?? coords[segIdx][1]) - coords[segIdx][1]);
    distToTurn = haversine(midLat, midLng, next?.[1] ?? midLat, next?.[0] ?? midLng);
    for (let k = segIdx + 1; k < nextInstr.coord_index; k++) {
      distToTurn += haversine(coords[k][1], coords[k][0], coords[k + 1][1], coords[k + 1][0]);
    }
  }

  const remDist = _remainingDist(segIdx, t, coords);
  const speedMps = currentRoute.profile === 'driving' ? 8.3 : 1.4;
  const remMin  = Math.max(1, Math.round(remDist / speedMps / 60));
  const verb    = currentRoute.profile === 'driving' ? 'drive' : 'walk';
  document.getElementById('nav-eta').textContent      = `${remMin} min ${verb}`;
  document.getElementById('nav-distance').textContent = formatDist(remDist);

  updateNavInstruction(distToTurn);
  _voiceGuidance(instrs, navInstructionIndex, nextInstr, distToTurn, remDist);

  if (autoFollow) {
    _cameraFollow(lat, lng, userLocation.heading, /*nav=*/true);
    if (immersiveNav) applyImmersiveBuildingFade([lng, lat]);
  }
}

function setAutoFollow(on) {
  autoFollow = on;
  _followRequested = on;
  const btn = document.getElementById('btn-locate');
  btn.classList.toggle('location-follow', on);
  if (on && userLocation) {
    // Use a SINGLE ease (not a flyTo + later easeTo race)
    _easingTo = false;
    _cameraFollow(userLocation.lat, userLocation.lng, userLocation.heading, /*nav=*/navigationActive);
  }
}

// Turn the gyroscope on with graceful fallback + calibration UX. Safe to call
// from any user gesture (Start tap, locate button). Resolves the permission
// promise so iOS denials degrade to GPS heading instead of failing silently.
let _calibHintShown = false;
function _enableCompassWithUX() {
  if (LocationTracker.compassEnabled()) return;
  Promise.resolve(LocationTracker.enableCompass()).then(status => {
    if (status === 'denied') {
      showToast('Compass blocked — using GPS heading', 'warn');
      return;
    }
    if (status === 'unsupported') return;  // GPS heading covers movement
    // Listeners attached. Give the sensor a moment, then sanity-check it.
    setTimeout(() => {
      if (!navigationActive || !LocationTracker.compassEnabled()) return;
      if (!LocationTracker.compassActive()) {
        // No orientation events arrived — desktop or sensor-less device.
        // Stay quiet; the GPS heading still steers the camera while moving.
        return;
      }
      const acc = LocationTracker.compassAccuracy();
      if (!_calibHintShown && acc != null && (acc < 0 || acc > 30)) {
        _calibHintShown = true;
        showToast('Compass needs calibration — move phone in a figure 8', 'info');
      }
    }, 2500);
  });
}

function flyToUserLocation() {
  if (!LocationTracker.watching()) {
    // Arm follow now so that when the very first fix arrives the camera starts
    // tracking — one tap = start GPS + follow.
    _followRequested = true;
    requestUserLocation();
    // First click ever — if we happen to already be in directions, opt the
    // user straight into heading-tracked follow.
    if (navigationActive) _enableCompassWithUX();
    return;
  }
  if (autoFollow) {
    // During directions, the first click while already following enables the
    // gyroscope ("follow with heading" — same gesture Google Maps uses).
    // A second click then turns everything off.
    if (navigationActive && !LocationTracker.compassEnabled()) {
      _enableCompassWithUX();
      showToast('Following heading', 'info');
    } else {
      setAutoFollow(false);
      LocationTracker.disableCompass();
      showToast('Auto-follow off', 'info');
    }
  } else {
    setAutoFollow(true);
    if (navigationActive) _enableCompassWithUX();
    if (!userLocation) showToast('Waiting for GPS signal…', 'info');
    else showToast('Following your location', 'info');
  }
}

// Re-add location layers after style reload — the HTML marker survives
// (it's not attached to a style layer), so we ONLY clean up the GeoJSON
// circle. Killing the marker here was a separate bug: it briefly left no
// pointer at all, then a new one popped in after the next GPS tick.
function restoreLocationLayer() {
  if (!userLocation) return;
  if (map.getSource('user-accuracy')) {
    try { map.removeLayer('user-accuracy-circle'); } catch (_) {}
    try { map.removeSource('user-accuracy'); } catch (_) {}
  }
  map._locationZoomBound = false;
  _renderLocationMarker(userLocation.lat, userLocation.lng, userLocation.accuracy || 12, userLocation.heading);
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
    setSatCalibration(false);
    map.setMaxZoom(19);
    if (!nightModeManual) isDark = isCampusNight();
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : '');
  }
  showToast(isSatellite ? 'Satellite view' : 'Map view', 'info');
  await applyMapStyle();
  syncMapBodyClasses();
}

async function toggleDarkMode() {
  if (isSatellite) {
    isSatellite = false;
    showToast('Switched to map view', 'info');
  }
  nightModeManual = true;
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : '');
  await applyMapStyle();
  syncMapBodyClasses();
  updateBaseMapButtons();
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
  t.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(msg)}</span>`;
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
  t.innerHTML = `<span class="toast-spinner"></span><span>${escapeHtml(msg)}</span>`;
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
  document.getElementById('nav-recenter-btn')?.addEventListener('click', recenterImmersive);
  setupVoiceToggle();

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
    handleSatOffsetCalibration(e);
  });
}

// Calibrate the satellite imagery offset live. In satellite view, press "O" to
// toggle calibration mode; while it's on, the plain Arrow keys nudge the
// imagery 1 m in that direction (Shift = fine 0.25 m steps) and "0" resets.
// (We avoid OS-reserved combos like Alt+Shift, which Windows hijacks to switch
// keyboard layout.) The map's own arrow-pan is disabled while calibrating, and
// the chosen value persists in localStorage + logs so it can be baked into
// SAT_OFFSET_DEFAULT for everyone.
let satCalibrating = false;

function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function setSatCalibration(on) {
  satCalibrating = on && isSatellite;
  if (!map) return;
  if (satCalibrating) map.keyboard.disable(); else map.keyboard.enable();
  let badge = document.getElementById('sat-calib-badge');
  if (satCalibrating) {
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'sat-calib-badge';
      badge.style.cssText = 'position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:9999;'
        + 'background:rgba(20,20,22,.92);color:#fff;font:600 13px/1.4 system-ui,sans-serif;'
        + 'padding:8px 14px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:none;text-align:center';
      document.body.appendChild(badge);
    }
    updateSatCalibBadge();
  } else if (badge) {
    badge.remove();
  }
}

function updateSatCalibBadge() {
  const badge = document.getElementById('sat-calib-badge');
  if (badge) {
    badge.innerHTML = `Imagery calibration · x:${satOffset.x.toFixed(2)} y:${satOffset.y.toFixed(2)} m`
      + `<br><span style="opacity:.7;font-weight:400">Arrows move · Shift=fine · 0=reset · O=exit</span>`;
  }
}

function handleSatOffsetCalibration(e) {
  if (isTypingTarget(document.activeElement)) return;

  // Toggle calibration mode with "O" (only meaningful in satellite view).
  if ((e.key === 'o' || e.key === 'O') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!isSatellite) return;
    e.preventDefault();
    setSatCalibration(!satCalibrating);
    showToast(satCalibrating ? 'Imagery calibration ON' : 'Imagery calibration off', 'info', 1600);
    return;
  }

  if (!satCalibrating || !isSatellite) return;
  const step = e.shiftKey ? 0.25 : 1; // metres per nudge
  let handled = true;
  switch (e.key) {
    case 'ArrowRight': satOffset.x -= step; break; // move imagery east
    case 'ArrowLeft':  satOffset.x += step; break; // move imagery west
    case 'ArrowUp':    satOffset.y -= step; break; // move imagery north
    case 'ArrowDown':  satOffset.y += step; break; // move imagery south
    case '0': case ')': satOffset = { ...SAT_OFFSET_DEFAULT }; break;
    default: handled = false;
  }
  if (!handled) return;
  e.preventDefault();
  saveSatOffset();
  refreshSatelliteTiles();
  updateSatCalibBadge();
  console.log('[sat-offset] SAT_OFFSET_DEFAULT =', JSON.stringify(satOffset));
}

function openMenu()  { document.getElementById('side-menu').classList.remove('hidden'); document.getElementById('menu-overlay').classList.remove('hidden'); }
function closeMenu() { document.getElementById('side-menu').classList.add('hidden');    document.getElementById('menu-overlay').classList.add('hidden');    }

// ============================================================
// Utilities
// ============================================================
// Cached media-query for users who asked the OS to reduce motion — we skip
// the route-draw / pulse animations for them.
let _rmQuery = null;
function prefersReducedMotion() {
  if (!_rmQuery && typeof window.matchMedia === 'function') {
    _rmQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  }
  return !!(_rmQuery && _rmQuery.matches);
}

// Parse an OSM opening_hours string into a live "open now" status. Handles the
// shapes present in our data: 24/7, plain "HH:MM-HH:MM[,…]", and day-scoped
// rules ("Mo-Su 07:00-23:00", "Mo-Fr 09:00-17:00; Sa 09:00-13:00").
function getOpenStatus(oh) {
  if (!oh) return null;
  oh = String(oh).trim();
  if (oh === '24/7' || /24\/7/.test(oh)) return { open: true, label: 'Open 24/7', sub: '', cls: 'open' };

  const now = new Date();
  const today = now.getDay();                      // 0=Sun … 6=Sat
  const mins = now.getHours() * 60 + now.getMinutes();
  const DAY = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
  const fmt = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  let openNow = false, closeAt = null, nextOpen = null, sawValid = false;

  for (const rule of oh.split(';').map(s => s.trim()).filter(Boolean)) {
    const m = rule.match(/^([A-Za-z,\-\s]+?)\s+([\d:\-,\s]+)$/);
    const dayPart = m ? m[1].trim() : null;
    const timePart = m ? m[2].trim() : rule;       // no day spec → every day

    let applies = true;
    if (dayPart) {
      applies = false;
      for (const tok of dayPart.split(',').map(s => s.trim())) {
        if (tok.includes('-')) {
          const [a, b] = tok.split('-').map(s => s.trim());
          if (DAY[a] == null || DAY[b] == null) continue;
          for (let d = DAY[a]; ; d = (d + 1) % 7) { if (d === today) applies = true; if (d === DAY[b]) break; }
        } else if (DAY[tok] === today) { applies = true; }
      }
    }
    if (!applies) continue;

    for (const tr of timePart.split(',').map(s => s.trim())) {
      const tm = tr.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!tm) continue;
      sawValid = true;
      const start = (+tm[1]) * 60 + (+tm[2]);
      let end = (+tm[3]) * 60 + (+tm[4]);
      if (end === 0) end = 1440;                   // 00:00 close = midnight
      if (mins >= start && mins < end) { openNow = true; closeAt = Math.max(closeAt ?? 0, end); }
      else if (mins < start) { nextOpen = nextOpen == null ? start : Math.min(nextOpen, start); }
    }
  }

  if (!sawValid) return null;
  if (openNow) return { open: true, label: 'Open now', sub: closeAt != null ? `· until ${fmt(closeAt)}` : '', cls: 'open' };
  if (nextOpen != null) return { open: false, label: 'Closed', sub: `· opens ${fmt(nextOpen)}`, cls: 'closed' };
  return { open: false, label: 'Closed now', sub: '', cls: 'closed' };
}

// ── Favorites & Recents (localStorage) ───────────────────────────────
// Small, self-contained store. Each entry is a slim place ref so it survives
// data reloads: { name, category, lat, lng, description }.
const FAVORITES_KEY = 'iitj-favorites-v1';
const RECENTS_KEY   = 'iitj-recents-v1';
const RECENTS_MAX   = 8;

function _loadList(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { return []; } }
function _saveList(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch (_) {} }
function _placeRef(p) {
  return { name: p.name, category: p.category || 'other',
    lat: +Number(p.lat).toFixed(6), lng: +Number(p.lng).toFixed(6),
    description: p.description || null };
}
// Same place if the names match (case-insensitive) OR the coordinates nearly
// coincide. Name-first matters because the same place opened from its building
// polygon vs. its POI point has slightly different coords — without this they'd
// pile up as duplicate recents (the "three New Mess" bug).
function _samePlace(a, b) {
  if (!a || !b) return false;
  const na = (a.name || '').trim().toLowerCase();
  const nb = (b.name || '').trim().toLowerCase();
  if (na && na === nb) return true;
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
}

function getFavorites() { return _loadList(FAVORITES_KEY); }
function isFavorite(p) { return getFavorites().some(f => _samePlace(f, p)); }
function toggleFavorite(p) {
  if (!p || p.lat == null || p.lng == null || !p.name || p.name === 'Dropped Pin') return false;
  const list = getFavorites();
  const i = list.findIndex(f => _samePlace(f, p));
  let added;
  if (i >= 0) { list.splice(i, 1); added = false; }
  else { list.unshift(_placeRef(p)); added = true; }
  _saveList(FAVORITES_KEY, list);
  return added;
}
function getRecents() {
  // Dedupe by name on read so any duplicates already saved in a browser
  // (from before the name-based dedupe) collapse to one.
  const seen = new Set();
  return _loadList(RECENTS_KEY).filter(r => {
    const k = (r.name || '').trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
}
function pushRecent(p) {
  if (!p || p.lat == null || p.lng == null || !p.name || p.name === 'Dropped Pin') return;
  let list = getRecents().filter(r => !_samePlace(r, p));
  list.unshift(_placeRef(p));
  _saveList(RECENTS_KEY, list.slice(0, RECENTS_MAX));
}

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
    return;
  }

  // ?place=Library  — resolve by name when no coordinates were given. Lets you
  // share a clean, human-readable link ("meet me here") without coordinates.
  if (placeParam) {
    const resolve = () => {
      const place = IITJData.getPlaceByName(placeParam);
      if (place) {
        map.flyTo({ center: [place.lng, place.lat], zoom, duration: 800 });
        setTimeout(() => showPlaceDetail({ ...place, _noFly: true }), 850);
      } else {
        showToast(`Couldn't find "${placeParam}"`, 'warn');
      }
    };
    if (IITJData.isReady()) resolve(); else IITJData.onReady(resolve);
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
  // Tell the boot watchdog (inline in index.html) we booted cleanly so it
  // stands down and resets its one-shot recovery guard.
  try { window.dispatchEvent(new Event('iitj-booted')); } catch (_) {}
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.style.transition = 'opacity 0.5s ease';
  splash.style.opacity = '0';
  document.getElementById('app').classList.remove('hidden');
  setTimeout(() => splash.remove(), 500);
}

document.addEventListener('DOMContentLoaded', init);

// Offline/PWA service worker was removed — it could wedge the app on slow
// connections (a fresh load worked, the next SW-controlled load hung). We no
// longer register one, and we proactively dismantle any worker + caches a
// device still has from a previous version so nothing stale can intercept
// requests. /sw.js is now a self-unregistering kill switch as a second path
// for devices whose app.js never even runs.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()))
    .catch(() => {});
}
if (window.caches && caches.keys) {
  caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
}
