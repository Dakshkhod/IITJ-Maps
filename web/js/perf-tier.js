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

    // Known-STRONG GPUs → high, whatever the other signals say. (Checked first
    // so a flagship's high core count doesn't get mistaken below.)
    //   Apple GPUs (every recent iPhone/iPad), Adreno 7xx/8xx, Mali-G7xx,
    //   Immortalis, and anything Nvidia/Radeon/Intel Arc/Iris on desktop.
    if (/apple gpu|apple m\d/.test(gpuLc)) return 2;
    if (/adreno[^\d]*(7\d\d|8\d\d)/.test(gpuLc)) return 2;
    if (/mali-g7\d|immortalis/.test(gpuLc)) return 2;
    if (/nvidia|geforce|radeon|intel.*(arc|iris)|apple/.test(gpuLc) && !isMobile) return 2;

    // Known-WEAK GPUs → low. These are exactly the chips that make the app
    // crawl: budget Mali (T-series, G31/G5x), older/entry Adreno (3xx–5xx,
    // 60x/61x), PowerVR, and software rasterisers.
    var weakGpu =
      /mali-(4\d\d|t\d{3}|g3\d|g5\d)\b/.test(gpuLc) ||
      /adreno[^\d]*(3\d\d|4\d\d|5\d\d|60\d|61\d)\b/.test(gpuLc) ||
      /powervr|videocore|swiftshader|llvmpipe|software/.test(gpuLc);
    if (weakGpu) return 0;

    // GPU unknown/masked → lean on memory + cores. deviceMemory is quantised
    // and caps at 8; treat its absence on mobile as a reason to be cautious.
    if (isMobile) {
      if (mem && mem <= 2) return 0;
      if (cores && cores <= 4 && (!mem || mem <= 3)) return 0;
      if (mem && mem >= 6 && cores >= 8) return 2;
      if (!mem && !cores) return 0;   // truly unknown mobile → play it safe
      return 1;                       // mid-range Android
    }
    return 2;  // desktop/laptop with an unrecognised but non-weak GPU
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
    { // 1 — balanced (mid-range phones)
      name: 'balanced',
      pixelRatio: Math.min(dpr, 1.5),
      antialias: true,
      buildingGlow: true,
      landmarkModels: true,
      berms: true,
      vegetationDensity: 0.7,
      maxPitch: 60,
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
  // is under load. On a sustained-slow movement we drop the pixel ratio right
  // now (cheap, immediate) and remember to boot a tier lower next session
  // (which then also turns off AA / heavy models / glow from the start).
  PerfTier.attachWatchdog = function (map) {
    if (!map) return;
    var moving = false, last = 0, samples = [], demotedThisSession = false;

    map.on('movestart', function () { moving = true; last = 0; samples.length = 0; });
    map.on('moveend',   function () { moving = false; last = 0; samples.length = 0; });

    map.on('render', function () {
      if (!moving || PerfTier.tier <= 0 || demotedThisSession) return;
      var now = performance.now();
      if (last) {
        var dt = now - last;
        if (dt > 0 && dt < 500) samples.push(dt);  // ignore tab-throttle/GC gaps
      }
      last = now;
      if (samples.length >= 24) {
        var arr = samples.slice().sort(function (a, b) { return a - b; });
        var fps = 1000 / arr[arr.length >> 1];     // median interval → fps
        samples.length = 0;
        if (fps < 28) { demotedThisSession = true; liveDemote(map); }
      }
    });
  };

  function liveDemote(map) {
    var t = Math.max(0, PerfTier.tier - 1);
    apply(t);
    if (typeof map.setPixelRatio === 'function') {
      try { map.setPixelRatio(PerfTier.pixelRatio); } catch (e) {}
    }
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
