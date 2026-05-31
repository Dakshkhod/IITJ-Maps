/**
 * 3D Landmark layer registry
 * Renders configured 3D models (OBJ / GLB) inside a single MapLibre custom
 * layer using Three.js. Visible only in 3D mode.
 *
 * To add a landmark: add an entry to LANDMARKS and drop the mesh into
 * web/assets/models/. No other code needs to change.
 */
const Landmarks3D = (() => {
  // Bronze/gold metal — for sculptures / metallic landmarks
  const MATERIAL_BRONZE = { color: 0xc59a6b, metalness: 0.85, roughness: 0.32 };
  // Sandstone tan — matches IITJ's signature building stone
  const MATERIAL_SANDSTONE = { color: 0xb89a78, metalness: 0.05, roughness: 0.85 };

  // Three.js Y-up → MapLibre Z-up (the trimesh-exported meshes all use Y-up)
  const Y_UP_TO_Z_UP = Math.PI / 2;

  const LANDMARKS = [
    {
      id: 'brain-tree-3d',
      file: 'assets/models/brain-tree.obj',
      format: 'obj',
      lng: 73.1141831, lat: 26.4692822,
      heightMeters: 18,
      material: MATERIAL_BRONZE,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
    },
    {
      // OSM library polygon centroid — replaces the plain extrusion in
      // buildings-3d via the SUPPRESS_BUILDING_3D_IDS filter below.
      id: 'library-3d',
      file: 'assets/models/library.glb',
      format: 'gltf',
      lng: 73.1134521, lat: 26.4715926,
      heightMeters: 22,
      material: MATERIAL_SANDSTONE,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
      // OSM building polygons this model replaces (hide their extrusion)
      replacesOsmBuildings: ['773563507'],
    },
    {
      // Clock tower sits at the WSW corner of the library complex
      id: 'clock-tower-3d',
      file: 'assets/models/clock-tower.glb',
      format: 'gltf',
      lng: 73.1133171, lat: 26.4716376,
      heightMeters: 38,
      material: MATERIAL_SANDSTONE,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
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

        // Three-point lighting — flatters both metal and stone
        const sun = new THREE.DirectionalLight(0xffffff, 1.05);
        sun.position.set(0.5, -1, 0.8).normalize();
        this.scene.add(sun);
        const fill = new THREE.DirectionalLight(0xfff2d5, 0.45);
        fill.position.set(-0.7, 0.6, 0.4).normalize();
        this.scene.add(fill);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));

        const material = new THREE.MeshStandardMaterial({
          color: cfg.material.color,
          metalness: cfg.material.metalness,
          roughness: cfg.material.roughness,
          side: THREE.DoubleSide,
        });

        this.group = new THREE.Group();
        this.scene.add(this.group);

        const onLoaded = (root) => {
          root.traverse((child) => {
            if (child.isMesh) {
              child.material = material;
              child.geometry.computeVertexNormals();
            }
          });

          // Centre horizontally, rest base on z=0
          const bbox = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3(); bbox.getSize(size);
          const center = new THREE.Vector3(); bbox.getCenter(center);
          root.position.set(-center.x, -bbox.min.y, -center.z);

          const scale = cfg.heightMeters / size.y;
          root.scale.set(scale, scale, scale);

          this.group.add(root);
        };

        if (cfg.format === 'obj') {
          new THREE.OBJLoader().load(cfg.file, onLoaded, undefined,
            (err) => console.warn(`[Landmarks3D:${cfg.id}] OBJ load failed:`, err));
        } else {
          new THREE.GLTFLoader().load(cfg.file, (g) => onLoaded(g.scene), undefined,
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
          // y negated: MapLibre is left-handed, three.js is right-handed
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

  // OSM building IDs that should be hidden in buildings-3d because a
  // detailed GLB landmark replaces them (so the plain white extrusion
  // doesn't poke out underneath the model).
  function replacedBuildingIds() {
    const ids = [];
    for (const l of LANDMARKS) {
      if (Array.isArray(l.replacesOsmBuildings)) ids.push(...l.replacesOsmBuildings);
    }
    return ids;
  }

  return { init, show, hide, isVisible, listIds, replacedBuildingIds };
})();
