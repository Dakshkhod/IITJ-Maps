/**
 * Road classification core — SINGLE SOURCE OF TRUTH, shared by:
 *   • the offline pipeline (backend/scripts/road-classifier.js re-exports this)
 *   • the browser router (web/js/routing.js), which re-classifies admin-overlay
 *     roads at load time so an accepted OSM retag actually changes routing.
 *
 * The overlay stores raw OSM tags (highway/foot/bicycle) but NOT the derived
 * routing fields (vehicle_access, drive_confidence, drive_penalty). Those must
 * be re-derived, and they have to be derived the SAME way the prebuilt graph
 * was built — hence one shared module instead of a client-side copy that drifts.
 *
 * Keep this dependency-free and browser-safe: no require(), no Node globals.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IITJRoadClassifier = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
const CAMPUS_BOUNDS = {
  minLat: 26.45847, maxLat: 26.48675,
  minLng: 73.10762, maxLng: 73.12599,
};

const VEHICLE_TYPES = new Set([
  'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'service',
]);

const PEDESTRIAN_TYPES = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway']);
const NO_VALUES = new Set(['no', 'private', 'agricultural', 'forestry']);
const YES_VALUES = new Set(['yes', 'designated', 'permissive', 'destination']);
const PAVED_SURFACES = new Set(['paved', 'asphalt', 'concrete', 'paving_stones', 'sett']);
const UNPAVED_SURFACES = new Set(['unpaved', 'ground', 'dirt', 'earth', 'sand', 'gravel', 'compacted']);

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function featureLengthM(feature) {
  const coords = feature?.geometry?.coordinates || [];
  let length = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    length += haversine(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  return length;
}

function isInsideCampus(feature) {
  const coords = feature?.geometry?.coordinates || [];
  return coords.some(([lng, lat]) =>
    lng >= CAMPUS_BOUNDS.minLng && lng <= CAMPUS_BOUNDS.maxLng &&
    lat >= CAMPUS_BOUNDS.minLat && lat <= CAMPUS_BOUNDS.maxLat
  );
}

function norm(v) {
  return String(v || '').trim().toLowerCase();
}

function oneWayValue(v) {
  const s = norm(v);
  return s === 'yes' || s === '1' || s === 'true';
}

function explicitVehicleBlocked(p) {
  return NO_VALUES.has(norm(p.motorcar)) ||
    NO_VALUES.has(norm(p.motor_vehicle)) ||
    NO_VALUES.has(norm(p.vehicle)) ||
    NO_VALUES.has(norm(p.access));
}

function explicitVehicleAllowed(p) {
  return YES_VALUES.has(norm(p.motorcar)) ||
    YES_VALUES.has(norm(p.motor_vehicle)) ||
    YES_VALUES.has(norm(p.vehicle));
}

function classifyRoadFeature(feature) {
  const p = feature.properties || {};
  const type = norm(p.highway_type || p.highway);
  const surface = norm(p.surface);
  const lanes = Number.parseFloat(p.lanes);
  const service = norm(p.service);
  const lengthM = featureLengthM(feature);
  const insideCampus = isInsideCampus(feature);

  const base = {
    is_campus: insideCampus,
    length_m: Math.round(lengthM),
    walk_access: 'yes',
    vehicle_access: 'no',
    navigation_class: 'unknown',
    drive_confidence: 0,
    drive_penalty: null,
    drive_note: '',
  };

  if (!type) {
    return {
      ...base,
      navigation_class: 'unknown',
      drive_confidence: 0.15,
      drive_note: 'Missing highway type; not used for vehicle routing.',
    };
  }

  if (PEDESTRIAN_TYPES.has(type)) {
    const cls = type === 'cycleway' ? 'cycle_pedestrian' : (type === 'steps' ? 'stairs' : 'pedestrian_path');
    return {
      ...base,
      navigation_class: cls,
      drive_note: `${type} is excluded from vehicle routing.`,
    };
  }

  if (type === 'track') {
    return {
      ...base,
      navigation_class: 'maintenance_track',
      drive_confidence: surface && !UNPAVED_SURFACES.has(surface) ? 0.35 : 0.2,
      drive_note: 'Track/maintenance alignment; excluded from normal vehicle routing.',
    };
  }

  if (type === 'road' || type === 'unknown') {
    return {
      ...base,
      navigation_class: 'ambiguous_road',
      drive_confidence: 0.35,
      drive_note: 'Ambiguous OSM road type; flagged instead of assuming car access.',
    };
  }

  if (explicitVehicleBlocked(p)) {
    return {
      ...base,
      navigation_class: 'restricted_vehicle',
      drive_confidence: 0.1,
      drive_note: 'OSM access tag blocks private motor vehicle use.',
    };
  }

  if (type === 'trunk' || type === 'primary' || type === 'secondary') {
    return {
      ...base,
      vehicle_access: 'yes',
      navigation_class: 'major_vehicle_road',
      drive_confidence: 0.98,
      drive_penalty: 1.0,
      drive_note: 'Major paved vehicle road.',
    };
  }

  if (type.endsWith('_link') || type === 'tertiary') {
    return {
      ...base,
      vehicle_access: 'yes',
      navigation_class: 'vehicle_connector',
      drive_confidence: 0.94,
      drive_penalty: 1.05,
      drive_note: 'Vehicle connector/link road.',
    };
  }

  if (type === 'unclassified') {
    return {
      ...base,
      vehicle_access: 'yes',
      navigation_class: insideCampus ? 'campus_main_road' : 'local_through_road',
      drive_confidence: insideCampus ? 0.9 : 0.84,
      drive_penalty: insideCampus ? 1.08 : 1.15,
      drive_note: 'General vehicle road; preferred over service roads.',
    };
  }

  if (type === 'residential') {
    return {
      ...base,
      vehicle_access: 'yes',
      navigation_class: insideCampus ? 'campus_standard_road' : 'local_street',
      drive_confidence: insideCampus ? 0.86 : 0.82,
      drive_penalty: insideCampus ? 1.22 : 1.3,
      drive_note: 'Standard vehicle-access road.',
    };
  }

  if (type === 'service') {
    // Genuine access-only spurs: only when OSM explicitly says so via a
    // driveway / parking-aisle / alley subtype. These dead-end at a building
    // or lot, so keep them destination-access (used only when the route's
    // endpoint is on them) and heavily penalized.
    if (service === 'parking_aisle' || service === 'driveway' || service === 'alley') {
      return {
        ...base,
        vehicle_access: explicitVehicleAllowed(p) ? 'yes' : 'destination',
        navigation_class: 'service_access',
        drive_confidence: 0.58,
        drive_penalty: 4.2,
        drive_note: 'Parking aisle / driveway / alley; access-only spur.',
      };
    }

    // Everything else tagged highway=service inside the campus is a real,
    // drivable internal road. OSM splits the continuous campus road network
    // into many short ways at junctions and gates, so SEGMENT LENGTH IS NOT a
    // driveway signal — a 40 m stretch between two gates is still a through
    // road. Classify all as drivable (vehicle_access=yes) and rely on the
    // drive_penalty to keep cars on main/residential roads where one exists.
    // access=private/no is already handled by explicitVehicleBlocked() above.
    const paved   = PAVED_SURFACES.has(surface);
    const unpaved = UNPAVED_SURFACES.has(surface);
    const twoLane = Number.isFinite(lanes) && lanes >= 2;

    let confidence, penalty;
    if (twoLane || paved) { confidence = twoLane ? 0.80 : 0.76; penalty = twoLane ? 1.8 : 2.0; }
    else if (lanes === 1) { confidence = 0.64;                  penalty = 3.0; }
    else                  { confidence = 0.70;                  penalty = 2.5; }
    if (unpaved) { confidence = Math.min(confidence, 0.60); penalty += 0.7; }

    return {
      ...base,
      vehicle_access: 'yes',
      navigation_class: (twoLane || paved) ? 'campus_service_road' : 'campus_service_connector',
      drive_confidence: confidence,
      drive_penalty: penalty,
      drive_note: 'Drivable campus service road; penalized below main/residential roads.',
    };
  }

  if (VEHICLE_TYPES.has(type)) {
    return {
      ...base,
      vehicle_access: 'yes',
      navigation_class: 'vehicle_road',
      drive_confidence: 0.72,
      drive_penalty: 1.8,
      drive_note: 'Vehicle-capable type with default penalty.',
    };
  }

  return {
    ...base,
    navigation_class: 'non_vehicle_route',
    drive_confidence: 0.2,
    drive_note: `Highway type ${type} is not enabled for vehicle routing.`,
  };
}

function enrichRoadFeature(feature) {
  const classification = classifyRoadFeature(feature);
  return {
    ...feature,
    properties: {
      ...feature.properties,
      ...classification,
    },
  };
}

  return {
    CAMPUS_BOUNDS,
    VEHICLE_TYPES,
    PEDESTRIAN_TYPES,
    haversine,
    featureLengthM,
    isInsideCampus,
    oneWayValue,
    classifyRoadFeature,
    enrichRoadFeature,
  };
}));
