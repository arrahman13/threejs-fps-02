// Combat: hitscan firing shared by the player and the bots, so a bullet
// obeys the same rules whoever pulled the trigger. A shot is a ray tested
// against the map's boxes and against each enemy's body as a stack of
// spheres — head, torso, legs — with the head worth four times the damage.
// Spread grows with movement and with sustained fire (bloom), and shrinks
// crouched and still: stopping to aim pays.
import * as THREE from 'three';
import { currentSlot, falloff } from './weapons.js';
import { applyDamage, eyePos, facing } from './actors.js';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _to = new THREE.Vector3();

// Sphere centres up the body, standing and crouched: [height, radius, part].
const BODY = [
  [1.52, 0.21, 'head'], [1.36, 0.30, 'body'], [1.10, 0.30, 'body'],
  [0.84, 0.29, 'body'], [0.52, 0.26, 'legs'], [0.24, 0.25, 'legs'],
];
const BODY_CROUCH = [
  [1.06, 0.21, 'head'], [0.94, 0.30, 'body'], [0.72, 0.30, 'body'],
  [0.50, 0.29, 'body'], [0.30, 0.26, 'legs'], [0.14, 0.25, 'legs'],
];

export function spreadFor(actor, def) {
  const move = Math.min(1, actor.speed2d / 4.6);
  let s = def.spread * (1 + move * (def.moveSpread - 1));
  if (!actor.grounded) s *= 2.4;
  if (actor.crouchAmt > 0.5) s *= 0.7;
  s *= 1 + (actor.bloom || 0);
  return s;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = cx - ox; const ly = cy - oy; const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const t = tca - Math.sqrt(r2 - d2);
  return t > 0 && t < maxT ? t : -1;
}

// The nearest thing a ray hits: a wall distance from the map, or an enemy's
// body part. Returns the distance and what was hit.
export function traceShot(S, shooter, ox, oy, oz, dx, dy, dz, maxDist = 120) {
  const wallDist = S.map.rayHit(ox, oy, oz, dx, dy, dz, maxDist);
  let bestDist = wallDist;
  let bestActor = null;
  let bestPart = null;
  for (const other of S.actors) {
    if (other === shooter || !other.alive || other.team === shooter.team) continue;
    const parts = other.crouchAmt > 0.5 ? BODY_CROUCH : BODY;
    for (const [h, r, part] of parts) {
      const t = raySphere(ox, oy, oz, dx, dy, dz, other.pos.x, other.pos.y + h, other.pos.z, r, bestDist);
      if (t > 0) { bestDist = t; bestActor = other; bestPart = part; }
    }
  }
  return { dist: bestDist, actor: bestActor, part: bestPart, wall: !bestActor && wallDist < maxDist };
}

export function startReload(S, actor) {
  const slot = currentSlot(actor.loadout);
  if (!slot || actor.loadout.slot === 'grenade') return false;
  if (slot.mag >= slot.def.mag || slot.reserve <= 0 || slot.reloadEndAt > S.time) return false;
  slot.reloadEndAt = S.time + slot.def.reload;
  S.events.push({ type: 'reload', actor });
  return true;
}

// Per-step weapon housekeeping: finish reloads, cool the bloom.
export function serviceWeapons(S, actor) {
  actor.bloom = Math.max(0, (actor.bloom || 0) - S.dt * 2.6);
  const slot = currentSlot(actor.loadout);
  if (slot && slot.reloadEndAt && S.time >= slot.reloadEndAt) {
    const take = Math.min(slot.def.mag - slot.mag, slot.reserve);
    slot.mag += take;
    slot.reserve -= take;
    slot.reloadEndAt = 0;
  }
}

// Fire one trigger pull. Returns true when a round left the barrel.
export function tryFire(S, actor) {
  if (actor.loadout.slot === 'grenade') return false;
  const slot = currentSlot(actor.loadout);
  if (!slot) return false;
  const def = slot.def;
  if (S.time < slot.nextShotAt || S.time < slot.boltUntil || slot.reloadEndAt > S.time) return false;
  if (slot.mag <= 0) {
    slot.nextShotAt = S.time + 0.3;
    S.events.push({ type: 'dry', actor });
    startReload(S, actor);
    return false;
  }
  slot.mag -= 1;
  slot.nextShotAt = S.time + 60 / def.rpm;
  if (def.bolt) slot.boltUntil = S.time + def.bolt;
  actor.bloom = Math.min(1.6, (actor.bloom || 0) + (def.auto ? 0.16 : 0.3));

  eyePos(actor, _origin);
  facing(actor, _dir);
  _muzzle.copy(_origin).addScaledVector(_dir, 0.55);
  _muzzle.y -= 0.14;
  S.noise.push({ x: actor.pos.x, z: actor.pos.z, r: 30, team: actor.team, at: S.time });

  const spread = spreadFor(actor, def);
  for (let p = 0; p < def.pellets; p += 1) {
    const dx = _dir.x + (S.rng.next() * 2 - 1) * spread;
    const dy = _dir.y + (S.rng.next() * 2 - 1) * spread;
    const dz = _dir.z + (S.rng.next() * 2 - 1) * spread;
    const len = Math.hypot(dx, dy, dz) || 1;
    const hit = traceShot(S, actor, _origin.x, _origin.y, _origin.z, dx / len, dy / len, dz / len);
    _to.set(_origin.x + (dx / len) * hit.dist, _origin.y + (dy / len) * hit.dist, _origin.z + (dz / len) * hit.dist);
    if (p === 0 || hit.actor) S.events.push({ type: 'tracer', from: _muzzle.clone(), to: _to.clone(), shooter: actor });
    if (hit.actor) {
      const killed = applyDamage(S, hit.actor, def.damage * falloff(def, hit.dist), hit.part, actor);
      S.events.push({ type: 'hit', shooter: actor, victim: hit.actor, part: hit.part, killed });
    } else if (hit.wall) {
      S.events.push({ type: 'impact', at: _to.clone() });
    }
  }
  S.events.push({ type: 'shot', actor, def });
  actor.recoilKick = (actor.recoilKick || 0) + def.recoil;
  if (slot.mag === 0) startReload(S, actor);
  return true;
}
