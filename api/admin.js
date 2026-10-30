/**
 * Serverless admin endpoint (Vercel Node function). Publishing runs server-side
 * so the GitHub token never reaches the browser. Login with ADMIN_PASSWORD
 * returns a short-lived HMAC session token that the publish call must present.
 *
 * Env (Vercel project, never in code): ADMIN_PASSWORD, ADMIN_SESSION_SECRET
 * (32+ bytes), GITHUB_TOKEN (fine-grained PAT, Contents: R/W, this repo),
 * GITHUB_OWNER, GITHUB_REPO. Optional: GITHUB_BRANCH ("main"),
 * GITHUB_PATH ("web/data/overlay.json").
 */
const crypto = require('crypto');

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;     // 4 hours
const MAX_OVERLAY_BYTES = 2_000_000;           // 2 MB hard cap
const TELEMETRY_INDEX_KEY = 'iitj:telemetry:sessions';
const TELEMETRY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TELEMETRY_ACTIVE_MS = 45 * 1000;
const TELEMETRY_MAX_SESSIONS = 300;

function constantTimeEquals(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  // Compare fixed-length HMACs so length itself is not a side channel.
  const ah = crypto.createHash('sha256').update(ab).digest();
  const bh = crypto.createHash('sha256').update(bb).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function signPayload(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function issueToken(secret) {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(8).toString('hex'),
  })).toString('base64url');
  return `${payload}.${signPayload(payload, secret)}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || token.length > 1024) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signPayload(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && Date.now() < exp;
  } catch (_) { return false; }
}

function telemetryRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function telemetryRedisCommand(command) {
  const cfg = telemetryRedisConfig();
  if (!cfg) {
    const error = new Error('Live analytics is not configured. Connect a Vercel KV/Upstash Redis store.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Telemetry store HTTP ${response.status}`);
  const body = await response.json();
  if (body && body.error) throw new Error('Telemetry store rejected the request');
  return body ? body.result : null;
}

async function telemetrySnapshot() {
  const now = Date.now();
  const oldest = now - TELEMETRY_RETENTION_MS;
  // Keep the index bounded even when individual session keys have expired.
  await telemetryRedisCommand(['ZREMRANGEBYSCORE', TELEMETRY_INDEX_KEY, '-inf', oldest]);
  const ids = await telemetryRedisCommand([
    'ZREVRANGEBYSCORE', TELEMETRY_INDEX_KEY, '+inf', oldest,
    'LIMIT', 0, TELEMETRY_MAX_SESSIONS,
  ]);
  if (!Array.isArray(ids) || ids.length === 0) {
    return { now, activeWindowMs: TELEMETRY_ACTIVE_MS, retentionDays: 7, sessions: [] };
  }
  const values = await telemetryRedisCommand([
    'MGET', ...ids.map((id) => `iitj:telemetry:session:${id}`),
  ]);
  const sessions = [];
  for (const value of (Array.isArray(values) ? values : [])) {
    if (typeof value !== 'string') continue;
    try {
      const session = JSON.parse(value);
      if (session && typeof session === 'object') {
        session.active = session.visible === true && !session.endedAt &&
          Number(session.lastSeen) >= now - TELEMETRY_ACTIVE_MS;
        sessions.push(session);
      }
    } catch (_) { /* skip a corrupted entry without breaking the dashboard */ }
  }
  return { now, activeWindowMs: TELEMETRY_ACTIVE_MS, retentionDays: 7, sessions };
}

// GitHub's own status + error text, trimmed to something safe to show. Surfaced
// ONLY on the publish path, which is already behind verifyToken — a generic
// "GitHub read failed" can't tell an expired token from a revoked permission,
// which leaves the admin with nothing to act on. Never echoes the token itself.
async function ghErrorDetail(r) {
  let msg = '';
  try {
    const b = await r.json();
    if (b && typeof b.message === 'string') msg = b.message.slice(0, 200);
  } catch (_) { /* non-JSON error body — status alone still tells us a lot */ }
  const hint =
    r.status === 401 ? ' — GITHUB_TOKEN is invalid or expired; regenerate the PAT and update it in Vercel.' :
    r.status === 403 ? ' — GITHUB_TOKEN lacks Contents: Read & write on this repo (or is rate-limited).' :
    r.status === 404 ? ' — check GITHUB_OWNER / GITHUB_REPO / GITHUB_PATH.' : '';
  return `HTTP ${r.status}${msg ? ': ' + msg : ''}${hint}`;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  // Fallback: stream the raw body (with a size guard) and parse.
  return await new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_OVERLAY_BYTES + 4096) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => { if (tooBig) return resolve(null); try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const {
    ADMIN_PASSWORD, ADMIN_SESSION_SECRET, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO,
  } = process.env;
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
  const GITHUB_PATH = process.env.GITHUB_PATH || 'web/data/overlay.json';

  if (!ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: 'Admin authentication is not configured on the server.' }));
  }

  const body = await readJsonBody(req);
  if (body === null) {
    res.statusCode = 413;
    return res.end(JSON.stringify({ error: 'Payload too large' }));
  }
  const action = body && body.action;

  // ── Login: password -> short-lived session token ──────────────────────────
  if (action === 'login') {
    const ok = constantTimeEquals(body.password || '', ADMIN_PASSWORD);
    await new Promise((r) => setTimeout(r, 350)); // blunt brute-force timing
    if (!ok) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: 'Invalid password' }));
    }
    res.statusCode = 200;
    return res.end(JSON.stringify({ token: issueToken(ADMIN_SESSION_SECRET), expiresInSec: SESSION_TTL_MS / 1000 }));
  }

  // ── Telemetry: verified token -> anonymous live/recent sessions ───────────
  if (action === 'telemetry') {
    if (!verifyToken(body.token, ADMIN_SESSION_SECRET)) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: 'Session expired — log in again.' }));
    }
    try {
      const snapshot = await telemetrySnapshot();
      res.statusCode = 200;
      return res.end(JSON.stringify(snapshot));
    } catch (error) {
      const detail = error && error.message ? String(error.message).slice(0, 200) : 'Telemetry unavailable';
      console.error('[admin/telemetry]', detail);
      res.statusCode = error && error.status ? error.status : 502;
      return res.end(JSON.stringify({ error: detail }));
    }
  }

  // ── Publish: verified token + overlay -> commit to GitHub (server-side) ────
  if (action === 'publish') {
    if (!verifyToken(body.token, ADMIN_SESSION_SECRET)) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: 'Session expired — log in again.' }));
    }
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      res.statusCode = 503;
      return res.end(JSON.stringify({ error: 'Admin publishing is not configured on the server.' }));
    }
    const overlay = body.overlay;
    if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Invalid overlay payload' }));
    }
    const json = JSON.stringify(overlay);
    if (Buffer.byteLength(json, 'utf8') > MAX_OVERLAY_BYTES) {
      res.statusCode = 413;
      return res.end(JSON.stringify({ error: 'Overlay too large' }));
    }

    const apiBase = `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}/contents/${GITHUB_PATH.split('/').map(encodeURIComponent).join('/')}`;
    const ghHeaders = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'User-Agent': 'iitj-maps-admin',
      'Content-Type': 'application/json',
    };

    try {
      // 1. Current sha (required to update an existing file)
      let sha = null;
      const metaRes = await fetch(`${apiBase}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers: ghHeaders });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        sha = meta && meta.sha;
      } else if (metaRes.status !== 404) {
        // 404 is fine (file not created yet); anything else is GitHub refusing us.
        const detail = await ghErrorDetail(metaRes);
        console.error('[admin/publish] GitHub read failed:', detail);
        res.statusCode = 502;
        return res.end(JSON.stringify({ error: `GitHub read failed — ${detail}` }));
      }

      // 2. Commit (create or update)
      const message = (typeof body.message === 'string' && body.message.trim())
        ? body.message.trim().slice(0, 200)
        : 'Update admin overlay';
      const putRes = await fetch(apiBase, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify({
          message,
          content: Buffer.from(json, 'utf8').toString('base64'),
          branch: GITHUB_BRANCH,
          ...(sha ? { sha } : {}),
        }),
      });
      if (!putRes.ok) {
        const detail = await ghErrorDetail(putRes);
        console.error('[admin/publish] GitHub commit failed:', detail);
        res.statusCode = 502;
        return res.end(JSON.stringify({ error: `GitHub commit failed — ${detail}` }));
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      const detail = (e && e.message) ? String(e.message).slice(0, 200) : 'unknown error';
      console.error('[admin/publish] upstream error:', detail);
      res.statusCode = 502;
      return res.end(JSON.stringify({ error: `Upstream error contacting GitHub — ${detail}` }));
    }
  }

  res.statusCode = 400;
  return res.end(JSON.stringify({ error: 'Unknown action' }));
};
