/**
 * Edge Middleware: HTTP Basic Auth gate for /admin.html only.
 *
 * This is a second, independent layer on top of the server-side publish
 * login in api/admin.js — it stops the admin page from even loading for
 * an unauthenticated visitor, instead of relying solely on the page's own
 * JS to gate the "publish" action. Scoped to /admin.html via `matcher` so
 * the public map and all map data remain fully open.
 *
 * Uses ADMIN_BASIC_USER / ADMIN_BASIC_PASS — deliberately separate from
 * ADMIN_PASSWORD (api/admin.js) so leaking one credential doesn't expose
 * the other layer.
 */
import { next } from '@vercel/edge';

export const config = {
  matcher: ['/admin.html'],
};

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function challenge() {
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="IITJ Maps Admin", charset="UTF-8"',
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export default async function middleware(request) {
  const expectedUser = process.env.ADMIN_BASIC_USER;
  const expectedPass = process.env.ADMIN_BASIC_PASS;

  // Fail closed: an unconfigured gate must not silently let the page through.
  if (!expectedUser || !expectedPass) {
    return new Response('Admin page is not configured.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Basic ')) return challenge();

  let decoded;
  try {
    decoded = atob(authHeader.slice(6));
  } catch (_) {
    return challenge();
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return challenge();
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  const [userHash, expUserHash, passHash, expPassHash] = await Promise.all([
    sha256Hex(user),
    sha256Hex(expectedUser),
    sha256Hex(pass),
    sha256Hex(expectedPass),
  ]);

  if (!timingSafeEqualHex(userHash, expUserHash) || !timingSafeEqualHex(passHash, expPassHash)) {
    return challenge();
  }

  return next();
}
