(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IITJAdminTelemetry = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const CAMPUS_BOUNDS = [[73.0900, 26.4450], [73.1350, 26.4950]];
  const DAY_MS = 24 * 60 * 60 * 1000;

  function precisePoint(session) {
    if (!session || !session.preciseOptIn || !session.precise) return null;
    const lat = Number(session.precise.lat);
    const lng = Number(session.precise.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  function isCampusPoint(point) {
    return !!point && point.lng >= CAMPUS_BOUNDS[0][0] && point.lng <= CAMPUS_BOUNDS[1][0] &&
      point.lat >= CAMPUS_BOUNDS[0][1] && point.lat <= CAMPUS_BOUNDS[1][1];
  }

  function approximateLabel(session) {
    const place = session && session.approximate || {};
    return [place.city, place.region, place.country].filter(Boolean).join(', ');
  }

  function sessionPlace(session) {
    const point = precisePoint(session);
    if (point) return isCampusPoint(point) ? 'IIT Jodhpur campus · GPS' : 'Precise GPS';
    const label = approximateLabel(session);
    return label ? `IP estimate: ${label}` : 'Location unavailable';
  }

  function sessionPoint(session) {
    const point = precisePoint(session);
    return point ? { lng: point.lng, lat: point.lat, precision: 'precise' } : null;
  }

  function fitCoordinates({ hasSelection = false, selectedPoint = null, allPoints = [], pathCoordinates = [], routeCoordinates = [] } = {}) {
    if (hasSelection) {
      return [...pathCoordinates, ...routeCoordinates, ...(selectedPoint ? [selectedPoint] : [])];
    }
    return allPoints;
  }

  function sessionDuration(session, now) {
    const start = Number(session.startedAt) || now;
    const end = Number(session.endedAt) || Number(session.lastSeen) || now;
    return Math.max(0, end - start);
  }

  function dashboardMetrics(snapshot) {
    const supplied = snapshot && snapshot.metrics;
    if (supplied) {
      const legacy = Number(supplied.legacySessions24h) || 0;
      const sessions = Number(supplied.sessions24h) || 0;
      const identified = Number(supplied.identifiedSessions24h) || 0;
      const suffix = legacy > 0 ? '+' : '';
      return {
        activeSessions: Number(supplied.activeSessions) || 0,
        activePreciseSessions: Number(supplied.activePreciseSessions) || 0,
        uniqueVisitors24h: `${Number(supplied.uniqueVisitors24h) || 0}${suffix}`,
        uniqueVisitorsToday: `${Number(supplied.uniqueVisitorsToday) || 0}${suffix}`,
        sessions24h: sessions,
        averageSessionDurationMs24h: Number(supplied.averageSessionDurationMs24h) || 0,
        coverage: legacy > 0
          ? `${identified} of ${sessions} sessions identified; unique counts are a lower bound during rollout.`
          : 'All recent sessions are included in unique counts.',
      };
    }

    const sessions = snapshot && Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
    const now = Number(snapshot && snapshot.now) || Date.now();
    const active = sessions.filter((session) => session.active);
    const day = sessions.filter((session) => Number(session.lastSeen || session.startedAt) >= now - DAY_MS);
    const precise = active.filter((session) => precisePoint(session));
    const average = day.length
      ? day.reduce((total, session) => total + sessionDuration(session, now), 0) / day.length
      : 0;
    return {
      activeSessions: active.length,
      activePreciseSessions: precise.length,
      uniqueVisitors24h: '—',
      uniqueVisitorsToday: '—',
      sessions24h: day.length,
      averageSessionDurationMs24h: average,
      coverage: 'Unique counts require the updated analytics API.',
    };
  }

  return {
    CAMPUS_BOUNDS,
    precisePoint,
    isCampusPoint,
    sessionPlace,
    sessionPoint,
    fitCoordinates,
    dashboardMetrics,
  };
});