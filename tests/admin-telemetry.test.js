const test = require('node:test');
const assert = require('node:assert/strict');

const dashboard = require('../web/js/admin-telemetry');

test('precise campus GPS overrides a misleading IP city label', () => {
  const session = {
    preciseOptIn: true,
    precise: { lat: 26.48010, lng: 73.11965, accuracy: 3 },
    approximate: { city: 'Bengaluru', region: 'KA', country: 'IN', lat: 12.9716, lng: 77.5946 },
  };

  assert.equal(dashboard.sessionPlace(session), 'IIT Jodhpur campus · GPS');
  assert.deepEqual(dashboard.sessionPoint(session), {
    lng: 73.11965,
    lat: 26.48010,
    precision: 'precise',
  });
});

test('IP geolocation is labelled as an estimate and is not plotted as a device point', () => {
  const session = {
    preciseOptIn: false,
    approximate: { city: 'Jaipur', region: 'RJ', country: 'IN', lat: 26.9124, lng: 75.7873 },
  };

  assert.equal(dashboard.sessionPlace(session), 'IP estimate: Jaipur, RJ, IN');
  assert.equal(dashboard.sessionPoint(session), null);
});

test('selecting a session fits only its GPS, path, and route', () => {
  assert.deepEqual(dashboard.fitCoordinates({
    hasSelection: true,
    selectedPoint: [73.11965, 26.48010],
    allPoints: [[73.11965, 26.48010], [77.5946, 12.9716]],
    pathCoordinates: [[73.11960, 26.48000]],
    routeCoordinates: [[73.1147, 26.4727]],
  }), [
    [73.11960, 26.48000],
    [73.1147, 26.4727],
    [73.11965, 26.48010],
  ]);
});

test('a selected IP-only session fits its route without plotting the IP estimate', () => {
  assert.deepEqual(dashboard.fitCoordinates({
    hasSelection: true,
    selectedPoint: null,
    allPoints: [[73.11965, 26.48010]],
    pathCoordinates: [],
    routeCoordinates: [[73.1147, 26.4727], [73.1170, 26.4750]],
  }), [[73.1147, 26.4727], [73.1170, 26.4750]]);
});

test('dashboard metrics show known unique visitors as partial during rollout', () => {
  const metrics = dashboard.dashboardMetrics({
    metrics: {
      activeSessions: 3,
      activePreciseSessions: 1,
      uniqueVisitors24h: 12,
      uniqueVisitorsToday: 8,
      sessions24h: 20,
      identifiedSessions24h: 18,
      legacySessions24h: 2,
      averageSessionDurationMs24h: 90_000,
    },
  });

  assert.equal(metrics.uniqueVisitors24h, '12+');
  assert.equal(metrics.uniqueVisitorsToday, '8+');
  assert.equal(metrics.coverage, '18 of 20 sessions identified; unique counts are a lower bound during rollout.');
});