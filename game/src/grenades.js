// Grenades: three kinds, one throw. Burst damages through a radius (walls
// block it), Flare blinds whoever is looking at it (the player's screen
// whites out; a bot's aim and vision go), Fog builds a smoke sphere that
// blocks sight lines but not bullets. Thrown grenades bounce off the ground
// and walls with simple sphere physics.
import * as THREE from 'three';
import { applyDamage, eyePos, facing } from './actors.js';

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const FUSE = { frag: 1.5, flash: 1.35, smoke: 1.1 };
const smokeTexture = makeSmokeTexture();

function makeSmokeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(168,172,176,0.85)');
  grad.addColorStop(0.6, 'rgba(150,154,158,0.5)');
  grad.addColorStop(1, 'rgba(150,154,158,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export function throwGrenade(S, actor) {
  const type = actor.loadout.grenadeType;
  if (actor.loadout.grenades[type] <= 0 || S.time < (actor.nextThrowAt || 0)) return false;
  actor.loadout.grenades[type] -= 1;
  actor.nextThrowAt = S.time + 0.7;
  eyePos(actor, _eye);
  facing(actor, _dir);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshLambertMaterial({ color: type === 'frag' ? 0x7a4a2e : type === 'flash' ? 0xd8d4c8 : 0x5a6068 }),
  );
  mesh.position.copy(_eye).addScaledVector(_dir, 0.3);
  S.scene.add(mesh);
  S.grenades.push({
    type, thrower: actor, mesh,
    pos: mesh.position,
    vel: new THREE.Vector3(_dir.x * 13 + actor.vel.x, _dir.y * 13 + 2.2 + actor.vel.y * 0.4, _dir.z * 13 + actor.vel.z),
    fuseAt: S.time + FUSE[type],
    bounces: 0,
  });
  S.events.push({ type: 'throw', actor });
  return true;
}

function bounceStep(S, n, dt) {
  n.vel.y -= 14 * dt;
  const p = n.pos;
  const prevX = p.x; const prevZ = p.z;
  p.addScaledVector(n.vel, dt);
  // Walls: if the sphere's centre entered a solid, back out on that axis.
  for (const s of S.map.solids) {
    if (p.x > s.x0 - 0.07 && p.x < s.x1 + 0.07 && p.z > s.z0 - 0.07 && p.z < s.z1 + 0.07 && p.y > s.y0 && p.y < s.y1 + 0.07) {
      if (prevX <= s.x0 - 0.07 || prevX >= s.x1 + 0.07) { p.x = prevX; n.vel.x *= -0.4; }
      else if (prevZ <= s.z0 - 0.07 || prevZ >= s.z1 + 0.07) { p.z = prevZ; n.vel.z *= -0.4; }
    }
  }
  const ground = S.map.groundAt(p.x, p.z, p.y) + 0.07;
  if (p.y < ground) {
    p.y = ground;
    if (Math.abs(n.vel.y) > 1.2) { n.vel.y *= -0.38; n.vel.x *= 0.7; n.vel.z *= 0.7; n.bounces += 1; S.events.push({ type: 'bounce', at: p }); }
    else { n.vel.y = 0; n.vel.x *= 0.8; n.vel.z *= 0.8; }
  }
}

export function stepGrenades(S, dt) {
  for (let i = S.grenades.length - 1; i >= 0; i -= 1) {
    const n = S.grenades[i];
    bounceStep(S, n, dt);
    if (S.time >= n.fuseAt) {
      S.grenades.splice(i, 1);
      S.scene.remove(n.mesh);
      detonate(S, n);
    }
  }
  for (let i = S.smokes.length - 1; i >= 0; i -= 1) {
    const cloud = S.smokes[i];
    cloud.group.children.forEach((sprite, k) => {
      sprite.position.y = cloud.y + Math.sin(S.time * 0.7 + k * 1.7) * 0.16;
    });
    if (S.time >= cloud.until) { S.scene.remove(cloud.group); S.smokes.splice(i, 1); }
  }
}

function detonate(S, n) {
  const p = n.pos;
  S.noise.push({ x: p.x, z: p.z, r: 34, team: n.thrower.team, at: S.time });
  if (n.type === 'frag') {
    S.events.push({ type: 'explosion', at: p.clone(), big: false });
    for (const actor of S.actors) {
      if (!actor.alive) continue;
      const d = Math.hypot(actor.pos.x - p.x, actor.pos.z - p.z);
      if (d > 5.6) continue;
      if (!S.map.los(p.x, p.y + 0.4, p.z, actor.pos.x, actor.pos.y + 0.9, actor.pos.z)) continue;
      applyDamage(S, actor, 95 * Math.pow(1 - d / 5.6, 1.15), 'body', n.thrower);
    }
  } else if (n.type === 'flash') {
    S.events.push({ type: 'flashbang', at: p.clone() });
    for (const actor of S.actors) {
      if (!actor.alive) continue;
      const dx = actor.pos.x - p.x; const dz = actor.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 24) continue;
      if (!S.map.los(p.x, p.y + 0.3, p.z, actor.pos.x, actor.pos.y + 1.5, actor.pos.z)) continue;
      facing(actor, _dir);
      // How directly the actor faces the pop: 1 is staring at it.
      const facingDot = d < 0.01 ? 1 : (-dx * _dir.x - dz * _dir.z) / d;
      let dur = 0.5;
      if (facingDot > 0.55) dur = 3.0; else if (facingDot > 0) dur = 1.7;
      dur *= Math.max(0.25, 1 - d / 26);
      actor.blindUntil = Math.max(actor.blindUntil, S.time + dur);
      if (actor.isPlayer) S.events.push({ type: 'playerFlashed', dur });
    }
  } else {
    const group = new THREE.Group();
    for (let k = 0; k < 9; k += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, opacity: 0.55, depthWrite: false }));
      const a = (k / 9) * Math.PI * 2;
      sprite.position.set(p.x + Math.cos(a) * 1.6, p.y + 1 + (k % 3) * 0.7, p.z + Math.sin(a) * 1.6);
      sprite.scale.set(3.6, 3.0, 1);
      group.add(sprite);
    }
    const centre = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, opacity: 0.75, depthWrite: false }));
    centre.position.set(p.x, p.y + 1.4, p.z);
    centre.scale.set(4.6, 3.8, 1);
    group.add(centre);
    S.scene.add(group);
    S.smokes.push({ x: p.x, y: p.y, z: p.z, r: 3.1, until: S.time + 14, group });
    S.events.push({ type: 'smokePop', at: p.clone() });
  }
}

// Does any live smoke cloud block the sight line a-b? (Bullets ignore this.)
export function smokeBlocks(S, ax, ay, az, bx, by, bz) {
  for (const cloud of S.smokes) {
    const cx = cloud.x; const cy = cloud.y + 1.3; const cz = cloud.z;
    const dx = bx - ax; const dy = by - ay; const dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - cx; const py = ay + dy * t - cy; const pz = az + dz * t - cz;
    if (px * px + py * py + pz * pz < cloud.r * cloud.r * 0.85) return true;
  }
  return false;
}
