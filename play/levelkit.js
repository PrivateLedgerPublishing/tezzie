/* Tezzie level kit
   Tile legend, map parser, route checker, random course generator and share codes.
   Runs in the browser (window.TezzieKit) and in Node (require('./levelkit.js')). */
(function (root) {
  'use strict';

  const TILE = 16, MAX_W = 256, MAX_H = 64, MIN_W = 8, MIN_H = 6;

  // Every tile a level can use. Order here is the editor palette order.
  const TILES = {
    '#': { name: 'Rock wall', group: 'Build', tip: 'Solid rock. A slow bump bounces you off; a fast hit wrecks the ship.' },
    '%': { name: 'Cracked rock', group: 'Build', tip: 'Solid until shot apart. Needs a weapon, so World 2 and up.' },
    'S': { name: 'Start', group: 'Build', tip: 'Where the ship launches. One per level, with a 2x2 open space.' },
    'E': { name: 'Exit gate', group: 'Build', tip: 'Fly through any exit to finish. Needs a 2x2 open space.' },
    'C': { name: 'Checkpoint', group: 'Build', tip: 'Touch it to respawn here after a crash.' },
    '*': { name: 'Energy core', group: 'Pickups', tip: 'Collect every core for the second star.' },
    '+': { name: 'Fuel canister', group: 'Pickups', tip: 'Adds 4 seconds of thrust when the level has a fuel limit.' },
    'k': { name: 'Key', group: 'Pickups', tip: 'Any key opens every door in the level.' },
    'D': { name: 'Door', group: 'Pickups', tip: 'Solid until a key is collected.' },
    'o': { name: 'Small rock', group: 'Hazards', tip: 'Drifts and bounces off walls. Two hits to destroy.' },
    'O': { name: 'Big rock', group: 'Hazards', tip: 'Drifts slowly, takes six hits and splits in two.' },
    'M': { name: 'Mine', group: 'Hazards', tip: 'Arms when you get close and explodes half a second later. Shoot it from range.' },
    'l': { name: 'Laser A', group: 'Hazards', tip: 'Beam that is on while Laser B is off. Lines of lasers join into one beam.' },
    'L': { name: 'Laser B', group: 'Hazards', tip: 'Beam that is on while Laser A is off.' },
    'G': { name: 'Gravity well', group: 'Forces', tip: 'Pulls ships in from about 7 tiles away. The center is deadly.' },
    'R': { name: 'Repulsor', group: 'Forces', tip: 'Pushes ships away from about 5 tiles. Harmless to touch.' },
    '^': { name: 'Wind up', group: 'Forces', tip: 'Solar wind pushes ships upward on these tiles.' },
    'v': { name: 'Wind down', group: 'Forces', tip: 'Solar wind pushes ships downward.' },
    '<': { name: 'Wind left', group: 'Forces', tip: 'Solar wind pushes ships left.' },
    '>': { name: 'Wind right', group: 'Forces', tip: 'Solar wind pushes ships right.' },
    'W': { name: 'Wormhole', group: 'Forces', tip: 'Wormholes link in pairs in reading order: 1st with 2nd, 3rd with 4th.' },
    '.': { name: 'Space', group: 'Build', tip: 'Empty space.' }
  };
  // Kid-friendly names for the same tiles when a level uses the Orbit Ring look (theme: 'orbit').
  const ORBIT_NAMES = {
    '#': ['Hull panel', 'Glowing station wall. A slow bump bounces Tezzie off; a fast one is a bonk.'],
    '%': ['Static block', 'Zap it three times to clear it. Needs Spark Zap, so world 2 and up.'],
    'S': ['Start', 'Where Tezzie launches. One per level, with a 2x2 open space.'],
    'E': ['Charge ring', 'Fly into the green ring to finish. Needs a 2x2 open space.'],
    'C': ['Charge pylon', 'Touch it and a bonk sends Tezzie back here.'],
    '*': ['Spark', 'Collect every spark for the second star.'],
    '+': ['Battery', 'Adds 4 seconds of thrust when the level has a fuel limit.'],
    'k': ['Key card', 'Any key card switches off every force field.'],
    'D': ['Force field', 'Blocks the way until Tezzie grabs a key card.'],
    'o': ['Sootling', 'A grumpy smoke puff that drifts and bounces. Two zaps turn it into stardust.'],
    'O': ['Big Sootling', 'Drifts slowly, takes six zaps and splits in two.'],
    'M': ['Pop bubble', 'Wobbles when Tezzie gets close and pops half a second later. Zap it from far away.'],
    'l': ['Cyan gate', 'Light beam that is on while the pink gates are off.'],
    'L': ['Pink gate', 'Light beam that is on while the cyan gates are off.'],
    'G': ['Swirl', 'Pulls Tezzie in from about 7 tiles. Touching the middle is a bonk.'],
    'R': ['Bumper', 'Bounces Tezzie away from about 5 tiles. Safe to touch.'],
    '^': ['Breeze up', 'A golden solar breeze that pushes upward.'],
    'v': ['Breeze down', 'A golden solar breeze that pushes downward.'],
    '<': ['Breeze left', 'A golden solar breeze that pushes left.'],
    '>': ['Breeze right', 'A golden solar breeze that pushes right.'],
    'W': ['Warp ring', 'Warp rings link in pairs in reading order: 1st with 2nd, 3rd with 4th.'],
    '.': ['Space', 'Empty space.']
  };
  const THEMES = { classic: 'Classic deep space', orbit: 'Orbit Ring (kid-friendly)' };
  const VALID = '.#%SECk*+DoOMlLGR^v<>W';
  const VALID_RE = /[^.#%SECk*+DoOMlLGR^v<>W]/g;

  const WORLDS = [
    { vehicle: 'Roadster', weapon: 'No weapon' },
    { vehicle: 'Lunar Rover', weapon: 'Pebble Shot' },
    { vehicle: 'Crew Capsule', weapon: 'Twin Pulse' },
    { vehicle: 'Orbital Shuttle', weapon: 'Plasma Bolt' },
    { vehicle: 'Twin-Boost Lifter', weapon: 'Spread Cannon' },
    { vehicle: 'Heavy Hauler', weapon: 'Ion Orb' },
    { vehicle: 'Star Cruiser', weapon: 'Nova Torpedo' }
  ];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- map text ----------
  function rows(map) {
    let r = Array.isArray(map) ? map.slice() : String(map || '').split('\n');
    r = r.map(s => String(s).replace(/\r/g, '').trim());
    while (r.length && !r[0]) r.shift();
    while (r.length && !r[r.length - 1]) r.pop();
    r = r.slice(0, MAX_H);
    const w = Math.min(MAX_W, Math.max(0, ...r.map(s => s.length)));
    return r.map(s => (s.replace(/ /g, '.').replace(VALID_RE, '.') + '#'.repeat(w)).slice(0, w));
  }

  function parse(def) {
    const rs = rows(def.map), h = rs.length, w = h ? rs[0].length : 0;
    const g = rs.map(s => s.split(''));
    const L = { w, h, g, start: null, exits: [], checks: [], cores: [], fuel: [], keys: [], rocks: [], mines: [], wells: [], reps: [], worms: [] };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = g[y][x], p = { x, y };
      let take = true;
      switch (c) {
        case 'S': if (!L.start) L.start = p; break;
        case 'E': L.exits.push(p); break;
        case 'C': L.checks.push(p); break;
        case '*': L.cores.push(p); break;
        case '+': L.fuel.push(p); break;
        case 'k': L.keys.push(p); break;
        case 'o': L.rocks.push({ x, y, big: false }); break;
        case 'O': L.rocks.push({ x, y, big: true }); break;
        case 'M': L.mines.push(p); break;
        case 'G': L.wells.push(p); break;
        case 'R': L.reps.push(p); break;
        case 'W': L.worms.push(p); break;
        default: take = false;
      }
      if (take) g[y][x] = '.';
    }
    return L;
  }

  // ---------- route check ----------
  // The ship needs a 2x2-tile clear block to pass, so every tunnel must be at least 2 tiles wide.
  function route(L, armed) {
    const { w, h, g } = L;
    const pass = (x, y, open) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const c = g[y][x];
      if (c === '#') return false;
      if (c === '%') return armed;
      if (c === 'D') return open;
      return true;
    };
    const free = (x, y, open) => pass(x, y, open) && pass(x + 1, y, open) && pass(x, y + 1, open) && pass(x + 1, y + 1, open);
    const around = t => [[t.x - 1, t.y - 1], [t.x, t.y - 1], [t.x - 1, t.y], [t.x, t.y]];
    const seenTile = (seen, t) => around(t).some(([x, y]) => x >= 0 && y >= 0 && x < w && y < h && seen[y * w + x]);

    function bfs(open) {
      const seen = new Uint8Array(w * h), q = [];
      for (const [x, y] of around(L.start)) if (free(x, y, open)) { seen[y * w + x] = 1; q.push(x, y); }
      if (!q.length) return null;
      const link = new Map();
      for (let i = 0; i + 1 < L.worms.length; i += 2) {
        const a = L.worms[i], b = L.worms[i + 1];
        for (const [x, y] of around(a)) link.set(y * w + x, b);
        for (const [x, y] of around(b)) link.set(y * w + x, a);
      }
      let qi = 0;
      while (qi < q.length) {
        const x = q[qi++], y = q[qi++];
        const next = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        const to = link.get(y * w + x);
        if (to) for (const n of around(to)) next.push(n);
        for (const [nx, ny] of next) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (seen[k] || !free(nx, ny, open)) continue;
          seen[k] = 1; q.push(nx, ny);
        }
      }
      return seen;
    }

    let seen = bfs(false);
    if (!seen) return { ok: false, reason: 'The start (S) needs a 2x2 open space around it.' };
    let ok = L.exits.some(e => seenTile(seen, e)), usedKey = false;
    if (!ok && L.keys.some(k => seenTile(seen, k))) {
      const s2 = bfs(true);
      if (s2) { seen = s2; ok = L.exits.some(e => seenTile(seen, e)); usedKey = ok; }
    } else if (L.keys.some(k => seenTile(seen, k))) {
      const s2 = bfs(true); if (s2) seen = s2;
    }
    let reason = '';
    if (!ok) {
      const exitRoom = L.exits.some(e => around(e).some(([x, y]) => free(x, y, true)));
      reason = !exitRoom ? 'Every exit gate (E) needs a 2x2 open space around it.'
        : 'No route from the start to an exit. Tunnels must be at least 2 tiles wide' + (armed ? '.' : ', and World 1 ships cannot break cracked rock.');
    }
    const lost = list => list.filter(t => !seenTile(seen, t)).length;
    return { ok, reason, usedKey, seen, lostCores: lost(L.cores), lostKeys: lost(L.keys), lostChecks: lost(L.checks) };
  }

  function validate(def) {
    const errors = [], warnings = [];
    const raw = Array.isArray(def.map) ? def.map.join('\n') : String(def.map || '');
    const flat = raw.replace(/\s/g, '');
    const bad = [...new Set(flat.replace(/[.#%SECk*+DoOMlLGR^v<>W]/g, ''))];
    if (bad.length) warnings.push('Unknown tiles treated as space: ' + bad.join(' '));
    const L = parse(def);
    if (L.w < MIN_W || L.h < MIN_H) errors.push('Maps must be at least ' + MIN_W + ' tiles wide and ' + MIN_H + ' tall.');
    const count = ch => flat.split(ch).length - 1;
    if (!L.start) errors.push('Place a start (S).');
    if (count('S') > 1) warnings.push('Only the first start (S) is used.');
    if (!L.exits.length) errors.push('Place at least one exit gate (E).');
    if (L.worms.length % 2) warnings.push('Wormholes link in pairs. The last wormhole (W) has no partner.');
    if (count('D') && !L.keys.length) warnings.push('Doors (D) never open without a key (k).');
    const world = clamp(Math.round(+def.world || 1), 1, 7), armed = world >= 2;
    if (!armed && count('%')) warnings.push('World 1 has no weapon, so cracked rock (%) cannot be broken.');
    if (!armed && L.mines.length) warnings.push('World 1 has no weapon, so mines (M) can only be dodged.');
    let r = null;
    if (!errors.length) {
      r = route(L, armed);
      if (!r.ok) errors.push(r.reason);
      if (r.lostCores) warnings.push(r.lostCores + ' energy core' + (r.lostCores > 1 ? 's are' : ' is') + ' out of reach, so 3 stars are impossible.');
      if (r.lostKeys) warnings.push(r.lostKeys + ' key' + (r.lostKeys > 1 ? 's are' : ' is') + ' out of reach.');
    }
    return { ok: !errors.length, errors, warnings, L, route: r };
  }

  // ---------- random courses ----------
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const ADJ = ['Cold', 'Red', 'Silent', 'Broken', 'Hollow', 'Iron', 'Static', 'Long', 'Dark', 'Bright', 'Twisted', 'Frozen'];
  const NOUN = ['Rift', 'Drift', 'Reach', 'Run', 'Shaft', 'Spur', 'Belt', 'Current', 'Narrows', 'Hollow', 'Gauntlet', 'Channel'];

  function build(seed, opts) {
    const R = rng(seed), pick = a => a[Math.floor(R() * a.length)];
    const world = clamp(opts.world || 1 + Math.floor(R() * 7), 1, 7);
    const diff = clamp(opts.diff || 2, 1, 3);
    const Wd = clamp(opts.length || 72 + Math.floor(R() * 28), 40, 200), Ht = 15;
    const g = Array.from({ length: Ht }, () => Array(Wd).fill('#'));
    const minH = 4, maxH = 7;
    let c = 7, hh = 5.5;
    const top = [], bot = [];
    for (let x = 0; x < Wd; x++) {
      if (x > 6 && x < Wd - 8) { c += (R() - 0.5) * 1.5; hh += (R() - 0.5) * 1.2; }
      hh = clamp(hh, minH, maxH); c = clamp(c, 1 + hh / 2, Ht - 2 - hh / 2);
      const t = Math.round(c - hh / 2), b = Math.round(c + hh / 2);
      top.push(t); bot.push(b);
      if (x > 0 && x < Wd - 1) for (let y = t; y <= b; y++) g[y][x] = '.';
    }
    const mid = x => Math.round((top[x] + bot[x]) / 2);
    const carve = (x0, y0, x1, y1) => { for (let y = Math.max(1, y0); y <= Math.min(Ht - 2, y1); y++) for (let x = Math.max(1, x0); x <= Math.min(Wd - 2, x1); x++) g[y][x] = '.'; };
    carve(1, mid(3) - 2, 6, mid(3) + 2);
    carve(Wd - 8, mid(Wd - 5) - 2, Wd - 2, mid(Wd - 5) + 2);
    // rock bumps for texture
    for (let x = 8; x < Wd - 8; x++) if (bot[x] - top[x] >= 6 && R() < 0.12) g[R() < 0.5 ? top[x] : bot[x]][x] = '#';
    const used = new Set();
    const slot = (lo, hi) => {
      for (let i = 0; i < 60; i++) {
        const x = Math.floor(lo + R() * (hi - lo));
        let clear = true; for (let d = -2; d <= 2; d++) if (used.has(x + d)) clear = false;
        if (clear) { used.add(x); return x; }
      }
      return -1;
    };
    const colTiles = x => { const a = []; for (let y = 1; y < Ht - 1; y++) if (g[y][x] === '.') a.push(y); return a; };
    const put = (x, y, ch) => { if (x > 7 && x < Wd - 8 && g[y] && g[y][x] === '.') { g[y][x] = ch; return true; } return false; };
    const lo = 12, hi = Wd - 12;
    let fuel = 0, hint = '';

    if (world === 1 || R() < 0.35) {
      for (let i = 0; i < 1 + diff; i++) {
        const x = slot(lo, hi); if (x < 0) continue;
        const len = 5 + Math.floor(R() * 6), dir = R() < 0.7 ? '>' : pick(['^', 'v', '<']);
        for (let xx = x; xx < Math.min(hi, x + len); xx++) for (const y of colTiles(xx)) put(xx, y, dir);
      }
      hint = hint || 'Ride the solar wind; push against it to slow down.';
    }
    if (world === 1 && R() < 0.5) {
      fuel = Math.round(Wd / 7);
      for (let i = 0; i < 2; i++) { const x = slot(lo, hi); if (x > 0) put(x, mid(x), '+'); }
      hint = 'Fuel is limited. Coast between canisters.';
    }
    if (world >= 2) {
      for (let i = 0; i < diff; i++) { const x = slot(lo, hi); if (x < 0) continue; for (const xx of [x, x + 1]) for (const y of colTiles(xx)) put(xx, y, '%'); }
      for (let i = 0; i < 1 + diff; i++) { const x = slot(lo, hi); if (x > 0) put(x, mid(x), 'o'); }
      hint = hint || 'Shoot through cracked rock.';
    }
    if (world >= 3) {
      for (let i = 0; i < 1 + diff; i++) { const x = slot(lo, hi); if (x < 0) continue; const ch = i % 2 ? 'L' : 'l'; for (const y of colTiles(x)) put(x, y, ch); }
      hint = 'Lasers switch every 1.3 seconds. Wait for the gap.';
    }
    if (world >= 4) {
      for (let i = 0; i < diff; i++) {
        const x = slot(lo, hi); if (x < 0) continue;
        if (bot[x] - top[x] >= 5) put(x, mid(x), 'G'); else put(x, mid(x), 'R');
      }
      hint = 'Gravity wells pull you in. Keep your speed up.';
    }
    if (world >= 5) {
      for (let i = 0; i < 1 + diff; i++) { const x = slot(lo, hi); if (x < 0) continue; const ys = colTiles(x); if (ys.length) put(x, ys[Math.floor(R() * ys.length)], 'M'); }
      hint = 'Mines arm when you get close. Shoot them first.';
    }
    if (world >= 6) {
      const dx = slot(Math.floor(Wd * 0.6), hi), kx = slot(lo, Math.floor(Wd * 0.45));
      if (dx > 0 && kx > 0) { for (const y of colTiles(dx)) put(dx, y, 'D'); put(kx, mid(kx), 'k'); hint = 'Grab the key to open the door.'; }
    }
    if (world >= 7) {
      for (let i = 0; i < diff; i++) { const x = slot(lo, hi); if (x > 0 && bot[x] - top[x] >= 5) put(x, mid(x), 'O'); }
      hint = 'Everything at once. Good luck, pilot.';
    }
    // cores along the route
    const nCores = 5;
    for (let i = 0; i < nCores; i++) {
      const x0 = Math.floor(lo + (hi - lo) * (i + 0.5) / nCores);
      for (let d = 0; d < 8; d++) { const x = x0 + (d % 2 ? -d : d); if (!used.has(x) && put(x, mid(x), '*')) break; }
    }
    if (Wd > 70) { const x = Math.floor(Wd / 2); for (let d = 0; d < 10; d++) { const xx = x + (d % 2 ? -d : d); if (!used.has(xx) && put(xx, mid(xx), 'C')) break; } }
    g[mid(3)][3] = 'S';
    g[mid(Wd - 5)][Wd - 5] = 'E';
    const par = Math.round(Wd * TILE / 72 + 3 + world * 1.5 + diff * 2);
    return {
      name: pick(ADJ) + ' ' + pick(NOUN), world, fuel, par, hint, seed: seed >>> 0,
      map: g.map(r => r.join(''))
    };
  }

  function generate(seed, opts) {
    opts = opts || {};
    seed = (seed >>> 0) || 1;
    for (let i = 0; i < 60; i++) {
      const def = build(seed + i * 7919, opts);
      const v = validate(def);
      if (v.ok && !v.route.lostCores && !v.route.lostKeys) { def.seed = seed; return def; }
    }
    return build(seed, Object.assign({}, opts, { world: 1, diff: 1 }));
  }

  // ---------- share codes ----------
  const rle = s => s.replace(/(.)\1{2,}/g, m => m[0] + m.length);
  const unrle = s => s.replace(/(\D)(\d+)/g, (m, c, n) => c.repeat(Math.min(+n, MAX_W)));
  const b64e = s => {
    const bin = unescape(encodeURIComponent(s));
    const b = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const b64d = s => {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    return decodeURIComponent(escape(bin));
  };
  function encode(def) {
    const o = { v: 1, n: String(def.name || 'Untitled').slice(0, 32), w: clamp(+def.world || 1, 1, 7), f: +def.fuel || 0, p: +def.par || 0, h: String(def.hint || '').slice(0, 80), m: rows(def.map).map(rle).join('/') };
    if (def.theme === 'orbit') o.t = 'orbit';
    return 'TZ1-' + b64e(JSON.stringify(o));
  }
  function decode(code) {
    const s = String(code || '').replace(/\s/g, '');
    if (!/^TZ1-[A-Za-z0-9_-]+$/.test(s)) throw new Error('That is not a Tezzie level code. Codes start with TZ1-.');
    let o;
    try { o = JSON.parse(b64d(s.slice(4))); } catch (e) { throw new Error('The code is damaged or incomplete. Copy it again in full.'); }
    if (!o || typeof o.m !== 'string') throw new Error('The code has no map in it.');
    return { name: String(o.n || 'Shared level').slice(0, 32), world: clamp(+o.w || 1, 1, 7), fuel: Math.max(0, +o.f || 0), par: Math.max(0, +o.p || 0), hint: String(o.h || '').slice(0, 80), theme: o.t === 'orbit' ? 'orbit' : 'classic', map: o.m.split('/').map(unrle) };
  }

  function blank(w, h) {
    w = clamp(w || 48, MIN_W, MAX_W); h = clamp(h || 15, MIN_H, MAX_H);
    const g = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1) ? '#' : '.'));
    const my = Math.floor(h / 2);
    g[my][3] = 'S'; g[my][w - 4] = 'E';
    return g.map(r => r.join(''));
  }

  const Kit = { TILE, MAX_W, MAX_H, MIN_W, MIN_H, TILES, ORBIT_NAMES, THEMES, VALID, WORLDS, rows, parse, route, validate, generate, rng, encode, decode, blank };
  if (typeof module !== 'undefined' && module.exports) module.exports = Kit;
  root.TezzieKit = Kit;
})(typeof window !== 'undefined' ? window : globalThis);
