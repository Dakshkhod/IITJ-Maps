const test = require('node:test');
const assert = require('node:assert/strict');

const telemetryDb = require('../lib/telemetry-db');
const telemetryHandler = require('../api/telemetry');
const adminHandler = require('../api/admin');

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
  mockDatabase([[], [{
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
  }]]);
  try {
    const liveRes = response();
    await adminHandler(request({ action: 'telemetry', token }), liveRes);
    assert.equal(liveRes.statusCode, 200);
    const snapshot = liveRes.json();
    assert.equal(snapshot.sessions.length, 1);
    assert.equal(snapshot.sessions[0].active, true);
  } finally {
    restoreDatabase();
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;
  }
});
