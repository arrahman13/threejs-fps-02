// The match: all state in one object, and the rules that move it — round
// phases (buy, live, planted, over), the economy, the charge (plant, drop,
// defuse, detonation), team roles and the win checks. Controllers and combat
// write commands and events; this module reads them and decides.
import * as THREE from 'three';
import { SPAWNS, SITES } from './map.js';
import { makeActor } from './actors.js';
import { WEAPONS, GRENADES, ARMOR_PRICE, refill, buildWorldGun } from './weapons.js';
import { makeBrain, buildBotModel, BOT_NAMES } from './bots.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const CHARGE_TIME = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const WIN_SCORE = 7;
export const MAX_ROUNDS = 12;
const MONEY_CAP = 10000;

export function createState(scene, map, rng, camera) {
  return {
    scene, map, rng, camera,
    time: 0, dt: 0,
    phase: 'menu', timeLeft: 0,
    round: 0, scoreAtk: 0, scoreDef: 0,
    actors: [], player: null,
    events: [], noise: [],
    grenades: [], smokes: [],
    bomb: null,
    plan: { site: 'A' },
    teamInfo: { atk: null, def: null },
    channel: null,
    lastRound: null, // { winner, reason }
    matchWinner: null,
    scoped: false,
    shake: 0,
  };
}

function bombMeshes(scene) {
  const pack = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.34),
    new THREE.MeshLambertMaterial({ color: '#3a3f45' }));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.36),
    new THREE.MeshLambertMaterial({ color: 0xf2a33c }));
  pack.add(body, stripe);
  pack.visible = false;
  scene.add(pack);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
  const device = new THREE.Group();
  const dbody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.38),
    new THREE.MeshLambertMaterial({ color: '#2c2f33' }));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), lightMat);
  lamp.position.set(0.15, 0.15, 0);
  device.add(dbody, lamp);
  device.visible = false;
  scene.add(device);
  return { pack, device, lightMat };
}

export function setupMatch(S) {
  const meshes = bombMeshes(S.scene);
  S.bomb = {
    state: 'carried', carrier: null, x: 0, z: 0, site: null, timer: 0,
    packMesh: meshes.pack, deviceMesh: meshes.device, lightMat: meshes.lightMat, beepAt: 0,
    dropAt(pos) { this.state = 'dropped'; this.x = pos.x; this.z = pos.z; this.carrier = null; },
  };
  S.player = makeActor('You', 'atk', true);
  S.actors.push(S.player);
  for (let i = 0; i < 4; i += 1) S.actors.push(makeActor(BOT_NAMES.atk[i], 'atk', false));
  for (let i = 0; i < 5; i += 1) S.actors.push(makeActor(BOT_NAMES.def[i], 'def', false));
  for (const actor of S.actors) {
    actor.kills = 0;
    actor.deaths = 0;
    if (!actor.isPlayer) {
      actor.brain = makeBrain('anchor');
      actor.model = buildBotModel(actor.team, 'pistol');
      S.scene.add(actor.model);
    }
  }
}

export function startMatch(S) {
  S.scoreAtk = 0;
  S.scoreDef = 0;
  S.round = 0;
  S.matchWinner = null;
  for (const actor of S.actors) {
    actor.money = 800;
    actor.kills = 0;
    actor.deaths = 0;
    actor.loadout.primary = null;
    actor.loadout.armor = false;
    actor.loadout.helmet = false;
    actor.loadout.grenades = { frag: 0, flash: 0, smoke: 0 };
  }
  startRound(S);
}

function yawFacing(fromX, fromZ, toX, toZ) { return Math.atan2(-(toX - fromX), -(toZ - fromZ)); }

const WATCH = { 12: [6, -13], 27: [14, -4], 19: [6, 13], 28: [14, 4], 14: [-12, 0], 10: [-6, -15], 18: [-6, 15] };

export function startRound(S) {
  S.round += 1;
  S.plan.site = S.rng.chance(0.52) ? 'A' : 'B';
  S.teamInfo.atk = null;
  S.teamInfo.def = null;
  S.channel = null;
  S.bomb.state = 'carried';
  S.bomb.site = null;
  S.bomb.timer = 0;
  S.bomb.packMesh.visible = false;
  S.bomb.deviceMesh.visible = false;
  // Leftover grenades and smoke from last round are gone.
  for (const n of S.grenades) S.scene.remove(n.mesh);
  S.grenades.length = 0;
  for (const c of S.smokes) S.scene.remove(c.group);
  S.smokes.length = 0;

  const planNodes = S.plan.site === 'A' ? [10, 27, 9] : [18, 28, 16];
  let atkBot = 0;
  let defBot = 0;
  for (const actor of S.actors) {
    actor.alive = true;
    actor.health = 100;
    actor.vel.set(0, 0, 0);
    actor.pitch = 0;
    actor.bloom = 0;
    actor.blindUntil = 0;
    actor.hasCharge = false;
    if (actor.diedLastRound) { actor.loadout.primary = null; actor.loadout.armor = false; actor.loadout.helmet = false; }
    actor.diedLastRound = false;
    refill(actor.loadout);
    actor.loadout.slot = actor.loadout.primary ? 'primary' : 'sidearm';
    if (actor.isPlayer) {
      const [x, z] = SPAWNS.atk[0];
      actor.pos.set(x, 0, z);
      actor.yaw = yawFacing(x, z, 0, 0);
      actor.hasCharge = true;
      S.bomb.carrier = actor;
    } else if (actor.team === 'atk') {
      atkBot += 1;
      const [x, z] = SPAWNS.atk[atkBot];
      actor.pos.set(x, 0, z);
      actor.yaw = yawFacing(x, z, 0, 0);
      const brain = actor.brain;
      brain.threwGrenade = false;
      brain.target = null;
      if (atkBot === 1) { brain.role = 'escort'; brain.holdNode = planNodes[0]; }
      else { brain.role = 'rush'; brain.holdNode = planNodes[(atkBot - 2) % planNodes.length]; }
      brain.holdYaw = yawFacing(S.map.nodes[brain.holdNode].x, S.map.nodes[brain.holdNode].z, 30, S.plan.site === 'A' ? -15 : 15);
      botBuy(S, actor);
      syncBotGun(actor);
    } else {
      const [x, z] = SPAWNS.def[defBot];
      defBot += 1;
      actor.pos.set(x, 0, z);
      actor.yaw = yawFacing(x, z, 0, 0);
      const brain = actor.brain;
      brain.threwGrenade = false;
      brain.target = null;
      const anchors = [[12, 'A'], [27, 'A'], [19, 'B'], [28, 'B']];
      if (defBot <= 4) {
        const [node] = anchors[defBot - 1];
        brain.role = 'anchor';
        brain.holdNode = node;
        brain.crouchHold = defBot % 2 === 0;
      } else {
        brain.role = 'rotate';
        brain.holdNode = 14;
        brain.crouchHold = false;
      }
      const watch = WATCH[brain.holdNode] || [0, 0];
      brain.holdYaw = yawFacing(S.map.nodes[brain.holdNode].x, S.map.nodes[brain.holdNode].z, watch[0], watch[1]);
      botBuy(S, actor);
      syncBotGun(actor);
    }
    if (actor.model) { actor.model.visible = true; actor.model.userData.deathAt = 0; }
  }
  S.phase = 'buy';
  S.timeLeft = BUY_TIME;
  S.events.push({ type: 'roundStart', round: S.round });
}

// Bots shop by a simple ladder: keep a rifle if alive with one, else buy the
// best gun the purse allows, then armour, then a grenade with the change.
function botBuy(S, actor) {
  const buy = (id) => buyItem(S, actor, id);
  if (!actor.loadout.primary) {
    if (actor.money >= WEAPONS.rifle.price + ARMOR_PRICE) buy('rifle');
    else if (actor.money >= WEAPONS.rifle.price && S.rng.chance(0.6)) buy('rifle');
    else if (actor.money >= WEAPONS.smg.price) buy(S.rng.chance(0.7) ? 'smg' : 'shotgun');
  }
  if (!actor.loadout.armor && actor.money >= ARMOR_PRICE) buy('armor');
  if (actor.money >= 300 && S.rng.chance(0.45)) buy('frag');
  else if (actor.money >= 200 && S.rng.chance(0.2)) buy('flash');
}

function syncBotGun(actor) {
  if (!actor.model) return;
  const kind = actor.loadout.primary ? actor.loadout.primary.def.kind : 'pistol';
  const old = actor.model.userData.gun;
  if (old && old.userData.kind === kind) return;
  if (old) actor.model.userData.rig.remove(old);
  const gun = buildWorldGun(kind);
  gun.userData.kind = kind;
  gun.position.set(0.3, 1.28, -0.25);
  actor.model.userData.rig.add(gun);
  actor.model.userData.gun = gun;
}

export function buyItem(S, actor, id) {
  const loadout = actor.loadout;
  const spend = (price) => { if (actor.money < price) return false; actor.money -= price; return true; };
  if (WEAPONS[id] && id !== 'pistol') {
    if (loadout.primary && loadout.primary.def.id === id) return false;
    if (!spend(WEAPONS[id].price)) return false;
    loadout.primary = { def: WEAPONS[id], mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve, nextShotAt: 0, reloadEndAt: 0, boltUntil: 0 };
    return true;
  }
  if (id === 'armor') {
    if (loadout.armor) return false;
    if (!spend(ARMOR_PRICE)) return false;
    loadout.armor = true;
    loadout.helmet = true;
    return true;
  }
  if (GRENADES[id]) {
    const total = loadout.grenades.frag + loadout.grenades.flash + loadout.grenades.smoke;
    if (loadout.grenades[id] >= 2 || total >= 4) return false;
    if (!spend(GRENADES[id].price)) return false;
    loadout.grenades[id] += 1;
    return true;
  }
  return false;
}

// Plant and defuse channels, read from commands after controllers have run.
export function tickChannels(S) {
  let active = null;
  if (S.phase === 'live' || S.phase === 'planted') {
    for (const actor of S.actors) {
      if (!actor.alive || !actor.cmd.use || actor.speed2d > 0.6) continue;
      if (actor.hasCharge && actor.team === 'atk' && S.phase === 'live') {
        const site = S.map.siteAt(actor.pos.x, actor.pos.z);
        if (site) { active = { actor, kind: 'plant', need: PLANT_TIME, site }; break; }
      }
      if (actor.team === 'def' && S.phase === 'planted') {
        const d = Math.hypot(actor.pos.x - S.bomb.x, actor.pos.z - S.bomb.z);
        if (d < 2.3) { active = { actor, kind: 'defuse', need: DEFUSE_TIME }; break; }
      }
    }
  }
  if (active) {
    if (S.channel && S.channel.actor === active.actor && S.channel.kind === active.kind) {
      S.channel.progress += S.dt;
    } else {
      S.channel = { actor: active.actor, kind: active.kind, need: active.need, site: active.site, progress: 0 };
      S.events.push({ type: active.kind === 'plant' ? 'plantStart' : 'defuseStart', actor: active.actor });
    }
    if (S.channel.progress >= S.channel.need) {
      if (S.channel.kind === 'plant') plantCharge(S, S.channel.actor, S.channel.site);
      else { S.channel = null; endRound(S, 'def', 'defused'); }
      S.channel = null;
    }
  } else if (S.channel) {
    S.channel = null;
  }
}

function plantCharge(S, actor, site) {
  actor.hasCharge = false;
  S.bomb.state = 'planted';
  S.bomb.site = site;
  S.bomb.x = actor.pos.x;
  S.bomb.z = actor.pos.z;
  S.bomb.carrier = null;
  S.bomb.timer = CHARGE_TIME;
  S.bomb.beepAt = CHARGE_TIME;
  S.phase = 'planted';
  S.bomb.deviceMesh.visible = true;
  S.bomb.deviceMesh.position.set(actor.pos.x, actor.pos.y + 0.11, actor.pos.z);
  S.bomb.packMesh.visible = false;
  actor.money = Math.min(MONEY_CAP, actor.money + 300);
  for (const a of S.actors) if (a.team === 'atk') a.money = Math.min(MONEY_CAP, a.money + 300);
  S.teamInfo.def = { x: actor.pos.x, z: actor.pos.z, at: S.time };
  // Attackers fan out to cover the site they just took.
  const coverNodes = site === 'A' ? [27, 30, 10] : [28, 31, 18];
  let i = 0;
  for (const a of S.actors) {
    if (!a.isPlayer && a.team === 'atk' && a.alive) { a.brain.holdNode = coverNodes[i % coverNodes.length]; i += 1; }
  }
  S.events.push({ type: 'planted', site, x: actor.pos.x, z: actor.pos.z });
}

export function endRound(S, winner, reason) {
  if (S.phase === 'roundover' || S.phase === 'matchover') return;
  S.phase = 'roundover';
  S.timeLeft = 4.5;
  S.channel = null;
  if (winner === 'atk') S.scoreAtk += 1; else S.scoreDef += 1;
  for (const actor of S.actors) {
    if (!actor.alive) actor.diedLastRound = true;
    const award = actor.team === winner ? 2400 : 1900;
    actor.money = Math.min(MONEY_CAP, actor.money + award);
  }
  S.lastRound = { winner, reason };
  S.events.push({ type: 'roundEnd', winner, reason });
  if (S.scoreAtk >= WIN_SCORE || S.scoreDef >= WIN_SCORE || S.round >= MAX_ROUNDS) {
    S.matchWinner = S.scoreAtk === S.scoreDef ? 'draw' : (S.scoreAtk > S.scoreDef ? 'atk' : 'def');
  }
}

// Money and information from the step's events: kills pay, and a team that
// loses someone learns roughly where the shooter was.
export function handleEvents(S) {
  for (const ev of S.events) {
    if (ev.type === 'kill') {
      if (ev.attacker && ev.attacker.team !== ev.victim.team) {
        ev.attacker.money = Math.min(MONEY_CAP, ev.attacker.money + 300);
        ev.attacker.kills += 1;
      }
      ev.victim.deaths += 1;
      if (ev.attacker) S.teamInfo[ev.victim.team] = { x: ev.attacker.pos.x, z: ev.attacker.pos.z, at: S.time };
    } else if (ev.type === 'damage' && ev.attacker) {
      S.teamInfo[ev.victim.team] = { x: ev.attacker.pos.x, z: ev.attacker.pos.z, at: S.time };
    }
  }
}

export function tickPhase(S) {
  const dt = S.dt;
  // The dropped charge shows its pack; a carried one hides it.
  if (S.bomb.state === 'dropped') {
    S.bomb.packMesh.visible = true;
    S.bomb.packMesh.position.set(S.bomb.x, S.map.groundAt(S.bomb.x, S.bomb.z, 4) + 0.16, S.bomb.z);
  } else if (S.bomb.state === 'carried') {
    S.bomb.packMesh.visible = false;
  }
  if (S.bomb.state === 'planted') {
    const blink = S.bomb.timer < 5 ? (S.time * 6) % 1 < 0.5 : (S.time * 2) % 1 < 0.5;
    S.bomb.lightMat.color.setHex(blink ? 0xff4444 : 0x661111);
  }
  // Prune old noise.
  for (let i = S.noise.length - 1; i >= 0; i -= 1) if (S.time - S.noise[i].at > 1.2) S.noise.splice(i, 1);

  if (S.phase === 'buy') {
    S.timeLeft -= dt;
    if (S.timeLeft <= 0) {
      S.phase = 'live';
      S.timeLeft = ROUND_TIME;
      S.events.push({ type: 'roundLive' });
    }
    return;
  }
  if (S.phase === 'live') {
    S.timeLeft -= dt;
    if (S.bomb.state === 'dropped') {
      for (const actor of S.actors) {
        if (actor.alive && actor.team === 'atk' && Math.hypot(actor.pos.x - S.bomb.x, actor.pos.z - S.bomb.z) < 1.15) {
          actor.hasCharge = true;
          S.bomb.state = 'carried';
          S.bomb.carrier = actor;
          S.events.push({ type: 'pickup', actor });
          break;
        }
      }
    }
    const atkAlive = S.actors.some((a) => a.alive && a.team === 'atk');
    const defAlive = S.actors.some((a) => a.alive && a.team === 'def');
    if (!defAlive) return endRound(S, 'atk', 'elimination');
    if (!atkAlive) return endRound(S, 'def', 'elimination');
    if (S.timeLeft <= 0) return endRound(S, 'def', 'time');
    return;
  }
  if (S.phase === 'planted') {
    S.bomb.timer -= dt;
    if (S.bomb.timer <= S.bomb.beepAt) {
      S.events.push({ type: 'beep', final: S.bomb.timer < 4 });
      S.bomb.beepAt = S.bomb.timer - (S.bomb.timer > 10 ? 1 : S.bomb.timer > 4 ? 0.5 : 0.22);
    }
    const defAlive = S.actors.some((a) => a.alive && a.team === 'def');
    if (!defAlive) return endRound(S, 'atk', 'elimination');
    if (S.bomb.timer <= 0) {
      S.bomb.state = 'detonated';
      S.bomb.deviceMesh.visible = false;
      S.events.push({ type: 'explosion', at: new THREE.Vector3(S.bomb.x, 0.6, S.bomb.z), big: true });
      for (const actor of S.actors) {
        if (!actor.alive) continue;
        const d = Math.hypot(actor.pos.x - S.bomb.x, actor.pos.z - S.bomb.z);
        if (d < 9) {
          const dmg = d < 4 ? 500 : 130 - d * 10;
          if (dmg > 0) {
            actor.health -= dmg;
            if (actor.health <= 0) { actor.alive = false; S.events.push({ type: 'kill', victim: actor, attacker: null, part: 'body' }); }
          }
        }
      }
      return endRound(S, 'atk', 'detonation');
    }
    return;
  }
  if (S.phase === 'roundover') {
    S.timeLeft -= dt;
    if (S.timeLeft <= 0) {
      if (S.matchWinner) {
        S.phase = 'matchover';
        S.events.push({ type: 'matchEnd', winner: S.matchWinner });
      } else {
        startRound(S);
      }
    }
  }
}
