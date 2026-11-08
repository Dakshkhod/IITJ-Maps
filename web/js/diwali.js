/* Diwali 2026, using campus time even for visitors in another time zone.
 * Preview with ?diwali=1, or hide with ?diwali=0. No saved preferences. */
(function () {
  'use strict';

  const root = document.documentElement;
  const preview = new URLSearchParams(window.location.search).get('diwali');
  const startsAt = Date.parse('2026-11-08T00:00:00+05:30');
  const endsAt = Date.parse('2026-11-09T00:00:00+05:30');
  let expiryTimer;

  function updateSeason() {
    const now = Date.now();
    const active = preview === '1' || (preview !== '0' && now >= startsAt && now < endsAt);
    const changed = root.hasAttribute('data-diwali') !== active;
    root.toggleAttribute('data-diwali', active);
    if (active) root.setAttribute('data-theme', 'dark');
    root.toggleAttribute('data-diwali-paused', document.hidden);
    clearTimeout(expiryTimer);
    // Expire an open tab too; visibilitychange catches suspended mobile tabs.
    if (preview !== '1' && preview !== '0' && now < endsAt) {
      const nextChange = now < startsAt ? startsAt : endsAt;
      expiryTimer = setTimeout(updateSeason, Math.min(nextChange - now, 2147483647));
    }
    if (changed) window.dispatchEvent(new CustomEvent('iitj-diwali-change', { detail: { active } }));
  }

  updateSeason();
  document.addEventListener('visibilitychange', updateSeason);
  document.addEventListener('DOMContentLoaded', function () {
    const dismiss = document.getElementById('diwali-map-dismiss');
    if (dismiss) dismiss.addEventListener('click', function () {
      root.setAttribute('data-diwali-dismissed', '');
      const menu = document.getElementById('menu-btn');
      if (menu) menu.focus({ preventScroll: true });
    });
    const diya = document.getElementById('diwali-diya');
    const wish = document.getElementById('diwali-wish');
    if (!diya || !wish) return;
    diya.addEventListener('click', function () {
      const lit = diya.getAttribute('aria-pressed') !== 'true';
      diya.setAttribute('aria-pressed', String(lit));
      wish.textContent = lit
        ? 'May every path lead to light.'
        : 'Tap the diya to light a little joy.';
    });
  });
})();
