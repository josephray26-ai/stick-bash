import * as THREE from 'three';
import { createWorld, createCharacter, buildStick, ARENA } from './world.js';
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
    }
  },
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
  let hit = enemies.tryHit(player.pos, getForward(), 5.2, 0.55);
  // the boss is big — a swing that lands on it counts too
  if (bossMgr.boss && bossMgr.boss.tryHit(player.pos, getForward(), 5.2, 1)) hit = true;
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
  if (bossMgr.boss && bossMgr.boss.state === 'active') {
    const b = bossMgr.boss.group.position; if (Math.hypot(b.x - pos.x, b.z - pos.z) < 6) { bossMgr.boss.hit(3); awardHit(0); }
  }
  // splash on grouped NPCs
  for (const e of enemies.enemies) {
    if (e.state !== 'alive') continue;
    if (Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z) < 4.5) { enemies.hit(e, pos); awardHit(0); }
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
    if (bossMgr.boss && bossMgr.boss.state === 'active') { const b = bossMgr.boss.group.position; if (Math.hypot(b.x - p.group.position.x, b.z - p.group.position.z) < 4.5 && Math.abs(p.group.position.y - 5) < 7) boom = true; }
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
  resetBattle();
  bossMgr.clear(); UI.hideBoss();   // clear any active boss + its HUD
  updatePreview();             // refresh the locker avatar with current cosmetics
  startScreen.classList.remove('hidden');
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
    bossMgr.update(dt, player, takeDamage);
    UI.updateBossTimer(bossMgr.timer, bossMgr.active);
    enemies.update(dt, player.pos, takeDamage, bossMgr.boss);
    updateAbilities(dt);
    updateThrow(dt);
    updateThrowCooldownUI(dt);
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

function makeHat(item) {
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
window.__game = { state, player, enemies, bossMgr, equipStickById, controls, swing, throwStick, jump, takeDamage, get thrown() { return thrownStick; } };
