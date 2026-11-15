// The human: turns input into the player actor's command each fixed step,
// and owns everything the camera does — look with recoil punch that partly
// recovers, aim-down-sights, weapon bob, reload dip and draw raise. The
// simulation only ever sees the actor; this module is the body's puppeteer.
import * as THREE from 'three';
import { buildViewmodel, buildGrenadeModel, currentSlot } from './weapons.js';
import { eyeHeight } from './actors.js';

export function controlPlayer(S, input) {
  const p = S.player;
  const cmd = p.cmd;
  cmd.mx = 0; cmd.mz = 0; cmd.fire = false; cmd.reload = false;
  cmd.jump = false; cmd.use = false; cmd.aim = false;
  if (!p.alive || (S.phase !== 'live' && S.phase !== 'planted')) { input.clearPressed(); return; }

  const f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
  const r = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
  let ix = 0; let iz = 0;
  if (input.keys.has('KeyW')) { ix += f.x; iz += f.z; }
  if (input.keys.has('KeyS')) { ix -= f.x; iz -= f.z; }
  if (input.keys.has('KeyD')) { ix += r.x; iz += r.z; }
  if (input.keys.has('KeyA')) { ix -= r.x; iz -= r.z; }
  cmd.mx = ix; cmd.mz = iz;
  cmd.crouch = input.keys.has('ControlLeft') || input.keys.has('KeyC');
  cmd.walk = input.keys.has('ShiftLeft');
  cmd.jump = input.keys.has('Space');
  cmd.use = input.keys.has('KeyE');
  cmd.aim = input.aiming;
  cmd.fire = input.firing;
  if (input.takePressed('KeyR')) cmd.reload = true;

  // Weapon selection: 1 primary, 2 sidearm, 3 grenades (again to cycle type).
  if (input.takePressed('Digit1')) switchTo(S, p, 'primary');
  if (input.takePressed('Digit2')) switchTo(S, p, 'sidearm');
  if (input.takePressed('Digit3')) {
    if (p.loadout.slot === 'grenade') cycleGrenade(p);
    else switchTo(S, p, 'grenade');
  }
  if (input.takePressed('KeyQ')) switchTo(S, p, p.loadout.slot === 'primary' ? 'sidearm' : 'primary');
  input.clearPressed();
}

function switchTo(S, p, slot) {
  if (slot === 'primary' && !p.loadout.primary) return;
  if (slot === 'grenade' && p.loadout.grenades.frag + p.loadout.grenades.flash + p.loadout.grenades.smoke === 0) return;
  if (p.loadout.slot === slot) return;
  p.loadout.slot = slot;
  const gun = currentSlot(p.loadout);
  if (gun) gun.nextShotAt = Math.max(gun.nextShotAt, S.time + gun.def.draw);
  p.switchAt = S.time;
}

function cycleGrenade(p) {
  const order = ['frag', 'flash', 'smoke'];
  let i = order.indexOf(p.loadout.grenadeType);
  for (let k = 0; k < 3; k += 1) {
    i = (i + 1) % 3;
    if (p.loadout.grenades[order[i]] > 0) { p.loadout.grenadeType = order[i]; return; }
  }
}

// The camera and the gun in front of it. sync() runs once per rendered frame.
export function createPlayerView(camera) {
  const holder = new THREE.Group();
  camera.add(holder);
  holder.position.set(0.24, -0.22, -0.45);
  let viewmodel = null;
  let viewKey = '';
  let punch = 0;
  let adsAmt = 0;
  let bobPhase = 0;
  const baseFov = 74;

  return {
    holder,
    applyLook(actor, dx, dy) {
      actor.yaw -= dx * 0.0021;
      actor.pitch -= dy * 0.0021;
      actor.pitch = Math.max(-1.45, Math.min(1.45, actor.pitch));
    },
    sync(S, dt) {
      const p = S.player;
      // Recoil: part of the kick stays in the aim, the rest is punch that recovers.
      if (p.recoilKick) { punch += p.recoilKick * 0.9; p.pitch += p.recoilKick * 0.35; p.recoilKick = 0; }
      punch *= Math.exp(-8.5 * dt);
      camera.position.set(p.pos.x, p.pos.y + eyeHeight(p) - (p.alive ? 0 : 1.1), p.pos.z);
      camera.rotation.set(p.pitch + punch, p.yaw, 0, 'YXZ');

      const slot = currentSlot(p.loadout);
      const wantAds = p.cmd.aim && p.alive && p.loadout.slot !== 'grenade' && slot ? 1 : 0;
      adsAmt += (wantAds - adsAmt) * Math.min(1, dt * 11);
      const zoom = slot ? slot.def.zoom : 1;
      const fov = baseFov / (1 + (zoom - 1) * adsAmt);
      if (Math.abs(fov - camera.fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
      S.scoped = slot && slot.def.kind === 'sniper' && adsAmt > 0.65;

      // Swap the held model when the slot or weapon changes.
      const key = p.loadout.slot === 'grenade' ? `n:${p.loadout.grenadeType}` : slot ? `g:${slot.def.id}` : 'none';
      if (key !== viewKey) {
        viewKey = key;
        if (viewmodel) holder.remove(viewmodel);
        viewmodel = p.loadout.slot === 'grenade' ? buildGrenadeModel(p.loadout.grenadeType) : slot ? buildViewmodel(slot.def) : null;
        if (viewmodel) holder.add(viewmodel);
      }
      if (!viewmodel) return;
      // Pose: hip position, or centred when aiming; bob while moving; dip on
      // reload and on the draw.
      bobPhase += dt * p.speed2d * 1.7;
      const bobX = Math.sin(bobPhase) * 0.011 * Math.min(1, p.speed2d / 4);
      const bobY = -Math.abs(Math.cos(bobPhase)) * 0.009 * Math.min(1, p.speed2d / 4);
      const hip = { x: 0.24, y: -0.22, z: -0.45 };
      const ads = { x: 0, y: -0.148, z: -0.35 };
      holder.position.set(
        hip.x + (ads.x - hip.x) * adsAmt + bobX * (1 - adsAmt),
        hip.y + (ads.y - hip.y) * adsAmt + bobY * (1 - adsAmt),
        hip.z + (ads.z - hip.z) * adsAmt,
      );
      let dip = 0;
      if (slot && slot.reloadEndAt > S.time) {
        const t = 1 - (slot.reloadEndAt - S.time) / slot.def.reload;
        dip = Math.sin(Math.min(1, t) * Math.PI) * 0.5;
      }
      const drawT = Math.min(1, (S.time - (p.switchAt || 0)) / 0.3);
      holder.position.y -= (1 - drawT) * 0.16;
      holder.rotation.set(dip * 0.7, 0, dip * 0.15);
      viewmodel.visible = !(S.scoped === true);
    },
  };
}
