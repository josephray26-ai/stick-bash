// ---------------------------------------------------------------------------
// remote.js — renders OTHER players as third-person avatars.
//
// Reuses the same createCharacter() factory the NPCs use. The local player stays
// first-person; only remote peers get a body. Driven entirely by networked state
// (position / heading / action / cosmetics) — no game logic lives here.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { createCharacter, makeHat } from './world.js';
import { STICK_SKINS, SHOP_ITEMS } from './data.js';

let scene = null;
const avatars = new Map();   // peerId -> avatar record

export function init(s) { scene = s; }

function findSkin(id) {
  return STICK_SKINS.find((s) => s.id === id)
    || SHOP_ITEMS.find((i) => i.cat === 'Sticks' && i.id === id)?.skin
    || STICK_SKINS[0];
}

// createCharacter faces +Z; the player's look yaw points forward = (-sin,−cos),
// so the body must be rotated yaw+π to face the way the player is looking.
function faceYaw(lookYaw) { return (lookYaw || 0) + Math.PI; }

export function upsert(peerId, st) {
  if (!scene || !st) return;
  let a = avatars.get(peerId);
  const key = `${st.body}|${st.hat}|${st.stick}`;

  if (!a || a.key !== key) {
    if (a) scene.remove(a.group);
    const g = createCharacter({ body: st.body ?? 0xffcf6e, shirt: 0x3aa0ff, weaponSkin: findSkin(st.stick) });
    if (st.hat) { const hi = SHOP_ITEMS.find((i) => i.id === st.hat); if (hi) g.add(makeHat(hi)); }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.position.set(st.x || 0, st.h || 0, st.z || 0);
    g.rotation.y = faceYaw(st.yaw);
    scene.add(g);
    a = { group: g, key, parts: g.userData.parts, yaw: faceYaw(st.yaw), walk: 0, swingT: 0, lastAct: 'idle' };
    avatars.set(peerId, a);
  }

  a.tx = st.x; a.tz = st.z; a.th = st.h || 0; a.tyaw = faceYaw(st.yaw); a.hp = st.hp;
  if (st.act === 'swing' && a.lastAct !== 'swing') a.swingT = 0.3;
  a.lastAct = st.act;
}

export function remove(peerId) {
  const a = avatars.get(peerId);
  if (a && scene) scene.remove(a.group);
  avatars.delete(peerId);
}

export function clear() { for (const id of [...avatars.keys()]) remove(id); }

export function count() { return avatars.size; }

export function update(dt) {
  const k = Math.min(1, dt * 12);
  for (const a of avatars.values()) {
    if (a.tx === undefined) continue;
    const px = a.group.position.x, pz = a.group.position.z;
    a.group.position.x += (a.tx - px) * k;
    a.group.position.z += (a.tz - pz) * k;
    a.group.position.y += (a.th - a.group.position.y) * k;
    a.yaw += angleDelta(a.yaw, a.tyaw) * k;
    a.group.rotation.y = a.yaw;

    const moved = Math.hypot(a.group.position.x - px, a.group.position.z - pz);
    if (a.swingT > 0) {
      a.swingT -= dt;
      const p = 1 - a.swingT / 0.3;
      a.parts.rightArm.rotation.x = -Math.sin(p * Math.PI) * 2.4;
    } else if (moved > 0.002) {
      a.walk += dt * 10;
      const sw = Math.sin(a.walk) * 0.5;
      a.parts.leftLeg.rotation.x = sw; a.parts.rightLeg.rotation.x = -sw;
      a.parts.leftArm.rotation.x = -sw * 0.6; a.parts.rightArm.rotation.x = sw * 0.6;
    } else {
      a.parts.leftLeg.rotation.x *= 0.8; a.parts.rightLeg.rotation.x *= 0.8;
      a.parts.leftArm.rotation.x *= 0.8; a.parts.rightArm.rotation.x *= 0.8;
    }
  }
}

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
