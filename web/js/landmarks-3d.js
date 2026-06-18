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
var Landmarks3D = (() => {
  // Three.js Y-up → MapLibre Z-up (mesh-derived models all use Y-up)
  const Y_UP_TO_Z_UP = Math.PI / 2;

  // THREE-dependent objects (materials + reusable matrices) are built lazily so
  // this module parses even before Three.js is loaded. Three.js is now fetched
  // only when the user first enters 3D, keeping ~600 KB off the 2D-only load
  // path. _initThreeObjects() runs once, from _initSceneShell(), after Three.js
  // is confirmed ready. (Object bodies below sit one indent level shallow to
  // keep this a minimal, low-risk diff.)
  let MAT = null, BMAT = null;
  let _rotX = null, _projM = null, _localM = null, _scaleVec = null;
  let _threeObjectsReady = false;
  function _initThreeObjects() {
    if (_threeObjectsReady) return;
    _threeObjectsReady = true;
    MAT = {
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

    // G-block hostels (G1/G4) — rough-cut Jodhpur sandstone block masonry.
    // Warmer, lighter tan than the O-lane cream; string courses are a
    // shade darker, parapets/sunlit faces a shade lighter. Windows are
    // wooden louvered shutters (gLouver) inside a cream reveal (gFrame).
    gStone:     new THREE.MeshStandardMaterial({ color: 0xc2a878, metalness: 0.03, roughness: 0.90 }),
    gStoneDark: new THREE.MeshStandardMaterial({ color: 0xa1855a, metalness: 0.03, roughness: 0.92 }),
    gStoneLite: new THREE.MeshStandardMaterial({ color: 0xd6c096, metalness: 0.03, roughness: 0.82 }),
    gLouver:    new THREE.MeshStandardMaterial({ color: 0x8a7551, metalness: 0.06, roughness: 0.78 }),
    gFrame:     new THREE.MeshStandardMaterial({ color: 0xe7dcc4, metalness: 0.04, roughness: 0.68 }),
    gRoof:      new THREE.MeshStandardMaterial({ color: 0xe8e3d6, metalness: 0.03, roughness: 0.90 }),
    gCourt:     new THREE.MeshStandardMaterial({ color: 0x55634a, metalness: 0.02, roughness: 0.95 }),
    gTank:      new THREE.MeshStandardMaterial({ color: 0xdcdcd2, metalness: 0.10, roughness: 0.60 }),
    gTankGrn:   new THREE.MeshStandardMaterial({ color: 0x7d9a57, metalness: 0.10, roughness: 0.60 }),

    // General Quarters — salmon / dusty-pink cement plaster (NOT sandstone),
    // G+4 apartment blocks with cane-railed balconies and white flat roofs.
    gqWall:    new THREE.MeshStandardMaterial({ color: 0xd6a591, metalness: 0.02, roughness: 0.92 }),
    gqWallD:   new THREE.MeshStandardMaterial({ color: 0xc08e7a, metalness: 0.02, roughness: 0.93 }),
    gqBalcony: new THREE.MeshStandardMaterial({ color: 0xbf8a52, metalness: 0.05, roughness: 0.80 }), // cane / wood railing
    gqTank:    new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.10, roughness: 0.55 }), // dark Sintex tanks in refs

    // Dept. Maths / SOLA — single-storey red rough-cut sandstone-block halls
    // with a central courtyard and a light-grey hipped CORRUGATED-METAL roof.
    mathWall:    new THREE.MeshStandardMaterial({ color: 0x9c6648, metalness: 0.02, roughness: 0.94 }), // red sandstone block
    mathPlinth:  new THREE.MeshStandardMaterial({ color: 0xc98f78, metalness: 0.02, roughness: 0.90 }), // salmon plinth band
    // Light silvery-grey corrugated metal. Low metalness + a touch of emissive
    // keeps it reading bright under the map's directional light (pure metal
    // needs reflections we don't have), matching the pale roofs in the photos.
    metalRoof:   new THREE.MeshStandardMaterial({ color: 0xd7dbde, emissive: 0x3f4346, metalness: 0.12, roughness: 0.7, side: THREE.DoubleSide }),
    metalRidge:  new THREE.MeshStandardMaterial({ color: 0xcacfd2, emissive: 0x3a3e41, metalness: 0.15, roughness: 0.65 }),

    // Mess / dining blocks (Old + New Mess) — reddish Jodhpur sandstone-brick
    // solid block with perforated jali window bays and an equipment-covered
    // white roof (AHUs, ducts, water tanks, solar water heaters).
    messBrick:  new THREE.MeshStandardMaterial({ color: 0xa9785a, metalness: 0.03, roughness: 0.90 }),
    messBrickD: new THREE.MeshStandardMaterial({ color: 0x855a3f, metalness: 0.03, roughness: 0.92 }),
    messPil:    new THREE.MeshStandardMaterial({ color: 0xc09972, metalness: 0.03, roughness: 0.85 }),
    messJali:   new THREE.MeshStandardMaterial({ color: 0x5f4632, metalness: 0.05, roughness: 0.82 }),
    messRoof:   new THREE.MeshStandardMaterial({ color: 0xe6e2d6, metalness: 0.03, roughness: 0.90 }),
    ahuTeal:    new THREE.MeshStandardMaterial({ color: 0x4f93a0, metalness: 0.30, roughness: 0.45 }),
    ahuBlue:    new THREE.MeshStandardMaterial({ color: 0x3f6f9c, metalness: 0.30, roughness: 0.45 }),
    duct:       new THREE.MeshStandardMaterial({ color: 0xbdbdb4, metalness: 0.45, roughness: 0.40 }),
    solarPanel: new THREE.MeshStandardMaterial({ color: 0xd9d9cf, metalness: 0.20, roughness: 0.45 }),
    tankYellow: new THREE.MeshStandardMaterial({ color: 0xcfc24a, metalness: 0.10, roughness: 0.55 }),

    // Aakash Sports Complex — salmon-pink plaster + reddish brick banding,
    // white roof, dark-blue steel eave fascia + angled brackets.
    akPink:   new THREE.MeshStandardMaterial({ color: 0xd49a86, metalness: 0.03, roughness: 0.88 }),
    akPinkD:  new THREE.MeshStandardMaterial({ color: 0xc1836f, metalness: 0.03, roughness: 0.90 }),
    akBrick:  new THREE.MeshStandardMaterial({ color: 0x9c5a44, metalness: 0.04, roughness: 0.90 }),
    akBlue:   new THREE.MeshStandardMaterial({ color: 0x2c4a6e, metalness: 0.35, roughness: 0.5 }),
    akRoof:   new THREE.MeshStandardMaterial({ color: 0xeae6da, metalness: 0.03, roughness: 0.85 }),

    // All campus stone buildings use the library sandstone palette so the
    // whole campus reads as one architectural family (per user request)
    redStone:      new THREE.MeshStandardMaterial({ color: 0xb89a78, metalness: 0.05, roughness: 0.85 }),
    redStoneDark:  new THREE.MeshStandardMaterial({ color: 0x8d6e4f, metalness: 0.05, roughness: 0.9 }),
    portalWhite:   new THREE.MeshStandardMaterial({ color: 0xefe9dc, metalness: 0.05, roughness: 0.65 }),

    // Department building palette — same sandstone as the library (warm
    // beige), cream-white concrete portico (matches Chanakya), light teal
    // curtain-wall glazing, slim recessed jali panels.
    deptStone:     new THREE.MeshStandardMaterial({ color: 0xc7a979, metalness: 0.04, roughness: 0.88 }),
    deptStoneDark: new THREE.MeshStandardMaterial({ color: 0x9d8055, metalness: 0.04, roughness: 0.90 }),
    deptStoneLight:new THREE.MeshStandardMaterial({ color: 0xd9bf95, metalness: 0.04, roughness: 0.80 }),
    deptConcrete:  new THREE.MeshStandardMaterial({ color: 0xefe9dc, metalness: 0.04, roughness: 0.62 }),
    deptGlass:     new THREE.MeshStandardMaterial({ color: 0x9ab9c4, metalness: 0.45, roughness: 0.30 }),
    deptWinFrame:  new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.30, roughness: 0.55 }),
    deptDoor:      new THREE.MeshStandardMaterial({ color: 0x6a8090, metalness: 0.40, roughness: 0.35 }),
    deptSolar:     new THREE.MeshStandardMaterial({ color: 0x394a5e, metalness: 0.45, roughness: 0.40 }),

    // School of Management & Entrepreneurship (SME) + MBA blocks — warm
    // cream-plaster prefab academic blocks with WHITE corrugated-metal gable
    // roofs, white-framed windows with sunshade chajjas, wall-mounted split-AC
    // outdoor units, and yellow/black painted kerb stones around the base.
    mgmtWall:  new THREE.MeshStandardMaterial({ color: 0xe7c79c, metalness: 0.03, roughness: 0.90 }),
    mgmtWallD: new THREE.MeshStandardMaterial({ color: 0xc9a572, metalness: 0.03, roughness: 0.92 }),
    mgmtAC:    new THREE.MeshStandardMaterial({ color: 0xdcd7cb, metalness: 0.15, roughness: 0.60 }),
    mgmtACd:   new THREE.MeshStandardMaterial({ color: 0xb4afa3, metalness: 0.20, roughness: 0.55 }),
    mgmtKerbY: new THREE.MeshStandardMaterial({ color: 0xe3b93a, metalness: 0.04, roughness: 0.80 }),
    mgmtKerbK: new THREE.MeshStandardMaterial({ color: 0x33312c, metalness: 0.06, roughness: 0.78 }),
    mgmtRail:  new THREE.MeshStandardMaterial({ color: 0xbfc4c8, metalness: 0.45, roughness: 0.45 }),

    // Low-poly vegetation — two foliage greens for subtle variation, one
    // trunk, and two earthy tones for the landscaped berm mounds. All flat
    // (no maps) so a single instanced draw call stays cheap.
    // White base so per-instance tint (setColorAt) shows through directly.
    canopy:        new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.95, flatShading: true }),
    treeTrunk:     new THREE.MeshStandardMaterial({ color: 0x6b4a2f, metalness: 0.0, roughness: 1.0 }),

    // Fountain — polished chrome sculpture + sandstone basin
    chromeSculp:   new THREE.MeshStandardMaterial({ color: 0xd6d6dc, metalness: 0.75, roughness: 0.18 }),
    water:         new THREE.MeshStandardMaterial({ color: 0x3e6b8a, metalness: 0.3, roughness: 0.25 }),

    // Missile — white body, orange stripes, dark base
    missileWhite:  new THREE.MeshStandardMaterial({ color: 0xf3f1ec, metalness: 0.20, roughness: 0.45 }),
    missileOrange: new THREE.MeshStandardMaterial({ color: 0xff7a2e, metalness: 0.15, roughness: 0.50 }),
    missileBase:   new THREE.MeshStandardMaterial({ color: 0x5a4632, metalness: 0.10, roughness: 0.80 }),

    // T-72 Tank — near-black hull, sand/tan turret, dark brown dome, teal barrel, red muzzle cap
    tankOlive:  new THREE.MeshStandardMaterial({ color: 0x1a2a10, metalness: 0.10, roughness: 0.85 }),
    tankSand:   new THREE.MeshStandardMaterial({ color: 0xb59660, metalness: 0.08, roughness: 0.82 }),
    tankRed:    new THREE.MeshStandardMaterial({ color: 0x6b3020, metalness: 0.10, roughness: 0.78 }),
    tankBarrel: new THREE.MeshStandardMaterial({ color: 0x2a5030, metalness: 0.20, roughness: 0.65 }),
    tankMuzzle: new THREE.MeshStandardMaterial({ color: 0xcc1010, metalness: 0.20, roughness: 0.60 }),
    tankWheel:  new THREE.MeshStandardMaterial({ color: 0xf0c000, metalness: 0.22, roughness: 0.52 }),
    tankHub:    new THREE.MeshStandardMaterial({ color: 0xcc2020, metalness: 0.20, roughness: 0.65 }),
    tankTrack:  new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.15, roughness: 0.92 }),
    tankPed:    new THREE.MeshStandardMaterial({ color: 0xc8c0b0, metalness: 0.04, roughness: 0.90 }),
  };

  // Perimeter berm materials — separate from MAT so they aren't traversed
  // during material-override passes on landmark groups.
  BMAT = {
    // Wave berm exterior: muted blue representing the mural palette
    // (dominant colour of the blue/white wave murals on the perimeter berm)
    waveExt: new THREE.MeshStandardMaterial({ color: 0x6fa9c6, metalness: 0.03, roughness: 0.9, side: THREE.DoubleSide }),
    // Wave berm campus face: warm Jodhpur sandstone — matches campus buildings
    waveInt: new THREE.MeshStandardMaterial({ color: 0xc2a878, metalness: 0.03, roughness: 0.92, side: THREE.DoubleSide }),
    // Recessed blind-arch panels on the sandstone campus facade (shadowed)
    waveArch: new THREE.MeshStandardMaterial({ color: 0x9c8159, metalness: 0.03, roughness: 0.94, side: THREE.DoubleSide }),
    // Top cap: lighter sandstone coping
    waveTop: new THREE.MeshStandardMaterial({ color: 0xd4bda0, metalness: 0.03, roughness: 0.86, side: THREE.DoubleSide }),
    // Structural ribs / pilasters — slim near-white verticals
    waveRib: new THREE.MeshStandardMaterial({ color: 0xe7dcc4, metalness: 0.03, roughness: 0.82, side: THREE.DoubleSide }),

    // ── Administration / landscape retaining berms (Family 1) ──
    // Pink Jodhpur-sandstone retaining wall (outer face)
    bermStone: new THREE.MeshStandardMaterial({ color: 0xc7a079, metalness: 0.03, roughness: 0.92, side: THREE.DoubleSide }),
    bermStoneTop: new THREE.MeshStandardMaterial({ color: 0xd8c2a2, metalness: 0.03, roughness: 0.85, side: THREE.DoubleSide }),
    // Terraced landscaped embankment (campus face) — two planting greens + soil
    bermGreen:  new THREE.MeshStandardMaterial({ color: 0x6f9050, metalness: 0.02, roughness: 0.97, side: THREE.DoubleSide }),
    bermGreen2: new THREE.MeshStandardMaterial({ color: 0x5c7e44, metalness: 0.02, roughness: 0.97, side: THREE.DoubleSide }),
    bermSoil:   new THREE.MeshStandardMaterial({ color: 0xa98a63, metalness: 0.02, roughness: 0.98, side: THREE.DoubleSide }),
  };

    // Reusable frame buffers — allocated once Three.js is present.
    _rotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Y_UP_TO_Z_UP);
    _projM = new THREE.Matrix4();
    _localM = new THREE.Matrix4();
    _scaleVec = new THREE.Vector3();
  }

  // ─────────────────────────────────────────────────────────────────────
  // O-LANE / Y-LANE HOSTEL — closed rectangular ring with central courtyard
  // ─────────────────────────────────────────────────────────────────────
  // Close-up satellite shows each hostel is a CLOSED rectangular block
  // with an internal courtyard (donut shape), not a comb. The previous
  // front-facade design was right; we just need a proper back and sides
  // forming the ring. 4 floors × 3.5 m = 14 m tall.
  //
  //   ┌─────────────────────────┐
  //   │T▓▓▓▓ back wall ▓▓▓▓▓▓▓ T│      T = stair tower (full depth)
  //   │T                       T│      ▓ = walls with pink banding
  //   │T   ▒ courtyard ▒       T│      ▒ = open interior
  //   │T                       T│
  //   │T▓▓▓▓ FRONT FACADE ▓▓▓▓ T│      <-- pilasters, entrance canopy
  //   └─────────────────────────┘
  function buildOLaneHostel(opts = {}) {
    const length     = opts.length     ?? 66;
    const bboxDepth  = opts.bboxDepth  ?? 42;
    const height     = opts.height     ?? 14;
    const frontDepth = opts.frontDepth ?? 10;   // depth of front facade slab
    const backDepth  = opts.backDepth  ?? 8;
    const towerW     = opts.towerW     ?? 5;
    const g = new THREE.Group();

    // Mesh-local Z convention: +Z = south (front), -Z = north (back)
    const frontZ = bboxDepth / 2 - frontDepth / 2;
    const backZ  = -bboxDepth / 2 + backDepth / 2;

    // ── FRONT facade (south wall, the photogenic side with entrance) ──
    const front = new THREE.Mesh(new THREE.BoxGeometry(length, height, frontDepth), MAT.hostelWall);
    front.position.set(0, height / 2, frontZ);
    g.add(front);
    // Pink banding between floors
    for (let i = 1; i <= 3; i++) {
      const y = height * i / 4;
      const band = new THREE.Mesh(new THREE.BoxGeometry(length + 0.10, 0.22, frontDepth + 0.10), MAT.hostelBand);
      band.position.set(0, y, frontZ);
      g.add(band);
    }
    // White vertical pilasters on the south face — 9 bays
    const BAYS = 9;
    const frontFaceZ = frontZ + frontDepth / 2 + 0.05;
    for (let i = 0; i <= BAYS; i++) {
      const x = -length / 2 + length * i / BAYS;
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.45, height, 0.25), MAT.hostelTrim);
      pil.position.set(x, height / 2, frontFaceZ);
      g.add(pil);
    }
    // Front parapet
    const frontPara = new THREE.Mesh(new THREE.BoxGeometry(length + 0.2, 0.5, frontDepth + 0.2), MAT.hostelRoof);
    frontPara.position.set(0, height + 0.25, frontZ);
    g.add(frontPara);
    // Central entrance canopy + posts
    const canopyZ = frontFaceZ + 1.4;
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.4, 2.6), MAT.hostelTrim);
    canopy.position.set(0, 3.6, canopyZ);
    g.add(canopy);
    const canopyPosts = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.4, 0.25), MAT.hostelTrim);
    canopyPosts.position.set(0, 1.7, canopyZ + 0.6);
    g.add(canopyPosts);

    // ── BACK wall (north, simpler — same band rhythm, no pilasters)
    const back = new THREE.Mesh(new THREE.BoxGeometry(length, height, backDepth), MAT.hostelWall);
    back.position.set(0, height / 2, backZ);
    g.add(back);
    for (let i = 1; i <= 3; i++) {
      const y = height * i / 4;
      const band = new THREE.Mesh(new THREE.BoxGeometry(length + 0.10, 0.20, backDepth + 0.10), MAT.hostelBand);
      band.position.set(0, y, backZ);
      g.add(band);
    }
    const backPara = new THREE.Mesh(new THREE.BoxGeometry(length + 0.2, 0.5, backDepth + 0.2), MAT.hostelRoof);
    backPara.position.set(0, height + 0.25, backZ);
    g.add(backPara);

    // ── EAST + WEST side walls connecting front to back, closing the ring
    const sideDepth = bboxDepth - frontDepth - backDepth + 0.4;
    const sideCenterZ = (frontZ - frontDepth / 2 + backZ + backDepth / 2) / 2;
    const sideThickness = 7;
    [-length / 2 + sideThickness / 2 + towerW, length / 2 - sideThickness / 2 - towerW].forEach((sx) => {
      const side = new THREE.Mesh(new THREE.BoxGeometry(sideThickness, height, sideDepth), MAT.hostelWall);
      side.position.set(sx, height / 2, sideCenterZ);
      g.add(side);
      // Pink banding
      for (let i = 1; i <= 3; i++) {
        const y = height * i / 4;
        const band = new THREE.Mesh(new THREE.BoxGeometry(sideThickness + 0.08, 0.20, sideDepth + 0.08), MAT.hostelBand);
        band.position.set(sx, y, sideCenterZ);
        g.add(band);
      }
      const sidePara = new THREE.Mesh(new THREE.BoxGeometry(sideThickness + 0.2, 0.5, sideDepth + 0.2), MAT.hostelRoof);
      sidePara.position.set(sx, height + 0.25, sideCenterZ);
      g.add(sidePara);
    });

    // ── End stair towers — full-depth on both ends, taller, with jali on the south face
    const TOWER_HT = height + 1.3;
    [-(length / 2) + towerW / 2, (length / 2) - towerW / 2].forEach((tx) => {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(towerW, TOWER_HT, bboxDepth), MAT.hostelWall);
      tower.position.set(tx, TOWER_HT / 2, 0);
      g.add(tower);
      // Brick-screen jali lattice on the south face of the tower
      const lat = new THREE.Mesh(new THREE.BoxGeometry(towerW - 0.9, height - 1.5, 0.08), MAT.hostelScreen);
      lat.position.set(tx, height / 2, bboxDepth / 2 + 0.05);
      g.add(lat);
      // Tower parapet
      const tPara = new THREE.Mesh(new THREE.BoxGeometry(towerW + 0.2, 0.55, bboxDepth + 0.2), MAT.hostelRoof);
      tPara.position.set(tx, TOWER_HT + 0.275, 0);
      g.add(tPara);
    });

    // ── Rooftop machine room above the front facade
    const mech = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.5, 3.5), MAT.hostelWall);
    mech.position.set(length * 0.12, height + 1.25, frontZ);
    g.add(mech);

    // ── Interior cross-beam — single wing of rooms spanning the courtyard
    // from front to back, dividing it into two halves (matches satellite).
    const beamInnerZmin = backZ + backDepth / 2;             // courtyard north edge
    const beamInnerZmax = frontZ - frontDepth / 2;           // courtyard south edge
    const beamDepth     = beamInnerZmax - beamInnerZmin;
    const beamWidth     = opts.beamWidth ?? 6;
    const beamCenterZ   = (beamInnerZmin + beamInnerZmax) / 2;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(beamWidth, height, beamDepth), MAT.hostelWall);
    beam.position.set(0, height / 2, beamCenterZ);
    g.add(beam);
    // Pink banding on the cross-beam
    for (let i = 1; i <= 3; i++) {
      const y = height * i / 4;
      const band = new THREE.Mesh(new THREE.BoxGeometry(beamWidth + 0.08, 0.20, beamDepth + 0.08), MAT.hostelBand);
      band.position.set(0, y, beamCenterZ);
      g.add(band);
    }
    // Beam parapet
    const beamPara = new THREE.Mesh(new THREE.BoxGeometry(beamWidth + 0.2, 0.5, beamDepth + 0.2), MAT.hostelRoof);
    beamPara.position.set(0, height + 0.25, beamCenterZ);
    g.add(beamPara);

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // TYPE B QUARTERS  (Faculty Housing × 22) + GUEST HOUSE (VISITOR)
  // ─────────────────────────────────────────────────────────────────────
  // Reference (aerial photos): a dense cluster of identical G+2 staff/
  // faculty-housing blocks with a pinwheel/H-shape footprint. Construction
  // reads as:
  //   • rough-cut Jodhpur sandstone block masonry (warm peach-tan) on the
  //     walls, with slim cream stringcourses at each floor line;
  //   • paired window bays in cream concrete reveals;
  //   • crisp white flat roofs with low parapets, stepped at the wing ends
  //     (the central courtyard portion sits one parapet lower than the
  //     four corner blocks, giving the photogenic tiered silhouette);
  //   • a small projecting stair-tower headhouse on top of two corners;
  //   • a cluster of yellow Sintex water tanks + DTH dishes + AC
  //     condensers scattered on the roof.
  //
  // Mesh-local convention: +X = east (length), +Y = up, +Z = south. Built
  // parametrically (length × depth × floors) so the same function covers
  // all 22 Type B Quarter blocks and the Guest House next door, with
  // each LANDMARKS entry passing its own bbox and bearingOffset.
  function buildTypeBQuarter(opts = {}) {
    const osmId      = opts.osm_id;
    const FLOORS     = opts.floors     ?? 3;
    const floorH     = opts.floorH     ?? 3.4;
    const H          = FLOORS * floorH;
    const tankYellow = opts.tankYellow ?? true;
    const g = new THREE.Group();

    // Materials — default to Jodhpur sandstone; callers (e.g. General
    // Quarters) can override wallMat/tankMat for a different palette.
    const wallMat   = opts.wallMat || MAT.gStone;
    const stringMat = MAT.gStoneDark;
    const trimMat   = MAT.gFrame;
    const roofMat   = MAT.gRoof;
    const louver    = MAT.gLouver;
    const tankMat   = opts.tankMat || (tankYellow ? MAT.tankYellow : MAT.gTank);
    const balconyMat = opts.balconyMat || MAT.gqBalcony;
    const withBalconies = !!opts.balconies;
    const slabMat = MAT.typeBRoof ?? (MAT.typeBRoof =
      new THREE.MeshStandardMaterial({
        color: 0xf6f3ea, emissive: 0x4a4641, metalness: 0.02, roughness: 0.95,
      }));
    const acMat = MAT.typeBAc ?? (MAT.typeBAc =
      new THREE.MeshStandardMaterial({ color: 0xc6c6c2, metalness: 0.4, roughness: 0.55 }));

    // ── Pull the actual OSM polygon and convert to mesh-local meters ─
    // Look-up happens at build time so the actual H/cross footprint is
    // extruded (no stylised rectangle). If the data isn't ready yet we
    // just return an empty group; landmarks-3d.js will retry on next
    // render anyway, but in practice IITJData is loaded long before the
    // 3D layer is shown.
    const buildings = (typeof IITJData !== 'undefined' && IITJData.isReady?.())
      ? IITJData.getBuildings().features : [];
    const feat = buildings.find(f => String(f.properties.osm_id) === String(osmId));
    if (!feat) return g;
    const ring = feat.geometry.coordinates[0];

    // Centroid (used as the lng/lat anchor in the LANDMARKS entry too).
    let cLng = 0, cLat = 0;
    ring.forEach(([lng, lat]) => { cLng += lng; cLat += lat; });
    cLng /= ring.length; cLat /= ring.length;
    const mLng = 111320 * Math.cos(cLat * Math.PI / 180);

    // Local meters relative to centroid: +x = east, +y = north.
    // Drop the closing duplicate so THREE.Shape auto-closes cleanly.
    const polyXY = ring.slice(0, -1).map(([lng, lat]) =>
      [(lng - cLng) * mLng, (lat - cLat) * 111320]);

    // Polygon area (signed) — flip if the ring runs clockwise so Shape
    // gets a CCW outer contour (ExtrudeGeometry assumes CCW).
    let area2 = 0;
    for (let i = 0, n = polyXY.length; i < n; i++) {
      const [x0, y0] = polyXY[i];
      const [x1, y1] = polyXY[(i + 1) % n];
      area2 += x0 * y1 - x1 * y0;
    }
    if (area2 < 0) polyXY.reverse();

    // Helper: oriented bbox via PCA, returns {ax,ay,bx,by, tMin,tMax, wMin,wMax}
    function pca(verts) {
      let sxx = 0, sxy = 0, syy = 0;
      verts.forEach(([x, y]) => { sxx += x * x; sxy += x * y; syy += y * y; });
      const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const ax = Math.cos(theta), ay = Math.sin(theta);
      const bx = -ay, by = ax;
      const T = verts.map(([x, y]) => x * ax + y * ay);
      const W = verts.map(([x, y]) => x * bx + y * by);
      return {
        ax, ay, bx, by, theta,
        tMin: Math.min(...T), tMax: Math.max(...T),
        wMin: Math.min(...W), wMax: Math.max(...W),
      };
    }
    const obb = pca(polyXY);
    const length = obb.tMax - obb.tMin;    // along principal axis
    const depth  = obb.wMax - obb.wMin;    // perpendicular

    // ── A) Extrude the actual polygon for the main body ─────────────
    function shapeFromPoly(scale = 1, ox = 0, oy = 0) {
      const sh = new THREE.Shape();
      const [x0, y0] = polyXY[0];
      sh.moveTo(x0 * scale + ox, y0 * scale + oy);
      for (let i = 1; i < polyXY.length; i++) {
        const [x, y] = polyXY[i];
        sh.lineTo(x * scale + ox, y * scale + oy);
      }
      sh.closePath();
      return sh;
    }
    const bodyShape = shapeFromPoly();
    const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
      depth: H, bevelEnabled: false, steps: 1,
    });
    bodyGeo.rotateX(-Math.PI / 2);
    const body = new THREE.Mesh(bodyGeo, wallMat);
    g.add(body);

    // ── A2) Balconies — projecting slabs + cane-railing bands on the longest
    //        outer facades, at each upper floor. Only the two longest edges
    //        get them (the photogenic fronts); they project OUTWARD along a
    //        straight wall so, unlike bands wrapping the whole outline, they
    //        never read as slanting lines across the roof.
    if (withBalconies) {
      const edges = [];
      for (let i = 0, n = polyXY.length; i < n; i++) {
        const [x0, y0] = polyXY[i];
        const [x1, y1] = polyXY[(i + 1) % n];
        edges.push({ x0, y0, x1, y1, len: Math.hypot(x1 - x0, y1 - y0) });
      }
      edges.sort((a, b) => b.len - a.len);
      const pip = (px, py) => {       // point-in-polygon
        let inside = false;
        for (let i = 0, j = polyXY.length - 1; i < polyXY.length; j = i++) {
          const [xi, yi] = polyXY[i], [xj, yj] = polyXY[j];
          if (((yi > py) !== (yj > py)) &&
              (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
      };
      const balW = 1.2;        // balcony projection depth
      for (const e of edges.slice(0, 2)) {
        const dx = e.x1 - e.x0, dy = e.y1 - e.y0;
        const len = Math.hypot(dx, dy);
        if (len < 6) continue;
        const tx = dx / len, ty = dy / len;
        let nx = ty, ny = -tx;                       // perpendicular
        const mx = (e.x0 + e.x1) / 2, my = (e.y0 + e.y1) / 2;
        if (pip(mx + nx * 0.5, my + ny * 0.5)) { nx = -nx; ny = -ny; }   // outward
        const txW = tx, tzW = -ty, nxW = nx, nzW = -ny;
        const rotY = Math.atan2(-tzW, txW);
        const slabLen = len * 0.82;
        for (let f = 1; f < FLOORS; f++) {           // skip ground floor
          const y = f * floorH;
          const cx = mx + nxW * (balW / 2 + 0.02);
          const cz = -my + nzW * (balW / 2 + 0.02);
          // balcony floor slab
          const slabB = new THREE.Mesh(new THREE.BoxGeometry(slabLen, 0.14, balW), wallMat);
          slabB.position.set(cx, y, cz);
          slabB.rotation.y = rotY;
          g.add(slabB);
          // cane / wood railing band on the outer lip
          const rail = new THREE.Mesh(new THREE.BoxGeometry(slabLen, 0.85, 0.10), balconyMat);
          rail.position.set(mx + nxW * (balW + 0.02), y + 0.5, -my + nzW * (balW + 0.02));
          rail.rotation.y = rotY;
          g.add(rail);
        }
      }
    }

    // Floor-line stringcourses + cream cornice — intentionally omitted.
    // Any thin band sitting proud of the H-shaped wall reads as a slanting
    // dark line from a straight-down map view (and on the inner H-recess
    // edges, as a line crossing the open courtyard). The plain sandstone
    // wall + bright white roof slab give the clean read the user asked for.

    // ── B) White roof slab — the exact body polygon, extruded a little and
    //       lifted 5 cm over the body top face (the lift avoids z-fighting
    //       between the two coplanar surfaces). Using the same shape means
    //       no offset math that could self-intersect on the concave H-corners.
    const slabH = 0.30;
    const slabLift = 0.05;
    const slabGeo = new THREE.ExtrudeGeometry(bodyShape, {
      depth: slabH, bevelEnabled: false, steps: 1,
    });
    slabGeo.rotateX(-Math.PI / 2);
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.y = H + slabLift;
    g.add(slab);

    // ── C) Parapet rim — intentionally omitted. Any thin band sitting proud
    //       of the H-shaped wall reads as a slanting line from a straight-down
    //       map view, which clutters the rooftops. The white slab edge already
    //       gives a clean parapet read, so we leave the rim off.

    // ── D) Window bays — omitted on purpose.
    //
    // Earlier revisions placed louvered window bays around every polygon
    // edge so the facades read at street level, but at the typical map
    // zoom (with a slight oblique pitch) the 3-floor stack on each edge
    // rendered as a long dark stripe — and on the H-shape's *inner*
    // courtyard walls the stripes became long slanting lines crossing the
    // roof. Both effects fight against the clean sandstone-and-white-roof
    // read the user asked for, so we leave the facades plain and rely on
    // the stringcourses + cornice + parapet to carry the elevation detail.
    // (The legacy placement function is kept commented out below in case
    // street-view zooms eventually need it again.)
    /* eslint-disable */
    function _unusedPlaceWindowsOnEdge(x0, y0, x1, y1) {
      // y0/y1 are polygon-Y; world Z = -y. Direction tangent (tx, tz) along
      // edge, outward normal (nx, nz) pointing AWAY from polygon centroid.
      const dx = x1 - x0, dy = y1 - y0;
      const segLen = Math.hypot(dx, dy);
      if (segLen < 5) return;                          // too short for a bay
      const tx = dx / segLen, ty = dy / segLen;
      let nx = ty, ny = -tx;                            // perpendicular
      // Ensure n points outward — sample midpoint, shift along n, check
      // whether resulting point is inside polygon. If inside, flip.
      const mxP = (x0 + x1) / 2, myP = (y0 + y1) / 2;
      function pointInPoly(px, py) {
        let inside = false;
        for (let i = 0, j = polyXY.length - 1; i < polyXY.length; j = i++) {
          const [xi, yi] = polyXY[i], [xj, yj] = polyXY[j];
          if (((yi > py) !== (yj > py)) &&
              (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
      }
      if (pointInPoly(mxP + nx * 0.5, myP + ny * 0.5)) { nx = -nx; ny = -ny; }

      // Translate to mesh coords: world X = polygon X, world Z = -polygon Y.
      const txW = tx,   tzW = -ty;
      const nxW = nx,   nzW = -ny;
      // Edge endpoints in mesh coords
      const ex0 = x0, ez0 = -y0, ex1 = x1, ez1 = -y1;

      const bayPitch = 3.4;                            // ~3.4 m bay spacing
      const winW = 1.5, winH = 1.7;
      const bays = Math.max(1, Math.floor(segLen / bayPitch));
      const margin = (segLen - bays * bayPitch) / 2 + bayPitch / 2;
      for (let b = 0; b < bays; b++) {
        const sAlong = margin + b * bayPitch;
        const px = ex0 + txW * sAlong + nxW * 0.06;
        const pz = ez0 + tzW * sAlong + nzW * 0.06;
        // Rotation around Y so the frame's local X axis (its width, the wall-
        // hugging tangent direction) lines up with the edge tangent. Y-rotation
        // by θ sends (1,0,0) → (cos θ, 0, −sin θ); setting that to (txW,0,tzW)
        // gives θ = atan2(−tzW, txW). The earlier code used atan2(nzW,nxW)
        // which is rotated 90° — that made each frame stand perpendicular to
        // the wall and read as a long dark stripe across the roof.
        const winRotY = Math.atan2(-tzW, txW);
        for (let f = 0; f < FLOORS; f++) {
          const y = f * floorH + floorH * 0.55;
          // Cream reveal frame (a thin slab on the wall face).
          const frame = new THREE.Mesh(
            new THREE.BoxGeometry(winW + 0.20, winH + 0.20, 0.10),
            trimMat,
          );
          frame.position.set(px, y, pz);
          frame.rotation.y = winRotY;
          g.add(frame);
          // Louvered shutter just behind the frame.
          const shutter = new THREE.Mesh(
            new THREE.BoxGeometry(winW, winH, 0.05),
            louver,
          );
          shutter.position.set(px - nxW * 0.04, y, pz - nzW * 0.04);
          shutter.rotation.y = winRotY;
          g.add(shutter);
        }
      }
    }
    // (windows intentionally not placed — see note above)
    /* eslint-enable */

    // ── Rooftop-placement helpers ──────────────────────────────────
    // Rooftop accessories were previously positioned from the oriented
    // bounding box, which on a rotated or non-rectangular footprint let
    // them hang off the roof edge. These helpers keep every accessory
    // fully inside the actual polygon.
    const obbAngle = Math.atan2(obb.ay, obb.ax);   // building rotation (Y axis)
    function pointInPoly(px, py) {
      let inside = false;
      for (let i = 0, j = polyXY.length - 1; i < polyXY.length; j = i++) {
        const [xi, yi] = polyXY[i], [xj, yj] = polyXY[j];
        if (((yi > py) !== (yj > py)) &&
            (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    }
    function distToPolyEdge(px, py) {
      let best = Infinity;
      for (let i = 0, j = polyXY.length - 1; i < polyXY.length; j = i++) {
        const [xi, yi] = polyXY[i], [xj, yj] = polyXY[j];
        const dx = xj - xi, dy = yj - yi;
        const t = Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / (dx * dx + dy * dy || 1)));
        const cx = xi + t * dx, cy = yi + t * dy;
        best = Math.min(best, Math.hypot(px - cx, py - cy));
      }
      return best;
    }
    // Pull a target polygon-coord toward the centroid (origin) until it sits
    // at least `clearance` inside the polygon. Returns mesh coords [x, z].
    function placeInside(px, py, clearance) {
      for (let s = 1; s >= 0; s -= 0.05) {
        const qx = px * s, qy = py * s;
        if (pointInPoly(qx, qy) && distToPolyEdge(qx, qy) >= clearance) {
          return [qx, -qy];                        // polygon-Y → mesh-Z
        }
      }
      return [0, 0];                               // fallback: centroid
    }

    // ── E) Stair-tower headhouses — rotated to the building angle and
    //       clamped so they never overhang the roof edge.
    const towerH = 3.0, towerW = 5.5, towerD = 5.5;
    const towerClear = Math.hypot(towerW, towerD) / 2 + 0.3;
    [+1, -1].forEach(sgn => {
      const tAxis = (obb.tMin + obb.tMax) / 2 + (obb.tMax - obb.tMin) * 0.30 * sgn;
      const wAxis = (obb.wMin + obb.wMax) / 2 + (obb.wMax - obb.wMin) * 0.18 * sgn;
      const px = tAxis * obb.ax + wAxis * obb.bx;
      const py = tAxis * obb.ay + wAxis * obb.by;
      const [mx, mz] = placeInside(px, py, towerClear);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(towerW, towerH, towerD), wallMat);
      tower.position.set(mx, H + slabLift + slabH + towerH / 2 + 0.05, mz);
      tower.rotation.y = obbAngle;
      g.add(tower);
      const tCap = new THREE.Mesh(new THREE.BoxGeometry(towerW + 0.2, 0.35, towerD + 0.2), roofMat);
      tCap.position.set(mx, H + slabLift + slabH + towerH + 0.20, mz);
      tCap.rotation.y = obbAngle;
      g.add(tCap);
    });

    // ── F) Water tanks scattered along the principal axis, clamped inside.
    const tankGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.05, 10);
    const tankYBase = H + slabLift + slabH + 0.6;
    for (let i = 0; i < 6; i++) {
      const tAxis = obb.tMin + (obb.tMax - obb.tMin) * (0.18 + i * 0.13);
      const wSide = (i % 2 === 0) ? 0.32 : -0.32;
      const wAxis = (obb.wMin + obb.wMax) / 2 + (obb.wMax - obb.wMin) * wSide;
      const px = tAxis * obb.ax + wAxis * obb.bx;
      const py = tAxis * obb.ay + wAxis * obb.by;
      const [mx, mz] = placeInside(px, py, 0.8);
      const t = new THREE.Mesh(tankGeo, tankMat);
      t.position.set(mx, tankYBase, mz);
      g.add(t);
    }

    // ── G) AC condenser boxes — near (but inside) the long parapets.
    const acGeo = new THREE.BoxGeometry(0.9, 0.6, 0.7);
    for (let i = 0; i < 6; i++) {
      const tAxis = obb.tMin + (obb.tMax - obb.tMin) * (i + 0.5) / 6;
      for (const wSign of [+1, -1]) {
        const wAxis = (obb.wMin + obb.wMax) / 2 + (obb.wMax - obb.wMin) * 0.40 * wSign;
        const px = tAxis * obb.ax + wAxis * obb.bx;
        const py = tAxis * obb.ay + wAxis * obb.by;
        const [mx, mz] = placeInside(px, py, 0.8);
        const ac = new THREE.Mesh(acGeo, acMat);
        ac.position.set(mx, H + slabLift + slabH + 0.40, mz);
        ac.rotation.y = obbAngle;
        g.add(ac);
      }
    }

    // ── H) Small mechanical-room box near the centre (already interior).
    const mech = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 2.2), wallMat);
    mech.position.set(0, H + slabLift + slabH + 0.7, 0);
    mech.rotation.y = obbAngle;
    g.add(mech);
    const mechCap = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.15, 2.4), roofMat);
    mechCap.position.set(0, H + slabLift + slabH + 1.4, 0);
    mechCap.rotation.y = obbAngle;
    g.add(mechCap);

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // DEPT. MATHS / SOLA — single-storey courtyard halls with hipped metal roof
  // ─────────────────────────────────────────────────────────────────────
  // Reference (drone + front photos): a large (~50 m) single-storey block of
  // rough-cut RED sandstone masonry wrapping a central open courtyard, capped
  // by a low-pitch light-grey CORRUGATED-METAL hipped roof that slopes from
  // the outer eaves up to a ridge and back down into the courtyard. A salmon
  // plinth band runs along the base and a small gabled porch marks the
  // entrance. Built from the real OSM polygon (extruded as a ring) so it
  // aligns exactly; the courtyard + roof are derived by scaling the polygon
  // toward its centroid.
  function buildCourtyardHall(opts = {}) {
    const osmId         = opts.osm_id;
    const wallH         = opts.wallH         ?? 4.8;
    const roofRise      = opts.roofRise      ?? 2.4;
    const courtyardFrac = opts.courtyardFrac ?? 0.36;
    const g = new THREE.Group();

    const wallMat   = MAT.mathWall;
    const plinthMat = MAT.mathPlinth;
    const roofMat   = MAT.metalRoof;
    const ridgeMat  = MAT.metalRidge;

    // ── OSM polygon → local metres, centred on centroid ──────────────
    const buildings = (typeof IITJData !== 'undefined' && IITJData.isReady?.())
      ? IITJData.getBuildings().features : [];
    const feat = buildings.find(f => String(f.properties.osm_id) === String(osmId));
    if (!feat) return g;
    const ring = feat.geometry.coordinates[0];
    let cLng = 0, cLat = 0;
    ring.forEach(([lng, lat]) => { cLng += lng; cLat += lat; });
    cLng /= ring.length; cLat /= ring.length;
    const mLng = 111320 * Math.cos(cLat * Math.PI / 180);
    let poly = ring.slice(0, -1).map(([lng, lat]) => [(lng - cLng) * mLng, (lat - cLat) * 111320]);
    let area2 = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
      area2 += x0 * y1 - x1 * y0;
    }
    if (area2 < 0) poly.reverse();
    const n = poly.length;
    const scaleP = (s) => poly.map(([x, y]) => [x * s, y * s]);   // toward centroid (origin)
    const court = scaleP(courtyardFrac);

    function ringShape(outer, innerHole) {
      const sh = new THREE.Shape();
      outer.forEach(([x, y], i) => i ? sh.lineTo(x, y) : sh.moveTo(x, y));
      sh.closePath();
      const h = new THREE.Path();
      innerHole.forEach(([x, y], i) => i ? h.lineTo(x, y) : h.moveTo(x, y));
      h.closePath();
      sh.holes.push(h);
      return sh;
    }

    // ── Walls: ring (outer polygon with courtyard hole) extruded to wallH
    const wGeo = new THREE.ExtrudeGeometry(ringShape(poly, court), { depth: wallH, bevelEnabled: false, steps: 1 });
    wGeo.rotateX(-Math.PI / 2);
    g.add(new THREE.Mesh(wGeo, wallMat));

    // ── Salmon plinth band — slightly larger ring, low, at the base
    const plGeo = new THREE.ExtrudeGeometry(ringShape(scaleP(1.015), scaleP(courtyardFrac * 0.985)), { depth: 0.9, bevelEnabled: false, steps: 1 });
    plGeo.rotateX(-Math.PI / 2);
    const plinth = new THREE.Mesh(plGeo, plinthMat);
    plinth.position.y = 0.001;
    g.add(plinth);

    // ── Hipped ring roof: outer eave (overhung) → ridge → courtyard eave
    const eaveY = wallH - 0.10;
    const ridgeY = wallH + roofRise;
    const outerEave = scaleP(1.07);
    const innerEave = scaleP(courtyardFrac * 0.93);
    const ridgeLoop = scaleP((1.07 + courtyardFrac) / 2);
    const toMesh = (p, y) => [p[0], y, -p[1]];
    // INDEXED geometry with shared loop vertices so computeVertexNormals
    // averages across the hips — this removes the harsh diagonal crease lines
    // (the "white slanting lines") that per-face flat normals produced, while
    // keeping the hipped form. Vertex layout: [outerEave(n), ridge(n), innerEave(n)].
    const verts = [];
    outerEave.forEach(p => verts.push(...toMesh(p, eaveY)));
    ridgeLoop.forEach(p => verts.push(...toMesh(p, ridgeY)));
    innerEave.forEach(p => verts.push(...toMesh(p, eaveY)));
    const O = i => i, R = i => n + i, I = i => 2 * n + i;
    const idx = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // outer slope (eave → ridge)
      idx.push(O(i), O(j), R(j), O(i), R(j), R(i));
      // inner slope (ridge → courtyard)
      idx.push(R(i), R(j), I(j), R(i), I(j), I(i));
    }
    const roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    roofGeo.setIndex(idx);
    // Force every roof normal to point straight up so the whole roof shades
    // uniformly — this eliminates the hip/rafter shading lines (the "white
    // slanting lines") entirely while the geometry still reads as a hipped
    // form via its silhouette.
    const upN = new Float32Array(verts.length);
    for (let k = 1; k < upN.length; k += 3) upN[k] = 1;
    roofGeo.setAttribute('normal', new THREE.BufferAttribute(upN, 3));
    g.add(new THREE.Mesh(roofGeo, roofMat));

    // Ridge caps along the ridge loop
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = ridgeLoop[i], b = ridgeLoop[j];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.3) continue;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.45), ridgeMat);
      cap.position.set((a[0] + b[0]) / 2, ridgeY + 0.06, -((a[1] + b[1]) / 2));
      cap.rotation.y = Math.atan2(-dy, dx);
      g.add(cap);
    }

    // ── Gabled entrance porch anchored exactly where the access path meets
    //    the building. The campus paths dead-end right at the entrance node
    //    (for both halls the path terminus coincides with footprint vertex
    //    v2 — the centre kink of the south facade), so we anchor the porch at
    //    that nearest path point and face it outward (centroid → anchor).
    const roads = (typeof IITJData !== 'undefined' && IITJData.isReady?.())
      ? IITJData.getRoads().features : [];
    let roadLocal = null, bestRoadD = Infinity;
    for (const r of roads) {
      for (const [lng, lat] of r.geometry.coordinates) {
        const lx = (lng - cLng) * mLng, ly = (lat - cLat) * 111320;
        const d = Math.hypot(lx, ly);
        if (d < bestRoadD) { bestRoadD = d; roadLocal = [lx, ly]; }
      }
    }
    // Anchor = the closest point on the outer wall to that path terminus, so
    // the porch sits flush on the facade even if the node is a metre off.
    const target = roadLocal || [0, -1e6];     // far-south fallback
    let ax = 0, ay = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy || 1;
      let t = ((target[0] - a[0]) * dx + (target[1] - a[1]) * dy) / L2;
      t = Math.max(0, Math.min(1, t));
      const px = a[0] + t * dx, py = a[1] + t * dy;
      const d = Math.hypot(target[0] - px, target[1] - py);
      if (d < bestD) { bestD = d; ax = px; ay = py; }
    }
    {
      // Face outward = direction from centroid (origin) to the anchor.
      const aL = Math.hypot(ax, ay) || 1;
      const nx = ax / aL, ny = ay / aL;        // outward normal
      const tx = -ny, ty = nx;                 // tangent (along facade)
      const pw = 7, proj = 3.4, postH = wallH, apex = wallH + 1.5;
      const txW = tx, tzW = -ty, nxW = nx, nzW = -ny;     // mesh dirs
      const cx = ax, cz = -ay;                            // porch anchor in mesh
      const rotY = Math.atan2(-ty, tx);
      // two posts at the front corners
      [-pw / 2, pw / 2].forEach(s => {
        const px = cx + txW * s + nxW * proj;
        const pz = cz + tzW * s + nzW * proj;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, postH, 0.4), wallMat);
        post.position.set(px, postH / 2, pz);
        g.add(post);
      });
      // gable roof: two sloped quads from the wall (apex ridge) out to the eave
      const wallTop = (s) => [cx + txW * s, eaveY + 0.6, cz + tzW * s];           // ridge anchored at wall, raised
      const front = (s) => [cx + txW * s + nxW * proj, postH, cz + tzW * s + nzW * proj];
      const apexB = (s) => [cx + txW * s + nxW * (proj * 0.5), apex, cz + tzW * s + nzW * (proj * 0.5)];
      const gp = [];
      const q = (A, B, C, D) => { gp.push(...A, ...B, ...C, ...A, ...C, ...D); };
      // ridge runs along the projection at the centre; two slopes to each long side
      q(wallTop(-pw / 2), wallTop(pw / 2), apexB(pw / 2), apexB(-pw / 2));
      q(apexB(-pw / 2), apexB(pw / 2), front(pw / 2), front(-pw / 2));
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
      pGeo.computeVertexNormals();
      const pr = new THREE.Mesh(pGeo, roofMat); pr.material.side = THREE.DoubleSide;
      g.add(pr);
      // triangular gable face (pediment) at the front, in wall colour
      const tri = [...front(-pw / 2), ...front(pw / 2), ...apexB(0)];
      const tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
      tGeo.computeVertexNormals();
      const tg = new THREE.Mesh(tGeo, plinthMat); tg.material.side = THREE.DoubleSide;
      g.add(tg);
    }

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // G-BLOCK HOSTELS (G1 / G4) — closed sandstone courtyard ring
  // ─────────────────────────────────────────────────────────────────────
  // Top-view drone photo: a square ring of 4-storey wings wrapping a
  // central courtyard that holds a sports court, with stair towers
  // projecting above the roofline at the corners and rooftop water tanks.
  // Front-view photo: rough-cut Jodhpur sandstone block masonry, G+2
  // (three floors), paired wooden-louvered windows, recessed horizontal string
  // courses at each floor line, a louvered clerestory band under the
  // parapet, and a recessed entrance reached by a short flight of steps.
  //
  // Mesh-local convention: +X = east (length), +Y = up, +Z = south.
  // Built parametrically so G1 and G4 share the design with their own
  // footprint dimensions; bearingOffset in the LANDMARKS entry rotates
  // the ring to match each polygon's true orientation.
  function buildGHostel(opts = {}) {
    const size   = opts.size   ?? 40;     // outer E-W length
    const depth  = opts.depth  ?? 43;     // outer N-S depth
    const FLOORS = opts.floors ?? 3;      // G+2 = ground + 2 upper floors
    const H      = opts.height ?? 11;     // 3 storeys × ~3.6 m
    const wingD  = 9.5;                    // wing thickness (room depth)
    // Which wing carries the recessed entrance + steps. Mesh +Z = south,
    // so 'south' is the default front; G4's gate faces north.
    const entranceSide = opts.entranceSide ?? 'south';
    const g = new THREE.Group();
    const halfX = size / 2, halfZ = depth / 2;

    // Build ONE wing: sandstone block of `wLen` along local X, depth
    // `wingD` along Z, with all detail on the outward (+Z) face. Placed
    // and rotated into the ring afterwards so the detailing is written
    // once. `withEntrance` carves the central doorway + steps (south wing).
    function makeWing(wLen, withEntrance) {
      const wg = new THREE.Group();
      const outZ = wingD / 2;

      // Main block
      const block = new THREE.Mesh(new THREE.BoxGeometry(wLen, H, wingD), MAT.gStone);
      block.position.y = H / 2;
      wg.add(block);

      // Base plinth (darker, slightly proud)
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(wLen + 0.2, 0.7, wingD + 0.2), MAT.gStoneDark);
      plinth.position.set(0, 0.35, 0);
      wg.add(plinth);

      // Horizontal string courses at each floor line
      for (let i = 1; i < FLOORS; i++) {
        const y = H * i / FLOORS;
        const band = new THREE.Mesh(new THREE.BoxGeometry(wLen + 0.14, 0.32, wingD + 0.14), MAT.gStoneDark);
        band.position.set(0, y, 0);
        wg.add(band);
      }

      // Parapet cap
      const para = new THREE.Mesh(new THREE.BoxGeometry(wLen + 0.28, 0.75, wingD + 0.28), MAT.gStoneLite);
      para.position.set(0, H + 0.375, 0);
      wg.add(para);

      // Louvered clerestory vent band just under the parapet (the slatted
      // strip visible along the top of the facade in the front photo)
      const vent = new THREE.Mesh(new THREE.BoxGeometry(wLen - 1.4, 0.55, 0.14), MAT.gLouver);
      vent.position.set(0, H - 0.5, outZ + 0.04);
      wg.add(vent);

      // Paired louvered windows on the outward face, one pair per bay,
      // per floor. Frame = cream reveal, insert = louver slats.
      const winW = 0.95, winH = 1.65, pairGap = 0.55;
      const bayW = 4.2;
      const usable = wLen - 2.4;
      const nBays = Math.max(2, Math.round(usable / bayW));
      for (let f = 0; f < FLOORS; f++) {
        const cy = H * (f + 0.5) / FLOORS + 0.15;
        for (let b = 0; b < nBays; b++) {
          const bx = -usable / 2 + usable * (b + 0.5) / nBays;
          // Leave the central bay of the ground floor open for the entrance
          if (withEntrance && f === 0 && Math.abs(bx) < bayW * 0.7) continue;
          [-1, 1].forEach((s) => {
            const wx = bx + s * (winW / 2 + pairGap / 2);
            const fr = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.20, winH + 0.20, 0.10), MAT.gFrame);
            fr.position.set(wx, cy, outZ + 0.05);
            wg.add(fr);
            const lv = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, 0.07), MAT.gLouver);
            lv.position.set(wx, cy, outZ + 0.09);
            wg.add(lv);
          });
        }
      }

      // Recessed entrance + steps on the front wing
      if (withEntrance) {
        const pW = 4.2, pH = 4.3;
        // Cream surround framing the portal
        const surround = new THREE.Mesh(new THREE.BoxGeometry(pW + 0.9, pH + 0.7, 0.28), MAT.gFrame);
        surround.position.set(0, (pH + 0.7) / 2, outZ + 0.06);
        wg.add(surround);
        // Dark recessed opening
        const portal = new THREE.Mesh(new THREE.BoxGeometry(pW, pH, 0.5), MAT.entrance);
        portal.position.set(0, pH / 2, outZ + 0.12);
        wg.add(portal);
        // Short flight of entrance steps
        for (let i = 0; i < 3; i++) {
          const stp = new THREE.Mesh(new THREE.BoxGeometry(pW + 1.6 - i * 0.5, 0.2, 0.55), MAT.gStoneLite);
          stp.position.set(0, 0.1 + i * 0.2, outZ + 0.55 + (2 - i) * 0.5);
          wg.add(stp);
        }
      }

      return wg;
    }

    // East/west wings span the gap between the front and back wings so the
    // ring closes cleanly without overlapping corners.
    const sideLen = depth - 2 * wingD + 0.4;

    // South (front, +Z)
    const sWing = makeWing(size, entranceSide === 'south');
    sWing.position.set(0, 0, halfZ - wingD / 2);
    g.add(sWing);
    // North (back, -Z)
    const nWing = makeWing(size, entranceSide === 'north');
    nWing.rotation.y = Math.PI;
    nWing.position.set(0, 0, -(halfZ - wingD / 2));
    g.add(nWing);
    // East (+X) — rotate so local +Z faces +X
    const eWing = makeWing(sideLen, entranceSide === 'east');
    eWing.rotation.y = Math.PI / 2;
    eWing.position.set(halfX - wingD / 2, 0, 0);
    g.add(eWing);
    // West (-X)
    const wWing = makeWing(sideLen, entranceSide === 'west');
    wWing.rotation.y = -Math.PI / 2;
    wWing.position.set(-(halfX - wingD / 2), 0, 0);
    g.add(wWing);

    // ── Optional central N-S cross-wing dividing a wide courtyard into two
    //    (the bigger G/B/I hostels have a central spine in the drone photo).
    if (opts.crossWing) {
      const innerDepth = depth - 2 * wingD;   // courtyard N-S span
      const cwW = 8;                           // cross-wing width (E-W)
      const cwLen = innerDepth + 0.4;
      const cw = new THREE.Mesh(new THREE.BoxGeometry(cwW, H, cwLen), MAT.gStone);
      cw.position.set(0, H / 2, 0);
      g.add(cw);
      const cwPl = new THREE.Mesh(new THREE.BoxGeometry(cwW + 0.2, 0.7, cwLen + 0.2), MAT.gStoneDark);
      cwPl.position.set(0, 0.35, 0);
      g.add(cwPl);
      for (let i = 1; i < FLOORS; i++) {
        const y = H * i / FLOORS;
        const b = new THREE.Mesh(new THREE.BoxGeometry(cwW + 0.14, 0.32, cwLen + 0.14), MAT.gStoneDark);
        b.position.set(0, y, 0);
        g.add(b);
      }
      const cwPa = new THREE.Mesh(new THREE.BoxGeometry(cwW + 0.28, 0.75, cwLen + 0.28), MAT.gStoneLite);
      cwPa.position.set(0, H + 0.375, 0);
      g.add(cwPa);
      // (No windows on the central cross-wing — it reads as a plain spine.)
    }

    // ── Corner stair towers — taller, capped, projecting above the roof
    const TWR   = wingD + 0.6;
    const TWR_H = H + 2.4;
    [[halfX - TWR / 2,  halfZ - TWR / 2], [-(halfX - TWR / 2),  halfZ - TWR / 2],
     [halfX - TWR / 2, -(halfZ - TWR / 2)], [-(halfX - TWR / 2), -(halfZ - TWR / 2)]
    ].forEach(([tx, tz]) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(TWR, TWR_H, TWR), MAT.gStone);
      t.position.set(tx, TWR_H / 2, tz);
      g.add(t);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(TWR + 0.3, 0.6, TWR + 0.3), MAT.gStoneLite);
      cap.position.set(tx, TWR_H + 0.3, tz);
      g.add(cap);
      // Small louver vent high on the tower's outward corner
      const tv = new THREE.Mesh(new THREE.BoxGeometry(TWR - 2.0, 0.6, 0.12), MAT.gLouver);
      tv.position.set(tx, TWR_H - 1.0, tz + TWR / 2 + 0.04);
      g.add(tv);
    });

    // ── Central courtyard floor with a sports court
    const courtX = size - 2 * wingD - 1.0;
    const courtZ = depth - 2 * wingD - 1.0;
    const court = new THREE.Mesh(new THREE.BoxGeometry(courtX, 0.12, courtZ), MAT.gCourt);
    court.position.y = 0.06;
    g.add(court);
    // Two faint white court lines (centre + baseline) to read as a court
    const lineMat = MAT.gRoof;
    const cl1 = new THREE.Mesh(new THREE.BoxGeometry(courtX - 1.5, 0.14, 0.12), lineMat);
    cl1.position.set(0, 0.07, 0);
    g.add(cl1);
    const cl2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, courtZ - 1.5), lineMat);
    cl2.position.set(0, 0.07, 0);
    g.add(cl2);

    // ── Rooftop water tanks on a few wing roofs (white + green, per photo)
    const tankSpots = [
      [ halfX * 0.45,  halfZ - wingD / 2, 0],
      [-halfX * 0.5,  -(halfZ - wingD / 2), 1],
      [ halfX - wingD / 2, -halfZ * 0.25, 0],
      [-(halfX - wingD / 2), halfZ * 0.3, 1],
    ];
    tankSpots.forEach(([tx, tz, grn]) => {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 12), grn ? MAT.gTankGrn : MAT.gTank);
      tank.position.set(tx, H + 0.65, tz);
      g.add(tank);
    });

    // ── A couple of rooftop stair-head boxes (mech rooms) for roof texture
    [[0, halfZ - wingD / 2], [-halfX * 0.3, -(halfZ - wingD / 2)]].forEach(([mx, mz]) => {
      const mech = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.0, 3.0), MAT.gStone);
      mech.position.set(mx, H + 1.0, mz);
      g.add(mech);
      const mcap = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, 3.2), MAT.gStoneLite);
      mcap.position.set(mx, H + 2.15, mz);
      g.add(mcap);
    });

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // MESS / DINING BLOCK (Old Mess + New Mess) — solid sandstone-brick block
  // ─────────────────────────────────────────────────────────────────────
  // Reference photos: a ~38×34 m solid G+2 block (NOT a courtyard) of
  // reddish Jodhpur sandstone-brick, with tall perforated jali window bays
  // framed by pilasters on every face, and a big flat white roof crowded
  // with mechanical plant — AHU/cooler boxes, galvanised ducts, yellow +
  // white water tanks, solar water-heater panels, and a stair-head box.
  //
  // Mesh-local: +X = long axis, +Y = up, +Z = front. bearingOffset aligns
  // the block to each footprint.
  function buildMess(opts = {}) {
    const size   = opts.size   ?? 38;     // long edge
    const depth  = opts.depth  ?? 34;     // short edge
    const H      = opts.height ?? 11;     // G+2 × ~3.6 m
    const FLOORS = 3;
    // Which face carries the entrance: 'front'(+Z), 'back'(-Z),
    // 'right'(+X), 'left'(-X).
    const entranceSide = opts.entranceSide ?? 'front';
    const g = new THREE.Group();

    // ── Main solid block
    const block = new THREE.Mesh(new THREE.BoxGeometry(size, H, depth), MAT.messBrick);
    block.position.y = H / 2;
    g.add(block);

    // Base plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(size + 0.3, 0.8, depth + 0.3), MAT.messBrickD);
    plinth.position.y = 0.4;
    g.add(plinth);

    // Floor string courses
    for (let i = 1; i < FLOORS; i++) {
      const y = H * i / FLOORS;
      const band = new THREE.Mesh(new THREE.BoxGeometry(size + 0.16, 0.34, depth + 0.16), MAT.messBrickD);
      band.position.y = y;
      g.add(band);
    }

    // Parapet
    const para = new THREE.Mesh(new THREE.BoxGeometry(size + 0.35, 0.85, depth + 0.35), MAT.gStoneLite);
    para.position.y = H + 0.425;
    g.add(para);

    // ── Jali window bays on every face. Pilasters split each wall into
    //    bays; each bay holds a tall perforated jali panel framed by a
    //    lighter reveal. `entranceBay` leaves the centre bay of the front
    //    face open at ground level for the entrance.
    function addFace(wallLen, faceCoord, orient, outSign, entrance) {
      const nBays = Math.max(4, Math.round(wallLen / 6));
      const bayW  = wallLen / nBays;
      const panelW = bayW - 1.3;
      const panelH = H - 2.0;
      const panelCY = panelH / 2 + 1.0;
      // Pilasters between bays (full height, slightly proud)
      for (let i = 0; i <= nBays; i++) {
        const t = -wallLen / 2 + i * bayW;
        const pil = orient === 'x'
          ? new THREE.Mesh(new THREE.BoxGeometry(0.6, H, 0.4), MAT.messPil)
          : new THREE.Mesh(new THREE.BoxGeometry(0.4, H, 0.6), MAT.messPil);
        if (orient === 'x') pil.position.set(t, H / 2, faceCoord + outSign * 0.05);
        else                pil.position.set(faceCoord + outSign * 0.05, H / 2, t);
        g.add(pil);
      }
      // Jali panels
      for (let b = 0; b < nBays; b++) {
        const c = -wallLen / 2 + (b + 0.5) * bayW;
        const isCentre = entrance && Math.abs(c) < bayW * 0.6;
        // Reveal frame
        const fr = orient === 'x'
          ? new THREE.Mesh(new THREE.BoxGeometry(panelW + 0.25, panelH + 0.25, 0.12), MAT.messBrickD)
          : new THREE.Mesh(new THREE.BoxGeometry(0.12, panelH + 0.25, panelW + 0.25), MAT.messBrickD);
        // Jali screen (dark perforated)
        const jH = isCentre ? panelH - 3.0 : panelH;   // shorter over the entrance
        const jCY = isCentre ? panelCY + 1.5 : panelCY;
        const jl = orient === 'x'
          ? new THREE.Mesh(new THREE.BoxGeometry(panelW, jH, 0.08), MAT.messJali)
          : new THREE.Mesh(new THREE.BoxGeometry(0.08, jH, panelW), MAT.messJali);
        if (orient === 'x') {
          fr.position.set(c, panelCY, faceCoord + outSign * 0.08);
          jl.position.set(c, jCY, faceCoord + outSign * 0.11);
        } else {
          fr.position.set(faceCoord + outSign * 0.08, panelCY, c);
          jl.position.set(faceCoord + outSign * 0.11, jCY, c);
        }
        g.add(fr); g.add(jl);
      }
      // Entrance portal + canopy on the front face
      if (entrance) {
        const portal = new THREE.Mesh(new THREE.BoxGeometry(orient === 'x' ? 4.0 : 0.5, 3.2, orient === 'x' ? 0.5 : 4.0), MAT.entrance);
        const canopy = new THREE.Mesh(new THREE.BoxGeometry(orient === 'x' ? 5.5 : 1.8, 0.3, orient === 'x' ? 1.8 : 5.5), MAT.gStoneLite);
        if (orient === 'x') {
          portal.position.set(0, 1.6, faceCoord + outSign * 0.2);
          canopy.position.set(0, 3.4, faceCoord + outSign * 1.0);
        } else {
          portal.position.set(faceCoord + outSign * 0.2, 1.6, 0);
          canopy.position.set(faceCoord + outSign * 1.0, 3.4, 0);
        }
        g.add(portal); g.add(canopy);
      }
    }
    addFace(size, depth / 2, 'x', +1, entranceSide === 'front');   // front (+Z)
    addFace(size, -depth / 2, 'x', -1, entranceSide === 'back');    // back (-Z)
    addFace(depth, size / 2, 'z', +1, entranceSide === 'right');    // right (+X)
    addFace(depth, -size / 2, 'z', -1, entranceSide === 'left');    // left (-X)

    // ── Roof slab (slightly inset, white) so the roof reads distinct
    const roof = new THREE.Mesh(new THREE.BoxGeometry(size - 0.4, 0.12, depth - 0.4), MAT.messRoof);
    roof.position.y = H + 0.06;
    g.add(roof);
    const RY = H + 0.12;   // roof working height

    // ── Roof plant clustered along one edge (matches photo). Coordinates
    //    are in roof-local metres; cluster sits toward -X / +Z corner.
    // AHU / cooler boxes in a row
    const ahuMats = [MAT.ahuTeal, MAT.ahuBlue, MAT.ahuTeal, MAT.ahuBlue, MAT.ahuTeal];
    for (let i = 0; i < 5; i++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, 2.2), ahuMats[i]);
      box.position.set(-size / 2 + 4 + i * 3.0, RY + 0.9, depth / 2 - 4);
      g.add(box);
    }
    // Galvanised duct run linking the AHUs
    const duct = new THREE.Mesh(new THREE.BoxGeometry(13, 0.8, 0.9), MAT.duct);
    duct.position.set(-size / 2 + 9, RY + 0.5, depth / 2 - 6.2);
    g.add(duct);
    const duct2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 5), MAT.duct);
    duct2.position.set(-size / 2 + 3.5, RY + 0.5, depth / 2 - 7);
    g.add(duct2);

    // Water tanks — yellow Sintex + white, on low stands, opposite corner
    const tanks = [
      [size / 2 - 4, depth / 2 - 4, MAT.tankYellow],
      [size / 2 - 6.5, depth / 2 - 4, MAT.tankYellow],
      [size / 2 - 4, -depth / 2 + 4, MAT.gTank],
      [size / 2 - 6.5, -depth / 2 + 4, MAT.gTank],
    ];
    tanks.forEach(([tx, tz, mat]) => {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6), MAT.messBrickD);
      stand.position.set(tx, RY + 0.25, tz);
      g.add(stand);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.4, 14), mat);
      tank.position.set(tx, RY + 0.5 + 0.7, tz);
      g.add(tank);
    });

    // Solar water-heater panels — tilted flat panels in a row
    for (let i = 0; i < 3; i++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.8), MAT.solarPanel);
      panel.position.set(-size / 2 + 6 + i * 3.6, RY + 0.7, -depth / 2 + 5);
      panel.rotation.x = -0.4;
      g.add(panel);
    }

    // Stair-head box (taller mech room)
    const stairHead = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 4), MAT.messBrick);
    stairHead.position.set(size * 0.15, RY + 1.3, -depth * 0.12);
    g.add(stairHead);
    const shCap = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.3, 4.3), MAT.gStoneLite);
    shCap.position.set(size * 0.15, RY + 2.75, -depth * 0.12);
    g.add(shCap);

    // Scattered small parapet vent blocks
    [[-size*0.1, depth*0.2],[size*0.25, depth*0.25],[size*0.3,-depth*0.3],[-size*0.3,-depth*0.15]].forEach(([vx,vz])=>{
      const v = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 1.0), MAT.messBrickD);
      v.position.set(vx, RY + 0.45, vz);
      g.add(v);
    });

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // SME & MBA — School of Management blocks (matches drone + front photos)
  // ─────────────────────────────────────────────────────────────────────
  // Reference photos: warm cream-plaster prefab academic blocks with a bright
  // WHITE corrugated-metal GABLE roof (deep eave overhang), white-framed
  // windows each capped by a slim concrete sunshade (chajja), rows of
  // wall-mounted split-AC outdoor units, a slab-canopy entrance reached by an
  // accessibility RAMP with steel-pipe railings, and yellow/black painted
  // kerb stones lining the base. SME is a long single-storey block; MBA is an L of two
  // single-storey wings wrapping a paved courtyard with two tree-ring planters.
  //
  // Shared helpers build a single rectangular wing in mesh-local metres
  // (+X / +Z plan axes, +Y up); each LANDMARKS entry rotates the wing onto
  // its footprint via bearingOffset = 90° − (long-axis bearing).

  // White corrugated-metal gable roof over a wing. Ridge runs along the wing's
  // LONGER plan dimension; eaves overhang by `ov`; gable-end pediments are
  // filled in wall colour. baseY = wall top.
  function _mgmtGableRoof(g, cx, cz, w, d, baseY, rise, ov) {
    ov = ov ?? 0.9;
    const ridgeAlongX = w >= d;
    const eaveY = baseY, ridgeY = baseY + rise;
    const verts = [];
    const q = (A, B, C, D2) => { verts.push(...A, ...B, ...C, ...A, ...C, ...D2); };
    const tris = [];
    const X0 = cx - w / 2 - ov, X1 = cx + w / 2 + ov;
    const Z0 = cz - d / 2 - ov, Z1 = cz + d / 2 + ov;
    if (ridgeAlongX) {
      q([X0, eaveY, Z1], [X1, eaveY, Z1], [X1, ridgeY, cz], [X0, ridgeY, cz]);   // +Z slope
      q([X0, ridgeY, cz], [X1, ridgeY, cz], [X1, eaveY, Z0], [X0, eaveY, Z0]);   // -Z slope
      [cx - w / 2, cx + w / 2].forEach(xe => {
        tris.push([xe, eaveY, cz - d / 2], [xe, eaveY, cz + d / 2], [xe, ridgeY, cz]);
      });
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * ov, 0.18, 0.5), MAT.metalRidge);
      cap.position.set(cx, ridgeY + 0.05, cz); g.add(cap);
      [Z0, Z1].forEach(ze => {
        const f = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * ov, 0.32, 0.18), MAT.portalWhite);
        f.position.set(cx, eaveY - 0.02, ze); g.add(f);
      });
    } else {
      q([X1, eaveY, Z0], [X1, eaveY, Z1], [cx, ridgeY, Z1], [cx, ridgeY, Z0]);   // +X slope
      q([cx, ridgeY, Z0], [cx, ridgeY, Z1], [X0, eaveY, Z1], [X0, eaveY, Z0]);   // -X slope
      [cz - d / 2, cz + d / 2].forEach(ze => {
        tris.push([cx - w / 2, eaveY, ze], [cx + w / 2, eaveY, ze], [cx, ridgeY, ze]);
      });
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, d + 2 * ov), MAT.metalRidge);
      cap.position.set(cx, ridgeY + 0.05, cz); g.add(cap);
      [X0, X1].forEach(xe => {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, d + 2 * ov), MAT.portalWhite);
        f.position.set(xe, eaveY - 0.02, cz); g.add(f);
      });
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    rg.computeVertexNormals();
    g.add(new THREE.Mesh(rg, MAT.metalRoof));
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
    tg.computeVertexNormals();
    const tm = new THREE.Mesh(tg, MAT.mgmtWall); tm.material.side = THREE.DoubleSide;
    g.add(tm);
  }

  // Window rows (white frame + dark glass + sunshade) and split-AC units on a
  // single wall face. `treat` may contain 'win' and/or 'ac'.
  function _mgmtFace(g, cx, cz, w, d, h, floors, side, treat) {
    const runsAlongX = (side === '+z' || side === '-z');
    const wallLen = runsAlongX ? w : d;
    const faceZ = side === '+z' ? cz + d / 2 : (side === '-z' ? cz - d / 2 : cz);
    const faceX = side === '+x' ? cx + w / 2 : (side === '-x' ? cx - w / 2 : cx);
    const outSign = (side === '+x' || side === '+z') ? 1 : -1;
    const place = (t, cy, proj, bw, bh, bt, mat) => {
      const m = runsAlongX
        ? new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bt), mat)
        : new THREE.Mesh(new THREE.BoxGeometry(bt, bh, bw), mat);
      if (runsAlongX) m.position.set(cx + t, cy, faceZ + outSign * proj);
      else            m.position.set(faceX + outSign * proj, cy, cz + t);
      g.add(m); return m;
    };
    const cols = Math.max(2, Math.round(wallLen / 3.6));
    const colW = wallLen / cols;
    if (treat.includes('win')) {
      for (let f = 0; f < floors; f++) {
        const cy = h * (f + 0.5) / floors;
        for (let c = 0; c < cols; c++) {
          const t = -wallLen / 2 + (c + 0.5) * colW;
          place(t, cy, 0.06, 1.7, 1.5, 0.12, MAT.portalWhite);   // white reveal frame
          place(t, cy, 0.10, 1.35, 1.2, 0.06, MAT.entrance);     // dark glazing
          place(t, cy + 0.95, 0.30, 2.05, 0.16, 0.55, MAT.portalWhite); // sunshade chajja
        }
      }
    }
    if (treat.includes('ac')) {
      const cy = h - 1.25;
      for (let c = 0; c < cols; c++) {
        if (c % 2 === 1) continue;
        const t = -wallLen / 2 + (c + 0.5) * colW;
        place(t, cy, 0.30, 1.0, 0.66, 0.40, MAT.mgmtAC);
        place(t, cy, 0.52, 0.80, 0.50, 0.06, MAT.mgmtACd);   // fan grille
      }
    }
  }

  // A single cream wing: shell + plinth + floor bands + per-face treatment +
  // optional kerb ring + white gable roof.
  function _mgmtWing(g, o) {
    const cx = o.cx ?? 0, cz = o.cz ?? 0, w = o.w, d = o.d;
    const wallH = o.wallH, floors = o.floors ?? 1, rise = o.rise ?? 2.6;
    const faces = o.faces || {};
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), MAT.mgmtWall);
    block.position.set(cx, wallH / 2, cz); g.add(block);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.7, d + 0.4), MAT.mgmtWallD);
    plinth.position.set(cx, 0.35, cz); g.add(plinth);
    for (let i = 1; i < floors; i++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 0.3, d + 0.14), MAT.mgmtWallD);
      band.position.set(cx, wallH * i / floors, cz); g.add(band);
    }
    for (const side in faces) _mgmtFace(g, cx, cz, w, d, wallH, floors, side, faces[side]);
    if (o.kerb) _mgmtKerb(g, cx, cz, w, d);
    _mgmtGableRoof(g, cx, cz, w, d, wallH, rise, o.ov);
  }

  // Yellow/black kerb ring around a wing's base.
  function _mgmtKerb(g, cx, cz, w, d) {
    const off = 0.55, y = 0.18, hk = 0.36;
    [cz + d / 2 + off, cz - d / 2 - off].forEach(zc => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * off, hk, 0.3), MAT.mgmtKerbY);
      curb.position.set(cx, y, zc); g.add(curb);
      const n = Math.max(2, Math.round(w / 2.4));
      for (let i = 0; i <= n; i++) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, hk + 0.02, 0.34), MAT.mgmtKerbK);
        cap.position.set(cx - w / 2 + i * (w / n), y + 0.01, zc); g.add(cap);
      }
    });
    [cx + w / 2 + off, cx - w / 2 - off].forEach(xc => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.3, hk, d + 2 * off), MAT.mgmtKerbY);
      curb.position.set(xc, y, cz); g.add(curb);
      const n = Math.max(2, Math.round(d / 2.4));
      for (let i = 0; i <= n; i++) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, hk + 0.02, 0.34), MAT.mgmtKerbK);
        cap.position.set(xc, y + 0.01, cz - d / 2 + i * (d / n)); g.add(cap);
      }
    });
  }

  // A straight kerb run between two plan points (used along MBA's courtyard).
  function _mgmtKerbLine(g, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const curb = new THREE.Mesh(new THREE.BoxGeometry(L, 0.34, 0.3), MAT.mgmtKerbY);
    curb.position.set((ax + bx) / 2, 0.17, (az + bz) / 2);
    curb.rotation.y = Math.atan2(-dz, dx); g.add(curb);
    const n = Math.max(1, Math.round(L / 2.4));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.37, 0.34), MAT.mgmtKerbK);
      cap.position.set(ax + dx * t, 0.18, az + dz * t); g.add(cap);
    }
  }

  // Slab-canopy entrance + accessibility ramp with steel railings. `dir` is the
  // outward wall normal: '+x' | '-x' | '+z' | '-z'. Built in a local frame
  // (+x = outward, +z = sideways along the facade) then rotated onto the wall.
  function _mgmtRampPorch(g, x, z, dir) {
    const grp = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.0, 2.7), MAT.portalWhite);
    frame.position.set(0.06, 1.5, 0); grp.add(frame);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.7, 2.2), MAT.entrance);
    door.position.set(0.20, 1.35, 0); grp.add(door);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 3.4), MAT.portalWhite);
    canopy.position.set(1.1, 3.1, 0); grp.add(canopy);
    const porch = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.45, 4.2), MAT.mgmtWallD);
    porch.position.set(1.8, 0.225, 0); grp.add(porch);
    // Ramp sloping down to grade along the +z side of the porch.
    const rampLen = 5.2;
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, rampLen), MAT.mgmtWallD);
    ramp.position.set(1.8, 0.22, 4.2 / 2 + rampLen / 2 - 0.4);
    ramp.rotation.x = -Math.atan2(0.45, rampLen); grp.add(ramp);
    // Steel-pipe railings down both edges of the ramp.
    [2.25, 4.55].forEach(zr => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, rampLen + 1.6), MAT.mgmtRail);
      rail.position.set(1.4, 1.0, zr); rail.rotation.x = -Math.atan2(0.45, rampLen); grp.add(rail);
      for (let i = 0; i < 4; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), MAT.mgmtRail);
        post.position.set(1.4, 0.75 - i * 0.07, zr - 0.8 + i * 1.6); grp.add(post);
      }
    });
    const rotForDir = { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 };
    grp.position.set(x, 0, z);
    grp.rotation.y = rotForDir[dir] ?? 0;
    g.add(grp);
  }

  // Circular concrete tree-ring planter with soil + a small tree.
  function _mgmtPlanter(g, x, z, r) {
    const ringH = 0.5;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, ringH, 20), MAT.duct);
    ring.position.set(x, ringH / 2, z); g.add(ring);
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.35, r - 0.35, ringH * 0.9, 20), MAT.sandDark);
    soil.position.set(x, ringH * 0.92, z); g.add(soil);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2.2, 8), MAT.treeTrunk);
    trunk.position.set(x, ringH + 1.1, z); g.add(trunk);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), MAT.gCourt);
    canopy.position.set(x, ringH + 2.8, z); canopy.scale.set(1, 0.8, 1); g.add(canopy);
  }

  // SME — one long single-storey cream block. The access path leads up to the
  // WNW GABLE END (-X face, centred), so the entrance + accessibility ramp sit
  // there, matching the front photo (door + 4 windows under the gable peak).
  function buildSME() {
    const g = new THREE.Group();
    _mgmtWing(g, {
      cx: 0, cz: 0, w: 37, d: 24, wallH: 5.8, floors: 1, rise: 3.2, ov: 1.0,
      faces: { '+z': 'win+ac', '-z': 'win+ac', '+x': 'win', '-x': 'win' }, kerb: true,
    });
    _mgmtRampPorch(g, -18.5, 0, '-x');
    return g;
  }

  // MBA — L of two single-storey cream wings around a paved courtyard. Long
  // wing runs N–S (ridge along X); short wing branches WNW (ridge along Z).
  // Main entrance + ramp at the short wing's outer gable end; AC units on the
  // courtyard-facing inner faces; two tree-ring planters in the courtyard.
  function buildMBA() {
    const g = new THREE.Group();
    _mgmtWing(g, {                           // long wing
      cx: -3.45, cz: 6.0, w: 39.6, d: 15, wallH: 4.6, floors: 1, rise: 2.6, ov: 0.85,
      faces: { '+z': 'win', '-z': 'win+ac', '+x': 'win', '-x': 'win' },
    });
    _mgmtWing(g, {                           // short wing
      cx: 15.75, cz: 0, w: 15, d: 27, wallH: 4.6, floors: 1, rise: 2.6, ov: 0.85,
      faces: { '+x': 'win', '-x': 'win+ac', '+z': 'win', '-z': 'win' },
    });
    _mgmtRampPorch(g, 15.75, -13.5, '-z');
    _mgmtKerbLine(g, -23.25, 14.1, 16.35, 14.1);   // long wing, road side
    _mgmtKerbLine(g, -23.25, -2.1, 8.25, -2.1);     // long wing, courtyard side
    _mgmtKerbLine(g, 8.85, -2.1, 8.85, -13.5);      // short wing, courtyard side
    _mgmtPlanter(g, -4, -7.5, 2.2);
    _mgmtPlanter(g, -13, -8.5, 2.2);
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // BASIC LAB — three-part sandstone academic block (matches drone photo)
  // ─────────────────────────────────────────────────────────────────────
  // The real building reads as three DIFFERENT volumes along its front:
  //   • LEFT WING  — tall, clad in fine perforated jali screens
  //   • CENTRE     — a LOWER recessed entrance bay: white concrete pergola
  //                  over the door, with a grid of small square punched
  //                  windows above it
  //   • RIGHT CUBE — tall, almost entirely BLANK sandstone (only shallow
  //                  recessed panels + a couple of small windows)
  // Stepped rooflines, white corner pilasters, and tilted solar-PV arrays
  // on the tall wing roofs. Footprint is the L-shaped 8-vertex polygon.
  //
  // Mesh-local: +X = long axis (local u), +Z = local v.
  function buildBasicLab() {
    const g = new THREE.Group();
    const FLOOR_H = 3.7;

    // ── Per-face treatments ────────────────────────────────────────────
    // Shared geometry helper: resolve a face into its constant coord,
    // outward sign, run-axis and wall length.
    function faceInfo(cx, cz, w, d, side) {
      const runsAlongX = (side === '+z' || side === '-z');
      return {
        runsAlongX,
        wallLen: runsAlongX ? w : d,
        faceZ: side === '+z' ? cz + d / 2 : (side === '-z' ? cz - d / 2 : cz),
        faceX: side === '+x' ? cx + w / 2 : (side === '-x' ? cx - w / 2 : cx),
        outSign: (side === '+x' || side === '+z') ? 1 : -1,
      };
    }

    // Fine jali-screen cladding (left wing): white pilasters + a dense grid
    // of perforated panels, one per bay per floor.
    function addJaliFace(cx, cz, w, d, h, side) {
      const fi = faceInfo(cx, cz, w, d, side);
      const floors = Math.max(3, Math.round(h / FLOOR_H));
      const nBays = Math.max(3, Math.round(fi.wallLen / 3.6));
      const bayW = fi.wallLen / nBays;
      for (let i = 0; i <= nBays; i++) {
        const t = -fi.wallLen / 2 + i * bayW;
        const pil = fi.runsAlongX
          ? new THREE.Mesh(new THREE.BoxGeometry(0.55, h, 0.3), MAT.gStoneLite)
          : new THREE.Mesh(new THREE.BoxGeometry(0.3, h, 0.55), MAT.gStoneLite);
        if (fi.runsAlongX) pil.position.set(cx + t, h / 2, fi.faceZ + fi.outSign * 0.05);
        else               pil.position.set(fi.faceX + fi.outSign * 0.05, h / 2, cz + t);
        g.add(pil);
      }
      const panelH = (h / floors) * 0.7;
      for (let f = 0; f < floors; f++) {
        const cy = h * (f + 0.5) / floors + 0.1;
        for (let b = 0; b < nBays; b++) {
          const t = -fi.wallLen / 2 + (b + 0.5) * bayW;
          const pw = bayW - 1.0;
          const frame = fi.runsAlongX
            ? new THREE.Mesh(new THREE.BoxGeometry(pw + 0.18, panelH + 0.18, 0.10), MAT.gStoneDark)
            : new THREE.Mesh(new THREE.BoxGeometry(0.10, panelH + 0.18, pw + 0.18), MAT.gStoneDark);
          const jali = fi.runsAlongX
            ? new THREE.Mesh(new THREE.BoxGeometry(pw, panelH, 0.07), MAT.messJali)
            : new THREE.Mesh(new THREE.BoxGeometry(0.07, panelH, pw), MAT.messJali);
          if (fi.runsAlongX) {
            frame.position.set(cx + t, cy, fi.faceZ + fi.outSign * 0.06);
            jali.position.set(cx + t, cy, fi.faceZ + fi.outSign * 0.09);
          } else {
            frame.position.set(fi.faceX + fi.outSign * 0.06, cy, cz + t);
            jali.position.set(fi.faceX + fi.outSign * 0.09, cy, cz + t);
          }
          g.add(frame); g.add(jali);
        }
      }
    }

    // Grid of small square punched windows (centre entrance bay).
    function addWindowFace(cx, cz, w, d, h, side) {
      const fi = faceInfo(cx, cz, w, d, side);
      const floors = Math.max(3, Math.round(h / FLOOR_H));
      const cols = Math.max(3, Math.round(fi.wallLen / 2.8));
      const colW = fi.wallLen / cols;
      for (let f = 0; f < floors; f++) {
        const cy = h * (f + 0.5) / floors + 0.2;
        for (let c = 0; c < cols; c++) {
          const t = -fi.wallLen / 2 + (c + 0.5) * colW;
          const fr = fi.runsAlongX
            ? new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.15, 0.10), MAT.gStoneLite)
            : new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.15, 1.05), MAT.gStoneLite);
          const win = fi.runsAlongX
            ? new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.95, 0.06), MAT.entrance)
            : new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.85), MAT.entrance);
          if (fi.runsAlongX) {
            fr.position.set(cx + t, cy, fi.faceZ + fi.outSign * 0.05);
            win.position.set(cx + t, cy, fi.faceZ + fi.outSign * 0.08);
          } else {
            fr.position.set(fi.faceX + fi.outSign * 0.05, cy, cz + t);
            win.position.set(fi.faceX + fi.outSign * 0.08, cy, cz + t);
          }
          g.add(fr); g.add(win);
        }
      }
    }

    // Mostly-blank wall with a few shallow recessed panels (right cube).
    function addPlainFace(cx, cz, w, d, h, side) {
      const fi = faceInfo(cx, cz, w, d, side);
      const nP = Math.max(2, Math.round(fi.wallLen / 7));
      const pW = fi.wallLen / nP - 1.6;
      const pH = h - 3.0;
      for (let i = 0; i < nP; i++) {
        const t = -fi.wallLen / 2 + (i + 0.5) * (fi.wallLen / nP);
        const panel = fi.runsAlongX
          ? new THREE.Mesh(new THREE.BoxGeometry(pW, pH, 0.06), MAT.gStoneDark)
          : new THREE.Mesh(new THREE.BoxGeometry(0.06, pH, pW), MAT.gStoneDark);
        if (fi.runsAlongX) panel.position.set(cx + t, h / 2 + 0.5, fi.faceZ + fi.outSign * 0.04);
        else               panel.position.set(fi.faceX + fi.outSign * 0.04, h / 2 + 0.5, cz + t);
        g.add(panel);
      }
    }

    // Block shell + per-face treatment dispatch + optional solar roof.
    function addBlock(cx, cz, w, d, h, faceSpec, roofKit) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.gStone);
      block.position.set(cx, h / 2, cz);
      g.add(block);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.7, d + 0.25), MAT.gStoneDark);
      plinth.position.set(cx, 0.35, cz);
      g.add(plinth);
      const floors = Math.max(3, Math.round(h / FLOOR_H));
      for (let i = 1; i < floors; i++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.26, d + 0.12), MAT.gStoneDark);
        band.position.set(cx, h * i / floors, cz);
        g.add(band);
      }
      const para = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.8, d + 0.3), MAT.gStoneLite);
      para.position.set(cx, h + 0.4, cz);
      g.add(para);
      // White corner pilasters projecting slightly above the parapet
      [[w/2, d/2],[w/2,-d/2],[-w/2,d/2],[-w/2,-d/2]].forEach(([dx,dz]) => {
        const cpil = new THREE.Mesh(new THREE.BoxGeometry(1.1, h + 1.0, 1.1), MAT.gStoneLite);
        cpil.position.set(cx + dx, (h + 1.0) / 2, cz + dz);
        g.add(cpil);
      });
      for (const side in faceSpec) {
        const t = faceSpec[side];
        if (t === 'jali')   addJaliFace(cx, cz, w, d, h, side);
        else if (t === 'window') addWindowFace(cx, cz, w, d, h, side);
        else if (t === 'plain')  addPlainFace(cx, cz, w, d, h, side);
      }

      if (roofKit) {
        const RY = h + 0.45;
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.1, d - 0.3), MAT.messRoof);
        roof.position.set(cx, h + 0.05, cz);
        g.add(roof);
        const cols = Math.max(2, Math.floor((w - 3) / 4.4));
        const rows = Math.max(2, Math.floor((d - 3) / 4.4));
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const px = cx - w / 2 + 3 + i * ((w - 4) / cols);
            const pz = cz - d / 2 + 3 + j * ((d - 4) / rows);
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), MAT.duct);
            leg.position.set(px, RY + 0.25, pz);
            g.add(leg);
            const panel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 2.0), MAT.deptSolar);
            panel.position.set(px, RY + 0.7, pz);
            panel.rotation.x = -0.42;
            g.add(panel);
          }
        }
        [[cx - 1, cz], [cx + 1.2, cz + 1.5]].forEach(([vx, vz]) => {
          const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 10), MAT.duct);
          pipe.position.set(vx, RY + 0.8, vz);
          g.add(pipe);
        });
      }
    }

    const H_TALL = 16, H_LOW = 12;

    // Footprint frame: mesh +X = NORTH (long axis), mesh +Z = EAST
    // (derived from bearingOffset 78.9° → mesh+Z bearing 101°). The
    // building is an L: a MAIN BLOCK in the NE (the tall plain cube + a
    // recessed entrance bay) plus a JALI WING protruding to the SW.
    //   main block: meshX[-8.5,22.8] × meshZ[-10.8,14.8]
    //   jali wing : meshX[-26.6,-8.5] × meshZ[-23.2,2]
    // The cube's EAST (+Z) face projects FORWARD toward the entrance plaza
    // / road (the side the reference photos are taken from). The entrance
    // bay is recessed west of it; the jali wing sits further back + south.

    // CUBE — north part of the main block; tall, blank; east face forward.
    addBlock(12.4, 2.0, 20.8, 25.6, H_TALL,
      { '+z': 'plain', '+x': 'plain', '-z': 'plain' }, true);

    // ENTRANCE bay — south part of the main block; LOWER and RECESSED
    // ~5 m west of the cube's east face; small punched-window grid + pergola.
    addBlock(-3.25, -0.5, 10.5, 21.0, H_LOW,
      { '+z': 'window' }, false);

    // JALI WING — the SW protrusion; tall, jali on every exterior face.
    addBlock(-17.55, -10.6, 16.0, 23.0, H_TALL,
      { '-x': 'jali', '+x': 'jali', '+z': 'jali', '-z': 'jali' }, true);

    // ── White concrete pergola over the entrance, on the entrance bay's
    //    EAST (+Z) face, facing the plaza.
    {
      const ex = -3.25, ez = -0.5 + 21.0 / 2;   // entrance bay east face (z=+10)
      const colH = 4.0;
      [-2.6, 2.6].forEach((dx) => {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, colH, 0.5), MAT.portalWhite);
        col.position.set(ex + dx, colH / 2, ez + 2.4);
        g.add(col);
      });
      // Parallel slats running N-S (X), spaced outward to the east (+Z)
      for (let i = 0; i < 6; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.35, 0.35), MAT.portalWhite);
        slat.position.set(ex, colH + 0.2, ez + 0.6 + i * 1.0);
        g.add(slat);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 5.8), MAT.portalWhite);
      beam.position.set(ex, colH + 0.2, ez + 0.4);
      g.add(beam);
      const door = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.2, 0.4), MAT.entrance);
      door.position.set(ex, 1.6, ez - 0.1);
      g.add(door);
    }

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // LHC 1 — Lecture Hall Complex (one continuous wide sandstone building)
  // ─────────────────────────────────────────────────────────────────────
  // Reference photos (front = WEST face):
  //   ONE connected building ~82 m wide whose CENTRE steps BACK and DOWN,
  //   flanked by two TALL wings (flush/connected through the back mass):
  //     • NORTH wing (left in photo): mostly BLANK tall sandstone, with a
  //       band of jali panels only at the base.
  //     • SOUTH wing (right in photo): a grid of regular square windows.
  //     • CENTRE: recessed + lower; two RED panels on the upper wall; a
  //       white PORTAL — one long horizontal beam carried on tall vertical
  //       columns — stands in front of the recessed entrance.
  //   Stair towers rise behind the centre; flat white roof with solar PV.
  //
  // Mesh-local: bearingOffset 86.9° → mesh+X = NORTH, mesh+Z = EAST.
  // Front (west) face = -Z. Footprint spans meshX[-40,43] (N-S) and
  // roughly meshZ[-18,36] (W-E); west face anchored near meshZ=-18.
  function buildLHC1() {
    const g = new THREE.Group();
    const redMat = new THREE.MeshStandardMaterial({ color: 0xc0201e, metalness: 0.2, roughness: 0.6 });

    function faceInfo(cx, cz, w, d, side) {
      const ax = (side === '+x' || side === '-x');   // wall runs along Z
      return {
        ax, len: ax ? d : w,
        fX: side === '+x' ? cx + w/2 : (side === '-x' ? cx - w/2 : cx),
        fZ: side === '+z' ? cz + d/2 : (side === '-z' ? cz - d/2 : cz),
        os: (side === '+x' || side === '+z') ? 1 : -1,
      };
    }

    // Grid of jali OR window panels. kind: 'jali' | 'window'.
    // baseFloors: if set, only the bottom N floors get panels (jali base).
    function addGrid(cx, cz, w, d, h, side, kind, floors, baseFloors) {
      const fi = faceInfo(cx, cz, w, d, side);
      const nb = Math.max(3, Math.round(fi.len / (kind === 'window' ? 3.0 : 4.2)));
      const bw = fi.len / nb;
      // White pilasters between bays (jali only — windows sit in plain wall)
      if (kind === 'jali') {
        for (let i = 0; i <= nb; i++) {
          const t = -fi.len/2 + i*bw;
          const p = fi.ax ? new THREE.Mesh(new THREE.BoxGeometry(0.5,h,0.6), MAT.gStoneLite)
                          : new THREE.Mesh(new THREE.BoxGeometry(0.6,h,0.5), MAT.gStoneLite);
          if (fi.ax) p.position.set(fi.fX+fi.os*0.05, h/2, cz+t);
          else       p.position.set(cx+t, h/2, fi.fZ+fi.os*0.05);
          g.add(p);
        }
      }
      const maxF = baseFloors || floors;
      const ph = (h/floors) * (kind === 'window' ? 0.5 : 0.62);
      const pw = kind === 'window' ? bw*0.5 : bw - 1.0;
      for (let f = 0; f < maxF; f++) {
        const cy = h*(f+0.5)/floors + (kind === 'window' ? 0.2 : 0.1);
        for (let b = 0; b < nb; b++) {
          const t = -fi.len/2 + (b+0.5)*bw;
          const fr = fi.ax ? new THREE.Mesh(new THREE.BoxGeometry(0.1, ph+0.18, pw+0.18), MAT.gStoneDark)
                           : new THREE.Mesh(new THREE.BoxGeometry(pw+0.18, ph+0.18, 0.1), MAT.gStoneDark);
          const pn = fi.ax ? new THREE.Mesh(new THREE.BoxGeometry(0.07, ph, pw), MAT.messJali)
                           : new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.07), MAT.messJali);
          if (fi.ax) { fr.position.set(fi.fX+fi.os*0.06, cy, cz+t); pn.position.set(fi.fX+fi.os*0.09, cy, cz+t); }
          else       { fr.position.set(cx+t, cy, fi.fZ+fi.os*0.06); pn.position.set(cx+t, cy, fi.fZ+fi.os*0.09); }
          g.add(fr); g.add(pn);
        }
      }
    }

    // Mostly-blank wall with a few shallow recessed panels.
    function addBlank(cx, cz, w, d, h, side) {
      const fi = faceInfo(cx, cz, w, d, side);
      const nP = Math.max(2, Math.round(fi.len / 9));
      const pW = fi.len/nP - 2.0, pH = h - 4.0;
      for (let i = 0; i < nP; i++) {
        const t = -fi.len/2 + (i+0.5)*(fi.len/nP);
        const pan = fi.ax ? new THREE.Mesh(new THREE.BoxGeometry(0.05, pH, pW), MAT.gStoneDark)
                          : new THREE.Mesh(new THREE.BoxGeometry(pW, pH, 0.05), MAT.gStoneDark);
        if (fi.ax) pan.position.set(fi.fX+fi.os*0.03, h/2+1.0, cz+t);
        else       pan.position.set(cx+t, h/2+1.0, fi.fZ+fi.os*0.03);
        g.add(pan);
      }
    }

    // Plain block shell with plinth + parapet; optional solar roof.
    function addBlock(cx, cz, w, d, h, solar) {
      const blk = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), MAT.gStone);
      blk.position.set(cx, h/2, cz); g.add(blk);
      const pl = new THREE.Mesh(new THREE.BoxGeometry(w+0.2,0.6,d+0.2), MAT.gStoneDark);
      pl.position.set(cx, 0.3, cz); g.add(pl);
      const para = new THREE.Mesh(new THREE.BoxGeometry(w+0.28,0.7,d+0.28), MAT.gStoneLite);
      para.position.set(cx, h+0.35, cz); g.add(para);
      if (solar) {
        const RY = h + 0.4;
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w-0.3,0.1,d-0.3), MAT.messRoof);
        roof.position.set(cx, h+0.05, cz); g.add(roof);
        const cols = Math.max(2, Math.floor((w-4)/5));
        const rows = Math.max(1, Math.floor((d-4)/4.5));
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
          const px = cx - w/2 + 3 + i*((w-5)/cols);
          const pz = cz - d/2 + 3 + j*((d-4)/rows);
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.5,0.08), MAT.duct);
          leg.position.set(px, RY+0.25, pz); g.add(leg);
          const pan = new THREE.Mesh(new THREE.BoxGeometry(4.2,0.1,2.4), MAT.deptSolar);
          pan.position.set(px, RY+0.7, pz); pan.rotation.x = -0.4; g.add(pan);
        }
      }
    }

    const H_WING = 12.5, H_LOW = 7.5, H_UP = 11, H_TWR = 14.5;
    // Whole model sized + centred to clear all surrounding roads (verified
    // ≥8 m clearance): bounding box meshX[-35,35], meshZ[-12,20].

    // ── BACK MASS — full width + deep, ties the whole building together
    addBlock(0, 11, 70, 18, H_WING, true);       // meshX[-35,35], meshZ[2,20]

    // ── NORTH WING (front, +X / left in photo): blank with jali base
    addBlock(23.5, -3, 23, 18, H_WING, false);   // meshX[12,35], meshZ[-12,6]
    addBlank(23.5, -3, 23, 18, H_WING, '-z');
    addGrid (23.5, -3, 23, 18, H_WING, '-z', 'jali', 3, 1);   // jali base only
    addBlank(23.5, -3, 23, 18, H_WING, '+x');

    // ── SOUTH WING (front, -X / right in photo): regular window grid
    addBlock(-23.5, -3, 23, 18, H_WING, false);  // meshX[-35,-12], meshZ[-12,6]
    addGrid (-23.5, -3, 23, 18, H_WING, '-z', 'window', 3);
    addGrid (-23.5, -3, 23, 18, H_WING, '-x', 'window', 3);

    // ── CENTRE LOWER (recessed 4 m + one storey lower): jali entrance wall
    addBlock(0, 0, 24, 16, H_LOW, false);        // front at meshZ=-8
    addGrid (0, 0, 24, 16, H_LOW, '-z', 'jali', 2);

    // ── CENTRE UPPER (set-back taller wall carrying the two red panels)
    addBlock(0, 2, 22, 10, H_UP, false);         // front at meshZ=-3
    [-4.5, 4.5].forEach((rx) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 0.25), redMat);
      r.position.set(rx, H_LOW + 2.2, -3 - 0.12);   // on centre-upper west face
      g.add(r);
    });

    // ── Stair towers rising behind the centre
    addBlock(-6, 5, 7, 7, H_TWR, false);
    addBlock( 6, 5, 7, 7, H_TWR, false);

    // ── WHITE PORTAL — one long horizontal beam on tall vertical columns,
    //    standing in front of the recessed centre (between the two wings).
    {
      const PZ = -11.0;             // just in front of the wings' west face (-12)
      const COLH = H_LOW + 2.0;     // ~9.5 m tall
      const SPAN = 24;              // X[-12,12] — touches both wing inner faces
      // Tall columns (gap kept at the centre for the entrance axis)
      [-12, -6, 6, 12].forEach((px) => {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.7, COLH, 0.8), MAT.portalWhite);
        col.position.set(px, COLH/2, PZ);
        g.add(col);
      });
      // One long thick horizontal beam near the top of the columns
      const beam = new THREE.Mesh(new THREE.BoxGeometry(SPAN, 0.9, 1.0), MAT.portalWhite);
      beam.position.set(0, COLH - 0.9, PZ);
      g.add(beam);
      // Dark recessed entrance in the centre-lower west wall (meshZ=-8)
      const door = new THREE.Mesh(new THREE.BoxGeometry(5.0, 3.6, 0.4), MAT.entrance);
      door.position.set(0, 1.8, -8 - 0.1);
      g.add(door);
      // Stone steps up to the entrance
      for (let i = 0; i < 3; i++) {
        const stp = new THREE.Mesh(new THREE.BoxGeometry(7 - i*0.6, 0.2, 0.7), MAT.gStoneLite);
        stp.position.set(0, 0.1 + i*0.2, -8 - 0.6 - (2-i)*0.7);
        g.add(stp);
      }
    }

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // CASE — Centre for Advance Scientific Equipment (U-plan academic block)
  // ─────────────────────────────────────────────────────────────────────
  // Reference photos: a U-shaped G+3 building — two tall wings (buff
  // sandstone with salmon-PINK floor bands + pink pilasters and a grid of
  // windows) joined by a back spine, with a LOWER central entrance bay
  // recessed between the wings carrying a white concrete pergola portico.
  // Flat white roofs with large solar-PV arrays on the wings + water tanks.
  //
  // Mesh-local: +X = long axis (u), +Z = depth (v). Courtyard/front = -Z.
  function buildCASE() {
    const g = new THREE.Group();
    const H = 15, FLOORS = 4, HC = 8;
    const tan = MAT.gStone, pink = MAT.akPink, pinkD = MAT.akPinkD, lite = MAT.gStoneLite, dark = MAT.entrance;

    function faceInfo(cx, cz, w, d, side) {
      const ax = (side === '+x' || side === '-x');
      return { ax, len: ax ? d : w,
        fX: side === '+x' ? cx+w/2 : (side === '-x' ? cx-w/2 : cx),
        fZ: side === '+z' ? cz+d/2 : (side === '-z' ? cz-d/2 : cz),
        os: (side === '+x' || side === '+z') ? 1 : -1 };
    }
    // Window grid framed by pink pilasters
    function addWin(cx, cz, w, d, h, side, floors) {
      const fi = faceInfo(cx, cz, w, d, side);
      const cols = Math.max(3, Math.round(fi.len / 3.2));
      const colW = fi.len / cols;
      for (let i = 0; i <= cols; i++) {
        const t = -fi.len/2 + i*colW;
        const p = fi.ax ? new THREE.Mesh(new THREE.BoxGeometry(0.45,h,0.5), pinkD)
                        : new THREE.Mesh(new THREE.BoxGeometry(0.5,h,0.45), pinkD);
        if (fi.ax) p.position.set(fi.fX+fi.os*0.04, h/2, cz+t);
        else       p.position.set(cx+t, h/2, fi.fZ+fi.os*0.04);
        g.add(p);
      }
      for (let f = 0; f < floors; f++) {
        const cy = h*(f+0.5)/floors + 0.2;
        for (let c = 0; c < cols; c++) {
          const t = -fi.len/2 + (c+0.5)*colW;
          const fr = fi.ax ? new THREE.Mesh(new THREE.BoxGeometry(0.08,1.3,1.0), lite)
                           : new THREE.Mesh(new THREE.BoxGeometry(1.0,1.3,0.08), lite);
          const wn = fi.ax ? new THREE.Mesh(new THREE.BoxGeometry(0.05,1.0,0.72), dark)
                           : new THREE.Mesh(new THREE.BoxGeometry(0.72,1.0,0.05), dark);
          if (fi.ax) { fr.position.set(fi.fX+fi.os*0.05, cy, cz+t); wn.position.set(fi.fX+fi.os*0.08, cy, cz+t); }
          else       { fr.position.set(cx+t, cy, fi.fZ+fi.os*0.05); wn.position.set(cx+t, cy, fi.fZ+fi.os*0.08); }
          g.add(fr); g.add(wn);
        }
      }
    }
    function addBlock(cx, cz, w, d, h, floors, winFaces, solar) {
      const blk = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), tan);
      blk.position.set(cx, h/2, cz); g.add(blk);
      const pl = new THREE.Mesh(new THREE.BoxGeometry(w+0.2,0.6,d+0.2), pinkD);
      pl.position.set(cx, 0.3, cz); g.add(pl);
      for (let i = 1; i < floors; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w+0.12,0.35,d+0.12), pink);
        b.position.set(cx, h*i/floors, cz); g.add(b);
      }
      const para = new THREE.Mesh(new THREE.BoxGeometry(w+0.25,0.7,d+0.25), lite);
      para.position.set(cx, h+0.35, cz); g.add(para);
      for (const s of winFaces) addWin(cx, cz, w, d, h, s, floors);
      if (solar) {
        const RY = h + 0.4;
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w-0.3,0.1,d-0.3), MAT.messRoof);
        roof.position.set(cx, h+0.05, cz); g.add(roof);
        const cc = Math.max(1, Math.floor((w-3)/4)), rr = Math.max(2, Math.floor((d-3)/4));
        for (let i = 0; i < cc; i++) for (let j = 0; j < rr; j++) {
          const px = cx - w/2 + 2.5 + i*((w-3)/cc), pz = cz - d/2 + 2.5 + j*((d-3)/rr);
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.5,0.08), MAT.duct);
          leg.position.set(px, RY+0.25, pz); g.add(leg);
          const pan = new THREE.Mesh(new THREE.BoxGeometry(3.4,0.1,2.2), MAT.deptSolar);
          pan.position.set(px, RY+0.7, pz); pan.rotation.x = -0.4; g.add(pan);
        }
      }
    }

    // U-plan (mesh+X = u≈39 m, mesh+Z = v≈46 m; front courtyard at -Z)
    addBlock(-14.5, 3, 15, 46, H, FLOORS, ['-x', '-z', '+z'], true);   // LEFT wing
    addBlock(  9.5, 3, 13, 46, H, FLOORS, ['+x', '-z', '+z'], true);   // RIGHT wing
    addBlock( -2.5, 18, 11, 16, H, FLOORS, ['+z'], false);             // BACK spine
    addBlock( -2.5, 0, 11, 18, HC, 2, ['-z'], false);                  // CENTRE entrance bay (lower)

    // White pergola portico at the centre front (-Z)
    {
      const cx = -2.5, ez = 0 - 18/2, colH = 5;   // centre front face Z=-9
      [-4, 4].forEach((dx) => {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.6, colH, 0.6), MAT.portalWhite);
        c.position.set(cx+dx, colH/2, ez-2.5); g.add(c);
      });
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(9, 0.35, 0.35), MAT.portalWhite);
        s.position.set(cx, colH+0.2, ez - 0.6 - i*0.9); g.add(s);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.4, 0.5), MAT.portalWhite);
      beam.position.set(cx, colH+0.2, ez-0.3); g.add(beam);
      const door = new THREE.Mesh(new THREE.BoxGeometry(4, 3.4, 0.4), dark);
      door.position.set(cx, 1.7, ez+0.1); g.add(door);
      for (let i = 0; i < 3; i++) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(6-i*0.6, 0.2, 0.7), lite);
        st.position.set(cx, 0.1+i*0.2, ez - 0.6 - (2-i)*0.7); g.add(st);
      }
    }

    // Water tanks on the back-spine roof
    [[-4, 18, 0], [1, 20, 1]].forEach(([tx, tz, grn]) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.7,0.7,1.3,12), grn ? MAT.gTankGrn : MAT.gTank);
      t.position.set(tx, H+0.6, tz); g.add(t);
    });

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // AAKASH SPORTS COMPLEX — long tall indoor sports hall
  // ─────────────────────────────────────────────────────────────────────
  // Reference photos: one large rectangular hall (~85 × 38 m, ~13 m tall),
  // salmon-PINK plaster walls divided into tall bays by pink pilasters,
  // each bay carrying horizontal REDDISH-BRICK bands; a brick plinth at the
  // base; a flat WHITE roof that overhangs the long sides, carried on a
  // dark-BLUE steel fascia with regularly-spaced ANGLED BRACKETS projecting
  // from the wall head. A white portal entrance with battered side walls
  // and steps sits at one gable end.
  //
  // Mesh-local: +X = long axis, +Z = depth. bearingOffset aligns to the
  // Akaash Complex polygon (long axis bearing 47.5°).
  function buildAakashComplex() {
    const g = new THREE.Group();
    const L = 85, D = 38, H = 13;   // hall length, depth, wall height

    // ── Main hall volume (pink plaster)
    const hall = new THREE.Mesh(new THREE.BoxGeometry(L, H, D), MAT.akPink);
    hall.position.y = H / 2;
    g.add(hall);

    // ── Brick plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(L + 0.3, 1.6, D + 0.3), MAT.akBrick);
    plinth.position.y = 0.8;
    g.add(plinth);

    // ── Horizontal reddish-brick bands wrapping the hall (3 courses)
    [0.32, 0.55, 0.78].forEach((fr) => {
      const band = new THREE.Mesh(new THREE.BoxGeometry(L + 0.18, 0.5, D + 0.18), MAT.akBrick);
      band.position.y = H * fr;
      g.add(band);
    });

    // ── Pink pilasters dividing the long (±Z) walls into bays
    const nBays = 10;
    const bayW = L / nBays;
    const longFaces = [D / 2, -D / 2];
    for (let s = 0; s < 2; s++) {
      const fz = longFaces[s];
      const os = s === 0 ? 1 : -1;
      for (let i = 0; i <= nBays; i++) {
        const x = -L / 2 + i * bayW;
        const pil = new THREE.Mesh(new THREE.BoxGeometry(1.0, H, 0.5), MAT.akPinkD);
        pil.position.set(x, H / 2, fz + os * 0.2);
        g.add(pil);
      }
    }
    // Pilasters on the gable (±X) ends too
    const endFaces = [L / 2, -L / 2];
    const nEnd = 4, endBay = D / nEnd;
    for (let s = 0; s < 2; s++) {
      const fx = endFaces[s];
      const os = s === 0 ? 1 : -1;
      for (let i = 0; i <= nEnd; i++) {
        const z = -D / 2 + i * endBay;
        const pil = new THREE.Mesh(new THREE.BoxGeometry(0.5, H, 1.0), MAT.akPinkD);
        pil.position.set(fx + os * 0.2, H / 2, z);
        g.add(pil);
      }
    }

    // ── Dark-blue steel fascia band running along the top of the long walls
    [D / 2, -D / 2].forEach((fz, s) => {
      const os = s === 0 ? 1 : -1;
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(L + 1.0, 0.6, 0.4), MAT.akBlue);
      fascia.position.set(0, H + 0.3, fz + os * 0.6);
      g.add(fascia);
      // Angled brackets projecting out + up to the roof edge, at each bay line
      for (let i = 0; i <= nBays; i++) {
        const x = -L / 2 + i * bayW;
        const br = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.35), MAT.akBlue);
        br.position.set(x, H - 0.4, fz + os * 0.75);
        br.rotation.x = os * 0.7;   // lean outward toward the eave
        g.add(br);
      }
    });

    // ── Flat white roof, overhanging the long sides (on the brackets)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 1.2, 0.5, D + 3.0), MAT.akRoof);
    roof.position.y = H + 0.85;
    g.add(roof);
    // Thin blue trim along the roof's long edges
    [D / 2, -D / 2].forEach((fz, s) => {
      const os = s === 0 ? 1 : -1;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(L + 1.2, 0.18, 0.3), MAT.akBlue);
      trim.position.set(0, H + 0.62, fz + os * 1.5);
      g.add(trim);
    });

    // ── The gable ends are plain pink + brick walls (NO grand entrance).
    //    The only public gate is a SMALL RED GATE on the FRONT long side
    //    (facing the sports ground), near the SW end, with a small low
    //    structure (utility annex) adjacent to it — per the reference photo.
    {
      const redMat = new THREE.MeshStandardMaterial({ color: 0xb5201e, metalness: 0.2, roughness: 0.55 });
      const FZ = D / 2;             // front (ground-facing) long face (+Z)
      const gx = -L / 2 + 14;       // near the SW end

      // Small low annex structure next to the gate
      const aw = 8, ad = 6, ah = 4.5;
      const az = FZ + ad / 2 - 0.4;
      const annex = new THREE.Mesh(new THREE.BoxGeometry(aw, ah, ad), MAT.akPink);
      annex.position.set(gx - 6.5, ah / 2, az);
      g.add(annex);
      const aband = new THREE.Mesh(new THREE.BoxGeometry(aw + 0.1, 0.4, ad + 0.1), MAT.akBrick);
      aband.position.set(gx - 6.5, ah * 0.55, az);
      g.add(aband);
      const acap = new THREE.Mesh(new THREE.BoxGeometry(aw + 0.3, 0.3, ad + 0.3), MAT.gStoneLite);
      acap.position.set(gx - 6.5, ah + 0.15, az);
      g.add(acap);

      // Small red gate (door) on the main hall front wall
      const gateFrame = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.4, 0.2), MAT.gStoneLite);
      gateFrame.position.set(gx, 1.7, FZ + 0.06);
      g.add(gateFrame);
      const gate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.9, 0.2), redMat);
      gate.position.set(gx, 1.45, FZ + 0.16);
      g.add(gate);
      // A couple of entry steps in front of the gate
      for (let i = 0; i < 2; i++) {
        const stp = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 0.6), MAT.gStoneLite);
        stp.position.set(gx, 0.09 + i * 0.18, FZ + 0.3 + (1 - i) * 0.6);
        g.add(stp);
      }
    }

    // ── A few small roof vents
    [[-25, 0], [0, 5], [25, -4]].forEach(([vx, vz]) => {
      const v = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.0, 2.5), MAT.akRoof);
      v.position.set(vx, H + 1.6, vz);
      g.add(v);
    });

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
  // JODHPUR CLUB — H-plan two-storey club block with sunken courtyard
  // ─────────────────────────────────────────────────────────────────────
  // From drone photographs: two parallel 2-storey wings (reddish Jodhpur
  // sandstone-brick walls + salmon-PINK plastered floor bands, pilasters and
  // top cornice) joined by a slightly lower FRONT bar at the south, with a
  // central SUNKEN COURTYARD between them carrying tiered amphitheatre steps.
  // A wide WHITE concrete pergola (slab on slim columns) shelters the south
  // entrance. The flat white roofs carry small solar arrays and a row of
  // mounted AC condensers along the west wall.
  //
  // Mesh-local: +X = long axis (wings separated), +Z = depth (front=+Z).
  function buildJodhpurClub() {
    const g = new THREE.Group();
    const brick = MAT.messBrick, brickD = MAT.messBrickD;
    const pink  = MAT.akPink,    pinkD  = MAT.akPinkD;
    const white = MAT.portalWhite;
    const roof  = MAT.akRoof;
    const dark  = MAT.entrance;
    const ahu   = MAT.ahuTeal;
    const solar = MAT.solarPanel;

    const W = 75, D = 56, H = 9;          // overall + storey height
    const wingW = 23, bridgeD = 16;
    const courtW = W - 2*wingW;

    // ── Ground apron + plinth so the building reads as sitting ON the ground
    //    (not clipping into it). The pink plinth wraps the whole footprint.
    const apron = new THREE.Mesh(new THREE.BoxGeometry(W + 6, 0.3, D + 6), brickD);
    apron.position.set(0, 0.15, 0); g.add(apron);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 1.0, D + 1.2), pink);
    plinth.position.set(0, 0.8, 0); g.add(plinth);
    const plinthTop = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.15, D + 1.4), pinkD);
    plinthTop.position.set(0, 1.375, 0); g.add(plinthTop);
    // All building elements go into a sub-group lifted onto the plinth top.
    const bg = new THREE.Group();
    bg.position.y = 1.45;
    g.add(bg);

    // ── Wing factory (left at cx=-W/2+wingW/2, right at +W/2-wingW/2) ──
    function buildWing(cx) {
      const wg = new THREE.Group();
      // 2-storey brick volume
      const wall = new THREE.Mesh(new THREE.BoxGeometry(wingW, H, D), brick);
      wall.position.set(cx, H/2, 0); wg.add(wall);
      // Pink mid-floor band + top cornice
      [[H/2 + 0.05, 0.4], [H - 0.3, 0.6]].forEach(([y, t]) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(wingW + 0.25, t, D + 0.25), pink);
        b.position.set(cx, y, 0); wg.add(b);
      });
      // White roof slab
      const rs = new THREE.Mesh(new THREE.BoxGeometry(wingW + 0.35, 0.45, D + 0.35), roof);
      rs.position.set(cx, H + 0.225, 0); wg.add(rs);
      // Pink parapet ring (4 thin walls on the roof edge)
      const ph = 0.95, pt = 0.22;
      const rings = [
        [pt, ph, D + 0.4, cx - wingW/2 - pt/2, 0],
        [pt, ph, D + 0.4, cx + wingW/2 + pt/2, 0],
        [wingW + 0.5, ph, pt, cx, D/2 + pt/2],
        [wingW + 0.5, ph, pt, cx, -D/2 - pt/2],
      ];
      for (const [w, h, d, x, z] of rings) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), pink);
        m.position.set(x, H + 0.5 + h/2, z); wg.add(m);
      }
      // Vertical pink pilasters on the long faces (south + north)
      const cols = 7;
      for (let i = 0; i <= cols; i++) {
        const z = -D/2 + (D * i / cols);
        // West face pilaster (cx - wingW/2)
        // East face pilaster (cx + wingW/2)
        // Skip — only do front/back (south +Z and north -Z) for now
      }
      return wg;
    }
    bg.add(buildWing(-W/2 + wingW/2));
    bg.add(buildWing(+W/2 - wingW/2));

    // ── Front bridge (south, connects wings; slightly lower than wings) ──
    const bH = H * 0.72;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(W, bH, bridgeD), brick);
    bridge.position.set(0, bH/2, D/2 - bridgeD/2); bg.add(bridge);
    [[bH/2 + 0.05, 0.4], [bH - 0.3, 0.55]].forEach(([y, t]) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, t, bridgeD + 0.2), pink);
      b.position.set(0, y, D/2 - bridgeD/2); bg.add(b);
    });
    const bRoof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.4, bridgeD + 0.3), roof);
    bRoof.position.set(0, bH + 0.2, D/2 - bridgeD/2); bg.add(bRoof);

    // ── White concrete entrance pergola (south, projecting +Z) ──
    const pW = 16, pD = 5.5, pH = 4.6;
    const pZ = D/2 + pD/2;
    // Top slab
    const pTop = new THREE.Mesh(new THREE.BoxGeometry(pW + 0.8, 0.5, pD + 0.4), white);
    pTop.position.set(0, pH + 0.25, pZ); bg.add(pTop);
    // Two rows of slim columns
    for (let i = 0; i < 5; i++) {
      const x = -pW/2 + (i * pW / 4);
      [0, pD - 0.1].forEach(zo => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.42, pH, 0.42), white);
        post.position.set(x, pH/2, D/2 + zo); bg.add(post);
      });
    }
    // Stepped entry plaza (3 risers ON the plinth)
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(pW - 2 - i*1.4, 0.22, 1.2 + i*0.6), brickD);
      s.position.set(0, 0.11 + i*0.22, D/2 + pD + 0.5 + i*0.8); bg.add(s);
    }

    // ── Sunken central courtyard plaza ──
    const courtCZ = (-(D/2 - bridgeD) + (-D/2 + 11)) / 2;   // centre between bridge and rear pad
    const courtCD = (D/2 - bridgeD) - (-D/2 + 11);
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(courtW - 1, 0.25, courtCD), brickD);
    plaza.position.set(0, 0.125, courtCZ); bg.add(plaza);
    // Amphitheatre steps (rising from plaza toward south bridge)
    for (let i = 0; i < 5; i++) {
      const sw = courtW - 3 - i*0.4, sh = 0.32, sd = 1.4;
      const s = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), brick);
      s.position.set(0, sh/2 + i*sh, D/2 - bridgeD - 0.7 - i*sd); bg.add(s);
    }

    // ── Rear (north) plaza pad ──
    const np = new THREE.Mesh(new THREE.BoxGeometry(courtW + 4, 0.55, 11), brickD);
    np.position.set(0, 0.275, -D/2 + 5.5); bg.add(np);

    // ── AC condenser units on the west wall of left wing ──
    for (let i = 0; i < 7; i++) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.15, 0.7), ahu);
      ac.position.set(-W/2 - 0.4, H * 0.55 + 0.2, -10 + i * 2.6); bg.add(ac);
      // Mounting bracket
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 0.85), pinkD);
      br.position.set(-W/2 - 0.1, H * 0.55 + 0.2, -10 + i * 2.6); bg.add(br);
    }

    // ── Solar arrays on the wing roofs ──
    function addSolar(cx) {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 1.95), solar);
        p.position.set(cx + (i - 1) * 5, H + 0.95, -10 + j * 5.5);
        p.rotation.x = -Math.PI / 14; bg.add(p);
      }
    }
    addSolar(-W/2 + wingW/2); addSolar(+W/2 - wingW/2);
    // Roof-top water tank + small stair box on left wing
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 10), MAT.tankYellow);
    tank.position.set(-W/2 + wingW - 3, H + 1.2, D/2 - 5); bg.add(tank);
    const stairBox = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), brickD);
    stairBox.position.set(-W/2 + 4, H + 0.8 + 0.8, -D/2 + 4); bg.add(stairBox);

    // ── Window grids on facades (jali rhythm) ──
    function addWindows(cx, fz, count, sign) {
      for (let r = 0; r < 2; r++) for (let c = 0; c < count; c++) {
        const winW = 1.35, winH = 1.55;
        const x = cx + (c - (count-1)/2) * 2.7;
        const y = 1.6 + r * 4.0;
        // Pink reveal frame
        const fr = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.4, winH + 0.4, 0.05), pinkD);
        fr.position.set(x, y, fz); bg.add(fr);
        // Dark glazing
        const win = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, 0.05), dark);
        win.position.set(x, y, fz + sign*0.03); bg.add(win);
      }
    }
    addWindows(-W/2 + wingW/2, D/2 + 0.05, 7, +1);
    addWindows(+W/2 - wingW/2, D/2 + 0.05, 7, +1);
    addWindows(-W/2 + wingW/2, -D/2 - 0.05, 7, -1);
    addWindows(+W/2 - wingW/2, -D/2 - 0.05, 7, -1);
    // Front bridge inner (courtyard-facing) windows
    addWindows(0, D/2 - bridgeD - 0.05, 5, -1);

    // ── Pink vertical pilasters on south wing faces (front) ──
    [-W/2 + wingW/2, +W/2 - wingW/2].forEach(cx => {
      for (let i = -3; i <= 3; i++) {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(0.4, H, 0.25), pink);
        pil.position.set(cx + i*3.3, H/2, D/2 + 0.13); bg.add(pil);
      }
    });

    // ── Ground-level entrance steps (descending from plinth to ground) ──
    // These sit at the GROUND (not lifted with bg), and rise UP to the plinth.
    for (let i = 0; i < 4; i++) {
      const sw = pW + 2 + i*0.8, sh = 0.36, sd = 0.9;
      const s = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), brickD);
      s.position.set(0, sh/2 + i*sh, D/2 + pD + 2.5 + i*sd); g.add(s);
    }

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // PHC (Primary Health Centre) — E-plan single-storey solar-clad clinic
  // ─────────────────────────────────────────────────────────────────────
  // From drone photographs: an E-shape footprint with three horizontal
  // wings (top + middle + bottom, running east-west) connected by a
  // vertical spine on the east side. The middle wing is SHORTER (extends
  // less far west) so two open landscaped courtyards sit on the west side.
  // Reddish Jodhpur sandstone-brick walls with pink plaster cornice and
  // jali window bays. EVERY roof is densely covered with tilted solar PV
  // arrays — the defining visual feature. The south (front) wall of the
  // bottom wing carries a long white concrete pergola entrance with a
  // "HEALTH CENTER" sign over the central bay.
  //
  // Mesh-local: +X = east-west long axis, +Z = south (front), +Y = up.
  function buildPHC() {
    const g = new THREE.Group();
    const brick = MAT.messBrick, brickD = MAT.messBrickD;
    const pink  = MAT.akPink,    pinkD  = MAT.akPinkD;
    const white = MAT.portalWhite;
    const roof  = MAT.akRoof;
    const dark  = MAT.entrance;
    const solar = MAT.solarPanel;

    const W = 62, D = 50, H = 5.2;     // single storey, high ceilings
    const barD = 11;                    // each wing depth (N-S)
    const spineW = 6;                   // east-side vertical spine width
    const midLen = W - 18;              // middle wing is shorter

    // ── Apron + plinth so the building sits ON the ground ──
    const apron = new THREE.Mesh(new THREE.BoxGeometry(W + 6, 0.3, D + 6), brickD);
    apron.position.set(0, 0.15, 0); g.add(apron);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.8, D + 1.2), pink);
    plinth.position.set(0, 0.55, 0); g.add(plinth);
    const plinthTop = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.12, D + 1.4), pinkD);
    plinthTop.position.set(0, 1.01, 0); g.add(plinthTop);
    const bg = new THREE.Group(); bg.position.y = 1.07; g.add(bg);

    // ── Wing factory: a horizontal bar (E-W) of given length, centered at cx ──
    function buildWing(cz, len, cx) {
      // Brick volume
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, H, barD), brick);
      wall.position.set(cx, H/2, cz); bg.add(wall);
      // Pink top cornice
      const cor = new THREE.Mesh(new THREE.BoxGeometry(len + 0.25, 0.4, barD + 0.25), pink);
      cor.position.set(cx, H - 0.2, cz); bg.add(cor);
      // White flat roof slab
      const rs = new THREE.Mesh(new THREE.BoxGeometry(len + 0.35, 0.35, barD + 0.35), roof);
      rs.position.set(cx, H + 0.175, cz); bg.add(rs);
      // Parapet ring (4 thin pink walls)
      const ph = 0.55, pt = 0.18;
      [[pt, ph, barD + 0.4, cx - len/2 - pt/2, cz],
       [pt, ph, barD + 0.4, cx + len/2 + pt/2, cz],
       [len + 0.5, ph, pt, cx, cz + barD/2 + pt/2],
       [len + 0.5, ph, pt, cx, cz - barD/2 - pt/2]].forEach(([w,h,d,x,z]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), pink);
        m.position.set(x, H + 0.35 + h/2, z); bg.add(m);
      });
    }

    // Three wings (TOP=back/-Z, MIDDLE, BOTTOM=front/+Z). Middle is shorter
    // and shifted east so the open courtyards sit on the WEST side.
    const topZ  = -D/2 + barD/2;
    const midZ  = 0;
    const botZ  = +D/2 - barD/2;
    buildWing(topZ, W,      0);                   // back wing — full length
    buildWing(midZ, midLen, (W - midLen)/2);      // middle wing — shorter, east-aligned
    buildWing(botZ, W,      0);                   // front wing — full length

    // ── East-side vertical spine (closes the E-shape on the east) ──
    const spine = new THREE.Mesh(new THREE.BoxGeometry(spineW, H, D), brick);
    spine.position.set(W/2 - spineW/2, H/2, 0); bg.add(spine);
    const spineCor = new THREE.Mesh(new THREE.BoxGeometry(spineW + 0.25, 0.4, D + 0.25), pink);
    spineCor.position.set(W/2 - spineW/2, H - 0.2, 0); bg.add(spineCor);
    const spineRoof = new THREE.Mesh(new THREE.BoxGeometry(spineW + 0.35, 0.35, D + 0.35), roof);
    spineRoof.position.set(W/2 - spineW/2, H + 0.175, 0); bg.add(spineRoof);
    // Spine parapet (east face only — others share with wings)
    const sePara = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, D + 0.5), pink);
    sePara.position.set(W/2 + 0.1, H + 0.625, 0); bg.add(sePara);

    // ── Dense solar PV arrays on every roof (the building's signature) ──
    // Helper: lay out a grid of tilted panels over a roof area.
    function addSolarGrid(cx, cz, lenX, lenZ, rows, panelsPerRow) {
      const pW = lenX / panelsPerRow * 0.96;
      const pD = (lenZ / rows) * 0.7;
      for (let r = 0; r < rows; r++) {
        const z = cz - lenZ/2 + (r + 0.5) * (lenZ/rows);
        for (let i = 0; i < panelsPerRow; i++) {
          const x = cx - lenX/2 + (i + 0.5) * (lenX/panelsPerRow);
          const p = new THREE.Mesh(new THREE.BoxGeometry(pW, 0.08, pD), solar);
          p.position.set(x, H + 0.6, z);
          p.rotation.x = -Math.PI / 9;    // tilt south
          bg.add(p);
        }
      }
    }
    // Top wing: 2 rows × 14 panels
    addSolarGrid(0, topZ, W - 6, barD - 2, 2, 14);
    // Middle wing: 2 rows × 8 panels (shorter)
    addSolarGrid((W - midLen)/2, midZ, midLen - 4, barD - 2, 2, 8);
    // Bottom wing: 2 rows × 14 panels
    addSolarGrid(0, botZ, W - 6, barD - 2, 2, 14);
    // East spine: 1 row of small panels (much narrower)
    addSolarGrid(W/2 - spineW/2, 0, spineW - 1.5, D - barD*1.5, 1, 8);

    // ── White concrete pergola entrance (front of bottom wing) ──
    const pgW = 18, pgD = 4.5, pgH = 4.4;
    const pgZ = D/2 + pgD/2;
    // Top slab
    const pgTop = new THREE.Mesh(new THREE.BoxGeometry(pgW + 0.8, 0.45, pgD + 0.3), white);
    pgTop.position.set(0, pgH + 0.225, pgZ); bg.add(pgTop);
    // Horizontal beam pattern visible from below
    for (let i = 0; i < 5; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(pgW * 0.85, 0.15, 0.5), white);
      beam.position.set(0, pgH + 0.05, D/2 + 0.4 + i * 0.95); bg.add(beam);
    }
    // Vertical columns (2 rows × 6 cols)
    for (let i = 0; i < 6; i++) {
      const x = -pgW/2 + i * pgW/5;
      [0, pgD - 0.1].forEach(zo => {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.45, pgH, 0.45), white);
        col.position.set(x, pgH/2, D/2 + zo); bg.add(col);
      });
    }
    // "HEALTH CENTER" sign band (cream on dark)
    const signBg = new THREE.Mesh(new THREE.BoxGeometry(pgW * 0.4, 0.5, 0.05), dark);
    signBg.position.set(0, pgH - 0.5, D/2 + 0.06); bg.add(signBg);
    const signTrim = new THREE.Mesh(new THREE.BoxGeometry(pgW * 0.4 + 0.2, 0.6, 0.03), white);
    signTrim.position.set(0, pgH - 0.5, D/2 + 0.03); bg.add(signTrim);

    // ── Window grids on south wing face (front) ──
    function addWindows(cx, cz, len, faceSide, count) {
      // faceSide: +1 = +Z side, -1 = -Z side
      const fz = cz + faceSide * (barD/2 + 0.05);
      for (let c = 0; c < count; c++) {
        const x = cx - len/2 + (c + 0.5) * (len/count);
        const winW = 1.1, winH = 1.8;
        const fr = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.3, winH + 0.3, 0.05), pinkD);
        fr.position.set(x, H/2 + 0.3, fz); bg.add(fr);
        const win = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, 0.05), dark);
        win.position.set(x, H/2 + 0.3, fz + faceSide * 0.03); bg.add(win);
      }
    }
    // Front face of bottom wing (south, +Z)
    addWindows(-12, botZ, 28, +1, 9);
    addWindows(+18, botZ, 12, +1, 4);
    // Back face of top wing (north, -Z)
    addWindows(0, topZ, 50, -1, 14);
    // Courtyard faces of all wings (facing each other across the gardens)
    addWindows(-6, topZ, W - 14, +1, 12);   // top wing facing south (into courtyard)
    addWindows(0, midZ, midLen - 4, +1, 8);  // mid wing facing south
    addWindows(0, midZ, midLen - 4, -1, 8);  // mid wing facing north
    addWindows(-6, botZ, W - 14, -1, 12);    // bottom wing facing north (into courtyard)

    // ── Landscape courtyards (between wings on the west side) ──
    [topZ + barD/2, midZ + barD/2].forEach((zFrom) => {
      const zTo = zFrom + (D - 3*barD)/2;
      const cyCZ = (zFrom + zTo) / 2;
      const cyD = zTo - zFrom;
      // Courtyard floor (paved)
      const floor = new THREE.Mesh(new THREE.BoxGeometry(W - midLen - 4, 0.15, cyD), brickD);
      floor.position.set(-(W - midLen)/2 - 2, 0.075, cyCZ); bg.add(floor);
    });

    // ── Ground-level approach steps in front of pergola ──
    for (let i = 0; i < 3; i++) {
      const sw = pgW + 2 + i*0.6, sh = 0.34, sd = 0.9;
      const s = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), brickD);
      s.position.set(0, sh/2 + i*sh, D/2 + pgD + 1.5 + i*sd); g.add(s);
    }

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // CHANAKYA COMPLEX — IIT-J Administrative Block
  // ─────────────────────────────────────────────────────────────────────
  // Long low sandstone facade with a CURVED sloping roof cornice, a long
  // recessed entrance protected by a WHITE concrete portico made of two
  // tall columns supporting a series of horizontal beams. A small clock
  // tower rises above the main block, behind the portico (see photos).
  function buildChanakyaWing(opts = {}) {
    const length = opts.length ?? 38;
    const depth  = opts.depth  ?? 16;
    const height = opts.height ?? 12;
    const portal = opts.portal ?? true;
    // Which face the portico projects from: 'south' (+Z, default), 'east'
    // (+X), 'west' (-X), or 'north' (-Z). For wings that face an internal
    // courtyard (e.g. Office of Administration → faces Office of Students)
    // pass 'east' or 'west'.
    const portalSide = opts.portalSide ?? 'south';
    const g = new THREE.Group();

    // ── Main sandstone block
    const block = new THREE.Mesh(new THREE.BoxGeometry(length, height, depth), MAT.sandstone);
    block.position.set(0, height / 2, 0);
    g.add(block);

    // Three thin cream sandstone bands across the height for richness
    for (let i = 1; i <= 3; i++) {
      const y = height * i / 4;
      const band = new THREE.Mesh(new THREE.BoxGeometry(length + 0.06, 0.18, depth + 0.06), MAT.sandDark);
      band.position.set(0, y, 0);
      g.add(band);
    }

    // ── Curved sloping cornice — approximated by three stepped slabs of
    // decreasing width to evoke the curved roofline visible in the photo
    const corniceSteps = [
      { w: length + 0.6, h: 0.6,  yo: 0.0 },
      { w: length + 0.2, h: 0.45, yo: 0.55 },
      { w: length - 1.0, h: 0.45, yo: 1.0 },
    ];
    for (const cs of corniceSteps) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(cs.w, cs.h, depth + 0.6 - cs.yo * 0.4), MAT.portalWhite);
      slab.position.set(0, height + cs.yo + cs.h / 2, 0);
      g.add(slab);
    }

    // ── White entrance portico — two tall front columns + a row of
    // horizontal beams running the full portico width. Built in a sub-
    // group facing +Z, then translated to the requested face and rotated.
    if (portal) {
      const porticoG = new THREE.Group();
      const isShortFace = portalSide === 'east' || portalSide === 'west';
      const faceLen     = isShortFace ? depth : length;
      const PORT_H      = height + 0.5;
      // East/west face is shorter — fill more of it; long faces use a
      // proportional width capped at 22 m.
      const PORT_W      = isShortFace ? faceLen * 0.78 : Math.min(faceLen * 0.55, 22);
      const POST_W      = 1.4;
      const POST_D      = 1.4;
      const PROJ        = 4.5;                                   // metres projected outward
      const postZ       = PROJ - POST_D / 2;

      // Two structural posts
      [-PORT_W / 2, PORT_W / 2].forEach((px) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(POST_W, PORT_H, POST_D), MAT.portalWhite);
        post.position.set(px, PORT_H / 2, postZ);
        porticoG.add(post);
      });
      // Top capping beam
      const topBeam = new THREE.Mesh(new THREE.BoxGeometry(PORT_W + POST_W, 1.0, POST_D + 0.4), MAT.portalWhite);
      topBeam.position.set(0, PORT_H - 0.5, postZ);
      porticoG.add(topBeam);
      // Horizontal cross-beams
      for (let i = 0; i < 4; i++) {
        const beamY = PORT_H - 1.6 - i * 1.5;
        if (beamY < 2) break;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(PORT_W + 0.4, 0.3, 0.7), MAT.portalWhite);
        beam.position.set(0, beamY, postZ + 0.05);
        porticoG.add(beam);
      }
      // Soffit slab from facade out to the posts
      const soffit = new THREE.Mesh(new THREE.BoxGeometry(PORT_W + 0.4, 0.4, PROJ + 0.2), MAT.portalWhite);
      soffit.position.set(0, PORT_H - 0.1, PROJ / 2 - 0.1);
      porticoG.add(soffit);
      // Recessed dark door at the face origin
      const door = new THREE.Mesh(new THREE.BoxGeometry(PORT_W * 0.55, 5, 0.4), MAT.entrance);
      door.position.set(0, 2.5, 0.2);
      porticoG.add(door);

      // Position + rotate the portico group to the requested face
      if (portalSide === 'south') {
        porticoG.position.set(0, 0, depth / 2);
      } else if (portalSide === 'north') {
        porticoG.position.set(0, 0, -depth / 2);
        porticoG.rotation.y = Math.PI;
      } else if (portalSide === 'east') {
        porticoG.position.set(length / 2, 0, 0);
        porticoG.rotation.y = -Math.PI / 2;
      } else if (portalSide === 'west') {
        porticoG.position.set(-length / 2, 0, 0);
        porticoG.rotation.y = Math.PI / 2;
      }
      g.add(porticoG);
    }

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // IIT-J NAME CANOPY — curved sandstone arch in front of Chanakya
  // ─────────────────────────────────────────────────────────────────────
  // Standalone landmark: two thick sandstone columns supporting a curved
  // canopy carrying the "INDIAN INSTITUTE OF TECHNOLOGY JODHPUR" sign.
  // Sits in the courtyard space between OoA and OoS.
  function buildIITJNameCanopy() {
    const g = new THREE.Group();
    // Substantial archway spanning most of the OoA<->OoS plaza gap.
    const SPAN  = 28;                              // column-to-column distance
    const COL_W = 3.0, COL_D = 5.5, COL_H = 6.5;   // thick stone piers

    // Two thick sandstone columns
    [-SPAN / 2, SPAN / 2].forEach((x) => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(COL_W, COL_H, COL_D), MAT.sandstone);
      col.position.set(x, COL_H / 2, 0);
      g.add(col);
    });

    // Main canopy beam between the columns
    const CW = SPAN + COL_W + 2.0;                 // ≈ 33 m wide
    const CD = COL_D + 1.6;                        // ≈ 7 m deep
    const CH = 2.6;
    const cY = COL_H + CH / 2;
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(CW, CH, CD), MAT.sandstone);
    canopy.position.set(0, cY, 0);
    g.add(canopy);

    // Pink horizontal accent strips above and below the sign band
    const stripeTop = new THREE.Mesh(new THREE.BoxGeometry(CW + 0.06, 0.18, CD + 0.06), MAT.hostelBand);
    stripeTop.position.set(0, cY + 0.75, 0);
    g.add(stripeTop);
    const stripeBot = new THREE.Mesh(new THREE.BoxGeometry(CW + 0.06, 0.18, CD + 0.06), MAT.hostelBand);
    stripeBot.position.set(0, cY - 0.75, 0);
    g.add(stripeBot);
    // Dark inset band where the IITJ name sits
    const nameBand = new THREE.Mesh(new THREE.BoxGeometry(CW + 0.04, 0.85, CD + 0.04), MAT.sandDark);
    nameBand.position.set(0, cY, 0);
    g.add(nameBand);

    // Curved/arched top edge — four stepped slabs of decreasing width to
    // suggest the broad curve visible in the photo
    const archTopY = cY + CH / 2;
    const archSteps = [
      { w: CW - 1.0, h: 0.50 },
      { w: CW - 4.0, h: 0.45 },
      { w: CW - 8.0, h: 0.40 },
      { w: CW - 13.0, h: 0.35 },
    ];
    let ay = archTopY;
    for (const a of archSteps) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(Math.max(2, a.w), a.h, CD + 0.3), MAT.portalWhite);
      slab.position.set(0, ay + a.h / 2, 0);
      g.add(slab);
      ay += a.h;
    }

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // IITJ FOUNTAIN — circular sandstone basin + interlocking chrome rings
  // ─────────────────────────────────────────────────────────────────────
  function buildFountain() {
    const g = new THREE.Group();

    // Outer stone apron (tiled paving look) — ~15 m diameter per satellite
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 0.15, 56), MAT.sandTop);
    apron.position.y = 0.075;
    g.add(apron);
    const apronEdge = new THREE.Mesh(new THREE.TorusGeometry(7.5 - 0.05, 0.12, 8, 56), MAT.brick);
    apronEdge.position.y = 0.15;
    apronEdge.rotation.x = Math.PI / 2;
    g.add(apronEdge);

    // Sandstone basin — ~8 m outer diameter per satellite
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 4.1, 0.95, 56), MAT.sandstone);
    basin.position.y = 0.475 + 0.15;
    g.add(basin);
    // Basin top coping ring
    const basinTop = new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.22, 10, 56), MAT.sandDark);
    basinTop.position.y = 1.0;
    basinTop.rotation.x = Math.PI / 2;
    g.add(basinTop);

    // Water surface inside the basin
    const water = new THREE.Mesh(new THREE.CylinderGeometry(3.55, 3.55, 0.05, 48), MAT.water);
    water.position.y = 0.9;
    g.add(water);

    // ── Sculpture: interlocking polished chrome rings (per reference photo)
    // Two large vertical tori at perpendicular axes form the dramatic
    // intertwined silhouette; a third smaller diagonal ring adds richness.
    const baseY  = 1.0;       // top of basin
    const RING_R = 1.7;       // major radius of each ring
    const TUBE_R = 0.22;      // tube thickness
    const ringCenterY = baseY + RING_R + 0.2;

    // Ring 1 — main vertical ring, slight forward tilt
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(RING_R, TUBE_R, 10, 36), MAT.chromeSculp);
    r1.position.y = ringCenterY;
    r1.rotation.x = Math.PI / 2;            // stand it vertically
    r1.rotation.y = Math.PI / 14;           // tilt around vertical
    g.add(r1);

    // Ring 2 — perpendicular vertical ring (interlocking with ring 1)
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(RING_R, TUBE_R, 10, 36), MAT.chromeSculp);
    r2.position.y = ringCenterY;
    r2.rotation.x = Math.PI / 2;
    r2.rotation.y = Math.PI / 2 - Math.PI / 14;
    g.add(r2);

    // Ring 3 — smaller diagonal ring tying the composition together
    const r3 = new THREE.Mesh(new THREE.TorusGeometry(RING_R * 0.78, TUBE_R, 10, 32), MAT.chromeSculp);
    r3.position.y = ringCenterY - 0.4;
    r3.rotation.x = Math.PI / 3;            // tilted off-vertical
    r3.rotation.z = Math.PI / 4;
    g.add(r3);

    // Small chrome base at the pool floor anchoring the rings
    const anchor = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.4, 16), MAT.chromeSculp);
    anchor.position.y = baseY + 0.1;
    g.add(anchor);

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // PRITHVI MISSILE — upright missile on a low pedestal with garden walls
  // ─────────────────────────────────────────────────────────────────────
  // ── Procedural builder: T-72 Ajeya Display Tank ──────────────────────
  // OSM way 1412392546 — concrete pedestal near the south main entrance.
  // Tank model oriented with gun barrel pointing along +X (east). The
  // bearingOffset in the LANDMARKS entry rotates it to face the road.
  // All units metres. Hull dimensions based on T-72 spec:
  //   hull 6.9m × 3.46m × 2.1m (inc. track skirts), gun ~6.8m above deck.
  function buildTank() {
    const g = new THREE.Group();

    const PEDESTAL_H = 0.65;
    const PEDESTAL_L = 13.0;
    const PEDESTAL_W = 7.0;

    // Concrete pedestal — lower wide base step
    const pedBase = new THREE.Mesh(new THREE.BoxGeometry(PEDESTAL_L + 1.2, 0.28, PEDESTAL_W + 1.2), MAT.tankPed);
    pedBase.position.y = 0.14;
    g.add(pedBase);
    // Main pedestal slab
    const ped = new THREE.Mesh(new THREE.BoxGeometry(PEDESTAL_L, PEDESTAL_H, PEDESTAL_W), MAT.tankPed);
    ped.position.y = 0.28 + PEDESTAL_H / 2;
    g.add(ped);
    // Pedestal top chamfer strip (darker border)
    const chamfer = new THREE.Mesh(new THREE.BoxGeometry(PEDESTAL_L + 0.15, 0.10, PEDESTAL_W + 0.15), MAT.sandDark);
    chamfer.position.y = 0.28 + PEDESTAL_H;
    g.add(chamfer);

    const BY = PEDESTAL_H; // base Y of tank bottom

    // ── Hull ──────────────────────────────────────────────────────
    const HULL_L  = 6.9;
    const HULL_W  = 3.46;
    const HULL_H  = 1.8;

    // Lower hull box (olive green)
    const hull = new THREE.Mesh(new THREE.BoxGeometry(HULL_L, HULL_H, HULL_W), MAT.tankOlive);
    hull.position.set(0, BY + HULL_H / 2, 0);
    g.add(hull);

    // Front glacis plate — sloped sand/tan panel
    const GLACIS_L = 1.8, GLACIS_H = 1.5;
    const glacis = new THREE.Mesh(new THREE.BoxGeometry(GLACIS_L, GLACIS_H, HULL_W - 0.1), MAT.tankSand);
    glacis.rotation.z = Math.PI * 0.24;       // ~43° slope
    glacis.position.set(HULL_L / 2 + 0.1, BY + 0.85, 0);
    g.add(glacis);

    // Rear hull overhang
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.5, HULL_H, HULL_W), MAT.tankOlive);
    rear.position.set(-HULL_L / 2 - 0.15, BY + HULL_H / 2, 0);
    g.add(rear);

    // Hull roof plate (slightly lighter sand tone)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(HULL_L + 0.3, 0.15, HULL_W + 0.1), MAT.tankSand);
    roof.position.set(0, BY + HULL_H + 0.07, 0);
    g.add(roof);

    // Side skirts (armour panels above tracks)
    const SKIRT_L = HULL_L - 0.2;
    for (const side of [-1, 1]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(SKIRT_L, 0.5, 0.15), MAT.tankOlive);
      skirt.position.set(-0.1, BY + HULL_H - 0.25, side * (HULL_W / 2 + 0.12));
      g.add(skirt);
    }

    // ── Tracks ────────────────────────────────────────────────────
    const TRACK_W = 0.55;
    for (const side of [-1, 1]) {
      // Lower track run (flat box under hull)
      const trackBottom = new THREE.Mesh(
        new THREE.BoxGeometry(HULL_L + 1.2, 0.18, TRACK_W), MAT.tankTrack);
      trackBottom.position.set(-0.1, BY + 0.09, side * (HULL_W / 2 + TRACK_W / 2 - 0.05));
      g.add(trackBottom);
      // Upper track run (thin strip visible above road wheels)
      const trackTop = new THREE.Mesh(
        new THREE.BoxGeometry(HULL_L + 0.6, 0.12, TRACK_W), MAT.tankTrack);
      trackTop.position.set(-0.1, BY + HULL_H - 0.06, side * (HULL_W / 2 + TRACK_W / 2 - 0.05));
      g.add(trackTop);
    }

    // ── Road wheels (5 per side, matching photo) ─────────────────
    const WHEEL_R  = 0.27;
    const WHEEL_TH = 0.28;   // axle-direction thickness
    // X positions along hull (evenly-ish spaced, front → rear)
    const wheelXs  = [2.4, 1.2, 0.0, -1.2, -2.4];
    for (const wx of wheelXs) {
      for (const side of [-1, 1]) {
        const wz = side * (HULL_W / 2 + WHEEL_TH / 2 - 0.02);
        const wy = BY + WHEEL_R;
        // Outer rim — gold/yellow torus-like cylinder
        const rim = new THREE.Mesh(
          new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_TH, 20),
          MAT.tankWheel);
        rim.rotation.x = Math.PI / 2;     // cylinder axis → Z (hull-width direction)
        rim.position.set(wx, wy, wz);
        g.add(rim);
        // Inner hole (slightly smaller dark cylinder to fake hollow spoke area)
        const inner = new THREE.Mesh(
          new THREE.CylinderGeometry(WHEEL_R * 0.6, WHEEL_R * 0.6, WHEEL_TH + 0.02, 16),
          MAT.tankTrack);
        inner.rotation.x = Math.PI / 2;
        inner.position.set(wx, wy, wz);
        g.add(inner);
        // Red hub cap (centre disc)
        const hub = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.09, WHEEL_TH + 0.04, 12),
          MAT.tankHub);
        hub.rotation.x = Math.PI / 2;
        hub.position.set(wx, wy, wz);
        g.add(hub);
      }
    }

    // Drive sprocket (rear, larger toothed wheel)
    for (const side of [-1, 1]) {
      const sprocket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, WHEEL_TH, 16), MAT.tankOlive);
      sprocket.rotation.x = Math.PI / 2;
      sprocket.position.set(-HULL_L / 2 - 0.4, BY + 0.32, side * (HULL_W / 2 + WHEEL_TH / 2));
      g.add(sprocket);
    }
    // Idler wheel (front)
    for (const side of [-1, 1]) {
      const idler = new THREE.Mesh(
        new THREE.CylinderGeometry(0.30, 0.30, WHEEL_TH, 16), MAT.tankSand);
      idler.rotation.x = Math.PI / 2;
      idler.position.set(HULL_L / 2 + 0.4, BY + 0.30, side * (HULL_W / 2 + WHEEL_TH / 2));
      g.add(idler);
    }

    // ── Turret ────────────────────────────────────────────────────
    // T-72 turret: rounded ovoid, sand on sides, dark red on top dome.
    // Position: slightly forward of hull centre.
    const TURRET_Y = BY + HULL_H + 0.14;
    const TURRET_CX = 0.5;   // forward offset

    // Lower turret ring / collar
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.4, 0.28, 24), MAT.tankSand);
    collar.position.set(TURRET_CX, TURRET_Y + 0.14, 0);
    g.add(collar);

    // Main turret body — box base with rounded ends
    const tBody = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.65, 2.3), MAT.tankSand);
    tBody.position.set(TURRET_CX, TURRET_Y + 0.28 + 0.32, 0);
    g.add(tBody);

    // Turret front slope (sloped sand armour)
    const tFront = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 2.2), MAT.tankSand);
    tFront.rotation.z = Math.PI * 0.18;
    tFront.position.set(TURRET_CX + 1.2, TURRET_Y + 0.55, 0);
    g.add(tFront);

    // Turret dome top (dark red hemisphere approximation using squashed sphere)
    const tDome = new THREE.Mesh(
      new THREE.SphereGeometry(1.18, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      MAT.tankRed);
    tDome.scale.set(1.2, 0.55, 1.05);
    tDome.position.set(TURRET_CX, TURRET_Y + 0.28 + 0.65, 0);
    g.add(tDome);

    // Gunner's cupola (small cylinder on turret top-right)
    const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.30, 16), MAT.tankOlive);
    cupola.position.set(TURRET_CX - 0.3, TURRET_Y + 1.25, 0.6);
    g.add(cupola);
    const cupolid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 16), MAT.tankOlive);
    cupolid.position.set(TURRET_CX - 0.3, TURRET_Y + 1.42, 0.6);
    g.add(cupolid);

    // ── Main gun barrel ───────────────────────────────────────────
    // From photo: dark teal body, sand/tan thermal sleeve over the middle,
    // and a distinctive RED muzzle cap at the tip. Gun points along +X.
    const GUN_L   = 7.0;
    const GUN_ELV = Math.PI / 70;    // slight upward elevation (~2.5°)
    const GUN_Y   = TURRET_Y + 0.72;
    const GUN_OX  = TURRET_CX + 1.4; // starts at turret front face

    const barrelGroup = new THREE.Group();
    barrelGroup.position.set(GUN_OX + GUN_L / 2, GUN_Y, 0);
    barrelGroup.rotation.z = -GUN_ELV;

    // Full barrel (dark teal/green)
    const barrelMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.100, 0.112, GUN_L, 14), MAT.tankBarrel);
    barrelMesh.rotation.z = Math.PI / 2;
    barrelGroup.add(barrelMesh);

    // Thermal sleeve — slightly wider, sand/tan, covers the rear ~55%
    const SLEEVE_L = GUN_L * 0.52;
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.130, 0.130, SLEEVE_L, 14), MAT.tankSand);
    sleeve.rotation.z = Math.PI / 2;
    sleeve.position.x = -GUN_L / 2 + SLEEVE_L / 2;  // rear half
    barrelGroup.add(sleeve);

    // RED muzzle cap — the very distinctive red tip visible in photos
    const muzzleCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.130, 0.110, 0.45, 14), MAT.tankMuzzle);
    muzzleCap.rotation.z = Math.PI / 2;
    muzzleCap.position.x = GUN_L / 2 + 0.22;
    barrelGroup.add(muzzleCap);

    g.add(barrelGroup);

    // ── Indian flag on a small pole atop the turret ───────────────
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.0, 8), MAT.tankBarrel);
    pole.position.set(TURRET_CX + 0.1, TURRET_Y + 1.2 + 1.0, -0.2);
    g.add(pole);
    // Saffron, white, green stripes
    const flagColors = [MAT.saffron, MAT.portalWhite, MAT.grass];
    for (let i = 0; i < 3; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.20, 0.02), flagColors[i]);
      stripe.position.set(TURRET_CX + 0.1 + 0.32, TURRET_Y + 1.2 + 2.0 - i * 0.21, -0.2);
      g.add(stripe);
    }

    return g;
  }

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

  // ─────────────────────────────────────────────────────────────────────
  // DEPARTMENT BUILDING — uniform academic block design
  // ─────────────────────────────────────────────────────────────────────
  // The Physics / Mechanical / Metallurgical / Civil / Electrical /
  // Chemistry departments share one architectural template (per the
  // front-view and satellite photos):
  //
  //   • H-shaped footprint: two tall side wings running front-to-back
  //     plus a connecting spine across the middle. Courtyard pockets on
  //     each side of the spine.
  //   • Library-sandstone walls (warm beige, same palette as the main
  //     library), slim sandstone string-course at first-floor level
  //   • The central front facade is RECESSED between the two side wings;
  //     a cream-white concrete portico (two columns supporting horizontal
  //     and angled cross-beams — pergola look) stands in front of a tall
  //     light-teal glass curtain wall that lights the central atrium
  //   • Small parapet "vent" caps along the top of the central pavilion
  //   • Discreet jali (stone-screen) panels on the wings' outer side
  //     walls, narrow vertical windows in groups along each wing
  //   • Flat roof with small parapet wall + low-profile solar arrays on
  //     each wing
  //
  // Mesh-local axes: +X right (E-W facade width), +Y up, +Z = entrance
  // direction. Build is centred on (0,0,0) at ground; caller positions/
  // rotates via the landmark cfg (lng/lat + bearingOffset).
  function buildDepartmentBuilding(opts = {}) {
    const length   = opts.length      ?? 50;   // facade width (X)
    const bboxD    = opts.bboxDepth   ?? 48;   // total front-back depth (Z)
    const wingW    = opts.wingWidth   ?? 13;   // each side wing's width in X
    const spineD   = opts.spineDepth  ?? 14;   // central spine depth in Z
    const height   = opts.height      ?? 16;   // 4 storeys × ~4 m
    const pavH     = opts.pavilionHeight ?? 17.5;  // taller central pavilion

    const g = new THREE.Group();

    // ── Plinth (thin sandstone base running under everything)
    const plinthH = 0.55;
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(length + 0.6, plinthH, bboxD + 0.6),
      MAT.deptStoneLight
    );
    plinth.position.set(0, plinthH / 2, 0);
    g.add(plinth);

    // ── Two side wings (left + right) — long in Z, narrow in X.
    // Side wings extend from -bboxD/2 to +bboxD/2 in Z (the full N-S extent).
    const wingBodyH = height - plinthH;
    const wingFrontZ = bboxD / 2;                // wing front face
    const wingBackZ  = -bboxD / 2;
    const leftX  = -length / 2 + wingW / 2;
    const rightX =  length / 2 - wingW / 2;
    [leftX, rightX].forEach((cx) => {
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(wingW, wingBodyH, bboxD),
        MAT.deptStone
      );
      wing.position.set(cx, plinthH + wingBodyH / 2, 0);
      g.add(wing);

      // Darker sandstone coping at the very top
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(wingW + 0.1, 0.45, bboxD + 0.1),
        MAT.deptStoneDark
      );
      cap.position.set(cx, height - 0.225, 0);
      g.add(cap);

      // Slim string-course between 1st and 2nd floor
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(wingW + 0.08, 0.18, bboxD + 0.08),
        MAT.deptStoneLight
      );
      band.position.set(cx, plinthH + wingBodyH * 0.27, 0);
      g.add(band);

      // A second slim band higher up (between 3rd and 4th floor)
      const band2 = new THREE.Mesh(
        new THREE.BoxGeometry(wingW + 0.08, 0.14, bboxD + 0.08),
        MAT.deptStoneLight
      );
      band2.position.set(cx, plinthH + wingBodyH * 0.78, 0);
      g.add(band2);
    });

    // ── Central spine connecting the two wings (the bar of the H).
    // Runs in X across the middle, Z-depth = spineD, height = main height.
    const spineW = length - 2 * wingW;
    const spineFrontZ = spineD / 2;
    const spineBackZ  = -spineD / 2;
    const spine = new THREE.Mesh(
      new THREE.BoxGeometry(spineW, wingBodyH, spineD),
      MAT.deptStone
    );
    spine.position.set(0, plinthH + wingBodyH / 2, 0);
    g.add(spine);
    const spineCap = new THREE.Mesh(
      new THREE.BoxGeometry(spineW + 0.1, 0.45, spineD + 0.1),
      MAT.deptStoneDark
    );
    spineCap.position.set(0, height - 0.225, 0);
    g.add(spineCap);
    // Spine string-courses (match wings)
    [0.27, 0.78].forEach((frac, i) => {
      const sb = new THREE.Mesh(
        new THREE.BoxGeometry(spineW + 0.08, i === 0 ? 0.18 : 0.14, spineD + 0.08),
        MAT.deptStoneLight
      );
      sb.position.set(0, plinthH + wingBodyH * frac, 0);
      g.add(sb);
    });

    // ── Central pavilion — a slightly taller volume rising above the
    // spine, sandwiched between the two wings. This is what's visible in
    // the front photos as the "tall middle block" with parapet caps.
    const pavilion = new THREE.Mesh(
      new THREE.BoxGeometry(spineW, pavH - height, spineD),
      MAT.deptStone
    );
    pavilion.position.set(0, height + (pavH - height) / 2, 0);
    g.add(pavilion);
    const pavCap = new THREE.Mesh(
      new THREE.BoxGeometry(spineW + 0.2, 0.45, spineD + 0.2),
      MAT.deptStoneDark
    );
    pavCap.position.set(0, pavH - 0.225, 0);
    g.add(pavCap);

    // Four small parapet "vent" boxes along the pavilion top (the little
    // square caps visible above the central facade in the photos).
    const ventCount = 4;
    for (let i = 0; i < ventCount; i++) {
      const vx = -spineW / 2 + spineW * (i + 0.5) / ventCount;
      const vent = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.9, spineD - 2),
        MAT.deptStoneLight
      );
      vent.position.set(vx, pavH + 0.45, 0);
      g.add(vent);
    }

    // ── Tall glass curtain wall on the central pavilion's south face
    //    (lights the central atrium). Light teal, NOT near-black.
    const curtainW = spineW - 2.0;
    const curtainH = pavH - plinthH - 1.0;
    const curtain = new THREE.Mesh(
      new THREE.BoxGeometry(curtainW, curtainH, 0.25),
      MAT.deptGlass
    );
    curtain.position.set(0, plinthH + curtainH / 2 + 0.4, spineFrontZ + 0.13);
    g.add(curtain);

    // Vertical mullions on the curtain wall (the iconic vertical-strip look)
    const mullionMat = MAT.deptConcrete;
    const mullCount = 7;
    for (let i = 0; i < mullCount; i++) {
      const mx = -curtainW / 2 + (curtainW / (mullCount - 1)) * i;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, curtainH - 0.4, 0.15),
        mullionMat
      );
      m.position.set(mx, plinthH + curtainH / 2 + 0.4, spineFrontZ + 0.27);
      g.add(m);
    }
    // Two horizontal cross-bars dividing the curtain into 3 stacked panels
    [0.34, 0.68].forEach((frac) => {
      const xb = new THREE.Mesh(
        new THREE.BoxGeometry(curtainW - 0.2, 0.18, 0.15),
        mullionMat
      );
      xb.position.set(0, plinthH + curtainH * frac + 0.4, spineFrontZ + 0.27);
      g.add(xb);
    });

    // ── Portico — two cream-white columns standing in front of the
    //    curtain wall, supporting horizontal beams + angled cross-beams
    //    (the pergola/trellis structure visible in the front photos).
    const colH       = pavH - 1.8;
    const colW       = 1.4;
    const colD       = 1.4;
    const colSpan    = curtainW * 0.78;       // distance between the columns
    const porticoZ   = wingFrontZ - 1.6;       // sits in the recess
    [-colSpan / 2, colSpan / 2].forEach((cx) => {
      const col = new THREE.Mesh(
        new THREE.BoxGeometry(colW, colH, colD),
        MAT.deptConcrete
      );
      col.position.set(cx, plinthH + colH / 2, porticoZ);
      g.add(col);
    });
    // Top horizontal beam tying the columns together
    const beamY = plinthH + colH - 0.8;
    const topBeam = new THREE.Mesh(
      new THREE.BoxGeometry(colSpan + colW, 0.9, colD),
      MAT.deptConcrete
    );
    topBeam.position.set(0, beamY, porticoZ);
    g.add(topBeam);
    // Angled cross-beams projecting back from the top beam toward the
    // curtain wall (the slanted pergola rafters in the photos).
    const rafterLen = porticoZ - spineFrontZ + 0.4;
    const rafterCount = 5;
    for (let i = 0; i < rafterCount; i++) {
      const rx = -colSpan / 2 + (colSpan / (rafterCount - 1)) * i;
      const rafter = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.35, rafterLen),
        MAT.deptConcrete
      );
      rafter.position.set(rx, beamY + 0.65, porticoZ - rafterLen / 2 + 0.45);
      // Slight downward tilt toward the curtain wall (gives sun-shade look)
      rafter.rotation.x = -0.12;
      g.add(rafter);
    }
    // A second, lower horizontal beam between the columns (the photos show
    // a double-beam portico)
    const lowBeam = new THREE.Mesh(
      new THREE.BoxGeometry(colSpan + colW, 0.45, colD * 0.7),
      MAT.deptConcrete
    );
    lowBeam.position.set(0, beamY - 1.3, porticoZ + 0.1);
    g.add(lowBeam);

    // ── Ground-level entrance: small glass door under the portico, plus
    //    a couple of stair-treads in front of it.
    const doorW = 3.2;
    const doorH = 2.8;
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(doorW, doorH, 0.2),
      MAT.deptDoor
    );
    door.position.set(0, plinthH + doorH / 2, spineFrontZ + 0.32);
    g.add(door);
    // Light frame around the door
    const frameMat = MAT.deptWinFrame;
    [-doorW / 2, doorW / 2].forEach((dx) => {
      const jamb = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, doorH + 0.2, 0.25),
        frameMat
      );
      jamb.position.set(dx, plinthH + (doorH + 0.2) / 2, spineFrontZ + 0.33);
      g.add(jamb);
    });
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(doorW + 0.3, 0.18, 0.25),
      frameMat
    );
    lintel.position.set(0, plinthH + doorH + 0.15, spineFrontZ + 0.33);
    g.add(lintel);
    // Two stair-treads in front of the door
    for (let i = 0; i < 2; i++) {
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(doorW + 1.6 - i * 0.4, 0.18, 0.6),
        MAT.deptStoneLight
      );
      step.position.set(0, 0.09 + i * 0.18, spineFrontZ + 0.6 + i * 0.4);
      g.add(step);
    }

    // ── Wing front facades — recessed rectangular windows arranged in a
    //    regular grid (matches the photos: clean modern punched windows
    //    rather than narrow vertical strips).
    const winMat = MAT.deptGlass;
    const winFrameMat = MAT.deptStoneLight;
    const winW = 1.6;
    const winH = 1.5;
    const floors = 4;
    const floorH = wingBodyH / floors;
    [
      { cx: leftX,  faceZ: wingFrontZ + 0.01, dir: 1 },
      { cx: rightX, faceZ: wingFrontZ + 0.01, dir: 1 },
      { cx: leftX,  faceZ: wingBackZ - 0.01,  dir: -1 },
      { cx: rightX, faceZ: wingBackZ - 0.01,  dir: -1 },
    ].forEach(({ cx, faceZ }) => {
      // 1 window per floor (the wings are narrow in X so just one column)
      for (let f = 0; f < floors; f++) {
        const wy = plinthH + floorH * (f + 0.5);
        // Frame surround
        const fr = new THREE.Mesh(
          new THREE.BoxGeometry(winW + 0.3, winH + 0.3, 0.1),
          winFrameMat
        );
        fr.position.set(cx, wy, faceZ);
        g.add(fr);
        const w = new THREE.Mesh(
          new THREE.BoxGeometry(winW, winH, 0.15),
          winMat
        );
        w.position.set(cx, wy, faceZ);
        g.add(w);
      }
    });

    // ── Side-facing facades of the wings — recessed jali (stone screen)
    //    panels. Each wing's outer side wall has 4 floors of jali grids.
    const jaliMat = MAT.deptStoneDark;
    [
      { x: -length / 2 - 0.02, sgn: -1 },                    // left wing's left face
      { x:  length / 2 + 0.02, sgn:  1 },                    // right wing's right face
    ].forEach(({ x }) => {
      for (let f = 0; f < floors; f++) {
        const wy = plinthH + floorH * (f + 0.5);
        const panelZSpan = bboxD * 0.7;
        // Panels arranged along Z, one per "bay" in the wing
        const bays = 3;
        for (let b = 0; b < bays; b++) {
          const z = -panelZSpan / 2 + panelZSpan * (b + 0.5) / bays;
          const jali = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, floorH * 0.7, panelZSpan / bays - 0.6),
            jaliMat
          );
          jali.position.set(x, wy, z);
          g.add(jali);
        }
      }
    });

    // ── Side-facing windows on the spine ends (the gable strips that
    //    connect the wings — visible as small windows on the sides of the
    //    pavilion in the photos)
    [
      { x: -spineW / 2 - 0.01, sgn: -1 },
      { x:  spineW / 2 + 0.01, sgn:  1 },
    ].forEach(({ x }) => {
      for (let f = 0; f < floors; f++) {
        const wy = plinthH + floorH * (f + 0.5);
        const w = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, winH * 0.8, 1.2),
          winMat
        );
        w.position.set(x, wy, 0);
        g.add(w);
      }
    });

    // ── Wing roof parapets (low sandstone walls around each wing roof)
    [leftX, rightX].forEach((cx) => {
      const parH = 0.55;
      // Four parapet edges per wing
      const fr = new THREE.Mesh(new THREE.BoxGeometry(wingW + 0.1, parH, 0.25), MAT.deptStoneLight);
      fr.position.set(cx, height + parH / 2, wingFrontZ - 0.12);
      g.add(fr);
      const bk = new THREE.Mesh(new THREE.BoxGeometry(wingW + 0.1, parH, 0.25), MAT.deptStoneLight);
      bk.position.set(cx, height + parH / 2, wingBackZ + 0.12);
      g.add(bk);
    });

    // ── Low-profile solar arrays on each wing roof (not so prominent
    //    they dominate the view).
    function addSolarPad(centerX, centerZ, spanX, spanZ) {
      const sheet = new THREE.Mesh(
        new THREE.BoxGeometry(spanX, 0.10, spanZ),
        MAT.deptSolar
      );
      sheet.position.set(centerX, height + 0.18, centerZ);
      sheet.rotation.x = -0.10;
      g.add(sheet);
    }
    // Two rows of panels per wing (front half + back half)
    [leftX, rightX].forEach((cx) => {
      addSolarPad(cx, bboxD * 0.22, wingW - 2, bboxD * 0.32);
      addSolarPad(cx, -bboxD * 0.22, wingW - 2, bboxD * 0.32);
    });

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────
  // SHAMIYANA FOOD COURT — shipping-container restaurants laid out around
  // a central open-air plaza, with concrete tube seating pods along the
  // west edge, two tensile-fabric shade canopies, and a small round
  // amphitheatre stage. Each restaurant has its own GeoJSON polygon in
  // places.geojson; this builder draws all of them as one mesh and the
  // LANDMARKS entry uses `replacesOsmBuildings` to hide the plain
  // extrusions so we don't double up.
  //
  // Layout offsets (E = east, N = north, both in metres from the OSM
  // 'Shamiyana' POI) and long-edge bearings come from the polygon
  // centroids — computed once offline and hard-coded here.
  // Mesh convention: +X = east, +Y = up, -Z = north.
  // ─────────────────────────────────────────────────────────────────────
  function buildShamiyanaComplex() {
    const g = new THREE.Group();

    // Local palette — kept inside the builder so we don't pollute MAT for
    // a one-off model. Colours sampled from the on-site drone photos.
    const M = {
      cBlue:    new THREE.MeshStandardMaterial({ color: 0x2c6da8, metalness: 0.20, roughness: 0.60 }),
      cRed:     new THREE.MeshStandardMaterial({ color: 0x8a2a2a, metalness: 0.20, roughness: 0.60 }),
      cYellow:  new THREE.MeshStandardMaterial({ color: 0xe8b430, metalness: 0.20, roughness: 0.55 }),
      cOrange:  new THREE.MeshStandardMaterial({ color: 0xd2622a, metalness: 0.20, roughness: 0.58 }),
      cPink:    new THREE.MeshStandardMaterial({ color: 0xc8636c, metalness: 0.20, roughness: 0.58 }),
      roofRust: new THREE.MeshStandardMaterial({ color: 0x6c3a26, metalness: 0.25, roughness: 0.70 }),
      roofGalv: new THREE.MeshStandardMaterial({ color: 0xd7d5c8, metalness: 0.45, roughness: 0.45 }),
      fabric:   new THREE.MeshStandardMaterial({ color: 0xefe6d2, metalness: 0.02, roughness: 0.95, side: THREE.DoubleSide }),
      pole:     new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.35, roughness: 0.55 }),
      door:     new THREE.MeshStandardMaterial({ color: 0x1f1f22, metalness: 0.30, roughness: 0.55 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0xb5b0a3, metalness: 0.04, roughness: 0.92 }),
      // Base is GREEN + WHITE only (per the real food court). Paving is a
      // clean white concrete that blends with the #fafafa basemap; grass
      // is a clear lawn green. No tan/beige — pavingD is now a light grey
      // so accent edges stay in the white family.
      paving:   new THREE.MeshStandardMaterial({ color: 0xf4f4f1, metalness: 0.03, roughness: 0.90 }),
      pavingD:  new THREE.MeshStandardMaterial({ color: 0xd9d7cf, metalness: 0.04, roughness: 0.92 }),
      grass:    new THREE.MeshStandardMaterial({ color: 0x8cb85c, metalness: 0.02, roughness: 0.96 }),
      // New: container detailing
      deck:     new THREE.MeshStandardMaterial({ color: 0xb5a98f, metalness: 0.04, roughness: 0.88 }),
      deckEdge: new THREE.MeshStandardMaterial({ color: 0x7d6e54, metalness: 0.04, roughness: 0.90 }),
      glass:    new THREE.MeshStandardMaterial({ color: 0x7ea3b8, metalness: 0.55, roughness: 0.25, side: THREE.DoubleSide }),
      frame:    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.40, roughness: 0.45 }),
      rail:     new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.50, roughness: 0.40 }),
      step:     new THREE.MeshStandardMaterial({ color: 0x3d3d3d, metalness: 0.30, roughness: 0.55 }),
      signBand: new THREE.MeshStandardMaterial({ color: 0x1f1f22, metalness: 0.25, roughness: 0.55 }),
      planter:  new THREE.MeshStandardMaterial({ color: 0x6b4a2f, metalness: 0.05, roughness: 0.90 }),
      hedge:    new THREE.MeshStandardMaterial({ color: 0x6f9853, metalness: 0.02, roughness: 0.95, flatShading: true }),
      wood:     new THREE.MeshStandardMaterial({ color: 0xa67746, metalness: 0.05, roughness: 0.85 }),
      podInt: (hex) => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.10, roughness: 0.70, side: THREE.DoubleSide }),
    };

    // Single shipping-container restaurant. (E,N) is the centroid offset
    // from the Shamiyana POI; bearingDeg is the long-edge bearing
    // (0 = north, 90 = east). Width is along the long edge.
    //
    // Each container now ships with:
    //   • a wooden deck platform extending in front of the door
    //   • a dark sign-band strip below the roof (where the brand name sits)
    //   • a metal-framed front door
    //   • two windows on the long face (skipped for the tiny <5m containers)
    //   • a stair + upper railing for 2-storey blocks (e.g. Baap of Rolls)
    function placeContainer({ E, N, w, d, bearingDeg, body, roof, stories = 1, sign = null }) {
      const c = new THREE.Group();
      const H = 2.7 * stories;

      // Body
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), body);
      box.position.y = H / 2;
      c.add(box);

      // Dark sign-band strip running the full width just under the roof
      // (so each container reads as a branded food-court unit, not a
      // bare cube). 0.55 m tall, sits proud of the wall by 2 cm.
      const bandH = 0.55;
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, bandH, d + 0.06), M.signBand);
      band.position.y = H - bandH / 2 - 0.05;
      c.add(band);

      // Roof with a more pronounced overhang on the front (deck side)
      const roofMesh = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.18, d + 1.0), roof);
      roofMesh.position.set(0, H + 0.09, 0.25);
      c.add(roofMesh);
      // Thin dark fascia under the roof front edge
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.08, 0.06), M.signBand);
      fascia.position.set(0, H + 0.04, 0.25 + (d + 1.0) / 2);
      c.add(fascia);

      // Wooden deck extending in front of the door (south-facing side)
      const deckW = w + 0.2;
      const deckD = 1.6;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.12, deckD), M.deck);
      deck.position.set(0, 0.06, d / 2 + deckD / 2);
      c.add(deck);
      // Dark deck edge trim (subtle shadow line under the boards)
      const deckTrim = new THREE.Mesh(new THREE.BoxGeometry(deckW + 0.06, 0.04, deckD + 0.06), M.deckEdge);
      deckTrim.position.set(0, 0.015, d / 2 + deckD / 2);
      c.add(deckTrim);

      // Metal-framed front door (centred on the long face)
      const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.05, 0.04), M.frame);
      doorFrame.position.set(0, 1.025, d / 2 + 0.022);
      c.add(doorFrame);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.92, 0.05), M.door);
      door.position.set(0, 1.0, d / 2 + 0.05);
      c.add(door);

      // Windows on the long front face — two per container, skipped on
      // the smallest huts (under 5 m wide)
      if (w >= 5) {
        const winY = stories === 2 ? H * 0.72 : 1.85;
        const offsets = w >= 9 ? [-w / 2 + 1.7, w / 2 - 1.7] : [-w / 3, w / 3];
        // Hide windows that overlap the door (within 0.9 m of centre)
        for (const wx of offsets) {
          if (Math.abs(wx) < 0.9) continue;
          const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.72, 0.04), M.frame);
          winFrame.position.set(wx, winY, d / 2 + 0.025);
          c.add(winFrame);
          const winGlass = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.6, 0.03), M.glass);
          winGlass.position.set(wx, winY, d / 2 + 0.05);
          c.add(winGlass);
        }
        // Lower row for 2-storey blocks (ground-floor windows)
        if (stories === 2) {
          for (const wx of offsets) {
            if (Math.abs(wx) < 0.9) continue;
            const lowGlass = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.6, 0.03), M.glass);
            lowGlass.position.set(wx, 1.4, d / 2 + 0.05);
            c.add(lowGlass);
          }
        }
      }

      // External staircase + upper railing for 2-storey blocks
      if (stories === 2) {
        // 5-step zigzag stair against the right end of the container,
        // running down to deck level.
        const stairX = w / 2 - 0.6;
        const stairSteps = 5;
        for (let i = 0; i < stairSteps; i++) {
          const stepY = 0.3 + i * (H / 2 - 0.3) / (stairSteps - 1);
          const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.32), M.step);
          step.position.set(stairX, stepY, d / 2 + 0.18 + i * 0.22);
          c.add(step);
        }
        // Upper-floor balcony railing along the front (south face)
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 0.08, 0.04), M.rail);
        rail.position.set(0, H / 2 + 0.95, d / 2 + 0.55);
        c.add(rail);
        // Two vertical rail posts
        [-w / 2 + 0.6, w / 2 - 0.6].forEach((px) => {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.06), M.rail);
          post.position.set(px, H / 2 + 0.475, d / 2 + 0.55);
          c.add(post);
        });
      }

      // Optional accent sign panel sitting on top of the container (e.g.
      // the orange Domino's signage above the blue base).
      if (sign) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.65, d + 0.4), sign);
        s.position.y = H + 0.18 + 0.325;
        c.add(s);
      }

      c.position.set(E, 0, -N);
      c.rotation.y = (90 - bearingDeg) * Math.PI / 180;
      return c;
    }

    // Concrete pipe seating pod — cylinder lying on its side, open at the
    // east end so the coloured interior is visible from the plaza. The
    // tube axis is along world +X (east). The whole pod group has zero
    // rotation, so it stays perfectly horizontal — no tilt from camera
    // perspective or accidental Y-rotation.
    function placeTubePod({ E, N, interiorHex }) {
      const c = new THREE.Group();
      const R = 1.30, L = 2.8;

      // Lay the cylinder on its side: rotate Y-axis to lie along X.
      // ONLY rotation.z is set — rotation.x/y are 0, so the axis is
      // strictly horizontal.
      const outer = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 24, 1, true), M.concrete);
      outer.rotation.set(0, 0, Math.PI / 2);
      outer.position.y = R;
      c.add(outer);

      const innerMat = M.podInt(interiorHex);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.07, R - 0.07, L - 0.05, 24, 1, true), innerMat);
      inner.rotation.set(0, 0, Math.PI / 2);
      inner.position.y = R;
      c.add(inner);

      // Solid back wall on the west end (entrance opens east)
      const cap = new THREE.Mesh(new THREE.CircleGeometry(R - 0.04, 24), innerMat);
      cap.position.set(-L / 2 + 0.03, R, 0);
      cap.rotation.set(0, -Math.PI / 2, 0);
      c.add(cap);

      // Artificial-turf landing pad in front of the entrance — green, as
      // in the real photo where each pod sits on a strip of lawn.
      const pad = new THREE.Mesh(new THREE.BoxGeometry(L + 0.4, 0.06, 2 * R + 0.6), M.grass);
      pad.position.y = 0.03;
      c.add(pad);

      c.position.set(E, 0, -N);
      // No c.rotation.* — keep the pod absolutely level.
      return c;
    }

    // Tensile-fabric shade canopy — 4 corner poles + central mast, with a
    // 4-sided pyramid fabric panel pulled up at the centre.
    function placeShade({ E, N, size, height }) {
      const c = new THREE.Group();
      const POLE_R = 0.07;
      const POLE_H = height + 0.2;

      [[+1, +1], [+1, -1], [-1, +1], [-1, -1]].forEach(([sx, sz]) => {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(POLE_R, POLE_R, POLE_H, 8), M.pole);
        p.position.set(sx * size / 2, POLE_H / 2, sz * size / 2);
        c.add(p);
      });

      const apex = height + 1.0;
      const half = size / 2;
      const v = new Float32Array([
        -half, height, -half,    half, height, -half,    0, apex, 0,
         half, height, -half,    half, height,  half,    0, apex, 0,
         half, height,  half,   -half, height,  half,    0, apex, 0,
        -half, height,  half,   -half, height, -half,    0, apex, 0,
      ]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
      geo.computeVertexNormals();
      c.add(new THREE.Mesh(geo, M.fabric));

      c.position.set(E, 0, -N);
      return c;
    }

    // Round amphitheatre stage with central mast + conical fabric canopy
    function placeStage({ E, N, radius }) {
      const c = new THREE.Group();

      const base = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.35, 32), M.paving);
      base.position.y = 0.175;
      c.add(base);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.02, 0.08, 6, 32), M.pavingD);
      ring.position.y = 0.35;
      ring.rotation.x = Math.PI / 2;
      c.add(ring);

      const POLE_H = 3.8;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, POLE_H, 8), M.pole);
      pole.position.y = 0.35 + POLE_H / 2;
      c.add(pole);

      // Cone fabric — fan of triangles from apex down to the rim
      const SHADE_R = radius - 0.3;
      const apex = 0.35 + POLE_H;
      const rim = 0.35 + POLE_H - 1.1;
      const segs = 18;
      const verts = [];
      for (let i = 0; i < segs; i++) {
        const a1 = (i / segs) * Math.PI * 2;
        const a2 = ((i + 1) / segs) * Math.PI * 2;
        verts.push(
          SHADE_R * Math.cos(a1), rim, SHADE_R * Math.sin(a1),
          SHADE_R * Math.cos(a2), rim, SHADE_R * Math.sin(a2),
          0, apex, 0,
        );
      }
      const gs = new THREE.BufferGeometry();
      gs.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
      gs.computeVertexNormals();
      c.add(new THREE.Mesh(gs, M.fabric));

      c.position.set(E, 0, -N);
      return c;
    }

    function placeBench({ E, N, bearingDeg = 0 }) {
      const c = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.7), M.wood);
      top.position.y = 0.72;
      c.add(top);
      [-0.55, 0.55].forEach((dz) => {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 0.32), M.wood);
        seat.position.set(0, 0.42, dz);
        c.add(seat);
      });
      [[-0.7, -0.7], [-0.7, 0.7], [0.7, -0.7], [0.7, 0.7]].forEach(([dx, dz]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), M.wood);
        leg.position.set(dx, 0.36, dz);
        c.add(leg);
      });
      c.position.set(E, 0, -N);
      c.rotation.y = (90 - bearingDeg) * Math.PI / 180;
      return c;
    }

    // ── Plaza ground — two layers that match the actual food-court
    //    landscaping: a near-white paving base (blends with the #fafafa
    //    basemap so the slab edge isn't visible), then sage-green grass
    //    patches on top in the zones where the drone photos show lawn
    //    strips (under the pod row, along the south edge, and in
    //    pockets next to the perimeter road). The result no longer
    //    looks like a brown rectangle popping out of the terrain.
    function _shapeFrom(pts) {
      const s = new THREE.Shape();
      s.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
      s.lineTo(pts[0][0], pts[0][1]);
      return s;
    }
    {
      // Paving base — tight to the actual structure cluster so the slab
      // edge doesn't reach into open grass beyond the food court.
      const pavingPts = [
        [-22, -1], [-22,  10],   // west edge (encloses unnamed + pods)
        [-12,  20], [ -4,  27],  // NW corner (Domino's)
        [  8,  24], [ 18,  20],  // NE corner (Prasadanam / Baap)
        [ 18,   2], [ 14, -10],  // east edge tapering south
        [  0, -10],              // south edge (Waffcha / Tealogy)
        [-12,  -8],              // SW back to start
      ];
      const pad = new THREE.Mesh(new THREE.ShapeGeometry(_shapeFrom(pavingPts)), M.paving);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(0, 0.05, 0);
      g.add(pad);

      // Sage-green grass patches sitting just above the paving so the
      // boundary between lawn and concrete reads as landscaping. Zones
      // chosen to match the drone photos:
      //   1. Long strip under the 5 pods (each pod sits on lawn)
      //   2. South-edge buffer between the road and Tealogy/Waffcha
      //   3. NE pocket between Baap of Rolls and Prasadanam
      //   4. SE pocket east of Patiala / Zorko
      const grassZones = [
        _shapeFrom([[-13, -1], [-13, 13], [-7, 13], [-7, -1]]),         // pod row lawn
        _shapeFrom([[-6, -9], [-6, -6], [12, -6], [14, -9]]),           // south edge strip
        _shapeFrom([[10, 17], [10, 22], [16, 20], [16, 16]]),           // NE pocket
        _shapeFrom([[14, 0], [14, 6], [17, 6], [17, 0]]),               // SE pocket
      ];
      for (const gs of grassZones) {
        const lawn = new THREE.Mesh(new THREE.ShapeGeometry(gs), M.grass);
        lawn.rotation.x = -Math.PI / 2;
        lawn.position.set(0, 0.06, 0);  // 1 cm above paving — no Z-fight
        g.add(lawn);
      }
    }

    // ── Nine container restaurants. The polygon bboxes in places.geojson
    //    include the outdoor deck + awning surrounding each container, so
    //    using them as the container body made everything overlap into a
    //    solid mass. Hard-coded sizes below are the actual container body
    //    only (most are standard 20-ft / 40-ft shipping containers,
    //    2.4 m wide), centred on the polygon centroid.
    g.add(placeContainer({ E:  -1.0, N:  -4.2, w: 10.5, d: 3.0, bearingDeg: 107, body: M.cBlue,   roof: M.roofGalv })); // Tealogy
    g.add(placeContainer({ E:   0.9, N:   6.2, w: 11.0, d: 3.0, bearingDeg: 107, body: M.cRed,    roof: M.roofRust })); // Amritsari Kulcha
    g.add(placeContainer({ E:  11.1, N:   2.3, w:  5.5, d: 2.5, bearingDeg:  18, body: M.cRed,    roof: M.roofRust })); // Patiala Chicken
    g.add(placeContainer({ E:   9.0, N:  -7.2, w:  4.0, d: 2.5, bearingDeg:  15, body: M.cBlue,   roof: M.roofGalv })); // Waffcha
    g.add(placeContainer({ E:  12.8, N:   7.9, w:  5.5, d: 2.5, bearingDeg:  20, body: M.cRed,    roof: M.roofGalv })); // Zorko
    g.add(placeContainer({ E:   7.2, N:  18.1, w:  7.0, d: 4.5, bearingDeg: 110, body: M.cYellow, roof: M.roofGalv })); // Baap of Rolls (single-storey yellow, per photo)
    g.add(placeContainer({ E:  14.1, N:  15.7, w:  6.5, d: 2.5, bearingDeg: 108, body: M.cPink,   roof: M.roofRust })); // Prasadanam
    g.add(placeContainer({ E:  -7.9, N:  23.0, w:  6.0, d: 3.0, bearingDeg:  35, body: M.cBlue,   roof: M.roofGalv, sign: M.cOrange })); // Domino's
    g.add(placeContainer({ E: -16.4, N:   3.7, w: 10.0, d: 2.5, bearingDeg:  18, body: M.cBlue,   roof: M.roofGalv })); // Unnamed west container (Manchaha-style)

    // ── Five concrete tube pods, N–S row at E=-10. Spaced ~1.7 m apart
    //    edge-to-edge so each colour reads as its own pod from above
    //    (matching the drone photos). Position is clear of the western
    //    container (E max -13.7) and the long row (Tealogy E min -6.5).
    //    All pods are strictly horizontal — see placeTubePod above.
    const podColors = [0xe8e0d0, 0xe8b430, 0x2f7fb8, 0xb83820, 0x3a8a4a]; // white, yellow, blue, red, green
    for (let i = 0; i < 5; i++) {
      g.add(placeTubePod({ E: -10, N: -2 + i * 4.0, interiorHex: podColors[i] }));
    }

    // ── ONE tensile-fabric shade canopy over the central picnic seating
    //    (per the drone photos — there's only one big sail above the
    //    tables, not two). Fits in the verified-empty strip between
    //    Amritsari (N max 7.7) and Baap of Rolls (N min 14.8).
    g.add(placeShade({ E: 4, N: 11.25, size: 5.5, height: 3.6 }));

    // ── Boat-sail amphitheatre at the SW corner of the food court (the
    //    distinctive crescent-shaped stage visible in every drone photo).
    g.add(placeStage({ E: -19, N: -5, radius: 3.2 }));

    // ── Hedge planters following the perimeter road, matching the
    //    pruned bushes that ring the food court in every drone photo.
    //    Each pip is a low rectangular planter with a clipped-hedge
    //    canopy on top. Positions sampled along the outer boundary.
    const hedgeRing = [
      [-22,  -2], [-22,   3], [-22,   8], [-19,  12],
      [-15,  18], [-10,  24], [ -3,  27], [  4,  26],
      [ 11,  23], [ 17,  19], [ 19,  14], [ 19,   8],
      [ 19,   3], [ 18,  -3], [ 15, -10], [  8, -11],
      [  2, -11], [ -5, -10], [-10,  -9], [-15,  -7],
    ];
    for (const [hx, hn] of hedgeRing) {
      const planter = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.7), M.planter);
      planter.position.set(hx, 0.125, -hn);
      g.add(planter);
      const bush = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.6), M.hedge);
      bush.position.set(hx, 0.25 + 0.275, -hn);
      g.add(bush);
    }

    // ── Picnic benches under the central shade
    [
      { E:  3, N: 10.5, bearingDeg: 107 },
      { E:  6, N: 12.0, bearingDeg: 107 },
      { E:  4, N:  2.0, bearingDeg: 107 },
      { E:  7, N:  3.5, bearingDeg: 107 },
    ].forEach((b) => g.add(placeBench(b)));

    return g;
  }

  // ── Landmark registry ───────────────────────────────────────────────────
  // Height of the tiered base that the Brain Tree sits on top of.
  // Sum of all tier thicknesses + pedestal in buildBrainTreeBase().
  const BRAIN_TREE_BASE_TOP_Y = 0.20 + 0.45 + 0.55 + 0.65 + 0.8;  // 2.65 m

  const LANDMARKS = [
    {
      id: 'brain-tree-base-3d',
      label: null,
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
      label: 'Brain Tree',
      labelOffsetY: -1.0,
      labelOffsetY3d: -2.8,
      format: 'obj',
      file: 'assets/models/brain-tree.obj',
      lng: 73.1141633, lat: 26.4692796,
      heightMeters: 14,
      yOffsetMeters: BRAIN_TREE_BASE_TOP_Y,   // lift so it rests on the pedestal
      // Lazy getter: MAT is built only after Three.js loads, but this array is
      // created at module-eval. Resolved when the OBJ loader reads it at build.
      get material() { return MAT.gold; },
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
    },
    {
      id: 'library-3d',
      label: 'Library',
      labelOffsetY: -0.6,
      labelOffsetY3d: -2.2,
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
      label: 'Hostel O3',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      // Footprint sized for the polygon's central rectangular body so the
      // ring (especially the end stair towers, which span the full bbox
      // depth) doesn't overshoot the polygon's comb-shaped extremities
      // and clip the surrounding roads.
      build: () => buildOLaneHostel({ length: 58, bboxDepth: 32, wingCount: 5 }),
      lng: 73.1172853, lat: 26.4754698,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -6 * Math.PI / 180,        // longest edge bearing 276°/96°
      replacesOsmBuildings: ['1412504063'],
    },
    {
      id: 'hostel-O4-3d',
      label: 'Hostel O4',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildOLaneHostel({ length: 58, bboxDepth: 36, wingCount: 5 }),
      lng: 73.1170278, lat: 26.4749548,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -9 * Math.PI / 180,        // longest edge bearing 279°/99°
      replacesOsmBuildings: ['1412504062'],
    },
    {
      id: 'hostel-Y3-3d',
      label: 'Hostel Y3',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildOLaneHostel({ length: 58, bboxDepth: 32, wingCount: 5 }),
      lng: 73.1171422, lat: 26.4744791,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -6 * Math.PI / 180,
      replacesOsmBuildings: ['1412504061'],
    },
    {
      id: 'hostel-Y4-3d',
      label: 'Hostel Y4',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildOLaneHostel({ length: 58, bboxDepth: 32, wingCount: 5 }),
      lng: 73.1168888, lat: 26.4740272,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -6 * Math.PI / 180,
      replacesOsmBuildings: ['1412504060'],
    },

    // ── G-block courtyard hostels (G1 / G4). Sandstone ring around a
    //    central sports court. bearingOffset = -(longestEdgeBearing - 90):
    //      G1 main edge 92°  → -2°
    //      G4 main edge 96.8° → -6.8°
    {
      id: 'hostel-G1-3d',
      label: 'Hostel G1',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 39, depth: 42 }),
      lng: 73.1156352, lat: 26.4737039,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -2 * Math.PI / 180,
      replacesOsmBuildings: ['773563511'],
    },
    {
      id: 'hostel-G4-3d',
      label: 'Hostel G4',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 37, depth: 44, entranceSide: 'north' }),
      lng: 73.1170020, lat: 26.4730709,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -6.8 * Math.PI / 180,
      replacesOsmBuildings: ['773839449'],
    },

    // ── Remaining G/B/I-lane hostels. Same sandstone G+2 courtyard design.
    //    The wide (~70×41 m) blocks get a central cross-wing; B3 is a small
    //    square like G1/G4. Oriented dims + bearingOffset come from each
    //    polygon's oriented bounding box (long axis ≈ E-W).
    {
      id: 'hostel-G2-3d', label: 'Hostel G2', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 66, depth: 42, crossWing: true }),
      lng: 73.1165132, lat: 26.4736330, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -7.0 * Math.PI / 180, replacesOsmBuildings: ['773563512'],
    },
    {
      id: 'hostel-G3-3d', label: 'Hostel G3', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 70, depth: 42, crossWing: true }),
      lng: 73.1172775, lat: 26.4735577, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -9.4 * Math.PI / 180, replacesOsmBuildings: ['773839448'],
    },
    {
      id: 'hostel-G5-3d', label: 'Hostel G5', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 70, depth: 41, crossWing: true, entranceSide: 'north' }),
      lng: 73.1163303, lat: 26.4731241, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -5.9 * Math.PI / 180, replacesOsmBuildings: ['765972767'],
    },
    {
      id: 'hostel-G6-3d', label: 'Hostel G6', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 70, depth: 42, crossWing: true, entranceSide: 'north' }),
      lng: 73.1155088, lat: 26.4732049, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -2.0 * Math.PI / 180, replacesOsmBuildings: ['765972768'],
    },
    {
      id: 'hostel-B1-3d', label: 'Hostel B1', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 70, depth: 42, crossWing: true }),
      lng: 73.1153200, lat: 26.4727471, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -3.3 * Math.PI / 180, replacesOsmBuildings: ['603118184'],
    },
    {
      id: 'hostel-B2-3d', label: 'Hostel B2', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 68, depth: 42, crossWing: true }),
      lng: 73.1162607, lat: 26.4726569, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -5.9 * Math.PI / 180, replacesOsmBuildings: ['603152901'],
    },
    {
      id: 'hostel-B3-3d', label: 'Hostel B3', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 36, depth: 40 }),
      lng: 73.1172021, lat: 26.4725383, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -14.7 * Math.PI / 180, replacesOsmBuildings: ['773563504'],
    },
    {
      id: 'hostel-B4-3d', label: 'Hostel B4', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 68, depth: 42, crossWing: true, entranceSide: 'north' }),
      lng: 73.1162570, lat: 26.4721932, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -6.4 * Math.PI / 180, replacesOsmBuildings: ['1412504043'],
    },
    {
      id: 'hostel-B5-3d', label: 'Hostel B5', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 68, depth: 44, crossWing: true, entranceSide: 'north' }),
      lng: 73.1152548, lat: 26.4722354, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -1.5 * Math.PI / 180, replacesOsmBuildings: ['773069187'],
    },
    {
      id: 'hostel-I2-3d', label: 'Hostel I2', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 70, depth: 41, crossWing: true }),
      lng: 73.1152015, lat: 26.4717844, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -1.1 * Math.PI / 180, replacesOsmBuildings: ['773839447'],
    },
    {
      id: 'hostel-I3-3d', label: 'Hostel I3', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildGHostel({ size: 70, depth: 40, crossWing: true }),
      lng: 73.1161333, lat: 26.4717144, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -5.3 * Math.PI / 180, replacesOsmBuildings: ['1412392537'],
    },

    // ── Old Mess & New Mess — solid G+2 dining blocks with jali facades
    //    and equipment-covered roofs. bearingOffset from each footprint's
    //    long-edge bearing (Old Mess 26°, New Mess 12°).
    {
      id: 'old-mess-3d', label: 'Old Mess', labelOffsetY: -0.5, labelOffsetY3d: -1.8,
      format: 'procedural',
      build: () => buildMess({ size: 38, depth: 34, entranceSide: 'back' }),
      lng: 73.1169744, lat: 26.4720446, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 63.8 * Math.PI / 180, replacesOsmBuildings: ['765972769'],
    },
    {
      id: 'new-mess-3d', label: 'New Mess', labelOffsetY: -0.5, labelOffsetY3d: -1.8,
      format: 'procedural',
      build: () => buildMess({ size: 38, depth: 34, entranceSide: 'back' }),
      lng: 73.1174102, lat: 26.4729709, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 78.2 * Math.PI / 180, replacesOsmBuildings: ['1266941057'],
    },

    // ── SME & MBA — School of Management cream blocks with white corrugated
    //    gable roofs. SME: long single-storey block (footprint long-edge
    //    bearing 104.4° → off −14.4°). MBA: L of two single-storey wings (long-wing bearing
    //    11.7° → off 78.3°). lng/lat are each footprint's centre.
    {
      id: 'sme-3d', label: 'SME', labelOffsetY: -0.5, labelOffsetY3d: -1.8,
      format: 'procedural',
      build: buildSME,
      lng: 73.1171948, lat: 26.4801232, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -14.4 * Math.PI / 180, replacesOsmBuildings: ['1266941052'],
    },
    {
      id: 'mba-3d', label: 'MBA', labelOffsetY: -0.5, labelOffsetY3d: -1.8,
      format: 'procedural',
      build: buildMBA,
      lng: 73.1175866, lat: 26.4800307, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 78.3 * Math.PI / 180, replacesOsmBuildings: ['1266941053'],
    },

    // ── Basic Lab — L-shaped G+3 sandstone academic block with jali
    //    screens, pergola entrance, and a solar-covered roof.
    {
      id: 'basic-lab-3d', label: 'Basic Lab', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: buildBasicLab,
      // Positioned to keep all blocks clear of surrounding roads
      lng: 73.1149353, lat: 26.4748987, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: (78.9 + 180) * Math.PI / 180, replacesOsmBuildings: ['773587413'],
    },

    // ── LHC 1 — Lecture Hall Complex
    {
      id: 'lhc1-3d', label: 'LHC', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: buildLHC1,
      lng: 73.1139452, lat: 26.4728443, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      // Long axis bearing 3.1° (almost N-S) → off = 86.9°
      bearingOffset: 86.9 * Math.PI / 180, replacesOsmBuildings: ['603120869'],
    },

    // ── Aakash Sports Complex — indoor sports hall. The custom model replaces
    //    OSM footprint 773587402 ("Akaash Complex"), long axis bearing 47.5°.
    {
      id: 'aakash-complex-3d', label: 'Aakash Sports Complex', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: buildAakashComplex,
      lng: 73.1195842, lat: 26.4768753, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 42.5 * Math.PI / 180,
      replacesOsmBuildings: ['773587402'],
    },

    // ── Centre for Advance Scientific Equipment (U-plan academic block)
    {
      id: 'case-3d', label: 'Center for Advance Scientific Equipment', labelOffsetY: -0.5, labelOffsetY3d: -2.0,
      format: 'procedural',
      build: buildCASE,
      lng: 73.1141547, lat: 26.4762987, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      // Footprint long-edge bearing 103.69° (OSM 1412504069); rotated 90° → 13.69° → off = 76.31°
      bearingOffset: 76.31 * Math.PI / 180, replacesOsmBuildings: ['1412504069'],
    },


    // ── Jodhpur Club — H-plan two-storey club with sunken courtyard.
    //    OSM footprint longest edge bearing 42.4°; mesh +X must align with
    //    that, so bearingOffset = 90° − 42.4° = 47.6°.
    {
      id: 'jodhpur-club-3d', label: 'Jodhpur Club', labelOffsetY: -0.5, labelOffsetY3d: -1.8,
      format: 'procedural',
      build: buildJodhpurClub,
      lng: 73.111111, lat: 26.478194, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 47.6 * Math.PI / 180,
      replacesOsmBuildings: ['1266941055'],
    },

    // ── PHC (Primary Health Centre) — E-plan single storey, solar-clad.
    //    OSM footprint longest edge bearing 280.6°. Mesh +X = E-W long axis;
    //    mesh +Z = pergola/front (should face SOUTH). Use -10.6° so the
    //    pergola faces south and the E opens WEST (matches reference photos).
    {
      id: 'phc-3d', label: 'PHC', labelOffsetY: -0.5, labelOffsetY3d: -1.4,
      format: 'procedural',
      build: buildPHC,
      lng: 73.119624, lat: 26.481219, heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -10.6 * Math.PI / 180,
      replacesOsmBuildings: ['1266941054'],
    },

    // Computer Centre — square footprint, longest edge bearing 4° (N-S)
    {
      id: 'computer-centre-3d',
      label: 'Computer Centre',
      labelOffsetY: -0.5,
      labelOffsetY3d: -1.8,
      format: 'procedural',
      build: buildComputerCentre,
      lng: 73.1140009, lat: 26.4715934,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      // Footprint long axis runs N-S, mesh long axis (X) is E-W → 86° + 180° flip
      bearingOffset: (86 + 180) * Math.PI / 180,
      replacesOsmBuildings: ['773690911'],
    },

    // Chanakya Complex — Office of Administration (west wing, portico faces
    // EAST toward Office of Students) + Office of Students (east wing,
    // portico faces WEST toward OoA across the central canopy plaza).
    {
      id: 'chanakya-admin-3d',
      label: 'Office of Administration',
      labelOffsetY: -0.5,
      labelOffsetY3d: -1.8,
      format: 'procedural',
      build: () => buildChanakyaWing({ length: 40, depth: 16, height: 13, portal: true, portalSide: 'east' }),
      lng: 73.1131579, lat: 26.4711373,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
      replacesOsmBuildings: ['773563509'],
    },
    {
      id: 'chanakya-students-3d',
      label: 'Office of Students',
      labelOffsetY: -0.5,
      labelOffsetY3d: -1.8,
      format: 'procedural',
      build: () => buildChanakyaWing({ length: 34, depth: 15, height: 13, portal: true, portalSide: 'west' }),
      lng: 73.1140003, lat: 26.4711330,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
      replacesOsmBuildings: ['773563508'],
    },
    // IIT-J name canopy — curved sandstone arch with the institute name,
    // sits in the courtyard space midway between OoA and OoS.
    {
      id: 'iitj-name-canopy-3d',
      label: null,
      format: 'procedural',
      build: buildIITJNameCanopy,
      lng: 73.1135791, lat: 26.4710902,           // midpoint shifted ~5 m south
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,                            // name faces south
    },

    // Point-feature landmarks — Fountain and Prithvi Missile
    {
      id: 'fountain-3d',
      label: 'IITJ Fountain',
      labelOffsetY: -0.4,
      labelOffsetY3d: -1.6,
      format: 'procedural',
      build: buildFountain,
      lng: 73.1136467, lat: 26.4704637,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
    },
    {
      id: 'prithvi-missile-3d',
      label: 'Prithvi Missile',
      labelOffsetY: -0.4,
      labelOffsetY3d: -1.5,
      format: 'procedural',
      build: buildPrithviMissile,
      lng: 73.1147901, lat: 26.4669087,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
    },
    {
      id: 'tank-3d',
      label: 'T-72 Tank',
      labelOffsetY: -0.4,
      labelOffsetY3d: -1.8,
      format: 'procedural',
      build: buildTank,
      // OSM way 1412392546 — verified lat/lng from OSM #map=19/26.466766/73.114550
      lng: 73.114550, lat: 26.466766,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      // Gun points NE toward Prithvi Missile (~45° compass = 45° CCW from east)
      bearingOffset: 45 * Math.PI / 180,
    },

    // ── Department buildings — uniform H-shaped academic block design.
    //    bearingOffset orients each building so its entrance faces its
    //    paired partner across the central plaza:
    //      Physics ↔ Metallurgical, Electrical ↔ Mechanical (north cluster)
    //      Chemistry ↔ BB (south cluster)
    //    Civil sits north of the main cluster and faces south toward it.
    //    CSE sits south of BB and faces north toward it.
    // Model dimensions are sized so that, after rotation by bearingOffset,
    // the model's bounding box fits comfortably inside the OSM polygon
    // (with ~2 m buffer) — keeps wings off the surrounding roads.
    {
      id: 'dept-physics-3d',
      label: 'Department of Physics',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildDepartmentBuilding({ length: 36, bboxDepth: 36 }),
      lng: 73.1162468, lat: 26.4798001,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 75.8 * Math.PI / 180,
      replacesOsmBuildings: ['1266941050'],
    },
    {
      id: 'dept-mechanical-3d',
      label: 'Department of Mechanical Engineering',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildDepartmentBuilding({ length: 42, bboxDepth: 42 }),
      lng: 73.1166527, lat: 26.4791398,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -106.15 * Math.PI / 180,
      replacesOsmBuildings: ['773587411'],
    },
    {
      id: 'dept-metallurgical-3d',
      label: 'Department of Metallurgical & Materials Engineering',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildDepartmentBuilding({ length: 40, bboxDepth: 40 }),
      lng: 73.1169780, lat: 26.4796345,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -104.2 * Math.PI / 180,
      replacesOsmBuildings: ['1223174130'],
    },
    {
      id: 'dept-civil-3d',
      label: 'Department of Civil & Infrastructure Engineering',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      // Per satellite view the actual building is rectangular, longer
      // N-S, shorter E-W, with the recessed entrance courtyard on the
      // WEST face.
      build: () => buildDepartmentBuilding({ length: 38, bboxDepth: 34 }),
      lng: 73.1151943, lat: 26.4800794,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      // Entrance faces WEST. The campus grid is rotated ~15° off true
      // north, so a cardinal angle (e.g. -90°) looks tilted next to the
      // grid-aligned neighbours. Use the same grid bearing as the other
      // west-facing departments (Metallurgical/Mechanical/Chemistry) so
      // Civil sits perfectly parallel to its lane, exactly like Physics.
      bearingOffset: -104.2 * Math.PI / 180,
      replacesOsmBuildings: ['1516539950'],
    },
    {
      id: 'dept-electrical-3d',
      label: 'Department of Electrical Engineering',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildDepartmentBuilding({ length: 41, bboxDepth: 41 }),
      lng: 73.1160441, lat: 26.4792975,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 73.85 * Math.PI / 180,
      replacesOsmBuildings: ['1025144735'],
    },
    {
      id: 'dept-chemistry-3d',
      label: 'Department of Chemistry',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildDepartmentBuilding({ length: 34, bboxDepth: 34 }),
      lng: 73.1150405, lat: 26.4754859,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: -108.17 * Math.PI / 180,
      replacesOsmBuildings: ['773587412'],
    },
    {
      id: 'dept-cse-3d',
      label: 'Department of Computer Science & Engineering',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildDepartmentBuilding({ length: 35, bboxDepth: 35 }),
      lng: 73.1143996, lat: 26.4750582,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 73.06 * Math.PI / 180,
      replacesOsmBuildings: ['773690910'],
    },
    {
      id: 'dept-bb-3d',
      label: 'Department of Bioscience & Bioengineering',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildDepartmentBuilding({ length: 34, bboxDepth: 34 }),
      lng: 73.1145045, lat: 26.4756434,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 71.83 * Math.PI / 180,
      replacesOsmBuildings: ['1266941049'],
    },

    // Shamiyana — open-air food court of container restaurants. The eight
    // restaurant polygons would otherwise extrude as plain boxes; the
    // builder draws them in detail and replacesOsmBuildings hides the
    // duplicates. The model is anchored at the OSM 'Shamiyana' POI and
    // contains its own absolute offsets, so bearingOffset = 0.
    {
      id: 'shamiyana-3d',
      label: 'Shamiyana',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.2,
      format: 'procedural',
      build: buildShamiyanaComplex,
      lng: 73.1141839, lat: 26.4767383,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
      replacesOsmBuildings: [
        '1412504064', // Baap of Rolls
        '1412504065', // Amritsari Kulcha
        '1412504066', // Tealogy
        '1412504067', // Domino's
        '1412504068', // Unnamed west container
        '1524213392', // Waffcha
        '1524213393', // Prasadanam
        '1524213394', // Zorko
        '1524213395', // Patiala Chicken
      ],
    },

    // ── Type B Quarters (22 Faculty Housing blocks) + Guest House (Visitor)
    //    Each entry carries an osm_id; the builder pulls the matching
    //    polygon from IITJData at build time and extrudes its true H/cross
    //    footprint, so each block aligns exactly with the OSM polygon
    //    (no PCA bearing needed — the geometry already encodes orientation).
    //    The lng/lat anchor is the polygon's centroid so MapLibre places
    //    the mesh-local origin (also the polygon centroid in metres) at the
    //    correct world position.
    ...[
      ['773839450', 73.1113527, 26.4732187],
      ['773839451', 73.1107727, 26.4732305],
      ['773839452', 73.1107618, 26.4735386],
      ['773839453', 73.1113313, 26.4735014],
      ['773839454', 73.1114514, 26.4737832],
      ['773839455', 73.1108300, 26.4741639],
      ['773839456', 73.1114986, 26.4740987],
      ['773839457', 73.1108658, 26.4744771],
      ['773839458', 73.1114771, 26.4744216],
      ['773839459', 73.1107483, 26.4738201],
      ['773839460', 73.1123238, 26.4671374],
      ['773839461', 73.1126338, 26.4671152],
      ['773839462', 73.1120684, 26.4668497],
      ['773839463', 73.1123695, 26.4667915],
      ['773839464', 73.1127087, 26.4667771],
      ['773839465', 73.1119142, 26.4665752],
      ['773839466', 73.1121986, 26.4665093],
      ['1412677770', 73.1113483, 26.4669522],
      ['1412677771', 73.1112651, 26.4667309],
      ['1412677772', 73.1111992, 26.4673852],
      ['1412677773', 73.1115712, 26.4673192],
      ['1412677774', 73.1107858, 26.4674374],
    ].map(([osmId, lng, lat]) => ({
      id: `type-b-quarter-${osmId}-3d`,
      label: null,                                // covered by the area label
      format: 'procedural',
      build: () => buildTypeBQuarter({ osm_id: osmId, floors: 3 }),
      lng, lat,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,                           // polygon is world-aligned
      replacesOsmBuildings: [osmId],
    })),

    {
      id: 'guest-house-visitor-3d',
      label: 'Guest House (Visitor)',
      labelOffsetY: -0.5,
      labelOffsetY3d: -2.0,
      format: 'procedural',
      build: () => buildTypeBQuarter({ osm_id: '773563532', floors: 3, tankYellow: false }),
      lng: 73.1110476, lat: 26.4729162,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
      replacesOsmBuildings: ['773563532'],
    },

    // ── General Quarters (9 apartment blocks: 3 rectangular "General
    //    Quarters" + 6 pinwheel/Z-shaped "General Quaters"). Salmon-pink
    //    cement plaster, G+4, cane-railed balconies, white flat roofs with
    //    dark Sintex tanks + stair-tower headhouse. Reuses the polygon-
    //    extrude quarter builder with the pink palette and balconies on.
    //    Labels come from the buildings-labels layer (kept), so label:null.
    ...[
      ['1412404070', 73.1122015, 26.4772912],
      ['1412404071', 73.1124801, 26.4772336],
      ['1412404073', 73.1131707, 26.4771155],
      ['1419313443', 73.1118154, 26.4753336],
      ['1419313444', 73.1112555, 26.4753925],
      ['1419313445', 73.1107498, 26.4754013],
      ['1419313446', 73.1112595, 26.4756856],
      ['1419313447', 73.1118298, 26.4756470],
      ['1419313448', 73.1123654, 26.4755741],
    ].map(([osmId, lng, lat]) => ({
      id: `general-quarter-${osmId}-3d`,
      label: null,
      format: 'procedural',
      build: () => buildTypeBQuarter({
        osm_id: osmId, floors: 5, floorH: 3.2,
        wallMat: MAT.gqWall, tankMat: MAT.gqTank, balconies: true,
      }),
      lng, lat,
      heightMeters: null,
      rotateMeshToUp: Y_UP_TO_Z_UP,
      bearingOffset: 0,
      replacesOsmBuildings: [osmId],
    })),

    // ── Dept. Maths & SOLA — single-storey red-sandstone courtyard halls
    //    with hipped light-grey metal roofs. Built from their real OSM
    //    polygons (centroids = vertex-mean incl. closing node, matching the
    //    builder), so bearingOffset stays 0.
    {
      id: 'dept-maths-3d',
      label: 'Dept. Maths',
      labelOffsetY: -0.5, labelOffsetY3d: -1.8,
      format: 'procedural',
      build: () => buildCourtyardHall({ osm_id: '1266941051' }),
      lng: 73.1159136, lat: 26.4804674,
      heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP, bearingOffset: 0,
      replacesOsmBuildings: ['1266941051'],
    },
    {
      id: 'sola-3d',
      label: 'SOLA',
      labelOffsetY: -0.5, labelOffsetY3d: -1.8,
      format: 'procedural',
      build: () => buildCourtyardHall({ osm_id: '1266941056' }),
      lng: 73.1165013, lat: 26.4803206,
      heightMeters: null, rotateMeshToUp: Y_UP_TO_Z_UP, bearingOffset: 0,
      replacesOsmBuildings: ['1266941056'],
    },
  ];

  // ─────────────────────────────────────────────────────────────────────
  // Singleton state — ONE scene/camera/renderer for ALL landmarks.
  //
  // The previous design created one custom MapLibre layer (with its own
  // scene, camera, renderer, and a per-frame triggerRepaint) PER landmark.
  // With ~14 landmarks that meant a continuous render loop with 14 forced
  // repaints per frame and dozens of matrix allocations — the map never
  // went idle, killing performance on mid-range hardware.
  //
  // This rewrite consolidates everything into a single layer:
  //   • one Scene with all landmark groups, each pre-positioned in metres
  //     relative to a fixed campus-centre origin
  //   • one renderer + camera, reused across style swaps
  //   • render() does not call triggerRepaint() — the scene is static
  //   • geometry is built once during init() and cached forever
  //   • show()/hide() just toggle layer visibility
  // ─────────────────────────────────────────────────────────────────────
  const LAYER_ID = 'iitj-landmarks-3d';
  const LABEL_SRC_ID = 'landmark-labels-src';
  const LABEL_LAYER_ID = 'landmark-labels';
  const ORIGIN_LNG = 73.1147, ORIGIN_LAT = 26.4727;   // campus centre

  let _map = null;
  let _ready = false;
  let _visible = false;
  let _scene = null;
  let _root = null;
  let _camera = null;
  let _renderer = null;
  // MapLibre reuses the SAME WebGL context/canvas across setStyle()
  // (satellite/dark toggles). Creating more than one THREE.WebGLRenderer
  // on a single GL context corrupts three's internal program/VAO cache
  // and the custom layer renders nothing after the first style swap.
  // So we build ONE renderer, keyed to its gl context, and reuse it for
  // the life of the context. Because the context (and therefore every
  // uploaded BufferGeometry) survives a setStyle, the scene is also built
  // exactly once and reused — no per-toggle rebuild, no lag.
  let _rendererGl = null;
  let _originMcX = 0, _originMcY = 0, _originMcZ = 0;
  let _mercPerMeter = 1;
  let _treeData = null;       // { full:[lng,lat,...], bush:[lng,lat,...] }
  let _treesBuilt = false;
  let _bermsBuilt = false;
  let _bermLayout = null;
  // Scene build is split so it can be warmed incrementally at idle (prewarm)
  // and still finish synchronously if 3D is opened before warming completes.
  let _sceneShellReady = false;   // lights + camera + origin frame in place
  let _sceneComplete = false;     // every landmark + vegetation + berm built
  let _sunLight = null;
  let _fillLight = null;
  let _ambientLight = null;
  let _buildIndex = 0;            // next LANDMARKS entry awaiting geometry build
  let _originMc = null;           // cached mercator origin for chunked builds
  let _buildLoopRunning = false;  // a chunked build loop is currently scheduled
  let _gpuWarmed = false;         // shaders compiled + buffers uploaded to GPU
  let _targetOpacity = 1.0;   // remembered so setOpacity called before the scene
                              // mounts still takes effect when meshes appear
  let _targetIds = null;      // null = apply to all; Set = apply only to these landmark ids

  // Reusable per-frame buffers (_rotX/_projM/_localM/_scaleVec) are declared
  // and allocated lazily in _initThreeObjects() — see the top of the module.

  // Scene container, lights, camera and origin frame. Cheap (no per-building
  // geometry) so it is safe to run on the critical path; the heavy landmark
  // builders run separately via _buildLandmarkChunk().
  function _initSceneShell() {
    if (_sceneShellReady) return;
    _initThreeObjects();   // materials + matrices (Three.js is ready by now)

    _scene = new THREE.Scene();
    _sunLight = new THREE.DirectionalLight(0xffffff, 1.05);
    _sunLight.position.set(0.5, -1, 0.8).normalize();
    _scene.add(_sunLight);
    _fillLight = new THREE.DirectionalLight(0xffffff, 0.45);
    _fillLight.position.set(-0.7, 0.6, 0.4).normalize();
    _scene.add(_fillLight);
    _ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    _scene.add(_ambientLight);

    _root = new THREE.Group();
    _scene.add(_root);

    _camera = new THREE.PerspectiveCamera();

    const originMc = maplibregl.MercatorCoordinate.fromLngLat([ORIGIN_LNG, ORIGIN_LAT], 0);
    _originMcX = originMc.x;
    _originMcY = originMc.y;
    _originMcZ = originMc.z;
    _mercPerMeter = originMc.meterInMercatorCoordinateUnits();
    _originMc = originMc;
    _sceneShellReady = true;
  }

  // Build up to `count` more landmark groups. Returns true while landmarks
  // remain. The single build loop (_startBuild) advances the shared _buildIndex
  // across slices/frames, so a landmark is never built twice or skipped.
  function _buildLandmarkChunk(count) {
    if (!_sceneShellReady) _initSceneShell();
    const end = Math.min(_buildIndex + count, LANDMARKS.length);
    for (; _buildIndex < end; _buildIndex++) _addLandmark(LANDMARKS[_buildIndex], _originMc);
    return _buildIndex < LANDMARKS.length;
  }

  // Vegetation, berms and any pending opacity — run once all landmarks exist.
  function _finalizeScene() {
    if (_sceneComplete) return;
    // OSM-driven instanced trees (data may already be loaded; otherwise the
    // fetch in init() will call _buildVegetation() when it resolves).
    _buildVegetation();
    // Perimeter berms — hardcoded geometry.
    _buildBerms();
    // If setOpacity was called before the scene existed, apply it now.
    if (_targetOpacity < 0.999) _applyOpacity(_targetOpacity, _targetIds);
    _sceneComplete = true;
  }


  // ─────────────────────────────────────────────────────────────────────
  // VEGETATION — instanced low-poly trees, driven by the SAME OpenStreetMap
  // vegetation that F4Map renders: landuse=forest, natural=scrub,
  // leisure=park / leisure=garden polygons.
  //
  // Tree positions are pre-baked offline (web/data/trees.json) by scattering
  // points inside each OSM polygon at a per-type density and removing any
  // that fall on a building footprint. At runtime we just stream them into a
  // couple of InstancedMeshes — full trees (trunk + canopy) and low scrub
  // bushes (canopy only) — so even a few thousand trees stay at ~3 draw
  // calls and a static scene.
  // ─────────────────────────────────────────────────────────────────────
  function _lngLatToLocal(lng, lat) {
    const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
    return [(mc.x - _originMcX) / _mercPerMeter, (mc.y - _originMcY) / _mercPerMeter];
  }

  // ─────────────────────────────────────────────────────────────────────
  // PERIMETER BERM SYSTEM  (data-driven from the OSM "Berms" footprints)
  //
  // IIT-Jodhpur's perimeter berms are long, sculptural earth-wall ribbons
  // that ring the campus. From the drone references they read as:
  //   • a scalloped / wavy top silhouette — a row of shallow barrel-vault
  //     humps, roughly one per 8 m module;
  //   • near-vertical faces with slim vertical ribs at every module joint;
  //   • the EXTERIOR (road-facing) face painted with blue/white murals;
  //   • the INTERIOR (campus-facing) face in plain Jodhpur sandstone.
  //
  // Rather than guess placement, every segment is reconstructed from the
  // actual OSM footprint polygons tagged name="Berms" (8 ribbons across the
  // east + west perimeter). For each thin ribbon we derive a centre-line and
  // a local width (PCA long-axis + two-sided pairing), then sweep the berm
  // cross-section along it. Geometry is emitted as a few merged
  // BufferGeometry strips per segment (≈4 draw calls) so the whole system
  // stays lightweight. Materials are shared and double-sided.
  // ─────────────────────────────────────────────────────────────────────

  // Raw OSM footprints (closed lng,lat rings), name="Berms" from
  // buildings.geojson. The E/W hostel-side perimeter is built as BLUE wave-berm
  // ribbons (below). The entire SOUTH edge is the GREEN terraced landscape berm
  // (see GREEN_BERMS) — so the OSM south berm ways 742 (S-east), 756 (S-central)
  // and 757 (SW corner) are NOT built here: they are the same earthwork the
  // green berms already render, and drawing them as blue ribbons double-covers
  // the south and collides with the green slopes. 746 is kept: it fills the real
  // gap between green West and green Central (without it W-2..W-6 float).
  // 744/748/750 re-shaped from the 2026-06 OSM refresh.
  const BERM_IDS = ['1412399743','1412399744','1412399745','1412399746',
                    '1412399747','1412399748','1412399749','1412399750'];
  const BERM_RINGS = {
    '1412399742': [[73.1139971,26.4701581],[73.1139281,26.4701139],[73.1139366,26.4700285],[73.1139922,26.469976],[73.1140381,26.4699263],[73.1140918,26.4698968],[73.1141389,26.4698746],[73.1148684,26.4699108],[73.1157954,26.4701812],[73.1163295,26.4704777],[73.1167736,26.4708228],[73.1169739,26.4709971],[73.1169005,26.471106],[73.1167947,26.4711843],[73.1165963,26.4710369],[73.1163303,26.4708558],[73.1162936,26.4708343],[73.1160235,26.470676],[73.1159413,26.4706279],[73.1154878,26.4704133],[73.1153832,26.4703871],[73.1149697,26.4702837],[73.1148301,26.4702488],[73.114562,26.4702127],[73.1142636,26.4701726],[73.1141367,26.4701657],[73.1139971,26.4701581]],
    '1412399743': [[73.1176865,26.472778],[73.1177998,26.4727475],[73.1177279,26.4724356],[73.1176097,26.4721324],[73.1174723,26.4718436],[73.1172529,26.4715055],[73.1170337,26.4712786],[73.1169447,26.4713841],[73.1169901,26.4714367],[73.1171,26.471564],[73.1171751,26.4716691],[73.117262,26.4717678],[73.1173311,26.4718917],[73.1173964,26.4720088],[73.1174874,26.4721932],[73.1175373,26.4722944],[73.117604,26.4724877],[73.1176327,26.472571],[73.1176865,26.472778]],
    '1412399744': [[73.1179079,26.4748199],[73.1180214,26.4748232],[73.1179683,26.4740122],[73.1178625,26.4732272],[73.1177804,26.4732511],[73.1178367,26.4736818],[73.1178489,26.4737752],[73.1178587,26.4738503],[73.1178623,26.4738783],[73.1178651,26.4739187],[73.1178686,26.4739689],[73.1178922,26.4743067],[73.1179021,26.4744482],[73.117907,26.4745189],[73.1179118,26.4745883],[73.1179119,26.4746403],[73.1179119,26.4746584],[73.117912,26.4746811],[73.117912,26.4746931],[73.117912,26.4746993],[73.1179116,26.4747082],[73.1179113,26.474717],[73.1179108,26.4747279],[73.1179101,26.474745],[73.1179098,26.4747544],[73.1179089,26.4747756],[73.1179085,26.474785],[73.1179084,26.474791],[73.1179082,26.4748009],[73.1179079,26.4748199]],
    '1412399745': [[73.1178945,26.4767757],[73.1179645,26.4767812],[73.1180186,26.4759883],[73.118021,26.4751844],[73.1178836,26.4751876],[73.1178945,26.4767757]],
    '1412399746': [[73.1116108,26.4709223],[73.1127329,26.470358],[73.1126364,26.4702329],[73.1126063,26.4701921],[73.1123435,26.4702898],[73.1121028,26.4703887],[73.1118016,26.4705435],[73.1116094,26.4706592],[73.1114447,26.4707397],[73.1116108,26.4709223]],
    '1412399747': [[73.1097023,26.4734068],[73.1098739,26.4734332],[73.1099403,26.473175],[73.1100196,26.4728522],[73.1100912,26.4725725],[73.1102595,26.4722394],[73.1104473,26.4719164],[73.1102701,26.4718617],[73.1101139,26.4720856],[73.1099781,26.4724125],[73.1098461,26.4727336],[73.1097671,26.4730857],[73.1097023,26.4734068]],
    '1412399748': [[73.1101619,26.4754659],[73.1102827,26.475428],[73.1102425,26.4753096],[73.1101577,26.4750596],[73.1100728,26.4748093],[73.1100105,26.4746257],[73.1099899,26.4744632],[73.1099481,26.4741328],[73.1099109,26.4738396],[73.1098886,26.4736633],[73.1097469,26.4737016],[73.109814,26.4743117],[73.1100332,26.4751007],[73.1101619,26.4754659]],
    '1412399749': [[73.1114299,26.4769472],[73.1113573,26.4770122],[73.1110443,26.4767393],[73.1107866,26.4764361],[73.1106529,26.476247],[73.1105142,26.4760599],[73.1103106,26.4756886],[73.1104166,26.4756411],[73.1105986,26.4759669],[73.1108144,26.4762666],[73.1110387,26.4765146],[73.1111862,26.4766778],[73.111348,26.4768566],[73.1114299,26.4769472]],
    '1412399750': [[73.1123453,26.4779449],[73.1124336,26.4778855],[73.1123054,26.4777493],[73.1120838,26.4775138],[73.1116576,26.4771598],[73.1115907,26.4772409],[73.1119917,26.4776168],[73.1123453,26.4779449]],
    '1412399756': [[73.1127515,26.4703585],[73.1128339,26.4703545],[73.1129424,26.4703204],[73.1131518,26.4702481],[73.1134613,26.4701893],[73.1136596,26.4701332],[73.1137171,26.4700415],[73.1136962,26.4699356],[73.1136208,26.4698849],[73.1135007,26.4698348],[73.1132565,26.4698697],[73.112922,26.4699581],[73.1125958,26.4700771],[73.1127515,26.4703585]],
    '1412399757': [[73.1107668,26.4715451],[73.1112284,26.4711812],[73.111584,26.4709459],[73.1113248,26.4707369],[73.1110033,26.4709451],[73.1108141,26.4711119],[73.1105554,26.4713678],[73.1107668,26.4715451]],
  };

  // Approx campus centroid — used only to decide which face is exterior.
  const _CAMPUS_CENTER = [73.1150, 26.4700];

  // Resample a metric [x,y] polyline to K points spaced equally by arc length.
  function _resampleXY(chain, K) {
    if (chain.length === 1) return new Array(K).fill(chain[0]);
    const arc = [0];
    for (let i = 1; i < chain.length; i++) {
      arc.push(arc[i-1] + Math.hypot(chain[i][0]-chain[i-1][0], chain[i][1]-chain[i-1][1]));
    }
    const total = arc[arc.length-1] || 1;
    const out = [];
    for (let k = 0; k < K; k++) {
      const s = (k/(K-1)) * total;
      let seg = 0;
      while (seg < arc.length-2 && arc[seg+1] <= s) seg++;
      const sl = arc[seg+1]-arc[seg] || 1, t = (s-arc[seg])/sl;
      out.push([chain[seg][0] + t*(chain[seg+1][0]-chain[seg][0]),
                chain[seg][1] + t*(chain[seg+1][1]-chain[seg][1])]);
    }
    return out;
  }

  // Solve a 3×3 linear system by Gaussian elimination with partial pivoting.
  function _solve3(M, r) {
    const a = M.map((row, i) => row.concat(r[i]));
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let i = c+1; i < 3; i++) if (Math.abs(a[i][c]) > Math.abs(a[p][c])) p = i;
      [a[c], a[p]] = [a[p], a[c]];
      const piv = a[c][c] || 1e-9;
      for (let j = c; j < 4; j++) a[c][j] /= piv;
      for (let i = 0; i < 3; i++) if (i !== c) { const f = a[i][c]; for (let j = c; j < 4; j++) a[i][j] -= f*a[c][j]; }
    }
    return [a[0][3], a[1][3], a[2][3]];
  }

  // Least-squares quadratic  w = A·t² + B·t + C  through (T[i], W[i]).
  function _quadFit(T, W) {
    let s0 = T.length, s1 = 0, s2 = 0, s3 = 0, s4 = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < T.length; i++) {
      const t = T[i], w = W[i], t2 = t*t;
      s1 += t; s2 += t2; s3 += t2*t; s4 += t2*t2;
      b0 += w; b1 += w*t; b2 += w*t2;
    }
    const [A, B, C] = _solve3([[s4,s3,s2],[s3,s2,s1],[s2,s1,s0]], [b2,b1,b0]);
    return { A, B, C };
  }

  // Derive { center:[[lng,lat]...], width:metres } from a thin ribbon ring.
  // Works in a local metric frame (corrects lng/lat aspect): finds the long
  // axis by PCA, splits the ring into its two long sides, averages matched
  // samples into a centre-line, then fits a QUADRATIC (parabolic) arc in the
  // PCA frame. A parabola has constant-sign curvature, so the result is a
  // single smooth CONCAVE arc that follows the perimeter — never an S-curve.
  function _ribbonCenterline(ring, K) {
    K = K || 22;
    const pts = ring.slice(0, ring.length-1);   // drop closing duplicate
    const n = pts.length;
    let cx = 0, cy = 0;
    pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= n; cy /= n;
    const mLng = 111320 * Math.cos(cy * Math.PI/180), mLat = 111320;
    const P = pts.map(p => [(p[0]-cx)*mLng, (p[1]-cy)*mLat]);
    // PCA principal axis (long) + perpendicular (across)
    let sxx = 0, sxy = 0, syy = 0;
    P.forEach(([x,y]) => { sxx += x*x; sxy += x*y; syy += y*y; });
    const theta = 0.5 * Math.atan2(2*sxy, sxx - syy);
    const ax = Math.cos(theta), ay = Math.sin(theta);
    const bx = -ay, by = ax;
    const t = P.map(([x,y]) => x*ax + y*ay);
    let iMin = 0, iMax = 0;
    t.forEach((v,i) => { if (v < t[iMin]) iMin = i; if (v > t[iMax]) iMax = i; });
    const chain = (from, to) => { const c = []; let i = from; for (;;) { c.push(P[i]); if (i === to) break; i = (i+1)%n; } return c; };
    const ra = _resampleXY(chain(iMin, iMax), K);
    const rb = _resampleXY(chain(iMax, iMin).reverse(), K);
    // midpoints expressed in PCA coords (T = along axis, W = across)
    const T = [], W = []; let widthSum = 0;
    for (let i = 0; i < K; i++) {
      const mx = (ra[i][0]+rb[i][0])/2, my = (ra[i][1]+rb[i][1])/2;
      T.push(mx*ax + my*ay); W.push(mx*bx + my*by);
      widthSum += Math.hypot(ra[i][0]-rb[i][0], ra[i][1]-rb[i][1]);
    }
    // Fit a parabola w(t) → guaranteed single-curvature (concave) arc.
    const f = _quadFit(T, W);
    const tMin = Math.min(...T), tMax = Math.max(...T);
    const center = [];
    for (let i = 0; i < K; i++) {
      const tt = tMin + (tMax - tMin) * i/(K-1);
      const ww = f.A*tt*tt + f.B*tt + f.C;
      const mx = tt*ax + ww*bx, my = tt*ay + ww*by;
      center.push([cx + mx/mLng, cy + my/mLat]);
    }
    return { center, width: widthSum / K };
  }

  // Fit a single parabolic (concave) arc through a set of lng/lat points and
  // return K points sampled along it.
  function _parabolicArc(pts, K) {
    K = K || 26;
    let cx = 0, cy = 0;
    pts.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
    const mLng = 111320 * Math.cos(cy * Math.PI/180), mLat = 111320;
    const P = pts.map(p => [(p[0]-cx)*mLng, (p[1]-cy)*mLat]);
    let sxx = 0, sxy = 0, syy = 0;
    P.forEach(([x,y]) => { sxx += x*x; sxy += x*y; syy += y*y; });
    const th = 0.5 * Math.atan2(2*sxy, sxx - syy);
    const ax = Math.cos(th), ay = Math.sin(th), bx = -ay, by = ax;
    const T = P.map(([x,y]) => x*ax + y*ay), W = P.map(([x,y]) => x*bx + y*by);
    const f = _quadFit(T, W);
    const tMin = Math.min(...T), tMax = Math.max(...T), out = [];
    for (let i = 0; i < K; i++) {
      const tt = tMin + (tMax - tMin) * i/(K-1);
      const ww = f.A*tt*tt + f.B*tt + f.C;
      out.push([cx + (tt*ax + ww*bx)/mLng, cy + (tt*ay + ww*by)/mLat]);
    }
    return out;
  }

  // Combined smooth outer arc through a group of berm footprints — used to
  // route the green landscape berm that runs alongside a blue-berm cluster.
  function _clusterCenterline(ids, K) {
    let pts = [];
    for (const id of ids) {
      const ring = BERM_RINGS[id];
      if (ring) pts = pts.concat(_ribbonCenterline(ring).center);
    }
    return _parabolicArc(pts, K || 28);
  }

  // ── Module geometry helpers (module-local frame) ─────────────────────
  //   +x = along the berm length (one module spans this)
  //   +z = OUTWARD toward the road (blue mural side)   -z = campus side
  //   +y = up.
  //
  // The real berms read as a SOLID structure (no open passages):
  //   • Campus face  : a tall pink-sandstone arcade wall, fully closed,
  //                    with a recessed blind-arch motif (arched window bays).
  //   • Road face    : light-blue painted shells — a scalloped mural wall
  //                    whose top edge dips between modules.
  //   • Roof         : blue barrel-vault strip linking the two top edges,
  //                    rising just above the sandstone parapet.
  //   • Ribs         : white buttresses at every module joint on the road
  //                    side, ground to roof.

  // Translated box (its local origin recentred to (cx,cy,cz)).
  function _boxAt(w, h, d, cx, cy, cz) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(cx, cy, cz);
    return g;
  }

  // Recessed blind-arch panel on the campus face (flat, in x-y at z=zc).
  function _archPanelGeo(w, baseY, topMax, zc, cols) {
    const a = w/2, pos = [], idx = [];
    for (let c = 0; c <= cols; c++) {
      const x = -a + (2*a)*c/cols;
      const r = Math.max(0, 1 - (x/a)*(x/a));
      const top = baseY + (topMax-baseY)*Math.sqrt(r);
      pos.push(x, baseY, zc,  x, top, zc);
      if (c < cols) { const b = c*2; idx.push(b, b+2, b+1,  b+1, b+2, b+3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  // Blue road front: solid wall whose top edge is a scallop (high at module
  // centre = peakY, dipping to dipY at the module edges).
  function _scallopWallGeo(w, dipY, peakY, zc, cols) {
    const a = w/2, pos = [], idx = [];
    for (let c = 0; c <= cols; c++) {
      const x = -a + (2*a)*c/cols;
      const f = Math.cos(Math.PI * x / w);            // 1 at centre → 0 at edges
      const top = dipY + (peakY-dipY)*Math.max(0, f);
      pos.push(x, 0, zc,  x, top, zc);
      if (c < cols) { const b = c*2; idx.push(b, b+2, b+1,  b+1, b+2, b+3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  // Roof strip linking the road scallop top edge (+z) to the straight
  // sandstone parapet (-z), bowing up into a shallow vault.
  function _roofStripGeo(w, zRoad, zCampus, parapetY, dipY, peakY, vault, cols) {
    const a = w/2, pos = [], nor = [], idx = [];
    for (let c = 0; c <= cols; c++) {
      const x = -a + (2*a)*c/cols;
      const f = Math.max(0, Math.cos(Math.PI * x / w));
      const roadTop = dipY + (peakY-dipY)*f;
      // mid control point bows above the chord by `vault`
      // emit 3 rows: road edge, crown, campus edge
      const crownY = Math.max(roadTop, parapetY) + vault*f;
      const zc0 = zRoad, zc1 = (zRoad+zCampus)/2, zc2 = zCampus;
      pos.push(x, roadTop, zc0,  x, crownY, zc1,  x, parapetY, zc2);
      nor.push(0,1,0, 0,1,0, 0,1,0);
      if (c < cols) {
        const b = c*3, nb = (c+1)*3;
        idx.push(b, nb, b+1,    b+1, nb, nb+1);     // road→crown
        idx.push(b+1, nb+1, b+2, b+2, nb+1, nb+2);  // crown→campus
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  // Walk a metric polyline: returns sampler(s) → {px,pz,tx,tz} (unit tangent)
  // plus the total length.
  function _polyWalker(local) {
    const arc = [0];
    for (let i = 1; i < local.length; i++)
      arc.push(arc[i-1] + Math.hypot(local[i][0]-local[i-1][0], local[i][1]-local[i-1][1]));
    const total = arc[arc.length-1];
    const at = (s) => {
      s = Math.max(0, Math.min(total, s));
      let seg = 0;
      while (seg < arc.length-2 && arc[seg+1] <= s) seg++;
      const a = local[seg], b = local[Math.min(seg+1, local.length-1)];
      const sl = arc[seg+1]-arc[seg] || 1, t = (s-arc[seg])/sl;
      let tx = b[0]-a[0], tz = b[1]-a[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      return { px: a[0]+t*(b[0]-a[0]), pz: a[1]+t*(b[1]-a[1]), tx, tz };
    };
    return { at, total };
  }

  /**
   * Build one berm segment as a row of solid sandstone/blue modules swept
   * along the (gently curved) centre-line. InstancedMesh per component, with
   * a per-module basis that follows the curve → a few draw calls/segment.
   */
  function _buildBermSegment(centerPath, widthM, opts) {
    opts = opts || {};
    const wallH   = opts.wallH   ?? 7.5;     // sandstone parapet height
    const vault   = opts.vault   ?? 1.7;     // blue roof rise above parapet
    const peak    = opts.peak    ?? 1.2;     // road scallop peak above parapet
    const dip     = opts.dip     ?? 2.2;     // road scallop dip below parapet
    const moduleW = opts.moduleW ?? 7.5;
    const cols    = 12;
    const g = new THREE.Group();

    const local = centerPath.map(([lng,lat]) => _lngLatToLocal(lng, lat));
    if (local.length < 2) return g;
    const { at, total } = _polyWalker(local);
    if (total < 2) return g;

    const depth = Math.max(5.0, Math.min(8.5, widthM));   // road↔campus span
    const zRoad = depth/2, zCampus = -depth/2;
    const parapetY = wallH, peakY = wallH + peak, dipY = wallH - dip;
    const cc = _lngLatToLocal(_CAMPUS_CENTER[0], _CAMPUS_CENTER[1]);

    const n = Math.max(1, Math.round(total / moduleW));
    const stepW = total / n;
    const mw = stepW * 0.995;

    // ── per-module component geometries (instanced) ──
    const campusWall = _boxAt(mw, wallH, 0.55, 0, wallH/2, zCampus + 0.275);
    // Blind-arch applique sits just proud of the campus face (z = zCampus)
    // so the arcade motif reads; two stacked bays per module.
    const archPanel  = _archPanelGeo(mw*0.72, wallH*0.40, wallH*0.86, zCampus - 0.04, cols);
    const archPanel2 = _archPanelGeo(mw*0.72, wallH*0.06, wallH*0.34, zCampus - 0.04, cols);
    const roadWall   = _scallopWallGeo(mw, dipY, peakY, zRoad - 0.05, cols);
    const roofStrip  = _roofStripGeo(mw, zRoad - 0.05, zCampus + 0.05, parapetY, dipY, peakY, vault, cols);
    const ribGeo     = _boxAt(0.7, wallH + peak + 0.3, 1.1, 0, (wallH+peak+0.3)/2, zRoad - 0.2);

    const mCampus = new THREE.InstancedMesh(campusWall, BMAT.waveInt,  n);
    const mArch   = new THREE.InstancedMesh(archPanel,  BMAT.waveArch, n);
    const mArch2  = new THREE.InstancedMesh(archPanel2, BMAT.waveArch, n);
    const mRoad   = new THREE.InstancedMesh(roadWall,   BMAT.waveExt,  n);
    const mRoof   = new THREE.InstancedMesh(roofStrip,  BMAT.waveExt,  n);
    const mRib    = new THREE.InstancedMesh(ribGeo,     BMAT.waveRib,  n + 1);
    const all = [mCampus, mArch, mArch2, mRoad, mRoof, mRib];
    all.forEach(m => { m.frustumCulled = false; });

    const M = new THREE.Matrix4();
    const X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3();
    // Per-station basis following the curve. +z (Z) = outward (toward road).
    const setBasis = (st) => {
      let ox = st.tz, oz = -st.tx;
      if (ox*(st.px-cc[0]) + oz*(st.pz-cc[1]) < 0) { ox = -ox; oz = -oz; }
      Z.set(ox, 0, oz); X.set(oz, 0, -ox);
      M.makeBasis(X, Y, Z); M.setPosition(st.px, 0, st.pz);
      return M;
    };

    for (let k = 0; k < n; k++) {
      setBasis(at((k + 0.5) * stepW));
      mCampus.setMatrixAt(k, M);
      mArch.setMatrixAt(k, M);
      mArch2.setMatrixAt(k, M);
      mRoad.setMatrixAt(k, M);
      mRoof.setMatrixAt(k, M);
    }
    for (let k = 0; k <= n; k++) {            // ribs on the module JOINTS
      setBasis(at(k * stepW));
      mRib.setMatrixAt(k, M);
    }
    all.forEach(m => { m.instanceMatrix.needsUpdate = true; });

    // ── sandstone end caps (close the open cross-section at both ends) ──
    const capGeo = _boxAt(0.5, wallH, depth, 0, wallH/2, 0);
    [0, total].forEach((s) => {
      const cap = new THREE.Mesh(capGeo, BMAT.waveInt);
      cap.matrixAutoUpdate = false;
      cap.matrix.copy(setBasis(at(s)));
      g.add(cap);
    });

    g.add(mCampus, mArch, mArch2, mRoad, mRoof, mRib);
    return g;
  }

  // ── ADMINISTRATION / LANDSCAPE BERMS (Family 1) ──────────────────────
  // Around the Brain-Tree entry / Director-Lawn precinct the campus uses big
  // sweeping landscape berms: a near-vertical pink-sandstone RETAINING WALL
  // on the outer face holding back a TERRACED, planted earth embankment on
  // the campus face. Modelled by sweeping a cross-section profile along a
  // smoothed spline path anchored on real campus landmarks.

  // Densify + Laplacian-smooth a sparse lng/lat path into a gentle spline.
  function _smoothLngLatPath(path, density, passes) {
    density = density || 8; passes = passes ?? 8;
    let d = [];
    for (let i = 0; i < path.length-1; i++)
      for (let k = 0; k < density; k++) {
        const t = k/density;
        d.push([path[i][0] + t*(path[i+1][0]-path[i][0]),
                path[i][1] + t*(path[i+1][1]-path[i][1])]);
      }
    d.push(path[path.length-1]);
    for (let p = 0; p < passes; p++) {
      const e = d.map(q => q.slice());
      for (let i = 1; i < d.length-1; i++) {
        e[i][0] = (d[i-1][0] + 2*d[i][0] + d[i+1][0]) / 4;
        e[i][1] = (d[i-1][1] + 2*d[i][1] + d[i+1][1]) / 4;
      }
      d = e;
    }
    return d;
  }

  // Sweep an open cross-section profile [[z,y]...] (z = signed offset along
  // the outward normal, y = height) along a centre-line. `offset` shifts the
  // whole profile outward (away from campus) so the berm can sit alongside a
  // road rather than straddling it. One material.
  function _sweepProfile(localPath, profile, material, flipOut, offset, ref) {
    const { at, total } = _polyWalker(localPath);
    const cc = ref || _lngLatToLocal(_CAMPUS_CENTER[0], _CAMPUS_CENTER[1]);
    const off = offset || 0;
    const step = 2.5, M = Math.max(2, Math.ceil(total/step) + 1), NP = profile.length;
    const pos = [], idx = [];
    for (let i = 0; i < M; i++) {
      const st = at(Math.min(i*step, total));
      let ox = st.tz, oz = -st.tx;
      if (ox*(st.px-cc[0]) + oz*(st.pz-cc[1]) < 0) { ox = -ox; oz = -oz; }
      if (flipOut) { ox = -ox; oz = -oz; }
      for (let j = 0; j < NP; j++) {
        const pz = profile[j][0] + off, py = profile[j][1];
        pos.push(st.px + ox*pz, py, st.pz + oz*pz);
      }
      if (i < M-1) for (let j = 0; j < NP-1; j++) {
        const a = i*NP+j, b = i*NP+j+1, c = (i+1)*NP+j, d = (i+1)*NP+j+1;
        idx.push(a, c, b,  b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }

  // Densely plant the terraced slope with trees + flowering shrubs that SIT on
  // the terraces. yAtZ(z) gives the slope height at cross-section offset z, so
  // plants follow the contours. zMin..zMax is the planted band (signed offsets
  // along the outward normal, already including any profile offset).
  function _bermPlanting(localPath, yAtZ, zMin, zMax, density, flipOut, ref) {
    const g = new THREE.Group();
    const { at, total } = _polyWalker(localPath);
    const cc = ref || _lngLatToLocal(_CAMPUS_CENTER[0], _CAMPUS_CENTER[1]);
    const nTree  = Math.max(6, Math.round(total / (density || 7)));
    const nShrub = nTree * 5;
    let seed = 0x51ab3c7d;
    const rnd = () => { seed = (seed*1664525 + 1013904223) >>> 0; return seed/4294967296; };
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0,1,0);
    const sv = new THREE.Vector3(), pv = new THREE.Vector3();
    // world position of a plant at along-length s and cross-offset z
    const place = (s, z) => {
      const st = at(s);
      let ox = st.tz, oz = -st.tx;
      if (ox*(st.px-cc[0]) + oz*(st.pz-cc[1]) < 0) { ox = -ox; oz = -oz; }
      if (flipOut) { ox = -ox; oz = -oz; }
      pv.set(st.px + ox*z, yAtZ(z), st.pz + oz*z);
    };
    // ── Trees ──
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 1.3, 5); trunkGeo.translate(0, 0.65, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(1.25, 0);       canopyGeo.translate(0, 1.95, 0);
    const trunk = new THREE.InstancedMesh(trunkGeo, MAT.treeTrunk, nTree);
    const canopy = new THREE.InstancedMesh(canopyGeo, MAT.canopy, nTree);
    trunk.frustumCulled = canopy.frustumCulled = false;
    const tg = [new THREE.Color(0x5f8a3e), new THREE.Color(0x6f9447), new THREE.Color(0x4f7a36)];
    for (let i = 0; i < nTree; i++) {
      place(rnd()*total, zMin + rnd()*(zMax-zMin));
      const s = 0.8 + rnd()*0.7;
      q.setFromAxisAngle(up, rnd()*6.283); sv.set(s, s*(0.9+rnd()*0.4), s);
      M.compose(pv, q, sv); trunk.setMatrixAt(i, M); canopy.setMatrixAt(i, M);
      canopy.setColorAt(i, tg[(rnd()*tg.length)|0]);
    }
    trunk.instanceMatrix.needsUpdate = canopy.instanceMatrix.needsUpdate = true;
    if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
    g.add(trunk, canopy);
    // ── Flowering shrubs (denser, lower, blossom colours) ──
    const shrubGeo = new THREE.IcosahedronGeometry(0.75, 0); shrubGeo.translate(0, 0.5, 0);
    const shrub = new THREE.InstancedMesh(shrubGeo, MAT.canopy, nShrub);
    shrub.frustumCulled = false;
    const sc = [new THREE.Color(0x6f9447), new THREE.Color(0x567d3a), new THREE.Color(0xcf6f8c),
                new THREE.Color(0xe9e2d2), new THREE.Color(0xb8536f), new THREE.Color(0xd99a4e)];
    for (let i = 0; i < nShrub; i++) {
      place(rnd()*total, zMin + rnd()*(zMax-zMin));
      const s = 0.55 + rnd()*0.8;
      q.setFromAxisAngle(up, rnd()*6.283); sv.set(s, s*0.7, s);
      M.compose(pv, q, sv); shrub.setMatrixAt(i, M);
      shrub.setColorAt(i, sc[(rnd()*sc.length)|0]);
    }
    shrub.instanceMatrix.needsUpdate = true;
    if (shrub.instanceColor) shrub.instanceColor.needsUpdate = true;
    g.add(shrub);
    return g;
  }

  // Blind-arch ARCADE (two tiers of gates) applied to the sandstone retaining
  // wall — the same campus-facing arched-bay motif used on the blue berms.
  // faceZ is the wall-face offset in profile coords; panels are placed proud
  // of the wall, oriented toward the wall's outward (campus) side.
  function _bermArcade(localPath, faceZ, H, offset, flipOut, ref) {
    const g = new THREE.Group();
    const { at, total } = _polyWalker(localPath);
    const cc = ref || _lngLatToLocal(_CAMPUS_CENTER[0], _CAMPUS_CENTER[1]);
    const moduleW = 7.5;
    const n = Math.max(1, Math.round(total / moduleW));
    const stepW = total / n;
    const upper = _archPanelGeo(stepW*0.72, H*0.42, H*0.88, 0, 12);
    const lower = _archPanelGeo(stepW*0.72, H*0.06, H*0.34, 0, 12);
    const mU = new THREE.InstancedMesh(upper, BMAT.waveArch, n);
    const mL = new THREE.InstancedMesh(lower, BMAT.waveArch, n);
    mU.frustumCulled = mL.frustumCulled = false;
    const M = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(0,1,0), Z = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const st = at((k + 0.5) * stepW);
      let ox = st.tz, oz = -st.tx;
      if (ox*(st.px-cc[0]) + oz*(st.pz-cc[1]) < 0) { ox = -ox; oz = -oz; }
      if (flipOut) { ox = -ox; oz = -oz; }
      const z = faceZ + offset;
      Z.set(ox, 0, oz); X.set(oz, 0, -ox);
      M.makeBasis(X, Y, Z); M.setPosition(st.px + ox*z, 0, st.pz + oz*z);
      mU.setMatrixAt(k, M); mL.setMatrixAt(k, M);
    }
    mU.instanceMatrix.needsUpdate = mL.instanceMatrix.needsUpdate = true;
    g.add(mU, mL);
    return g;
  }

  /**
   * Landscape berm: a TALL, uplifted terraced earthwork (mountain-slope) — a
   * battered sandstone retaining wall on the outer face holding back a high,
   * densely-planted terraced embankment that steps down toward campus.
   * centerPath is lng/lat, swept along a smoothed (optionally concave) spline.
   */
  function _buildRetainingBerm(centerPath, opts) {
    opts = opts || {};
    const H       = opts.height    ?? 9.0;     // crest height (mountain slope)
    const halfW   = (opts.baseWidth ?? 30) / 2;
    const steps   = opts.steps     ?? 5;
    const batter  = opts.batter    ?? 2.4;     // battered wall lean
    const flipOut = opts.flipOut   ?? false;
    // Offset the whole berm outward so it sits beside the road, not on it.
    const offset  = opts.offset    ?? (halfW * 0.95);
    // Optional explicit "outward" reference (a point on the campus-core side);
    // the wall faces away from it. Falls back to the global campus centre.
    const ref = opts.outwardRef ? _lngLatToLocal(opts.outwardRef[0], opts.outwardRef[1]) : null;
    const g = new THREE.Group();
    // opts.concave fits a single parabolic arc so the berm bows like the
    // blue wave berms (no straight/angular runs); otherwise just smooth.
    const base = opts.concave ? _parabolicArc(centerPath, 24) : centerPath;
    const local = _smoothLngLatPath(base, 6, 5).map(([lng,lat]) => _lngLatToLocal(lng, lat));
    if (local.length < 2) return g;

    // Outer retaining wall (battered) — base → crest.
    const wall = [[halfW, 0], [halfW - batter, H]];
    // Terraced embankment: crest then stepped slope down to inner ground.
    const outerZ = halfW - batter, innerZ = -halfW, span = outerZ - innerZ;
    const terr = [[outerZ, H]];
    for (let s = 0; s < steps; s++) {
      const z0 = outerZ - span*(s/steps);
      const z1 = outerZ - span*((s + 0.55)/steps);
      const y0 = H*(1 - s/steps), y1 = H*(1 - (s+1)/steps);
      terr.push([z0, y0], [z1, y0], [z1, y1]);
    }
    terr.push([innerZ, 0]);

    g.add(_sweepProfile(local, wall, BMAT.bermStone, flipOut, offset, ref));
    g.add(_sweepProfile(local, terr, BMAT.bermGreen, flipOut, offset, ref));
    // Coping along the crest for a crisp parapet line.
    g.add(_sweepProfile(local, [[halfW + 0.15, H], [outerZ, H + 0.3]], BMAT.bermStoneTop, flipOut, offset, ref));
    // Arcade of arched gates on the (campus-facing) wall, like the blue berms.
    if (opts.arcade) g.add(_bermArcade(local, halfW + 0.05, H, offset, flipOut, ref));

    // Plant the terraced slope: height at offset z (profile is in z-descending
    // order from the crest down to the inner toe). Account for the profile
    // offset so plants land on the terraces.
    if (opts.trees) {
      const yAtZ = (z) => {
        const zp = z - offset;
        for (let i = 0; i < terr.length-1; i++) {
          const a = terr[i], b = terr[i+1];
          if ((zp <= a[0] && zp >= b[0]) || (zp >= a[0] && zp <= b[0])) {
            const t = (zp - a[0]) / ((b[0]-a[0]) || 1); return a[1] + t*(b[1]-a[1]);
          }
        }
        return 0;
      };
      g.add(_bermPlanting(local, yAtZ, innerZ + offset + 1.0, outerZ + offset - 1.5,
                          opts.treeSpacing, flipOut, ref));
    }
    return g;
  }

  // GREEN LANDSCAPE BERMS — tall, uplifted, densely-planted terraced earthworks
  // (mountain-slope) along the SOUTH edge only. Every south berm (these three
  // PLUS the blue berm 746) is routed off the SAME perimeter-road centre-line,
  // offset a consistent ~6 m to the outer side, so their campus-facing walls
  // all ALIGN in one continuous band and none overlaps the road. The sandstone
  // wall + arcade faces campus (flipOut); terraces step down to the outer side.
  // Band order W→E: West · 746(blue) · Central, then a gap (entry avenue),
  // then East (one connected run).
  const _SOUTH_REF = [73.1140, 26.4730];
  // offset=-halfW keeps the sandstone wall on the path line. baseWidth tuned
  // so the terraced slope stays clear of southern roads.
  const _GB = { height: 9.0, baseWidth: 18, steps: 5, batter: 1.4, offset: -9,
                trees: true, treeSpacing: 7, concave: false, flipOut: true,
                arcade: true, outwardRef: _SOUTH_REF };
  const GREEN_BERMS = [
    // West part — sandstone wall ends at (73.1114714, 26.4710141) on the
    // green-wall line. Blue 746's CAMPUS WALL (which sits 4.25 m inward from
    // its own centre-line) aligns to this same line via its D=10 offset.
    Object.assign({}, _GB, { path: [[73.1103929,26.4719782],[73.1105293,26.4717748],
      [73.1107213,26.4715824],[73.1111318,26.4712421],[73.1114714,26.4710141]] }),
    // Central part — STRAIGHT extension along the road tangent to the marker
    // longitude (73.113711). The last segment is parallel to the road's flow,
    // so the perpendicular endcap reads as a clean east-facing wall (no south
    // curve, just a smooth continuation).
    Object.assign({}, _GB, { path: [[73.1127372,26.4703936],[73.1131187,26.4702720],
      [73.1132827,26.4702256],[73.1134767,26.4701882],
      [73.1137100,26.4701600]] }),
    // East part — STRAIGHT extension backward from road-aligned v1 to the
    // marker longitude (73.113958). Same flow: perpendicular endcap, no kink.
    // Narrower so the slope toe clears the south service road.
    Object.assign({}, _GB, { baseWidth: 14, offset: -7,
      path: [[73.1139592,26.4701471],[73.1141907,26.4701516],
        [73.1147332,26.4702038],[73.1152486,26.4703093],[73.1157409,26.4704867],
        [73.1161642,26.4707136],[73.1165918,26.4710085],[73.1168349,26.4712561]] }),
  ];

  // Blue wave-berm centre-line overrides. Each override is a SMOOTH cubic
  // Bezier whose endpoints are placed so blue's campus-facing wall (at
  // -depth/2 from the path) lands EXACTLY on the adjacent green-wall point,
  // AND whose tangents at start/end match the adjacent green's tangent (so
  // the wall direction is continuous across each junction).
  const BERM_CL_OVERRIDE = {
    // 747 — extended to its FULL OSM-polygon natural length at the north end
    // (NW endpoint = midpoint of v0+v1 = (73.1097881, 26.4734200)), so the
    // berm reaches its designated layout. South end is offset perpendicular
    // from West green's start so 747's campus wall lands EXACTLY on West
    // green's wall, with the tangent matched (smooth continuous wall line).
    '1412399747': [[73.1097881,26.4734200],[73.1098133,26.4733116],
                   [73.1098401,26.4732031],[73.1098685,26.4730947],
                   [73.1098989,26.4729866],[73.1099315,26.4728789],
                   [73.1099664,26.4727718],[73.1100039,26.4726656],
                   [73.1100442,26.4725603],[73.1100875,26.4724561],
                   [73.1101340,26.4723533],[73.1101839,26.4722519],
                   [73.1102375,26.4721522],[73.1102949,26.4720544],
                   [73.1103563,26.4719586]],
    // 746 — SW-corner berm bridging green West and green Central. Its raw OSM
    // ring fits to a near-straight centre-line that ignores the perimeter curve
    // and leaves a kink at each green neighbour. This Hermite curve instead
    // matches green West's end tangent and green Central's start tangent, so the
    // campus wall lands EXACTLY on each green wall endpoint (0.1 m) and the berm
    // bows along the perimeter (14° turn) — continuous with the adjacent berms.
    '1412399746': [[73.1114458,26.4709836],[73.1114937,26.4709531],
                   [73.1115532,26.4709178],[73.1116230,26.4708784],
                   [73.1117015,26.4708356],[73.1117870,26.4707903],
                   [73.1118780,26.4707431],[73.1119728,26.4706951],
                   [73.1120697,26.4706469],[73.1121670,26.4705995],
                   [73.1122631,26.4705536],[73.1123563,26.4705101],
                   [73.1124450,26.4704699],[73.1125275,26.4704338],
                   [73.1126023,26.4704025],[73.1126678,26.4703769],
                   [73.1127229,26.4703576]],
  };

  // Build every campus berm from the OSM ribbon parabolic centre-line (same
  // curve as before POI-driven extensions). POI snap uses berm-layout gates.
  function _buildBerms() {
    if (!_root || _bermsBuilt) return;
    _bermsBuilt = true;
    for (const id of BERM_IDS) {
      const ring = BERM_RINGS[id];
      if (!ring) continue;
      const { center, width } = _ribbonCenterline(ring);
      _root.add(_buildBermSegment(BERM_CL_OVERRIDE[id] || center, width, {
        wallH: 7.5, vault: 1.7, peak: 1.2, dip: 2.2, moduleW: 7.5,
      }));
    }
    for (const gb of GREEN_BERMS) _root.add(_buildRetainingBerm(gb.path, gb));
    if (_map) _map.triggerRepaint();
  }

  function _buildVegetation() {
    if (_treesBuilt || !_treeData || !_root) return;
    _treesBuilt = true;

    let seed = 0x1a2b3c4d;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0), sv = new THREE.Vector3(), pv = new THREE.Vector3();

    // ── Full trees: trunk + icosahedron canopy ──
    const full = _treeData.full || [];
    const nFull = full.length >> 1;
    if (nFull) {
      const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.5, 5); trunkGeo.translate(0, 0.75, 0);
      const folGeo   = new THREE.IcosahedronGeometry(1.55, 0);        folGeo.translate(0, 2.45, 0);
      const trunk = new THREE.InstancedMesh(trunkGeo, MAT.treeTrunk, nFull);
      const fol   = new THREE.InstancedMesh(folGeo,   MAT.canopy,    nFull);
      trunk.frustumCulled = false; fol.frustumCulled = false;
      const greens = [new THREE.Color(0x4f7a36), new THREE.Color(0x6f9447), new THREE.Color(0x5f8a3e), new THREE.Color(0x5a7d33)];
      for (let i = 0; i < nFull; i++) {
        const [x, z] = _lngLatToLocal(full[i * 2], full[i * 2 + 1]);
        const s = 0.78 + rnd() * 0.7;
        q.setFromAxisAngle(up, rnd() * 6.283);
        sv.set(s, s * (0.88 + rnd() * 0.4), s); pv.set(x, 0, z); m.compose(pv, q, sv);
        trunk.setMatrixAt(i, m); fol.setMatrixAt(i, m);
        fol.setColorAt(i, greens[(rnd() * greens.length) | 0]);
      }
      trunk.instanceMatrix.needsUpdate = true; fol.instanceMatrix.needsUpdate = true;
      if (fol.instanceColor) fol.instanceColor.needsUpdate = true;
      _root.add(trunk); _root.add(fol);
    }

    // ── Scrub bushes: low rounded shrubs, no trunk ──
    const bush = _treeData.bush || [];
    const nBush = bush.length >> 1;
    if (nBush) {
      const bGeo = new THREE.IcosahedronGeometry(1.0, 0); bGeo.translate(0, 0.6, 0);
      const bMesh = new THREE.InstancedMesh(bGeo, MAT.canopy, nBush);
      bMesh.frustumCulled = false;
      const scrub = [new THREE.Color(0x8a9550), new THREE.Color(0x9aa860), new THREE.Color(0x7e8a48)];
      for (let i = 0; i < nBush; i++) {
        const [x, z] = _lngLatToLocal(bush[i * 2], bush[i * 2 + 1]);
        const s = 0.7 + rnd() * 0.6;
        q.setFromAxisAngle(up, rnd() * 6.283);
        sv.set(s * (1 + rnd() * 0.3), s * 0.7, s * (1 + rnd() * 0.3)); pv.set(x, 0, z); m.compose(pv, q, sv);
        bMesh.setMatrixAt(i, m);
        bMesh.setColorAt(i, scrub[(rnd() * scrub.length) | 0]);
      }
      bMesh.instanceMatrix.needsUpdate = true;
      if (bMesh.instanceColor) bMesh.instanceColor.needsUpdate = true;
      _root.add(bMesh);
    }

    if (_map) _map.triggerRepaint();
  }

  function _addLandmark(cfg, originMc) {
    const group = new THREE.Group();
    // Bearing rotates around mesh-Y (= world vertical after Rx flip)
    group.rotation.y = cfg.bearingOffset || 0;

    // Position offset from origin in mesh-local coords (Y-up).
    // Vertex flow: group.matrix → layer Rx(π/2) → S(merc,-merc,merc) → T(originMc).
    // For a vertex at (0,0,0), final mercator = originMc + (group.x*s, group.z*s, 0).
    // We want this to equal cfg's mercator, so: group.x = (cfg.mc.x-origin.x)/s,
    // group.z = (cfg.mc.y-origin.y)/s.
    const mc = maplibregl.MercatorCoordinate.fromLngLat([cfg.lng, cfg.lat], 0);
    const dx = (mc.x - originMc.x) / _mercPerMeter;
    const dz = (mc.y - originMc.y) / _mercPerMeter;
    group.position.set(dx, 0, dz);

    // Stamp the cfg so app.js can later target a single landmark for fading
    group.userData.landmarkId    = cfg.id;
    group.userData.landmarkLabel = cfg.label || null;
    group.userData.lng = cfg.lng;
    group.userData.lat = cfg.lat;

    const place = (root) => {
      if (cfg.format !== 'procedural' && cfg.material) {
        root.traverse((c) => {
          if (c.isMesh) {
            c.material = cfg.material;
            c.geometry.computeVertexNormals();
          }
        });
      }
      const bbox = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();   bbox.getSize(size);
      const center = new THREE.Vector3(); bbox.getCenter(center);
      const s = (cfg.heightMeters && size.y > 0) ? cfg.heightMeters / size.y : 1;
      if (s !== 1) root.scale.set(s, s, s);
      root.position.set(-center.x * s, -bbox.min.y * s, -center.z * s);
      if (cfg.yOffsetMeters) root.position.y += cfg.yOffsetMeters;
      group.add(root);
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

    _root.add(group);
  }

  function _buildLayer() {
    return {
      id: LAYER_ID,
      type: 'custom',
      renderingMode: '3d',
      onAdd(map, gl) {
        // Set up the scene shell + renderer, then stream the geometry in via
        // _startBuild() (per animation frame while visible) instead of building
        // the whole campus synchronously here. A cold toggle therefore tilts
        // smoothly while detail fills in, rather than freezing on one build.
        _initSceneShell();
        // Reuse the existing renderer if MapLibre handed us the same GL
        // context (the normal case across setStyle). Only build a new one
        // if there is none yet, or the context was genuinely replaced
        // (e.g. after a WebGL context-loss/restore). Creating a second
        // renderer on a live context is what previously blanked the layer.
        if (!_renderer || _rendererGl !== gl) {
          _renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
          _renderer.autoClear = false;
          _rendererGl = gl;
        }
        _startBuild();
        // If the geometry is already built (warmed in the background) but the
        // GPU upload hasn't happened yet, do it now — synchronously, before the
        // first frame — so the tilt doesn't stutter on the upload.
        if (_sceneComplete) _warmGpu();
      },
      render(_gl, matrix) {
        if (!_visible || !_scene || !_renderer) return;
        _scaleVec.set(_mercPerMeter, -_mercPerMeter, _mercPerMeter);
        _localM.makeTranslation(_originMcX, _originMcY, _originMcZ)
               .scale(_scaleVec)
               .multiply(_rotX);
        _projM.fromArray(matrix);
        _camera.projectionMatrix = _projM.multiply(_localM);
        _renderer.resetState();
        _renderer.render(_scene, _camera);
        // No triggerRepaint(): the scene is static, MapLibre can go idle.
      },
    };
  }

  function _threeReady() {
    return typeof THREE !== 'undefined' && THREE.OBJLoader && THREE.GLTFLoader;
  }

  let _labelOpts = { satellite: false, dark: false, is3D: false, visible: true };

  function _labelPaint() {
    const onSatellite = _labelOpts.satellite;
    const isDark = _labelOpts.dark;
    return {
      'text-color': onSatellite ? '#ffffff' : (isDark ? '#e2e8f0' : '#1f2937'),
      'text-halo-color': onSatellite ? 'rgba(0,0,0,0.88)' : (isDark ? 'rgba(15,23,42,0.9)' : 'rgba(255,255,255,0.95)'),
      'text-halo-width': onSatellite ? 2 : 1.5,
    };
  }

  function _labelOffset() {
    return _labelOpts.is3D ? [0, -1.1] : [0, -0.25];
  }

  function _ensureLabels() {
    if (!_map) return;
    const tryAdd = (attempts = 0) => {
      if (!_map) return;
      if (!_map.isStyleLoaded()) {
        if (attempts < 120) setTimeout(() => tryAdd(attempts + 1), 50);
        return;
      }
      const data = getLabelGeoJSON();
      try {
        // Older builds used the same id for the GeoJSON source and symbol
        // layer ("landmark-labels"), which prevents glyphs from rendering.
        if (_map.getSource('landmark-labels') && !_map.getSource(LABEL_SRC_ID)) {
          try {
            if (_map.getLayer(LABEL_LAYER_ID)) _map.removeLayer(LABEL_LAYER_ID);
            _map.removeSource('landmark-labels');
          } catch (_) {}
        }

        if (_map.getSource(LABEL_SRC_ID)) _map.getSource(LABEL_SRC_ID).setData(data);
        else _map.addSource(LABEL_SRC_ID, { type: 'geojson', data });

        const existing = _map.getStyle().layers.find(l => l.id === LABEL_LAYER_ID);
        if (existing && existing.source !== LABEL_SRC_ID) {
          try { _map.removeLayer(LABEL_LAYER_ID); } catch (_) {}
        }

        if (!_map.getLayer(LABEL_LAYER_ID)) {
          _map.addLayer({
            id: LABEL_LAYER_ID,
            type: 'symbol',
            source: LABEL_SRC_ID,
            minzoom: 15,
            layout: {
              'text-field': ['get', 'name'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 18, 14],
              'text-font': ['Open Sans Regular'],
              'text-anchor': 'bottom',
              'text-offset': _labelOffset(),
              'text-max-width': 10,
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              'text-padding': 6,
              visibility: _labelOpts.visible ? 'visible' : 'none',
            },
            paint: _labelPaint(),
          });
        } else {
          _map.setPaintProperty(LABEL_LAYER_ID, 'text-color', _labelPaint()['text-color']);
          _map.setPaintProperty(LABEL_LAYER_ID, 'text-halo-color', _labelPaint()['text-halo-color']);
          _map.setPaintProperty(LABEL_LAYER_ID, 'text-halo-width', _labelPaint()['text-halo-width']);
          _map.setLayoutProperty(LABEL_LAYER_ID, 'text-anchor', 'bottom');
          _map.setLayoutProperty(LABEL_LAYER_ID, 'text-offset', _labelOffset());
          _map.setLayoutProperty(LABEL_LAYER_ID, 'visibility', _labelOpts.visible ? 'visible' : 'none');
        }
        _raise();
      } catch (e) {
        console.error('[Landmarks3D] landmark labels failed:', e);
      }
    };
    tryAdd();
  }

  /** Update label theme/visibility (call from app.js on mode toggles). */
  function syncLabels(opts) {
    if (opts) _labelOpts = { ..._labelOpts, ...opts };
    if (!_map) return;
    _ensureLabels();
  }

  // Schedule a callback for browser idle time, falling back to a timer.
  function _idle(fn) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 300 });
    else setTimeout(fn, 1);
  }

  // Build the 3D scene in small chunks instead of one blocking pass, so
  // switching to 3D never freezes the main thread (≈50 building generators +
  // thousands of instanced trees + berm fits) and the GPU never has to upload
  // every buffer / compile every shader in a single frame. Geometry, materials
  // and detail are identical to a one-shot build — only the timing is spread:
  //   • Warming up (called from init, 3D not shown yet): a few buildings per
  //     browser-idle slice, so the 2D map stays fully responsive.
  //   • While 3D is visible: a few per animation frame with a repaint, so any
  //     remaining detail streams in within the tilt rather than blocking it —
  //     the same way Google/Apple/F4 stream 3D detail in as the camera moves.
  // Re-entrant-safe: one loop runs at a time and re-reads _visible every tick,
  // so a toggle mid-warm-up simply upgrades the cadence to per-frame streaming.
  function _startBuild() {
    if (_sceneComplete || _buildLoopRunning) return;
    if (!_threeReady()) { setTimeout(_startBuild, 120); return; }   // loaders not ready yet
    _buildLoopRunning = true;
    _initSceneShell();
    const tick = () => {
      if (_sceneComplete) { _buildLoopRunning = false; _warmIfIdle(); return; }
      const more = _buildLandmarkChunk(_visible ? 3 : 6);
      if (!more) _finalizeScene();
      if (_visible && _map) _map.triggerRepaint();   // paint newly built models
      if (_sceneComplete) { _buildLoopRunning = false; _warmIfIdle(); return; }
      if (_visible) requestAnimationFrame(tick); else _idle(tick);
    };
    if (_visible) requestAnimationFrame(tick); else _idle(tick);
  }

  // Once geometry is built but 3D still isn't shown, pre-upload it to the GPU
  // in the background so the first toggle doesn't pay that cost on-frame.
  function _warmIfIdle() {
    if (!_gpuWarmed && !_visible) _warmLayerHidden();
  }

  // Compile every shader program and upload every geometry buffer to the GPU
  // ahead of the first visible frame, so switching to 3D doesn't stall doing it
  // all at once. Renders the whole scene once into a 1×1 off-screen target with
  // a camera that contains everything (nothing frustum-culled) — the cost is
  // the upload, not the single pixel. Best-effort: any failure just falls back
  // to the (chunk-streamed) on-demand path, so it can never break rendering.
  function _warmGpu() {
    if (_gpuWarmed || !_renderer || !_scene || !_camera) return;
    try {
      _renderer.compile(_scene, _camera);            // link all shader programs
      const box = new THREE.Box3().setFromObject(_scene);
      if (!box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3());
        const r = Math.max(1, box.getSize(new THREE.Vector3()).length());
        const warmCam = new THREE.OrthographicCamera(-r, r, r, -r, -r, r);
        warmCam.position.copy(c);
        warmCam.lookAt(c.x, c.y, c.z - 1);
        warmCam.updateMatrixWorld();
        const rt = new THREE.WebGLRenderTarget(1, 1);
        const prevRT = _renderer.getRenderTarget();
        _renderer.setRenderTarget(rt);
        _renderer.render(_scene, warmCam);           // forces buffer uploads
        _renderer.setRenderTarget(prevRT);
        rt.dispose();
      }
      _renderer.resetState();                          // hand GL state back clean
      _gpuWarmed = true;
    } catch (e) { /* best-effort warm-up */ }
  }

  // While 3D is still hidden, add the custom layer (which gives onAdd a GL
  // context and builds the renderer), force it hidden in the same tick so it
  // never paints over the 2D map, then warm the GPU off-screen. show() can then
  // just flip visibility — no upload on that frame.
  function _warmLayerHidden() {
    if (_gpuWarmed || _visible || !_map) return;
    if (!_map.isStyleLoaded()) { setTimeout(_warmLayerHidden, 150); return; }
    try {
      if (!_map.getLayer(LAYER_ID)) {
        _map.addLayer(_buildLayer());
        _map.setLayoutProperty(LAYER_ID, 'visibility', 'none');
      }
    } catch (e) { return; }
    _warmGpu();
  }

  // Public warm-up entry (called from init once the map exists).
  function prewarm() { _startBuild(); }

  // ── Lazy Three.js loader ────────────────────────────────────────────────
  // Three.js + its OBJ/GLTF loaders (~600 KB) are fetched the first time the
  // user enters 3D, not on every page load — a big win for 2D-only sessions and
  // slow connections. SRI + crossorigin mirror the old static <script> tags so
  // the CSP and tamper protection are unchanged. Idempotent; callbacks queue
  // until the loaders are live.
  const _THREE_SCRIPTS = [
    { src: 'https://unpkg.com/three@0.144.0/build/three.min.js',
      integrity: 'sha384-UeYnsImn15wLN2RmvFuufa/wN6Ijws5LkdZpyhjfHnqKY30zmWvm67bpzAz0HLT8' },
    { src: 'https://unpkg.com/three@0.144.0/examples/js/loaders/OBJLoader.js',
      integrity: 'sha384-MQumaiEfGDwXNviMfAi7dVi/OySNARdLBSTN9g9G0ZRqzyBjGt+WwjcFUzjY1jRa' },
    { src: 'https://unpkg.com/three@0.144.0/examples/js/loaders/GLTFLoader.js',
      integrity: 'sha384-+T7zyJFelhxfE6dSQZg8EjauzcjsATKxdLDTMduCAXFzqTsOqUuYb5sjSTj00Kb3' },
  ];
  let _threeLoadStarted = false;
  const _threeReadyCbs = [];

  function _injectScript({ src, integrity }) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.integrity = integrity;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.async = false;             // keep execution order deterministic
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  function load(onReady) {
    if (_threeReady()) { if (onReady) onReady(); return; }
    if (onReady) _threeReadyCbs.push(onReady);
    if (_threeLoadStarted) return;
    _threeLoadStarted = true;
    // three.min.js must execute before the loaders (they extend THREE).
    _injectScript(_THREE_SCRIPTS[0])
      .then(() => Promise.all([_injectScript(_THREE_SCRIPTS[1]), _injectScript(_THREE_SCRIPTS[2])]))
      .then(() => {
        prewarm();   // build the scene now that Three.js exists
        _threeReadyCbs.splice(0).forEach(cb => { try { cb(); } catch (_) {} });
      })
      .catch((e) => { _threeLoadStarted = false; console.warn('[Landmarks3D] Three.js load failed:', e); });
  }

  function init(map) {
    _map = map;
    _ready = true;
    _ensureLabels();
    // NOTE: no prewarm() here — the 3D scene needs Three.js, which is now loaded
    // lazily (see load()) only when the user first enters 3D. init() runs at
    // startup purely to wire up the 2D landmark labels, which need no Three.js.

    // Load the pre-baked OSM tree positions once. If the scene shell already
    // exists, inject the trees immediately; otherwise the scene build
    // (_finalizeScene) picks up _treeData when it runs. _buildVegetation is
    // idempotent (_treesBuilt), so whichever path runs first wins.
    if (!_treeData) {
      fetch('/data/trees.json')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) { _treeData = d; if (_scene) _buildVegetation(); } })
        .catch(() => {});
    }

    // After setStyle() (theme / satellite toggle) MapLibre removes symbol
    // and custom layers; re-create labels and optionally the 3D mesh layer.
    if (!map.__landmarks3dHooked) {
      map.__landmarks3dHooked = true;
      let pending = false;
      map.on('styledata', () => {
        _ensureLabels();
        if (!_visible || pending) return;
        pending = true;
        const flush = () => {
          if (!_map || !_map.isStyleLoaded()) { setTimeout(flush, 80); return; }
          pending = false;
          if (!_visible) return;
          if (_map.getLayer(LAYER_ID)) {
            _raise();
          } else {
            try { _map.addLayer(_buildLayer()); }
            catch (e) { console.warn('[Landmarks3D] addLayer failed:', e); }
          }
          _raise();
          _map.triggerRepaint();
        };
        flush();
      });
    }
  }

  // Move the 3D layer and its labels to the very top of the stack.
  // setStyle() style-diff keeps custom layers but buries them under the
  // base raster; labels must stay above the 3D mesh so they are not hidden.
  function _raise() {
    if (!_map) return;
    if (_map.getLayer(LAYER_ID)) try { _map.moveLayer(LAYER_ID); } catch (_) {}
    // In 3D, every name/marker layer would otherwise be drawn under the 3D
    // building & landmark meshes. Lift them above the mesh — same treatment the
    // landmark labels get below. moveLayer() raises to the very TOP each call,
    // so list these bottom-to-top: area names ("TRANSIT ACCOMMODATION", "Tank
    // at Shaurya Sthal", the Type-B code) and building names were the layers
    // still buried under the custom models; POI markers stay above them.
    if (_labelOpts.is3D) {
      for (const id of ['areas-labels', 'buildings-labels', 'places-circles', 'places-labels']) {
        if (_map.getLayer(id)) try { _map.moveLayer(id); } catch (_) {}
      }
    }
    try {
      if (_map.getLayer(LABEL_LAYER_ID)) _map.moveLayer(LABEL_LAYER_ID);
    } catch (_) {}
  }

  function getLabelGeoJSON() {
    const features = [];
    for (const cfg of LANDMARKS) {
      if (!cfg.label) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [cfg.lng, cfg.lat] },
        properties: {
          name: cfg.label,
          offset_y: cfg.labelOffsetY ?? -0.5,
          offset_y_3d: cfg.labelOffsetY3d ?? -1.8,
        },
      });
    }
    return { type: 'FeatureCollection', features };
  }

  /** Lowercase names used to suppress duplicate place-marker labels. */
  function landmarkLabelNames() {
    return LANDMARKS.filter(l => l.label).map(l => l.label.toLowerCase().trim());
  }

  function show() {
    _visible = true;
    if (!_ready || !_threeReady()) return;
    if (!_sceneComplete) _startBuild();
    // If the user clicked 3D while a setStyle() is still loading (e.g.
    // immediately after toggling satellite off), addLayer would throw
    // "Style is not done loading". Defer until the style is ready.
    const tryAdd = () => {
      if (!_visible) return;
      if (_map.getLayer(LAYER_ID)) {
        _raise();
        try { _map.setLayoutProperty(LAYER_ID, 'visibility', 'visible'); } catch (_) {}
        _map.triggerRepaint();
        return;
      }
      if (!_map.isStyleLoaded()) { setTimeout(tryAdd, 80); return; }
      try { _map.addLayer(_buildLayer()); }
      catch (e) { console.warn('[Landmarks3D] addLayer failed:', e); }
      _raise();
      _map.triggerRepaint();
    };
    tryAdd();
  }

  function _applyNightEmissive(dark) {
    if (!_root) return;
    _root.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const apply = (m) => {
        if (!m.emissive) return;
        if (!m.userData._nightSaved) {
          m.userData._nightSaved = { e: m.emissive.getHex(), i: m.emissiveIntensity ?? 1 };
        }
        if (dark) {
          const c = m.color?.getHex?.() ?? 0xc4b5a0;
          m.emissive.setHex(c);
          m.emissiveIntensity = Math.max(0.24, (m.userData._nightSaved.i || 1) * 0.4 + 0.14);
        } else {
          m.emissive.setHex(m.userData._nightSaved.e);
          m.emissiveIntensity = m.userData._nightSaved.i;
        }
      };
      if (Array.isArray(obj.material)) obj.material.forEach(apply);
      else apply(obj.material);
    });
  }

  function syncSceneLighting(dark) {
    if (!_sunLight) return;
    if (dark) {
      _sunLight.intensity = 0.36;
      _sunLight.color.setHex(0x9cb0d8);
      _fillLight.intensity = 0.18;
      _fillLight.color.setHex(0x6a7a94);
      _ambientLight.intensity = 0.3;
      _ambientLight.color.setHex(0x8899b8);
    } else {
      _sunLight.intensity = 1.05;
      _sunLight.color.setHex(0xffffff);
      _fillLight.intensity = 0.45;
      _fillLight.color.setHex(0xffffff);
      _ambientLight.intensity = 0.35;
      _ambientLight.color.setHex(0xffffff);
    }
    _applyNightEmissive(dark);
    if (_map) _map.triggerRepaint();
  }

  function hide() {
    _visible = false;
    if (!_ready) return;
    if (_map.getLayer(LAYER_ID)) {
      try { _map.setLayoutProperty(LAYER_ID, 'visibility', 'none'); } catch (_) {}
    }
    if (_map) _map.triggerRepaint();
  }

  function isVisible() { return _visible; }
  function listIds() { return [LAYER_ID, LABEL_LAYER_ID]; }

  // Per-group fade: materials are shared across many landmarks (the
  // sandstone palette is reused everywhere), so to fade one landmark
  // without touching the others we clone its meshes' materials on first
  // fade and swap them back to the original on restore. The clones live in
  // group.userData.fadeOriginals so this remains idempotent.
  function _fadeGroup(group, opacity) {
    const transparent = opacity < 0.999;

    if (!transparent) {
      // Restore originals
      const origs = group.userData.fadeOriginals;
      if (origs) {
        origs.forEach(({ mesh, material }) => { mesh.material = material; });
        delete group.userData.fadeOriginals;
      }
      return;
    }

    if (!group.userData.fadeOriginals) {
      const origs = [];
      group.traverse(obj => {
        if (!obj.isMesh || !obj.material) return;
        const apply = (mat) => {
          const clone = mat.clone();
          clone.transparent = true;
          clone.depthWrite = false;
          return clone;
        };
        if (Array.isArray(obj.material)) {
          origs.push({ mesh: obj, material: obj.material });
          obj.material = obj.material.map(apply);
        } else {
          origs.push({ mesh: obj, material: obj.material });
          obj.material = apply(obj.material);
        }
      });
      group.userData.fadeOriginals = origs;
    }

    // Tune the clone opacity (cheap — no new allocation)
    group.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of list) m.opacity = opacity;
    });
  }

  // Apply opacity to every landmark group (or only those matching idSet).
  function _applyOpacity(opacity, idSet) {
    if (!_root) return;
    _root.children.forEach(group => {
      const id = group.userData?.landmarkId;
      if (idSet && !idSet.has(id)) {
        _fadeGroup(group, 1.0);  // ensure not-targeted groups are fully opaque
      } else {
        _fadeGroup(group, opacity);
      }
    });
    if (_map) _map.triggerRepaint();
  }

  // setOpacity(opacity)           → fade ALL landmarks (used to restore by passing 1.0)
  // setOpacity(opacity, [ids])    → fade only the named landmark groups
  function setOpacity(opacity, ids) {
    const idSet = Array.isArray(ids) ? new Set(ids) : null;
    _targetOpacity = opacity;
    _targetIds = idSet;
    _applyOpacity(opacity, idSet);
  }

  // [{ id, label, lng, lat }] — used by app.js to pick occluders
  function getLandmarks() {
    return LANDMARKS.map(l => ({ id: l.id, label: l.label || null, lng: l.lng, lat: l.lat }));
  }

  // OSM building IDs that a detailed landmark replaces — used by app.js to
  // suppress the plain extrusion under the model.
  function replacedBuildingIds() {
    const ids = [];
    for (const l of LANDMARKS) {
      if (Array.isArray(l.replacesOsmBuildings)) ids.push(...l.replacesOsmBuildings);
    }
    // The 3D berm sweeps stand in for the flat OSM "Berms" footprint polygons.
    ids.push(...BERM_IDS);
    return ids;
  }

  return {
    init, load, show, hide, isVisible, listIds, replacedBuildingIds, setOpacity, getLandmarks,
    getLabelGeoJSON, landmarkLabelNames, labelLayerId: () => LABEL_LAYER_ID,
    syncLabels, syncSceneLighting, raise: _raise, prewarm,
  };
})();
