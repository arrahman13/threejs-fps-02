// LOWTIDE — boot and the loop. A fixed-step simulation (60 Hz) owns every
// rule; rendering, effects and the HUD only read what the steps produced.
// Order inside a step matters: controllers write commands, the match reads
// channels, combat resolves fire, bodies move, grenades fly, the match
// settles timers and wins, and only then are events handed to ears and eyes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createRng } from './rng.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createMap } from './map.js';
import { createState, setupMatch, startMatch, buyItem, tickChannels, tickPhase, handleEvents } from './match.js';
import { controlPlayer, createPlayerView } from './player.js';
import { thinkBots, syncBotModel } from './bots.js';
import { stepActor } from './actors.js';
import { tryFire, startReload, serviceWeapons } from './combat.js';
import { throwGrenade, stepGrenades } from './grenades.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');
const seed = Number(params.get('seed') || (shotMode ? 7 : Date.now() % 100000));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'webgl';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(0x232a33, 55, 190);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 260);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0x8fa3bd, 0x2e2620, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb36b, 1.5);
sun.position.set(-38, 30, -20);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -46; sun.shadow.camera.right = 46;
sun.shadow.camera.top = 36; sun.shadow.camera.bottom = -36;
sun.shadow.camera.far = 130;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(new THREE.AmbientLight(0x35404d, 0.5));

const map = createMap(scene);

const S = createState(scene, map, createRng(seed), camera);
setupMatch(S);

const input = createInput(renderer.domElement, (locked) => {
  if (locked) { paused = false; pauseEl.classList.add('hidden'); }
  else if (started && !shotMode && S.phase !== 'menu' && S.phase !== 'matchover') {
    paused = true;
    pauseEl.classList.remove('hidden');
  }
});
const audio = createAudio();
const fx = createFx(scene);
const view = createPlayerView(camera);
const hud = createHud(S, { buy: (id) => audio.buy(buyItem(S, S.player, id)) });

let paused = false;
let started = false;

// Sound: every event becomes a sound at its distance from the player.
function audioConsume() {
  const P = S.player.pos;
  const dist = (x, z) => Math.hypot(x - P.x, z - P.z);
  for (const ev of S.events) {
    switch (ev.type) {
      case 'shot': audio.shot(ev.def.kind, ev.actor.isPlayer ? 0 : dist(ev.actor.pos.x, ev.actor.pos.z)); break;
      case 'dry': if (ev.actor.isPlayer) audio.dryFire(); break;
      case 'reload': if (ev.actor.isPlayer) audio.reload(); break;
      case 'hit': if (ev.shooter.isPlayer) audio.hit(ev.part === 'head'); if (ev.victim.isPlayer) audio.hurt(); break;
      case 'kill': if (ev.attacker === S.player) audio.kill(); if (ev.victim.isPlayer) audio.hurt(); break;
      case 'explosion': audio.explosion(ev.big); break;
      case 'bounce': audio.bounce(); break;
      case 'throw': if (ev.actor.isPlayer) audio.throwWhoosh(); break;
      case 'playerFlashed': audio.flashRing(); break;
      case 'step': audio.step(dist(ev.actor.pos.x, ev.actor.pos.z)); break;
      case 'beep': audio.beep(ev.final); break;
      case 'plantStart': audio.plantStart(); break;
      case 'defuseStart': audio.defuseTick(); break;
      case 'planted': audio.plantStart(); break;
      case 'roundEnd': audio.roundEnd(ev.winner === S.player.team); break;
      case 'roundLive': audio.beep(false); break;
      case 'pickup': if (ev.actor.isPlayer) audio.plantStart(); break;
      default: break;
    }
  }
}

function step() {
  S.dt = STEP;
  S.time += STEP;
  controlPlayer(S, input);
  thinkBots(S, STEP);
  tickChannels(S);
  for (const actor of S.actors) {
    if (!actor.alive) continue;
    serviceWeapons(S, actor);
    if (actor.cmd.reload) startReload(S, actor);
    if (actor.cmd.fire) {
      if (actor.loadout.slot === 'grenade') {
        if (S.time >= actor.nextThrowAt && throwGrenade(S, actor)) actor.nextThrowAt = S.time + 0.9;
      } else {
        tryFire(S, actor); // the weapon's own nextShotAt gate covers draw time
      }
    }
  }
  for (const actor of S.actors) if (actor.alive) stepActor(actor, STEP, S.map, S.time);
  for (const actor of S.actors) {
    if (actor.alive && actor.grounded && actor.speed2d > 3.3 && S.time >= actor.nextStepAt) {
      actor.nextStepAt = S.time + 0.36;
      S.noise.push({ x: actor.pos.x, z: actor.pos.z, team: actor.team, r: actor.cmd.walk || actor.cmd.crouch ? 5 : 13, at: S.time });
      if (!actor.isPlayer) S.events.push({ type: 'step', actor });
    }
  }
  stepGrenades(S, STEP);
  tickPhase(S);
  handleEvents(S);
  fx.consume(S);
  audioConsume();
  hud.consume();
  S.events.length = 0;
}

// --- flow: start, pause, restart -------------------------------------------
const startEl = document.getElementById('start');
const pauseEl = document.getElementById('pause');
const endEl = document.getElementById('end');

function lockPointer() {
  if (shotMode) return;
  try {
    const p = renderer.domElement.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => {
      try {
        const q = renderer.domElement.requestPointerLock();
        if (q && q.catch) q.catch(() => { /* browser cooldown: the next click re-locks */ });
      } catch { /* not a user gesture */ }
    });
  } catch { /* not a user gesture */ }
}
function beginMatch() {
  startEl.style.display = 'none';
  endEl.classList.add('hidden');
  started = true;
  paused = false;
  audio.unlock();
  startMatch(S);
  lockPointer();
}
document.getElementById('play-btn').addEventListener('click', beginMatch);
document.getElementById('again-btn').addEventListener('click', beginMatch);
document.getElementById('resume-btn').addEventListener('click', () => lockPointer());
renderer.domElement.addEventListener('click', () => {
  if (started && !document.pointerLockElement && S.phase !== 'matchover') lockPointer();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); document.getElementById('scoreboard').style.display = 'block'; }
  if (e.code === 'KeyB' && S.phase === 'buy' && started && !paused) hud.setBuy(!hud.isBuyOpen());
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') document.getElementById('scoreboard').style.display = 'none';
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- staged screenshots ------------------------------------------------------
// ?shot=start|buy|play|plant&seed=N poses a deterministic frame, renders it
// twice and freezes: the entry's screenshots are real renders of this code.
function stageShot() {
  started = true;
  startMatch(S);
  const P = S.player;
  if (shotMode === 'start') {
    S.phase = 'menu'; // freeze the sim; the title card stays over the harbour
    return;
  }
  startEl.style.display = 'none';
  if (shotMode === 'buy') {
    P.money = 5000;
    hud.setBuy(true);
  } else if (shotMode === 'play') {
    S.phase = 'live';
    S.timeLeft = 83;
    P.money = 9000;
    buyItem(S, P, 'rifle');
    P.loadout.slot = 'primary';
    P.pos.set(0, 0, 3);
    P.yaw = -Math.PI / 2 + 0.25;
    P.health = 72;
    const d0 = S.actors[5];
    const d1 = S.actors[6];
    d0.pos.set(16, 0, -4);
    d0.yaw = Math.PI / 2;
    d1.pos.set(22, 0, 3);
    d1.yaw = Math.PI / 2;
    S.events.push({ type: 'tracer', from: { x: 1, y: 1.5, z: 3 }, to: { x: 14, y: 1.3, z: -6 } });
    fx.consume(S);
    S.events.length = 0;
  } else if (shotMode === 'plant') {
    S.phase = 'planted';
    S.bomb.state = 'planted';
    S.bomb.site = 'A';
    S.bomb.x = 24; S.bomb.z = -15;
    S.bomb.timer = 18;
    S.bomb.deviceMesh.visible = true;
    S.bomb.deviceMesh.position.set(24, 0.11, -15);
    P.hasCharge = false;
    P.money = 9000;
    buyItem(S, P, 'rifle');
    P.loadout.slot = 'primary';
    P.pos.set(19.5, 0, -10.5);
    P.yaw = Math.atan2(-(24 - 19.5), -(-15 + 10.5));
    const mate = S.actors[1];
    mate.pos.set(17, 0, -17);
    mate.yaw = Math.PI / 2;
    const def = S.actors[7];
    def.pos.set(12, 0, -3);
    def.yaw = -Math.PI / 2;
    S.events.push({ type: 'planted', site: 'A', x: 24, z: -15 });
    hud.consume();
    S.events.length = 0;
  }
}
if (shotMode) stageShot();

// --- the loop ------------------------------------------------------------------
let last = performance.now();
let acc = 0;
let frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused && S.phase !== 'menu') {
    const look = input.takeLook();
    if (look.x || look.y) view.applyLook(S.player, look.x, look.y);
    acc += dtReal;
    let guard = 0;
    while (acc >= STEP && guard < 5) { step(); acc -= STEP; guard += 1; }
    if (guard === 5) acc = 0;
  }
  view.sync(S, dtReal);
  for (const actor of S.actors) if (actor.model) syncBotModel(actor, S.time);
  const shake = fx.step(dtReal);
  if (shake > 0.003) {
    camera.rotation.z += (Math.random() - 0.5) * shake * 0.05;
    camera.rotation.x += (Math.random() - 0.5) * shake * 0.04;
  }
  if (S.phase === 'matchover' && started && !shotMode) {
    const won = S.matchWinner === S.player.team;
    document.getElementById('end-title').textContent = S.matchWinner === 'draw' ? 'DRAWN MATCH' : won ? 'BREAKERS PREVAIL' : 'WARDENS PREVAIL';
    document.getElementById('end-sub').textContent = `Final score — Breakers ${S.scoreAtk} : ${S.scoreDef} Wardens · ${S.round} rounds`;
    endEl.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    started = false;
  }
  hud.refresh();
  renderer.render(scene, camera);
  frames += 1;
  if (shotMode && frames === 3) window.__shotReady = true;
}
requestAnimationFrame(frame);

window.__game = {
  S,
  startMatch: () => beginMatch(),
  // Run fixed steps synchronously; headless test rigs render too slowly to
  // feed the loop in real time, so they drive the simulation with this.
  pump: (seconds) => { const n = Math.round(seconds / STEP); for (let i = 0; i < n; i += 1) step(); },
};
