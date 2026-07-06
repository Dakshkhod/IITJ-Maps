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

  // v2: tier indices changed (3-tier → 4-tier gradient), so old persisted
  // maxTier values would mean the wrong tier — start fresh under a new key.
  var STORE_KEY = 'iitj_perf_v2';

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

  // ── Classify → 0 low / 1 reduced / 2 balanced / 3 high ─────────────────
  // Four tiers so quality lowers GRADUALLY: each step down cuts only what's
  // needed for smoothness at that level (see TIERS). Crucially, only the LOWEST
  // tier drops the detailed Three.js models — mid-range phones keep them.
  var TIER_HIGH = 3, TIER_BALANCED = 2, TIER_REDUCED = 1, TIER_LOW = 0;

  function classify() {
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var isMobile = coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

    // When we can read the GPU, trust IT — not RAM/cores, which are poor
    // proxies for rendering power (plenty of mid-range phones ship 6–8 GB and
    // 8 cores behind a weak GPU). RAM/cores are only a fallback for masked GPUs.
    if (gpuLc) {
      // ── Known-STRONG → high (full detailed scene) ──
      //   Apple GPUs; Adreno 7xx/8xx (2022+ flagships); Mali-G7xx *three-digit*
      //   (G710/G715/G720) and Immortalis; desktop discrete/modern integrated.
      if (/apple gpu|apple m\d/.test(gpuLc)) return TIER_HIGH;
      if (/adreno[^\d]*(7\d\d|8\d\d)\b/.test(gpuLc)) return TIER_HIGH;
      if (/mali-g7\d\d|immortalis/.test(gpuLc)) return TIER_HIGH;
      if (!isMobile && /nvidia|geforce|radeon|intel.*(arc|iris)/.test(gpuLc)) return TIER_HIGH;

      // ── Known-WEAK → low (simplified 3D, no Three.js models) ──
      //   Budget Mali (T-series, G31/G5x, e.g. Galaxy M32's G52), entry Adreno
      //   (3xx–5xx, 60x/61x), PowerVR, software rasterisers.
      var weakGpu =
        /mali-(4\d\d|t\d{3}|g3\d|g5\d)\b/.test(gpuLc) ||
        /adreno[^\d]*(3\d\d|4\d\d|5\d\d|60\d|61\d)\b/.test(gpuLc) ||
        /powervr|videocore|swiftshader|llvmpipe|software/.test(gpuLc);
      if (weakGpu) return TIER_LOW;

      // Older upper-mid Mali (G76/G77/G78, ~2019–20, e.g. Realme 6) and
      // older-mid Adreno (620–639) → reduced: the lighter (draw-call-merged)
      // model set at trimmed resolution, so they're smooth but still show the
      // real 3D buildings rather than plain boxes.
      if (/mali-g7[678]\b/.test(gpuLc)) return TIER_REDUCED;
      if (/adreno[^\d]*6[23]\d\b/.test(gpuLc)) return TIER_REDUCED;

      // Newer/unrecognised mid-range (Mali-G6xx e.g. Nord CE5's G615, Adreno
      // 640/650/66x): full models with only a small cut (balanced). The
      // watchdog steps a specific phone down further if it can't sustain it.
      return isMobile ? TIER_BALANCED : TIER_HIGH;
    }

    // GPU masked/unavailable → lean cautiously on memory + cores. We never
    // reach `high` here (can't confirm the GPU), and keep models where plausible.
    if (isMobile) {
      if (mem && mem <= 3) return TIER_LOW;
      if (cores && cores <= 4) return TIER_LOW;
      if (!mem && !cores) return TIER_LOW;              // truly unknown → play it safe
      if (mem && mem >= 6 && cores >= 8) return TIER_REDUCED;  // capable-ish, keep models
      return TIER_LOW;
    }
    return TIER_HIGH;  // desktop/laptop with a masked GPU → assume capable
  }

  // Debug/support override: localStorage.iitj_perf_force = 0..3 pins the tier
  // (bypasses detection AND the watchdog's persisted cap). Handy for testing a
  // specific tier on any device; unset to return to automatic.
  var forced = null;
  try {
    var f = localStorage.getItem('iitj_perf_force');
    if (f != null && f !== '') forced = Math.max(0, Math.min(3, parseInt(f, 10) || 0));
  } catch (e) {}

  var detected = (forced != null) ? forced : classify();

  // Never boot HIGHER than a tier this device has previously measured slow at.
  var store = loadStore();
  var tier = detected;
  if (forced == null && typeof store.maxTier === 'number') tier = Math.min(tier, store.maxTier);
  tier = Math.max(0, Math.min(3, tier));

  // ── Per-tier settings — a GRADUAL quality gradient ─────────────────────
  // Each step down cuts only what's necessary for smoothness at that level,
  // cheapest-visual-impact first:
  //   high     → full detailed scene (flagships).
  //   balanced → small cut: drop antialiasing (MSAA is costly on mobile GPUs)
  //              and the doubled glow layer. KEEPS the detailed 3D models,
  //              near-native resolution, full-ish trees. (Capable mid-range,
  //              e.g. OnePlus Nord CE5.)
  //   reduced  → medium cut: lower resolution + fewer trees. STILL keeps the
  //              detailed models. (Weaker mid-range / older phones.)
  //   low      → reasonable cut: the simplified, non-Three.js version — cheap
  //              MapLibre extruded building boxes instead of models, no berms,
  //              sparse trees, no background prewarm. (Weak GPUs, e.g. M32.)
  // The FPS watchdog moves a phone down one notch at a time until it's smooth,
  // so the model-dropping "low" tier is only reached by devices that truly
  // need it — mid-range phones keep the full 3D buildings.
  var TIERS = [
    { // 0 — low  (weak GPUs: Mali-G52/T-series, entry Adreno, PowerVR)
      name: 'low',
      pixelRatio: Math.min(dpr, 1.5),   // sharp enough without shading full native
      antialias: false,
      buildingGlow: false,
      landmarkModels: false,   // simplified 3D — extruded boxes, no models
      mergeModels: false,
      berms: false,
      vegetationDensity: 0.35,
      maxPitch: 52,
      prewarm3D: false,
    },
    { // 1 — reduced  (weaker mid-range — the LIGHTER Three.js model set)
      // Keeps the real 3D buildings but merges each one's hundreds of little
      // meshes into a few draw calls (mergeModels), which is the main cost on
      // these GPUs. Trimmed resolution + fewer trees, and built lazily on first
      // 3D tap (no background upload → no load-time stutter).
      name: 'reduced',
      pixelRatio: Math.min(dpr, 1.5),
      antialias: false,
      buildingGlow: false,
      landmarkModels: true,
      mergeModels: true,       // ← the "lighter Three.js version"
      berms: true,
      vegetationDensity: 0.5,
      maxPitch: 56,
      prewarm3D: false,
    },
    { // 2 — balanced  (capable mid-range: Nord CE5, Mali-G615/G6xx, Adreno 64x+)
      // Small cut only: no MSAA, no glow layer — but the FULL detailed 3D
      // models at near-native resolution, so it still looks rich.
      name: 'balanced',
      pixelRatio: Math.min(dpr, 2),
      antialias: false,
      buildingGlow: false,
      landmarkModels: true,
      mergeModels: false,
      berms: true,
      vegetationDensity: 0.8,
      maxPitch: 60,
      prewarm3D: true,
    },
    { // 3 — high  (flagships, tablets, desktop) — the complete scene
      name: 'high',
      pixelRatio: Math.min(dpr, 2),
      antialias: true,
      buildingGlow: true,
      landmarkModels: true,
      mergeModels: false,
      berms: true,
      vegetationDensity: 1,
      maxPitch: 60,
      prewarm3D: true,
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
    PerfTier.mergeModels = c.mergeModels;
    PerfTier.berms = c.berms;
    PerfTier.vegetationDensity = c.vegetationDensity;
    PerfTier.maxPitch = c.maxPitch;
    PerfTier.prewarm3D = c.prewarm3D;
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
    s.maxTier = Math.min(typeof s.maxTier === 'number' ? s.maxTier : 3, t);
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
