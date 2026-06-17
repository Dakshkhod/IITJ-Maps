# IITJ Maps — Cross-browser / device test matrix

Launch QA checklist. Grouped by the things that actually break across engines:
WebGL (MapLibre), geolocation, device orientation (compass), speech, PWA
install/offline, and responsive layout. "✓" = expected to work, "—" = not
available (degrades gracefully), "⚠" = known quirk, see notes.

## Device / browser coverage

Test on at least one device per row. Starred rows are the highest-traffic
(students on mid-range Android + iPhone).

| # | Device class | Browser | Priority |
|---|--------------|---------|----------|
| 1 | iPhone (notch/Dynamic Island), iOS 16+ ★ | Safari | P0 |
| 2 | iPhone, iOS 16+ | Chrome (WKWebView) | P1 |
| 3 | Android mid-range (e.g. Redmi/Realme), Android 11+ ★ | Chrome | P0 |
| 4 | Android flagship | Chrome | P1 |
| 5 | Android | Firefox | P2 |
| 6 | Android | Samsung Internet | P2 |
| 7 | iPad / Android tablet | Safari / Chrome | P1 |
| 8 | Foldable (Fold/Flip) | Chrome | P2 |
| 9 | Desktop | Chrome / Edge | P1 |
| 10 | Desktop | Firefox | P2 |
| 11 | Desktop | Safari (macOS) | P2 |

## Feature matrix

| Feature | iOS Safari | Android Chrome | Firefox | Desktop | Notes |
|---|---|---|---|---|---|
| Map render (WebGL / MapLibre) | ✓ | ✓ | ✓ | ✓ | See "iOS WebGL" below. |
| Satellite / dark / layers | ✓ | ✓ | ✓ | ✓ | |
| 3D buildings + landmarks (Three.js) | ⚠ | ✓ | ✓ | ✓ | Heavy on low-end; watch FPS & memory. |
| Geolocation (blue dot) | ⚠ | ✓ | ✓ | ⚠ | HTTPS + permission; desktop is coarse. |
| Live navigation / snap-to-route | ⚠ | ✓ | ✓ | ✓ | Needs good GPS; test outdoors. |
| Compass heading (DeviceOrientation) | ⚠ | ✓ | ⚠ | — | iOS needs a tap to grant; see below. |
| Voice turn-by-turn (speechSynthesis) | ✓ | ✓ | ✓ | ✓ | Voices load async; first utterance may lag. |
| Voice **search** (SpeechRecognition) | ✓ | ✓ | — | ⚠ | Mic button auto-hides where unsupported. |
| Install (Add to Home Screen) | ⚠ | ✓ | — | ✓ | iOS = manual Share → Add; no prompt. |
| Offline (service worker) | ✓ | ✓ | ✓ | ✓ | Works after first online load. |
| Share sheet (Web Share) | ✓ | ✓ | ⚠ | ⚠ | Falls back to copy-link. |
| Pinch-to-zoom page (a11y) | ✓ | ✓ | ✓ | ✓ | Re-enabled; map gestures unaffected. |

## Engine-specific quirks & what the app already does

### iOS Safari — WebGL
- Backgrounding the tab can drop the WebGL context; returning should restore the
  map. **Check:** switch apps for ~30s, return — map still renders, no white box.
- Memory pressure with 3D on can reload the tab. **Check:** toggle 3D, pan around
  the dense hostel cluster for a minute on an older iPhone.

### iOS Safari — geolocation
- Only works over HTTPS and after a user gesture; a denied prompt is sticky
  (Settings → Safari → Location). **Check:** first locate tap prompts; denial
  shows the "enable in settings" toast, not a silent failure.
- `watchPosition` uses `enableHighAccuracy:true, maximumAge:0`. **Check:** the dot
  doesn't "jump back" to a stale fix while walking.

### iOS Safari — compass
- `DeviceOrientationEvent.requestPermission()` must be called from a user gesture.
  The app requests it from the **Start** tap (and the locate button). **Check:**
  starting navigation prompts for "Motion & Orientation"; granting rotates the
  camera with heading; denying falls back to GPS heading with a toast.
- If the magnetometer is uncalibrated, iOS reports poor `webkitCompassAccuracy`;
  the app shows a "move phone in a figure 8" hint once. **Check:** appears when
  accuracy is bad, not on every run.

### Android Chrome
- Compass arrives via `deviceorientationabsolute` (or `absolute` alpha). **Check:**
  heading is true-north, not drifting/relative.
- Install prompt (`beforeinstallprompt`) → the browser's own install UI. **Check:**
  installs standalone, launches at `/`, theme color `#0a0a0a`, maskable icon
  renders without a white box behind it.

### Firefox
- No `SpeechRecognition` → the mic button in search is hidden (feature-detected).
  **Check:** no broken/disabled mic button.
- No `beforeinstallprompt` → no install chip; SW + offline still work.

### Responsive / layout
- **Notch (P0 iOS):** search bar, directions panel and map controls clear the
  notch/Dynamic Island in both portrait and landscape (safe-area insets).
- **Landscape phone:** detail/nav panels become a scrollable left card; the map
  stays visible; controls reachable.
- **Tablet/desktop:** panels dock as a left column (≤400–480px); map fills the
  rest.
- **Foldable:** no panel straddles the hinge.
- **Touch targets:** every icon button is ≥44px on touch.
- **Text zoom:** pinch-zoom and 200% browser zoom don't clip controls or text.

## Smoke test (run on every P0 device)
1. Cold load over cellular → splash clears, map interactive < a few seconds.
2. Search "e6" / "b1" → correct suggestions; tap → sheet opens, "Enter via" gate
   shown for hostels.
3. Directions to a hostel → route draws → panel auto-minimizes → expand/minimize
   round-trips → Start → camera tilts, voice speaks, compass prompt (iOS).
4. Toggle 3D, satellite, dark — no crash, acceptable FPS.
5. Go offline (airplane mode) after first load → reload → app still boots, last
   tiles/data render.
6. Add to Home Screen → launches standalone.
