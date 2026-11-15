// Actors: the player and every bot are the same shape and move by the same
// physics, so a bot's strafe and the player's strafe obey one set of rules.
// A controller (the human's input, or a bot's brain) writes a command each
// fixed step; this module integrates it: acceleration and friction on the
// ground, weak control in the air, gravity, steps up onto crates, and sliding
// collision against the map's boxes.
import * as THREE from 'three';
import { makeLoadout } from './weapons.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
export const RADIUS = 0.35;

let nextId = 1;

export function makeActor(name, team, isPlayer) {
  return {
    id: nextId++, name, team, isPlayer,
    alive: true,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    crouchAmt: 0,
    grounded: true,
    speed2d: 0,
    health: 100,
    money: 800,
    loadout: makeLoadout(),
    hasCharge: false,
    cmd: { mx: 0, mz: 0, jump: false, crouch: false, fire: false, aim: false, use: false, reload: false },
    lastHurtBy: null, lastHurtAt: -99,
    blindUntil: 0, // flare grenade: no vision, wild aim
    brain: null, // bots attach their state here
    model: null,
    stepPhase: 0,
    nextStepAt: 0,
    nextThrowAt: 0, // grenade throws are gated on this in main's combat phase
    switchAt: -9, // last weapon switch, for the viewmodel draw dip
  };
}

export function eyeHeight(actor) {
  return EYE_STAND + (EYE_CROUCH - EYE_STAND) * actor.crouchAmt;
}

export function eyePos(actor, out) {
  return out.set(actor.pos.x, actor.pos.y + eyeHeight(actor), actor.pos.z);
}

// Facing vector from yaw/pitch (yaw 0 looks down -Z, pitch up is positive).
export function facing(actor, out) {
  const cp = Math.cos(actor.pitch);
  return out.set(-Math.sin(actor.yaw) * cp, Math.sin(actor.pitch), -Math.cos(actor.yaw) * cp);
}

export function stepActor(actor, dt, map, now) {
  const cmd = actor.cmd;
  const slotDef = actor.loadout.slot === 'grenade' ? null
    : (actor.loadout.slot === 'primary' ? actor.loadout.primary : actor.loadout.sidearm)?.def;
  let maxSpeed = 4.6 * (slotDef ? slotDef.speed : 1);
  if (cmd.crouch) maxSpeed *= 0.36;
  if (cmd.walk) maxSpeed *= 0.55; // quiet feet: bots hear less of this
  if (cmd.aim && slotDef) maxSpeed *= 0.55;
  actor.crouchAmt += ((cmd.crouch ? 1 : 0) - actor.crouchAmt) * Math.min(1, dt * 9);

  const wishX = cmd.mx; const wishZ = cmd.mz;
  const wishLen = Math.hypot(wishX, wishZ);
  const accel = actor.grounded ? 11 : 1.4;
  const blend = Math.min(1, accel * dt);
  const tx = wishLen > 0 ? (wishX / Math.max(1, wishLen)) * maxSpeed : 0;
  const tz = wishLen > 0 ? (wishZ / Math.max(1, wishLen)) * maxSpeed : 0;
  actor.vel.x += (tx - actor.vel.x) * blend;
  actor.vel.z += (tz - actor.vel.z) * blend;

  if (actor.grounded && cmd.jump) { actor.vel.y = 6.0; actor.grounded = false; }
  if (!actor.grounded) actor.vel.y -= 17 * dt;

  actor.pos.x += actor.vel.x * dt;
  actor.pos.z += actor.vel.z * dt;
  actor.pos.y += actor.vel.y * dt;
  const ground = map.groundAt(actor.pos.x, actor.pos.z, actor.pos.y);
  if (actor.pos.y <= ground) {
    actor.pos.y = ground;
    if (actor.vel.y < 0) actor.vel.y = 0;
    actor.grounded = true;
  } else if (actor.pos.y > ground + 0.05) {
    actor.grounded = false;
  }
  map.collide(actor.pos, RADIUS, actor.crouchAmt > 0.5 ? 1.25 : 1.8);
  const settled = map.groundAt(actor.pos.x, actor.pos.z, actor.pos.y);
  if (actor.grounded && settled < actor.pos.y) { /* walked off an edge: gravity takes it next step */ }
  actor.speed2d = Math.hypot(actor.vel.x, actor.vel.z);
  if (actor.speed2d > 0.6 && actor.grounded) actor.stepPhase += dt * actor.speed2d * 1.6;
  void now;
}

// Damage with the tactical rules: the head takes four times, the legs three
// quarters; armour halves what hits the body, a helmet blunts the head.
export function applyDamage(S, victim, raw, part, attacker) {
  if (!victim.alive || S.phase === 'roundover' || S.phase === 'matchover') return false;
  let dmg = raw;
  if (part === 'head') dmg *= 4;
  else if (part === 'legs') dmg *= 0.75;
  if (part === 'head' && victim.loadout.helmet) dmg *= 0.85;
  if (part !== 'head' && victim.loadout.armor) dmg *= 0.5;
  dmg = Math.max(1, Math.round(dmg));
  victim.health -= dmg;
  victim.lastHurtBy = attacker;
  victim.lastHurtAt = S.time;
  S.events.push({ type: 'damage', victim, attacker, dmg, part });
  if (victim.health <= 0) {
    victim.health = 0;
    victim.alive = false;
    S.events.push({ type: 'kill', victim, attacker, part });
    if (victim.hasCharge) { victim.hasCharge = false; S.bomb.dropAt(victim.pos); }
    return true;
  }
  return false;
}
