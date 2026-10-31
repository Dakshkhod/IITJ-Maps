(function () {
  'use strict';

  const ENDPOINT = '/api/telemetry';
  const HEARTBEAT_MS = 15_000;
  const PATH_MIN_INTERVAL_MS = 8_000;
  const PATH_MIN_DISTANCE_M = 5;
  const SESSION_ID_KEY = 'iitj-telemetry-session-id-v1';
  const SESSION_START_KEY = 'iitj-telemetry-session-start-v1';
  const PRECISE_OPT_IN_KEY = 'iitj-precise-telemetry-opt-in-v1';
  const visitorId = window.IITJTelemetryIdentity?.getVisitorId(window) || null;

  function randomSessionId() {
    const webCrypto = window.crypto;
    if (webCrypto && typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
      webCrypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  let sessionId;
  let startedAt;
  try {
    sessionId = sessionStorage.getItem(SESSION_ID_KEY) || randomSessionId();
    startedAt = Number(sessionStorage.getItem(SESSION_START_KEY)) || Date.now();
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    sessionStorage.setItem(SESSION_START_KEY, String(startedAt));
  } catch (_) {
    sessionId = randomSessionId();
    startedAt = Date.now();
  }

  let preciseOptIn = false;
  try { preciseOptIn = sessionStorage.getItem(PRECISE_OPT_IN_KEY) === 'yes'; } catch (_) {}
  let precise = null;
  let path = [];
  let routes = [];
  let routeCalculations = 0;
  let lastSentAt = 0;
  let sending = false;
  let dirty = true;

  function finite(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function haversine(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function simplifyCoordinates(coordinates, limit = 180) {
    if (!Array.isArray(coordinates)) return [];
    const valid = coordinates.filter((pair) => Array.isArray(pair) && pair.length >= 2 &&
      Number.isFinite(Number(pair[0])) && Number.isFinite(Number(pair[1])));
    if (valid.length <= limit) return valid.map((pair) => [Number(pair[0]), Number(pair[1])]);
    const result = [];
    const step = (valid.length - 1) / (limit - 1);
    for (let index = 0; index < limit; index++) {
      const pair = valid[Math.round(index * step)];
      result.push([Number(pair[0]), Number(pair[1])]);
    }
    return result;
  }

  function snapshot(ended) {
    return {
      sessionId,
      ...(visitorId ? { visitorId } : {}),
      startedAt,
      visible: document.visibilityState === 'visible',
      ended: ended === true,
      preciseOptIn,
      precise: preciseOptIn ? precise : null,
      path: preciseOptIn ? path.slice(-240) : [],
      routes: routes.slice(-8),
      routeCalculations,
    };
  }

  function send({ ended = false, beacon = false, force = false } = {}) {
    const now = Date.now();
    if (!force && !dirty && now - lastSentAt < HEARTBEAT_MS) return;
    if (sending && !ended) {
      dirty = true;
      return;
    }
    const body = JSON.stringify(snapshot(ended));
    dirty = false;
    lastSentAt = now;

    if (beacon && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
        return;
      } catch (_) { /* fall through to fetch */ }
    }
    sending = true;
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'same-origin',
      keepalive: ended,
    }).catch(() => {
      // Analytics must never interrupt navigation or surface errors to users.
      dirty = true;
    }).finally(() => { sending = false; });
  }

  function grantPreciseLocation() {
    if (preciseOptIn) return;
    preciseOptIn = true;
    try { sessionStorage.setItem(PRECISE_OPT_IN_KEY, 'yes'); } catch (_) {}
    dirty = true;
    send({ force: true });
  }

  function revokePreciseLocation() {
    preciseOptIn = false;
    precise = null;
    path = [];
    try { sessionStorage.removeItem(PRECISE_OPT_IN_KEY); } catch (_) {}
    dirty = true;
    send({ force: true });
  }

  function location(point) {
    if (!preciseOptIn || !point) return;
    const next = {
      lat: finite(point.lat),
      lng: finite(point.lng),
      accuracy: Math.max(0, finite(point.accuracy, 0)),
      at: Date.now(),
    };
    if (next.lat == null || next.lng == null) return;
    precise = next;
    const previous = path[path.length - 1];
    if (!previous || next.at - previous.at >= PATH_MIN_INTERVAL_MS ||
        haversine(previous, next) >= PATH_MIN_DISTANCE_M) {
      path.push(next);
      if (path.length > 240) path = path.slice(-240);
      dirty = true;
    }
  }

  function routeCalculated(route) {
    if (!route) return;
    routeCalculations++;
    const entry = {
      from: String(route.from || 'Start').slice(0, 100),
      to: String(route.to || 'Destination').slice(0, 100),
      mode: route.mode === 'walk' ? 'walk' : 'drive',
      distance: Math.max(0, finite(route.distance, 0)),
      etaMinutes: Math.max(0, finite(route.etaMinutes, 0)),
      calculatedAt: Date.now(),
      navigationStartedAt: null,
      navigationEndedAt: null,
      geometry: simplifyCoordinates(route.geometry),
    };
    routes.push(entry);
    if (routes.length > 8) routes = routes.slice(-8);
    dirty = true;
    send({ force: true });
  }

  function navigationStarted() {
    const route = routes[routes.length - 1];
    if (!route) return;
    route.navigationStartedAt = Date.now();
    route.navigationEndedAt = null;
    dirty = true;
    send({ force: true });
  }

  function navigationEnded() {
    const route = [...routes].reverse().find((item) => item.navigationStartedAt && !item.navigationEndedAt);
    if (!route) return;
    route.navigationEndedAt = Date.now();
    dirty = true;
    send({ force: true });
  }

  document.addEventListener('visibilitychange', () => send({ force: true }));
  window.addEventListener('pagehide', () => send({ ended: true, beacon: true, force: true }));
  setInterval(() => send({ force: true }), HEARTBEAT_MS);

  window.IITJTelemetry = {
    grantPreciseLocation,
    revokePreciseLocation,
    isPreciseOptedIn: () => preciseOptIn,
    location,
    routeCalculated,
    navigationStarted,
    navigationEnded,
    flush: () => send({ force: true }),
  };

  send({ force: true });
})();
