// The HUD: DOM elements declared in index.html, updated from game state once
// per frame, plus the transient layer driven by events — killfeed, hitmarker,
// damage direction, flash overlay, round banners and the buy menu. All text
// writes are change-cached so a steady frame touches nothing.
import { WEAPONS, GRENADES, ARMOR_PRICE, currentSlot } from './weapons.js';
import { SITES } from './map.js';

const $ = (id) => document.getElementById(id);

const REASON_TEXT = {
  elimination: 'team eliminated',
  detonation: 'the charge went off',
  defused: 'the charge was defused',
  time: 'time ran out',
};

export function createHud(S, callbacks) {
  const el = {
    hud: $('hud'), health: $('health'), armor: $('armor'), ammo: $('ammo'), reserve: $('reserve'),
    weapon: $('weapon-name'), money: $('money'), timer: $('timer'), score: $('score'),
    pips: $('pips'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    killfeed: $('killfeed'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    channel: $('channel'), channelFill: $('channel-fill'), channelLabel: $('channel-label'),
    vignette: $('vignette'), dmgdir: $('dmgdir'), flash: $('flash-overlay'), scope: $('scope'),
    chargeTag: $('charge-tag'), minimap: $('minimap'), hint: $('hint'), buy: $('buy'),
    buyItems: $('buy-items'), buyMoney: $('buy-money'), scoreboard: $('scoreboard'),
  };
  const cache = new Map();
  const setText = (node, key, value) => {
    if (cache.get(key) !== value) { cache.set(key, value); node.textContent = value; }
  };
  let hitmarkUntil = 0;
  let bannerUntil = 0;
  let lastHealth = 100;
  let buyOpen = false;
  const feed = [];

  function showBanner(title, sub, seconds) {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub || '';
    el.banner.style.opacity = '1';
    bannerUntil = S.time + seconds;
  }

  function addFeed(html, color) {
    const div = document.createElement('div');
    div.className = 'feed-line';
    div.style.color = color;
    div.innerHTML = html;
    el.killfeed.appendChild(div);
    feed.push({ div, until: S.time + 6 });
    while (el.killfeed.children.length > 5) el.killfeed.removeChild(el.killfeed.firstChild);
  }

  function consume() {
    for (const ev of S.events) {
      if (ev.type === 'hit' && ev.shooter === S.player) {
        hitmarkUntil = S.time + 0.14;
        el.hitmarker.className = ev.killed ? 'show kill' : 'show';
      } else if (ev.type === 'kill') {
        const killer = ev.attacker ? ev.attacker.name : 'the charge';
        const color = ev.victim === S.player ? '#ff7a5c' : ev.victim.team === 'def' ? '#9fc3e8' : '#ffb38a';
        addFeed(`${killer} ▸ ${ev.victim.name}${ev.part === 'head' ? ' ⌖' : ''}`, color);
        if (ev.victim === S.player) showBanner('You are down', 'Your team fights on — watch the round out.', 3);
      } else if (ev.type === 'roundStart') {
        showBanner(`Round ${S.round}`, S.player.hasCharge ? 'You carry the breach charge. Plant it at A or B.' : 'Buy phase — press B to shop.', 2.6);
      } else if (ev.type === 'roundLive') {
        showBanner('Round live', `Plant site ${S.plan.site} is the call — or improvise.`, 1.6);
      } else if (ev.type === 'planted') {
        showBanner('Charge planted', `Site ${ev.site} — hold it for 35 seconds.`, 2.4);
      } else if (ev.type === 'roundEnd') {
        const won = (ev.winner === 'atk') === (S.player.team === 'atk');
        showBanner(won ? 'Round won' : 'Round lost', REASON_TEXT[ev.reason] || '', 3.6);
      } else if (ev.type === 'matchEnd') {
        const won = ev.winner === S.player.team;
        showBanner(ev.winner === 'draw' ? 'Match drawn' : won ? 'Match won' : 'Match lost',
          `Final score — Breakers ${S.scoreAtk} : ${S.scoreDef} Wardens`, 30);
      } else if (ev.type === 'damage' && ev.victim === S.player && ev.attacker) {
        const rel = Math.atan2(-(ev.attacker.pos.x - S.player.pos.x), -(ev.attacker.pos.z - S.player.pos.z));
        const deg = ((S.player.yaw - rel) * 180 / Math.PI + 360) % 360;
        el.dmgdir.style.transform = `rotate(${deg}deg)`;
        el.dmgdir.style.opacity = '1';
        el.dmgdir.dataset.until = String(S.time + 0.9);
      }
    }
  }

  // --- buy menu ------------------------------------------------------------
  const BUY_LIST = [
    ['smg', '1'], ['shotgun', '2'], ['rifle', '3'], ['sniper', '4'],
    ['armor', '5'], ['frag', '6'], ['flash', '7'], ['smoke', '8'],
  ];
  function itemName(id) {
    if (id === 'armor') return 'Armour + helmet';
    if (WEAPONS[id]) return WEAPONS[id].name;
    return GRENADES[id].name;
  }
  function itemPrice(id) {
    if (id === 'armor') return ARMOR_PRICE;
    if (WEAPONS[id]) return WEAPONS[id].price;
    return GRENADES[id].price;
  }
  function itemOwned(id) {
    const l = S.player.loadout;
    if (id === 'armor') return l.armor;
    if (WEAPONS[id]) return l.primary && l.primary.def.id === id;
    return l.grenades[id] >= 2;
  }
  function renderBuy() {
    setText(el.buyMoney, 'buy-money', `$${S.player.money}`);
    el.buyItems.innerHTML = '';
    for (const [id, key] of BUY_LIST) {
      const row = document.createElement('button');
      row.className = 'buy-row';
      const owned = itemOwned(id);
      const afford = S.player.money >= itemPrice(id);
      row.disabled = owned || !afford;
      row.innerHTML = `<span class="buy-key">${key}</span><span class="buy-name">${itemName(id)}</span><span class="buy-price">${owned ? 'owned' : `$${itemPrice(id)}`}</span>`;
      row.addEventListener('click', () => { callbacks.buy(id); renderBuy(); });
      el.buyItems.appendChild(row);
    }
  }
  function setBuy(open) {
    buyOpen = open && S.phase === 'buy';
    el.buy.style.display = buyOpen ? 'block' : 'none';
    if (buyOpen) renderBuy();
  }
  window.addEventListener('keydown', (e) => {
    if (!buyOpen) return;
    const hit = BUY_LIST.find(([, key]) => key === e.key);
    if (hit) { callbacks.buy(hit[0]); renderBuy(); }
    if (e.key === 'Escape') setBuy(false);
  });

  // --- minimap ---------------------------------------------------------------
  const mm = el.minimap.getContext('2d');
  const MM = 168;
  const toMap = (x, z) => [((x + 34) / 68) * MM, ((z + 24) / 48) * MM];
  function drawMinimap() {
    mm.fillStyle = 'rgba(16,20,25,0.82)';
    mm.fillRect(0, 0, MM, MM);
    mm.fillStyle = 'rgba(120,135,150,0.5)';
    for (const s of S.map.solids) {
      if (s.y1 - s.y0 < 1.2) continue;
      const [x0, z0] = toMap(s.x0, s.z0);
      const [x1, z1] = toMap(s.x1, s.z1);
      mm.fillRect(x0, z0, x1 - x0, z1 - z0);
    }
    for (const key of ['A', 'B']) {
      const site = SITES[key];
      const [x, y] = toMap(site.x, site.z);
      mm.strokeStyle = '#f2a33c';
      mm.beginPath(); mm.arc(x, y, site.r / 68 * MM, 0, 7); mm.stroke();
      mm.fillStyle = '#f2a33c';
      mm.fillText(key, x - 3, y + 3);
    }
    if (S.bomb.state !== 'carried') {
      const [x, y] = toMap(S.bomb.x, S.bomb.z);
      mm.fillStyle = '#ff5544';
      mm.fillRect(x - 2, y - 2, 4, 4);
    }
    for (const a of S.actors) {
      if (!a.alive) continue;
      const [x, y] = toMap(a.pos.x, a.pos.z);
      if (a === S.player) {
        mm.save();
        mm.translate(x, y);
        mm.rotate(-a.yaw); // map x→right, z→down; the arrow is drawn pointing up
        mm.fillStyle = '#ece7db';
        mm.beginPath(); mm.moveTo(0, -5); mm.lineTo(3.5, 4); mm.lineTo(-3.5, 4); mm.closePath(); mm.fill();
        mm.restore();
      } else if (a.team === S.player.team) {
        mm.fillStyle = '#e8873a';
        mm.beginPath(); mm.arc(x, y, 2.4, 0, 7); mm.fill();
      }
    }
    // Recent enemy noise the player could hear shows as a fading blip.
    for (const n of S.noise) {
      if (n.team === S.player.team) continue;
      const age = S.time - n.at;
      if (age > 1.1) continue;
      const [x, y] = toMap(n.x, n.z);
      mm.fillStyle = `rgba(255,90,70,${0.75 * (1 - age / 1.1)})`;
      mm.beginPath(); mm.arc(x, y, 3, 0, 7); mm.fill();
    }
  }

  // --- per-frame refresh ------------------------------------------------------
  function refresh() {
    const p = S.player;
    const inGame = S.phase !== 'menu';
    el.hud.style.display = inGame ? 'block' : 'none';
    if (!inGame) return;
    setText(el.health, 'hp', `${Math.max(0, Math.ceil(p.health))}`);
    el.health.style.color = p.health <= 30 ? '#ff7a5c' : '';
    setText(el.armor, 'arm', p.loadout.armor ? '▣ ARMOUR' : '');
    const slot = currentSlot(p.loadout);
    if (p.loadout.slot === 'grenade') {
      setText(el.weapon, 'wpn', GRENADES[p.loadout.grenadeType].name);
      setText(el.ammo, 'ammo', `${p.loadout.grenades[p.loadout.grenadeType]}`);
      setText(el.reserve, 'res', '');
    } else if (slot) {
      setText(el.weapon, 'wpn', slot.def.name);
      setText(el.ammo, 'ammo', slot.reloadEndAt > S.time ? '——' : `${slot.mag}`);
      setText(el.reserve, 'res', `/ ${slot.reserve}`);
    }
    setText(el.money, 'money', `$${p.money}`);
    const t = Math.max(0, Math.ceil(S.phase === 'planted' ? S.bomb.timer : S.timeLeft));
    setText(el.timer, 'timer', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    el.timer.style.color = t <= 10 ? '#ff7a5c' : '';
    setText(el.score, 'score', `BREAKERS ${S.scoreAtk} — ${S.scoreDef} WARDENS · ROUND ${S.round}`);
    const atkAlive = S.actors.filter((a) => a.alive && a.team === 'atk').length;
    const defAlive = S.actors.filter((a) => a.alive && a.team === 'def').length;
    setText(el.pips, 'pips', `${'●'.repeat(atkAlive)}${'○'.repeat(5 - atkAlive)}   ${'●'.repeat(defAlive)}${'○'.repeat(5 - defAlive)}`);
    el.chargeTag.style.display = p.hasCharge ? 'block' : 'none';

    // Crosshair gap follows the shooter's real spread.
    const gap = 6 + (p.bloom || 0) * 260 + p.speed2d * 2.2;
    el.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    el.crosshair.style.opacity = p.alive && !S.scoped ? '1' : '0';
    el.hitmarker.className = S.time < hitmarkUntil ? el.hitmarker.className : '';
    if (S.time > bannerUntil) el.banner.style.opacity = '0';
    for (let i = feed.length - 1; i >= 0; i -= 1) {
      if (S.time > feed[i].until) { feed[i].div.remove(); feed.splice(i, 1); }
    }
    if (el.dmgdir.dataset.until && S.time > Number(el.dmgdir.dataset.until)) el.dmgdir.style.opacity = '0';
    el.vignette.style.opacity = p.health < 100 && p.alive ? String(0.55 * (1 - p.health / 100)) : '0';
    const blind = Math.max(0, p.blindUntil - S.time);
    el.flash.style.opacity = blind > 0 ? String(Math.min(1, blind / 1.2)) : '0';
    el.scope.style.display = S.scoped && p.alive ? 'block' : 'none';

    if (S.channel && (S.channel.actor === p)) {
      el.channel.style.display = 'block';
      const pct = Math.min(100, (S.channel.progress / S.channel.need) * 100);
      el.channelFill.style.width = `${pct}%`;
      setText(el.channelLabel, 'chan', S.channel.kind === 'plant' ? 'PLANTING THE CHARGE…' : 'DEFUSING…');
    } else if (S.phase === 'live' && p.hasCharge && S.map.siteAt(p.pos.x, p.pos.z)) {
      el.channel.style.display = 'block';
      el.channelFill.style.width = '0%';
      setText(el.channelLabel, 'chan', 'Hold E to plant the charge');
    } else {
      el.channel.style.display = 'none';
    }
    setText(el.hint, 'hint', S.phase === 'buy' ? 'B — buy menu · weapons refill every round' : '');
    if (buyOpen && S.phase !== 'buy') setBuy(false);
    if (buyOpen) setText(el.buyMoney, 'buy-money', `$${p.money}`);
    drawMinimap();
    // Scoreboard while Tab is held (main toggles its display).
    if (el.scoreboard.style.display === 'block') {
      const rows = [...S.actors].sort((a, b) => b.kills - a.kills)
        .map((a) => `<tr class="${a.team}"><td>${a.name}${a === p ? ' (you)' : ''}</td><td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td></tr>`).join('');
      el.scoreboard.innerHTML = `<table><tr><th>LOWTIDE — first to 7</th><th>K</th><th>D</th><th>$</th></tr>${rows}</table>`;
    }
  }

  return { consume, refresh, setBuy, isBuyOpen: () => buyOpen, showBanner };
}
