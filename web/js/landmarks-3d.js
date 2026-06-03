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
      paving:   new THREE.MeshStandardMaterial({ color: 0xc7a679, metalness: 0.05, roughness: 0.85 }),
      pavingD:  new THREE.MeshStandardMaterial({ color: 0x8d6e4f, metalness: 0.05, roughness: 0.90 }),
      wood:     new THREE.MeshStandardMaterial({ color: 0xa67746, metalness: 0.05, roughness: 0.85 }),
      podInt: (hex) => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.10, roughness: 0.70, side: THREE.DoubleSide }),
    };

    // Single shipping-container restaurant. (E,N) is the centroid offset
    // from the Shamiyana POI; bearingDeg is the long-edge bearing
    // (0 = north, 90 = east). Width is along the long edge.
    function placeContainer({ E, N, w, d, bearingDeg, body, roof, stories = 1, sign = null }) {
      const c = new THREE.Group();
      const H = 2.7 * stories;

      const box = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), body);
      box.position.y = H / 2;
      c.add(box);

      // Slight roof overhang
      const roofMesh = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.22, d + 0.4), roof);
      roofMesh.position.y = H + 0.11;
      c.add(roofMesh);

      // Dark recessed door on the long (south-facing) side
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.95, 0.04), M.door);
      door.position.set(0, 0.975, d / 2 + 0.025);
      c.add(door);

      // Optional accent sign panel sitting on top of the container (e.g.
      // the orange Domino's signage above the blue base).
      if (sign) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.7, d + 0.5), sign);
        s.position.y = H + 0.22 + 0.35;
        c.add(s);
      }

      c.position.set(E, 0, -N);
      c.rotation.y = (90 - bearingDeg) * Math.PI / 180;
      return c;
    }

    // Concrete pipe seating pod — cylinder lying on its side, open at the
    // east end so the coloured interior is visible from the plaza.
    function placeTubePod({ E, N, interiorHex }) {
      const c = new THREE.Group();
      const R = 1.35, L = 3.0;

      const outer = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 24, 1, true), M.concrete);
      outer.rotation.z = Math.PI / 2;
      outer.position.y = R;
      c.add(outer);

      const innerMat = M.podInt(interiorHex);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.08, R - 0.08, L - 0.05, 24, 1, true), innerMat);
      inner.rotation.z = Math.PI / 2;
      inner.position.y = R;
      c.add(inner);

      // Solid back wall on one end (entrance is the opposite end)
      const cap = new THREE.Mesh(new THREE.CircleGeometry(R - 0.05, 24), innerMat);
      cap.position.set(-L / 2 + 0.03, R, 0);
      cap.rotation.y = -Math.PI / 2;
      c.add(cap);

      // Small artificial-turf pad in front of the entrance
      const pad = new THREE.Mesh(new THREE.BoxGeometry(L + 0.4, 0.06, 2 * R + 0.6), M.pavingD);
      pad.position.y = 0.03;
      c.add(pad);

      c.position.set(E, 0, -N);
      // Tubes lie east-west — entrance opens to the east (toward seating)
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

    // No ground pad — the campus area/paving layers underneath handle the
    //    surface, and a 40 × 44 m brown slab covered grass that's actually
    //    there. Just drop the structures onto the existing terrain.

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
    g.add(placeContainer({ E:   7.2, N:  18.1, w:  7.0, d: 4.5, bearingDeg: 110, body: M.cYellow, roof: M.roofGalv, stories: 2 })); // Baap of Rolls (yellow 2-storey)
    g.add(placeContainer({ E:  14.1, N:  15.7, w:  6.5, d: 2.5, bearingDeg: 108, body: M.cPink,   roof: M.roofRust })); // Prasadanam
    g.add(placeContainer({ E:  -7.9, N:  23.0, w:  6.0, d: 3.0, bearingDeg:  35, body: M.cBlue,   roof: M.roofGalv, sign: M.cOrange })); // Domino's
    g.add(placeContainer({ E: -16.4, N:   3.7, w: 10.0, d: 2.5, bearingDeg:  18, body: M.cBlue,   roof: M.roofGalv })); // Unnamed west container (Manchaha-style)

    // ── Five concrete tube pods, N–S row on the western edge of the
    //    central plaza. Now visible because the containers are no longer
    //    oversized.
    const podColors = [0xe8e0d0, 0xe8b430, 0x2f7fb8, 0xb83820, 0x3a8a4a]; // white, yellow, blue, red, green
    for (let i = 0; i < 5; i++) {
      g.add(placeTubePod({ E: -11.5, N: -2 + i * 3.4, interiorHex: podColors[i] }));
    }

    // ── Two tensile-fabric shade canopies above the open seating
    g.add(placeShade({ E:  5, N:  1, size: 6, height: 3.4 })); // SW central seating
    g.add(placeShade({ E:  6, N: 12, size: 7, height: 3.6 })); // NE central seating

    // ── Round amphitheatre stage between the food court and the road
    //    (north-east corner per the drone photos).
    g.add(placeStage({ E: 4, N: 24, radius: 3.5 }));

    // ── Picnic benches in the open central plaza between the rows
    [
      { E:  4, N:  1,  bearingDeg: 107 },
      { E:  7, N:  1,  bearingDeg: 107 },
      { E:  3, N: 11,  bearingDeg: 107 },
      { E:  7, N: 11,  bearingDeg: 107 },
      { E:  4, N: -1,  bearingDeg: 107 },
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
      material: MAT.gold,
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
  let _targetOpacity = 1.0;   // remembered so setOpacity called before the scene
                              // mounts still takes effect when meshes appear
  let _targetIds = null;      // null = apply to all; Set = apply only to these landmark ids

  // Reusable buffers — allocated once, mutated each frame
  const _rotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Y_UP_TO_Z_UP);
  const _projM = new THREE.Matrix4();
  const _localM = new THREE.Matrix4();
  const _scaleVec = new THREE.Vector3();

  function _ensureScene() {
    if (_scene) return;

    _scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 1.05);
    sun.position.set(0.5, -1, 0.8).normalize();
    _scene.add(sun);
    const fill = new THREE.DirectionalLight(0xfff2d5, 0.45);
    fill.position.set(-0.7, 0.6, 0.4).normalize();
    _scene.add(fill);
    _scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    _root = new THREE.Group();
    _scene.add(_root);

    _camera = new THREE.PerspectiveCamera();

    const originMc = maplibregl.MercatorCoordinate.fromLngLat([ORIGIN_LNG, ORIGIN_LAT], 0);
    _originMcX = originMc.x;
    _originMcY = originMc.y;
    _originMcZ = originMc.z;
    _mercPerMeter = originMc.meterInMercatorCoordinateUnits();

    for (const cfg of LANDMARKS) _addLandmark(cfg, originMc);

    // OSM-driven instanced trees (data may already be loaded; otherwise the
    // fetch in init() will call _buildVegetation() when it resolves).
    _buildVegetation();

    // If setOpacity was called before the scene existed, apply it now.
    if (_targetOpacity < 0.999) _applyOpacity(_targetOpacity, _targetIds);
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
        _ensureScene();
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
      },
      render(_gl, matrix) {
        if (!_scene || !_renderer) return;
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

  function init(map) {
    _map = map;
    _ready = true;
    _ensureLabels();

    // Load the pre-baked OSM tree positions once. If the scene is already
    // built, inject the trees immediately; otherwise _ensureScene() will pick
    // up _treeData when it runs.
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

  function hide() {
    _visible = false;
    if (!_ready) return;
    if (_map.getLayer(LAYER_ID)) {
      try { _map.setLayoutProperty(LAYER_ID, 'visibility', 'none'); } catch (_) {}
    }
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
    return ids;
  }

  return {
    init, show, hide, isVisible, listIds, replacedBuildingIds, setOpacity, getLandmarks,
    getLabelGeoJSON, landmarkLabelNames, labelLayerId: () => LABEL_LAYER_ID,
    syncLabels, raise: _raise,
  };
})();
