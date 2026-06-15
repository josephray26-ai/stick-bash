import * as THREE from 'three';
import { createWorld, createCharacter, buildStick, makeHat, ARENA } from './world.js';
import * as remote from './remote.js';
import { EnemyManager } from './enemies.js';
import { BossManager } from './boss.js';
import { Controls } from './controls.js';
import { STICK_SKINS, SHOP_ITEMS, COINS_PER_HIT, COMBO_BONUS } from './data.js';
import { state, save, addCoins, spendCoins, isSkinUnlocked, resetSave } from './state.js';
import * as UI from './ui.js';
import { sfx, unlockAudio, setMuted, isMuted } from './audio.js';

const gsap = window.gsap;

// 3D avatar preview (start screen / locker) — declared early to avoid TDZ
let preview = null;

// ---------------------------------------------------------------------------
// Renderer + camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = createWorld();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
const PLAYER_EYE = 3.0;

// player rig: yawObject holds camera; we manage position separately
const player = {
  pos: new THREE.Vector3(0, 0, 14),
  vel: new THREE.Vector3(),
  speed: 9,
  h: 0,            // height above ground (for jumping)
  vy: 0,           // vertical velocity
  onGround: true,
  hp: 100,
  maxHp: 100,
  invuln: 0,       // i-frames after taking a hit
  knock: new THREE.Vector3(),
  shield: 0,       // bulwark shield HP
  shieldT: 0,      // bulwark time left
  healT: 0,        // bloom regen time left
};
const GRAVITY = 30;
const JUMP_SPEED = 11;
const ENEMY_DAMAGE = 20;   // 100 hp / 20 = 5 hits to get knocked out

function jump() {
  if (!player.onGround) return;
  player.vy = JUMP_SPEED;
  player.onGround = false;
}

const enemies = new EnemyManager(scene, 28);
remote.init(scene);   // renders other players (only used when connected)

// ---------------------------------------------------------------------------
// Boss system — a rotating boss drops in every 5 minutes
// ---------------------------------------------------------------------------
const bossMgr = new BossManager(scene, {
  onSpawn: (def) => {
    sfx.unlock();
    UI.bigBanner(`${def.emoji} ${def.name}`, `${def.sub} — incoming!`);
    UI.toast(`A BOSS is dropping in!`, 'bad');
    UI.showBoss(def);
  },
  onLand: () => { screenShake(0.85); sfx.hit(); },
  onShake: (amt) => screenShake(amt),
  // a special attack — damage everyone on the map, wherever they are
  onAreaAttack: (dmg) => {
    if (bossMgr.boss) {
      takeDamage(bossMgr.boss, dmg);            // the player is always hit (no dodging by distance)
      enemies.blastAll(bossMgr.boss.group.position);  // every NPC gets blasted too
      if (mpActive() && net.isHost) net.event('area', { dmg });  // every friend gets hit too
    }
  },
  // client-side mirror of the boss (driven by the host's snapshot)
  onClientSpawn: (def) => { UI.showBoss(def); UI.bigBanner(`${def.emoji} ${def.name}`, `${def.sub} — incoming!`); UI.toast('A BOSS is dropping in!', 'bad'); },
  onClientDespawn: () => { UI.hideBoss(); },
  onPhase: (def) => { UI.toast(`${def.name} entered PHASE 2! 😱`, 'bad'); },
  onRevive: (def) => { UI.bigBanner('🔥 REBORN FROM ASH!', `${def.name} rises again!`); sfx.unlock(); },
  onHpChange: (hp, max, phase) => UI.updateBoss(hp, max, phase),
  onDefeat: (def) => {
    sfx.unlock();
    UI.bigBanner(`${def.name} DEFEATED!`, `Unlocked: ${def.reward}`);
    UI.toast('Boss down! +500 🪙  +50 💥', 'good');
    addCoins(500);
    state.totalHits += 50; save();
    UI.updateHUD();
    UI.hideBoss();
  },
});

// ---------------------------------------------------------------------------
// First-person view model (arm + stick)
// ---------------------------------------------------------------------------
const viewModel = new THREE.Group();
camera.add(viewModel);
scene.add(camera);

const armMat = new THREE.MeshStandardMaterial({ color: 0xffcf6e, roughness: 0.8 });
const arm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 1.1), armMat);

const stickHolder = new THREE.Group(); // we rotate this when swinging
let currentStick = null;

function mountViewModel() {
  viewModel.clear();
  // position the hand/stick in the lower-right of the view
  stickHolder.position.set(0.72, -0.78, -1.05);
  stickHolder.rotation.set(-0.3, -0.25, 0.35);
  arm.position.set(0.62, -0.95, -0.75);
  arm.rotation.set(-0.5, 0, 0.25);
  viewModel.add(arm);
  viewModel.add(stickHolder);
}

function equipStickById(id) {
  const skin = findSkin(id);
  if (currentStick) stickHolder.remove(currentStick);
  currentStick = buildStick(skin);
  currentStick.scale.setScalar(0.42);
  currentStick.position.y = 0.6;
  stickHolder.add(currentStick);
  state.equippedStick = id;
  save();
}

function findSkin(id) {
  return STICK_SKINS.find((s) => s.id === id)
    || SHOP_ITEMS.find((i) => i.cat === 'Sticks' && i.id === id)?.skin
    || STICK_SKINS[0];
}

mountViewModel();
equipStickById(isStickAvailable(state.equippedStick) ? state.equippedStick : 'oak');

function isStickAvailable(id) {
  const earned = STICK_SKINS.find((s) => s.id === id);
  if (earned) return isSkinUnlocked(earned);
  return state.ownedShopItems.includes(id);
}

// ---------------------------------------------------------------------------
// Cosmetics: body color → arms, aura → screen vignette
// ---------------------------------------------------------------------------
function applyCosmetics() {
  // body color
  const bodyId = state.equipped.Skins;
  const bodyItem = SHOP_ITEMS.find((i) => i.id === bodyId);
  armMat.color.setHex(bodyItem ? bodyItem.color : 0xffcf6e);

  // aura vignette
  const auraId = state.equipped.Auras;
  const auraItem = SHOP_ITEMS.find((i) => i.id === auraId);
  const v = document.getElementById('aura-vignette');
  if (auraItem) {
    const c = `#${auraItem.color.toString(16).padStart(6, '0')}`;
    v.style.boxShadow = `inset 0 0 140px 30px ${c}`;
    v.style.opacity = '0.55';
  } else {
    v.style.opacity = '0';
  }
  updatePreview();
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------
let swinging = false;
let throwing = false;        // brief windup before the stick leaves the hand
let thrownStick = null;      // active boomerang projectile (or null)
let throwCooldown = 0;       // tiny delay after catching before next throw
let combo = 0;
let comboTimer = 0;
const forward = new THREE.Vector3();
const shake = { x: 0, y: 0, z: 0 };
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function getForward() {
  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  forward.y = 0; forward.normalize();
  return forward;
}

function swing() {
  if (swinging || throwing || thrownStick) return;   // need the stick in hand
  swinging = true;
  sfx.swing();

  const startRot = { x: -0.3, y: -0.25, z: 0.35 };
  const tl = gsap.timeline({ onComplete: () => { swinging = false; } });
  // wind up
  tl.to(stickHolder.rotation, { x: -1.2, y: 0.4, z: -0.2, duration: 0.08, ease: 'power2.in' });
  // strike
  tl.to(stickHolder.rotation, { x: 0.9, y: -0.9, z: 0.9, duration: 0.11, ease: 'power3.out', onStart: resolveHit });
  // return
  tl.to(stickHolder.rotation, { ...startRot, duration: 0.22, ease: 'power2.out' });

  // little camera punch (via shake offset so movement code doesn't overwrite it)
  gsap.fromTo(shake, { z: 0.12 }, { z: 0, duration: 0.18, ease: 'power2.out' });
}

function resolveHit() {
  const fwd = getForward();
  if (isClient()) {
    // client doesn't own NPC/boss HP — detect the hit locally, tell the host to apply it
    let hit = false;
    const i = enemies.pickHitIndex(player.pos, fwd, 5.2, 0.55);
    if (i >= 0) { net.event('hit', { k: 'n', i }, net.hostId); hit = true; }
    if (bossMgr.pos && inFrontWithin(bossMgr.pos, fwd, 8.2, 0.4)) { net.event('hit', { k: 'b', dmg: 1 }, net.hostId); hit = true; }
    if (hit) awardHit(0.18);   // personal coins/combo are awarded locally
    return;
  }
  let hit = enemies.tryHit(player.pos, fwd, 5.2, 0.55);
  // the boss is big — a swing that lands on it counts too
  if (bossMgr.boss && bossMgr.boss.tryHit(player.pos, fwd, 5.2, 1)) hit = true;
  if (!hit) return;
  awardHit(0.18);
}

// Shared reward + feedback for any landed hit (swing or thrown stick)
function awardHit(shakeAmt = 0.14) {
  sfx.hit();
  UI.hitMarker();
  screenShake(shakeAmt);

  // combo
  combo += 1;
  comboTimer = 1.6;
  if (combo > state.bestCombo) state.bestCombo = combo;

  // rewards
  state.totalHits += 1;
  const reward = COINS_PER_HIT + (combo - 1) * COMBO_BONUS;
  addCoins(reward);
  sfx.coin();

  UI.floatHit(`+${reward}🪙`, '#ffd23f');
  if (combo >= 2) UI.showCombo(combo);
  UI.updateHUD();

  checkUnlocks();
  save();
}

function checkUnlocks() {
  for (const skin of STICK_SKINS) {
    if (skin.hits === state.totalHits && skin.hits > 0) {
      sfx.unlock();
      UI.bigBanner('NEW STICK UNLOCKED!', `${skin.name} — ${skin.rarity}`);
      UI.toast(`Unlocked ${skin.name}! Check your Sticks 🪄`, 'good');
    }
  }
}

function screenShake(amt) {
  shake.x = (Math.random() - 0.5) * amt;
  shake.y = (Math.random() - 0.5) * amt;
  gsap.to(shake, { x: 0, y: 0, duration: 0.3, ease: 'elastic.out(1,0.4)' });
}

// ---------------------------------------------------------------------------
// Taking damage / getting bonked
// ---------------------------------------------------------------------------
function takeDamage(source, amount = ENEMY_DAMAGE) {
  if (player.invuln > 0 || player.hp <= 0) return;
  // BULWARK: absorb the hit into the shield until it shatters
  if (player.shieldT > 0 && player.shield > 0) {
    player.shield -= amount;
    player.invuln = 0.3;
    sfx.deny();
    if (bulwarkMesh) gsap.fromTo(bulwarkMesh.scale, { x: 1.15, y: 1.15 }, { x: 1, y: 1, duration: 0.2 });
    if (player.shield <= 0) { player.shield = 0; player.shieldT = 0; shatterBulwark(); }
    return;
  }
  player.hp = Math.max(0, player.hp - amount);
  player.invuln = 0.7;
  combo = 0;                       // getting hit breaks your combo
  sfx.hurt();
  screenShake(amount > ENEMY_DAMAGE ? 0.5 : 0.35);
  flashDamage();
  UI.updateHealth(player.hp, player.maxHp);

  // shove the player away from the attacker (source may be an enemy, the boss, or a hazard point)
  const origin = source && (source.group ? source.group.position : (source.position || source));
  const k = _v1.copy(player.pos);
  if (origin && typeof origin.x === 'number') k.sub(origin); else k.set(Math.random() - 0.5, 0, Math.random() - 0.5);
  k.y = 0;
  if (k.lengthSq() < 0.001) k.set(Math.random() - 0.5, 0, Math.random() - 0.5);
  player.knock.copy(k.normalize()).multiplyScalar(10);

  if (player.hp <= 0) defeat();
}

function flashDamage() {
  const f = document.getElementById('damage-flash');
  f.classList.remove('show');
  void f.offsetWidth;
  f.classList.add('show');
}

function defeat() {
  sfx.defeat();
  UI.bigBanner('YOU GOT BONKED!', 'Respawning…');
  player.knock.set(0, 0, 0);
  // brief reset, then respawn at the spawn pad with mercy invulnerability
  setTimeout(() => {
    player.pos.set(0, 0, 14);
    player.hp = player.maxHp;
    player.invuln = 2.0;
    UI.updateHealth(player.hp, player.maxHp);
    UI.toast('Back in the fight! 🪄', 'good');
  }, 700);
}

// ---------------------------------------------------------------------------
// Boss-encounter abilities: 🛡️ Bulwark, 💚 Bloom, ☄️ Stick Shards
// (only usable while a boss is active)
// ---------------------------------------------------------------------------
const ABILITIES = {
  bulwark: { code: 'Digit1', cd: 0, max: 15, name: 'Bulwark', emoji: '🛡️' },
  bloom:   { code: 'Digit2', cd: 0, max: 30, name: 'Bloom', emoji: '💚' },
  shards:  { code: 'Digit3', cd: 0, max: 6,  name: 'Stick Shards', emoji: '☄️' },
};
const SHIELD_HP = 80, SHIELD_DUR = 4, SHARD_CHARGE = 3;
let shardCharge = -1;            // >=0 means charging
const shardProjs = [];
let healZone = null;
let bulwarkMesh = null;

function bossEncounterActive() { return bossMgr.active; }

function activateAbility(key) {
  if (!controls.enabled || !bossEncounterActive()) return;
  const a = ABILITIES[key];
  if (!a || a.cd > 0) { sfx.deny(); return; }
  if (key === 'bulwark') {
    player.shield = SHIELD_HP; player.shieldT = SHIELD_DUR; a.cd = a.max;
    showBulwark(); sfx.buy(); UI.toast('🛡️ Bulwark raised!', 'good');
  } else if (key === 'bloom') {
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.4);
    player.healT = 3; spawnHealZone(); UI.updateHealth(player.hp, player.maxHp);
    a.cd = a.max; sfx.coin(); UI.toast('💚 Bloom — healed!', 'good');
  } else if (key === 'shards') {
    if (shardCharge >= 0) return;        // already charging
    shardCharge = 0; sfx.swing(); UI.toast('☄️ Stick Shards charging…', 'info');
  }
}

function showBulwark() {
  if (!bulwarkMesh) {
    bulwarkMesh = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 0.25),
      new THREE.MeshStandardMaterial({ color: 0xffb84d, emissive: 0xff8a00, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, roughness: 0.3 }));
    bulwarkMesh.position.set(0, -0.1, -1.7);
    camera.add(bulwarkMesh);
  }
  bulwarkMesh.visible = true;
  gsap.fromTo(bulwarkMesh.scale, { y: 0.1 }, { y: 1, duration: 0.2, ease: 'back.out(2)' });
}
function shatterBulwark() { if (bulwarkMesh) bulwarkMesh.visible = false; UI.toast('🛡️ Bulwark shattered!', 'bad'); }

function spawnHealZone() {
  if (healZone) scene.remove(healZone.mesh);
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(4, 24),
    new THREE.MeshBasicMaterial({ color: 0x6bff8a, transparent: true, opacity: 0.4, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(player.pos.x, 0.07, player.pos.z);
  scene.add(mesh); healZone = { mesh, x: player.pos.x, z: player.pos.z };
}

function fireShards() {
  const fwd = getForward(); const start = _v1.copy(camera.position);
  for (let i = 0; i < 5; i++) {
    const proj = buildStick(findSkin('stick_galaxy'), false);
    proj.scale.setScalar(0.5);
    proj.position.copy(start).addScaledVector(fwd, 1.2);
    const dir = fwd.clone();
    dir.x += (Math.random() - 0.5) * 0.18; dir.z += (Math.random() - 0.5) * 0.18; dir.normalize();
    scene.add(proj);
    shardProjs.push({ group: proj, dir, dist: 0, spin: 0 });
  }
  sfx.hit();
  ABILITIES.shards.cd = ABILITIES.shards.max;
}

function explodeShard(pos) {
  // flash
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 10), new THREE.MeshBasicMaterial({ color: 0xff6ad5, transparent: true, opacity: 0.8 }));
  flash.position.copy(pos); scene.add(flash);
  gsap.to(flash.scale, { x: 7, y: 7, z: 7, duration: 0.3, ease: 'power2.out' });
  gsap.to(flash.material, { opacity: 0, duration: 0.3, onComplete: () => scene.remove(flash) });
  screenShake(0.2);
  // heavy single-target on boss
  const bp = bossMgr.pos;
  if (bp && Math.hypot(bp.x - pos.x, bp.z - pos.z) < 6) { damageBoss(3); awardHit(0); }
  // splash on grouped NPCs
  for (let i = 0; i < enemies.enemies.length; i++) {
    const e = enemies.enemies[i];
    if (e.state !== 'alive') continue;
    if (Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z) < 4.5) {
      if (isClient()) net.event('hit', { k: 'n', i }, net.hostId); else enemies.hit(e, pos);
      awardHit(0);
    }
  }
}

function updateShards(dt) {
  // charging
  if (shardCharge >= 0) {
    shardCharge += dt;
    if (shardCharge >= SHARD_CHARGE) { fireShards(); shardCharge = -1; }
  }
  // projectiles
  for (let i = shardProjs.length - 1; i >= 0; i--) {
    const p = shardProjs[i];
    p.spin += dt * 24; p.group.rotation.set(p.spin, p.spin * 0.7, 0);
    p.group.position.addScaledVector(p.dir, 52 * dt); p.dist += 52 * dt;
    let boom = false;
    const bpos = bossMgr.pos;
    if (bpos && Math.hypot(bpos.x - p.group.position.x, bpos.z - p.group.position.z) < 4.5 && Math.abs(p.group.position.y - 5) < 7) boom = true;
    if (!boom) for (const e of enemies.enemies) { if (e.state === 'alive' && Math.hypot(e.group.position.x - p.group.position.x, e.group.position.z - p.group.position.z) < 2) { boom = true; break; } }
    if (p.group.position.y <= 0.3) boom = true;
    if (p.dist > 60) boom = true;
    if (boom) { explodeShard(p.group.position.clone()); scene.remove(p.group); shardProjs.splice(i, 1); }
  }
}

function updateAbilities(dt) {
  for (const k in ABILITIES) if (ABILITIES[k].cd > 0) ABILITIES[k].cd = Math.max(0, ABILITIES[k].cd - dt);
  // bulwark timer
  if (player.shieldT > 0) {
    player.shieldT -= dt;
    if (bulwarkMesh) bulwarkMesh.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(clock.elapsedTime * 8)) * 0.4;
    if (player.shieldT <= 0) { player.shieldT = 0; player.shield = 0; if (bulwarkMesh) bulwarkMesh.visible = false; }
  }
  // bloom regen while standing in the zone
  if (player.healT > 0) {
    player.healT -= dt;
    if (healZone && Math.hypot(player.pos.x - healZone.x, player.pos.z - healZone.z) < 4 && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + 9 * dt); UI.updateHealth(player.hp, player.maxHp);
    }
    if (healZone) healZone.mesh.material.opacity = 0.25 + Math.abs(Math.sin(clock.elapsedTime * 5)) * 0.25;
    if (player.healT <= 0 && healZone) { scene.remove(healZone.mesh); healZone = null; }
  }
  updateShards(dt);
  UI.updateAbilities(ABILITIES, bossEncounterActive(), shardCharge >= 0 ? shardCharge / SHARD_CHARGE : 0);
}

// ---------------------------------------------------------------------------
// Throwing — fling the stick forward; it spins, bonks enemies, boomerangs back
// ---------------------------------------------------------------------------
const THROW_RANGE = 24;
const THROW_SPEED = 40;
const THROW_HIT_R = 2.2;

const THROW_COOLDOWN = 2;            // seconds before you can throw again

function throwStick() {
  if (swinging || throwing || thrownStick) return;
  if (throwCooldown > 0) { sfx.deny(); return; }
  throwing = true;
  sfx.swing();

  const tl = gsap.timeline({ onComplete: () => { throwing = false; } });
  tl.to(stickHolder.rotation, { x: -1.4, duration: 0.09, ease: 'power2.in' });            // wind back
  tl.to(stickHolder.rotation, { x: 0.7, duration: 0.07, ease: 'power3.out', onStart: launchProjectile }); // fling
  gsap.fromTo(shake, { z: 0.18 }, { z: 0, duration: 0.22, ease: 'power2.out' });
}

function launchProjectile() {
  const proj = buildStick(findSkin(state.equippedStick));
  proj.scale.setScalar(0.6);
  proj.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // spawn at roughly where the hand is
  const start = _v1.copy(camera.position).addScaledVector(getForward(), 1.0);
  start.y -= 0.6;
  proj.position.copy(start);
  scene.add(proj);

  thrownStick = {
    group: proj,
    dir: getForward().clone(),     // horizontal launch direction
    dist: 0,
    phase: 'out',
    hit: new Set(),
    spin: 0,
    life: 0,
  };
  stickHolder.visible = false;       // it's in the air now
}

function updateThrow(dt) {
  if (!thrownStick) { if (throwCooldown > 0) throwCooldown -= dt; return; }
  const t = thrownStick;
  t.life += dt;
  t.spin += dt * 22;
  t.group.rotation.set(t.spin * 0.6, 0, t.spin);

  if (t.phase === 'out') {
    t.group.position.addScaledVector(t.dir, THROW_SPEED * dt);
    t.dist += THROW_SPEED * dt;
    checkThrowHits(t);
    // clamp to arena so it doesn't sail through walls, then come back
    const lim = ARENA.size - 3;
    if (t.dist >= THROW_RANGE ||
        Math.abs(t.group.position.x) > lim || Math.abs(t.group.position.z) > lim) {
      t.phase = 'back';
    }
  } else {
    // boomerang home to the current hand position
    const target = _v2.copy(camera.position).addScaledVector(getForward(), 0.9);
    target.y -= 0.5;
    const to = target.sub(t.group.position);
    const d = to.length();
    if (d < 1.3 || t.life > 4) { catchStick(); return; }
    t.group.position.addScaledVector(to.normalize(), Math.max(THROW_SPEED, d * 5) * dt);
    checkThrowHits(t);              // it can bonk people on the way home too
  }
}

function checkThrowHits(t) {
  if (isClient()) {
    // client: detect overlaps against the mirrored NPCs/boss, report to host (dedupe by index)
    for (let i = 0; i < enemies.enemies.length; i++) {
      const e = enemies.enemies[i];
      if (e.state !== 'alive' || t.hit.has(i)) continue;
      const dx = e.group.position.x - t.group.position.x, dz = e.group.position.z - t.group.position.z;
      if (dx * dx + dz * dz < THROW_HIT_R * THROW_HIT_R) { t.hit.add(i); net.event('hit', { k: 'n', i }, net.hostId); awardHit(0.12); }
    }
    if (bossMgr.pos && !t.hit.has('boss')) {
      const dx = bossMgr.pos.x - t.group.position.x, dz = bossMgr.pos.z - t.group.position.z;
      if (dx * dx + dz * dz < 4.5 * 4.5) { t.hit.add('boss'); net.event('hit', { k: 'b', dmg: 2 }, net.hostId); awardHit(0.12); }
    }
    return;
  }
  for (const e of enemies.enemies) {
    if (e.state !== 'alive' || t.hit.has(e)) continue;
    const dx = e.group.position.x - t.group.position.x;
    const dz = e.group.position.z - t.group.position.z;
    if (dx * dx + dz * dz < THROW_HIT_R * THROW_HIT_R) {
      t.hit.add(e);
      enemies.hit(e, t.group.position);
      awardHit(0.12);
    }
  }
  // a thrown stick deals extra damage to the boss (once per throw)
  if (bossMgr.boss && !t.hit.has('boss') && bossMgr.boss.hitAt(t.group.position, 2)) {
    t.hit.add('boss');
    awardHit(0.12);
  }
}

function catchStick() {
  scene.remove(thrownStick.group);
  thrownStick = null;
  throwCooldown = THROW_COOLDOWN;
  stickHolder.visible = true;
  stickHolder.rotation.set(-0.3, -0.25, 0.35);
  gsap.fromTo(stickHolder.scale, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 1, z: 1, duration: 0.22, ease: 'back.out(3)' });
}

const throwBtn = document.getElementById('throw-btn');
const throwCdEl = document.getElementById('throw-cd');
let lastCdShown = -1;
function updateThrowCooldownUI() {
  // throwCooldown is decremented inside updateThrow; here we just reflect it
  const onCd = throwCooldown > 0 && !thrownStick;
  const secs = onCd ? Math.ceil(throwCooldown) : 0;
  if (secs === lastCdShown) return;
  lastCdShown = secs;
  if (onCd) {
    throwCdEl.textContent = `🪃 ${secs}s`;
    throwCdEl.classList.add('show');
    throwBtn.classList.add('cooling');
    throwBtn.dataset.cd = secs;
  } else {
    throwCdEl.classList.remove('show');
    throwBtn.classList.remove('cooling');
    delete throwBtn.dataset.cd;
  }
}

// ---------------------------------------------------------------------------
// Controls + UI wiring
// ---------------------------------------------------------------------------
const controls = new Controls(canvas, { onSwing: swing, onThrow: throwStick, onJump: jump });
window.addEventListener('mobile-swing', () => { if (controls.enabled) swing(); });
window.addEventListener('mobile-throw', () => { if (controls.enabled) throwStick(); });
window.addEventListener('mobile-ability', (e) => activateAbility(e.detail));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Digit1') activateAbility('bulwark');
  else if (e.code === 'Digit2') activateAbility('bloom');
  else if (e.code === 'Digit3') activateAbility('shards');
});

UI.initUI({
  onToggleMute: () => {
    setMuted(!isMuted());
    document.getElementById('mute-btn').textContent = isMuted() ? '🔇' : '🔊';
  },
  onPanelOpen: () => { controls.setEnabled(false); if (document.pointerLockElement) document.exitPointerLock(); },
  onPanelClose: () => resumeGame(),
  onBuy: (item) => {
    if (state.ownedShopItems.includes(item.id)) return;
    if (spendCoins(item.price)) {
      state.ownedShopItems.push(item.id);
      save();
      sfx.buy();
      UI.toast(`Bought ${item.name}!`, 'good');
      UI.updateHUD();
      UI.refreshPanels();
      applyCosmetics();
    } else {
      sfx.deny();
      UI.toast('Not enough coins! Go bonk more people 🪙', 'bad');
    }
  },
  onEquipItem: (item, isEquipped) => {
    state.equipped[item.cat] = isEquipped ? null : item.id;
    save();
    sfx.buy();
    applyCosmetics();
    UI.refreshPanels();
  },
  onEquipSkin: (skin) => {
    equipStickById(skin.id);
    sfx.buy();
    UI.toast(`Equipped ${skin.name}`, 'good');
    updatePreview();
  },
  onReset: () => {
    resetSave();
    equipStickById('oak');
    applyCosmetics();
    UI.updateHUD();
    UI.refreshPanels();
    UI.toast('Progress reset', 'info');
  },
  onMainMenu: () => goToStartScreen(),
});

// Start screen
const startScreen = document.getElementById('start-screen');
document.getElementById('play-btn').addEventListener('click', () => {
  unlockAudio();
  startScreen.classList.add('hidden');
  resetBattle();
  resumeGame();
});

// "Play with Friends" — host a new room, or join one if arrived via an invite link
const invitedRoom = new URLSearchParams(location.search).get('r');
const friendsBtn = document.getElementById('friends-btn');
if (friendsBtn) {
  if (invitedRoom) friendsBtn.textContent = '👥 Join Friend';
  friendsBtn.addEventListener('click', () => startMultiplayer(invitedRoom || randomRoomCode()));
}

function resumeGame() {
  if (UI.anyPanelOpen()) return;
  controls.setEnabled(true);
  if (!controls.isTouch) controls.requestLock();
}

// reset the live battle state (health/position/combo) without touching saved progress
function resetBattle() {
  player.pos.set(0, 0, 14);
  player.h = 0; player.vy = 0; player.onGround = true;
  player.hp = player.maxHp; player.invuln = 0; player.knock.set(0, 0, 0);
  combo = 0; comboTimer = 0;
  UI.updateHealth(player.hp, player.maxHp);
}

function goToStartScreen() {
  UI.closePanels(true);
  controls.setEnabled(false);
  if (document.pointerLockElement) document.exitPointerLock();
  leaveMultiplayer();
  resetBattle();
  bossMgr.clear(); UI.hideBoss();   // clear any active boss + its HUD
  updatePreview();             // refresh the locker avatar with current cosmetics
  startScreen.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Multiplayer (co-op) — opt-in. net.js + its CDN dependency are imported lazily
// here, so the solo "▶ PLAY" path never loads any networking code.
// ---------------------------------------------------------------------------
let net = null;            // the net module (null until "Play with Friends")
let netSendAcc = 0;        // throttle accumulator for broadcasting our state
let worldAcc = 0;          // throttle accumulator for the host's world snapshot
let clientWorld = { t: 0, e: null, b: null };   // latest host snapshot (on clients)
const _remoteKnock = new THREE.Vector3();       // throwaway knock target for remote players

function mpActive() { return !!(net && net.connected); }
function isClient() { return mpActive() && !net.isHost; }
function isHostOrSolo() { return !mpActive() || net.isHost; }

// every player the host's AI should consider — { id, pos, h, knock }
function playersList() {
  const me = { id: mpActive() ? net.selfId : 'me', pos: player.pos, h: player.h, knock: player.knock };
  if (!mpActive()) return [me];
  const list = [me];
  for (const [pid, st] of net.playerStates) list.push({ id: pid, pos: new THREE.Vector3(st.x, 0, st.z), h: 0, knock: _remoteKnock });
  return list;
}

// an NPC/boss landed a hit on player `playerId` (host decides; routes to the right peer)
function onAnyPlayerHit(source, amount, playerId) {
  const amt = amount == null ? ENEMY_DAMAGE : amount;
  if (!mpActive() || playerId == null || playerId === net.selfId) { takeDamage(source, amt); return; }
  const o = source && (source.group ? source.group.position : (source.position || source));
  net.event('dmg', { amt, ox: o ? +o.x.toFixed(1) : 0, oz: o ? +o.z.toFixed(1) : 0 }, playerId);
}

// damage the boss: host applies directly; client asks the host to apply it
function damageBoss(amount) {
  if (isClient()) { if (bossMgr.pos) net.event('hit', { k: 'b', dmg: amount }, net.hostId); }
  else if (bossMgr.boss && bossMgr.boss.state === 'active') bossMgr.boss.hit(amount);
}

// is `targetPos` within `maxDist` and inside the forward cone (dot >= minDot)?
function inFrontWithin(targetPos, fwd, maxDist, minDot) {
  const dx = targetPos.x - player.pos.x, dz = targetPos.z - player.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > maxDist) return false;
  return (dx / dist) * fwd.x + (dz / dist) * fwd.z >= minDot;
}

function remotePosOf(peer) {
  const st = net.playerStates.get(peer);
  return st ? new THREE.Vector3(st.x, 0, st.z) : null;
}

// host broadcasts the authoritative world (NPCs + boss + timer) ~12x/sec
function worldTick(dt) {
  worldAcc += dt;
  if (worldAcc < 1 / 12) return;
  worldAcc = 0;
  net.sendWorld({ e: enemies.serialize(), b: bossMgr.serialize(), t: bossMgr.timer });
}

function onWorld(peer, data) {
  if (net.isHost || peer !== net.hostId) return;   // only trust the host
  clientWorld = data;
  enemies.applySnapshot(data.e);
  bossMgr.applySnapshot(data.b);
}

function onNetEvent(peer, msg) {
  switch (msg.t) {
    case 'hit':                       // a client reports a hit (host applies it)
      if (!net.isHost) return;
      if (msg.k === 'n') enemies.hitById(msg.i, remotePosOf(peer));
      else if (msg.k === 'b' && bossMgr.boss && bossMgr.boss.state === 'active') bossMgr.boss.hit(msg.dmg || 1);
      break;
    case 'dmg':                       // the host's NPC/boss bonked me
      takeDamage({ position: { x: msg.ox, z: msg.oz } }, msg.amt);
      break;
    case 'area':                      // boss special — hits everyone
      takeDamage({ position: bossMgr.pos || player.pos }, msg.dmg);
      screenShake(0.4);
      break;
  }
}

function randomRoomCode() { return Math.random().toString(36).slice(2, 7); }

async function startMultiplayer(roomId) {
  try {
    if (!net) {
      const mod = await import('./net.js');
      net = mod.net;
      net.on('player', (peer, data) => remote.upsert(peer, data));
      net.on('world', onWorld);
      net.on('event', onNetEvent);
      net.on('peerjoin', () => { sfx.unlock(); updateFriendsHud(); });
      net.on('peerleave', (id) => { remote.remove(id); updateFriendsHud(); });
      net.on('host', () => updateFriendsHud());
    }
    net.connect(roomId);
    history.replaceState(null, '', `?r=${roomId}`);
    showInviteBar(roomId);
    updateFriendsHud();
    unlockAudio();
    startScreen.classList.add('hidden');
    resetBattle();
    resumeGame();
    UI.toast('Connected! Share the invite link 🔗', 'good');
  } catch (e) {
    console.error('multiplayer failed', e);
    UI.toast('Could not start multiplayer 😕', 'bad');
  }
}

function leaveMultiplayer() {
  if (net && net.connected) net.leave();
  remote.clear();
  netSendAcc = 0;
  const bar = document.getElementById('invite-bar');
  const hud = document.getElementById('friends-hud');
  if (bar) bar.classList.remove('show');
  if (hud) hud.classList.remove('show');
  if (location.search) history.replaceState(null, '', location.pathname);
}

function localPlayerState() {
  const bodyItem = SHOP_ITEMS.find((i) => i.id === state.equipped.Skins);
  return {
    x: +player.pos.x.toFixed(2),
    z: +player.pos.z.toFixed(2),
    yaw: +controls.yaw.toFixed(2),
    h: +player.h.toFixed(2),
    act: swinging ? 'swing' : (throwing ? 'throw' : 'idle'),
    hp: Math.round(player.hp),
    body: bodyItem ? bodyItem.color : 0xffcf6e,
    hat: state.equipped.Hats || 0,
    stick: state.equippedStick,
  };
}

function netTick(dt) {
  netSendAcc += dt;
  if (netSendAcc < 1 / 12) return;   // ~12 broadcasts/sec
  netSendAcc = 0;
  net.sendPlayer(localPlayerState());
}

function showInviteBar(roomId) {
  const bar = document.getElementById('invite-bar');
  if (!bar) return;
  const url = `${location.origin}${location.pathname}?r=${roomId}`;
  const link = document.getElementById('invite-link');
  if (link) link.textContent = url;
  bar.classList.add('show');
  const copyBtn = document.getElementById('invite-copy');
  if (copyBtn && !copyBtn._wired) {
    copyBtn._wired = true;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(url).then(
        () => UI.toast('Invite link copied! 📋', 'good'),
        () => UI.toast('Copy failed — select the link', 'bad'));
    });
  }
}

function updateFriendsHud() {
  const hud = document.getElementById('friends-hud');
  if (!hud) return;
  if (!mpActive()) { hud.classList.remove('show'); return; }
  const others = net.peers.length;
  hud.classList.add('show');
  hud.textContent = `👥 ${others + 1} player${others ? 's' : ''}${net.isHost ? ' · host' : ''}`;
}

// shortcuts: B shop · N sticks · Esc/P pause (openPanel pauses + releases the mouse)
document.addEventListener('keydown', (e) => {
  if (startScreen && !startScreen.classList.contains('hidden')) return; // ignore on start screen
  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    UI.anyPanelOpen() ? UI.closePanels() : UI.openPanel('pause');
  }
  if (!controls.enabled && !UI.anyPanelOpen()) return;
  if (e.code === 'KeyB') { e.preventDefault(); UI.anyPanelOpen() ? UI.closePanels() : UI.openPanel('shop'); }
  if (e.code === 'KeyN') { e.preventDefault(); UI.anyPanelOpen() ? UI.closePanels() : UI.openPanel('skins'); }
});

// if the pointer unlocks mid-game (e.g. browser ate the Esc keydown), pause
document.addEventListener('pointerlockchange', () => {
  const playing = controls.enabled && startScreen.classList.contains('hidden');
  if (!document.pointerLockElement && playing && !UI.anyPanelOpen()) UI.openPanel('pause');
});

applyCosmetics();
UI.updateHealth(player.hp, player.maxHp);
document.getElementById('mute-btn').textContent = isMuted() ? '🔇' : '🔊';

// ---------------------------------------------------------------------------
// Movement + collision
// ---------------------------------------------------------------------------
const solids = [];
scene.traverse((o) => { if (o.userData && o.userData.solid) solids.push(o.userData.solid); });

let bobPhase = 0;
function updateMovement(dt) {
  const mv = controls.readMove();
  const moving = mv.lengthSq() > 0.001;

  // camera yaw/pitch
  camera.rotation.order = 'YXZ';
  camera.rotation.y = controls.yaw;
  camera.rotation.x = controls.pitch;

  // movement relative to yaw
  const sin = Math.sin(controls.yaw), cos = Math.cos(controls.yaw);
  const fx = -sin, fz = -cos;   // forward
  const rx = cos, rz = -sin;    // right
  const speed = player.speed * (controls.sprint ? 1.6 : 1);
  const dx = (fx * mv.y + rx * mv.x) * speed * dt;
  const dz = (fz * mv.y + rz * mv.x) * speed * dt;

  // i-frames + knockback from getting bonked
  if (player.invuln > 0) player.invuln -= dt;
  let kx = 0, kz = 0;
  if (player.knock.lengthSq() > 0.001) {
    kx = player.knock.x * dt; kz = player.knock.z * dt;
    player.knock.multiplyScalar(Math.max(0, 1 - dt * 6));
  }

  let nx = player.pos.x + dx + kx;
  let nz = player.pos.z + dz + kz;

  // prop collision (circle vs circle)
  for (const s of solids) {
    const ddx = nx - s.x, ddz = nz - s.z;
    const minD = s.r + 0.8;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 < minD * minD) {
      const d = Math.sqrt(d2) || 0.001;
      nx = s.x + (ddx / d) * minD;
      nz = s.z + (ddz / d) * minD;
    }
  }

  // arena bounds
  const lim = ARENA.size - 3;
  nx = THREE.MathUtils.clamp(nx, -lim, lim);
  nz = THREE.MathUtils.clamp(nz, -lim, lim);

  player.pos.x = nx;
  player.pos.z = nz;

  // jump / gravity
  if (!player.onGround) {
    player.vy -= GRAVITY * dt;
    player.h += player.vy * dt;
    if (player.h <= 0) { player.h = 0; player.vy = 0; player.onGround = true; }
  }

  // head bob (only while running on the ground)
  let bob = 0, sway = 0;
  if (moving && player.onGround) {
    bobPhase += dt * speed * 1.1;
    bob = Math.sin(bobPhase * 2) * 0.06;
    sway = Math.cos(bobPhase) * 0.04;
  }
  camera.position.set(player.pos.x + shake.x, PLAYER_EYE + player.h + bob + shake.y, player.pos.z + shake.z);

  // gentle idle/walk sway of the view model
  if (!swinging) {
    stickHolder.position.x = 0.72 + sway;
    stickHolder.position.y = -0.78 + bob * 0.5;
  }
}

// ---------------------------------------------------------------------------
// Rainbow stick color cycling + loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (controls.enabled) {
    updateMovement(dt);
    if (isHostOrSolo()) {
      // host/solo own the world simulation
      const pls = playersList();
      bossMgr.update(dt, pls, onAnyPlayerHit);
      enemies.update(dt, pls, onAnyPlayerHit, bossMgr.boss);
      UI.updateBossTimer(bossMgr.timer, bossMgr.active);
    } else {
      // client: mirror the host's snapshot, run no AI
      enemies.updateRemote(dt);
      bossMgr.updateRemote(dt);
      UI.updateBossTimer(clientWorld.t || 0, bossMgr.active);
    }
    updateAbilities(dt);
    updateThrow(dt);
    updateThrowCooldownUI(dt);
    if (mpActive()) { remote.update(dt); netTick(dt); if (net.isHost) worldTick(dt); }
  }

  // combo decay
  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0 && combo > 0) { combo = 0; }
  }

  // rainbow/glow cycling on equipped stick
  if (currentStick && currentStick.userData.rainbow) {
    const hue = (clock.elapsedTime * 0.25) % 1;
    const col = new THREE.Color().setHSL(hue, 1, 0.6);
    currentStick.userData.rainbow.forEach((m) => { m.emissive.copy(col); m.color.copy(col); });
  }

  renderer.render(scene, camera);
  updatePreviewFrame();
  requestAnimationFrame(animate);
}
animate();

// ---------------------------------------------------------------------------
// Locker / start-screen 3D avatar preview (shows equipped cosmetics)
// ---------------------------------------------------------------------------
function ensurePreview() {
  const pcanvas = document.getElementById('preview-canvas');
  if (!pcanvas || preview) return;
  const r = new THREE.WebGLRenderer({ canvas: pcanvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.setSize(pcanvas.clientWidth, pcanvas.clientHeight, false);
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 1); dl.position.set(3, 6, 4); s.add(dl);
  const cam = new THREE.PerspectiveCamera(40, pcanvas.clientWidth / pcanvas.clientHeight, 0.1, 100);
  cam.position.set(0, 2.6, 9);
  cam.lookAt(0, 2.2, 0);
  const root = new THREE.Group(); s.add(root);
  preview = { r, s, cam, root, pcanvas };
  updatePreview();
}

function updatePreview() {
  ensurePreview();
  if (!preview) return;
  preview.root.clear();

  const bodyItem = SHOP_ITEMS.find((i) => i.id === state.equipped.Skins);
  const ch = createCharacter({ body: bodyItem ? bodyItem.color : 0xffcf6e, shirt: 0x3aa0ff });
  preview.root.add(ch);

  // hat
  const hatItem = SHOP_ITEMS.find((i) => i.id === state.equipped.Hats);
  if (hatItem) preview.root.add(makeHat(hatItem));

  // stick in hand
  const stick = buildStick(findSkin(state.equippedStick));
  stick.scale.setScalar(0.8);
  stick.position.set(1.2, 2.4, 0.3);
  stick.rotation.z = -0.5;
  preview.root.add(stick);

  // aura ring
  const auraItem = SHOP_ITEMS.find((i) => i.id === state.equipped.Auras);
  if (auraItem) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.18, 8, 32),
      new THREE.MeshStandardMaterial({ color: auraItem.color, emissive: auraItem.color, emissiveIntensity: 1 })
    );
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.3;
    preview.root.add(ring);
    preview.auraRing = ring;
  } else preview.auraRing = null;
}

function updatePreviewFrame() {
  if (!preview) return;
  const visible = !startScreen.classList.contains('hidden') ||
    document.getElementById('skins-panel').classList.contains('show');
  if (!visible) return;
  preview.root.rotation.y += 0.012;
  if (preview.auraRing) preview.auraRing.rotation.z += 0.03;
  preview.r.render(preview.s, preview.cam);
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (preview) {
    const pc = preview.pcanvas;
    preview.cam.aspect = pc.clientWidth / pc.clientHeight;
    preview.cam.updateProjectionMatrix();
    preview.r.setSize(pc.clientWidth, pc.clientHeight, false);
  }
});

// expose a couple things for quick debugging in devtools
window.__game = { state, player, enemies, bossMgr, equipStickById, controls, swing, throwStick, jump, takeDamage, remote, startMultiplayer, localPlayerState, get net() { return net; }, get thrown() { return thrownStick; } };
