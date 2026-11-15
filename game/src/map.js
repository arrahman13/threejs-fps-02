// The map: LOWTIDE yard, a container port at dusk. One module owns the layout
// data (solid boxes, sites, spawns, the waypoint graph) and the scenery built
// from it, so the collision the simulation uses is the geometry the player
// sees. Everything is axis-aligned boxes: cheap to collide, cheap to raycast.
import * as THREE from 'three';
import { PALETTE, CONTAINER_PAINTS } from './palette.js';

export const BOUNDS = { x: 34, z: 24 };
export const SITES = {
  A: { x: 24, z: -15, r: 5.5, name: 'Fuel Farm' },
  B: { x: 24, z: 15, r: 5.5, name: 'Crane Pad' },
};
export const SPAWNS = {
  atk: [[-30, -4], [-31, -1.5], [-30, 1], [-31, 3.5], [-29, 5.5]],
  def: [[30, -4], [31, -1.5], [30, 1], [31, 3.5], [29, 5.5]],
};

// Waypoints the bots walk: lanes west to east, two sites, and the connectors
// between them. Tags name the spots tactics refer to.
// Waypoints, each placed in verified-open ground (a node inside a crate's
// collision margin is a node no bot can ever reach). Edges are not authored
// by hand: buildGraph connects every pair within 17 m whose straight walk
// stays clear of the solids, tested with the same rule collision uses — so
// the graph can never promise a walk the map does not allow.
const NODE_DEFS = [
  [-29, 0, 'spawnAtk'], [-21, 0, 'west'], [-20, -16, 'lane'], [-5, -13.5, 'lane'], [6, -15, 'lane'],
  [4, -3.5, 'link'], [-16, -7, 'mid'], [0, -7.5, 'mid'], [9, -7, 'mid'], [24, -5, 'approach'],
  [20.25, -11.3, 'siteA'], [24, -15, 'siteA'], [25.5, -17.5, 'holdA'], [29, 0, 'spawnDef'], [14, -1, 'east'],
  [9, 7, 'mid'], [24, 5, 'approach'], [24, 15, 'siteB'], [20, 13, 'siteB'], [27.5, 12.5, 'holdB'],
  [6, 15, 'lane'], [-5, 13.5, 'lane'], [-20, 16, 'lane'], [-16, 7, 'mid'], [6, 7, 'link'],
  [-9, 12, 'drop'], [-9, -12, 'drop'], [24, -8, 'siteA'], [24, 8, 'siteB'], [16, 4, 'east'],
  [20, -6, 'east'], [20, 6, 'east'], [-26, -11, 'gate'], [-26, 11, 'gate'], [13, -15, 'lane'], [13, 15, 'lane'],
];

function buildGraph(solids) {
  const nodes = NODE_DEFS.map(([x, z, tag]) => ({ x, z, tag, edges: [] }));
  const blocked = (x, z) => solids.some((s) => (s.y1 - s.y0) > 0.55 && s.y0 < 1.2
    && x > s.x0 - 0.36 && x < s.x1 + 0.36 && z > s.z0 - 0.36 && z < s.z1 + 0.36);
  for (let a = 0; a < nodes.length; a += 1) {
    for (let b = a + 1; b < nodes.length; b += 1) {
      const A = nodes[a]; const B = nodes[b];
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      if (len > 19) continue;
      const steps = Math.ceil(len / 0.3);
      let clear = true;
      for (let k = 1; k < steps; k += 1) {
        const t = k / steps;
        if (blocked(A.x + (B.x - A.x) * t, A.z + (B.z - A.z) * t)) { clear = false; break; }
      }
      if (clear) { A.edges.push(b); B.edges.push(a); }
    }
  }
  // All-pairs next hop by breadth-first search: 36 nodes, done once at boot.
  const nextHop = nodes.map((_, from) => {
    const hop = new Array(nodes.length).fill(-1);
    const seen = new Array(nodes.length).fill(false);
    const queue = [from];
    seen[from] = true;
    hop[from] = from;
    while (queue.length) {
      const cur = queue.shift();
      for (const next of nodes[cur].edges) {
        if (seen[next]) continue;
        seen[next] = true;
        hop[next] = cur === from ? next : hop[cur];
        queue.push(next);
      }
    }
    return hop;
  });
  return { nodes, nextHop };
}

export function createMap(scene) {
  const solids = [];
  const addSolid = (cx, cz, w, d, h, y0 = 0) => {
    const s = { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0, y1: y0 + h };
    solids.push(s);
    return s;
  };

  // ---- layout: the same boxes the scenery draws -----------------------------
  // Perimeter container rows (the yard's fence line, with the spawns inside).
  for (const s of [-1, 1]) {
    addSolid(-26, s * 22, 14, 3, 2.6); addSolid(-8, s * 22, 16, 3, 2.6);
    addSolid(10, s * 22, 16, 3, 2.6); addSolid(26, s * 22, 14, 3, 2.6);
  }
  // Lane divider walls, with the drop and link gaps the waypoint graph uses.
  for (const s of [-1, 1]) {
    addSolid(-18, s * 11, 10, 2.6, 2.6); addSolid(-2, s * 11, 8, 2.6, 2.6); addSolid(12, s * 11, 10, 2.6, 2.6);
    addSolid(-12, s * 16, 9, 2.6, 2.6); // the lane's own centre cover
  }
  // Mid stacks and the east-yard approach containers.
  addSolid(-8, -5, 9, 2.6, 5.2); addSolid(-8, 5, 9, 2.6, 2.6);
  addSolid(10, 0, 2.6, 9, 2.6);
  addSolid(18, -8, 8, 2.6, 2.6); addSolid(18, 8, 8, 2.6, 2.6);
  addSolid(28, -20, 10, 3, 5.2); // double stack behind the Fuel Farm
  // The dock platform at mid: a step, then the deck (a height to hold).
  addSolid(-4.75, 2, 2.5, 6, 0.45); addSolid(1, 2, 8, 6, 0.9);
  // Crates: low cover, some stacked.
  const crates = [[4, -7, 2, 1.1], [-3, 9, 2, 1.1], [14, -6, 2, 1.1], [14, 6, 2, 1.1], [-14, 2, 2, 2.2],
    [-16, -4, 3, 1.1], [16, -2, 2, 1.1], [2, -17, 2, 1.1], [2, 17, 2, 1.1], [-1, 2, 2, 1.1]];
  for (const [x, z, w, h] of crates) addSolid(x, z, w, w, h);
  // Site A dressing: drum clusters and low barriers (drums collide as boxes).
  for (const [x, z] of [[21, -18], [22.5, -18], [26, -12], [27.5, -12.5], [24, -19.5]]) addSolid(x, z, 1.3, 1.3, 1.6);
  addSolid(19, -17, 1, 4, 1.1); addSolid(25, -10.3, 4, 1, 1.1); // site A's fences, placed so the south-west gap stays a real entry
  // Site B dressing: crane legs and crates under the crane.
  for (const [x, z] of [[19.5, 10.5], [28.5, 10.5], [19.5, 19.5], [28.5, 19.5]]) addSolid(x, z, 0.7, 0.7, 7);
  addSolid(24, 15, 11, 1.4, 1, 6.8); // the crane beam, overhead
  addSolid(22, 13, 2.4, 2.4, 1.1); addSolid(26, 17.5, 2, 2, 2.2); addSolid(29.3, 15, 1, 5, 1.1);
  // Spawn cover so a rushed spawn is not a shooting gallery.
  addSolid(-33, 0, 1.2, 10, 2.6); addSolid(33, 0, 1.2, 10, 2.6);

  const graph = buildGraph(solids);

  // ---- queries the simulation runs every step -------------------------------
  function rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    if (dy < -1e-6) { const t = -oy / dy; if (t > 0 && t < best) best = t; } // the ground
    for (let i = 0; i < solids.length; i += 1) {
      const s = solids[i];
      let t0 = 0; let t1 = best;
      if (Math.abs(dx) < 1e-8) { if (ox < s.x0 || ox > s.x1) continue; }
      else {
        let ta = (s.x0 - ox) / dx; let tb = (s.x1 - ox) / dx;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue;
      }
      if (Math.abs(dy) < 1e-8) { if (oy < s.y0 || oy > s.y1) continue; }
      else {
        let ta = (s.y0 - oy) / dy; let tb = (s.y1 - oy) / dy;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-8) { if (oz < s.z0 || oz > s.z1) continue; }
      else {
        let ta = (s.z0 - oz) / dz; let tb = (s.z1 - oz) / dz;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue;
      }
      if (t0 < best && t0 > 0) best = t0;
    }
    return best;
  }

  function los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax; const dy = by - ay; const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return rayHit(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05) >= len - 0.05;
  }

  function groundAt(x, z, feetY) {
    let ground = 0;
    for (let i = 0; i < solids.length; i += 1) {
      const s = solids[i];
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && s.y1 <= feetY + 0.55 && s.y1 > ground) ground = s.y1;
    }
    return ground;
  }

  // Push a vertical cylinder (centre x/z, feet y) out of every solid it overlaps.
  function collide(pos, radius, height) {
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < solids.length; i += 1) {
        const s = solids[i];
        if (s.y1 <= pos.y + 0.3 || s.y0 >= pos.y + height) continue; // steps and overhead pass
        const nx = Math.max(s.x0, Math.min(pos.x, s.x1));
        const nz = Math.max(s.z0, Math.min(pos.z, s.z1));
        let dx = pos.x - nx; let dz = pos.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 < 1e-8) { // centre inside the box: leave by the shallowest face
          const left = pos.x - s.x0; const right = s.x1 - pos.x;
          const near = pos.z - s.z0; const far = s.z1 - pos.z;
          const min = Math.min(left, right, near, far);
          if (min === left) pos.x = s.x0 - radius; else if (min === right) pos.x = s.x1 + radius;
          else if (min === near) pos.z = s.z0 - radius; else pos.z = s.z1 + radius;
          continue;
        }
        const d = Math.sqrt(d2);
        dx /= d; dz /= d;
        pos.x = nx + dx * radius;
        pos.z = nz + dz * radius;
      }
    }
    pos.x = Math.max(-BOUNDS.x + radius, Math.min(BOUNDS.x - radius, pos.x));
    pos.z = Math.max(-BOUNDS.z + radius, Math.min(BOUNDS.z - radius, pos.z));
  }

  function nearestNode(x, z) {
    let best = 0; let bd = Infinity;
    for (let i = 0; i < graph.nodes.length; i += 1) {
      const n = graph.nodes[i];
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function siteAt(x, z) {
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      if ((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) <= s.r * s.r) return key;
    }
    return null;
  }

  buildScenery(scene, solids);
  return { solids, rayHit, los, groundAt, collide, nearestNode, siteAt, nodes: graph.nodes, nextHop: graph.nextHop };
}

// ---- scenery: built from the same box list the simulation collides with ----
function containerTexture(paint, label) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = paint; g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (let x = 8; x < 256; x += 18) g.fillRect(x, 6, 7, 116); // corrugation ribs
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, 256, 8); g.fillRect(0, 120, 256, 8);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.font = 'bold 26px monospace'; g.fillText(label, 22, 52);
  g.font = '13px monospace'; g.fillText('LOWTIDE LINES', 22, 76);
  g.fillText('MAX 30480 KG', 22, 96);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 720;
  const g = c.getContext('2d');
  const px = (x) => ((x + 40) / 80) * 1024;
  const pz = (z) => ((z + 28) / 56) * 720;
  g.fillStyle = '#6f6a61'; g.fillRect(0, 0, 1024, 720);
  for (let i = 0; i < 9000; i += 1) { // concrete speckle
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    g.fillRect(Math.random() * 1024, Math.random() * 720, 2, 2);
  }
  g.fillStyle = 'rgba(0,0,0,0.10)';
  g.fillRect(px(-24), pz(-21), px(34) - px(-24), pz(-12.5) - pz(-21)); // lane aprons
  g.fillRect(px(-24), pz(12.5), px(34) - px(-24), pz(21) - pz(12.5));
  g.strokeStyle = 'rgba(236,231,219,0.5)'; g.lineWidth = 2; g.setLineDash([14, 12]);
  g.beginPath(); g.moveTo(px(-24), pz(-16)); g.lineTo(px(17), pz(-16)); g.stroke();
  g.beginPath(); g.moveTo(px(-24), pz(16)); g.lineTo(px(17), pz(16)); g.stroke();
  g.setLineDash([]);
  for (const [site, label] of [[SITES.A, 'A'], [SITES.B, 'B']]) { // site rings and letters
    g.strokeStyle = PALETTE.accent; g.lineWidth = 5;
    g.beginPath(); g.arc(px(site.x), pz(site.z), (site.r / 80) * 1024, 0, Math.PI * 2); g.stroke();
    g.fillStyle = PALETTE.accent;
    g.font = 'bold 64px system-ui'; g.textAlign = 'center';
    g.fillText(label, px(site.x), pz(site.z) + 22);
  }
  g.fillStyle = 'rgba(242,163,60,0.85)'; // hazard stripes at the fuel farm
  for (let i = 0; i < 8; i += 1) g.fillRect(px(19.5) + i * 14, pz(-20.5), 7, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildScenery(scene, solids) {
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 56), lambert({ map: groundTexture() }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const paintMats = CONTAINER_PAINTS.map((paint, i) => lambert({ map: containerTexture(paint, `LT-${2100 + i * 137}`) }));
  const steel = lambert({ color: PALETTE.hairline });
  const darkSteel = lambert({ color: '#232a31' });
  const crateMat = lambert({ color: '#8a6f47' });
  const drumMat = lambert({ color: '#b3542e' });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  let paintIndex = 0;
  for (const s of solids) {
    const w = s.x1 - s.x0; const d = s.z1 - s.z0; const h = s.y1 - s.y0;
    if (s.y0 > 3) continue; // the crane beam is drawn by hand below
    let mat = steel;
    if (h >= 2.2 && (w >= 7.5 || d >= 7.5)) { mat = paintMats[paintIndex % paintMats.length]; paintIndex += 1; }
    else if (h <= 1.7 && w <= 3.2 && d <= 3.2 && s.y0 === 0) mat = (w <= 1.4 && h >= 1.5) ? drumMat : crateMat;
    else if (h >= 6) mat = darkSteel;
    const mesh = new THREE.Mesh(boxGeo, mat);
    mesh.position.set((s.x0 + s.x1) / 2, s.y0 + h / 2, (s.z0 + s.z1) / 2);
    mesh.scale.set(w, h, d);
    mesh.castShadow = h > 1;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // The crane over site B: beam, trolley and a hanging hook block.
  const crane = new THREE.Group();
  const beam = new THREE.Mesh(boxGeo, darkSteel);
  beam.scale.set(11.5, 1, 1.6); beam.position.set(24, 7.3, 15); beam.castShadow = true;
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4), darkSteel);
  cable.position.set(26, 5.2, 15);
  const hook = new THREE.Mesh(boxGeo, lambert({ color: PALETTE.accent }));
  hook.scale.set(0.9, 0.9, 0.9); hook.position.set(26, 3.3, 15); hook.castShadow = true;
  crane.add(beam, cable, hook);
  scene.add(crane);

  // A fuel tank lying by site A.
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 6, 14), drumMat);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(24, 1.5, -20.6);
  tank.castShadow = true;
  scene.add(tank);

  // Lamp posts: a pole, a warm head, a real point light and a fake glow cone.
  const lampLight = lambert({ color: PALETTE.accent, emissive: '#f2a33c', emissiveIntensity: 1.4 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xf2a33c, transparent: true, opacity: 0.07, depthWrite: false });
  for (const [x, z] of [[-20, -8], [0, 10], [16, -12], [16, 12], [-14, 0]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4), darkSteel);
    pole.position.set(x, 2.7, z);
    const head = new THREE.Mesh(boxGeo, lampLight);
    head.scale.set(0.7, 0.18, 0.4); head.position.set(x, 5.45, z);
    const glow = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5.2, 12, 1, true), glowMat);
    glow.position.set(x, 2.8, z);
    const light = new THREE.PointLight(0xffa64d, 60, 20, 1.8);
    light.position.set(x, 5.2, z);
    scene.add(pole, head, glow, light);
  }

  // Distant port silhouettes against the dusk: two far cranes and a hull.
  const silhouette = lambert({ color: '#1b2129' });
  for (const [x, z, w, h] of [[-52, -30, 4, 26], [-44, -30, 18, 3], [54, 26, 4, 22], [46, 26, 16, 3], [0, -44, 90, 7], [-58, 8, 26, 9]]) {
    const m = new THREE.Mesh(boxGeo, silhouette);
    m.scale.set(w, h, 3); m.position.set(x, h / 2, z);
    scene.add(m);
  }
}
