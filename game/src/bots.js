// Bots: low-poly harbour hands with a brain each. A brain perceives on a
// stagger (vision cone, line of sight, smoke and hearing all count), follows
// the waypoint graph to a job — anchor a site, rotate, rush a lane, escort
// the carrier, plant, defuse — and fights with Counter-Strike manners: it
// stops to shoot, fires bursts, and its aim settles the longer it tracks
// you. The same actor physics and combat code move and shoot it as the
// player, so nothing about a bot is a cheat.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { buildWorldGun } from './weapons.js';
import { startReload } from './combat.js';
import { throwGrenade } from './grenades.js';
import { smokeBlocks } from './grenades.js';
import { eyePos } from './actors.js';

const _eye = new THREE.Vector3();
const _chest = new THREE.Vector3();

export const BOT_NAMES = {
  atk: ['Rook', 'Bex', 'Tarn', 'Odo', 'Mire'],
  def: ['Kip', 'Vess', 'Hale', 'Juno', 'Pell'],
};

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function part(group, mat, x, y, z, sx, sy, sz) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  group.add(m);
  return m;
}

// A harbour hand: boots, legs, team-coloured torso, head with a helmet, and
// the gun it bought, all posed facing -Z to match the actor's yaw.
export function buildBotModel(team, weaponKind) {
  const teamMat = new THREE.MeshLambertMaterial({ color: team === 'atk' ? PALETTE.atk : PALETTE.def });
  const dark = new THREE.MeshLambertMaterial({ color: '#33302c' });
  const skin = new THREE.MeshLambertMaterial({ color: '#c9a186' });
  const rig = new THREE.Group();
  const legL = part(rig, dark, -0.11, 0.45, 0, 0.17, 0.9, 0.2);
  const legR = part(rig, dark, 0.11, 0.45, 0, 0.17, 0.9, 0.2);
  legL.geometry = boxGeo;
  const torso = part(rig, teamMat, 0, 1.15, 0, 0.52, 0.62, 0.3);
  part(rig, dark, 0, 1.32, 0.14, 0.4, 0.34, 0.08); // pack
  const head = part(rig, skin, 0, 1.62, 0, 0.26, 0.28, 0.26);
  part(rig, teamMat, 0, 1.78, 0, 0.3, 0.1, 0.3); // helmet
  const armR = part(rig, teamMat, 0.33, 1.22, -0.1, 0.13, 0.5, 0.15);
  armR.rotation.x = -0.9;
  const armL = part(rig, teamMat, -0.33, 1.22, -0.05, 0.13, 0.45, 0.15);
  armL.rotation.x = -0.7;
  const gun = buildWorldGun(weaponKind);
  gun.position.set(0.3, 1.28, -0.25);
  rig.add(gun);
  const group = new THREE.Group();
  group.add(rig);
  group.userData = { rig, legL, legR, torso, head, gun, deathAt: 0 };
  // Pivot legs at the hip for the walk swing.
  for (const leg of [legL, legR]) { leg.geometry = boxGeo; leg.position.y = 0.9; leg.translateY(-0.45); }
  return group;
}

export function makeBrain(role) {
  return {
    role,
    state: 'advance',
    destNode: -1, wpNode: -1,
    target: null, lastSeenAt: -99, lastSeenX: 0, lastSeenZ: 0,
    reactionAt: 0, burstLeft: 0, nextBurstAt: 0,
    nextPerceiveAt: 0, nextThinkAt: 0,
    holdYaw: 0, scanPhase: Math.random() * 6,
    strafeDir: 1, strafeUntil: 0,
    skill: 0.85 + Math.random() * 0.35, // aim quality, dealt per bot per match
    threwGrenade: false,
    investigateX: 0, investigateZ: 0, hasInvestigate: false,
  };
}

function angleWrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function turnToward(bot, wantYaw, wantPitch, rate, dt) {
  const dy = angleWrap(wantYaw - bot.yaw);
  const step = Math.max(-rate * dt, Math.min(rate * dt, dy));
  bot.yaw += step;
  const dp = wantPitch - bot.pitch;
  bot.pitch += Math.max(-rate * dt, Math.min(rate * dt, dp));
  return Math.abs(dy) + Math.abs(dp);
}

function yawTo(bot, x, z) { return Math.atan2(-(x - bot.pos.x), -(z - bot.pos.z)); }

// Can this bot see that actor right now? Cone, range, walls and smoke.
function canSee(S, bot, other) {
  if (S.time < bot.blindUntil) return false;
  const dx = other.pos.x - bot.pos.x;
  const dz = other.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 58) return false;
  if (dist > 5) {
    const fx = -Math.sin(bot.yaw); const fz = -Math.cos(bot.yaw);
    if ((dx * fx + dz * fz) / (dist || 1) < 0.42) return false; // ~65 degree half-cone
  }
  eyePos(bot, _eye);
  _chest.set(other.pos.x, other.pos.y + 1.15, other.pos.z);
  if (!S.map.los(_eye.x, _eye.y, _eye.z, _chest.x, _chest.y, _chest.z)) return false;
  if (smokeBlocks(S, _eye.x, _eye.y, _eye.z, _chest.x, _chest.y, _chest.z)) return false;
  return true;
}

function perceive(S, bot) {
  const brain = bot.brain;
  let nearest = null;
  let nd = Infinity;
  for (const other of S.actors) {
    if (!other.alive || other.team === bot.team) continue;
    if (!canSee(S, bot, other)) continue;
    const d = Math.hypot(other.pos.x - bot.pos.x, other.pos.z - bot.pos.z);
    if (d < nd) { nd = d; nearest = other; }
  }
  if (nearest) {
    if (brain.target !== nearest) brain.reactionAt = S.time + (0.34 / brain.skill) + S.rng.range(0, 0.14);
    brain.target = nearest;
    brain.lastSeenAt = S.time;
    brain.lastSeenX = nearest.pos.x;
    brain.lastSeenZ = nearest.pos.z;
    brain.hasInvestigate = false;
  } else if (brain.target && S.time - brain.lastSeenAt > 2.2) {
    brain.investigateX = brain.lastSeenX;
    brain.investigateZ = brain.lastSeenZ;
    brain.hasInvestigate = true;
    brain.target = null;
  }
  // Hearing: fresh enemy noise pulls attention when nothing is visible.
  if (!nearest) {
    for (const n of S.noise) {
      if (n.team === bot.team || n.at <= (brain.lastNoiseAt || 0)) continue;
      const d = Math.hypot(n.x - bot.pos.x, n.z - bot.pos.z);
      if (d < n.r) {
        brain.investigateX = n.x; brain.investigateZ = n.z; brain.hasInvestigate = true;
        brain.heardAt = S.time;
        brain.lastNoiseAt = n.at;
      }
    }
  }
  // Being shot at is its own information: turn toward the shooter.
  if (!nearest && bot.lastHurtBy && S.time - bot.lastHurtAt < 0.4) {
    brain.investigateX = bot.lastHurtBy.pos.x;
    brain.investigateZ = bot.lastHurtBy.pos.z;
    brain.hasInvestigate = true;
  }
}

function setDest(S, bot, nodeIdx) {
  const brain = bot.brain;
  if (brain.destNode === nodeIdx && brain.wpNode !== -1) return;
  brain.destNode = nodeIdx;
  brain.wpNode = S.map.nextHop[S.map.nearestNode(bot.pos.x, bot.pos.z)][nodeIdx];
}

// Walk the graph toward destNode; returns true on arrival.
function followPath(S, bot, speed = 1) {
  const brain = bot.brain;
  if (brain.destNode < 0) return true;
  const dest = S.map.nodes[brain.destNode];
  if (Math.hypot(dest.x - bot.pos.x, dest.z - bot.pos.z) < 1.0 && brain.wpNode === brain.destNode) {
    bot.cmd.mx = 0; bot.cmd.mz = 0;
    return true;
  }
  if (brain.wpNode < 0 || brain.wpNode === undefined) brain.wpNode = S.map.nextHop[S.map.nearestNode(bot.pos.x, bot.pos.z)][brain.destNode];
  if (brain.wpNode < 0) { bot.cmd.mx = 0; bot.cmd.mz = 0; return true; } // no route: treat as arrived rather than wander
  // Stuck detection: a waypoint can sit just inside a crate's collision
  // margin, close enough to see, never close enough to "reach". If the bot
  // has barely moved in 0.7 s while trying, count the hop as done.
  if (brain.stuckT === undefined) { brain.stuckT = S.time; brain.stuckX = bot.pos.x; brain.stuckZ = bot.pos.z; }
  else if (S.time - brain.stuckT > 0.7) {
    const moved = Math.hypot(bot.pos.x - brain.stuckX, bot.pos.z - brain.stuckZ);
    brain.stuckT = S.time; brain.stuckX = bot.pos.x; brain.stuckZ = bot.pos.z;
    if (moved < 0.35) {
      if (brain.wpNode === brain.destNode) { bot.cmd.mx = 0; bot.cmd.mz = 0; return true; }
      brain.wpNode = S.map.nextHop[brain.wpNode][brain.destNode];
    }
  }
  let wp = S.map.nodes[brain.wpNode];
  if (Math.hypot(wp.x - bot.pos.x, wp.z - bot.pos.z) < 1.05) {
    const cur = S.map.nearestNode(bot.pos.x, bot.pos.z);
    brain.wpNode = S.map.nextHop[cur][brain.destNode];
    wp = S.map.nodes[brain.wpNode];
    if (brain.wpNode === brain.destNode && Math.hypot(wp.x - bot.pos.x, wp.z - bot.pos.z) < 1.0) {
      bot.cmd.mx = 0; bot.cmd.mz = 0;
      return true;
    }
  }
  const dx = wp.x - bot.pos.x; const dz = wp.z - bot.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  bot.cmd.mx = (dx / len) * speed;
  bot.cmd.mz = (dz / len) * speed;
  turnToward(bot, Math.atan2(-dx, -dz), 0, 4.2, S.dt);
  return false;
}

function engage(S, bot) {
  const brain = bot.brain;
  const target = brain.target;
  const dx = target.pos.x - bot.pos.x;
  const dz = target.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  // Aim at the chest with an error that settles while tracking and while still.
  const settle = Math.min(1, (S.time - brain.reactionAt + 0.4) * 1.4);
  const err = (1 - settle * 0.7) * 0.034 / brain.skill + (bot.speed2d > 0.5 ? 0.014 : 0);
  const wantYaw = Math.atan2(-dx, -dz) + Math.sin(S.time * 2.1 + bot.id * 7) * err;
  const chestY = target.pos.y + (target.crouchAmt > 0.5 ? 0.95 : 1.28);
  const wantPitch = Math.atan2(chestY - (bot.pos.y + 1.55), dist) + Math.cos(S.time * 1.7 + bot.id) * err * 0.5;
  const aimErr = turnToward(bot, wantYaw, wantPitch, 3.4, S.dt);

  // Movement: beyond 15 m, close in even while firing — long-range trades
  // with pistols settle nothing. Inside that, back off when point blank,
  // else strafe in pulses, standing still while a burst is actually firing.
  const firing = S.time < brain.nextBurstAt + 0.12 && brain.burstLeft > 0;
  bot.cmd.mx = 0; bot.cmd.mz = 0;
  if (dist > 15) { bot.cmd.mx = dx / dist; bot.cmd.mz = dz / dist; }
  else if (!firing) {
    if (dist < 6) { bot.cmd.mx = -dx / dist * 0.7; bot.cmd.mz = -dz / dist * 0.7; }
    else {
      if (S.time > brain.strafeUntil) { brain.strafeDir = S.rng.chance(0.5) ? 1 : -1; brain.strafeUntil = S.time + S.rng.range(0.4, 0.9); }
      bot.cmd.mx = (-dz / dist) * brain.strafeDir * 0.8;
      bot.cmd.mz = (dx / dist) * brain.strafeDir * 0.8;
    }
  }
  bot.cmd.crouch = dist > 20 && S.rng.chance(0.002);

  // Fire control: bursts with pauses, only when aimed and past reaction.
  bot.cmd.fire = false;
  if (S.time >= brain.reactionAt && aimErr < 0.09) {
    if (brain.burstLeft > 0) { bot.cmd.fire = true; brain.burstLeft -= S.dt * 12; }
    else if (S.time >= brain.nextBurstAt) {
      const def = (bot.loadout.slot === 'primary' ? bot.loadout.primary : bot.loadout.sidearm)?.def;
      brain.burstLeft = def && def.auto ? S.rng.int(2, 5) : 1;
      brain.nextBurstAt = S.time + S.rng.range(0.3, 0.55) / brain.skill;
      bot.cmd.fire = true;
    }
  }
  // A frag for a target hiding behind cover, once a round.
  if (!brain.threwGrenade && bot.loadout.grenades.frag > 0 && S.time - brain.lastSeenAt > 0.8 && dist < 19 && S.rng.chance(0.01)) {
    brain.threwGrenade = true;
    bot.loadout.slot = 'grenade';
    bot.loadout.grenadeType = 'frag';
    bot.pitch = 0.42;
    throwGrenade(S, bot);
    bot.loadout.slot = bot.loadout.primary ? 'primary' : 'sidearm';
  }
}

// The jobs, per role and per match situation. match.js assigns roles and the
// team's plan (which site) at round start.
function doJob(S, bot) {
  const brain = bot.brain;
  const cmd = bot.cmd;
  cmd.fire = false; cmd.use = false;
  const planted = S.bomb.state === 'planted';

  if (planted) {
    const site = S.bomb.site === 'A' ? { x: 24, z: -15 } : { x: 24, z: 15 };
    const siteNode = S.map.nearestNode(site.x, site.z);
    if (bot.team === 'def') {
      setDest(S, bot, siteNode);
      const arrived = followPath(S, bot, 1);
      if (arrived || Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z) < 3.4) {
        cmd.mx = 0; cmd.mz = 0;
        // The nearest defender works the charge; the rest cover the angles.
        const nearestDef = S.actors.filter((a) => a.alive && a.team === 'def')
          .sort((a, b) => Math.hypot(a.pos.x - site.x, a.pos.z - site.z) - Math.hypot(b.pos.x - site.x, b.pos.z - site.z))[0];
        if (nearestDef === bot) { cmd.use = true; turnToward(bot, yawTo(bot, site.x, site.z), -0.4, 4, S.dt); }
        else turnToward(bot, brain.holdYaw + Math.sin(S.time * 0.5 + bot.id) * 0.6, 0, 2, S.dt);
      }
      return;
    }
    // Attackers after the plant: hold a spot near the site and watch.
    setDest(S, bot, brain.holdNode >= 0 ? brain.holdNode : siteNode);
    if (followPath(S, bot, 0.9)) turnToward(bot, brain.holdYaw + Math.sin(S.time * 0.4 + bot.id * 3) * 0.7, 0, 2, S.dt);
    return;
  }

  if (bot.hasCharge) {
    const siteKey = S.plan.site;
    const site = siteKey === 'A' ? { x: 24, z: -15 } : { x: 24, z: 15 };
    setDest(S, bot, S.map.nearestNode(site.x, site.z));
    if (followPath(S, bot, 1)) { cmd.use = true; turnToward(bot, yawTo(bot, site.x, site.z), -0.5, 4, S.dt); }
    return;
  }

  if (S.bomb.state === 'dropped' && bot.team === 'atk') {
    setDest(S, bot, S.map.nearestNode(S.bomb.x, S.bomb.z));
    followPath(S, bot, 1);
    return;
  }

  switch (brain.role) {
    case 'anchor':
      setDest(S, bot, brain.holdNode);
      if (followPath(S, bot, 0.95)) {
        cmd.crouch = brain.crouchHold;
        turnToward(bot, brain.holdYaw + Math.sin(S.time * 0.45 + brain.scanPhase) * 0.55, 0, 1.8, S.dt);
      }
      break;
    case 'rotate': {
      const info = S.teamInfo[bot.team];
      if (info && S.time - info.at < 6) { setDest(S, bot, S.map.nearestNode(info.x, info.z)); followPath(S, bot, 1); }
      else { setDest(S, bot, brain.holdNode); if (followPath(S, bot, 0.9)) turnToward(bot, brain.holdYaw + Math.sin(S.time * 0.4 + brain.scanPhase) * 0.8, 0, 1.8, S.dt); }
      break;
    }
    case 'rush':
      setDest(S, bot, brain.holdNode);
      if (followPath(S, bot, 1)) turnToward(bot, brain.holdYaw + Math.sin(S.time * 0.4 + brain.scanPhase) * 0.7, 0, 1.8, S.dt);
      break;
    case 'escort': {
      const carrier = S.actors.find((a) => a.alive && a.hasCharge);
      if (carrier && carrier !== bot) {
        const d = Math.hypot(carrier.pos.x - bot.pos.x, carrier.pos.z - bot.pos.z);
        if (d > 7) { setDest(S, bot, S.map.nearestNode(carrier.pos.x, carrier.pos.z)); followPath(S, bot, 1); }
        else { cmd.mx = 0; cmd.mz = 0; turnToward(bot, brain.holdYaw + Math.sin(S.time * 0.5 + brain.scanPhase) * 0.9, 0, 1.8, S.dt); }
      } else { setDest(S, bot, brain.holdNode); followPath(S, bot, 1); }
      break;
    }
    default:
      setDest(S, bot, brain.holdNode);
      followPath(S, bot, 0.9);
  }

  // A heard contact is worth a look even mid-job.
  if (brain.hasInvestigate && S.time - (brain.heardAt || 0) < 3) {
    turnToward(bot, yawTo(bot, brain.investigateX, brain.investigateZ), 0, 2.4, S.dt);
  }
}

export function thinkBots(S, dt) {
  for (const bot of S.actors) {
    if (bot.isPlayer || !bot.alive) continue;
    const brain = bot.brain;
    bot.cmd.mx = 0; bot.cmd.mz = 0; bot.cmd.fire = false; bot.cmd.use = false; bot.cmd.jump = false;
    if (S.phase !== 'live' && S.phase !== 'planted') continue;
    if (S.time >= brain.nextPerceiveAt) { brain.nextPerceiveAt = S.time + 0.12; perceive(S, bot); }
    if (S.time < bot.blindUntil) { // flashed: stop, crouch, fire at nothing in particular stays holstered
      bot.cmd.crouch = true;
      continue;
    }
    // The carrier plays the objective: a target farther than 12 m does not
    // pull it off the push — it keeps walking the charge to the site.
    const carrierPushing = bot.hasCharge && brain.target
      && Math.hypot(brain.target.pos.x - bot.pos.x, brain.target.pos.z - bot.pos.z) > 12;
    if (brain.target && brain.target.alive && S.time - brain.lastSeenAt < 0.35 && !carrierPushing) engage(S, bot);
    else {
      if (!carrierPushing) brain.target = null;
      doJob(S, bot);
    }
    // A carrier standing in a site plants, whatever else is happening: the
    // channel only asks for a held key and a still body, and it may shoot back.
    if (bot.hasCharge && S.phase === 'live' && S.map.siteAt(bot.pos.x, bot.pos.z)) {
      bot.cmd.mx = 0; bot.cmd.mz = 0; bot.cmd.use = true;
    }
    // Reload when the magazine runs dry and nobody is in the face.
    const slot = bot.loadout.slot === 'primary' ? bot.loadout.primary : bot.loadout.sidearm;
    if (slot && slot.mag === 0) bot.cmd.reload = true;
    else bot.cmd.reload = false;
  }
  void dt;
}

// Pose the model from the actor: position, yaw, walk swing, crouch dip, the
// fall when dead. Called in the render loop, so it reads state, never sets it.
export function syncBotModel(bot, now) {
  const model = bot.model;
  if (!model) return;
  const u = model.userData;
  model.position.copy(bot.pos);
  model.rotation.y = bot.yaw;
  const swing = bot.alive ? Math.sin(bot.stepPhase * Math.PI) * 0.5 * Math.min(1, bot.speed2d / 3) : 0;
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  u.rig.position.y = -0.34 * bot.crouchAmt;
  u.rig.rotation.x = 0;
  if (!bot.alive) {
    if (!u.deathAt) u.deathAt = now;
    const t = Math.min(1, (now - u.deathAt) / 0.4);
    u.rig.rotation.x = -Math.PI / 2 * t;
    u.rig.position.y = -0.34 * bot.crouchAmt + 0.1 * t;
    u.legL.rotation.x = 0.2; u.legR.rotation.x = -0.15;
  } else {
    u.deathAt = 0;
  }
}
