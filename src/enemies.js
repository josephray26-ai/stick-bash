import * as THREE from 'three';
import { createCharacter, ARENA, buildStick, buildHeldStick } from './world.js';
import { STICK_SKINS } from './data.js';

const ENEMY_COLORS = [
  { body: 0xff9a8b, shirt: 0xff5a5a, pants: 0x3a3a55 },
  { body: 0xc8e6c9, shirt: 0x2e7d32, pants: 0x4e342e },
  { body: 0xffe0b2, shirt: 0x6a1b9a, pants: 0x263238 },
  { body: 0xb3e5fc, shirt: 0x0277bd, pants: 0x37474f },
  { body: 0xfff59d, shirt: 0xf9a825, pants: 0x4e342e },
  { body: 0xd1c4e9, shirt: 0x512da8, pants: 0x212121 },
];

const AGGRO = 20;            // within this range, enemies target the player
const ATTACK_RANGE = 3.4;    // melee reach
const THROW_MIN = 6;         // only throw from medium range
const THROW_MAX = 22;
const ENEMY_THROW_CD = 6;    // seconds between an enemy's throws
const PROJ_SPEED = 26;
const PROJ_RANGE = 26;
const PROJ_HIT_R = 2.0;

// The map is divided into a grid of zones. No more than MAX_PER_ZONE NPCs are
// allowed to occupy one zone at a time — overflow gets pushed to open space so
// the crowd never bunches up in one spot.
const ZONE_SIZE = 10;
const MAX_PER_ZONE = 2;
const ZONE_NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
// minimum centre-to-centre spacing between any two NPCs (hard personal space)
const SEPARATION = 4.5;
// the boss is huge, so NPCs attack it from its perimeter (further than ATTACK_RANGE)
const BOSS_REACH = 6.5;

// behaviour tiers: passive (just roam), defensive (only the player / retaliate),
// aggressive (pick fights with anyone). Assigned ~1/3 each.
const PERSONALITIES = ['passive', 'defensive', 'aggressive'];

const UP = new THREE.Vector3(0, 1, 0);
const randomSkin = () => STICK_SKINS[(Math.random() * STICK_SKINS.length) | 0];

export class EnemyManager {
  constructor(scene, target = 14) {
    this.scene = scene;
    this.targetCount = target;
    this.enemies = [];
    this.projectiles = [];
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    for (let i = 0; i < target; i++) this.spawn();
  }

  spawn() {
    const c = ENEMY_COLORS[(Math.random() * ENEMY_COLORS.length) | 0];
    const skin = randomSkin();
    const g = createCharacter({ ...c, weaponSkin: skin });
    g.position.copy(this.randomEdgePosition());
    g.scale.setScalar(0.0001);
    this.scene.add(g);
    // roughly a third of each personality: passive roamers, defensive (only fight
    // the player or whoever hits them), and aggressive (pick fights with anyone).
    const personality = PERSONALITIES[this.enemies.length % 3];
    const e = {
      group: g,
      parts: g.userData.parts,
      skin,
      personality,
      hp: 1,
      speed: 5.5 + Math.random() * 2.5,
      state: 'alive',
      walkPhase: Math.random() * Math.PI * 2,
      roam: null,                 // a wander destination point on the map
      knock: new THREE.Vector3(),
      stunTime: 0,
      deadTime: 0,
      attackCD: 1 + Math.random() * 2,
      attacking: false,
      attackTime: 0,
      attackHitDone: false,
      attackPlayer: false,        // is the current swing aimed at the player?
      attackEnemy: null,
      attackBoss: false,
      bossAtkCD: Math.random() * 5,   // each NPC can only hit the boss every 5s
      target: null,               // current target: 'player' | enemy object | null
      lastTarget: null,           // last one we attacked — can't be hit twice in a row
      retargetTimer: 0,
      jitter: 0,
      jitterT: 0,
      throwCD: 2 + Math.random() * ENEMY_THROW_CD,
      thrown: false,              // this enemy's stick is currently in flight
    };
    this.enemies.push(e);
    animateScale(g, 1, 0.35);
    return e;
  }

  randomEdgePosition() {
    const half = ARENA.size - 6;
    const edge = (Math.random() * 2 - 1) * half;
    const side = Math.floor(Math.random() * 4);
    const m = half;
    switch (side) {
      case 0: return new THREE.Vector3(edge, 0, -m);
      case 1: return new THREE.Vector3(edge, 0, m);
      case 2: return new THREE.Vector3(-m, 0, edge);
      default: return new THREE.Vector3(m, 0, edge);
    }
  }

  update(dt, playerPos, onPlayerHit, boss) {
    const half = ARENA.size - 3;
    const bossActive = boss && boss.state === 'active';
    this._bossPos = bossActive ? boss.group.position : null;  // lets the mob pack in tight
    this.updateProjectiles(dt, playerPos, onPlayerHit);

    // snapshot how many NPCs are in each zone — used to block moves into full zones
    this._zoneOcc = new Map();
    for (const e of this.enemies) {
      if (e.state !== 'alive') continue;
      const k = Math.floor((e.group.position.x + ARENA.size) / ZONE_SIZE) + ',' +
                Math.floor((e.group.position.z + ARENA.size) / ZONE_SIZE);
      this._zoneOcc.set(k, (this._zoneOcc.get(k) || 0) + 1);
    }

    for (const e of this.enemies) {
      const g = e.group;

      if (e.state === 'dying') {
        e.deadTime += dt;
        g.rotation.z += dt * 6;
        g.position.y += dt * 2;
        g.scale.multiplyScalar(1 - dt * 2.2);
        if (e.deadTime > 0.5) e.state = 'dead';
        continue;
      }
      if (e.state === 'dead') continue;

      // knockback decays
      if (e.knock.lengthSq() > 0.001) {
        g.position.addScaledVector(e.knock, dt);
        e.knock.multiplyScalar(Math.max(0, 1 - dt * 6));
      }

      if (e.attackCD > 0) e.attackCD -= dt;
      if (e.throwCD > 0) e.throwCD -= dt;
      if (e.bossAtkCD > 0) e.bossAtkCD -= dt;
      e.retargetTimer -= dt;

      const distToPlayer = this.tmp.copy(playerPos).sub(g.position).setY(0).length();

      // when a boss is on the map, every fighter (not the pacifists) gangs up on it
      const focusBoss = bossActive && e.personality !== 'passive';

      let targetPos = null, targetIsPlayer = false, targetEnemy = null, targetIsBoss = false;
      if (focusBoss) {
        targetIsBoss = true; targetPos = boss.group.position;
      } else {
        // ---- choose / refresh target (random, and never the one we just hit) ----
        let needPick = !e.target || e.retargetTimer <= 0;
        if (e.target && e.target !== 'player' && e.target.state !== 'alive') needPick = true;
        if (e.target === 'player' && distToPlayer > AGGRO * 1.4) needPick = true;
        if (needPick && !e.attacking) {
          e.target = this.pickTarget(e, distToPlayer);
          e.retargetTimer = 2.5 + Math.random() * 2.5;
        }
        if (e.target === 'player') { targetIsPlayer = true; targetPos = playerPos; }
        else if (e.target) { targetEnemy = e.target; targetPos = e.target.group.position; }
      }

      if (e.attacking) {
        // mid-swing — wind the arm and deal damage at the apex
        e.attackTime += dt;
        const p = Math.min(e.attackTime / 0.4, 1);
        e.parts.rightArm.rotation.x = -Math.sin(p * Math.PI) * 2.4;
        if (!e.attackHitDone && e.attackTime >= 0.2) {
          e.attackHitDone = true;
          if (e.attackBoss) {
            if (boss && boss.state === 'active') {
              const d = this.tmp.copy(boss.group.position).sub(g.position).setY(0).length();
              if (d < BOSS_REACH + 1) boss.hit(0.5);   // chip damage — the player does the bulk
            }
          } else if (e.attackPlayer) {
            if (distToPlayer < ATTACK_RANGE && onPlayerHit) onPlayerHit(e);
          } else if (e.attackEnemy && e.attackEnemy.state === 'alive') {
            const d = this.tmp.copy(e.attackEnemy.group.position).sub(g.position).setY(0).length();
            if (d < ATTACK_RANGE) this.brawlHit(e.attackEnemy, g.position, e);
          }
        }
        if (e.attackTime >= 0.4) {
          e.attacking = false; e.parts.rightArm.rotation.x = 0;
          if (!e.attackBoss) {
            e.lastTarget = e.attackPlayer ? 'player' : e.attackEnemy;  // can't hit this one again next
            e.target = null; e.retargetTimer = 0;                      // must find a new target first
          }
          e.attackBoss = false;
        }
        this.clamp(g, half);
        continue;
      }

      if (e.stunTime > 0) { e.stunTime -= dt; this.clamp(g, half); continue; }

      if (!targetPos) {
        // nobody to fight — roam toward a random spot anywhere on the map so the
        // crowd keeps spreading out instead of milling in one place
        const edge = ARENA.size - 6;
        if (!e.roam || this.tmp.copy(e.roam).sub(g.position).setY(0).lengthSq() < 16) {
          e.roam = new THREE.Vector3((Math.random() * 2 - 1) * edge, 0, (Math.random() * 2 - 1) * edge);
        }
        g.lookAt(e.roam.x, g.position.y, e.roam.z);
        const moveDir = this.tmp.copy(e.roam).sub(g.position).setY(0).normalize();
        this.tryMove(g, moveDir.x, moveDir.z, e.speed * 0.6 * dt);
        this.walkAnim(e, dt);
        this.clamp(g, half);
        continue;
      }

      // face the target
      g.lookAt(targetPos.x, g.position.y, targetPos.z);
      const dist = this.tmp.copy(targetPos).sub(g.position).setY(0).length();

      if (targetIsBoss) {
        // gang up on the boss (from its perimeter), but each NPC may only land a
        // hit every 5 seconds so the player still does the bulk of the damage
        if (dist < BOSS_REACH && e.bossAtkCD <= 0 && !e.thrown) {
          e.attacking = true; e.attackTime = 0; e.attackHitDone = false;
          e.attackBoss = true; e.attackPlayer = false; e.attackEnemy = null;
          e.bossAtkCD = 5;
        } else if (dist > BOSS_REACH - 0.6) {
          const moveDir = this.tmp.copy(targetPos).sub(g.position).setY(0).normalize();
          this.tryMove(g, moveDir.x, moveDir.z, e.speed * dt);
          this.walkAnim(e, dt);
        }
        this.clamp(g, half);
        continue;
      }

      if (dist < ATTACK_RANGE && e.attackCD <= 0 && !e.thrown) {
        // melee
        e.attacking = true; e.attackTime = 0; e.attackHitDone = false;
        e.attackPlayer = targetIsPlayer; e.attackEnemy = targetEnemy;
        e.attackCD = 1.6 + Math.random() * 1.2;
      } else if (dist > THROW_MIN && dist < THROW_MAX && e.throwCD <= 0 && !e.thrown) {
        // throw the stick at the target (counts as a hit — can't repeat it next)
        this.throwAt(e, targetPos);
        e.throwCD = ENEMY_THROW_CD;
        e.lastTarget = targetIsPlayer ? 'player' : targetEnemy;
        e.target = null; e.retargetTimer = 0;
      } else {
        // chase, with a little weave so they don't all beeline the same spot
        e.jitterT -= dt;
        if (e.jitterT <= 0) { e.jitter = (Math.random() - 0.5) * 0.9; e.jitterT = 0.4 + Math.random() * 0.9; }
        const moveDir = this.tmp.copy(targetPos).sub(g.position).setY(0).normalize().applyAxisAngle(UP, e.jitter);
        if (dist > ATTACK_RANGE - 0.6) this.tryMove(g, moveDir.x, moveDir.z, e.speed * dt);
        this.walkAnim(e, dt);
      }
      this.clamp(g, half);
    }

    this.enforceZones(dt);
    this.separate();
    for (const e of this.enemies) if (e.state === 'dead') this.respawn(e);
  }

  // Hard personal-space: no two NPCs may be closer than SEPARATION. Resolve
  // overlaps by pushing each pair apart (two relaxation passes for tightness).
  separate() {
    const half = ARENA.size - 3;
    const arr = this.enemies;
    const bp = this._bossPos, MOB = BOSS_REACH + 4;
    // NPCs swarming the boss pack in much tighter so they can actually reach it
    if (bp) for (const e of arr) e._mob = e.personality !== 'passive' && Math.hypot(e.group.position.x - bp.x, e.group.position.z - bp.z) < MOB;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i]; if (a.state !== 'alive') continue;
        for (let j = i + 1; j < arr.length; j++) {
          const b = arr[j]; if (b.state !== 'alive') continue;
          const minD = (bp && a._mob && b._mob) ? 2.3 : SEPARATION;
          const min2 = minD * minD;
          let dx = a.group.position.x - b.group.position.x;
          let dz = a.group.position.z - b.group.position.z;
          let d2 = dx * dx + dz * dz;
          if (d2 >= min2) continue;
          if (d2 < 1e-6) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d2 = dx * dx + dz * dz; }
          const d = Math.sqrt(d2);
          const push = (minD - d) * 0.5;
          dx /= d; dz /= d;
          a.group.position.x += dx * push; a.group.position.z += dz * push;
          b.group.position.x -= dx * push; b.group.position.z -= dz * push;
        }
      }
    }
    for (const e of arr) if (e.state === 'alive') this.clamp(e.group, half);
  }

  // Cap how many NPCs may share one map zone — push the overflow toward the
  // least-crowded neighbouring zone so the crowd spreads out instead of bunching.
  enforceZones(dt) {
    const half = ARENA.size - 3;
    const bp = this._bossPos, MOB = BOSS_REACH + 4;
    const occ = new Map();   // "i,j" -> count
    const lists = new Map(); // "i,j" -> [enemies]
    for (const e of this.enemies) {
      if (e.state !== 'alive') continue;
      // NPCs mobbing the boss are exempt from zone caps so they can swarm it
      if (bp && e.personality !== 'passive' && Math.hypot(e.group.position.x - bp.x, e.group.position.z - bp.z) < MOB) continue;
      const i = Math.floor((e.group.position.x + ARENA.size) / ZONE_SIZE);
      const j = Math.floor((e.group.position.z + ARENA.size) / ZONE_SIZE);
      const k = i + ',' + j;
      occ.set(k, (occ.get(k) || 0) + 1);
      let arr = lists.get(k);
      if (!arr) { arr = []; lists.set(k, arr); }
      arr.push(e);
    }

    for (const [k, list] of lists) {
      if (list.length <= MAX_PER_ZONE) continue;
      const [ci, cj] = k.split(',').map(Number);
      const cx = (ci + 0.5) * ZONE_SIZE - ARENA.size;
      const cz = (cj + 0.5) * ZONE_SIZE - ARENA.size;
      // keep the ones nearest this zone's centre; relocate the rest
      list.sort((a, b) =>
        ((a.group.position.x - cx) ** 2 + (a.group.position.z - cz) ** 2) -
        ((b.group.position.x - cx) ** 2 + (b.group.position.z - cz) ** 2));

      for (let n = MAX_PER_ZONE; n < list.length; n++) {
        const e = list[n];
        const dest = this.nearestOpenZone(ci, cj, occ, half);
        let dx, dz;
        if (dest) {
          dx = dest.x - e.group.position.x; dz = dest.z - e.group.position.z;
          occ.set(dest.key, (occ.get(dest.key) || 0) + 1);  // reserve a slot
          occ.set(k, occ.get(k) - 1);
        } else {
          dx = e.group.position.x - cx; dz = e.group.position.z - cz; // fully boxed in
          if (dx * dx + dz * dz < 0.25) { const a = (n / list.length) * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
        }
        const d = Math.hypot(dx, dz) || 1;
        const push = 14; // units/sec — firmer than their chase speed so it wins
        e.group.position.x += (dx / d) * push * dt;
        e.group.position.z += (dz / d) * push * dt;
        this.clamp(e.group, half);
      }
    }
  }

  // nearest zone (searching outward in rings) that still has room
  nearestOpenZone(ci, cj, occ, half) {
    for (let r = 1; r <= 6; r++) {
      let best = null, bestD = Infinity;
      for (let oi = -r; oi <= r; oi++) {
        for (let oj = -r; oj <= r; oj++) {
          if (Math.max(Math.abs(oi), Math.abs(oj)) !== r) continue; // ring perimeter only
          const x = (ci + oi + 0.5) * ZONE_SIZE - ARENA.size;
          const z = (cj + oj + 0.5) * ZONE_SIZE - ARENA.size;
          if (Math.abs(x) > half || Math.abs(z) > half) continue;
          if ((occ.get((ci + oi) + ',' + (cj + oj)) || 0) < MAX_PER_ZONE) {
            const dd = oi * oi + oj * oj;
            if (dd < bestD) { bestD = dd; best = { x, z, key: (ci + oi) + ',' + (cj + oj) }; }
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // may an NPC at (ox,oz) step to (nx,nz)? always yes within its own zone;
  // crossing into a different zone is denied if that zone is already full.
  canEnter(ox, oz, nx, nz) {
    const oi = Math.floor((ox + ARENA.size) / ZONE_SIZE), oj = Math.floor((oz + ARENA.size) / ZONE_SIZE);
    const ni = Math.floor((nx + ARENA.size) / ZONE_SIZE), nj = Math.floor((nz + ARENA.size) / ZONE_SIZE);
    if (ni === oi && nj === oj) return true;
    return (this._zoneOcc.get(ni + ',' + nj) || 0) < MAX_PER_ZONE;
  }

  // move along (dx,dz) by `step`, but never into a full zone — slide along the
  // border instead so NPCs queue around crowded areas rather than piling in.
  tryMove(g, dx, dz, step) {
    const tries = [[dx, dz], [dz, -dx], [-dz, dx]]; // forward, then slide each way
    for (const [ax, az] of tries) {
      const nx = g.position.x + ax * step, nz = g.position.z + az * step;
      if (this.canEnter(g.position.x, g.position.z, nx, nz)) {
        this.moveOcc(g.position.x, g.position.z, nx, nz);
        g.position.x = nx; g.position.z = nz;
        return;
      }
    }
  }

  // keep the live occupancy snapshot in sync so many NPCs can't pour into the
  // same zone within one frame by all reading a stale count.
  moveOcc(ox, oz, nx, nz) {
    const ok = Math.floor((ox + ARENA.size) / ZONE_SIZE) + ',' + Math.floor((oz + ARENA.size) / ZONE_SIZE);
    const nk = Math.floor((nx + ARENA.size) / ZONE_SIZE) + ',' + Math.floor((nz + ARENA.size) / ZONE_SIZE);
    if (ok === nk) return;
    this._zoneOcc.set(ok, Math.max(0, (this._zoneOcc.get(ok) || 0) - 1));
    this._zoneOcc.set(nk, (this._zoneOcc.get(nk) || 0) + 1);
  }

  clamp(g, half) {
    g.position.x = THREE.MathUtils.clamp(g.position.x, -half, half);
    g.position.z = THREE.MathUtils.clamp(g.position.z, -half, half);
    g.position.y = Math.max(0, g.position.y);
  }

  walkAnim(e, dt) {
    e.walkPhase += dt * e.speed * 2.2;
    const sw = Math.sin(e.walkPhase) * 0.5;
    e.parts.leftLeg.rotation.x = sw;
    e.parts.rightLeg.rotation.x = -sw;
    e.parts.leftArm.rotation.x = -sw * 0.6;
    if (!e.thrown) e.parts.rightArm.rotation.x = sw * 0.6;
  }

  // Pick a target based on personality:
  //  · passive    — never seeks combat (just roams; retaliation handled elsewhere)
  //  · defensive  — only the player, and only when in range
  //  · aggressive — the player (biased) or any other NPC, spread across the map
  // Never re-targets the one it just attacked (forces movement / spreads fights).
  pickTarget(e, distToPlayer) {
    if (e.personality === 'passive') return null;
    const playerEligible = distToPlayer < AGGRO && e.lastTarget !== 'player';
    if (e.personality === 'defensive') return playerEligible ? 'player' : null;
    // aggressive
    if (playerEligible && Math.random() < 0.5) return 'player';
    const pool = this.enemies.filter((o) => o !== e && o.state === 'alive' && o !== e.lastTarget);
    if (pool.length) return pool[(Math.random() * pool.length) | 0];
    if (playerEligible) return 'player';
    return null;
  }

  // ---- throwing ----
  throwAt(e, targetPos) {
    const proj = buildStick(e.skin, false);
    proj.scale.setScalar(0.6);
    proj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const dir = this.tmp2.copy(targetPos).sub(e.group.position).setY(0).normalize().clone();
    proj.position.copy(e.group.position).addScaledVector(dir, 1.2);
    proj.position.y = 2.4;
    this.scene.add(proj);
    this.projectiles.push({ group: proj, dir, dist: 0, owner: e, spin: 0, life: 0 });
    e.thrown = true;
    if (e.parts.heldStick) e.parts.heldStick.visible = false;
  }

  updateProjectiles(dt, playerPos, onPlayerHit) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life += dt;
      p.spin += dt * 20;
      p.group.rotation.set(p.spin * 0.5, 0, p.spin);
      p.group.position.addScaledVector(p.dir, PROJ_SPEED * dt);
      p.dist += PROJ_SPEED * dt;

      let done = false;
      // hit the player?
      const dpx = playerPos.x - p.group.position.x;
      const dpz = playerPos.z - p.group.position.z;
      if (dpx * dpx + dpz * dpz < PROJ_HIT_R * PROJ_HIT_R) {
        if (onPlayerHit) onPlayerHit(p.owner);
        done = true;
      }
      // hit another enemy?
      if (!done) {
        for (const o of this.enemies) {
          if (o === p.owner || o.state !== 'alive') continue;
          const dx = o.group.position.x - p.group.position.x;
          const dz = o.group.position.z - p.group.position.z;
          if (dx * dx + dz * dz < PROJ_HIT_R * PROJ_HIT_R) {
            this.brawlHit(o, p.group.position, p.owner);
            done = true;
            break;
          }
        }
      }
      if (done || p.dist > PROJ_RANGE || p.life > 3) this.removeProjectile(i);
    }
  }

  removeProjectile(i) {
    const p = this.projectiles[i];
    this.scene.remove(p.group);
    if (p.owner && p.owner.parts.heldStick) p.owner.parts.heldStick.visible = true;
    p.owner.thrown = false;
    this.projectiles.splice(i, 1);
  }

  // a boss area attack blasts every NPC on the map (knocked back + stunned)
  blastAll(originPos) {
    for (const e of this.enemies) {
      if (e.state !== 'alive') continue;
      const dir = this.tmp.copy(e.group.position).sub(originPos); dir.y = 0;
      if (dir.lengthSq() < 0.001) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      dir.normalize();
      e.knock.copy(dir).multiplyScalar(16);
      e.stunTime = Math.max(e.stunTime, 1);
      e.attacking = false; e.attackBoss = false;
    }
  }

  // enemy-on-enemy hit: a knockback brawl, nobody gets eliminated
  brawlHit(target, fromPos, attacker) {
    const dir = this.tmp.copy(target.group.position).sub(fromPos); dir.y = 0;
    if (dir.lengthSq() < 0.001) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    dir.normalize();
    target.knock.copy(dir).multiplyScalar(11);
    target.stunTime = Math.max(target.stunTime, 0.35);
    // anyone but a pacifist fights back against whoever just hit them
    if (attacker && attacker.state === 'alive' && target.personality !== 'passive') {
      target.target = attacker; target.lastTarget = null; target.retargetTimer = 2 + Math.random();
    }
  }

  respawn(e) {
    const c = ENEMY_COLORS[(Math.random() * ENEMY_COLORS.length) | 0];
    e.parts.shirtMat.color.setHex(c.shirt);
    e.parts.skinMat.color.setHex(c.body);
    // give them a fresh random stick
    if (e.parts.heldStick) e.parts.rightArm.remove(e.parts.heldStick);
    e.skin = randomSkin();
    const held = buildHeldStick(e.skin);
    e.parts.rightArm.add(held);
    e.parts.heldStick = held;

    e.group.position.copy(this.randomEdgePosition());
    e.group.rotation.set(0, 0, 0);
    e.parts.rightArm.rotation.set(0, 0, 0);
    e.group.scale.setScalar(0.0001);
    e.hp = 1; e.state = 'alive'; e.deadTime = 0; e.stunTime = 0;
    e.speed = 5.5 + Math.random() * 2.5;
    e.attacking = false; e.attackHitDone = false; e.attackCD = 1 + Math.random() * 2;
    e.attackEnemy = null; e.attackBoss = false; e.bossAtkCD = Math.random() * 5;
    e.target = null; e.lastTarget = null; e.retargetTimer = 0;
    e.jitter = 0; e.jitterT = 0; e.roam = null;   // personality is kept across respawns
    e.throwCD = 2 + Math.random() * ENEMY_THROW_CD; e.thrown = false;
    animateScale(e.group, 1, 0.35);
  }

  // Returns the enemy hit by the player (closest within reach in front), or null
  tryHit(playerPos, forward, reach = 4.2, arc = 0.6) {
    let best = null, bestDist = Infinity;
    for (const e of this.enemies) {
      if (e.state !== 'alive') continue;
      this.tmp.copy(e.group.position).sub(playerPos); this.tmp.y = 0;
      const dist = this.tmp.length();
      if (dist > reach) continue;
      this.tmp.normalize();
      const dot = this.tmp.dot(forward);
      if (dot < arc) continue;
      if (dist < bestDist) { bestDist = dist; best = e; }
    }
    if (best) this.hit(best, playerPos);
    return best;
  }

  hit(e, fromPos) {
    e.hp -= 1;
    const dir = this.tmp.copy(e.group.position).sub(fromPos); dir.y = 0; dir.normalize();
    e.knock.copy(dir).multiplyScalar(14);
    e.stunTime = 0.45;
    if (e.hp <= 0) {
      e.state = 'dying';
      e.deadTime = 0;
      e.knock.multiplyScalar(1.6);
    }
    return e;
  }

  get aliveCount() { return this.enemies.filter((e) => e.state === 'alive').length; }
}

function animateScale(obj, to, dur) {
  if (window.gsap) {
    window.gsap.fromTo(obj.scale, { x: 0.0001, y: 0.0001, z: 0.0001 },
      { x: to, y: to, z: to, duration: dur, ease: 'back.out(2)' });
  } else {
    obj.scale.setScalar(to);
  }
}
