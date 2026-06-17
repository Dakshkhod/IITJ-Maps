/* IITJ Maps — service worker KILL SWITCH.
 *
 * The previous offline service worker could leave the app stuck on the splash
 * on slow/flaky connections (a fresh load worked, the next SW-controlled load
 * hung). Offline support is therefore disabled. This file exists ONLY to
 * dismantle any worker + caches a user already has installed, then reload the
 * page so it runs clean with no worker. The browser fetches /sw.js outside of
 * any worker's control, so this reliably replaces a wedged worker.
 *
 * app.js no longer registers a service worker, so once a device is cleaned up
 * this worker is never installed again.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1. Wipe every Cache Storage entry this origin holds.
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch (_) {}
    // 2. Remove this registration.
    try { await self.registration.unregister(); } catch (_) {}
    // 3. Reload every open tab so it loads fresh, now without a controller.
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) { try { c.navigate(c.url); } catch (_) {} }
    } catch (_) {}
  })());
});

// Pass through every request untouched — never serve from cache.
self.addEventListener('fetch', () => {});
