/* IITJ Maps — service worker KILL SWITCH.
 *
 * Offline support is disabled: the old worker could wedge the app on the splash
 * over flaky connections. This file only dismantles any worker + caches a device
 * already has, then reloads clean. The browser fetches /sw.js outside worker
 * control, so it reliably replaces a wedged one. app.js never registers a
 * worker, so a cleaned device stays clean.
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
