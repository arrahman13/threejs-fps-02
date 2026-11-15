// Every sound is synthesized with WebAudio: no audio files, nothing fetched.
// Gunfire is a filtered noise burst, beeps are square blips, the explosion is a
// noise boom over a falling sine. Distant shots are quieter and darker, so a
// firefight across the yard sounds across the yard.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function noise(at, dur, gain, freq, type = 'lowpass') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(at, Math.random() * 0.2);
    src.stop(at + dur + 0.02);
  }

  function tone(at, dur, gain, freq, endFreq, type = 'square') {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  // Volume and filter darkness from the listener's distance to a world sound.
  function falloff(dist) { return 1 / (1 + dist * 0.09); }

  return {
    unlock() { ensure(); },
    get ready() { return !!ctx; },
    shot(kind, dist = 0) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const v = falloff(dist);
      if (kind === 'sniper') { noise(t, 0.5, 0.9 * v, 900 + 2400 * v); tone(t, 0.3, 0.4 * v, 160, 40, 'sawtooth'); }
      else if (kind === 'shotgun') { noise(t, 0.35, 0.85 * v, 700 + 1800 * v); tone(t, 0.2, 0.35 * v, 130, 50, 'sawtooth'); }
      else if (kind === 'smg') { noise(t, 0.13, 0.5 * v, 1200 + 2600 * v); }
      else if (kind === 'pistol') { noise(t, 0.16, 0.55 * v, 1100 + 2400 * v); }
      else { noise(t, 0.22, 0.7 * v, 1000 + 2200 * v); tone(t, 0.1, 0.2 * v, 190, 70, 'sawtooth'); }
    },
    dryFire() { if (ensure()) tone(ctx.currentTime, 0.05, 0.15, 1400, 900); },
    reload() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(t, 0.05, 0.2, 500, 300);
      tone(t + 0.28, 0.05, 0.25, 700, 400);
      tone(t + 0.55, 0.06, 0.3, 900, 500);
    },
    hit(head) {
      if (!ensure()) return;
      tone(ctx.currentTime, head ? 0.16 : 0.07, 0.3, head ? 1560 : 2100, head ? 1560 : 1800, 'sine');
    },
    kill() { if (ensure()) { const t = ctx.currentTime; tone(t, 0.09, 0.25, 880, 880, 'sine'); tone(t + 0.09, 0.14, 0.25, 1320, 1320, 'sine'); } },
    hurt() { if (ensure()) noise(ctx.currentTime, 0.18, 0.4, 400); },
    step(dist) { if (ensure()) noise(ctx.currentTime, 0.07, 0.1 * falloff(dist), 500); },
    throwWhoosh() { if (ensure()) noise(ctx.currentTime, 0.25, 0.2, 900, 'bandpass'); },
    bounce() { if (ensure()) tone(ctx.currentTime, 0.05, 0.15, 300, 180); },
    explosion(big = true) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, big ? 1.4 : 0.7, 1.0, 500);
      tone(t, big ? 1.1 : 0.6, 0.7, 120, 30, 'sine');
    },
    flashRing() { if (ensure()) tone(ctx.currentTime, 1.4, 0.12, 5200, 4800, 'sine'); },
    beep(final = false) { if (ensure()) tone(ctx.currentTime, final ? 0.4 : 0.09, 0.3, final ? 1320 : 990, 0, 'square'); },
    defuseTick() { if (ensure()) tone(ctx.currentTime, 0.05, 0.2, 660, 660, 'square'); },
    buy(ok) { if (ensure()) tone(ctx.currentTime, 0.08, 0.25, ok ? 1180 : 220, ok ? 1180 : 160, 'square'); },
    roundEnd(won) {
      if (!ensure()) return;
      const t = ctx.currentTime;
      const notes = won ? [523, 659, 784] : [392, 330, 262];
      notes.forEach((f, i) => tone(t + i * 0.13, 0.22, 0.22, f, 0, 'triangle'));
    },
    plantStart() { if (ensure()) tone(ctx.currentTime, 0.1, 0.25, 740, 740, 'square'); },
  };
}
