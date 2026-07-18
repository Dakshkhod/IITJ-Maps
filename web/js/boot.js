/* Boot-recovery watchdog. Runs independently of app.js (so it works even if
 * app.js itself was served broken): if the app hasn't booted in time, drop any
 * stale service worker + caches and reload ONCE. A sessionStorage guard prevents
 * a reload loop; if it's still stuck after that, the splash is force-hidden so
 * the user at least sees the map.
 *
 * Kept as an external same-origin file (not an inline <script>) so the strict
 * Content-Security-Policy needs no 'unsafe-inline' / hash for scripts. */
(function () {
  var KEY = 'iitj-boot-recovery';
  window.__iitjBooted = false;
  // Clear the guard on a clean start so a future wedge can self-heal again.
  window.addEventListener('iitj-booted', function () {
    window.__iitjBooted = true;
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  });
  setTimeout(function () {
    if (window.__iitjBooted) return;
    var splash = document.getElementById('splash');
    var stuck = splash && splash.style.opacity !== '0' && splash.style.display !== 'none';
    if (!stuck) return;
    var tried = false;
    try { tried = !!sessionStorage.getItem(KEY); } catch (e) {}
    if (tried) { if (splash) splash.style.display = 'none'; return; }  // don't loop
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    var reload = function () { location.reload(); };
    var jobs = [];
    if ('serviceWorker' in navigator) {
      jobs.push(navigator.serviceWorker.getRegistrations()
        .then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })
        .catch(function () {}));
    }
    if (window.caches) {
      jobs.push(caches.keys()
        .then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })
        .catch(function () {}));
    }
    Promise.all(jobs).then(reload, reload);
  }, 15000);
})();
