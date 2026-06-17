/* IITJ Maps — service worker
 * Offline app shell + runtime caching of map tiles, data and CDN assets.
 *
 * Strategy:
 *   • navigations  → network-first, fall back to the cached shell offline
 *   • same-origin static (js/css/json/geojson/img) → stale-while-revalidate
 *   • map tiles (CARTO / ArcGIS / OpenMapTiles glyphs) → cache-first, capped
 *   • CDN + fonts (unpkg / Google Fonts) → stale-while-revalidate
 *   • /admin* and /api/* are never intercepted (auth gate + no-store stay intact)
 *
 * Versioned ?v= assets are picked up at runtime, so there's no hand-maintained
 * precache list to keep in sync with index.html. Bump CACHE_VERSION whenever
 * this file changes to roll every cache forward on activate.
 */
const CACHE_VERSION = 'iitj-2026-06-17a';
const PRECACHE = `${CACHE_VERSION}-precache`;
const RUNTIME  = `${CACHE_VERSION}-runtime`;
const TILES    = `${CACHE_VERSION}-tiles`;
const TILE_MAX = 800;   // rough LRU cap so the tile cache can't grow unbounded

// Just enough to boot the shell offline; everything else fills in at runtime.
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

// Let the page promote a waiting worker without a manual reload.
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

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) return cached;
  const net = await networkPromise;
  return net || Response.error();
}

async function cacheFirstCapped(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone());
    trimCache(cacheName, max);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Never touch the admin gate or APIs — they must hit the network directly so
  // the edge middleware (Basic Auth) and no-store semantics are preserved.
  if (url.origin === self.location.origin &&
      (url.pathname === '/admin.html' || url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/'))) {
    return;
  }

  // App navigations: network-first, cached shell as the offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (url.pathname === '/' || url.pathname === '/index.html') {
          (await caches.open(PRECACHE)).put('/', res.clone());
        }
        return res;
      } catch (_) {
        return (await caches.match(req)) || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  // Cross-origin: tiles → cache-first capped; CDN/fonts → SWR; else passthrough.
  if (url.origin !== self.location.origin) {
    if (isTileHost(url)) { event.respondWith(cacheFirstCapped(req, TILES, TILE_MAX)); return; }
    if (isCdnAsset(url)) { event.respondWith(staleWhileRevalidate(req, RUNTIME)); return; }
    return;
  }

  // Same-origin static assets → stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(req, RUNTIME));
});
