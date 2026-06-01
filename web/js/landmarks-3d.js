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
    // Polished gold — lower metalness so the diffuse colour reads on the
    // map without a fancy environment map (pure metal needs reflections)
    gold:      new THREE.MeshStandardMaterial({ color: 0xe2c073, metalness: 0.45, roughness: 0.45, side: THREE.DoubleSide }),
    sandstone: new THREE.MeshStandardMaterial({ color: 0xb89a78, metalness: 0.05, roughness: 0.85 }),
    sandDark:  new THREE.MeshStandardMaterial({ color: 0x8d6e4f, metalness: 0.05, roughness: 0.9 }),
    column:    new THREE.MeshStandardMaterial({ color: 0xece1cd, metalness: 0.04, roughness: 0.65 }),
    entrance:  new THREE.MeshStandardMaterial({ color: 0x2c2018, metalness: 0.20, roughness: 0.55 }),
    clockFace: new THREE.MeshStandardMaterial({ color: 0xf6f0e1, metalness: 0.10, roughness: 0.45 }),
    clockHand: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, metalness: 0.30, roughness: 0.55 }),
    // Indian tricolor concentric platform under the Brain Tree
    grass:     new THREE.MeshStandardMaterial({ color: 0x4f8b3d, metalness: 0.02, roughness: 0.95 }),
    pebble:    new THREE.MeshStandardMaterial({ color: 0xeae3d2, metalness: 0.03, roughness: 0.88 }),
    saffron:   new THREE.MeshStandardMaterial({ color: 0xff9a3c, metalness: 0.05, roughness: 0.80 }),
    sandTop:   new THREE.MeshStandardMaterial({ color: 0xc7a679, metalness: 0.05, roughness: 0.85 }),
    brick:     new THREE.MeshStandardMaterial({ color: 0xa86a45, metalness: 0.05, roughness: 0.85 }),

    // Hostel materials — cream walls, pink banding, white pilasters, dark screens
    hostelWall:    new THREE.MeshStandardMaterial({ color: 0xebcfa8, metalness: 0.04, roughness: 0.85 }),
    hostelBand:    new THREE.MeshStandardMaterial({ color: 0xd99c70, metalness: 0.04, roughness: 0.85 }),
    hostelTrim:    new THREE.MeshStandardMaterial({ color: 0xf2ebdc, metalness: 0.04, roughness: 0.70 }),
    hostelScreen:  new THREE.MeshStandardMaterial({ color: 0x6b4a36, metalness: 0.05, roughness: 0.80 }),
    hostelRoof:    new THREE.MeshStandardMaterial({ color: 0x847362, metalness: 0.05, roughness: 0.85 }),

    // Red sandstone / brick block for Computer Centre & Chanakya
    redStone:      new THREE.MeshStandardMaterial({ color: 0x9d5a3c, metalness: 0.05, roughness: 0.90 }),
    redStoneDark:  new THREE.MeshStandardMaterial({ color: 0x754328, metalness: 0.05, roughness: 0.92 }),
    portalWhite:   new THREE.MeshStandardMaterial({ color: 0xefe9dc, metalness: 0.05, roughness: 0.65 }),

    // Fountain — bronze sculpture + sandstone basin
    bronzeSculp:   new THREE.MeshStandardMaterial({ color: 0x7a4f2a, metalness: 0.6, roughness: 0.4 }),
    water:         new THREE.MeshStandardMaterial({ color: 0x3e6b8a, metalness: 0.3, roughness: 0.25 }),

    // Missile — white body, orange stripes, dark base
    missileWhite:  new THREE.MeshStandardMaterial({ color: 0xf3f1ec, metalness: 0.20, roughness: 0.45 }),
    missileOrange: new THREE.MeshStandardMaterial({ color: 0xff7a2e, metalness: 0.15, roughness: 0.50 }),
    missileBase:   new THREE.MeshStandardMaterial({ color: 0x5a4632, metalness: 0.10, roughness: 0.80 }),
  };

  // ─────────────────────────────────────────────────────────────────────
  // O-LANE / Y-LANE HOSTEL — comb / E-shape: thin north spine + south wings
  // ─────────────────────────────────────────────────────────────────────
  // Per the satellite imagery and the OSM polygons (~70 × 43 m, 20+
  // vertices), each hostel is a long circulation spine on the NORTH side
  // with FIVE perpendicular dorm wings projecting south, forming open
  // courtyards between adjacent wings. 4 floors × 3.5 m = 14 m tall.
  //
  // The builder is parameterized so the same architectural style fits each
  // hostel's own footprint (length, bbox depth, wing count).
  function buildOLaneHostel(opts = {}) {
    const length      = opts.length      ?? 66;
    const bboxDepth   = opts.bboxDepth   ?? 42;   // total N-S extent
    const height      = opts.height      ?? 14;
    const wingCount   = opts.wingCount   ?? 5;
    const spineDepth  = opts.spineDepth  ?? 8;
    const wingWidth   = opts.wingWidth   ?? 7.5;
    const g = new THREE.Group();

    // Spine sits along the NORTH (-Z) edge of the footprint
    const spineZ   = -(bboxDepth / 2) + spineDepth / 2;
    const wingDepth = bboxDepth - spineDepth - 1;   // leaves 1 m south margin
    const wingZ    = spineZ + spineDepth / 2 + wingDepth / 2;

    // ── Main spine (circulation corridor)
    const spine = new THREE.Mesh(new THREE.BoxGeometry(length, height, spineDepth), MAT.hostelWall);
    spine.position.set(0, height / 2, spineZ);
    g.add(spine);
    // Pink banding on spine
    for (let i = 1; i <= 3; i++) {
      const y = height * i / 4;
      const band = new THREE.Mesh(new THREE.BoxGeometry(length + 0.10, 0.18, spineDepth + 0.10), MAT.hostelBand);
      band.position.set(0, y, spineZ);
      g.add(band);
    }
    // Spine parapet
    const spineParapet = new THREE.Mesh(new THREE.BoxGeometry(length + 0.2, 0.5, spineDepth + 0.2), MAT.hostelRoof);
    spineParapet.position.set(0, height + 0.25, spineZ);
    g.add(spineParapet);

    // ── End stair towers — bookend the spine with brick-screen jali
    const TOWER_W = 4.5;
    const TOWER_HT = height + 1.4;
    [-(length / 2) + TOWER_W / 2, (length / 2) - TOWER_W / 2].forEach((tx) => {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(TOWER_W, TOWER_HT, spineDepth + 0.5), MAT.hostelWall);
      tower.position.set(tx, TOWER_HT / 2, spineZ);
      g.add(tower);
      // Screen lattice on the NORTH face
      const lat = new THREE.Mesh(new THREE.BoxGeometry(TOWER_W - 0.7, height - 1.5, 0.08), MAT.hostelScreen);
      lat.position.set(tx, height / 2, spineZ - spineDepth / 2 - 0.3);
      g.add(lat);
    });

    // ── Five wings projecting SOUTH from the spine
    const wingSpacing = length / wingCount;
    for (let i = 0; i < wingCount; i++) {
      const wx = -length / 2 + wingSpacing * (i + 0.5);

      const wing = new THREE.Mesh(new THREE.BoxGeometry(wingWidth, height, wingDepth), MAT.hostelWall);
      wing.position.set(wx, height / 2, wingZ);
      g.add(wing);

      // Pink banding on each wing
      for (let j = 1; j <= 3; j++) {
        const y = height * j / 4;
        const band = new THREE.Mesh(new THREE.BoxGeometry(wingWidth + 0.08, 0.18, wingDepth + 0.08), MAT.hostelBand);
        band.position.set(wx, y, wingZ);
        g.add(band);
      }
      // Wing parapet
      const wingParapet = new THREE.Mesh(new THREE.BoxGeometry(wingWidth + 0.2, 0.45, wingDepth + 0.2), MAT.hostelRoof);
      wingParapet.position.set(wx, height + 0.225, wingZ);
      g.add(wingParapet);

      // White trim pilasters at the south end of each wing (the visible
      // long-facade short edge that faces the courtyard between wings)
      const wingSouthZ = wingZ + wingDepth / 2 + 0.05;
      const pil = new THREE.Mesh(new THREE.BoxGeometry(wingWidth + 0.3, height + 0.5, 0.2), MAT.hostelTrim);
      pil.position.set(wx, (height + 0.5) / 2, wingSouthZ);
      g.add(pil);
    }

    // ── Central entrance canopy on the middle wing's south face
    const midWingX = 0;
    const canopyZ  = wingZ + wingDepth / 2 + 1.5;
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.4, 2.4), MAT.hostelTrim);
    canopy.position.set(midWingX, 3.5, canopyZ);
    g.add(canopy);

    // ── Rooftop machine room on the spine
    const mech = new THREE.Mesh(new THREE.BoxGeometry(5, 2.5, 3.2), MAT.hostelWall);
    mech.position.set(length * 0.12, height + 1.25, spineZ);
    g.add(mech);

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // COMPUTER CENTRE — sandstone block with white portal frame entrance
  // ─────────────────────────────────────────────────────────────────────
  // Footprint ~39 × 42 m. 3 floors (~13 m). Symmetric stepped massing
  // with a central tall entrance volume flanked by two lower side wings,
  // joined by a tall WHITE structural portal frame at the entrance.
  function buildComputerCentre() {
    const g = new THREE.Group();
    const W = 36;             // E-W
    const D = 38;             // N-S
    const H_SIDE = 12;        // side wings
    const H_CENTRE = 15;      // central entrance volume

    // Two side wings (slightly recessed compared to the centre)
    const WING_W = 12;
    const WING_D = D;
    [-W / 2 + WING_W / 2, W / 2 - WING_W / 2].forEach((x) => {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(WING_W, H_SIDE, WING_D), MAT.redStone);
      wing.position.set(x, H_SIDE / 2, 0);
      g.add(wing);
      // dark capping band
      const cap = new THREE.Mesh(new THREE.BoxGeometry(WING_W + 0.2, 0.6, WING_D + 0.2), MAT.redStoneDark);
      cap.position.set(x, H_SIDE + 0.3, 0);
      g.add(cap);
    });

    // Central recessed entrance volume
    const CENTRE_W = W - 2 * WING_W;
    const centre = new THREE.Mesh(new THREE.BoxGeometry(CENTRE_W + 4, H_CENTRE, D - 6), MAT.redStone);
    centre.position.set(0, H_CENTRE / 2, -2);
    g.add(centre);
    const centreCap = new THREE.Mesh(new THREE.BoxGeometry(CENTRE_W + 4.4, 0.6, D - 5.6), MAT.redStoneDark);
    centreCap.position.set(0, H_CENTRE + 0.3, -2);
    g.add(centreCap);

    // White portal frame — two tall vertical columns + a horizontal beam
    const PORT_H = H_CENTRE - 1;
    const COL_W = 1.5;
    const portalSpan = CENTRE_W + 2;
    [-portalSpan / 2, portalSpan / 2].forEach((x) => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(COL_W, PORT_H, 1.4), MAT.portalWhite);
      col.position.set(x, PORT_H / 2, D / 2 - 4);
      g.add(col);
    });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(portalSpan + COL_W, 1.2, 1.4), MAT.portalWhite);
    beam.position.set(0, PORT_H - 0.6, D / 2 - 4);
    g.add(beam);
    // Small horizontal cross-beams (the three-bar look from the photo)
    for (let i = 0; i < 3; i++) {
      const cb = new THREE.Mesh(new THREE.BoxGeometry(portalSpan, 0.35, 1.0), MAT.portalWhite);
      cb.position.set(0, PORT_H - 1.4 - i * 0.7, D / 2 - 3.4);
      g.add(cb);
    }

    // Dark recessed entrance door
    const door = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.4), MAT.entrance);
    door.position.set(0, 2, D / 2 - 3.2);
    g.add(door);

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // CHANAKYA COMPLEX — Office of Administration + Office of Students
  // ─────────────────────────────────────────────────────────────────────
  // Two long parallel sandstone/brick blocks with brick-screen jali walls,
  // joined by a courtyard. Distinctive WHITE concrete portal frame at the
  // main entrance, with a stepped/curved top edge on the brick mass.
  // Builder is parametric so it can render the OoA and OoS halves at
  // their separate footprints.
  function buildChanakyaWing(opts = {}) {
    const length = opts.length ?? 38;     // X — long axis (E-W)
    const depth  = opts.depth  ?? 16;
    const height = opts.height ?? 14;
    const portal = opts.portal ?? true;
    const g = new THREE.Group();

    // Main brick-jali block
    const block = new THREE.Mesh(new THREE.BoxGeometry(length, height, depth), MAT.redStone);
    block.position.set(0, height / 2, 0);
    g.add(block);

    // Sloping top edge (a thin wedge sitting on the +X end) — abstracted as
    // a slightly taller block on one end suggesting the curved cap
    const cap = new THREE.Mesh(new THREE.BoxGeometry(length * 0.25, 2.0, depth + 0.1), MAT.redStone);
    cap.position.set(length * 0.375, height + 1.0, 0);
    g.add(cap);

    // Horizontal cream sandstone bands (3 across the height)
    for (let i = 1; i <= 3; i++) {
      const y = height * i / 4;
      const band = new THREE.Mesh(new THREE.BoxGeometry(length + 0.08, 0.25, depth + 0.08), MAT.portalWhite);
      band.position.set(0, y, 0);
      g.add(band);
    }

    // Cornice
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(length + 0.3, 0.4, depth + 0.3), MAT.redStoneDark);
    cornice.position.set(0, height + 0.2, 0);
    g.add(cornice);

    // White portal frame at one end (acts as the building's main entrance)
    if (portal) {
      const PORT_H = height + 2;
      const portW  = 6;
      [-portW / 2, portW / 2].forEach((px) => {
        const col = new THREE.Mesh(new THREE.BoxGeometry(1.4, PORT_H, 1.4), MAT.portalWhite);
        col.position.set(-length / 2 + 3 + px + portW / 2, PORT_H / 2, depth / 2 + 0.5);
        g.add(col);
      });
      const top = new THREE.Mesh(new THREE.BoxGeometry(portW + 1.4, 1.4, 1.4), MAT.portalWhite);
      top.position.set(-length / 2 + 3 + portW / 2, PORT_H - 0.7, depth / 2 + 0.5);
      g.add(top);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(portW + 1.4, 1.0, 0.8), MAT.portalWhite);
      beam.position.set(-length / 2 + 3 + portW / 2, height * 0.55, depth / 2 + 1.2);
      g.add(beam);
    }

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // IITJ FOUNTAIN — circular sandstone basin + bronze sculpture
  // ─────────────────────────────────────────────────────────────────────
  function buildFountain() {
    const g = new THREE.Group();
    // Outer stone apron (tiled paving look)
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 0.15, 48), MAT.sandTop);
    apron.position.y = 0.075;
    g.add(apron);
    // Apron edge ring (darker)
    const apronEdge = new THREE.Mesh(new THREE.TorusGeometry(8 - 0.05, 0.12, 8, 48), MAT.brick);
    apronEdge.position.y = 0.15;
    apronEdge.rotation.x = Math.PI / 2;
    g.add(apronEdge);

    // Stone basin rim
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.3, 0.9, 48), MAT.sandstone);
    basin.position.y = 0.45 + 0.15;
    g.add(basin);
    // Basin top torus (carved coping)
    const basinTop = new THREE.Mesh(new THREE.TorusGeometry(5, 0.25, 10, 48), MAT.sandDark);
    basinTop.position.y = 0.95;
    basinTop.rotation.x = Math.PI / 2;
    g.add(basinTop);

    // Water surface
    const water = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.05, 48), MAT.water);
    water.position.y = 0.85;
    g.add(water);

    // Central sculpture — three angular blades meeting at a hub
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.6, 12), MAT.bronzeSculp);
    hub.position.y = 1.6;
    g.add(hub);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 0.15), MAT.bronzeSculp);
      blade.position.set(Math.cos(a) * 1.4, 2.0 + i * 0.3, Math.sin(a) * 1.4);
      blade.rotation.y = a + Math.PI / 2;
      blade.rotation.z = -0.45;
      g.add(blade);
    }
    // Tall central spire
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.25, 2.5, 8), MAT.bronzeSculp);
    spire.position.y = 3.6;
    g.add(spire);

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // PRITHVI MISSILE — upright missile on a low pedestal with garden walls
  // ─────────────────────────────────────────────────────────────────────
  function buildPrithviMissile() {
    const g = new THREE.Group();

    // Low circular boundary wall (the stone wall visible in photo)
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 0.7, 32, 1, true), MAT.missileBase);
    wall.position.y = 0.35;
    g.add(wall);

    // Pedestal — small raised circular plinth
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.8, 16), MAT.missileBase);
    plinth.position.y = 0.4;
    g.add(plinth);

    // Missile body — cylinder
    const BODY_H = 6.5;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, BODY_H, 16), MAT.missileWhite);
    body.position.y = 0.8 + BODY_H / 2;
    g.add(body);
    // Orange stripe near the top
    const stripeTop = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.45, 16), MAT.missileOrange);
    stripeTop.position.y = 0.8 + BODY_H - 1.2;
    g.add(stripeTop);
    // Orange stripe near the base
    const stripeBot = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.45, 16), MAT.missileOrange);
    stripeBot.position.y = 0.8 + 0.8;
    g.add(stripeBot);
    // Nose cone
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 16), MAT.missileWhite);
    nose.position.y = 0.8 + BODY_H + 0.8;
    g.add(nose);
    // Four fins at the base
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.9), MAT.missileWhite);
      fin.position.set(Math.cos(a) * 0.7, 0.8 + 0.6, Math.sin(a) * 0.7);
      fin.rotation.y = a;
      g.add(fin);
    }

    return g;
  }

  // ── Procedural builder: Brain Tree tiered platform + stairs ───────────
  // Concentric ring tiers (green → white → saffron → tan) mirroring the
  // Indian-tricolor garden the sculpture stands on, with one staircase
  // wedge cutting from the outer ground up to the central pedestal.
  // The sculpture itself sits on top via its own landmark + yOffsetMeters.
  function buildBrainTreeBase() {
    const g = new THREE.Group();
    // Outer → inner. Each tier is one full circular step that can be
    // climbed from ANY direction — the structure itself is the staircase,
    // radially symmetric like an amphitheatre. Outer radius is kept under
    // the inner road edge (~35 m from centre per OSM) so the platform
    // doesn't spill onto the surrounding roundabout asphalt.
    const tiers = [
      { r: 32, h: 0.20, m: MAT.grass   },   // grass apron, stops short of road
      { r: 26, h: 0.45, m: MAT.pebble  },   // white pebble ring
      { r: 20, h: 0.55, m: MAT.saffron },   // saffron ring
      { r: 14, h: 0.65, m: MAT.sandTop },   // tan inner platform
    ];

    let topY = 0;
    tiers.forEach((t) => {
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(t.r, t.r, t.h, 96),
        t.m,
      );
      cyl.position.y = topY + t.h / 2;
      g.add(cyl);
      // Brick edge ring around the rim of every tier (matches the photo)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(t.r - 0.05, 0.16, 8, 96),
        MAT.brick,
      );
      ring.position.y = topY + t.h;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      topY += t.h;
    });

    // Central pedestal that lifts the sculpture above the tan tier
    const PED_R = 4.0;
    const PED_H = 0.8;
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(PED_R, PED_R + 0.5, PED_H, 48),
      MAT.brick,
    );
    pedestal.position.y = topY + PED_H / 2;
    g.add(pedestal);

    return g;
  }

  // ── Procedural builder: SR Ranganathan Learning Hub + Clock Tower ──────
  // All units are metres. The group's local Y is up; the parent layer will
  // rotate Y→Z to align with MapLibre's coordinate system.
  function buildLibraryComplex() {
    const g = new THREE.Group();

    // Polygon analysis (from OSM, in metres relative to polygon centroid;
    // X = east, Y_polygon = north). Two main rectangular blocks plus a
    // small clock tower on the west side at the junction:
    //
    //   NORTH HALL  : x[-22,13]  y[7,18]    → 35 × 11 m wide block
    //   SOUTH WING  : x[-7,13]   y[-29,0]   → 20 × 29 m long block
    //   CLOCK TOWER : x[-22,-9]  y[-1,6]    → small footprint, tall tower
    //
    // Mesh convention (after MapLibre transform with bearingOffset=0):
    //   mesh +X = world east,  mesh −Z = world north,  mesh +Z = world south
    // so we negate polygon-Y when assigning mesh Z.
    const H = 18;                              // building height

    // North hall — wide rectangle at the top of the polygon
    const HALL_W = 34, HALL_D = 10;            // ≤ 35×11 polygon block
    const HALL_CX = -4.5,  HALL_CN = 12.5;     // polygon X, polygon Y (north)
    const hall = new THREE.Mesh(new THREE.BoxGeometry(HALL_W, H, HALL_D), MAT.sandstone);
    hall.position.set(HALL_CX, H / 2, -HALL_CN);
    g.add(hall);
    // Hall cornice + parapet
    const hallCornice = new THREE.Mesh(new THREE.BoxGeometry(HALL_W + 0.8, 1.0, HALL_D + 0.8), MAT.sandDark);
    hallCornice.position.set(HALL_CX, H + 0.5, -HALL_CN);
    g.add(hallCornice);

    // South wing — narrower rectangle running south. Extend its north edge
    // up INTO the hall so the two blocks merge into one continuous mass
    // (no visible seam between hall and wing). Hall south edge is at
    // polygon-Y ≈ 7.5; wing's new north edge reaches Y ≈ 9, overlapping
    // by ~1.5 m so the geometry welds together.
    const WING_W = 19;
    const WING_D = 38;                        // was 27, +11 m northward
    const WING_CX = 3;
    const WING_CN = -10;                      // was -14.5, shifted north
    const wing = new THREE.Mesh(new THREE.BoxGeometry(WING_W, H, WING_D), MAT.sandstone);
    wing.position.set(WING_CX, H / 2, -WING_CN);
    g.add(wing);
    const wingCornice = new THREE.Mesh(new THREE.BoxGeometry(WING_W + 0.8, 1.0, WING_D + 0.8), MAT.sandDark);
    wingCornice.position.set(WING_CX, H + 0.5, -WING_CN);
    g.add(wingCornice);

    // ── Colonnade along the south face of the south wing ──────────
    // South face of wing is at polygon Y = WING_CN - WING_D/2 = -28,
    // which in mesh coords is +Z = 28.
    const SOUTH_FACE_Z   = -(WING_CN - WING_D / 2);    // = 28
    const COL_OFFSET     = SOUTH_FACE_Z + 2.5;
    const COL_H          = H + 1.4;
    const COL_R          = 0.55;
    const COL_COUNT      = 8;
    const colSpan        = WING_W - 2;
    const colStep        = colSpan / (COL_COUNT - 1);
    for (let i = 0; i < COL_COUNT; i++) {
      const x = WING_CX - colSpan / 2 + i * colStep;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(COL_R, COL_R, COL_H, 14), MAT.column);
      col.position.set(x, COL_H / 2, COL_OFFSET);
      g.add(col);
    }
    const entablature = new THREE.Mesh(new THREE.BoxGeometry(colSpan + 2 * COL_R, 1.8, 1.6), MAT.column);
    entablature.position.set(WING_CX, COL_H + 0.9, COL_OFFSET);
    g.add(entablature);

    // Recessed dark entrance on south face, centred under colonnade
    const entrance = new THREE.Mesh(new THREE.BoxGeometry(5, 6.5, 0.6), MAT.entrance);
    entrance.position.set(WING_CX, 3.25, SOUTH_FACE_Z + 0.3);
    g.add(entrance);

    // ── Clock tower on the WEST side at the polygon junction ──────
    // Polygon position (-15, 5) — sits where the hall meets the wing on
    // the western edge. Mesh coords: x = -15, z = -5.
    const TOWER_X = -15;
    const TOWER_Z = -5;
    const tiers = [
      { w:  9, d: 8, h: 16 },                  // base sits on the ground
      { w:  8, d: 7, h: 6  },
      { w:  7, d: 6, h: 5  },                  // clock tier
      { w:  5.5, d: 4.5, h: 4 },
      { w:  4, d: 3.5, h: 3 },
      { w:  2.5, d: 2.5, h: 2 },
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
  // Height of the tiered base that the Brain Tree sits on top of.
  // Sum of all tier thicknesses + pedestal in buildBrainTreeBase().
  const BRAIN_TREE_BASE_TOP_Y = 0.20 + 0.45 + 0.55 + 0.65 + 0.8;  // 2.65 m

  const LANDMARKS = [
    {
      id: 'brain-tree-base-3d',
      format: 'procedural',
      build: buildBrainTreeBase,
      // Geometric centre of the roundabout (mean of the surrounding road
      // waypoints from OSM), not the OSM 'Brain Tree' artwork node which
      // sits ~9 m off-centre.
      lng: 73.1141633, lat: 26.4692796,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
    },
    {
      id: 'brain-tree-3d',
      format: 'obj',
      file: 'assets/models/brain-tree.obj',
      lng: 73.1141633, lat: 26.4692796,
      heightMeters: 14,
      yOffsetMeters: BRAIN_TREE_BASE_TOP_Y,   // lift so it rests on the pedestal
      material: MAT.gold,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
    },
    {
      id: 'library-3d',
      format: 'procedural',
      build: buildLibraryComplex,
      // True OSM polygon centroid (26.4715806, 73.1134681) shifted ~3 m
      // west so the wing's east edge clears the road on that side.
      lng: 73.1134379, lat: 26.4715806,
      heightMeters: null,                       // builder is already in metres
      rotateMeshToUp: Y_UP_TO_Z_UP,
      // Mesh is built in polygon-local coords with +X = east and −Z = north
      // (i.e. polygon-Y negated when placed into mesh Z). With bearingOffset
      // = 0 the world axes line up directly, no extra rotation needed.
      bearingOffset: 0,
      replacesOsmBuildings: ['773563507'],
    },

    // ── O-lane / Y-lane hostels (same architectural design × 4 footprints)
    // Bearings come from each polygon's longest edge; bearingOffset is the
    // angular delta from compass-east in radians (negative = rotate CW).
    {
      id: 'hostel-O3-3d',
      format: 'procedural',
      build: () => buildOLaneHostel({ length: 68, bboxDepth: 42, wingCount: 5 }),
      lng: 73.1172853, lat: 26.4754698,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -6 * Math.PI / 180,        // longest edge bearing 276°/96°
      replacesOsmBuildings: ['1412504063'],
    },
    {
      id: 'hostel-O4-3d',
      format: 'procedural',
      build: () => buildOLaneHostel({ length: 68, bboxDepth: 48, wingCount: 5 }),
      lng: 73.1170278, lat: 26.4749548,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -9 * Math.PI / 180,        // longest edge bearing 279°/99°
      replacesOsmBuildings: ['1412504062'],
    },
    {
      id: 'hostel-Y3-3d',
      format: 'procedural',
      build: () => buildOLaneHostel({ length: 68, bboxDepth: 42, wingCount: 5 }),
      lng: 73.1171422, lat: 26.4744791,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -6 * Math.PI / 180,
      replacesOsmBuildings: ['1412504061'],
    },
    {
      id: 'hostel-Y4-3d',
      format: 'procedural',
      build: () => buildOLaneHostel({ length: 68, bboxDepth: 42, wingCount: 5 }),
      lng: 73.1168888, lat: 26.4740272,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -6 * Math.PI / 180,
      replacesOsmBuildings: ['1412504060'],
    },

    // Computer Centre — square footprint, longest edge bearing 4° (N-S)
    {
      id: 'computer-centre-3d',
      format: 'procedural',
      build: buildComputerCentre,
      lng: 73.1140009, lat: 26.4715934,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      // Footprint long axis runs N-S, mesh long axis (X) is E-W → rotate 86°
      bearingOffset: 86 * Math.PI / 180,
      replacesOsmBuildings: ['773690911'],
    },

    // Chanakya Complex — two wings (Office of Administration + Office of Students)
    {
      id: 'chanakya-admin-3d',
      format: 'procedural',
      build: () => buildChanakyaWing({ length: 40, depth: 16, height: 13, portal: true }),
      lng: 73.1131579, lat: 26.4711373,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,                          // longest edge bearing 90° (E-W)
      replacesOsmBuildings: ['773563509'],
    },
    {
      id: 'chanakya-students-3d',
      format: 'procedural',
      build: () => buildChanakyaWing({ length: 34, depth: 15, height: 13, portal: false }),
      lng: 73.1140003, lat: 26.4711330,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
      replacesOsmBuildings: ['773563508'],
    },

    // Point-feature landmarks — Fountain and Prithvi Missile
    {
      id: 'fountain-3d',
      format: 'procedural',
      build: buildFountain,
      lng: 73.1136467, lat: 26.4704637,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
    },
    {
      id: 'prithvi-missile-3d',
      format: 'procedural',
      build: buildPrithviMissile,
      lng: 73.1147901, lat: 26.4669087,
      heightMeters: null,
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
          // Auto-fit to heightMeters first (procedural builds pass null to
          // keep their native metre scale).
          const bbox = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();   bbox.getSize(size);
          const center = new THREE.Vector3(); bbox.getCenter(center);
          const s = (cfg.heightMeters && size.y > 0) ? cfg.heightMeters / size.y : 1;
          if (s !== 1) root.scale.set(s, s, s);
          // Position is in WORLD units, so scale the (model-space) bbox
          // offsets by `s` before applying them — otherwise scaling the
          // mesh up sinks its base below y=0.
          root.position.set(-center.x * s, -bbox.min.y * s, -center.z * s);
          // Optional lift for stacking landmarks (e.g. Brain Tree on its
          // tiered base).
          if (cfg.yOffsetMeters) root.position.y += cfg.yOffsetMeters;
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
        // Y-up → Z-up correction (must come BEFORE bearing rotation in the
        // multiply chain, so it's applied FIRST to vertices and bearing
        // then rotates around the world's vertical axis instead of around
        // a horizontal axis in mesh-local space).
        const rotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), cfg.rotateMeshToUp);
        const rotZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), cfg.bearingOffset);
        const m = new THREE.Matrix4().fromArray(matrix);
        const l = new THREE.Matrix4()
          .makeTranslation(mc.x, mc.y, mc.z)
          .scale(new THREE.Vector3(metersToMerc, -metersToMerc, metersToMerc))
          .multiply(rotZ)   // applied SECOND to vertex (rotate around world Z = vertical)
          .multiply(rotX);  // applied FIRST  to vertex (Y-up → Z-up)
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
