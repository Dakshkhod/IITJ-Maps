/**
 * Brain Tree 3D model layer
 * Renders the iconic Brain Tree sculpture as a Three.js mesh inside a
 * MapLibre custom layer. The layer is added once and toggled with the
 * map's 3D mode.
 *
 * Anchored at the actual OSM artwork location:
 *   lat 26.4692822, lng 73.1141831  (way "Brain Tree", tourism=artwork)
 */
const BrainTree3D = (() => {
  // Real-world location of the sculpture
  const ORIGIN = { lng: 73.1141831, lat: 26.4692822 };
  // Visible size on the map (real sculpture is ~6m; rendered larger so it
  // reads as a landmark at zoom 16–18)
  const HEIGHT_METERS = 18;
  // The OBJ was exported with no explicit "up" axis. We rotate so the
  // mesh's local Y-axis becomes the map's vertical (up) axis.
  const ROT_MESH_TO_UP = Math.PI / 2;
  // Spin around vertical to face the camera nicely; tweak if needed
  const BEARING_OFFSET = 0;

  let _map = null;
  let _layer = null;
  let _ready = false;
  let _visible = false;

  function _buildLayer() {
    return {
      id: 'brain-tree-3d',
      type: 'custom',
      renderingMode: '3d',

      onAdd(map, gl) {
        this.map = map;
        this.camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.1, 1e6);
        this.scene  = new THREE.Scene();

        // Warm directional + soft ambient — flatters a metallic surface
        const sun = new THREE.DirectionalLight(0xffffff, 1.05);
        sun.position.set(0.5, -1, 0.8).normalize();
        this.scene.add(sun);
        const fill = new THREE.DirectionalLight(0xfff2d5, 0.45);
        fill.position.set(-0.7, 0.6, 0.4).normalize();
        this.scene.add(fill);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));

        // Bronze/gold metallic material (matches the sculpture's dominant colour)
        const material = new THREE.MeshStandardMaterial({
          color: 0xc59a6b,
          metalness: 0.85,
          roughness: 0.32,
          side: THREE.DoubleSide,
        });

        this.group = new THREE.Group();
        this.scene.add(this.group);

        new THREE.OBJLoader().load('assets/models/brain-tree.obj', (obj) => {
          obj.traverse((child) => {
            if (child.isMesh) {
              child.material = material;
              child.geometry.computeVertexNormals();
            }
          });

          // Centre on origin and rest the base on z=0 (so it sits on the
          // ground rather than half-buried)
          const bbox = new THREE.Box3().setFromObject(obj);
          const size = new THREE.Vector3(); bbox.getSize(size);
          const center = new THREE.Vector3(); bbox.getCenter(center);
          obj.position.set(-center.x, -bbox.min.y, -center.z);

          // Normalise to HEIGHT_METERS tall
          const scale = HEIGHT_METERS / size.y;
          obj.scale.set(scale, scale, scale);

          this.group.add(obj);
        }, undefined, (err) => {
          console.warn('[BrainTree3D] failed to load OBJ:', err);
        });

        // Share MapLibre's GL context so we don't fight over canvas state
        this.renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true,
        });
        this.renderer.autoClear = false;
      },

      render(gl, matrix) {
        // Convert sculpture origin to Mercator units
        const mc = maplibregl.MercatorCoordinate.fromLngLat([ORIGIN.lng, ORIGIN.lat], 0);
        const metersToMerc = mc.meterInMercatorCoordinateUnits();

        // Position + scale group. Three.js Y axis becomes the map's vertical
        // axis after ROT_MESH_TO_UP, so we use Y for height.
        this.group.position.set(0, 0, 0);

        const rotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), ROT_MESH_TO_UP);
        const rotZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), BEARING_OFFSET);

        const m = new THREE.Matrix4().fromArray(matrix);
        const l = new THREE.Matrix4()
          .makeTranslation(mc.x, mc.y, mc.z)
          // Note: y-scale negated because MapLibre uses left-handed coords vs three.js right-handed
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

  function init(map) {
    if (typeof THREE === 'undefined' || !THREE.OBJLoader) {
      console.warn('[BrainTree3D] three.js not loaded yet');
      return;
    }
    _map = map;
    _ready = true;
  }

  function _ensureAdded() {
    if (!_ready || !_map) return false;
    if (!_map.getLayer('brain-tree-3d')) {
      try {
        // Rebuild a fresh layer object — onAdd will be called again, which
        // creates a fresh scene/renderer (needed after style reloads since
        // MapLibre tears down custom layers on setStyle).
        _layer = _buildLayer();
        _map.addLayer(_layer);
      } catch (e) {
        console.warn('[BrainTree3D] addLayer failed:', e);
        return false;
      }
    }
    return true;
  }

  function show() {
    if (!_ensureAdded()) return;
    _visible = true;
    try { _map.setLayoutProperty('brain-tree-3d', 'visibility', 'visible'); } catch (_) {}
  }

  function hide() {
    _visible = false;
    if (_map && _map.getLayer && _map.getLayer('brain-tree-3d')) {
      try { _map.setLayoutProperty('brain-tree-3d', 'visibility', 'none'); } catch (_) {}
    }
  }

  function isVisible() { return _visible; }

  return { init, show, hide, isVisible };
})();
