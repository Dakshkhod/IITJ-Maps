/**
 * 3D Landmark layer registry
 * Renders configured 3D models inside a single MapLibre custom layer
 * using Three.js. Visible only in 3D mode.
 *
 * Three formats are supported per landmark:
 *   - 'obj'         load an OBJ mesh, apply uniform material
 *   - 'gltf' | 'glb' load a glTF / GLB scene, apply uniform material
 *   - 'procedural'  call a builder function that returns a THREE.Group
 *                   already coloured and dimensioned in metres
 *
 * To add a landmark: push an entry into LANDMARKS. No other code changes.
 */
const Landmarks3D = (() => {
  // Three.js Y-up → MapLibre Z-up (mesh-derived models all use Y-up)
  const Y_UP_TO_Z_UP = Math.PI / 2;

  // Materials used across procedural builds (and as a fallback uniform
  // material for OBJ / GLB meshes that have no embedded materials).
  const MAT = {
    bronze:    new THREE.MeshStandardMaterial({ color: 0xc59a6b, metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide }),
    sandstone: new THREE.MeshStandardMaterial({ color: 0xb89a78, metalness: 0.05, roughness: 0.85 }),
    sandDark:  new THREE.MeshStandardMaterial({ color: 0x8d6e4f, metalness: 0.05, roughness: 0.9 }),
    column:    new THREE.MeshStandardMaterial({ color: 0xece1cd, metalness: 0.04, roughness: 0.65 }),
    entrance:  new THREE.MeshStandardMaterial({ color: 0x2c2018, metalness: 0.20, roughness: 0.55 }),
    clockFace: new THREE.MeshStandardMaterial({ color: 0xf6f0e1, metalness: 0.10, roughness: 0.45 }),
    clockHand: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, metalness: 0.30, roughness: 0.55 }),
  };

  // ── Procedural builder: SR Ranganathan Learning Hub + Clock Tower ──────
  // All units are metres. The group's local Y is up; the parent layer will
  // rotate Y→Z to align with MapLibre's coordinate system.
  function buildLibraryComplex() {
    const g = new THREE.Group();

    // Footprint matches OSM polygon (~35m × ~48m); long axis along X.
    const BODY_W  = 48;          // X — long axis (E-W after bearing rotation)
    const BODY_D  = 32;          // Z — short axis
    const BODY_H  = 18;          // sandstone main mass height

    // ── Main body ──────────────────────────────────────────────────
    const body = new THREE.Mesh(new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D), MAT.sandstone);
    body.position.y = BODY_H / 2;
    g.add(body);

    // Horizontal banding (faint lines just for visual richness)
    for (const yFrac of [0.33, 0.66]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(BODY_W + 0.05, 0.25, BODY_D + 0.05), MAT.sandDark);
      band.position.y = BODY_H * yFrac;
      g.add(band);
    }

    // Roof slab + parapet
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(BODY_W + 1.2, 1.4, BODY_D + 1.2), MAT.sandDark);
    cornice.position.y = BODY_H + 0.7;
    g.add(cornice);
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(BODY_W + 0.6, 1.0, BODY_D + 0.6), MAT.sandstone);
    parapet.position.y = BODY_H + 1.4 + 0.5;
    g.add(parapet);

    // ── Colonnade along +Z face (the photogenic front) ─────────────
    const COL_COUNT   = 9;
    const COL_R       = 0.55;
    const COL_H       = BODY_H + 1.4;          // up to entablature
    const COL_OFFSET  = BODY_D / 2 + 2.6;      // metres in front of body
    const colSpan     = BODY_W - 4;            // span minus end margins
    const colStep     = colSpan / (COL_COUNT - 1);
    for (let i = 0; i < COL_COUNT; i++) {
      const x = -colSpan / 2 + i * colStep;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(COL_R, COL_R, COL_H, 14), MAT.column);
      col.position.set(x, COL_H / 2, COL_OFFSET);
      g.add(col);
    }
    // Entablature beam across the colonnade
    const entablature = new THREE.Mesh(new THREE.BoxGeometry(colSpan + 2 * COL_R, 1.8, 1.6), MAT.column);
    entablature.position.set(0, COL_H + 0.9, COL_OFFSET);
    g.add(entablature);
    // Dark coping above the entablature
    const coping = new THREE.Mesh(new THREE.BoxGeometry(colSpan + 2 * COL_R + 1, 0.6, 2), MAT.sandDark);
    coping.position.set(0, COL_H + 2.1, COL_OFFSET);
    g.add(coping);

    // ── Recessed dark entrance on the front, centred ───────────────
    const entrance = new THREE.Mesh(new THREE.BoxGeometry(5, 6.5, 0.6), MAT.entrance);
    entrance.position.set(0, 3.25, BODY_D / 2 + 0.3);
    g.add(entrance);

    // ── Clock tower at the −X end (west) ───────────────────────────
    // Stepped tiers, each slightly smaller, totalling ~38m
    const TOWER_X = -BODY_W / 2 - 1.5;     // sit just outside the west wall
    const TOWER_Z = 0;                     // centred in depth
    const tiers = [
      { w: 11, d: 11, h: 13 },             // base mass (rises from ground)
      { w:  9.5, d: 9.5, h: 7 },           // mid
      { w:  8,   d: 8,   h: 6 },           // clock level
      { w:  6,   d: 6,   h: 4 },           // belfry
      { w:  4.5, d: 4.5, h: 3 },           // crown
      { w:  2.5, d: 2.5, h: 2 },           // finial cap
    ];
    let towerY = 0;
    const clockTierIndex = 2;
    let clockY = 0;
    let clockTier = null;
    tiers.forEach((t, i) => {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.d), MAT.sandstone);
      tier.position.set(TOWER_X, towerY + t.h / 2, TOWER_Z);
      g.add(tier);
      // Cornice line above each tier (skip the very top cap)
      if (i < tiers.length - 1) {
        const ledge = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.5, 0.45, t.d + 0.5), MAT.sandDark);
        ledge.position.set(TOWER_X, towerY + t.h, TOWER_Z);
        g.add(ledge);
      }
      if (i === clockTierIndex) {
        clockY = towerY + t.h / 2;
        clockTier = t;
      }
      towerY += t.h;
    });

    // ── Four clock faces on the clock tier ─────────────────────────
    const faceGeom = new THREE.CircleGeometry(1.3, 24);
    const handVert = new THREE.BoxGeometry(0.12, 0.95, 0.05);
    const handHorz = new THREE.BoxGeometry(0.12, 0.7,  0.05);
    [0, 1, 2, 3].forEach((i) => {
      const angle = (i * Math.PI) / 2;
      const nx = Math.sin(angle), nz = Math.cos(angle);
      // Face plate
      const face = new THREE.Mesh(faceGeom, MAT.clockFace);
      face.position.set(
        TOWER_X + nx * (clockTier.w / 2 + 0.06),
        clockY,
        TOWER_Z + nz * (clockTier.d / 2 + 0.06),
      );
      face.lookAt(face.position.x + nx, face.position.y, face.position.z + nz);
      g.add(face);
      // Minute + hour hand (visual hint, not a real time read-out)
      const h1 = new THREE.Mesh(handVert, MAT.clockHand);
      const h2 = new THREE.Mesh(handHorz, MAT.clockHand);
      h1.position.copy(face.position).addScaledVector(new THREE.Vector3(nx, 0, nz), 0.04);
      h2.position.copy(face.position).addScaledVector(new THREE.Vector3(nx, 0, nz), 0.04);
      h1.quaternion.copy(face.quaternion);
      h2.quaternion.copy(face.quaternion);
      h2.rotation.z += Math.PI / 3;        // splay the hour hand
      g.add(h1, h2);
    });

    return g;
  }

  // ── Landmark registry ───────────────────────────────────────────────────
  const LANDMARKS = [
    {
      id: 'brain-tree-3d',
      format: 'obj',
      file: 'assets/models/brain-tree.obj',
      lng: 73.1141831, lat: 26.4692822,
      heightMeters: 18,
      material: MAT.bronze,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
    },
    {
      id: 'library-3d',
      format: 'procedural',
      build: buildLibraryComplex,
      // Anchor on the OSM library polygon centroid
      lng: 73.1134521, lat: 26.4715926,
      // null → use the builder's native metre-scale (no auto-fit)
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
      replacesOsmBuildings: ['773563507'],
    },
  ];

  let _map = null;
  let _ready = false;
  let _visible = false;

  function _buildLayer(cfg) {
    return {
      id: cfg.id,
      type: 'custom',
      renderingMode: '3d',

      onAdd(map, gl) {
        this.map = map;
        this.camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.1, 1e6);
        this.scene = new THREE.Scene();

        // Three-point lighting flatters both metal and stone
        const sun = new THREE.DirectionalLight(0xffffff, 1.05);
        sun.position.set(0.5, -1, 0.8).normalize();
        this.scene.add(sun);
        const fill = new THREE.DirectionalLight(0xfff2d5, 0.45);
        fill.position.set(-0.7, 0.6, 0.4).normalize();
        this.scene.add(fill);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));

        this.group = new THREE.Group();
        this.scene.add(this.group);

        const place = (root) => {
          // For mesh imports (no embedded material), paint a uniform one.
          // Procedural builds keep their own per-mesh materials.
          if (cfg.format !== 'procedural' && cfg.material) {
            root.traverse((c) => {
              if (c.isMesh) {
                c.material = cfg.material;
                c.geometry.computeVertexNormals();
              }
            });
          }
          // Centre horizontally, rest base on y=0
          const bbox = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();   bbox.getSize(size);
          const center = new THREE.Vector3(); bbox.getCenter(center);
          root.position.set(-center.x, -bbox.min.y, -center.z);
          // Auto-fit to heightMeters when one is given; otherwise trust the
          // builder's native scale (procedural models are already in metres).
          if (cfg.heightMeters && size.y > 0) {
            const s = cfg.heightMeters / size.y;
            root.scale.set(s, s, s);
          }
          this.group.add(root);
        };

        if (cfg.format === 'procedural') {
          place(cfg.build());
        } else if (cfg.format === 'obj') {
          new THREE.OBJLoader().load(cfg.file, place, undefined,
            (err) => console.warn(`[Landmarks3D:${cfg.id}] OBJ load failed:`, err));
        } else {
          new THREE.GLTFLoader().load(cfg.file, (g) => place(g.scene), undefined,
            (err) => console.warn(`[Landmarks3D:${cfg.id}] GLB load failed:`, err));
        }

        this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
        this.renderer.autoClear = false;
      },

      render(gl, matrix) {
        const mc = maplibregl.MercatorCoordinate.fromLngLat([cfg.lng, cfg.lat], 0);
        const metersToMerc = mc.meterInMercatorCoordinateUnits();
        const rotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), cfg.rotateMeshToUp);
        const rotZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), cfg.bearingOffset);
        const m = new THREE.Matrix4().fromArray(matrix);
        const l = new THREE.Matrix4()
          .makeTranslation(mc.x, mc.y, mc.z)
          .scale(new THREE.Vector3(metersToMerc, -metersToMerc, metersToMerc))
          .multiply(rotX)
          .multiply(rotZ);
        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
      },
    };
  }

  function _threeReady() {
    return typeof THREE !== 'undefined' && THREE.OBJLoader && THREE.GLTFLoader;
  }

  function init(map) {
    if (!_threeReady()) { console.warn('[Landmarks3D] three.js not loaded yet'); return; }
    _map = map;
    _ready = true;
  }

  function _ensureLayer(cfg) {
    if (!_map.getLayer(cfg.id)) {
      try { _map.addLayer(_buildLayer(cfg)); }
      catch (e) { console.warn(`[Landmarks3D] addLayer ${cfg.id} failed:`, e); }
    }
  }

  function _setAllVisibility(vis) {
    if (!_ready) return;
    for (const cfg of LANDMARKS) {
      if (vis === 'visible') _ensureLayer(cfg);
      if (_map.getLayer(cfg.id)) {
        try { _map.setLayoutProperty(cfg.id, 'visibility', vis); } catch (_) {}
      }
    }
  }

  function show() { _visible = true;  _setAllVisibility('visible'); }
  function hide() { _visible = false; _setAllVisibility('none');    }
  function isVisible() { return _visible; }
  function listIds() { return LANDMARKS.map(l => l.id); }

  // OSM building IDs that a detailed landmark replaces — used by app.js to
  // suppress the plain extrusion under the model.
  function replacedBuildingIds() {
    const ids = [];
    for (const l of LANDMARKS) {
      if (Array.isArray(l.replacesOsmBuildings)) ids.push(...l.replacesOsmBuildings);
    }
    return ids;
  }

  return { init, show, hide, isVisible, listIds, replacedBuildingIds };
})();
