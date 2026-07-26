/**
 * Automatic device-capability tiering, from budget phones to desktop. No user
 * quality selector: the device is inspected once at boot, and everything else
 * reads window.PerfTier.* while building the map / Three.js renderer. An FPS
 * watchdog then nudges the tier down (and remembers it) on slower devices.
 *
 * Tiers tune the four things that actually cost frames on a mobile GPU:
 * pixelRatio (the big lever — an uncapped dpr of 2.75 shades ~7x the pixels),
 * antialias (MSAA is costly on budget Mali/Adreno), scene mass (Three.js models
 * + berms + tree density), and overdraw (glow layers, max pitch).
 *
 * Loads BEFORE app.js and landmarks-3d.js so both can read it at construction.
 */
(function () {
  'use strict';

  // Versioned store key: bumping it re-detects every device and discards any
  // stale persisted tier cap. See also WATCHDOG_FLOOR, which stops a one-off
  // cold-start hitch from persisting a demotion to 'low'.
  var STORE_KEY = 'iitj_perf_v4';

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // Raw device signals
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

  // Classify → 0 low / 1 reduced / 2 balanced / 3 high. Four tiers so quality
  // lowers gradually (see TIERS); only the lowest drops the Three.js models.
  var TIER_HIGH = 3, TIER_BALANCED = 2, TIER_REDUCED = 1, TIER_LOW = 0;

  function classify() {
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var isMobile = coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');

    // When we can read the GPU, trust IT — not RAM/cores, which are poor
    // proxies for rendering power (plenty of mid-range phones ship 6–8 GB and
    // 8 cores behind a weak GPU). RAM/cores are only a fallback for masked GPUs.
    if (gpuLc) {
      // Known-STRONG → high (full detailed scene)
      //   Apple GPUs; Adreno 7xx/8xx (2022+ flagships); Mali-G7xx *three-digit*
      //   (G710/G715/G720) and Immortalis; desktop discrete/modern integrated.
      if (/apple gpu|apple m\d/.test(gpuLc)) return TIER_HIGH;
      if (/adreno[^\d]*(7\d\d|8\d\d)\b/.test(gpuLc)) return TIER_HIGH;
      if (/mali-g7\d\d|immortalis/.test(gpuLc)) return TIER_HIGH;
      if (!isMobile && /nvidia|geforce|radeon|intel.*(arc|iris)/.test(gpuLc)) return TIER_HIGH;

      // Known-WEAK → low (simplified 3D, no Three.js models)
      //   Budget Mali (T-series, G31/G5x, e.g. Galaxy M32's G52), entry Adreno
      //   (3xx–5xx, 60x/61x), PowerVR, software rasterisers.
      var weakGpu =
        /mali-(4\d\d|t\d{3}|g3\d|g5\d)\b/.test(gpuLc) ||
        /adreno[^\d]*(3\d\d|4\d\d|5\d\d|60\d|61\d)\b/.test(gpuLc) ||
        /powervr|videocore|swiftshader|llvmpipe|software/.test(gpuLc);
      if (weakGpu) return TIER_LOW;

      // Older upper-mid Mali (G76-G78) and older-mid Adreno (620-639) → reduced:
      // draw-call-merged models at trimmed resolution, so they stay smooth but
      // still show real 3D buildings rather than plain boxes.
      if (/mali-g7[678]\b/.test(gpuLc)) return TIER_REDUCED;
      if (/adreno[^\d]*6[23]\d\b/.test(gpuLc)) return TIER_REDUCED;

      // Newer/unrecognised mid-range (Mali-G6xx e.g. Nord CE5's G615, Adreno
      // 640/650/66x): full models with only a small cut (balanced). The
      // watchdog steps a specific phone down further if it can't sustain it.
      return isMobile ? TIER_BALANCED : TIER_HIGH;
    }

    // GPU masked/unavailable → lean cautiously on memory + cores, never
    // reaching `high`. Since the models are draw-call-merged and cheap, a
    // capable-looking phone gets 'reduced' rather than plain boxes; the watchdog
    // drops it to low only if it genuinely can't cope.
    if (isMobile) {
      if (mem && mem <= 2) return TIER_LOW;             // clearly low-RAM
      if (cores && cores <= 4) return TIER_LOW;         // few cores
      if (!mem && !cores) return TIER_LOW;              // truly unknown → play it safe
      if (cores >= 6 || (mem && mem >= 4)) return TIER_REDUCED;  // capable-ish → merged models
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

  // Per-tier settings — a gradual gradient, each step cutting only what's needed
  // for smoothness, cheapest-visual-impact first:
  //   high     → full detailed scene.
  //   balanced → drop antialiasing + the doubled glow layer; keeps the models.
  //   reduced  → lower resolution + fewer trees; still keeps the models.
  //   low      → no Three.js: plain MapLibre extruded boxes, no berms, sparse
  //              trees, no prewarm.
  // The watchdog steps down one notch at a time, so only devices that truly
  // need it reach 'low' and lose the detailed buildings.
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
      // Keeps the real 3D buildings but merges each one's hundreds of meshes into
      // a few draw calls (mergeModels), the main cost on these GPUs. Trimmed
      // resolution, fewer trees, built lazily on first 3D tap to avoid a stutter.
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
      // models (draw-call-merged, so cheap) at near-native resolution.
      name: 'balanced',
      pixelRatio: Math.min(dpr, 2),
      antialias: false,
      buildingGlow: false,
      landmarkModels: true,
      mergeModels: true,       // identical look, ~95% fewer draw calls
      berms: true,
      vegetationDensity: 0.8,
      maxPitch: 60,
      prewarm3D: true,
    },
    { // 3 — high  (flagships, tablets, desktop) — the complete scene
      // Merge is a pure win (identical geometry, far fewer draw calls), so even
      // flagships use it — leaves headroom for antialiasing + glow.
      name: 'high',
      pixelRatio: Math.min(dpr, 2),
      antialias: true,
      buildingGlow: true,
      landmarkModels: true,
      mergeModels: true,
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
    // Set by landmarks-3d.js while the scene streams in or uploads to the GPU.
    // That one-time cost dips the frame rate on the first tilt into 3D; the
    // watchdog must not read it as slowness and demote a capable phone.
    sceneBusy: false,
    // Scale an instance count (trees/shrubs) by this tier's vegetation density.
    veg: function (n) { return Math.max(0, Math.round(n * PerfTier.vegetationDensity)); },
  };
  apply(tier);

  // FPS watchdog. MapLibre paints on demand, so a plain rAF loop would read a
  // false 60fps while idle; instead we sample frame intervals only while the
  // camera moves — exactly when the GPU is loaded. Below ~50fps we drop the
  // pixel ratio immediately AND boot a tier lower next session (which also
  // disables AA / heavy models / glow up front). Can step down repeatedly, with
  // a cooldown so each change takes effect before the next judgement.
  var SMOOTH_FPS = 50;      // below this during movement = not smooth → demote
  var STEP_COOLDOWN = 3500; // ms to let a demotion settle before judging again
  var SAMPLE_N = 18;        // frames per FPS estimate (~0.3s at 60fps)
  // The watchdog must never push a device the classifier judged capable below
  // the lightest tier that still draws the custom buildings ('reduced'), or a
  // transient hitch permanently strips the models. Genuinely weak GPUs are
  // already placed at 'low' by classify(); this only bounds AUTO demotion.
  var WATCHDOG_FLOOR = TIER_REDUCED;   // = 1

  PerfTier.attachWatchdog = function (map) {
    if (!map) return;
    var moving = false, last = 0, samples = [], nextEval = 0, slowStreak = 0;

    map.on('movestart', function () { moving = true; last = 0; samples.length = 0; });
    map.on('moveend',   function () { moving = false; last = 0; samples.length = 0; });

    map.on('render', function () {
      // Stop at the floor, and never judge frames spent building/uploading the
      // 3D scene — that one-time cost isn't the steady state we're measuring.
      // Reset the sampler so stale intervals don't leak into the next estimate.
      if (!moving || PerfTier.tier <= WATCHDOG_FLOOR || PerfTier.sceneBusy) {
        last = 0; samples.length = 0; return;
      }
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
    // Never step past the floor — the custom 3D buildings stay on any device
    // the classifier booted above 'low'.
    var t = Math.max(WATCHDOG_FLOOR, PerfTier.tier - 1);
    if (t === PerfTier.tier) return;
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
