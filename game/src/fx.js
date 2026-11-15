// Effects: pooled, allocation-free visuals fed by the simulation's event
// stream — tracers, muzzle flashes, impact dust, hit sparks, explosions.
// Nothing here touches game state; it only paints what the events describe.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { eyePos, facing } from './actors.js';

function puffTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createFx(scene) {
  const dustTex = puffTexture('rgba(190,180,160,0.8)', 'rgba(190,180,160,0)');
  const sparkTex = puffTexture('rgba(255,190,90,1)', 'rgba(255,120,40,0)');
  const flashTex = puffTexture('rgba(255,240,210,1)', 'rgba(255,180,80,0)');

  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 28; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIdx = 0;

  function makePool(tex, count, scale) {
    const pool = [];
    for (let i = 0; i < count; i += 1) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      s.visible = false;
      s.userData.baseScale = scale;
      scene.add(s);
      pool.push({ s, life: 0, max: 1, grow: 1 });
    }
    return { pool, idx: 0 };
  }
  const dust = makePool(dustTex, 20, 0.5);
  const sparks = makePool(sparkTex, 16, 0.4);
  const flashes = makePool(flashTex, 10, 0.55);

  function spawn(poolObj, at, life, grow = 1) {
    const item = poolObj.pool[poolObj.idx];
    poolObj.idx = (poolObj.idx + 1) % poolObj.pool.length;
    item.s.position.copy(at);
    item.life = life;
    item.max = life;
    item.grow = grow;
    item.s.visible = true;
  }

  const light = new THREE.PointLight(0xffb36b, 0, 16, 1.8);
  scene.add(light);
  const boomLight = new THREE.PointLight(0xffc98a, 0, 42, 1.6);
  scene.add(boomLight);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.09, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  let ringLife = 0;
  let shake = 0;

  const _eye = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _muzzle = new THREE.Vector3();

  function consume(S) {
    for (const ev of S.events) {
      if (ev.type === 'tracer') {
        const t = tracers[tracerIdx];
        tracerIdx = (tracerIdx + 1) % tracers.length;
        const pos = t.line.geometry.attributes.position.array;
        pos[0] = ev.from.x; pos[1] = ev.from.y; pos[2] = ev.from.z;
        pos[3] = ev.to.x; pos[4] = ev.to.y; pos[5] = ev.to.z;
        t.line.geometry.attributes.position.needsUpdate = true;
        t.line.visible = true;
        t.life = 0.05;
      } else if (ev.type === 'shot' && !ev.actor.isPlayer) {
        eyePos(ev.actor, _eye);
        facing(ev.actor, _dir);
        _muzzle.copy(_eye).addScaledVector(_dir, 0.62);
        _muzzle.y -= 0.16;
        spawn(flashes, _muzzle, 0.06);
        const d = _muzzle.distanceTo(S.player.pos);
        if (d < 14) { light.position.copy(_muzzle); light.intensity = 26; }
      } else if (ev.type === 'shot' && ev.actor.isPlayer) {
        light.position.copy(S.camera.position);
        light.intensity = 10;
      } else if (ev.type === 'impact') {
        spawn(dust, ev.at, 0.34, 2.2);
      } else if (ev.type === 'hit') {
        _chest(ev.victim);
        spawn(sparks, _eye, 0.16, 1.4);
      } else if (ev.type === 'explosion') {
        spawn(flashes, ev.at, 0.3, 6);
        spawn(dust, ev.at, 0.9, 7);
        boomLight.position.copy(ev.at);
        boomLight.position.y += 1;
        boomLight.intensity = ev.big ? 900 : 300;
        ring.position.copy(ev.at);
        ring.position.y += 0.4;
        ring.userData.big = ev.big;
        ring.visible = true;
        ringLife = 0.45;
        const d = Math.hypot(ev.at.x - S.player.pos.x, ev.at.z - S.player.pos.z);
        shake = Math.min(0.5, shake + (ev.big ? 10 : 5) / (6 + d));
      }
    }
  }

  function _chest(actor) { _eye.set(actor.pos.x, actor.pos.y + 1.2, actor.pos.z); }

  function step(dt) {
    for (const t of tracers) {
      if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.visible = false; }
    }
    for (const poolObj of [dust, sparks, flashes]) {
      for (const item of poolObj.pool) {
        if (item.life <= 0) continue;
        item.life -= dt;
        if (item.life <= 0) { item.s.visible = false; continue; }
        const t = 1 - item.life / item.max;
        const sc = item.s.userData.baseScale * (0.5 + t * item.grow);
        item.s.scale.set(sc, sc, 1);
        item.s.material.opacity = 1 - t;
      }
    }
    light.intensity = Math.max(0, light.intensity - dt * 320);
    boomLight.intensity = Math.max(0, boomLight.intensity - dt * 2600);
    if (ringLife > 0) {
      ringLife -= dt;
      const t = 1 - ringLife / 0.45;
      const sc = 1 + t * (ring.userData.big ? 26 : 12);
      ring.scale.set(sc, sc, sc);
      ring.material.opacity = 0.55 * (1 - t);
      if (ringLife <= 0) ring.visible = false;
    }
    shake = Math.max(0, shake - dt * 1.4);
    return shake;
  }

  return { consume, step };
}

export const FX_ACCENT = PALETTE.accent;
