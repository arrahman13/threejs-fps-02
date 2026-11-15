// Keyboard and mouse state, and the pointer lock the game plays under. Input
// only records; the player controller reads the state once per fixed step, so
// the simulation never depends on event timing.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set(); // keys that went down since the last step read them
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let aiming = false;
  let locked = false;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    keys.add(event.code);
    pressed.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); firing = false; aiming = false; });

  canvas.addEventListener('mousedown', (event) => {
    if (!locked) return;
    if (event.button === 0) firing = true;
    if (event.button === 2) aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) firing = false;
    if (event.button === 2) aiming = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('mousemove', (event) => {
    if (!locked) return;
    lookX += event.movementX || 0;
    lookY += event.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) { firing = false; aiming = false; }
    onLockChange(locked);
  });

  return {
    keys,
    get locked() { return locked; },
    get firing() { return firing; },
    get aiming() { return aiming; },
    // One-shot key reads for the step loop: true once per physical press.
    takePressed(code) {
      const hit = pressed.has(code);
      if (hit) pressed.delete(code);
      return hit;
    },
    clearPressed() { pressed.clear(); },
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    requestLock() { canvas.requestPointerLock(); },
    releaseLock() { if (locked) document.exitPointerLock(); },
  };
}
