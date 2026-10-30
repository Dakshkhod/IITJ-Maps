/**
 * Anonymous usage + consented precise-location telemetry.
 *
 * Public clients can only write their own random, tab-scoped session snapshot.
 * Reads are deliberately not exposed here; the protected /api/admin endpoint
 * is the only way to retrieve telemetry.
 *
 * Required Vercel env var (injected by the Neon integration): DATABASE_URL.
 */

const telemetryDb = require('../lib/telemetry-db');

const MAX_BODY_BYTES = 96_000;
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

function safeText(value, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function finiteNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function safeTimestamp(value, fallback) {
  const number = finiteNumber(value, Date.now() - SESSION_TTL_SEC * 1000, Date.now() + 60_000);
  return number == null ? fallback : Math.round(number);
}

function safeCoordinatePair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = finiteNumber(value[0], -180, 180);
  const lat = finiteNumber(value[1], -90, 90);
  return lng == null || lat == null ? null : [lng, lat];
}

function safePoint(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = finiteNumber(value.lat, -90, 90);
  const lng = finiteNumber(value.lng, -180, 180);
  if (lat == null || lng == null) return null;
  const point = {
    lat,
    lng,
    at: safeTimestamp(value.at, Date.now()),
  };
  const accuracy = finiteNumber(value.accuracy, 0, 10_000);
  if (accuracy != null) point.accuracy = accuracy;
  return point;
}

function safePath(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-240).map(safePoint).filter(Boolean);
}

function safeRoute(value) {
  if (!value || typeof value !== 'object') return null;
  const route = {
    from: safeText(value.from, 100) || 'Start',
    to: safeText(value.to, 100) || 'Destination',
    mode: value.mode === 'walk' ? 'walk' : 'drive',
    distance: finiteNumber(value.distance, 0, 1_000_000) || 0,
    etaMinutes: finiteNumber(value.etaMinutes, 0, 24 * 60) || 0,
    calculatedAt: safeTimestamp(value.calculatedAt, Date.now()),
    navigationStartedAt: value.navigationStartedAt
      ? safeTimestamp(value.navigationStartedAt, Date.now())
      : null,
    navigationEndedAt: value.navigationEndedAt
      ? safeTimestamp(value.navigationEndedAt, Date.now())
      : null,
  };
  if (Array.isArray(value.geometry)) {
    route.geometry = value.geometry.slice(0, 180).map(safeCoordinatePair).filter(Boolean);
  } else {
    route.geometry = [];
  }
  return route;
}

function safeRoutes(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).map(safeRoute).filter(Boolean);
}

function decodeHeader(value) {
  if (!value) return '';
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

function approximateLocation(req) {
  const lat = finiteNumber(req.headers['x-vercel-ip-latitude'], -90, 90);
  const lng = finiteNumber(req.headers['x-vercel-ip-longitude'], -180, 180);
  return {
    city: safeText(decodeHeader(req.headers['x-vercel-ip-city']), 80),
    region: safeText(decodeHeader(req.headers['x-vercel-ip-country-region']), 40),
    country: safeText(req.headers['x-vercel-ip-country'], 2).toUpperCase(),
    timezone: safeText(decodeHeader(req.headers['x-vercel-ip-timezone']), 80),
    ...(lat != null && lng != null ? { lat, lng } : {}),
  };
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // sendBeacon/page-dismiss and some same-origin clients
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch (_) { return false; }
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) return null;
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return await new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data, 'utf8') > MAX_BODY_BYTES) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return resolve(null);
      try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  if (!sameOrigin(req)) {
    res.statusCode = 403;
    return res.end(JSON.stringify({ error: 'Cross-origin telemetry is not accepted' }));
  }

  const body = await readJsonBody(req);
  if (body === null) {
    res.statusCode = 413;
    return res.end(JSON.stringify({ error: 'Payload too large' }));
  }
  const sessionId = safeText(body && body.sessionId, 64).toLowerCase();
  if (!/^[a-f0-9-]{16,64}$/.test(sessionId)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Invalid session' }));
  }

  const now = Date.now();
  const preciseOptIn = body.preciseOptIn === true;
  const session = {
    version: 1,
    sessionId,
    startedAt: safeTimestamp(body.startedAt, now),
    lastSeen: now,
    endedAt: body.ended === true ? now : null,
    visible: body.visible !== false,
    approximate: approximateLocation(req),
    preciseOptIn,
    precise: preciseOptIn ? safePoint(body.precise) : null,
    path: preciseOptIn ? safePath(body.path) : [],
    routes: safeRoutes(body.routes),
    routeCalculations: Math.round(finiteNumber(body.routeCalculations, 0, 10_000) || 0),
  };

  try {
    // Telemetry is optional infrastructure: the map must keep working if a
    // deployment has not connected Neon yet.
    if (!telemetryDb.configured()) {
      res.statusCode = 204;
      return res.end('');
    }
    await telemetryDb.ensureSchema();
    const sql = telemetryDb.sql();
    const oldest = now - SESSION_TTL_SEC * 1000;
    await sql`
      WITH expired AS (
        DELETE FROM iitj_telemetry_sessions
        WHERE last_seen < ${oldest}
      )
      INSERT INTO iitj_telemetry_sessions (
        session_id, started_at, last_seen, ended_at, visible,
        approximate, precise_opt_in, precise, path, routes, route_calculations
      ) VALUES (
        ${session.sessionId}, ${session.startedAt}, ${session.lastSeen}, ${session.endedAt}, ${session.visible},
        ${JSON.stringify(session.approximate)}::jsonb,
        ${session.preciseOptIn}, ${JSON.stringify(session.precise)}::jsonb,
        ${JSON.stringify(session.path)}::jsonb, ${JSON.stringify(session.routes)}::jsonb,
        ${session.routeCalculations}
      )
      ON CONFLICT (session_id) DO UPDATE SET
        started_at = EXCLUDED.started_at,
        last_seen = EXCLUDED.last_seen,
        ended_at = EXCLUDED.ended_at,
        visible = EXCLUDED.visible,
        approximate = EXCLUDED.approximate,
        precise_opt_in = EXCLUDED.precise_opt_in,
        precise = EXCLUDED.precise,
        path = EXCLUDED.path,
        routes = EXCLUDED.routes,
        route_calculations = EXCLUDED.route_calculations
    `;
    res.statusCode = 202;
    return res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error('[telemetry/write]', error && error.message ? error.message : error);
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: 'Telemetry store unavailable' }));
  }
};
