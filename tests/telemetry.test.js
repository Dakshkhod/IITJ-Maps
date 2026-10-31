const test = require('node:test');
const assert = require('node:assert/strict');

const telemetryDb = require('../lib/telemetry-db');
const telemetryHandler = require('../api/telemetry');
const adminHandler = require('../api/admin');
const identity = require('../web/js/telemetry-identity');

const originalDb = {
  configured: telemetryDb.configured,
  ensureSchema: telemetryDb.ensureSchema,
  sql: telemetryDb.sql,
};

function request(body, headers = {}) {
  return {
    method: 'POST',
    headers: { host: 'iitj.example', origin: 'https://iitj.example', ...headers },
    body,
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = '') { this.body = value; },
    json() { return this.body ? JSON.parse(this.body) : null; },
  };
}

function mockDatabase(results = []) {
  const calls = [];
  const queue = [...results];
  telemetryDb.configured = () => true;
  telemetryDb.ensureSchema = async () => {};
  telemetryDb.sql = () => async (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return queue.length ? queue.shift() : [];
  };
  return calls;
}

function restoreDatabase() {
  Object.assign(telemetryDb, originalDb);
}

test('public telemetry validates anonymous session IDs', async () => {
  const res = response();
  await telemetryHandler(request({ sessionId: 'not-valid' }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Invalid session/);
});

test('browser identity reuses a valid visitor ID and replaces a corrupt one', () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
  };
  const crypto = { randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };

  const first = identity.getOrCreateVisitorId(storage, crypto);
  const second = identity.getOrCreateVisitorId(storage, crypto);
  assert.equal(first, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.equal(second, first);

  values.set(identity.VISITOR_ID_KEY, 'corrupt');
  assert.equal(identity.getOrCreateVisitorId(storage, crypto), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
});

test('browser identity is omitted when secure storage or crypto is unavailable', () => {
  assert.equal(identity.getOrCreateVisitorId(null, null), null);
  assert.equal(identity.getOrCreateVisitorId({
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  }, { randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }), null);
});

test('browser identity survives a blocked localStorage property', () => {
  const windowLike = { crypto: { randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } };
  Object.defineProperty(windowLike, 'localStorage', {
    get() { throw new Error('SecurityError'); },
  });
  assert.equal(identity.getVisitorId(windowLike), null);
});

test('public map remains available when Neon is not connected', async () => {
  telemetryDb.configured = () => false;
  try {
    const res = response();
    await telemetryHandler(request({
      sessionId: '12345678-1234-1234-1234-123456789abc',
      startedAt: Date.now(),
    }), res);
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');
  } finally {
    restoreDatabase();
  }
});

test('telemetry writes a sanitized expiring session snapshot to Neon', async () => {
  const calls = mockDatabase();
  try {
    const res = response();
    await telemetryHandler(request({
      sessionId: '12345678-1234-1234-1234-123456789abc',
      preciseOptIn: false,
      precise: { lat: 26.47, lng: 73.11 },
      path: [{ lat: 26.47, lng: 73.11 }],
    }, {
      'x-vercel-ip-city': 'Jodhpur',
      'x-vercel-ip-country': 'IN',
      'x-vercel-ip-latitude': '26.2389',
      'x-vercel-ip-longitude': '73.0243',
    }), res);

    assert.equal(res.statusCode, 202);
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /ON CONFLICT \(session_id\)/);
    assert.equal(JSON.parse(calls[0].values[6]).city, 'Jodhpur');
    assert.equal(JSON.parse(calls[0].values[8]), null);
    assert.deepEqual(JSON.parse(calls[0].values[9]), []);
  } finally {
    restoreDatabase();
  }
});

test('telemetry hashes visitor IDs and never stores the raw identifier', async () => {
  process.env.TELEMETRY_VISITOR_SECRET = 'a-separate-test-secret-for-visitor-hashing';
  const rawVisitorId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const calls = mockDatabase();
  try {
    const res = response();
    await telemetryHandler(request({
      sessionId: '12345678-1234-1234-1234-123456789abc',
      visitorId: rawVisitorId,
      startedAt: Date.now(),
    }), res);

    assert.equal(res.statusCode, 202);
    const visitorCall = calls.find((call) => /iitj_telemetry_visitors/.test(call.text) && /ON CONFLICT/.test(call.text));
    const sessionCall = calls.find((call) => /iitj_telemetry_sessions/.test(call.text) && /ON CONFLICT/.test(call.text));
    assert.ok(visitorCall, 'visitor presence should be upserted');
    assert.ok(sessionCall, 'session should be upserted');
    const visitorHash = visitorCall.values.find((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
    assert.ok(visitorHash, 'only a SHA-256 HMAC should be persisted');
    assert.notEqual(visitorHash, rawVisitorId);
    assert.equal(JSON.stringify(calls).includes(rawVisitorId), false);
    assert.equal(sessionCall.values.includes(true), true);
  } finally {
    restoreDatabase();
    delete process.env.TELEMETRY_VISITOR_SECRET;
  }
});

test('admin login works without GitHub variables and reads live Neon sessions', async () => {
  process.env.ADMIN_PASSWORD = 'test-password';
  process.env.ADMIN_SESSION_SECRET = 'a-long-test-secret-that-is-only-for-tests';
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_OWNER;
  delete process.env.GITHUB_REPO;

  const loginRes = response();
  await adminHandler(request({ action: 'login', password: 'test-password' }), loginRes);
  assert.equal(loginRes.statusCode, 200);
  const token = loginRes.json().token;
  assert.ok(token);

  const now = Date.now();
  mockDatabase([
    [],
    [],
    [{
      active_sessions: '1',
      active_precise_sessions: '0',
      sessions_24h: '1',
      identified_sessions_24h: '1',
      legacy_sessions_24h: '0',
      average_session_duration_ms_24h: '10000',
    }],
    [{ unique_visitors_24h: '1', unique_visitors_today: '1' }],
    [{
      session_id: '12345678-1234-1234-1234-123456789abc',
      started_at: now - 10_000,
      last_seen: now,
      ended_at: null,
      visible: true,
      approximate: { city: 'Jodhpur', country: 'IN' },
      precise_opt_in: false,
      precise: null,
      path: [],
      routes: [],
      route_calculations: 0,
    }],
  ]);
  try {
    const liveRes = response();
    await adminHandler(request({ action: 'telemetry', token }), liveRes);
    assert.equal(liveRes.statusCode, 200);
    const snapshot = liveRes.json();
    assert.equal(snapshot.sessions.length, 1);
    assert.equal(snapshot.sessions[0].active, true);
    assert.equal(snapshot.metrics.uniqueVisitors24h, 1);
    assert.equal(snapshot.metrics.uniqueVisitorsToday, 1);
    assert.equal(snapshot.metrics.sessions24h, 1);
  } finally {
    restoreDatabase();
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;
  }
});
