// Weapon definitions and the meshes for them. One table drives the shop, the
// player's viewmodel, the bots' damage and the HUD, so a gun can never behave
// one way in the menu and another in the field. Accuracy is the theme: spread
// is smallest standing still and crouched, and balloons on the move.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Dockhand', kind: 'pistol', price: 0, damage: 26, rpm: 340, auto: false,
    mag: 12, reserve: 48, reload: 1.4, spread: 0.006, moveSpread: 3.2, recoil: 0.010, pellets: 1,
    falloffFrom: 18, falloffTo: 46, falloffMin: 0.55, zoom: 1.25, draw: 0.35, speed: 1.0,
  },
  smg: {
    id: 'smg', name: 'Kestrel-9', kind: 'smg', price: 1100, damage: 21, rpm: 850, auto: true,
    mag: 30, reserve: 90, reload: 2.0, spread: 0.016, moveSpread: 2.4, recoil: 0.007, pellets: 1,
    falloffFrom: 12, falloffTo: 34, falloffMin: 0.5, zoom: 1.25, draw: 0.45, speed: 1.0,
  },
  shotgun: {
    id: 'shotgun', name: 'Breakwater 12', kind: 'shotgun', price: 1050, damage: 9, rpm: 68, auto: false,
    mag: 6, reserve: 24, reload: 2.8, spread: 0.045, moveSpread: 1.8, recoil: 0.05, pellets: 8,
    falloffFrom: 6, falloffTo: 20, falloffMin: 0.25, zoom: 1.15, draw: 0.5, speed: 0.97,
  },
  rifle: {
    id: 'rifle', name: 'Longshore AR', kind: 'rifle', price: 2700, damage: 33, rpm: 600, auto: true,
    mag: 25, reserve: 75, reload: 2.2, spread: 0.0075, moveSpread: 3.6, recoil: 0.013, pellets: 1,
    falloffFrom: 30, falloffTo: 80, falloffMin: 0.72, zoom: 1.35, draw: 0.55, speed: 0.95,
  },
  sniper: {
    id: 'sniper', name: 'Cormorant', kind: 'sniper', price: 3500, damage: 97, rpm: 44, auto: false,
    mag: 5, reserve: 20, reload: 3.0, spread: 0.0012, moveSpread: 9, recoil: 0.06, pellets: 1,
    falloffFrom: 40, falloffTo: 120, falloffMin: 0.9, zoom: 2.6, draw: 0.6, speed: 0.93, bolt: 1.35,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Burst grenade', price: 300 },
  flash: { id: 'flash', name: 'Flare grenade', price: 200 },
  smoke: { id: 'smoke', name: 'Fog grenade', price: 300 },
};
export const ARMOR_PRICE = 650;

// One actor's carried weapons: state per slot, refilled at each round start.
export function makeLoadout() {
  return {
    primary: null, // a slot object once bought
    sidearm: makeSlot(WEAPONS.pistol),
    grenades: { frag: 0, flash: 0, smoke: 0 },
    slot: 'sidearm', // 'primary' | 'sidearm' | 'grenade'
    grenadeType: 'frag',
    armor: false,
    helmet: false,
  };
}

export function makeSlot(def) {
  return { def, mag: def.mag, reserve: def.reserve, nextShotAt: 0, reloadEndAt: 0, boltUntil: 0 };
}

export function refill(loadout) {
  for (const key of ['primary', 'sidearm']) {
    const slot = loadout[key];
    if (slot) { slot.mag = slot.def.mag; slot.reserve = slot.def.reserve; slot.nextShotAt = 0; slot.reloadEndAt = 0; slot.boltUntil = 0; }
  }
}

export function currentSlot(loadout) {
  return loadout.slot === 'primary' ? loadout.primary : loadout.sidearm;
}

// Damage after distance falloff: full inside falloffFrom, easing to
// falloffMin at falloffTo.
export function falloff(def, dist) {
  if (dist <= def.falloffFrom) return 1;
  if (dist >= def.falloffTo) return def.falloffMin;
  const t = (dist - def.falloffFrom) / (def.falloffTo - def.falloffFrom);
  return 1 - t * (1 - def.falloffMin);
}

// ---- meshes ---------------------------------------------------------------
const steel = new THREE.MeshLambertMaterial({ color: '#2b2f36' });
const steelLight = new THREE.MeshLambertMaterial({ color: PALETTE.hairline });
const grip = new THREE.MeshLambertMaterial({ color: '#4c3a28' });
const accentMat = new THREE.MeshLambertMaterial({ color: PALETTE.accent });
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function part(group, mat, x, y, z, sx, sy, sz, rx = 0) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.x = rx;
  group.add(m);
  return m;
}

// The first-person gun: built at the origin looking down -Z, held low-right;
// the player controller poses it, kicks it and bobs it.
export function buildViewmodel(def) {
  const g = new THREE.Group();
  const kind = def.kind;
  const long = kind === 'sniper' ? 0.86 : kind === 'rifle' ? 0.72 : kind === 'shotgun' ? 0.7 : kind === 'smg' ? 0.52 : 0.34;
  part(g, steel, 0, 0, -long / 2, 0.075, 0.11, long); // receiver
  part(g, steelLight, 0, 0.045, -long + 0.05, 0.045, 0.045, 0.22); // barrel
  part(g, grip, 0, -0.1, 0.03, 0.06, 0.13, 0.07, 0.35); // grip
  if (kind !== 'pistol') part(g, steel, 0, -0.11, -long * 0.45, 0.05, 0.14, 0.08, 0.12); // magazine
  if (kind === 'sniper') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 10), steel);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, -0.3);
    g.add(scope);
    part(g, accentMat, 0, 0.1, -0.41, 0.03, 0.03, 0.012);
  } else {
    part(g, steelLight, 0, 0.1, -long + 0.12, 0.014, 0.05, 0.014); // front post
    part(g, steel, 0, 0.095, -0.06, 0.05, 0.03, 0.02); // rear sight
  }
  if (kind === 'shotgun') part(g, grip, 0, -0.03, -0.42, 0.055, 0.06, 0.16); // pump
  if (kind === 'smg') part(g, steelLight, 0, 0, -long - 0.03, 0.05, 0.05, 0.08); // suppressor block
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.045, -long - 0.06);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

// The simple gun a bot carries in the world: a dark long box with a magazine.
export function buildWorldGun(kind) {
  const g = new THREE.Group();
  const len = kind === 'pistol' ? 0.26 : kind === 'sniper' ? 0.95 : kind === 'smg' ? 0.5 : 0.75;
  part(g, steel, 0, 0, -len / 2, 0.06, 0.09, len);
  part(g, steel, 0, -0.08, -0.18, 0.04, 0.1, 0.06);
  return g;
}

// The grenade in hand: a small canister, coloured band per type.
export function buildGrenadeModel(type) {
  const g = new THREE.Group();
  const band = new THREE.MeshLambertMaterial({ color: type === 'frag' ? PALETTE.danger : type === 'flash' ? PALETTE.ink : PALETTE.muted });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 10), steel);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.03, 10), band);
  stripe.position.y = 0.02;
  g.add(body, stripe);
  return g;
}
