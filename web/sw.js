/* IITJ Maps — service worker
 * Offline support that NEVER blocks a normal (online) load.
 *
 * Hard-won lesson: a stale-while-revalidate / cache-first app shell can wedge
 * the app if a cached entry is ever bad — the page then breaks on every
 * SW-controlled load while a fresh (cache-less) load works. So the critical
 * path is now NETWORK-FIRST: an online load behaves exactly like a cache-less
 * load, and the cache is only ever a fallback when the network is unavailable.
 *
 * Strategy:
 *   • navigations              → network-first, cached shell only when offline
 *   • same-origin js/css/data  → network-first, cache only when offline
 *   • map tiles / glyphs        → cache-first, capped (immutable; offline maps)
 *   • CDN + fonts (unpkg/google)→ cache-first (version-pinned, immutable)
 *   • /admin* and /api/*        → never intercepted
 *
 * Bump CACHE_VERSION on any change here: activate wipes every non-matching
 * cache, which also clears a previously-broken cache on users' devices.
 */
const CACHE_VERSION = 'iitj-2026-06-18b';
const PRECACHE = `${CACHE_VERSION}-precache`;
const RUNTIME  = `${CACHE_VERSION}-runtime`;
const TILES    = `${CACHE_VERSION}-tiles`;
const TILE_MAX = 800;

const PRECACHE_URLS = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then(c => c.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

function isTileHost(url) {
  return /\.basemaps\.cartocdn\.com$/.test(url.hostname)
      || url.hostname === 'server.arcgisonline.com'
      || url.hostname === 'fonts.openmaptiles.org';
}
function isCdnAsset(url) {
  return url.hostname === 'unpkg.com'
      || url.hostname === 'fonts.googleapis.com'
      || url.hostname === 'fonts.gstatic.com';
}

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// Network-first: prefer the live response; only touch the cache when the
// network genuinely fails (offline). Successful responses refresh the cache
// for that offline fallback. Never serves a cached entry while online, so a
// bad cache can't wedge the app.
async function networkFirst(req, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (_) {
    const cached = await cache.match(req) || (fallbackKey && await caches.match(fallbackKey));
    return cached || Response.error();
  }
}

// Cache-first with cap — for immutable cross-origin tiles/glyphs/CDN.
async function cacheFirstCapped(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone()).catch(() => {});
    if (max) trimCache(cacheName, max);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Never touch the admin gate or APIs.
  if (url.origin === self.location.origin &&
      (url.pathname === '/admin.html' || url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/'))) {
    return;
  }

  // Navigations + same-origin app shell/data → network-first.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, PRECACHE, '/'));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, RUNTIME));
    return;
  }

  // Cross-origin: tiles/glyphs cache-first capped; CDN/fonts cache-first.
  if (isTileHost(url)) { event.respondWith(cacheFirstCapped(req, TILES, TILE_MAX)); return; }
  if (isCdnAsset(url)) { event.respondWith(cacheFirstCapped(req, RUNTIME, 0)); return; }
  // Anything else cross-origin: leave to the browser.
});
