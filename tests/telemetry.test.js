const test = require('node:test');
const assert = require('node:assert/strict');

const telemetryHandler = require('../api/telemetry');
const adminHandler = require('../api/admin');

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

function clearRedisEnvironment() {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

test('public telemetry validates anonymous session IDs', async () => {
  clearRedisEnvironment();
  const res = response();
  await telemetryHandler(request({ sessionId: 'not-valid' }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Invalid session/);
});
test('public map remains available when Redis is not connected', async () => {
  clearRedisEnvironment();
  const res = response();
  await telemetryHandler(request({
    sessionId: '12345678-1234-1234-1234-123456789abc',
    startedAt: Date.now(),
  }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, '');
});
test('telemetry writes a sanitized expiring session snapshot', async () => {
  process.env.KV_REST_API_URL = 'https://redis.example';
  process.env.KV_REST_API_TOKEN = 'test-token';
  const originalFetch = global.fetch;
  let commands = null;
  global.fetch = async (_url, options) => {
    commands = JSON.parse(options.body);
    return { ok: true, json: async () => [{ result: 'OK' }, { result: 1 }] };
  };
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
    assert.equal(commands[0][0], 'SET');
    assert.equal(commands[0][3], 'EX');
    const stored = JSON.parse(commands[0][2]);
    assert.equal(stored.approximate.city, 'Jodhpur');
    assert.equal(stored.precise, null);
    assert.deepEqual(stored.path, []);
  } finally {
    global.fetch = originalFetch;
    clearRedisEnvironment();
  }
});

test('admin login works without GitHub publishing variables and reads live sessions', async () => {
  process.env.ADMIN_PASSWORD = 'test-password';
  process.env.ADMIN_SESSION_SECRET = 'a-long-test-secret-that-is-only-for-tests';
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_OWNER;
  delete process.env.GITHUB_REPO;
  process.env.KV_REST_API_URL = 'https://redis.example';
  process.env.KV_REST_API_TOKEN = 'test-token';

  const loginRes = response();
  await adminHandler(request({ action: 'login', password: 'test-password' }), loginRes);
  assert.equal(loginRes.statusCode, 200);
  const token = loginRes.json().token;
  assert.ok(token);

  const now = Date.now();
  const storedSession = JSON.stringify({
    sessionId: '12345678-1234-1234-1234-123456789abc',
    startedAt: now - 10_000,
    lastSeen: now,
    endedAt: null,
    visible: true,
    approximate: { city: 'Jodhpur', country: 'IN' },
    preciseOptIn: false,
    precise: null,
    path: [],
    routes: [],
  });
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call++;
    const result = call === 1 ? 0 : call === 2
      ? ['12345678-1234-1234-1234-123456789abc']
      : [storedSession];
    return { ok: true, json: async () => ({ result }) };
  };
  try {
    const liveRes = response();
    await adminHandler(request({ action: 'telemetry', token }), liveRes);
    assert.equal(liveRes.statusCode, 200);
    const snapshot = liveRes.json();
    assert.equal(snapshot.sessions.length, 1);
    assert.equal(snapshot.sessions[0].active, true);
  } finally {
    global.fetch = originalFetch;
    clearRedisEnvironment();
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_SESSION_SECRET;
  }
});

