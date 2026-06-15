import * as THREE from 'three';

export const ARENA = { size: 60, wall: 3 };

// ---------------------------------------------------------------------------
// Scene, lights, sky
// ---------------------------------------------------------------------------
export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x86d7ff);
  scene.fog = new THREE.Fog(0x86d7ff, 55, 110);

  // Lights — bright, friendly, Roblox-ish
  const hemi = new THREE.HemisphereLight(0xffffff, 0x6a8f4f, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.15);
  sun.position.set(30, 55, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = ARENA.size;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  buildArena(scene);
  buildClouds(scene);
  return scene;
}

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0, ...opts });

function buildArena(scene) {
  const half = ARENA.size;

  // Checkerboard grass floor for that playful map feel
  const tile = 6;
  const tilesPerSide = Math.ceil((half * 2) / tile);
  const geo = new THREE.BoxGeometry(tile, 1, tile);
  const matA = mat(0x6dbb4a);
  const matB = mat(0x7fce5a);
  const floor = new THREE.Group();
  for (let x = 0; x < tilesPerSide; x++) {
    for (let z = 0; z < tilesPerSide; z++) {
      const m = new THREE.Mesh(geo, (x + z) % 2 ? matA : matB);
      m.position.set(-half + tile / 2 + x * tile, -0.5, -half + tile / 2 + z * tile);
      m.receiveShadow = true;
      floor.add(m);
    }
  }
  scene.add(floor);

  // Colorful perimeter walls
  const wallColors = [0xff5a5a, 0x4db1ff, 0xffd23f, 0x9b5de5];
  const wallH = 6;
  const wallDefs = [
    { x: 0, z: -half, w: half * 2, d: ARENA.wall },
    { x: 0, z: half, w: half * 2, d: ARENA.wall },
    { x: -half, z: 0, w: ARENA.wall, d: half * 2 },
    { x: half, z: 0, w: ARENA.wall, d: half * 2 },
  ];
  wallDefs.forEach((wd, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(wd.w, wallH, wd.d), mat(wallColors[i]));
    m.position.set(wd.x, wallH / 2, wd.z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
  });

  // Decorative props: blocky trees + crates + a fountain platform
  const rand = mulberry32(1337);
  for (let i = 0; i < 16; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = 8 + rand() * (half - 12);
    const px = Math.cos(angle) * radius;
    const pz = Math.sin(angle) * radius;
    if (rand() > 0.45) scene.add(makeTree(px, pz));
    else scene.add(makeCrate(px, pz, rand));
  }

  // Center podium
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 1, 8), mat(0xd9c2a3));
  podium.position.set(0, 0.5, 0);
  podium.receiveShadow = true; podium.castShadow = true;
  scene.add(podium);
}

function makeTree(x, z) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4, 1.2), mat(0x7a4f28));
  trunk.position.y = 2; trunk.castShadow = true;
  const leaves = new THREE.Mesh(new THREE.BoxGeometry(4.5, 4.5, 4.5), mat(0x3fa34d));
  leaves.position.y = 5.5; leaves.castShadow = true;
  g.add(trunk, leaves);
  g.position.set(x, 0, z);
  g.rotation.y = Math.random() * Math.PI;
  g.userData.solid = { x, z, r: 2.4 };
  return g;
}

function makeCrate(x, z, rand) {
  const s = 1.6 + rand() * 1.2;
  const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat(0xb5793c));
  m.position.set(x, s / 2, z);
  m.rotation.y = rand() * Math.PI;
  m.castShadow = true; m.receiveShadow = true;
  m.userData.solid = { x, z, r: s * 0.7 };
  return m;
}

function buildClouds(scene) {
  const rand = mulberry32(99);
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const n = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const s = 4 + rand() * 5;
      const puff = new THREE.Mesh(
        new THREE.BoxGeometry(s, s * 0.6, s),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92 })
      );
      puff.position.set((rand() - 0.5) * 10, (rand() - 0.5) * 2, (rand() - 0.5) * 10);
      cloud.add(puff);
    }
    cloud.position.set((rand() - 0.5) * 180, 35 + rand() * 20, (rand() - 0.5) * 180);
    scene.add(cloud);
  }
}

// ---------------------------------------------------------------------------
// Blocky humanoid character (Roblox-style)
// ---------------------------------------------------------------------------
export function createCharacter({ body = 0xffcf6e, shirt = 0x3aa0ff, pants = 0x37475a, face = true, weaponSkin = null } = {}) {
  const g = new THREE.Group();
  const skin = mat(body);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 0.8), mat(shirt));
  torso.position.y = 2.1; torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), skin);
  head.position.y = 3.45; head.castShadow = true;
  g.add(head);

  if (face) {
    const eyeMat = mat(0x222222);
    const eyeGeo = new THREE.BoxGeometry(0.16, 0.22, 0.06);
    for (const sx of [-0.26, 0.26]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(sx, 3.55, 0.56);
      g.add(eye);
    }
    const smile = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.06), mat(0x6b3a2a));
    smile.position.set(0, 3.2, 0.56);
    g.add(smile);
  }

  // Arms
  const armGeo = new THREE.BoxGeometry(0.45, 1.5, 0.45);
  const makeArm = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 2.85, 0);
    const arm = new THREE.Mesh(armGeo, skin);
    arm.position.y = -0.75; arm.castShadow = true;
    pivot.add(arm);
    g.add(pivot);
    return pivot;
  };
  const leftArm = makeArm(-0.95);
  const rightArm = makeArm(0.95);

  // Legs
  const legGeo = new THREE.BoxGeometry(0.5, 1.5, 0.5);
  const makeLeg = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 1.3, 0);
    const leg = new THREE.Mesh(legGeo, mat(pants));
    leg.position.y = -0.75; leg.castShadow = true;
    pivot.add(leg);
    g.add(pivot);
    return pivot;
  };
  const leftLeg = makeLeg(-0.35);
  const rightLeg = makeLeg(0.35);

  // optional held stick (enemies carry one so they can bonk back)
  let heldStick = null;
  if (weaponSkin) {
    heldStick = buildHeldStick(weaponSkin);
    rightArm.add(heldStick);
  }

  g.userData.parts = { torso, head, leftArm, rightArm, leftLeg, rightLeg, skinMat: skin, shirtMat: torso.material, heldStick };
  return g;
}

// Cosmetic hat builder — authored for the character scale (head top ~y4), so it can
// be added directly to a createCharacter() group (locker preview AND remote players).
export function makeHat(item) {
  const g = new THREE.Group();
  g.position.y = 4.05;
  const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
  switch (item.kind) {
    case 'tophat':
      g.add(meshAt(new THREE.CylinderGeometry(0.85, 0.85, 0.1, 16), m(0x111111), 0));
      g.add(meshAt(new THREE.CylinderGeometry(0.55, 0.55, 1, 16), m(0x111111), 0.55));
      break;
    case 'crown': {
      const band = meshAt(new THREE.CylinderGeometry(0.62, 0.62, 0.5, 12), m(item.color), 0.25);
      g.add(band);
      for (let i = 0; i < 6; i++) {
        const sp = meshAt(new THREE.ConeGeometry(0.12, 0.45, 6), m(item.color), 0.6);
        const a = (i / 6) * Math.PI * 2;
        sp.position.x = Math.cos(a) * 0.5; sp.position.z = Math.sin(a) * 0.5;
        g.add(sp);
      }
      break;
    }
    case 'party':
      g.add(meshAt(new THREE.ConeGeometry(0.5, 1.2, 16), m(item.color), 0.6));
      break;
    case 'beanie':
      g.add(meshAt(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(item.color), 0.16));
      g.add(meshAt(new THREE.CylinderGeometry(0.6, 0.6, 0.18, 14), m(item.color), 0.04));
      g.add(meshAt(new THREE.SphereGeometry(0.14, 8, 8), m(item.accent || 0xffffff), 0.82));
      break;
    case 'bucket':
      g.add(meshAt(new THREE.CylinderGeometry(0.55, 0.6, 0.55, 16), m(item.color), 0.3));
      g.add(meshAt(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 16), m(item.color), 0.04));
      break;
    case 'cowboy':
      g.add(meshAt(new THREE.CylinderGeometry(0.95, 1.0, 0.08, 18), m(item.color), 0.06));
      g.add(meshAt(new THREE.CylinderGeometry(0.45, 0.55, 0.7, 14), m(item.color), 0.45));
      break;
    case 'wizard': {
      g.add(meshAt(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 18), m(item.color), 0.05));
      const wcone = meshAt(new THREE.ConeGeometry(0.48, 1.5, 14), m(item.color), 0.85); wcone.rotation.z = 0.12; g.add(wcone);
      g.add(meshAt(new THREE.OctahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: item.accent || 0xffd23f, emissive: item.accent || 0xffd23f, emissiveIntensity: 0.6 }), 1.15, 0.12));
      break;
    }
    case 'pirate':
      g.add(meshAt(new THREE.CylinderGeometry(0.92, 0.98, 0.12, 3), m(item.color), 0.12));
      g.add(meshAt(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(item.color), 0.1));
      break;
    case 'viking':
      g.add(meshAt(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(item.color), 0.1));
      g.add(meshAt(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 14), m(item.accent || 0x888888), 0.12));
      for (const s of [-1, 1]) { const h = meshAt(new THREE.ConeGeometry(0.13, 0.6, 8), m(0xeee4c0), 0.55, s * 0.6); h.rotation.z = s * 0.9; g.add(h); }
      break;
    case 'halo': {
      const ring = meshAt(new THREE.TorusGeometry(0.45, 0.08, 10, 24), new THREE.MeshStandardMaterial({ color: item.color, emissive: item.color, emissiveIntensity: 1 }), 0.95);
      ring.rotation.x = Math.PI / 2; g.add(ring);
      break;
    }
    case 'horns':
      for (const s of [-1, 1]) { const h = meshAt(new THREE.ConeGeometry(0.14, 0.5, 8), m(item.color), 0.5, s * 0.35); h.rotation.z = -s * 0.4; g.add(h); }
      break;
    case 'catears':
      for (const s of [-1, 1]) { const e = meshAt(new THREE.ConeGeometry(0.24, 0.42, 4), m(item.color), 0.45, s * 0.34); e.scale.set(1, 1, 0.5); g.add(e); const inr = meshAt(new THREE.ConeGeometry(0.13, 0.26, 4), m(item.accent || 0xff7ec2), 0.45, s * 0.34); inr.scale.set(1, 1, 0.5); inr.position.z = 0.06; g.add(inr); }
      break;
    case 'bunny':
      for (const s of [-1, 1]) { const e = meshAt(new THREE.CylinderGeometry(0.1, 0.14, 0.85, 8), m(item.color), 0.62, s * 0.24); e.rotation.z = s * 0.16; g.add(e); }
      break;
    case 'propeller':
      g.add(meshAt(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(item.color), 0.1));
      g.add(meshAt(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), m(0x333333), 0.52));
      for (let i = 0; i < 3; i++) { const bl = meshAt(new THREE.BoxGeometry(0.5, 0.04, 0.12), m(item.accent || 0xff3b3b), 0.66); bl.rotation.y = (i / 3) * Math.PI * 2; g.add(bl); }
      break;
    case 'headphones': {
      g.add(meshAt(new THREE.TorusGeometry(0.62, 0.07, 8, 18, Math.PI), m(item.color), 0.42));
      for (const s of [-1, 1]) { const cup = meshAt(new THREE.CylinderGeometry(0.18, 0.18, 0.2, 14), m(item.accent || 0x222222), 0.0, s * 0.62); cup.rotation.z = Math.PI / 2; g.add(cup); }
      break;
    }
    case 'flower': {
      const band = meshAt(new THREE.TorusGeometry(0.55, 0.07, 8, 20), m(item.accent || 0x3a8a2a), 0.28); band.rotation.x = Math.PI / 2; g.add(band);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const fl = meshAt(new THREE.SphereGeometry(0.14, 8, 8), m(item.color), 0.34, Math.cos(a) * 0.55); fl.position.z = Math.sin(a) * 0.55; g.add(fl); }
      break;
    }
    case 'chef':
      g.add(meshAt(new THREE.CylinderGeometry(0.45, 0.45, 0.45, 14), m(item.color), 0.32));
      g.add(meshAt(new THREE.SphereGeometry(0.55, 12, 8), m(item.color), 0.72));
      break;
    case 'santa': {
      g.add(meshAt(new THREE.CylinderGeometry(0.62, 0.62, 0.18, 14), m(0xffffff), 0.05));
      const scone = meshAt(new THREE.ConeGeometry(0.5, 1.1, 14), m(item.color), 0.72); scone.rotation.z = 0.35; scone.position.x = 0.18; g.add(scone);
      g.add(meshAt(new THREE.SphereGeometry(0.13, 8, 8), m(0xffffff), 1.16, 0.42));
      break;
    }
    case 'mohawk':
      for (let i = 0; i < 5; i++) { const sp = meshAt(new THREE.ConeGeometry(0.12, 0.5 + (i === 2 ? 0.25 : Math.abs(2 - i) * -0.06), 4), m(item.color), 0.45, 0, -0.4 + i * 0.2); g.add(sp); }
      break;
    case 'antenna':
      for (const s of [-1, 1]) { const stalk = meshAt(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), m(0x333333), 0.5, s * 0.25); stalk.rotation.z = s * 0.25; g.add(stalk); g.add(meshAt(new THREE.SphereGeometry(0.11, 8, 8), new THREE.MeshStandardMaterial({ color: item.color, emissive: item.color, emissiveIntensity: 0.8 }), 0.8, s * 0.36)); }
      break;
    case 'bow':
      for (const s of [-1, 1]) { const lobe = meshAt(new THREE.ConeGeometry(0.3, 0.42, 4), m(item.color), 0.5, s * 0.26); lobe.rotation.z = s * Math.PI / 2; lobe.scale.set(1, 1, 0.5); g.add(lobe); }
      g.add(meshAt(new THREE.SphereGeometry(0.13, 8, 8), m(item.accent || item.color), 0.5));
      break;
    case 'cap':
    default:
      g.add(meshAt(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(item.color), 0.1));
      g.add(meshAt(new THREE.BoxGeometry(0.7, 0.1, 0.5), m(item.color), 0.05, 0, -0.5));
      break;
  }
  return g;
  function meshAt(geo, mat, y, x = 0, z = 0) { const me = new THREE.Mesh(geo, mat); me.position.set(x, y, z); return me; }
}

// A stick scaled + posed to sit in a character's right hand (no point light — there
// can be many enemies on screen, so we keep their sticks light-free for performance).
export function buildHeldStick(skin) {
  const w = buildStick(skin, false);
  w.scale.setScalar(0.55);
  w.position.set(0, -1.35, 0.25);   // in the hand, at the bottom of the arm
  w.rotation.set(0.5, 0, 0);
  w.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return w;
}

// ---------------------------------------------------------------------------
// Stick factory — builds a stick group for a given skin definition
// ---------------------------------------------------------------------------
const LEN = 2.2;
const TOP = LEN / 2;
const glowMat = (color, intensity = 0.9) => new THREE.MeshStandardMaterial({
  color, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.2,
});
function stickHandle(color) {
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 8), mat(color, { roughness: 0.95 }));
  h.position.y = -TOP + 0.15;
  return h;
}
const M = (geo, material) => new THREE.Mesh(geo, material);

export function buildStick(skin, withLight = true) {
  const g = new THREE.Group();
  const builder = STICK_BUILDERS[skin.style] || STICK_BUILDERS.wood;
  builder(g, skin.colors, { withLight });
  return g;
}

// Each builder fills the group `g` with meshes for one stick style.
// Convention: stick points up the +Y axis, blade/head at +TOP, handle at -TOP.
const STICK_BUILDERS = {
  // ---------- original eight ----------
  wood(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.1, 0.14, LEN, 8), mat(c.main)));
    const knot = M(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), mat(c.accent));
    knot.position.set(0.12, 0.3, 0); knot.rotation.z = -0.8;
    g.add(knot, stickHandle(c.accent));
  },
  paddle(g, c) {
    g.add(M(new THREE.BoxGeometry(0.7, LEN, 0.12), mat(c.main)), stickHandle(c.accent));
  },
  metal(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.1, 0.12, LEN, 10), mat(c.main, { metalness: 0.85, roughness: 0.25 })));
    const tip = M(new THREE.SphereGeometry(0.18, 12, 12), mat(c.accent, { metalness: 0.9, roughness: 0.15 }));
    tip.position.y = TOP; g.add(tip, stickHandle(c.accent));
  },
  stripe(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.11, 0.13, LEN, 10), mat(c.main)));
    for (let i = 0; i < 6; i++) {
      const ring = M(new THREE.CylinderGeometry(0.135, 0.135, 0.18, 10), mat(c.accent));
      ring.position.y = -TOP + 0.2 + i * 0.38; g.add(ring);
    }
    const hook = M(new THREE.TorusGeometry(0.25, 0.12, 8, 12, Math.PI), mat(c.main));
    hook.position.y = TOP; hook.rotation.z = Math.PI / 2; g.add(hook);
  },
  glow(g, c, x) {
    g.add(M(new THREE.CylinderGeometry(0.14, 0.16, LEN, 10), glowMat(c.main)));
    const tip = M(new THREE.IcosahedronGeometry(0.28, 0), glowMat(c.accent)); tip.position.y = TOP;
    g.add(tip, stickHandle(0x222222));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.main, 1.4, 8); l.position.y = TOP; g.add(l); }
  },
  beam(g, c, x) {
    const hilt = M(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 10), mat(0x2a2a2a, { metalness: 0.8, roughness: 0.3 }));
    hilt.position.y = -TOP + 0.35;
    const blade = M(new THREE.CylinderGeometry(0.1, 0.1, LEN - 0.7, 12), glowMat(c.main)); blade.position.y = 0.35;
    g.add(hilt, blade);
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.main, 1.8, 9); l.position.y = 0.5; g.add(l); }
  },
  club(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.12, 0.18, LEN, 10), mat(c.main)));
    const knob = M(new THREE.SphereGeometry(0.32, 12, 12), mat(c.accent)); knob.position.y = TOP;
    g.add(knob, stickHandle(c.accent));
  },
  rainbow(g, c, x) {
    const shaft = M(new THREE.CylinderGeometry(0.13, 0.15, LEN, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff00ff, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.4 }));
    const head = M(new THREE.BoxGeometry(0.7, 0.5, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff00aa, emissiveIntensity: 0.7, roughness: 0.3 }));
    head.position.y = TOP;
    g.add(shaft, head, stickHandle(0x222222));
    g.userData.rainbow = [shaft.material, head.material];
    if (x.withLight) { const l = new THREE.PointLight(0xff66ff, 1.6, 9); l.position.y = TOP; g.add(l); }
  },

  // ---------- bladed ----------
  katana(g, c) {
    const blade = M(new THREE.BoxGeometry(0.14, LEN * 1.05, 0.04), mat(c.main, { metalness: 0.9, roughness: 0.15 }));
    blade.position.y = 0.15; blade.rotation.z = 0.05;
    const edge = M(new THREE.BoxGeometry(0.04, LEN * 1.05, 0.05), mat(c.accent, { metalness: 0.95, roughness: 0.08 }));
    edge.position.set(0.06, 0.15, 0); edge.rotation.z = 0.05;
    const guard = M(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12), mat(0x2a2a2a, { metalness: 0.7 }));
    guard.rotation.x = Math.PI / 2; guard.position.y = -TOP + 0.45;
    const hilt = M(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8), mat(c.glow || 0x111111));
    hilt.position.y = -TOP + 0.15;
    g.add(blade, edge, guard, hilt);
  },
  cleaver(g, c) {
    const blade = M(new THREE.BoxGeometry(0.55, LEN * 0.72, 0.05), mat(c.main, { metalness: 0.85, roughness: 0.2 }));
    blade.position.y = 0.35;
    const spine = M(new THREE.BoxGeometry(0.08, LEN * 0.72, 0.07), mat(c.accent, { metalness: 0.6 }));
    spine.position.set(-0.27, 0.35, 0);
    g.add(blade, spine, stickHandle(c.accent));
  },
  dagger(g, c) {
    const blade = M(new THREE.CylinderGeometry(0.02, 0.16, LEN * 0.7, 4), mat(c.main, { metalness: 0.9, roughness: 0.15 }));
    blade.position.y = 0.35; blade.rotation.y = Math.PI / 4;
    const guard = M(new THREE.BoxGeometry(0.5, 0.08, 0.1), mat(c.accent, { metalness: 0.7 })); guard.position.y = -0.1;
    const grip = M(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), mat(0x222222)); grip.position.y = -0.45;
    const pommel = M(new THREE.SphereGeometry(0.1, 8, 8), mat(c.accent, { metalness: 0.8 })); pommel.position.y = -0.78;
    g.add(blade, guard, grip, pommel);
  },
  rapier(g, c) {
    const blade = M(new THREE.CylinderGeometry(0.02, 0.05, LEN * 1.05, 6), mat(c.main, { metalness: 0.95, roughness: 0.1 }));
    blade.position.y = 0.2;
    const bell = M(new THREE.SphereGeometry(0.18, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(c.accent, { metalness: 0.85 }));
    bell.position.y = -TOP + 0.55; bell.rotation.x = Math.PI;
    const grip = M(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), mat(0x222222)); grip.position.y = -TOP + 0.3;
    const pommel = M(new THREE.SphereGeometry(0.08, 8, 8), mat(c.accent, { metalness: 0.85 })); pommel.position.y = -TOP + 0.05;
    g.add(blade, bell, grip, pommel);
  },
  broadsword(g, c) {
    const blade = M(new THREE.BoxGeometry(0.22, LEN * 0.95, 0.05), mat(c.main, { metalness: 0.9, roughness: 0.15 })); blade.position.y = 0.25;
    const fuller = M(new THREE.BoxGeometry(0.05, LEN * 0.8, 0.07), mat(c.accent, { metalness: 0.7 })); fuller.position.y = 0.25;
    const guard = M(new THREE.BoxGeometry(0.55, 0.1, 0.12), mat(c.accent, { metalness: 0.8 })); guard.position.y = -TOP + 0.5;
    const grip = M(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), mat(0x222222)); grip.position.y = -TOP + 0.25;
    const pommel = M(new THREE.SphereGeometry(0.1, 8, 8), mat(c.accent, { metalness: 0.8 })); pommel.position.y = -TOP;
    g.add(blade, fuller, guard, grip, pommel);
  },
  scythe(g, c) {
    const pole = M(new THREE.CylinderGeometry(0.07, 0.08, LEN * 1.1, 8), mat(c.glow || 0x3a2a1a)); pole.position.y = -0.05;
    const blade = M(new THREE.TorusGeometry(0.5, 0.06, 6, 16, Math.PI * 0.9), mat(c.main, { metalness: 0.85, roughness: 0.2 }));
    blade.position.set(0.1, TOP - 0.1, 0); blade.rotation.z = -0.4;
    const edge = M(new THREE.TorusGeometry(0.56, 0.02, 6, 16, Math.PI * 0.9), mat(c.accent, { metalness: 0.9 }));
    edge.position.copy(blade.position); edge.rotation.copy(blade.rotation);
    g.add(pole, blade, edge);
  },
  starblade(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.06, 0.08, LEN, 8), mat(0x2b2b3a)));
    const grp = new THREE.Group(); grp.position.y = TOP;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const pt = M(new THREE.ConeGeometry(0.12, 0.45, 3), mat(c.main, { metalness: 0.9, roughness: 0.15 }));
      pt.scale.set(0.5, 1, 0.08); pt.position.set(Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0); pt.rotation.z = a - Math.PI / 2;
      grp.add(pt);
    }
    const hub = M(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12), mat(c.accent, { metalness: 0.9 })); hub.rotation.x = Math.PI / 2;
    grp.add(hub); g.add(grp, stickHandle(c.accent));
  },
  cyber(g, c, x) {
    const blade = M(new THREE.BoxGeometry(0.16, LEN * 0.95, 0.04), mat(0x1a2230, { metalness: 0.8, roughness: 0.2 })); blade.position.y = 0.2;
    g.add(blade);
    for (let i = 0; i < 4; i++) { const line = M(new THREE.BoxGeometry(0.1, 0.03, 0.05), glowMat(c.main, 1)); line.position.set(i % 2 ? 0.03 : -0.03, -0.1 + i * 0.4, 0.02); g.add(line); }
    const spine = M(new THREE.BoxGeometry(0.03, LEN * 0.95, 0.05), glowMat(c.accent, 0.8)); spine.position.set(-0.08, 0.2, 0); g.add(spine);
    g.add(stickHandle(0x1a2230));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.main, 1, 6); l.position.y = 0.5; g.add(l); }
  },
  demon(g, c, x) {
    g.add(M(new THREE.CylinderGeometry(0.07, 0.09, LEN, 8), mat(0x1a1020, { metalness: 0.4, roughness: 0.6 })));
    const blade = M(new THREE.ConeGeometry(0.16, 0.8, 4), glowMat(c.accent, 0.7)); blade.position.y = TOP + 0.15; blade.rotation.y = Math.PI / 4; g.add(blade);
    for (const s of [1, -1]) { const horn = M(new THREE.ConeGeometry(0.06, 0.4, 5), mat(c.main, { roughness: 0.5 })); horn.position.set(0.16 * s, TOP - 0.2, 0); horn.rotation.z = s * 0.9; g.add(horn); }
    g.add(stickHandle(0x1a1020));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.accent, 1, 6); l.position.y = TOP; g.add(l); }
  },

  // ---------- pole / heavy ----------
  spear(g, c) {
    const shaft = M(new THREE.CylinderGeometry(0.06, 0.07, LEN, 8), mat(c.glow || 0x5a4030)); shaft.position.y = -0.2; g.add(shaft);
    const head = M(new THREE.ConeGeometry(0.16, 0.7, 4), mat(c.main, { metalness: 0.9, roughness: 0.15 })); head.position.y = TOP; head.rotation.y = Math.PI / 4; g.add(head);
    const collar = M(new THREE.CylinderGeometry(0.09, 0.12, 0.18, 8), mat(c.accent, { metalness: 0.8 })); collar.position.y = TOP - 0.4; g.add(collar);
  },
  trident(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.07, 0.08, LEN, 8), mat(c.glow || 0x2a3a4a, { metalness: 0.6 })));
    const base = M(new THREE.BoxGeometry(0.5, 0.08, 0.08), mat(c.accent, { metalness: 0.8 })); base.position.y = TOP - 0.35; g.add(base);
    for (const xx of [-0.22, 0, 0.22]) { const p = M(new THREE.ConeGeometry(0.06, 0.55, 4), mat(c.main, { metalness: 0.9, roughness: 0.15 })); p.position.set(xx, TOP + 0.05, 0); g.add(p); }
  },
  harpoon(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.06, 0.07, LEN, 8), mat(c.accent, { metalness: 0.5 })));
    const head = M(new THREE.ConeGeometry(0.13, 0.5, 6), mat(c.main, { metalness: 0.9, roughness: 0.2 })); head.position.y = TOP; g.add(head);
    for (const s of [1, -1]) { const barb = M(new THREE.ConeGeometry(0.06, 0.25, 4), mat(c.main, { metalness: 0.9 })); barb.position.set(0.1 * s, TOP - 0.25, 0); barb.rotation.z = s * 2.4; g.add(barb); }
    g.add(stickHandle(c.accent));
  },
  warhammer(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.1, 0.12, LEN, 8), mat(c.glow || 0x3a2a1a)));
    const head = M(new THREE.BoxGeometry(0.55, 0.5, 0.55), mat(c.main, { metalness: 0.7, roughness: 0.4 })); head.position.y = TOP - 0.1; g.add(head);
    const trim = M(new THREE.BoxGeometry(0.58, 0.12, 0.58), mat(c.accent, { metalness: 0.8 })); trim.position.y = TOP - 0.1; g.add(trim);
    g.add(stickHandle(c.accent));
  },
  mace(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.08, 0.1, LEN, 8), mat(c.glow || 0x3a2a1a)));
    const ball = M(new THREE.IcosahedronGeometry(0.3, 0), mat(c.main, { metalness: 0.6, roughness: 0.4 })); ball.position.y = TOP; g.add(ball);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const sp = M(new THREE.ConeGeometry(0.07, 0.22, 4), mat(c.accent, { metalness: 0.6 })); sp.position.set(Math.cos(a) * 0.34, TOP + (i % 2 ? 0.1 : -0.1), Math.sin(a) * 0.34); sp.rotation.z = -a + Math.PI / 2; sp.rotation.x = Math.PI / 2; g.add(sp); }
    g.add(stickHandle(c.accent));
  },
  flail(g, c) {
    const grip = M(new THREE.CylinderGeometry(0.09, 0.11, LEN * 0.7, 8), mat(c.accent)); grip.position.y = -TOP + 0.55; g.add(grip);
    for (let i = 0; i < 3; i++) { const link = M(new THREE.TorusGeometry(0.06, 0.025, 6, 10), mat(0x888888, { metalness: 0.8 })); link.position.y = 0.15 + i * 0.16; link.rotation.x = i % 2 ? 0 : Math.PI / 2; g.add(link); }
    const ball = M(new THREE.IcosahedronGeometry(0.26, 0), mat(c.main, { metalness: 0.5, roughness: 0.5 })); ball.position.y = TOP; g.add(ball);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const sp = M(new THREE.ConeGeometry(0.06, 0.18, 4), mat(c.main, { metalness: 0.5 })); sp.position.set(Math.cos(a) * 0.28, TOP, Math.sin(a) * 0.28); sp.rotation.z = -a + Math.PI / 2; sp.rotation.x = Math.PI / 2; g.add(sp); }
  },
  axe(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.07, 0.09, LEN, 8), mat(c.glow || 0x5a4030)));
    const head = M(new THREE.ConeGeometry(0.4, 0.6, 3), mat(c.main, { metalness: 0.85, roughness: 0.2 }));
    head.scale.set(0.16, 1, 1); head.rotation.z = -Math.PI / 2; head.position.set(0.28, TOP - 0.25, 0);
    g.add(head, stickHandle(c.accent));
  },
  doubleaxe(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.07, 0.09, LEN, 8), mat(c.glow || 0x5a4030)));
    for (const s of [1, -1]) { const head = M(new THREE.ConeGeometry(0.38, 0.55, 3), mat(c.main, { metalness: 0.85, roughness: 0.2 })); head.scale.set(0.16, 1, 1); head.rotation.z = -Math.PI / 2 * s; head.position.set(0.26 * s, TOP - 0.25, 0); g.add(head); }
    g.add(stickHandle(c.accent));
  },
  pickaxe(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.07, 0.09, LEN, 8), mat(c.accent)));
    for (const s of [1, -1]) { const pick = M(new THREE.ConeGeometry(0.08, 0.5, 6), mat(c.main, { metalness: 0.8, roughness: 0.3 })); pick.rotation.z = -Math.PI / 2 * s; pick.position.set(0.32 * s, TOP - 0.2, 0); g.add(pick); }
    g.add(stickHandle(c.accent));
  },
  bat(g, c) {
    const body = M(new THREE.CylinderGeometry(0.22, 0.09, LEN, 12), mat(c.main, { roughness: 0.6 })); body.position.y = 0.1; g.add(body);
    const knob = M(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 12), mat(c.accent)); knob.position.y = -TOP + 0.05; g.add(knob);
    for (let i = 0; i < 4; i++) { const t = M(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10), mat(c.accent)); t.position.y = -TOP + 0.2 + i * 0.12; g.add(t); }
  },
  bone(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.1, 0.12, LEN * 0.85, 8), mat(c.main, { roughness: 0.7 })));
    for (const y of [TOP - 0.1, -TOP + 0.1]) for (const xx of [-0.14, 0.14]) { const k = M(new THREE.SphereGeometry(0.17, 10, 10), mat(c.main, { roughness: 0.7 })); k.position.set(xx, y, 0); g.add(k); }
    const crack = M(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), mat(c.accent)); crack.position.set(0.05, 0.2, 0.1); crack.rotation.z = 0.3; g.add(crack);
  },
  nunchaku(g, c) {
    for (const s of [1, -1]) { const rod = M(new THREE.CylinderGeometry(0.09, 0.09, 0.9, 8), mat(c.main, { roughness: 0.5 })); rod.position.set(s * 0.18, s > 0 ? -0.3 : 0.3, 0); rod.rotation.z = s * 0.25; g.add(rod); }
    for (let i = 0; i < 3; i++) { const link = M(new THREE.TorusGeometry(0.05, 0.02, 6, 8), mat(c.accent, { metalness: 0.8 })); link.position.y = 0.18 - i * 0.12; link.rotation.x = i % 2 ? 0 : Math.PI / 2; g.add(link); }
  },

  // ---------- gem / elemental ----------
  gem(g, c, x) {
    const m = new THREE.MeshStandardMaterial({ color: c.main, emissive: c.glow || c.main, emissiveIntensity: 0.3, metalness: 0.2, roughness: 0.05 });
    const blade = M(new THREE.OctahedronGeometry(0.28, 0), m); blade.scale.set(0.6, 2.6, 0.4); blade.position.y = 0.4; g.add(blade);
    for (let i = 0; i < 3; i++) { const sm = M(new THREE.OctahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: c.accent, emissive: c.accent, emissiveIntensity: 0.4 })); sm.position.set(i % 2 ? 0.12 : -0.12, -0.2 + i * 0.45, 0); g.add(sm); }
    g.add(stickHandle(c.accent));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.main, 0.8, 6); l.position.y = 0.5; g.add(l); }
  },
  flame(g, c, x) {
    g.add(M(new THREE.CylinderGeometry(0.08, 0.1, LEN, 8), mat(0x222222, { metalness: 0.5, roughness: 0.4 })));
    const f1 = M(new THREE.ConeGeometry(0.26, 0.8, 8), glowMat(c.main, 0.9)); f1.position.y = TOP + 0.15; g.add(f1);
    const f2 = M(new THREE.ConeGeometry(0.14, 0.5, 8), glowMat(c.accent, 1)); f2.position.y = TOP + 0.32; g.add(f2);
    g.add(stickHandle(0x222222));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.main, 1.3, 7); l.position.y = TOP; g.add(l); }
  },
  ice(g, c, x) {
    const m = new THREE.MeshStandardMaterial({ color: c.main, emissive: c.glow || 0x113355, emissiveIntensity: 0.25, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.92 });
    g.add(M(new THREE.CylinderGeometry(0.09, 0.12, LEN, 6), m));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const sh = M(new THREE.ConeGeometry(0.1, 0.55, 5), m); sh.position.set(Math.cos(a) * 0.12, TOP - 0.05, Math.sin(a) * 0.12); sh.rotation.z = Math.cos(a) * 0.5; sh.rotation.x = Math.sin(a) * 0.5; g.add(sh); }
    const core = M(new THREE.OctahedronGeometry(0.2, 0), glowMat(c.accent, 0.5)); core.position.y = TOP; g.add(core);
    g.add(stickHandle(c.accent));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.main, 0.9, 6); l.position.y = TOP; g.add(l); }
  },
  lightning(g, c, x) {
    const m = glowMat(c.main, 1);
    let py = -TOP + 0.6;
    for (let i = 0; i < 5; i++) { const seg = M(new THREE.BoxGeometry(0.1, 0.34, 0.06), m); seg.position.set(i % 2 ? 0.1 : -0.1, py, 0); seg.rotation.z = i % 2 ? -0.5 : 0.5; py += 0.3; g.add(seg); }
    g.add(stickHandle(0x222222));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.main, 1.4, 7); l.position.y = TOP; g.add(l); }
  },
  feather(g, c, x) {
    const shaft = M(new THREE.CylinderGeometry(0.06, 0.08, LEN * 0.9, 8), mat(c.glow || 0x3a2020)); shaft.position.y = -0.15; g.add(shaft);
    const spine = M(new THREE.CylinderGeometry(0.03, 0.05, 1, 6), glowMat(c.accent, 0.6)); spine.position.y = TOP - 0.2; g.add(spine);
    for (let i = 0; i < 5; i++) { const fy = TOP - 0.6 + i * 0.22; for (const s of [1, -1]) { const v = M(new THREE.BoxGeometry(0.3, 0.08, 0.02), glowMat(c.main, 0.7)); v.position.set(0.14 * s, fy, 0); v.rotation.z = s * 0.7; g.add(v); } }
    g.add(stickHandle(c.glow || 0x3a2020));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.main, 1.1, 6); l.position.y = TOP; g.add(l); }
  },
  wing(g, c, x) {
    g.add(M(new THREE.CylinderGeometry(0.07, 0.09, LEN, 8), mat(0x2b2b3a, { metalness: 0.5 })));
    const blade = M(new THREE.ConeGeometry(0.14, 0.7, 4), glowMat(c.accent, 0.7)); blade.position.y = TOP + 0.1; blade.rotation.y = Math.PI / 4; g.add(blade);
    for (const s of [1, -1]) { const w = M(new THREE.ConeGeometry(0.3, 0.6, 3), mat(c.main, { roughness: 0.5 })); w.scale.set(1, 0.5, 0.12); w.rotation.z = s * 1.4; w.position.set(0.28 * s, TOP - 0.25, 0); g.add(w); }
    g.add(stickHandle(0x2b2b3a));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.accent, 0.9, 6); l.position.y = TOP; g.add(l); }
  },
  star(g, c, x) {
    g.add(M(new THREE.CylinderGeometry(0.06, 0.08, LEN, 8), mat(c.main, { metalness: 0.6, roughness: 0.3 })));
    const sm = glowMat(c.accent, 0.7); const star = new THREE.Group();
    for (let i = 0; i < 5; i++) { const ray = M(new THREE.BoxGeometry(0.5, 0.16, 0.08), sm); ray.rotation.z = (i / 5) * Math.PI * 2; star.add(ray); }
    star.position.y = TOP; g.add(star, stickHandle(c.accent));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.accent, 1, 6); l.position.y = TOP; g.add(l); }
  },
  orb(g, c, x) {
    g.add(M(new THREE.CylinderGeometry(0.07, 0.09, LEN, 8), mat(c.glow || 0x1a1030, { metalness: 0.6, roughness: 0.3 })));
    const claw = M(new THREE.CylinderGeometry(0.18, 0.1, 0.3, 5, 1, true), mat(c.accent, { metalness: 0.7 })); claw.position.y = TOP - 0.2; g.add(claw);
    const orbM = M(new THREE.SphereGeometry(0.26, 16, 16), glowMat(c.main, 0.8)); orbM.position.y = TOP + 0.05; g.add(orbM);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const s = M(new THREE.SphereGeometry(0.04, 6, 6), glowMat(c.accent, 1)); s.position.set(Math.cos(a) * 0.38, TOP + 0.05 + Math.sin(a * 1.7) * 0.3, Math.sin(a) * 0.2); g.add(s); }
    g.add(stickHandle(0x2a1a4a));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.main, 1.2, 7); l.position.y = TOP; g.add(l); }
  },
  scepter(g, c, x) {
    g.add(M(new THREE.CylinderGeometry(0.07, 0.09, LEN, 8), mat(c.main, { metalness: 0.9, roughness: 0.2 })));
    const ring = M(new THREE.TorusGeometry(0.2, 0.05, 8, 16), mat(c.main, { metalness: 0.9 })); ring.position.y = TOP; g.add(ring);
    const jewel = M(new THREE.OctahedronGeometry(0.16, 0), glowMat(c.accent, 0.5)); jewel.position.y = TOP; g.add(jewel);
    for (let i = 0; i < 3; i++) { const b = M(new THREE.SphereGeometry(0.05, 8, 8), glowMat(c.accent, 0.6)); b.position.set(0.1, -TOP + 0.5 + i * 0.3, 0); g.add(b); }
    g.add(stickHandle(c.main));
    if (x.withLight) { const l = new THREE.PointLight(c.glow || c.accent, 0.8, 5); l.position.y = TOP; g.add(l); }
  },
  prism(g, c, x) {
    const bm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x00e0ff, emissiveIntensity: 0.7, metalness: 0.3, roughness: 0.05 });
    const blade = M(new THREE.OctahedronGeometry(0.26, 0), bm); blade.scale.set(0.6, 3, 0.4); blade.position.y = 0.4; g.add(blade);
    const core = M(new THREE.CylinderGeometry(0.05, 0.05, LEN * 0.7, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8 })); core.position.y = 0.3; g.add(core);
    g.userData.rainbow = [bm, core.material];
    g.add(stickHandle(0x222222));
    if (x.withLight) { const l = new THREE.PointLight(0xffffff, 1.2, 7); l.position.y = 0.5; g.add(l); }
  },

  // ---------- power tools ----------
  chainsaw(g, c) {
    const grip = M(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 8), mat(0x222222)); grip.position.y = -TOP + 0.35; g.add(grip);
    const body = M(new THREE.BoxGeometry(0.5, 0.45, 0.3), mat(c.main, { metalness: 0.4, roughness: 0.5 })); body.position.y = -TOP + 0.85; g.add(body);
    const bar = M(new THREE.BoxGeometry(0.22, LEN * 0.7, 0.08), mat(c.accent, { metalness: 0.8, roughness: 0.2 })); bar.position.y = 0.55; g.add(bar);
    for (let i = 0; i < 10; i++) { const t = M(new THREE.BoxGeometry(0.07, 0.07, 0.1), mat(0xdddddd, { metalness: 0.7 })); t.position.set(0.14, 0.1 + i * 0.13, 0); g.add(t); }
  },
  drill(g, c) {
    const body = M(new THREE.CylinderGeometry(0.13, 0.13, LEN * 0.6, 10), mat(c.main, { metalness: 0.6, roughness: 0.4 })); body.position.y = -0.1; g.add(body);
    const bit = M(new THREE.ConeGeometry(0.12, 0.7, 8), mat(c.accent, { metalness: 0.9, roughness: 0.15 })); bit.position.y = TOP - 0.1; g.add(bit);
    for (let i = 0; i < 4; i++) { const r = M(new THREE.TorusGeometry(0.1 - i * 0.02, 0.015, 4, 10), mat(0x888888, { metalness: 0.8 })); r.rotation.x = Math.PI / 2; r.position.y = TOP - 0.35 + i * 0.13; g.add(r); }
    g.add(stickHandle(0x222222));
  },
  sawblade(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.08, 0.1, LEN, 8), mat(c.accent, { metalness: 0.5 })));
    const disc = M(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 16), mat(c.main, { metalness: 0.9, roughness: 0.2 })); disc.rotation.x = Math.PI / 2; disc.position.y = TOP; g.add(disc);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const t = M(new THREE.ConeGeometry(0.06, 0.14, 3), mat(0xdddddd, { metalness: 0.7 })); t.position.set(Math.cos(a) * 0.44, TOP, Math.sin(a) * 0.44); t.rotation.z = -a - Math.PI / 2; g.add(t); }
    const hub = M(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 8), mat(0x333333)); hub.rotation.x = Math.PI / 2; hub.position.y = TOP; g.add(hub);
    g.add(stickHandle(c.accent));
  },
  wrench(g, c) {
    g.add(M(new THREE.BoxGeometry(0.16, LEN, 0.1), mat(c.main, { metalness: 0.8, roughness: 0.3 })));
    const headBase = M(new THREE.BoxGeometry(0.36, 0.2, 0.1), mat(c.main, { metalness: 0.8 })); headBase.position.y = TOP - 0.05; g.add(headBase);
    for (const xx of [-0.13, 0.13]) { const pr = M(new THREE.BoxGeometry(0.1, 0.3, 0.1), mat(c.main, { metalness: 0.8 })); pr.position.set(xx, TOP + 0.12, 0); g.add(pr); }
    g.add(stickHandle(c.accent));
  },

  // ---------- novelty ----------
  fork(g, c) {
    const shaft = M(new THREE.CylinderGeometry(0.05, 0.07, LEN * 0.95, 8), mat(0xd0d6de, { metalness: 0.9, roughness: 0.15 })); shaft.position.y = -0.1; g.add(shaft);
    for (const xx of [-0.12, -0.04, 0.04, 0.12]) { const pr = M(new THREE.BoxGeometry(0.04, 0.45, 0.04), mat(0xd0d6de, { metalness: 0.9 })); pr.position.set(xx, TOP - 0.15, 0); g.add(pr); }
    const chili = M(new THREE.ConeGeometry(0.13, 0.55, 8), mat(c.main, { roughness: 0.4 })); chili.position.set(0.02, TOP, 0.06); chili.rotation.set(0.4, 0, 0.3); g.add(chili);
    const stem = M(new THREE.CylinderGeometry(0.02, 0.02, 0.15, 5), mat(0x3a8a2a)); stem.position.set(-0.05, TOP + 0.28, 0); stem.rotation.z = 0.6; g.add(stem);
  },
  banana(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.08, 0.1, LEN, 7), mat(c.accent)));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const peel = M(new THREE.CylinderGeometry(0.03, 0.12, 0.7, 5, 1, true), mat(c.main, { roughness: 0.6 })); peel.position.set(Math.cos(a) * 0.12, TOP - 0.1, Math.sin(a) * 0.12); peel.rotation.z = Math.cos(a) * 0.6; peel.rotation.x = Math.sin(a) * 0.6; g.add(peel); }
    const top = M(new THREE.SphereGeometry(0.1, 8, 8), mat(c.main)); top.position.y = TOP - 0.25; g.add(top, stickHandle(c.accent));
  },
  lollipop(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.05, 0.05, LEN, 8), mat(0xffffff, { roughness: 0.6 })));
    const disc = M(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 20), mat(c.main, { roughness: 0.4 })); disc.rotation.x = Math.PI / 2; disc.position.y = TOP; g.add(disc);
    const s1 = M(new THREE.TorusGeometry(0.22, 0.04, 6, 20), mat(c.accent)); s1.position.set(0, TOP, 0.05); g.add(s1);
    const s2 = M(new THREE.TorusGeometry(0.1, 0.04, 6, 16), mat(c.accent)); s2.position.set(0, TOP, 0.05); g.add(s2);
    g.add(stickHandle(0xffffff));
  },
  brush(g, c) {
    const h = M(new THREE.CylinderGeometry(0.07, 0.05, LEN * 0.85, 8), mat(c.accent, { roughness: 0.5 })); h.position.y = -0.15; g.add(h);
    const ferrule = M(new THREE.CylinderGeometry(0.1, 0.09, 0.25, 8), mat(0xb0b6c0, { metalness: 0.9 })); ferrule.position.y = TOP - 0.4; g.add(ferrule);
    const bristle = M(new THREE.CylinderGeometry(0.09, 0.13, 0.5, 8), mat(c.main, { roughness: 0.6 })); bristle.position.y = TOP - 0.05; g.add(bristle);
    g.add(stickHandle(c.accent));
  },
  pencil(g, c) {
    const body = M(new THREE.CylinderGeometry(0.11, 0.11, LEN * 0.85, 6), mat(c.main, { roughness: 0.5 })); body.position.y = -0.05; g.add(body);
    const wood = M(new THREE.ConeGeometry(0.11, 0.3, 6), mat(0xe0c090)); wood.position.y = TOP - 0.15; g.add(wood);
    const tip = M(new THREE.ConeGeometry(0.05, 0.15, 6), mat(0x222222)); tip.position.y = TOP + 0.02; g.add(tip);
    const band = M(new THREE.CylinderGeometry(0.115, 0.115, 0.12, 6), mat(0xb0b6c0, { metalness: 0.8 })); band.position.y = -TOP + 0.25; g.add(band);
    const eraser = M(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 8), mat(c.accent)); eraser.position.y = -TOP + 0.1; g.add(eraser);
  },
  console(g, c) {
    g.add(M(new THREE.CylinderGeometry(0.07, 0.09, LEN, 8), mat(0x333333)));
    const body = M(new THREE.BoxGeometry(0.5, 0.7, 0.18), mat(c.main, { roughness: 0.5 })); body.position.y = TOP - 0.1; g.add(body);
    const screen = M(new THREE.BoxGeometry(0.34, 0.3, 0.04), glowMat(0x8fd6a0, 0.4)); screen.position.set(0, TOP + 0.05, 0.1); g.add(screen);
    const btn = M(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 8), mat(c.accent)); btn.rotation.x = Math.PI / 2; btn.position.set(0.12, TOP - 0.28, 0.1); g.add(btn);
    g.add(stickHandle(0x222222));
  },
};

// Small deterministic PRNG so the map looks the same each load
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
