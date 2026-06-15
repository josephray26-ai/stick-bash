import * as THREE from 'three';
import { ARENA } from './world.js';

const gsap = window.gsap;

// NPCs pop in over ~0.35s; the boss drop is 3x slower.
const NPC_DROP = 0.35;
const BOSS_DROP_DUR = NPC_DROP * 3;
export const BOSS_INTERVAL = 150; // seconds of game time between bosses (2.5 min)
const NO_HIT = () => {};          // hazards are visual; damage is delivered map-wide

const bmat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...o });
const glow = (color, i = 0.8) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.4 });
const B = (w, h, d, color, o) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bmat(color, o));
const CON = (r, h, color, seg = 6, o) => new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), bmat(color, o));
const SPH = (r, color, o) => new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), bmat(color, o));

function eyes(g, y, z, color = 0xff2200) {
  for (const sx of [-0.6, 0.6]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), glow(color, 1)); e.position.set(sx, y, z); g.add(e); }
}

// ---------------------------------------------------------------------------
// Boss models — big blocky hybrid creatures (~12 units tall)
// ---------------------------------------------------------------------------
function buildPyrosaurus() {
  const g = new THREE.Group(); const c = 0xcc3a1f, c2 = 0xff7a2a;
  const body = B(3.6, 3.4, 5.2, c); body.position.set(0, 5.2, 0); g.add(body);
  const belly = B(3, 2.4, 4.4, c2); belly.position.set(0, 4.4, 0.3); g.add(belly);
  const neck = B(1.8, 2.2, 1.8, c); neck.position.set(0, 7, 1.9); neck.rotation.x = -0.3; g.add(neck);
  const head = new THREE.Group(); head.position.set(0, 8.3, 3); g.add(head);
  head.add(B(2, 1.6, 2.6, c));
  const jaw = B(1.8, 0.5, 2.2, 0x7a1f10); jaw.position.set(0, -0.9, 0.2); head.add(jaw);
  for (const sx of [-0.7, 0.7]) { const horn = CON(0.3, 1.4, 0xffe0a0); horn.position.set(sx, 1, -0.4); horn.rotation.x = -0.4; head.add(horn); }
  eyes(head, 0.3, 1.2);
  for (const sx of [-1.4, 1.4]) { const wing = CON(2.2, 3.2, 0x8a1f10, 3); wing.scale.set(1, 0.4, 0.12); wing.rotation.z = sx > 0 ? -1.1 : 1.1; wing.position.set(sx * 1.4, 6.5, -0.5); g.add(wing); }
  const tail = new THREE.Group(); tail.position.set(0, 4.6, -2.6); g.add(tail);
  let px = 0; for (let i = 0; i < 4; i++) { const seg = B(1.4 - i * 0.25, 1.4 - i * 0.25, 1.6, c); seg.position.set(0, -i * 0.2, -i * 1.4); tail.add(seg); }
  for (const sx of [-1, 1]) { const leg = B(1.3, 4, 1.6, c); leg.position.set(sx, 2, -0.4); g.add(leg); const foot = B(1.6, 0.6, 2.2, 0x7a1f10); foot.position.set(sx, 0.3, 0.2); g.add(foot); }
  for (const sx of [-1.5, 1.5]) { const arm = B(0.5, 1.4, 0.5, c2); arm.position.set(sx, 5.5, 2); arm.rotation.x = -0.6; g.add(arm); }
  g.userData.parts = { head, jaw, tail };
  return g;
}

function buildTriceraminos() {
  const g = new THREE.Group(); const c = 0x9c8f5a, c2 = 0xb5742a, bronze = 0xc9913f;
  const body = B(4, 3.4, 5.4, c); body.position.set(0, 4.6, 0); g.add(body);
  const armor = B(4.2, 1.2, 5.6, bronze, { metalness: 0.6, roughness: 0.4 }); armor.position.set(0, 6, 0); g.add(armor);
  const head = new THREE.Group(); head.position.set(0, 4.4, 3.2); g.add(head);
  const frill = B(5, 4, 0.6, bronze, { metalness: 0.6 }); frill.position.set(0, 0.8, -0.6); head.add(frill);
  head.add(B(2.4, 2.2, 2.4, c));
  for (const sx of [-0.9, 0.9]) { const horn = CON(0.35, 2.4, 0xeee4c0); horn.position.set(sx, 0.8, 1.2); horn.rotation.x = 1.1; head.add(horn); }
  const noseHorn = CON(0.3, 1.6, 0xeee4c0); noseHorn.position.set(0, -0.2, 1.5); noseHorn.rotation.x = 1.3; head.add(noseHorn);
  eyes(head, 0.4, 1.1, 0xff3300);
  for (const sx of [-1.4, 1.4]) for (const pz of [-1.6, 1.6]) { const leg = B(1.3, 3.6, 1.3, c); leg.position.set(sx, 1.8, pz); g.add(leg); }
  const tail = new THREE.Group(); tail.position.set(0, 4, -2.8); g.add(tail);
  for (let i = 0; i < 3; i++) { const s = B(1.2 - i * 0.3, 1.2 - i * 0.3, 1.4, c); s.position.set(0, 0, -i * 1.3); tail.add(s); }
  g.userData.parts = { head, tail };
  return g;
}

function buildAerophoenix() {
  const g = new THREE.Group(); const c = 0xff5a1f, c2 = 0xffc24d;
  const body = B(2.2, 2.2, 3.6, c); body.position.set(0, 7, 0); g.add(body);
  const head = new THREE.Group(); head.position.set(0, 8, 1.8); g.add(head);
  head.add(B(1.4, 1.4, 1.4, c));
  const beak = CON(0.5, 1.8, 0xffd24d); beak.rotation.x = Math.PI / 2; beak.position.set(0, -0.1, 1.3); head.add(beak);
  const crest = CON(0.4, 1.6, c2, 3); crest.scale.set(1, 1, 0.3); crest.position.set(0, 1, -0.3); head.add(crest);
  eyes(head, 0.2, 0.7, 0xfff04d);
  const wings = [];
  for (const sx of [-1, 1]) { const wing = new THREE.Group(); wing.position.set(sx * 1.1, 7.2, 0);
    const w1 = CON(2.6, 4.5, c2, 3); w1.scale.set(1, 0.35, 0.1); w1.rotation.z = sx > 0 ? -1.3 : 1.3; w1.material = glow(c2, 0.5); wing.add(w1);
    g.add(wing); wings.push(wing); }
  const tail = CON(0.8, 3, c2, 3); tail.scale.set(1, 0.3, 1); tail.rotation.x = -1.8; tail.position.set(0, 6.6, -2.2); g.add(tail);
  g.userData.parts = { head, wings, flying: true };
  return g;
}

function buildSpinoleviathan() {
  const g = new THREE.Group(); const c = 0x1f7a8a, c2 = 0x2fd0d0;
  const body = B(3, 3, 6, c); body.position.set(0, 4.4, 0); g.add(body);
  const head = new THREE.Group(); head.position.set(0, 4.2, 3.6); g.add(head);
  head.add(B(1.8, 1.6, 3, c));
  const snout = B(1.4, 1, 1.6, c); snout.position.set(0, -0.2, 1.8); head.add(snout);
  eyes(head, 0.6, 0.6, 0x66ffd0);
  const sail = new THREE.Group(); sail.position.set(0, 6, -0.5); g.add(sail);
  for (let i = 0; i < 5; i++) { const fin = CON(1.6 - Math.abs(i - 2) * 0.3, 2.6, c2, 3); fin.scale.set(0.12, 1, 1); fin.material = glow(c2, 0.6); fin.position.set(0, 0.5, 1.6 - i * 0.9); sail.add(fin); }
  const tentacles = [];
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; const t = new THREE.Group(); t.position.set(Math.cos(a) * 2.2, 1.4, Math.sin(a) * 2.2 - 1);
    for (let s = 0; s < 3; s++) { const seg = B(0.5 - s * 0.1, 1.2, 0.5 - s * 0.1, c2); seg.position.set(Math.sin(s) * 0.3, 0.6 + s * 1, 0); t.add(seg); }
    g.add(t); tentacles.push(t); }
  for (const sx of [-1.4, 1.4]) { const leg = B(1, 3, 1.4, c); leg.position.set(sx, 1.6, 0); g.add(leg); }
  g.userData.parts = { head, sail, tentacles };
  return g;
}

function buildAnkylogolem() {
  const g = new THREE.Group(); const c = 0x6b6b6b, c2 = 0x8a8a8a, crystal = 0x6ff0ff;
  const body = B(4.4, 3, 5.4, c); body.position.set(0, 3.6, 0); g.add(body);
  const shell = B(4.8, 1.6, 5.8, c2, { roughness: 0.9 }); shell.position.set(0, 5, 0); g.add(shell);
  for (let i = 0; i < 8; i++) { const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), glow(crystal, 0.5)); cr.position.set((Math.random() - 0.5) * 4, 5.8, (Math.random() - 0.5) * 5); g.add(cr); }
  const head = new THREE.Group(); head.position.set(0, 3.4, 3); g.add(head);
  head.add(B(2.2, 1.8, 1.8, c));
  eyes(head, 0.2, 0.9, 0x6ff0ff);
  for (const sx of [-1.5, 1.5]) for (const pz of [-1.6, 1.6]) { const leg = B(1.4, 2.6, 1.4, c); leg.position.set(sx, 1.3, pz); g.add(leg); }
  const tail = new THREE.Group(); tail.position.set(0, 3, -3); g.add(tail);
  for (let i = 0; i < 3; i++) { const s = B(0.9, 0.9, 1.3, c); s.position.set(0, 0, -i * 1.2); tail.add(s); }
  const club = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 0), bmat(c2, { roughness: 0.9 })); club.position.set(0, 0.2, -4); tail.add(club);
  for (let i = 0; i < 5; i++) { const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), glow(crystal, 0.5)); const a = (i / 5) * Math.PI * 2; cr.position.set(Math.cos(a) * 1.4, 0.2 + Math.sin(a) * 1.4, -4); tail.add(cr); }
  g.userData.parts = { head, tail, club };
  return g;
}

export const BOSS_DEFS = [
  { id: 'pyro', name: 'PYROSAURUS REX', sub: 'The Ember Tyrant', emoji: '🔥', color: 0xff5a1f, hp: 170, build: buildPyrosaurus, reward: 'Molten Crown 👑' },
  { id: 'tricera', name: 'TRICERA-MINOS', sub: 'The Bonecrusher King', emoji: '🐂', color: 0xc9913f, hp: 210, build: buildTriceraminos, reward: 'Labyrinth Greataxe 🪓' },
  { id: 'phoenix', name: 'AERO-PHOENIX "STRIX"', sub: 'The Sky Screamer', emoji: '🪶', color: 0xffc24d, hp: 140, build: buildAerophoenix, reward: 'Featherfall Glider 🪽' },
  { id: 'spino', name: 'SPINO-LEVIATHAN', sub: 'The Deep Devourer', emoji: '🌊', color: 0x2fd0d0, hp: 180, build: buildSpinoleviathan, reward: 'Abyssal Trident 🔱' },
  { id: 'ankylo', name: 'ANKYLO-GOLEM "TERRAGUARD"', sub: 'The Living Fortress', emoji: '🪨', color: 0x8a8a8a, hp: 240, build: buildAnkylogolem, reward: 'Core Crystal Maul 💎' },
];

// ---------------------------------------------------------------------------
// Hazards — telegraphed damage zones / effects
// ---------------------------------------------------------------------------
function decal(scene, x, z, r, color) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z); scene.add(m); return m;
}

class Hazard {
  constructor(scene, kind, p) { this.scene = scene; this.kind = kind; this.p = p; this.t = 0; this.done = false; this.meshes = []; this.init(); }
  add(m) { this.meshes.push(m); this.scene.add(m); return m; }
  init() {
    const p = this.p, s = this.scene;
    if (this.kind === 'circle' || this.kind === 'fall' || this.kind === 'pillar' || this.kind === 'vortex') {
      this.tele = decal(s, p.x, p.z, p.r, p.color); this.meshes.push(this.tele);
    } else if (this.kind === 'ring') {
      this.ringMesh = this.add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.4, 8, 32), glow(p.color, 0.9)));
      this.ringMesh.rotation.x = -Math.PI / 2; this.ringMesh.position.set(p.x, 0.4, p.z);
    } else if (this.kind === 'wave') {
      this.wave = this.add(new THREE.Mesh(new THREE.BoxGeometry(ARENA.size * 2, 5, 2.5), glow(p.color, 0.5)));
      this.wave.material.transparent = true; this.wave.material.opacity = 0.6;
      this.wave.position.set(0, 2.5, p.from); this.dir = Math.sign(p.to - p.from);
    }
  }
  update(dt, player, onHit) {
    this.t += dt; const p = this.p, ph = player.h || 0;
    const near = (x, z, r) => { const dx = player.pos.x - x, dz = player.pos.z - z; return dx * dx + dz * dz < r * r; };
    if (this.kind === 'circle') {
      const warn = p.warn ?? 0.7;
      if (this.t < warn) { this.tele.material.opacity = 0.25 + Math.abs(Math.sin(this.t * 12)) * 0.35; }
      else { this.tele.material.color.setHex(p.color); this.tele.material.opacity = 0.55;
        if (ph < 1.3 && near(p.x, p.z, p.r)) onHit(new THREE.Vector3(p.x, 0, p.z), p.dmg); }
      if (this.t > warn + (p.active ?? 0.6)) this.finish();
    } else if (this.kind === 'fall' || this.kind === 'pillar') {
      const warn = p.warn ?? 0.9;
      if (this.t < warn) { this.tele.material.opacity = 0.25 + Math.abs(Math.sin(this.t * 12)) * 0.4; }
      else {
        if (!this.obj) {
          if (this.kind === 'fall') { this.obj = this.add(new THREE.Mesh(new THREE.IcosahedronGeometry(p.r * 0.8, 0), bmat(p.rock ? 0x6b6b6b : p.color, p.rock ? {} : { emissive: p.color, emissiveIntensity: 0.7 }))); this.obj.position.set(p.x, 18, p.z); }
          else { this.obj = this.add(new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.7, p.r * 0.9, 6, 6), bmat(0x7a6a55))); this.obj.position.set(p.x, -3, p.z); }
        }
        if (this.kind === 'fall') { this.obj.position.y = Math.max(0.8, this.obj.position.y - dt * 70); if (this.obj.position.y <= 0.9 && ph < 1.3 && near(p.x, p.z, p.r)) onHit(new THREE.Vector3(p.x, 0, p.z), p.dmg); }
        else { this.obj.position.y = Math.min(3, this.obj.position.y + dt * 24); if (ph < 2.5 && near(p.x, p.z, p.r * 0.9)) onHit(new THREE.Vector3(p.x, 0, p.z), p.dmg); }
      }
      if (this.t > warn + 0.9) this.finish();
    } else if (this.kind === 'ring') {
      const r = THREE.MathUtils.lerp(1.5, p.maxR, Math.min(1, this.t / p.dur));
      this.ringMesh.scale.set(r, r, 1.5);
      const d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
      if (ph < 1.4 && Math.abs(d - r) < 2.2) onHit(new THREE.Vector3(p.x, 0, p.z), p.dmg);
      if (this.t > p.dur) this.finish();
    } else if (this.kind === 'vortex') {
      this.tele.rotation.z += dt * 4; this.tele.material.opacity = 0.4;
      const dx = p.x - player.pos.x, dz = p.z - player.pos.z; const d = Math.hypot(dx, dz) || 1;
      if (d < p.r * 1.8) { player.knock.x += (dx / d) * p.pull * dt * 60; player.knock.z += (dz / d) * p.pull * dt * 60; }
      if (d < p.r * 0.6) onHit(new THREE.Vector3(p.x, 0, p.z), p.dmg);
      if (this.t > p.dur) this.finish();
    } else if (this.kind === 'wave') {
      this.wave.position.z += this.dir * p.speed * dt;
      if (Math.abs(player.pos.z - this.wave.position.z) < 2 && ph < 1.4) { onHit(new THREE.Vector3(player.pos.x, 0, this.wave.position.z - this.dir * 3), p.dmg); player.knock.z += this.dir * 14; }
      if ((this.dir > 0 && this.wave.position.z > p.to) || (this.dir < 0 && this.wave.position.z < p.to)) this.finish();
    }
    return this.done;
  }
  finish() { this.done = true; for (const m of this.meshes) this.scene.remove(m); }
}

// ---------------------------------------------------------------------------
// Boss instance
// ---------------------------------------------------------------------------
class Boss {
  constructor(scene, def, cb) {
    this.scene = scene; this.def = def; this.cb = cb;
    this.group = def.build();
    this.group.position.set(0, 40, 0);
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(this.group);
    this.maxHp = def.hp; this.hp = def.hp;
    this.state = 'dropping'; this.t = 0; this.phase = 1;
    this.attackCD = 2.5; this.attacking = 0; this.atkIndex = 0;
    this.hazards = []; this.invincible = true; this.reviveUsed = false;
    this.bob = Math.random() * 6.28; this.stun = 0; this.charge = null;
    this.flying = !!this.group.userData.parts.flying;
    this.baseY = this.flying ? 6 : 0;
    cb.onSpawn(def);
  }

  update(dt, player, onPlayerHit) {
    this.t += dt;
    // hazards are now purely visual telegraphs (+ pull/push) — the damage of every
    // special attack is delivered map-wide via the pending global strike below
    for (let i = this.hazards.length - 1; i >= 0; i--) if (this.hazards[i].update(dt, player, NO_HIT)) this.hazards.splice(i, 1);

    // a special attack lands on EVERYONE on the map, wherever they are
    if (this.pendingStrike) {
      this.pendingStrike.t -= dt;
      if (this.pendingStrike.t <= 0) { this.cb.onAreaAttack(this.pendingStrike.dmg); this.pendingStrike = null; }
    }

    if (this.state === 'dropping') {
      const k = Math.min(1, this.t / BOSS_DROP_DUR);
      this.group.position.y = this.baseY + (40 - this.baseY) * (1 - k * k); // accelerating fall
      this.group.rotation.y += dt * 2;
      if (k >= 1) { this.group.position.y = this.baseY; this.state = 'active'; this.invincible = false; this.cb.onLand(); }
      return;
    }
    if (this.state === 'dead') return;
    if (this.state === 'dying') { this.group.rotation.z += dt * 2; this.group.position.y += dt * 1.5; this.group.scale.multiplyScalar(1 - dt * 1.2); if (this.group.scale.x < 0.05) { this.state = 'dead'; this.scene.remove(this.group); } return; }

    // face the player
    const px = player.pos.x, pz = player.pos.z;
    this.group.lookAt(px, this.group.position.y, pz);
    // idle bob / wing flap / sail glow
    this.bob += dt * 3;
    if (this.flying && !this._diving) this.group.position.y = this.baseY + Math.sin(this.bob) * 0.6;
    const wings = this.group.userData.parts.wings;
    if (wings) wings.forEach((w, i) => w.rotation.z = (i ? 1 : -1) * (0.2 + Math.sin(this.bob * 2) * 0.3));

    if (this.stun > 0) { this.stun -= dt; this.group.rotation.z = Math.sin(this.t * 20) * 0.1; return; }
    this.group.rotation.z = 0;

    // ---- safety: the model must never vanish ----
    // reset non-finite drift, keep it inside the arena, and (unless it's mid-dive or
    // charging) never let it sit on top of the camera, which clips the mesh away.
    const lim = ARENA.size - 4;
    if (!isFinite(this.group.position.x) || !isFinite(this.group.position.z) || !isFinite(this.group.position.y)) {
      this.group.position.set(0, this.baseY, 0);
    }
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -lim, lim);
    this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -lim, lim);
    if (!this._diving && !this.charge) {
      const ddx = this.group.position.x - px, ddz = this.group.position.z - pz, dd = Math.hypot(ddx, ddz);
      if (dd > 0.0001 && dd < 4) { this.group.position.x = px + (ddx / dd) * 4; this.group.position.z = pz + (ddz / dd) * 4; }
    }

    // charge movement (Tricera / Ankylo shell)
    if (this.charge) {
      this.group.position.x += this.charge.x * this.charge.spd * dt;
      this.group.position.z += this.charge.z * this.charge.spd * dt;
      const lim = ARENA.size - 4;
      const hitWall = Math.abs(this.group.position.x) > lim || Math.abs(this.group.position.z) > lim;
      const dx = px - this.group.position.x, dz = pz - this.group.position.z;
      if (dx * dx + dz * dz < 16 && (player.h || 0) < 2.5) onPlayerHit(this.group.position, this.charge.dmg, player.id);
      if (hitWall) {
        this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -lim, lim);
        this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -lim, lim);
        this.stun = this.charge.stunsOnWall ? 2.6 : 0; this.invincible = false; this.charge = null;
      }
      return;
    }

    // approach the player when not mid-attack
    if (this.attacking <= 0) {
      const dx = px - this.group.position.x, dz = pz - this.group.position.z; const d = Math.hypot(dx, dz) || 1;
      if (d > 7) { const spd = 2.6; this.group.position.x += (dx / d) * spd * dt; this.group.position.z += (dz / d) * spd * dt;
        const legs = []; /* simple stomp via bob already */ }
      this.attackCD -= dt;
      if (this.attackCD <= 0) this.startAttack(player);
    } else {
      this.attacking -= dt;
    }
  }

  startAttack(player) {
    const atks = ATTACKS[this.def.id];
    const name = atks[this.atkIndex % atks.length]; this.atkIndex++;
    this.attackCD = (this.phase === 2 ? 1.8 : 3.4) + Math.random();
    this.attacking = 1.0;
    this[name] ? this[name](player) : this.genericSlam(player);
    // the attack's damage lands on everyone ~0.7s later (after the telegraph), no matter where they are
    this.pendingStrike = { t: 0.7, dmg: this.phase === 2 ? 18 : 13 };
  }

  spawnHazard(kind, p) { p.color = p.color ?? this.def.color; this.hazards.push(new Hazard(this.scene, kind, p)); }
  bossPos() { return this.group.position; }
  inFront(dist) { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion); return new THREE.Vector3(this.group.position.x + f.x * dist, 0, this.group.position.z + f.z * dist); }

  // ---- attacks ----
  infernoRoar(player) {
    const jaw = this.group.userData.parts.jaw; if (jaw && gsap) gsap.to(jaw.rotation, { x: 0.6, duration: 0.2, yoyo: true, repeat: 1 });
    for (let i = 0; i < 5; i++) { const p = this.inFront(6 + i * 2.5); this.spawnHazard('circle', { x: p.x + (Math.random() - 0.5) * 4, z: p.z + (Math.random() - 0.5) * 4, r: 3, warn: 0.7, active: 5, dmg: 16, color: 0xff5a1f }); }
  }
  tailQuake() { const t = this.group.userData.parts.tail; if (t && gsap) gsap.fromTo(t.rotation, { x: 0 }, { x: 0.8, duration: 0.18, yoyo: true, repeat: 1 }); this.spawnHazard('ring', { x: this.group.position.x, z: this.group.position.z, maxR: 26, dur: 1.3, dmg: 18, color: 0xff7a2a }); this.cb.onShake(0.5); }
  fireRain(player) { for (let i = 0; i < 6; i++) this.spawnHazard('fall', { x: player.pos.x + (Math.random() - 0.5) * 16, z: player.pos.z + (Math.random() - 0.5) * 16, r: 2.6, warn: 0.8, dmg: 16, color: 0xff5a1f }); }

  charge_(player) { const dx = player.pos.x - this.group.position.x, dz = player.pos.z - this.group.position.z; const d = Math.hypot(dx, dz) || 1; this.charge = { x: dx / d, z: dz / d, spd: 26, dmg: 24, stunsOnWall: true }; this.invincible = true; this.attacking = 2.5; }
  frillSlam() { this.spawnHazard('ring', { x: this.group.position.x, z: this.group.position.z, maxR: 9, dur: 0.5, dmg: 14, color: 0xc9913f }); this.cb.onShake(0.3); }
  pillars(player) { for (let i = 0; i < 5; i++) { const a = Math.random() * 6.28, r = 3 + Math.random() * 8; this.spawnHazard('pillar', { x: player.pos.x + Math.cos(a) * r, z: player.pos.z + Math.sin(a) * r, r: 2, warn: 0.7, dmg: 18, color: 0x8a8a8a }); } }

  diveStrike(player) {
    const tx = player.pos.x, tz = player.pos.z;
    // land a few units SHORT of the player so the camera never ends up inside the model
    const ang = Math.atan2(this.group.position.z - tz, this.group.position.x - tx) || 0;
    const lx = tx + Math.cos(ang) * 5, lz = tz + Math.sin(ang) * 5;
    this.spawnHazard('circle', { x: tx, z: tz, r: 3.5, warn: 0.9, active: 0.4, dmg: 22, color: 0xff3030 });
    if (gsap) {
      gsap.killTweensOf(this.group.position);   // never stack with a prior dive
      this._diving = true;
      gsap.timeline({ onComplete: () => { this._diving = false; } })
        .to(this.group.position, { y: this.baseY + 9, duration: 0.3, ease: 'power2.out' })
        .to(this.group.position, { x: lx, z: lz, duration: 0.55, ease: 'power3.in' }, '<')
        .to(this.group.position, { y: this.baseY, duration: 0.25, ease: 'power2.out' });
    }
  }
  featherStorm() { for (let i = 0; i < 8; i++) { const p = this.inFront(5 + i * 2); this.spawnHazard('circle', { x: p.x + (i - 4) * 1.8, z: p.z, r: 1.8, warn: 0.6, active: 0.5, dmg: 12, color: 0xffc24d }); } }

  tidalSurge() { this.spawnHazard('wave', { from: -ARENA.size, to: ARENA.size, speed: 26, dmg: 18, color: 0x2fd0d0 }); this.cb.onShake(0.35); }
  tentacleGrasp(player) { const ts = this.group.userData.parts.tentacles; for (let i = 0; i < 3; i++) { this.spawnHazard('pillar', { x: player.pos.x + (Math.random() - 0.5) * 10, z: player.pos.z + (Math.random() - 0.5) * 10, r: 2.2, warn: 0.7, dmg: 18, color: 0x1f7a8a }); } }
  whirlpool(player) { for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.28; this.spawnHazard('vortex', { x: player.pos.x + Math.cos(a) * 9, z: player.pos.z + Math.sin(a) * 9, r: 3, dur: 3, pull: 0.5, dmg: 14, color: 0x2fd0d0 }); } }

  tailSmash() { const t = this.group.userData.parts.tail; if (t && gsap) gsap.fromTo(t.rotation, { y: -1.2 }, { y: 1.2, duration: 0.5, ease: 'power2.in' }); const p = this.inFront(5); this.spawnHazard('circle', { x: p.x, z: p.z, r: 6, warn: 0.8, active: 0.4, dmg: 26, color: 0x8a8a8a }); this.cb.onShake(0.4); }
  crystalShell(player) { const dx = player.pos.x - this.group.position.x, dz = player.pos.z - this.group.position.z; const d = Math.hypot(dx, dz) || 1; this.invincible = true; this.charge = { x: dx / d, z: dz / d, spd: 18, dmg: 20, stunsOnWall: false }; this.attacking = 3; setTimeout(() => { this.charge = null; this.invincible = false; this.stun = 1.5; }, 3000); }
  boulders(player) { for (let i = 0; i < 6; i++) this.spawnHazard('fall', { x: player.pos.x + (Math.random() - 0.5) * 18, z: player.pos.z + (Math.random() - 0.5) * 18, r: 2.6, warn: 0.9, dmg: 18, rock: true, color: 0x8a8a8a }); }
  genericSlam(player) { const p = this.inFront(5); this.spawnHazard('circle', { x: p.x, z: p.z, r: 4, warn: 0.7, active: 0.5, dmg: 18 }); }

  // ---- damage taken ----
  hit(amount = 1) {
    if (this.invincible || this.state !== 'active') return false;
    this.hp = Math.max(0, this.hp - amount);
    if (gsap) gsap.fromTo(this.group.scale, { x: this.group.scale.x }, { x: this.group.scale.x, duration: 0.05 }); // noop keep
    this.flash();
    if (this.phase === 1 && this.hp <= this.maxHp * 0.3) { this.phase = 2; this.cb.onPhase(this.def); }
    this.cb.onHpChange(this.hp, this.maxHp, this.phase);
    if (this.hp <= 0) {
      if (this.def.id === 'phoenix' && !this.reviveUsed) { this.reviveUsed = true; this.hp = Math.ceil(this.maxHp * 0.5); this.phase = 2; this.cb.onRevive(this.def); this.cb.onHpChange(this.hp, this.maxHp, this.phase); return true; }
      this.die();
    }
    return true;
  }
  flash() { this.group.traverse((o) => { if (o.isMesh && o.material.emissive) { const m = o.material; const old = m.emissiveIntensity; m.emissiveIntensity = 1.5; setTimeout(() => { m.emissiveIntensity = old; }, 80); } }); }
  die() { this.state = 'dying'; this._diving = false; this.charge = null; this.pendingStrike = null; if (gsap) gsap.killTweensOf(this.group.position); for (const h of this.hazards) h.finish(); this.hazards = []; this.cb.onDefeat(this.def); }

  // player attacks the boss
  tryHit(playerPos, forward, reach, amount) {
    if (this.state !== 'active') return false;
    const dx = this.group.position.x - playerPos.x, dz = this.group.position.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > reach + 3) return false;
    const dot = (dx / dist) * forward.x + (dz / dist) * forward.z;
    if (dot < 0.4) return false;
    return this.hit(amount);
  }
  hitAt(pos, amount) {
    if (this.state !== 'active') return false;
    const dx = this.group.position.x - pos.x, dz = this.group.position.z - pos.z;
    if (Math.hypot(dx, dz) > 4.5) return false;
    return this.hit(amount);
  }
}

// which attacks each boss cycles through (phase-2 mechanic woven in)
const ATTACKS = {
  pyro: ['infernoRoar', 'tailQuake', 'fireRain'],
  tricera: ['charge_', 'frillSlam', 'pillars'],
  phoenix: ['diveStrike', 'featherStorm', 'diveStrike'],
  spino: ['tidalSurge', 'tentacleGrasp', 'whirlpool'],
  ankylo: ['tailSmash', 'crystalShell', 'boulders'],
};

// ---------------------------------------------------------------------------
// Manager: 5-minute timer + rotation
// ---------------------------------------------------------------------------
export class BossManager {
  constructor(scene, cb) { this.scene = scene; this.cb = cb; this.timer = BOSS_INTERVAL; this.index = 0; this.boss = null; this._cli = null; }

  // host/solo: `players` is [{ id, pos, h, knock }] — the boss targets the nearest.
  update(dt, players, onPlayerHit) {
    if (this.boss) {
      const bp = this.boss.group.position;
      let near = players[0], nd = Infinity;
      for (const pl of players) { const d = (pl.pos.x - bp.x) ** 2 + (pl.pos.z - bp.z) ** 2; if (d < nd) { nd = d; near = pl; } }
      this.boss.update(dt, near, onPlayerHit);
      if (this.boss.state === 'dead') this.boss = null;
    } else {
      this.timer -= dt;
      if (this.timer <= 0) this.spawnNext();
    }
  }

  spawnNext() {
    const def = BOSS_DEFS[this.index % BOSS_DEFS.length]; this.index++;
    this.timer = BOSS_INTERVAL;
    this.boss = new Boss(this.scene, def, this.cb);
    return this.boss;
  }

  // ---- multiplayer sync ----
  // Host snapshot: boss transform + hp/phase, or null when there's no boss.
  serialize() {
    const b = this.boss;
    if (!b || b.state === 'dead') return null;
    const p = b.group.position;
    return { d: BOSS_DEFS.indexOf(b.def), x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
      ry: +b.group.rotation.y.toFixed(2), hp: Math.round(b.hp), mx: b.maxHp, ph: b.phase };
  }

  // Client: build / update / remove a render-only boss model from the host snapshot.
  applySnapshot(snap) {
    if (!snap) {
      if (this._cli) { this.scene.remove(this._cli.group); this._cli = null; this.cb.onClientDespawn?.(); }
      return;
    }
    if (!this._cli || this._cli.d !== snap.d) {
      if (this._cli) this.scene.remove(this._cli.group);
      const def = BOSS_DEFS[snap.d];
      const g = def.build();
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.position.set(snap.x, snap.y, snap.z);
      this.scene.add(g);
      this._cli = { d: snap.d, def, group: g };
      this.cb.onClientSpawn?.(def);
    }
    const c = this._cli;
    c.tx = snap.x; c.ty = snap.y; c.tz = snap.z; c.tr = snap.ry;
    this.cb.onHpChange(snap.hp, snap.mx, snap.ph);
  }

  updateRemote(dt) {
    const c = this._cli; if (!c || c.tx === undefined) return;
    const k = Math.min(1, dt * 10);
    c.group.position.x += (c.tx - c.group.position.x) * k;
    c.group.position.y += (c.ty - c.group.position.y) * k;
    c.group.position.z += (c.tz - c.group.position.z) * k;
    let dr = (c.tr - c.group.rotation.y) % (Math.PI * 2);
    if (dr > Math.PI) dr -= Math.PI * 2; if (dr < -Math.PI) dr += Math.PI * 2;
    c.group.rotation.y += dr * k;
  }

  // remove any active boss (host or client) + hazards and reset the countdown
  clear() {
    if (this.boss) {
      for (const h of this.boss.hazards) h.finish();
      if (gsap) gsap.killTweensOf(this.boss.group.position);
      this.scene.remove(this.boss.group);
      this.boss = null;
    }
    if (this._cli) { this.scene.remove(this._cli.group); this._cli = null; }
    this.timer = BOSS_INTERVAL;
  }

  // position of whichever boss model exists (host's live boss or client's mirror)
  get pos() { return this.boss ? this.boss.group.position : (this._cli ? this._cli.group.position : null); }
  get active() { return (this.boss && this.boss.state !== 'dead') || !!this._cli; }
}
