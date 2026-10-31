(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IITJTelemetryIdentity = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const VISITOR_ID_KEY = 'iitj-telemetry-visitor-id-v1';
  const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

  function validVisitorId(value) {
    return typeof value === 'string' && UUID_PATTERN.test(value);
  }

  function getOrCreateVisitorId(storage, webCrypto) {
    if (!storage || !webCrypto || typeof webCrypto.randomUUID !== 'function') return null;
    try {
      const existing = storage.getItem(VISITOR_ID_KEY);
      if (validVisitorId(existing)) return existing.toLowerCase();
      const created = webCrypto.randomUUID().toLowerCase();
      if (!validVisitorId(created)) return null;
      storage.setItem(VISITOR_ID_KEY, created);
      return created;
    } catch (_) {
      return null;
    }
  }

  function getVisitorId(browserWindow) {
    if (!browserWindow) return null;
    try {
      return getOrCreateVisitorId(browserWindow.localStorage, browserWindow.crypto);
    } catch (_) {
      return null;
    }
  }

  return { VISITOR_ID_KEY, validVisitorId, getOrCreateVisitorId, getVisitorId };
});