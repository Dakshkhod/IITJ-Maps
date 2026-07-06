/**
 * perf-tier.js — automatic device-capability tiering for smooth rendering
 * on everything from a budget Galaxy M/A phone to a flagship or desktop.
 *
 * There is NO user-facing quality selector (this isn't a game). The module
 * inspects the device once at boot, picks a graphics tier, and every other
 * file reads window.PerfTier.* while building the map / Three.js renderer.
 * A lightweight FPS watchdog then nudges the tier DOWN — and remembers that
 * for next time — if a device turns out slower than its specs suggested.
 *
 * Tiers (0 = low, 1 = balanced, 2 = high) tune the four things that actually
 * cost frames on a mobile GPU:
 *   • pixelRatio  — THE big lever. A Galaxy M32 has devicePixelRatio ≈ 2.75,
 *     so uncapped it shades ~7× the pixels of a logical 1×. Capping this is
 *     what turns a slideshow into a smooth map.
 *   • antialias   — MSAA is very expensive on Mali/Adreno budget GPUs.
 *   • scene mass  — the heavy Three.js procedural landmark models + perimeter
 *     berms are skipped on low-end (plain MapLibre extruded boxes remain), and
 *     instanced tree/shrub density is scaled down.
 *   • overdraw    — the doubled "glow" extrusion layers and max pitch.
 *
 * Loaded BEFORE app.js and landmarks-3d.js so both can read PerfTier at
 * construction time.
 */
(function () {
  'use strict';

  var STORE_KEY = 'iitj_perf_v1';

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // ── Raw device signals ────────────────────────────────────────────────
  var dpr   = Math.max(1, window.devicePixelRatio || 1);
  var mem   = navigator.deviceMemory || 0;         // GB — Chrome/Android only (0 = unknown)
  var cores = navigator.hardwareConcurrency || 0;  // logical cores (0 = unknown)

  // GPU renderer string via WEBGL_debug_renderer_info, using a throwaway
  // context we immediately drop. Often masked on privacy-hardened browsers
  // (returns '' — we fall back to memory/cores then).
  function gpuRenderer() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return '';
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      var s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return (s || '').toString();
    } catch (e) { return ''; }
  }
  var gpu   = gpuRenderer();
  var gpuLc = gpu.toLowerCase();

  // ── Classify → 0 low / 1 balanced / 2 high ────────────────────────────
  function classify() {
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var isMobile = coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

    // When we can read the GPU, trust IT — not RAM/cores, which are poor
    // proxies for rendering power (plenty of mid-range phones ship 6–8 GB and
    // 8 cores behind a weak GPU). RAM/cores are only a fallback for masked GPUs.
    if (gpuLc) {
      // ── Known-STRONG → high ──
      //   Apple GPUs; Adreno 7xx/8xx (2022+ flagships); Mali-G7xx *three-digit*
      //   (G710/G715/G720) and Immortalis; desktop discrete/integrated-modern.
      //   NOTE: Mali-G76/G77/G78 are TWO digits after "g7" — deliberately NOT
      //   matched here (they're 2019–20 upper-mid parts, e.g. Realme 6's G76),
      //   so they fall through to "balanced" instead of being over-promoted.
      if (/apple gpu|apple m\d/.test(gpuLc)) return 2;
      if (/adreno[^\d]*(7\d\d|8\d\d)\b/.test(gpuLc)) return 2;
      if (/mali-g7\d\d|immortalis/.test(gpuLc)) return 2;
      if (!isMobile && /nvidia|geforce|radeon|intel.*(arc|iris)/.test(gpuLc)) return 2;

      // ── Known-WEAK → low ──
      //   Budget Mali (T-series, G31/G5x), entry Adreno (3xx–5xx, 60x/61x),
      //   PowerVR, software rasterisers.
      var weakGpu =
        /mali-(4\d\d|t\d{3}|g3\d|g5\d)\b/.test(gpuLc) ||
        /adreno[^\d]*(3\d\d|4\d\d|5\d\d|60\d|61\d)\b/.test(gpuLc) ||
        /powervr|videocore|swiftshader|llvmpipe|software/.test(gpuLc);
      if (weakGpu) return 0;

      // Known but unrecognised (e.g. Mali-G76/G77, Adreno 620/640/650):
      // mid-range on mobile, capable on desktop. Never jumped to high via specs.
      return isMobile ? 1 : 2;
    }

    // GPU masked/unavailable → lean cautiously on memory + cores. We never
    // reach `high` here (can't confirm the GPU), only low ↔ balanced.
    if (isMobile) {
      if (mem && mem <= 3) return 0;
      if (cores && cores <= 4) return 0;
      if (!mem && !cores) return 0;         // truly unknown mobile → play it safe
      if (mem && mem >= 8 && cores >= 8) return 1;
      return 0;                             // masked mid Android → start low, let
                                            // the watchdog promote-by-not-demoting
    }
    return 2;  // desktop/laptop with a masked GPU → assume capable
  }

  var detected = classify();

  // Never boot HIGHER than a tier this device has previously measured slow at.
  var store = loadStore();
  var tier = detected;
  if (typeof store.maxTier === 'number') tier = Math.min(tier, store.maxTier);
  tier = Math.max(0, Math.min(2, tier));

  // ── Per-tier settings ─────────────────────────────────────────────────
  var TIERS = [
    { // 0 — low  (budget Androids: Galaxy M/A, Redmi, Realme entry, etc.)
      name: 'low',
      pixelRatio: 1,
      antialias: false,
      buildingGlow: false,
      landmarkModels: false,   // skip heavy Three.js procedural buildings
      berms: false,
      vegetationDensity: 0.35,
      maxPitch: 52,
    },
    { // 1 — balanced (mid-range phones: Mali-G76/G77, Adreno 6xx mid, etc.)
      // Antialiasing is OFF here on purpose — MSAA is one of the biggest costs
      // on Mali/Adreno mid GPUs, and dropping it (plus a modest resolution cap)
      // is what keeps these phones smooth while still showing the full 3D scene.
      name: 'balanced',
      pixelRatio: Math.min(dpr, 1.3),
      antialias: false,
      buildingGlow: false,
      landmarkModels: true,
      berms: true,
      vegetationDensity: 0.55,
      maxPitch: 58,
    },
    { // 2 — high (flagships, tablets, desktop)
      name: 'high',
      pixelRatio: Math.min(dpr, 2),
      antialias: true,
      buildingGlow: true,
      landmarkModels: true,
      berms: true,
      vegetationDensity: 1,
      maxPitch: 60,
    },
  ];

  function apply(t) {
    var c = TIERS[t];
    PerfTier.tier = t;
    PerfTier.tierName = c.name;
    PerfTier.pixelRatio = c.pixelRatio;
    PerfTier.antialias = c.antialias;
    PerfTier.buildingGlow = c.buildingGlow;
    PerfTier.landmarkModels = c.landmarkModels;
    PerfTier.berms = c.berms;
    PerfTier.vegetationDensity = c.vegetationDensity;
    PerfTier.maxPitch = c.maxPitch;
  }

  var PerfTier = {
    detectedTier: detected,
    gpu: gpu, deviceMemory: mem, cores: cores, dpr: dpr,
    // Scale an instance count (trees/shrubs) by this tier's vegetation density.
    veg: function (n) { return Math.max(0, Math.round(n * PerfTier.vegetationDensity)); },
  };
  apply(tier);

  // ── FPS watchdog ──────────────────────────────────────────────────────
  // MapLibre paints on demand, so a plain rAF loop would read a false 60fps
  // whenever the map is idle. Instead we sample frame INTERVALS only while the
  // camera is actually moving (pan/zoom/rotate/pitch) — precisely when the GPU
  // is under load. If a movement isn't running SMOOTHLY (target ~50fps, not
  // just "not frozen"), we drop the pixel ratio right now (cheap, immediate)
  // AND remember to boot a tier lower next session — which then also turns off
  // AA / heavy models / glow from the start. It can step down more than once
  // (high → balanced → low) across a session, with a short cooldown between
  // steps so each change gets a chance to take effect before we judge again.
  var SMOOTH_FPS = 50;      // below this during movement = not smooth → demote
  var STEP_COOLDOWN = 3500; // ms to let a demotion settle before judging again
  var SAMPLE_N = 18;        // frames per FPS estimate (~0.3s at 60fps)

  PerfTier.attachWatchdog = function (map) {
    if (!map) return;
    var moving = false, last = 0, samples = [], nextEval = 0, slowStreak = 0;

    map.on('movestart', function () { moving = true; last = 0; samples.length = 0; });
    map.on('moveend',   function () { moving = false; last = 0; samples.length = 0; });

    map.on('render', function () {
      if (!moving || PerfTier.tier <= 0) return;
      var now = performance.now();
      if (now < nextEval) { last = now; samples.length = 0; return; }  // cooling down
      if (last) {
        var dt = now - last;
        if (dt > 0 && dt < 500) samples.push(dt);  // ignore tab-throttle/GC gaps
      }
      last = now;
      if (samples.length >= SAMPLE_N) {
        var arr = samples.slice().sort(function (a, b) { return a - b; });
        var fps = 1000 / arr[arr.length >> 1];     // median interval → fps
        samples.length = 0;
        // Two consecutive slow windows before demoting, so a single GC hiccup
        // can't permanently downgrade a phone that's otherwise fine.
        if (fps < SMOOTH_FPS) {
          if (++slowStreak >= 2) {
            slowStreak = 0;
            liveDemote(map);
            nextEval = performance.now() + STEP_COOLDOWN;
          }
        } else {
          slowStreak = 0;
        }
      }
    });
  };

  function liveDemote(map) {
    var t = Math.max(0, PerfTier.tier - 1);
    apply(t);
    if (typeof map.setPixelRatio === 'function') {
      try { map.setPixelRatio(PerfTier.pixelRatio); } catch (e) {}
    }
    // Persist so next load boots here and applies the full lighter profile
    // (AA / models / glow), which live setPixelRatio alone can't change.
    var s = loadStore();
    s.maxTier = Math.min(typeof s.maxTier === 'number' ? s.maxTier : 2, t);
    saveStore(s);
    try {
      map.fire('perf-tier-change', { tier: t, tierName: PerfTier.tierName });
    } catch (e) {}
    if (window.console) console.info('[PerfTier] demoted → ' + PerfTier.tierName + ' (slow frames)');
  }

  window.PerfTier = PerfTier;
  if (window.console) {
    console.info('[PerfTier] ' + PerfTier.tierName +
      '  (gpu="' + (gpu || 'unknown') + '", mem=' + (mem || '?') + 'GB, cores=' +
      (cores || '?') + ', dpr=' + dpr + ', pixelRatio=' + PerfTier.pixelRatio + ')');
  }
})();
