/* Tezzie: arcade mode, missions, daily and random runs, and the level editor.
   Level data lives in levels.js; tiles, route checks and the course generator live in levelkit.js. */
(() => {
'use strict';
const KIT = window.TezzieKit, CAMPAIGN = window.TEZZIE_LEVELS || { worlds: [], levels: [] };
const TEST_TOOLS = false; // shows "Unlock all" in Missions for playtesting; set false for the store release
const $ = id => document.getElementById(id);
const cv = $('game'), ctx = cv.getContext('2d');
const W = 400, H = 240, TAU = Math.PI * 2, TS = KIT.TILE;
const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const PX = '"Press Start 2P", ui-monospace, monospace';
const rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- shared state ----------
var scene = 'menu';
var S = null, P = null, asts = [], bullets = [], parts = [], crystals = [], crates = [], rings = [];
var M = null, ED = null;
const CAM = { x: 0, y: 0 };
const keys = {}; const k = (...c) => c.some(x => keys[x]);

const WEAPONS = [
 { name: 'NO WEAPON', desc: 'Dodge on cold-gas jets. Collect cores.', r: 0, c: '#8e8f93' },
 { name: 'PEBBLE SHOT', desc: 'Single kinetic pellet', dmg: 1, r: 1, spd: 230, cd: .26, ammo: 40, c: '#d0d1d2' },
 { name: 'TWIN PULSE', desc: 'Paired pellets, faster cycle', dmg: 1, r: 1.5, spd: 250, cd: .2, ammo: 60, count: 2, offset: 3, c: '#ffffff' },
 { name: 'PLASMA BOLT', desc: 'Heavier bolt, punches through a rock', dmg: 2, r: 2.5, spd: 240, cd: .22, ammo: 70, pierce: 1, c: '#ff6b7d' },
 { name: 'SPREAD CANNON', desc: 'Three-way plasma fan', dmg: 2, r: 2.5, spd: 240, cd: .26, ammo: 90, count: 3, spread: .2, c: '#e31937' },
 { name: 'ION ORB', desc: 'Big orb, pierces and splashes', dmg: 4, r: 4, spd: 190, cd: .34, ammo: 60, pierce: 3, splash: 22, c: '#f4f4f4' },
 { name: 'NOVA TORPEDO', desc: 'Massive blast that clears a lane', dmg: 12, r: 6, spd: 160, cd: .5, ammo: 40, pierce: 99, splash: 46, recoil: 28, c: '#e31937' },
];
const NEXT = [12, 35, 70, 120, 190, 280];

// ---------- audio ----------
let AC = null, muted = store.get('tezzie-muted', false);
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (AC && AC.state === 'suspended') AC.resume(); }
function beep(f, d, type = 'square', v = .04, slide = 0, delay = 0) { if (!AC || muted) return; const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + .02); }
function noise(d, v = .08, freq = 900) { if (!AC || muted) return; const n = Math.floor(AC.sampleRate * d), b = AC.createBuffer(1, n, AC.sampleRate), c = b.getChannelData(0); for (let i = 0; i < n; i++) c[i] = (Math.random() * 2 - 1) * (1 - i / n); const s = AC.createBufferSource(); s.buffer = b; const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; const g = AC.createGain(); g.gain.value = v; s.connect(f).connect(g).connect(AC.destination); s.start(); }
const sfx = {
  core() { beep(1200, .07, 'square', .03, 600); },
  fuel() { beep(500, .08, 'square', .035, 300); beep(800, .08, 'square', .03, 0, .07); },
  key() { [660, 880, 1320].forEach((f, i) => beep(f, .1, 'square', .035, 0, i * .07)); },
  check() { [523, 784].forEach((f, i) => beep(f, .12, 'square', .035, 0, i * .08)); },
  warp() { beep(300, .25, 'sine', .06, 900); },
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => beep(f, .14, 'square', .04, 0, i * .08)); },
  click() { beep(900, .03, 'square', .02); }
};

// ---------- storage ----------
let HI = 0; try { HI = +localStorage.getItem('tezzie-hi') || 0; } catch (e) {}
function saveHi() { try { localStorage.setItem('tezzie-hi', String(HI)); } catch (e) {} }
const PROG = store.get('tezzie-progress', {});
let CUSTOM = store.get('tezzie-custom', []);
if (!Array.isArray(CUSTOM)) CUSTOM = [];
let unlockAll = store.get('tezzie-unlock', false);
const saveProg = () => store.set('tezzie-progress', PROG), saveCustom = () => store.set('tezzie-custom', CUSTOM);
const LEVELS = CAMPAIGN.levels;
const trackOf = l => l.zone || 'classic';
function isUnlocked(i) { if (unlockAll) return true; const tr = trackOf(LEVELS[i]); for (let j = i - 1; j >= 0; j--) if (trackOf(LEVELS[j]) === tr) return !!PROG[LEVELS[j].id]; return true; }
function nextInTrack(i) { const tr = trackOf(LEVELS[i]); for (let j = i + 1; j < LEVELS.length; j++) if (trackOf(LEVELS[j]) === tr) return j; return -1; }
const totalStars = () => LEVELS.reduce((a, l) => a + ((PROG[l.id] && PROG[l.id].s) || 0), 0);
const todayKey = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
function dailyDef() { const s = todayKey(), R = KIT.rng(s), world = 1 + Math.floor(R() * 7); const d = KIT.generate(s, { world, diff: 2 }); d.name = d.name; return d; }
const starHTML = (n, of = 3) => '<span class="sg">' + '★'.repeat(n) + '<i>' + '★'.repeat(Math.max(0, of - n)) + '</i></span>';
const fmtTime = t => Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0');
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- vehicles ----------
// Tezzie, hero car: wide wheel stance, rear wing, glowing energy core, gold lightning bolt, determined headlight eyes. Nose points right.
const CAR_MAP = [
 '......knnnk......knnnk......',
 '.hhd..kkkkk......kkkkk......',
 '.ddrhhhhhhhhhhhhhhhh........',
 '.ddBBBnnnnBBBBBBBBBBkk......',
 'eddBBBBBBBBBBBBBBBBBwwkkk...',
 'eddBBBBeeeeBBggGGGBBBBwwwB..',
 '..BByyyeEEeyggggggGBByyyBBBB',
 '..BBBByeEEeygggggggyyBByyyyB',
 'eddBBBBeeeeBBgggggBBBBwwwd..',
 'eddBBBBBBBBBBBBBBBBBwwkkk...',
 '.ddBBBnnnnBBBBBBBBBBkk......',
 '.ddrdddddddddddddddd........',
 '.hhd..kkkkk......kkkkk......',
 '......knnnk......knnnk......'];
const PAINTS = [['Launch Red', '#e31937'], ['Ice White', '#ececee'], ['Lunar Silver', '#9a9ca1'], ['Orbit Blue', '#2456b8'], ['Void Black', '#2b2d32'], ['Solar Gold', '#c9a24a']];
function mix(h, t, q) { const a = parseInt(h.slice(1), 16), b = parseInt(t.slice(1), 16); const c = [16, 8, 0].map(sh => Math.round(((a >> sh) & 255) * (1 - q) + ((b >> sh) & 255) * q)); return 'rgb(' + c.join(',') + ')'; }
const VEH_DEF = [
 ['ROADSTER', null],
 ['LUNAR ROVER', [
 '..kkk...kkk...kkk.......',
 '..kkk...kkk...kkk.......',
 '..sss...sss...sss.......',
 '.dBBBBBBBBBBBBBBBBBBd...',
 '.BhhhhhhhhhhhhhhhhhhBd..',
 'sBBBggggBBBsssBBBBBBBBw.',
 'sBBBggggBBBsGsBBBBBBBBB.',
 'nBBBBBBBBBBsssBBBBBBBBBs']],
 ['CREW CAPSULE', [
 '......dd..............',
 '....ddBBdd............',
 '...dBBBBBBdd..........',
 '..dBBhhhBBBBdd........',
 '.ndBhhBBBggBBBdd......',
 '.ddBhBBBBGgBBBBBdd....',
 'sddBBBBBBBBBBBBBBBdd..',
 'sddBBBBBBBBBBBBBBBBBds',
 'sddBBBBBBBBBBBBBBBBBBw']],
 ['ORBITAL SHUTTLE', [
 '.......dd...................',
 '.......dBd..................',
 '......dBBBd.................',
 '.....dBBBBBd................',
 '...ndBBBBBBBdd..............',
 '..sdBBBBBBBBBBdd............',
 'rssdhhhhhhhhhhhhhddd........',
 'rsBBBBBBBBBBBBggggBBBBBdd...',
 'rsBBBBBBBBBBBBBGggBBBBBBBBsw']],
 ['TWIN-BOOST LIFTER', [
 'rnsddddddddddddddddds.........',
 'rnsBBBBBBBBBBBBBBBBBBBdd......',
 'rnshhhhhhhhhhhhhhhhhhhhhsw....',
 '..ss..ss......................',
 '..........ss..................',
 'rnnsddddddddddddddddddddddd...',
 'rnnsBBBBBBBBBBBBBBBBggBBBBBBd.',
 'rnnshhhhhhhhhhhhhhhhGgBBBBBBBw']],
 ['HEAVY HAULER', [
 '....nn..........................',
 '...rnnsddddddddddd..............',
 '...rnnsBBBBBBBBBBBd.............',
 '..sssssssssssssssssss...........',
 '.dccccsccccsccccsBBBBdd.........',
 '.dcsscscsscscsscsBBBBBBdd.......',
 '.dccccsccccsccccsBBBBBBBBdd.....',
 'rnsddddddddddddddddBBBBBBBBBd...',
 'rnsBBBBBBBBBBBBBBBBBBBBggggBBBd.',
 'rnshhhhhhhhhhhhhhhhhhBBBGgggBBBw']],
 ['STAR CRUISER', [
 '..........dd........................',
 '.........dBBd.......................',
 '........dBBBBd......................',
 '.rn....dBBhhBBd.....................',
 '.rnssddBBBBBBBBdd...................',
 '.rnsBBBBBBBBBBBBBBdddd..............',
 'rrnsdhhhhhhhhhhhhhhhhBBBdd..........',
 'rrnsBBBBBBBBBBBBBBBBBBBBBBBdddd.....',
 'rrnsBBsBBsBBsBBBBBBBBBBggggBBBBBdd..',
 'rrnsBBBBBBBBBBBBBBBBBBBBBGgggBBBBBsw']],
];
const VEH = VEH_DEF.map(([name, top]) => {
  const rows = top ? top.concat(top.slice().reverse()) : CAR_MAP;
  const w = Math.max(...rows.map(r => r.length)), h = rows.length;
  return { name, rows, w, h, hw: w / 2, hh: h / 2, r: Math.max(6, Math.round(h * .42)) };
});
const vehScale = lv => Math.min(1, 26 / VEH[lv - 1].w);
function buildSprite(v, paint) {
  const c = document.createElement('canvas'); c.width = v.w; c.height = v.h; const x = c.getContext('2d');
  const col = { k: '#0d0d0f', B: paint, h: mix(paint, '#ffffff', .38), d: mix(paint, '#000000', .45), g: '#141a22', G: '#a9b8c8', w: '#fff6dc', r: '#ff2a3d', s: '#8e8f93', n: '#5c5e62', c: '#c9cacd', e: '#5ff5ff', E: '#e6ffff', y: '#ffe14d' };
  v.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const ch = row[i]; if (col[ch]) { x.fillStyle = col[ch]; x.fillRect(i, j, 1, 1); } } });
  return c;
}
let sprites = [];
const ladder = $('ladder');
function renderLadder() {
  ladder.innerHTML = '';
  WEAPONS.forEach((w, i) => {
    const li = document.createElement('li'), sp = sprites[i];
    li.innerHTML = `<span class="lv">LV${i + 1}</span><span class="veh"><img alt="" src="${sp.toDataURL()}" style="width:${sp.width * 1.5}px"></span><span><span class="nm">${VEH[i].name}</span><span class="wp" style="color:${w.c}">${w.name}</span> ${w.desc}</span>`;
    ladder.appendChild(li);
  });
  updateLadder();
}
function updateLadder() { const cur = scene === 'mission' && M ? M.lv : (S ? S.level : 1); [...ladder.children].forEach((li, i) => { li.className = i === cur - 1 ? 'on' : (i < cur - 1 ? 'done' : ''); }); }
function buildAll(paint) { sprites = VEH.map(v => buildSprite(v, paint)); renderLadder(); }
let paintIdx = 0; try { const v = +localStorage.getItem('tezzie-paint'); if (v >= 0 && v < PAINTS.length) paintIdx = v; } catch (e) {}
buildAll(PAINTS[paintIdx][1]);
const sw = $('swatches');
PAINTS.forEach(([n, c], i) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'sw'; b.style.background = c; b.title = n; b.setAttribute('aria-label', n + ' paint'); b.setAttribute('aria-pressed', i === paintIdx);
  b.addEventListener('click', () => { paintIdx = i; buildAll(c); try { localStorage.setItem('tezzie-paint', String(i)); } catch (e) {} [...sw.children].forEach((x, j) => x.setAttribute('aria-pressed', j === i)); $('paintname').textContent = n; });
  sw.appendChild(b);
});
$('paintname').textContent = PAINTS[paintIdx][0];

// player car photo (Level 1 / World 1 only)
let carImg = null, carFlip = false;
function makeSprite(img) {
  const s = Math.min(30 / img.width, 16 / img.height), w = Math.max(6, Math.round(img.width * s)), h = Math.max(4, Math.round(img.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h), p = d.data;
  const bg = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([i, j]) => { const o = (j * w + i) * 4; return [p[o], p[o + 1], p[o + 2]]; });
  for (let o = 0; o < p.length; o += 4) { if (p[o + 3] < 40) { p[o + 3] = 0; continue; } for (const [r, g, b] of bg) { if (Math.abs(p[o] - r) + Math.abs(p[o + 1] - g) + Math.abs(p[o + 2] - b) < 70) { p[o + 3] = 0; break; } } }
  x.putImageData(d, 0, 0); return c;
}
function setCar(src, save) { const im = new Image(); im.onload = () => { carImg = makeSprite(im); if (save) { try { localStorage.setItem('tezzie-car', carImg.toDataURL()); } catch (e) {} } $('carnote').textContent = 'Photo loaded for the Level 1 car. Use Flip if the nose points backward.'; }; im.onerror = () => { $('carnote').textContent = 'That file could not be read as an image. Try a JPG or PNG.'; }; im.src = src; }
try { const d = localStorage.getItem('tezzie-car'); if (d) setCar(d, false); carFlip = localStorage.getItem('tezzie-flip') === '1'; } catch (e) {}
$('carfile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => setCar(r.result, true); r.readAsDataURL(f); e.target.value = ''; });
$('carflip').addEventListener('click', () => { carFlip = !carFlip; try { localStorage.setItem('tezzie-flip', carFlip ? '1' : '0'); } catch (e) {} });
$('carreset').addEventListener('click', () => { carImg = null; try { localStorage.removeItem('tezzie-car'); } catch (e) {} $('carnote').textContent = 'Back to the pixel roadster.'; });

// ---------- shared effects ----------
const stars = []; for (let l = 0; l < 3; l++) for (let i = 0; i < 40 + l * 20; i++) stars.push({ x: rnd(0, W), y: rnd(0, H), l });
function toWorld(lx, ly) { const c = Math.cos(P.a), s = Math.sin(P.a); return [P.x + c * lx - s * ly, P.y + s * lx + c * ly]; }
function jet(lx, ly, ld, n = 2) { const [x, y] = toWorld(lx, ly), a = P.a + ld; for (let i = 0; i < n; i++) { const sp = rnd(45, 85), aa = a + rnd(-.25, .25); parts.push({ x, y, vx: P.vx + Math.cos(aa) * sp, vy: P.vy + Math.sin(aa) * sp, life: rnd(.22, .42), max: .42, c: 'gas', s: Math.random() < .4 ? 2 : 1 }); } }
function burst(x, y, n, cols, sp = 60, life = .7) { for (let i = 0; i < n; i++) { const a = rnd(0, TAU), v = rnd(10, sp); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(life * .4, life), max: life, c: cols[i % cols.length], s: Math.random() < .3 ? 2 : 1 }); } }
function updParts(dt) {
  for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .96; p.vy *= .96; p.life -= dt; }
  parts = parts.filter(p => p.life > 0); if (parts.length > 700) parts.splice(0, parts.length - 700);
  for (const r of rings) { r.life -= dt; r.r += (r.max - r.r) * Math.min(1, dt * 10); }
  rings = rings.filter(r => r.life > 0);
}
function mkRock(size, x, y, vx, vy, hp) {
  const r = [0, 6, 12, 22][size], n = [0, 8, 10, 13][size], verts = [];
  for (let i = 0; i < n; i++) verts.push(r * rnd(.72, 1.08));
  const craters = []; for (let i = 0; i < size * 2; i++) craters.push([rnd(-r * .5, r * .5), rnd(-r * .5, r * .5), size > 1 ? 2 : 1]);
  return { x, y, vx, vy, r, size, hp, verts, craters, rot: rnd(0, TAU), av: rnd(-1.2, 1.2), flash: 0, dead: false, tone: Math.floor(rnd(0, 3)) };
}

// ---------- drawing helpers ----------
function txt(s, x, y, c = '#f4f4f4', al = 'left', sz = 8) { ctx.font = sz + 'px ' + PX; ctx.textAlign = al; ctx.textBaseline = 'top'; ctx.fillStyle = '#000'; ctx.fillText(s, x + 1, y + 1); ctx.fillStyle = c; ctx.fillText(s, x, y); }
function drawCar(x, y, a, s = 1, lv = 1, c = ctx) {
  c.save(); c.translate(Math.round(x), Math.round(y)); c.rotate(a); c.scale(s, s); c.imageSmoothingEnabled = false;
  const v = VEH[lv - 1];
  if (lv === 1 && carImg) { if (carFlip) c.scale(-1, 1); c.drawImage(carImg, -carImg.width / 2, -carImg.height / 2); }
  else {
    c.drawImage(sprites[lv - 1], -Math.floor(v.hw), -Math.floor(v.hh));
    if (lv === 1) { const pulse = .5 + .5 * Math.sin(performance.now() / 160); c.globalCompositeOperation = 'lighter'; c.globalAlpha = .18 + .22 * pulse; c.fillStyle = '#5ff5ff'; c.beginPath(); c.arc(-5, 0, 3 + pulse * 1.5, 0, TAU); c.fill(); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
  }
  c.restore();
}
const ROCK = [['#393c41', '#8e8f93', '#232529'], ['#2f3237', '#6b6d72', '#1b1d21'], ['#45474c', '#a2a3a7', '#2a2c30']];
function drawAst(a) {
  const [f, l, d] = ROCK[a.tone];
  ctx.save(); ctx.translate(Math.round(a.x), Math.round(a.y)); ctx.rotate(a.rot);
  ctx.beginPath(); a.verts.forEach((r, i) => { const t = i / a.verts.length * TAU; i ? ctx.lineTo(Math.cos(t) * r, Math.sin(t) * r) : ctx.moveTo(Math.cos(t) * r, Math.sin(t) * r); }); ctx.closePath();
  ctx.fillStyle = a.flash > 0 ? '#fff' : f; ctx.fill(); ctx.strokeStyle = a.flash > 0 ? '#fff' : l; ctx.lineWidth = 1; ctx.stroke();
  if (a.flash <= 0) { ctx.fillStyle = d; for (const [cx, cy, s] of a.craters) ctx.fillRect(Math.round(cx), Math.round(cy), s, s); }
  ctx.restore();
}
function drawBullets(theme) { if (theme === 'orbit') { for (const b of bullets) { ctx.fillStyle = 'rgba(255,225,77,.35)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 3, 0, TAU); ctx.fill(); ctx.fillStyle = OR.gold; star4(ctx, b.x, b.y, b.r + 2.5, (b.r + 2.5) * .4); ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(b.x), Math.round(b.y), 1, 1); } return; } for (const b of bullets) { ctx.globalAlpha = .3; ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); if (b.r >= 2) { ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 2, 2); } } }
function drawFx(theme) {
  const kid = theme === 'orbit';
  for (const p of parts) { const t = p.life / p.max; ctx.globalAlpha = Math.min(1, t * 1.6); ctx.fillStyle = p.c === 'gas' ? (t > .6 ? '#ffffff' : t > .3 ? (kid ? '#7dfcff' : '#d0d1d2') : (kid ? '#4258c9' : '#6b6d72')) : p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); }
  ctx.globalAlpha = 1;
  for (const r of rings) { ctx.globalAlpha = Math.max(0, r.life * 2); ctx.strokeStyle = r.c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

// tiles and level objects, shared by missions, the editor and palette icons
const LASER = { period: 2.6, warn: .35 };
const isWallCh = c => c === '#' || c === '%' || c === 'D';
const isLaserCh = c => c === 'l' || c === 'L';
function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }
function laserPhase(ch, t) { const T = LASER.period, hf = T / 2, p = (((ch === 'l' ? t : t + hf) % T) + T) % T; if (p < hf) return 2; if (p > T - LASER.warn) return 1; return 0; }
function drawTile(c, get, tx, ty, ch, t, o) {
  if (isOrbit(o)) return orbitTile(c, get, tx, ty, ch, t, o);
  const px = tx * TS, py = ty * TS;
  const wall = (x, y) => { const n = get(x, y); return n === '#' || n === '%' || (n === 'D' && !o.keyOpen); };
  switch (ch) {
    case '#': {
      const h = hash(tx, ty);
      c.fillStyle = '#2a2d33'; c.fillRect(px, py, 16, 16);
      c.fillStyle = '#33363c'; c.fillRect(px + 2 + (h & 7), py + 2 + ((h >> 3) & 7), 4, 3);
      c.fillStyle = '#222428'; c.fillRect(px + 1 + ((h >> 6) & 11), py + 3 + ((h >> 10) & 9), 3, 2);
      c.fillStyle = '#3a3d43'; c.fillRect(px + 3 + ((h >> 14) & 9), py + 1 + ((h >> 18) & 11), 2, 1);
      if (!wall(tx, ty - 1)) { c.fillStyle = '#8e8f93'; c.fillRect(px, py, 16, 1); c.fillStyle = '#4a4d53'; c.fillRect(px, py + 1, 16, 1); }
      if (!wall(tx, ty + 1)) { c.fillStyle = '#141619'; c.fillRect(px, py + 14, 16, 2); }
      if (!wall(tx - 1, ty)) { c.fillStyle = '#5c5e62'; c.fillRect(px, py, 1, 16); }
      if (!wall(tx + 1, ty)) { c.fillStyle = '#17191d'; c.fillRect(px + 15, py, 1, 16); }
      break;
    }
    case '%': {
      const h = hash(tx, ty), a = 4 + (h & 7);
      c.fillStyle = '#4a4d53'; c.fillRect(px, py, 16, 16);
      c.fillStyle = '#6b6d72'; c.fillRect(px, py, 16, 1); c.fillRect(px, py, 1, 16);
      c.fillStyle = '#26282d'; c.fillRect(px + 15, py, 1, 16); c.fillRect(px, py + 15, 16, 1);
      c.fillStyle = '#1b1d21';
      c.fillRect(px + a, py + 1, 1, 4); c.fillRect(px + a + 1, py + 4, 1, 4); c.fillRect(px + a, py + 8, 1, 3); c.fillRect(px + a - 1, py + 11, 1, 4);
      c.fillRect(px + 2, py + 8 + ((h >> 4) & 3), 5, 1); c.fillRect(px + 10, py + 4 + ((h >> 6) & 5), 4, 1);
      if (o.hp != null && o.hp < 3) { c.fillStyle = '#e31937'; c.fillRect(px + a, py + 3, 1, 2); c.fillRect(px + a + 1, py + 6, 1, 2); if (o.hp < 2) { c.fillRect(px + 3, py + 9, 3, 1); c.fillRect(px + 11, py + 5, 2, 1); } }
      break;
    }
    case 'D': {
      if (o.keyOpen) { c.strokeStyle = 'rgba(227,25,55,.35)'; c.lineWidth = 1; c.strokeRect(px + 1.5, py + 1.5, 13, 13); break; }
      c.fillStyle = '#171a20'; c.fillRect(px, py, 16, 16);
      c.fillStyle = '#e31937'; c.fillRect(px + 2, py + 2, 12, 3); c.fillRect(px + 2, py + 11, 12, 3);
      c.fillStyle = '#f4f4f4'; c.fillRect(px + 2, py + 7, 12, 2);
      c.fillStyle = '#5c5e62'; c.fillRect(px, py, 1, 16); c.fillRect(px + 15, py, 1, 16);
      break;
    }
    case '^': case 'v': case '<': case '>': {
      const h = hash(tx, ty), off = (((t * 34 + (h & 15)) % 16) + 16) % 16;
      c.fillStyle = 'rgba(208,209,210,.05)'; c.fillRect(px, py, 16, 16);
      c.fillStyle = 'rgba(208,209,210,.55)';
      for (const q of [off, (off + 8) % 16]) {
        const oq = Math.floor(q);
        if (ch === '>' || ch === '<') {
          const x = ch === '>' ? px + oq : px + 15 - oq, s = ch === '>' ? -1 : 1, y = py + 4 + ((h >> 4) & 7);
          for (let i = 0; i < 3; i++) { c.fillRect(x + s * i, y - i, 1, 1); c.fillRect(x + s * i, y + i, 1, 1); }
        } else {
          const y = ch === 'v' ? py + oq : py + 15 - oq, s = ch === 'v' ? -1 : 1, x = px + 4 + ((h >> 4) & 7);
          for (let i = 0; i < 3; i++) { c.fillRect(x - i, y + s * i, 1, 1); c.fillRect(x + i, y + s * i, 1, 1); }
        }
      }
      break;
    }
    case 'l': case 'L': {
      const horiz = isLaserCh(get(tx - 1, ty)) || isLaserCh(get(tx + 1, ty));
      const st = o.editor ? 2 : laserPhase(ch, t), cx = px + 8, cy = py + 8;
      if (st === 2) {
        c.fillStyle = 'rgba(227,25,55,.28)'; horiz ? c.fillRect(px, cy - 4, 16, 8) : c.fillRect(cx - 4, py, 8, 16);
        c.fillStyle = '#e31937'; horiz ? c.fillRect(px, cy - 2, 16, 4) : c.fillRect(cx - 2, py, 4, 16);
        c.fillStyle = '#ffd6dc'; horiz ? c.fillRect(px, cy - 1, 16, 2) : c.fillRect(cx - 1, py, 2, 16);
        if (o.editor && ch === 'L') { c.fillStyle = '#0d0f13'; for (let i = 2; i < 16; i += 6) horiz ? c.fillRect(px + i, cy - 4, 2, 8) : c.fillRect(cx - 4, py + i, 8, 2); }
      } else if (st === 1) {
        if (((t * 24) | 0) % 2) { c.fillStyle = 'rgba(227,25,55,.85)'; horiz ? c.fillRect(px, cy, 16, 1) : c.fillRect(cx, py, 1, 16); }
      } else {
        c.fillStyle = '#5c0a14'; for (let i = 0; i < 16; i += 4) horiz ? c.fillRect(px + i, cy, 2, 1) : c.fillRect(cx, py + i, 1, 2);
      }
      c.fillStyle = '#8e8f93';
      if (horiz) { if (wall(tx - 1, ty)) c.fillRect(px, cy - 4, 3, 8); if (wall(tx + 1, ty)) c.fillRect(px + 13, cy - 4, 3, 8); }
      else { if (wall(tx, ty - 1)) c.fillRect(cx - 4, py, 8, 3); if (wall(tx, ty + 1)) c.fillRect(cx - 4, py + 13, 8, 3); }
      break;
    }
  }
}
function drawGlyph(c, ch, cx, cy, t, o = {}) {
  if (isOrbit(o)) return orbitGlyph(c, ch, cx, cy, t, o);
  switch (ch) {
    case '*': { const r = 4 + (Math.sin(t * 5 + (o.ph || 0)) > 0 ? 1 : 0); c.fillStyle = '#f4f4f4'; c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx + r * .7, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r * .7, cy); c.closePath(); c.fill(); c.fillStyle = '#e31937'; c.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 2, 2); break; }
    case '+': c.fillStyle = '#d0d1d2'; c.fillRect(cx - 4, cy - 5, 8, 11); c.fillStyle = '#e31937'; c.fillRect(cx - 4, cy - 1, 8, 3); c.fillStyle = '#8e8f93'; c.fillRect(cx - 2, cy - 7, 4, 2); c.fillStyle = '#fff'; c.fillRect(cx - 3, cy - 4, 1, 3); break;
    case 'k': c.strokeStyle = '#f4f4f4'; c.lineWidth = 2; c.beginPath(); c.arc(cx - 3, cy, 3, 0, TAU); c.stroke(); c.fillStyle = '#f4f4f4'; c.fillRect(cx, cy - 1, 7, 2); c.fillRect(cx + 4, cy + 1, 1, 2); c.fillRect(cx + 6, cy + 1, 1, 3); c.fillStyle = '#e31937'; c.fillRect(cx - 4, cy - 1, 2, 2); break;
    case 'C': c.fillStyle = '#8e8f93'; c.fillRect(cx - 1, cy - 8, 2, 15); c.fillRect(cx - 4, cy + 6, 8, 2); c.fillStyle = o.on ? '#e31937' : '#45474c'; c.beginPath(); c.moveTo(cx + 1, cy - 8); c.lineTo(cx + 8, cy - 5); c.lineTo(cx + 1, cy - 2); c.closePath(); c.fill(); if (o.on && Math.floor(t * 4) % 2) { c.fillStyle = '#fff'; c.fillRect(cx - 1, cy - 10, 2, 2); } break;
    case 'E': {
      const r = 11; c.fillStyle = 'rgba(227,25,55,.18)'; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
      c.strokeStyle = '#f4f4f4'; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
      c.strokeStyle = '#e31937'; for (let i = 0; i < 4; i++) { const a = t * 2 + i * TAU / 4; c.beginPath(); c.arc(cx, cy, r + 3, a, a + .6); c.stroke(); }
      c.fillStyle = '#fff'; const p = 2 + Math.round(Math.sin(t * 4) + 1); c.fillRect(cx - p / 2, cy - p / 2, p, p);
      break;
    }
    case 'S': drawCar(cx, cy, 0, vehScale(o.lv || 1), o.lv || 1, c); break;
    case 'o': case 'O': {
      const r = ch === 'O' ? 12 : 6, n = ch === 'O' ? 11 : 8, h = hash(cx | 0, cy | 0);
      c.beginPath(); for (let i = 0; i < n; i++) { const a = i / n * TAU, rr = r * (.78 + ((h >> (i * 2)) & 3) * .08); i ? c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : c.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      c.closePath(); c.fillStyle = '#393c41'; c.fill(); c.strokeStyle = '#8e8f93'; c.lineWidth = 1; c.stroke();
      if (o.editor) { c.fillStyle = '#e31937'; c.fillRect(cx + r - 3, cy - 1, 4, 2); c.fillRect(cx + r, cy - 2, 1, 4); }
      break;
    }
    case 'M': {
      c.fillStyle = '#8e8f93'; c.fillRect(cx - 1, cy - 8, 2, 16); c.fillRect(cx - 8, cy - 1, 16, 2); c.fillRect(cx - 6, cy - 6, 2, 2); c.fillRect(cx + 4, cy - 6, 2, 2); c.fillRect(cx - 6, cy + 4, 2, 2); c.fillRect(cx + 4, cy + 4, 2, 2);
      c.fillStyle = '#45474c'; c.beginPath(); c.arc(cx, cy, 5, 0, TAU); c.fill(); c.strokeStyle = '#8e8f93'; c.lineWidth = 1; c.stroke();
      const on = o.armed ? Math.floor(t * 16) % 2 : Math.floor(t * 2) % 2;
      c.fillStyle = on ? (o.armed ? '#fff' : '#e31937') : '#5c0a14'; c.fillRect(cx - 1, cy - 1, 3, 3);
      break;
    }
    case 'G': {
      if (o.editor) { c.strokeStyle = 'rgba(227,25,55,.22)'; c.lineWidth = 1; c.setLineDash([2, 4]); c.beginPath(); c.arc(cx, cy, 110, 0, TAU); c.stroke(); c.setLineDash([]); }
      for (let i = 0; i < 3; i++) { const a = -t * 2.4 + i * TAU / 3; c.strokeStyle = i ? 'rgba(227,25,55,.55)' : 'rgba(244,244,244,.5)'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, 13 + i * 3, a, a + 1.4); c.stroke(); }
      c.fillStyle = '#000'; c.beginPath(); c.arc(cx, cy, 8, 0, TAU); c.fill(); c.strokeStyle = '#e31937'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, 8.5, 0, TAU); c.stroke();
      break;
    }
    case 'R': {
      for (let i = 0; i < 3; i++) { const rr = ((t * 30 + i * 22) % 66); c.globalAlpha = Math.max(0, 1 - rr / 66) * .6; c.strokeStyle = '#d0d1d2'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, 6 + rr, 0, TAU); c.stroke(); }
      c.globalAlpha = 1; c.fillStyle = '#5c5e62'; c.beginPath(); c.arc(cx, cy, 6, 0, TAU); c.fill(); c.fillStyle = '#f4f4f4'; c.beginPath(); c.arc(cx, cy, 3, 0, TAU); c.fill();
      if (o.editor) { c.strokeStyle = 'rgba(208,209,210,.2)'; c.setLineDash([2, 4]); c.beginPath(); c.arc(cx, cy, 80, 0, TAU); c.stroke(); c.setLineDash([]); }
      break;
    }
    case 'W': {
      c.fillStyle = '#000'; c.beginPath(); c.arc(cx, cy, 10, 0, TAU); c.fill();
      for (let j = 0; j < 2; j++) { c.strokeStyle = j ? '#e31937' : '#f4f4f4'; c.lineWidth = 1.5; c.setLineDash([3, 3]); c.lineDashOffset = (j ? -1 : 1) * t * 20; c.beginPath(); c.arc(cx, cy, 10 - j * 4, 0, TAU); c.stroke(); }
      c.setLineDash([]); c.lineDashOffset = 0;
      if (o.n) { c.font = '6px ' + PX; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#f4f4f4'; c.fillText(String(o.n), cx, cy + 1); }
      break;
    }
  }
}
function drawStarsParallax(cx, cy) { for (const s of stars) { const f = [.08, .18, .35][s.l], x = ((s.x - cx * f) % W + W) % W, y = ((s.y - cy * f) % H + H) % H; ctx.fillStyle = ['#393c41', '#6b6d72', '#f4f4f4'][s.l]; ctx.fillRect(x | 0, y | 0, 1, 1); } }
function wrapText(s, n) { const out = []; let line = ''; for (const w of String(s).split(/\s+/)) { if ((line + ' ' + w).trim().length > n) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim(); } if (line) out.push(line); return out; }


// =====================================================================
// ORBIT RING: the kid-friendly electric space look
// Walls are glowing circuit-board station panels, rocks are grumpy Sootlings,
// lasers are cyan and pink light gates, mines are pop bubbles, wells are swirls.
// =====================================================================
const OR = { hull: '#26337a', hullHi: '#3a4db0', trace: '#4258c9', node: '#7dfcff', glow: '#5ff5ff', gold: '#ffe14d', pink: '#ff6bd6', green: '#5dff8f', violet: '#b388ff', cyan: '#59f2ff', night: '#140c3f' };
const ORB_STARS = Array.from({ length: 110 }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, l: i % 3, ph: Math.random() * TAU, c: ['#ffffff', '#ffe14d', '#7dfcff', '#ffb3ec'][i % 4] }));
const ORB_SPARKS = ['#ffe14d', '#ff6bd6', '#59f2ff', '#5dff8f', '#ffffff'];
const isOrbit = o => !!o && o.theme === 'orbit';
function star4(c, cx, cy, R, r) { c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? r : R, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); c.fill(); }
function drawOrbitBg(c, cx, cy, t, w = W, h = H) {
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#140c3f'); g.addColorStop(1, '#35176e'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  for (const [nx, ny, r, col, f] of [[90, 70, 120, 'rgba(255,107,214,0.17)', .05], [320, 175, 140, 'rgba(89,242,255,0.13)', .07], [220, 30, 100, 'rgba(179,136,255,0.2)', .03]]) {
    const x = ((nx - cx * f) % (w + 240) + w + 240) % (w + 240) - 120, y = ny - cy * f * .5;
    const rg = c.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(20,12,63,0)'); c.fillStyle = rg; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (const s of ORB_STARS) {
    const f = [.06, .14, .28][s.l], x = ((s.x - cx * f) % w + w) % w, y = ((s.y - cy * f) % h + h) % h;
    c.globalAlpha = .35 + .65 * Math.abs(Math.sin(t * 1.4 + s.ph)); c.fillStyle = s.c;
    if (s.l === 2) { c.fillRect(x | 0, (y | 0) - 1, 1, 3); c.fillRect((x | 0) - 1, y | 0, 3, 1); } else c.fillRect(x | 0, y | 0, 1, 1);
  }
  c.globalAlpha = 1;
  // Planet Plug hangs in the sky: teal world, gold lightning-bolt continent, gold ring
  const px = 332 - cx * .025, py = 52 - cy * .025;
  c.save(); c.translate(px, py);
  c.strokeStyle = 'rgba(255,225,77,.5)'; c.lineWidth = 3; c.beginPath(); c.ellipse(0, 0, 50, 11, -.25, Math.PI, TAU); c.stroke();
  const pg = c.createRadialGradient(-9, -11, 3, 0, 0, 30); pg.addColorStop(0, '#9dffd9'); pg.addColorStop(1, '#1c8f86'); c.fillStyle = pg; c.beginPath(); c.arc(0, 0, 27, 0, TAU); c.fill();
  c.fillStyle = 'rgba(255,225,77,.75)'; c.beginPath(); c.moveTo(3, -15); c.lineTo(-7, 2); c.lineTo(0, 2); c.lineTo(-4, 15); c.lineTo(8, -3); c.lineTo(1, -3); c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,255,255,.28)'; c.beginPath(); c.arc(-9, -10, 6, 0, TAU); c.fill();
  c.strokeStyle = 'rgba(255,225,77,.85)'; c.lineWidth = 3; c.beginPath(); c.ellipse(0, 0, 50, 11, -.25, 0, Math.PI); c.stroke();
  c.restore();
}
function drawSootling(c, x, y, r, flash) {
  const body = flash > 0 ? '#ffffff' : '#4b3a78', hi = flash > 0 ? '#ffffff' : '#6c58a8';
  c.fillStyle = body;
  for (const [dx, dy, s] of [[0, .05, .78], [-.55, .2, .5], [.55, .18, .5], [-.25, -.42, .48], [.3, -.38, .44]]) { c.beginPath(); c.arc(x + dx * r, y + dy * r, r * s, 0, TAU); c.fill(); }
  c.fillStyle = hi; c.beginPath(); c.arc(x - r * .25, y - r * .42, r * .26, 0, TAU); c.fill();
  const e = Math.max(2, Math.round(r * .26)), ex1 = Math.round(x - r * .38), ex2 = Math.round(x + r * .14), ey = Math.round(y - e * .3);
  c.fillStyle = '#ffffff'; c.fillRect(ex1, ey, e, e); c.fillRect(ex2, ey, e, e);
  c.fillStyle = OR.night; c.fillRect(ex1 + e - 1, ey + e - 1, 1, 1); c.fillRect(ex2, ey + e - 1, 1, 1);
  c.fillRect(ex1 - 1, ey - 2, e + 1, 1); c.fillRect(ex1 + e - 1, ey - 1, 1, 1); c.fillRect(ex2 + 1, ey - 2, e + 1, 1); c.fillRect(ex2, ey - 1, 1, 1);
}
function orbitTile(c, get, tx, ty, ch, t, o) {
  const px = tx * TS, py = ty * TS;
  const wall = (x, y) => { const n = get(x, y); return n === '#' || n === '%' || (n === 'D' && !o.keyOpen); };
  switch (ch) {
    case '#': {
      const h = hash(tx, ty);
      c.fillStyle = OR.hull; c.fillRect(px, py, 16, 16);
      c.fillStyle = '#2d3b8c'; c.fillRect(px + 2, py + 2, 12, 12);
      c.fillStyle = OR.trace;
      const ty1 = py + 4 + (h & 7), tx1 = px + 4 + ((h >> 3) & 7);
      if (h & 1) c.fillRect(px, ty1, 16, 1); else c.fillRect(tx1, py, 1, 16);
      if ((h >> 5) & 1) c.fillRect(tx1, ty1, 1, py + 16 - ty1); else c.fillRect(px, ty1, tx1 - px, 1);
      c.fillStyle = Math.sin(t * 2.5 + (h & 31)) > .7 ? OR.node : '#5a72e0'; c.fillRect(tx1 - 1, ty1 - 1, 3, 3);
      if ((h >> 9) & 1) { c.fillStyle = '#4a5cc4'; c.fillRect(px + 2, py + 2, 1, 1); c.fillRect(px + 13, py + 13, 1, 1); }
      const glowSoft = 'rgba(95,245,255,.3)';
      if (!wall(tx, ty - 1)) { c.fillStyle = glowSoft; c.fillRect(px, py + 1, 16, 2); c.fillStyle = OR.glow; c.fillRect(px, py, 16, 1); }
      if (!wall(tx, ty + 1)) { c.fillStyle = glowSoft; c.fillRect(px, py + 13, 16, 2); c.fillStyle = OR.glow; c.fillRect(px, py + 15, 16, 1); }
      if (!wall(tx - 1, ty)) { c.fillStyle = glowSoft; c.fillRect(px + 1, py, 2, 16); c.fillStyle = OR.glow; c.fillRect(px, py, 1, 16); }
      if (!wall(tx + 1, ty)) { c.fillStyle = glowSoft; c.fillRect(px + 13, py, 2, 16); c.fillStyle = OR.glow; c.fillRect(px + 15, py, 1, 16); }
      break;
    }
    case '%': {
      const on = Math.sin(t * 6 + tx * 1.7 + ty) > 0;
      c.fillStyle = '#ffcf3d'; c.fillRect(px, py, 16, 16);
      c.fillStyle = '#ff9a1f'; c.fillRect(px, py + 14, 16, 2); c.fillRect(px + 14, py, 2, 16);
      c.fillStyle = '#fff3b0'; c.fillRect(px, py, 16, 1); c.fillRect(px, py, 1, 16);
      c.fillStyle = on ? '#ffffff' : '#fff3b0';
      c.fillRect(px + 8, py + 3, 3, 2); c.fillRect(px + 7, py + 5, 3, 2); c.fillRect(px + 5, py + 7, 6, 2); c.fillRect(px + 7, py + 9, 3, 2); c.fillRect(px + 6, py + 11, 3, 2);
      if (o.hp != null && o.hp < 3) { c.fillStyle = '#ff5a2c'; c.fillRect(px + 3, py + 3, 1, 4); c.fillRect(px + 4, py + 7, 1, 3); if (o.hp < 2) { c.fillRect(px + 12, py + 8, 1, 4); c.fillRect(px + 11, py + 12, 1, 2); } }
      break;
    }
    case 'D': {
      if (o.keyOpen) { c.fillStyle = 'rgba(95,245,255,.1)'; c.fillRect(px + 6, py, 4, 16); break; }
      c.fillStyle = 'rgba(95,245,255,.22)'; c.fillRect(px, py, 16, 16);
      const off = Math.floor(((t * 22) % 6 + 6) % 6);
      c.fillStyle = 'rgba(190,255,255,.8)'; for (let y = off; y < 16; y += 6) c.fillRect(px, py + y, 16, 1);
      c.fillStyle = OR.glow; c.fillRect(px + 7, py, 2, 16);
      break;
    }
    case '^': case 'v': case '<': case '>': {
      c.fillStyle = 'rgba(255,225,77,.07)'; c.fillRect(px, py, 16, 16);
      const h = hash(tx, ty), off = (((t * 30 + (h & 15)) % 16) + 16) % 16;
      const dx = ch === '>' ? -1 : ch === '<' ? 1 : 0, dy = ch === 'v' ? -1 : ch === '^' ? 1 : 0;
      for (const q of [off, (off + 8) % 16]) {
        const oq = Math.floor(q), side = 3 + ((h >> 4) & 9);
        const x = ch === '>' ? px + oq : ch === '<' ? px + 15 - oq : px + side, y = ch === 'v' ? py + oq : ch === '^' ? py + 15 - oq : py + side;
        c.fillStyle = '#ffe680'; c.fillRect(x, y, 2, 2);
        c.fillStyle = 'rgba(255,230,128,.45)'; c.fillRect(x + dx * 3, y + dy * 3, 1, 1); c.fillRect(x + dx * 5, y + dy * 5, 1, 1);
      }
      break;
    }
    case 'l': case 'L': {
      const isL = ch === 'l', col = isL ? OR.cyan : OR.pink, soft = isL ? 'rgba(89,242,255,.32)' : 'rgba(255,107,214,.32)';
      const horiz = isLaserCh(get(tx - 1, ty)) || isLaserCh(get(tx + 1, ty)), st = o.editor ? 2 : laserPhase(ch, t), cx = px + 8, cy = py + 8;
      if (st === 2) {
        c.fillStyle = soft; horiz ? c.fillRect(px, cy - 4, 16, 8) : c.fillRect(cx - 4, py, 8, 16);
        c.fillStyle = col; horiz ? c.fillRect(px, cy - 2, 16, 4) : c.fillRect(cx - 2, py, 4, 16);
        c.fillStyle = '#ffffff'; horiz ? c.fillRect(px, cy - 1, 16, 2) : c.fillRect(cx - 1, py, 2, 16);
        if (!o.editor) { c.fillStyle = '#ffffff'; const sp = Math.floor(((t * 40 + tx * 5 + ty * 5) % 16 + 16) % 16); horiz ? c.fillRect(px + sp, cy - 3, 1, 1) : c.fillRect(cx + 2, py + sp, 1, 1); }
      } else if (st === 1) {
        if (((t * 24) | 0) % 2) { c.fillStyle = col; horiz ? c.fillRect(px, cy, 16, 1) : c.fillRect(cx, py, 1, 16); }
      } else {
        c.globalAlpha = .45; c.fillStyle = col; for (let i = 0; i < 16; i += 4) horiz ? c.fillRect(px + i, cy, 2, 1) : c.fillRect(cx, py + i, 1, 2); c.globalAlpha = 1;
      }
      const pod = (x, y, w, h) => { c.fillStyle = '#d9e2ff'; c.fillRect(x, y, w, h); c.fillStyle = col; c.fillRect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2)); };
      if (horiz) { if (wall(tx - 1, ty)) pod(px, cy - 4, 4, 8); if (wall(tx + 1, ty)) pod(px + 12, cy - 4, 4, 8); }
      else { if (wall(tx, ty - 1)) pod(cx - 4, py, 8, 4); if (wall(tx, ty + 1)) pod(cx - 4, py + 12, 8, 4); }
      break;
    }
  }
}
function orbitGlyph(c, ch, cx, cy, t, o) {
  switch (ch) {
    case '*': {
      const r = 5 + (Math.sin(t * 5 + (o.ph || 0)) > 0 ? 1 : 0);
      c.fillStyle = 'rgba(255,225,77,.28)'; c.beginPath(); c.arc(cx, cy, r + 2, 0, TAU); c.fill();
      c.fillStyle = OR.gold; star4(c, cx, cy, r, r * .4); c.fillStyle = '#ffffff'; c.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 2, 2);
      break;
    }
    case '+': c.fillStyle = '#d9ffe6'; c.fillRect(cx - 2, cy - 7, 4, 2); c.fillStyle = OR.green; c.fillRect(cx - 4, cy - 5, 8, 12); c.fillStyle = '#ffffff'; c.fillRect(cx - 1, cy - 2, 2, 6); c.fillRect(cx - 3, cy, 6, 2); break;
    case 'k': c.fillStyle = OR.pink; c.fillRect(cx - 6, cy - 4, 12, 9); c.fillStyle = OR.gold; c.fillRect(cx - 4, cy - 2, 4, 3); c.fillStyle = '#ffffff'; c.fillRect(cx + 1, cy + 2, 4, 1); c.fillRect(cx - 6, cy - 4, 12, 1); break;
    case 'C': {
      c.fillStyle = '#9fb4ff'; c.fillRect(cx - 4, cy + 5, 8, 3); c.fillRect(cx - 1, cy - 4, 2, 9);
      const lit = o.on;
      if (lit) { c.fillStyle = 'rgba(93,255,143,.3)'; c.beginPath(); c.arc(cx, cy - 7, 6, 0, TAU); c.fill(); }
      c.fillStyle = lit ? OR.green : '#4a5cc4'; c.beginPath(); c.arc(cx, cy - 7, 3.5, 0, TAU); c.fill();
      c.fillStyle = '#ffffff'; c.fillRect(cx - 2, cy - 9, 1, 1);
      break;
    }
    case 'E': {
      const rg = c.createRadialGradient(cx, cy, 2, cx, cy, 18); rg.addColorStop(0, 'rgba(93,255,143,.45)'); rg.addColorStop(1, 'rgba(93,255,143,0)'); c.fillStyle = rg; c.beginPath(); c.arc(cx, cy, 18, 0, TAU); c.fill();
      c.strokeStyle = OR.green; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 11, 0, TAU); c.stroke();
      c.strokeStyle = OR.gold; c.lineWidth = 2; for (let i = 0; i < 3; i++) { const a = t * 2.2 + i * TAU / 3; c.beginPath(); c.arc(cx, cy, 15, a, a + .7); c.stroke(); }
      c.fillStyle = '#ffffff'; c.fillRect(cx - 4, cy - 5, 2, 5); c.fillRect(cx + 2, cy - 5, 2, 5); c.fillRect(cx - 5, cy, 10, 4); c.fillRect(cx - 1, cy + 4, 2, 3);
      break;
    }
    case 'S': drawCar(cx, cy, 0, 1, 1, c); break;
    case 'o': case 'O': drawSootling(c, cx, cy, ch === 'O' ? 13 : 7, 0); break;
    case 'M': {
      const armed = o.armed, r = armed ? 7 + Math.abs(Math.sin(t * 20)) * 2 : 6 + Math.sin(t * 3) * .6;
      c.fillStyle = armed ? 'rgba(255,107,214,.35)' : 'rgba(150,240,255,.18)'; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
      c.strokeStyle = armed ? OR.pink : '#bff9ff'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
      c.strokeStyle = '#ffffff'; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, r - 2, -2.4, -1.6); c.stroke();
      c.fillStyle = armed ? '#ffffff' : OR.gold; star4(c, cx, cy + 1, 3, 1.2);
      break;
    }
    case 'G': {
      if (o.editor) { c.strokeStyle = 'rgba(179,136,255,.3)'; c.lineWidth = 1; c.setLineDash([2, 4]); c.beginPath(); c.arc(cx, cy, 110, 0, TAU); c.stroke(); c.setLineDash([]); }
      const rg = c.createRadialGradient(cx, cy, 1, cx, cy, 20); rg.addColorStop(0, 'rgba(243,230,255,.9)'); rg.addColorStop(.35, 'rgba(179,136,255,.55)'); rg.addColorStop(1, 'rgba(179,136,255,0)'); c.fillStyle = rg; c.beginPath(); c.arc(cx, cy, 20, 0, TAU); c.fill();
      const cols = [OR.pink, OR.cyan, OR.gold];
      for (let i = 0; i < 3; i++) { c.strokeStyle = cols[i]; c.lineWidth = 1.5; c.beginPath(); for (let k = 0; k <= 14; k++) { const a = -t * 2 + i * TAU / 3 + k * .32, rr = 3 + k * 1.2; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; k ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(cx, cy, 2.5, 0, TAU); c.fill();
      break;
    }
    case 'R': {
      for (let i = 0; i < 2; i++) { const rr = ((t * 26 + i * 30) % 60); c.globalAlpha = Math.max(0, 1 - rr / 60) * .7; c.strokeStyle = OR.pink; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, 8 + rr, 0, TAU); c.stroke(); }
      c.globalAlpha = 1;
      if (o.editor) { c.strokeStyle = 'rgba(255,107,214,.25)'; c.setLineDash([2, 4]); c.beginPath(); c.arc(cx, cy, 80, 0, TAU); c.stroke(); c.setLineDash([]); }
      c.fillStyle = OR.pink; c.beginPath(); c.arc(cx, cy, 8, 0, TAU); c.fill();
      c.strokeStyle = OR.gold; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, 5.5, 0, TAU); c.stroke();
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(cx, cy, 2.5, 0, TAU); c.fill();
      break;
    }
    case 'W': {
      c.fillStyle = OR.night; c.beginPath(); c.arc(cx, cy, 10, 0, TAU); c.fill();
      const rb = ['#ff6bd6', '#ffe14d', '#5dff8f', '#59f2ff', '#b388ff', '#ff9a1f'];
      c.lineWidth = 3; for (let i = 0; i < 6; i++) { const a = t * 2.5 + i * TAU / 6; c.strokeStyle = rb[i]; c.beginPath(); c.arc(cx, cy, 10, a, a + TAU / 6 + .02); c.stroke(); }
      c.fillStyle = '#ffffff'; for (let i = 0; i < 3; i++) { const a = -t * 3 + i * TAU / 3; c.fillRect(Math.round(cx + Math.cos(a) * 5), Math.round(cy + Math.sin(a) * 5), 1, 1); }
      if (o.n) { c.font = '6px ' + PX; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffffff'; c.fillText(String(o.n), cx, cy + 1); }
      break;
    }
  }
}

// =====================================================================
// ARCADE
// =====================================================================
function reset(mode) {
  S = { mode, score: 0, lives: 3, level: 1, xp: 0, ammo: 0, t: 0, wave: 1, cd: 0, spawnT: 1, crysT: 1.5, crateT: 12, shake: 0, banner: null, odNext: 400, hiss: 0, newHi: false, flash: 0 };
  P = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0, inv: 2.5, dead: 0 };
  asts = []; bullets = []; parts = []; crystals = []; crates = []; rings = [];
  for (let i = 0; i < 4; i++) asts.push(edgeAst(3));
  updateLadder();
}
function mkAst(size, x, y, vx, vy) { return mkRock(size, x, y, vx, vy, Math.ceil([0, 1, 3, 6][size] * (1 + (S.wave - 1) * .18))); }
function edgeAst(size) {
  let x, y, tries = 0;
  do { const s = Math.floor(rnd(0, 4)); x = s < 2 ? rnd(0, W) : (s === 2 ? -20 : W + 20); y = s >= 2 ? rnd(0, H) : (s === 0 ? -20 : H + 20); tries++; } while (Math.hypot(x - P.x, y - P.y) < 110 && tries < 20);
  const sp = rnd(10, 18) + S.wave * 2.5, a = Math.atan2(P.y - y, P.x - x) + rnd(-.8, .8);
  return mkAst(size, x, y, Math.cos(a) * sp, Math.sin(a) * sp);
}
function wrap(o, m) { if (o.x < -m) o.x += W + 2 * m; else if (o.x > W + m) o.x -= W + 2 * m; if (o.y < -m) o.y += H + 2 * m; else if (o.y > H + m) o.y -= H + 2 * m; }
function weapon() { return WEAPONS[Math.min(S.level, 7) - 1]; }
function fire() {
  const w = weapon(); if (!w.dmg || S.ammo <= 0 || S.cd > 0) return;
  const n = w.count || 1;
  for (let i = 0; i < n; i++) {
    const m = i - (n - 1) / 2, ang = P.a + (w.spread ? m * w.spread : 0), off = w.offset ? m * w.offset * 2 : 0;
    const [x, y] = toWorld(VEH[S.level - 1].hw, off);
    bullets.push({ x, y, vx: Math.cos(ang) * w.spd + P.vx * .4, vy: Math.sin(ang) * w.spd + P.vy * .4, r: w.r, dmg: w.dmg, pierce: w.pierce || 0, splash: w.splash || 0, c: w.c, life: 1.5, hit: new Set() });
  }
  if (w.recoil) { P.vx -= Math.cos(P.a) * w.recoil; P.vy -= Math.sin(P.a) * w.recoil; }
  S.ammo--; S.cd = w.cd;
  shotSound(S.level);
  if (S.ammo === 0) S.banner = { l1: 'OUT OF AMMO', l2: 'FIND A CRATE OR LEVEL UP', t: 1.8, c: '#ffffff' };
}
function shotSound(lv) { if (lv >= 7) { beep(140, .35, 'sawtooth', .06, -90); noise(.3, .06, 500); } else beep(980 - lv * 90, .08, 'square', .03, -400); }
function damage(a, d) { if (a.dead) return; a.hp -= d; a.flash = .08; if (a.hp <= 0) destroy(a); }
const born = [];
function destroy(a) {
  a.dead = true; S.score += [0, 100, 50, 20][a.size];
  burst(a.x, a.y, 6 + a.size * 6, ['#8e8f93', '#5c5e62', '#e31937', '#fff'], 30 + a.size * 15, .8);
  S.shake = Math.max(S.shake, a.size * 1.2);
  noise(.12 + a.size * .08, .05 + a.size * .02, 500 + a.size * 150);
  if (a.size > 1) for (let i = 0; i < 2; i++) { const ang = rnd(0, TAU), sp = rnd(14, 28) + S.wave * 2; born.push(mkAst(a.size - 1, a.x, a.y, a.vx * .6 + Math.cos(ang) * sp, a.vy * .6 + Math.sin(ang) * sp)); }
  if (Math.random() < .45) crystals.push({ x: a.x, y: a.y, vx: rnd(-15, 15), vy: rnd(-15, 15), v: a.size, life: 9, ph: rnd(0, TAU) });
}
function addXP(v) {
  S.xp += v;
  while (S.level < 7 && S.xp >= NEXT[S.level - 1]) {
    S.level++; const w = weapon(); S.ammo += w.ammo; P.inv = Math.max(P.inv, 1.2);
    S.banner = { l1: 'LV' + S.level + ' ' + VEH[S.level - 1].name, l2: w.name + ' ONLINE  +' + w.ammo + ' AMMO', t: 2.8, c: w.c }; burst(P.x, P.y, 30, ['#ffffff', '#e31937', '#d0d1d2'], 70, .6); S.flash = .25;
    rings.push({ x: P.x, y: P.y, r: 4, max: 60, life: .6, c: w.c });
    [523, 659, 784, 1046].forEach((f, i) => beep(f, .12, 'square', .04, 0, i * .08));
    updateLadder();
  }
  if (S.level === 7 && S.xp >= S.odNext) { S.odNext += 120; S.ammo += 30; S.score += 1000; S.banner = { l1: 'OVERDRIVE', l2: '+30 NOVA AMMO  +1000', t: 2.2, c: '#e31937' }; [784, 1046, 1318].forEach((f, i) => beep(f, .12, 'square', .04, 0, i * .07)); }
}
function killPlayer() {
  P.dead = 1.8; S.lives--; S.shake = 6;
  burst(P.x, P.y, 40, ['#e31937', '#ff6b7d', '#fff', '#d0d1d2'], 90, 1.1);
  rings.push({ x: P.x, y: P.y, r: 4, max: 40, life: .5, c: '#e31937' });
  noise(.6, .12, 700); beep(220, .5, 'sawtooth', .05, -180);
}
function arcUpdate(dt) {
  const dvx = S.mode === 'play' ? P.vx : 12, dvy = S.mode === 'play' ? P.vy : 4;
  for (const s of stars) { const f = [.04, .1, .2][s.l]; s.x -= dvx * f * dt; s.y -= dvy * f * dt; if (s.x < 0) s.x += W; if (s.x > W) s.x -= W; if (s.y < 0) s.y += H; if (s.y > H) s.y -= H; }
  updParts(dt);
  if (S.mode === 'title') { const tt = performance.now() / 1000; P.x = W / 2; P.y = 80 + Math.sin(tt * 2) * 2.5; P.a = -.22 + Math.sin(tt * 1.3) * .05; P.vx = -40; P.vy = 8; if (Math.random() < .8) jet(-31, Math.random() < .5 ? -10 : 10, Math.PI, 1); for (const a of asts) { a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.av * dt; wrap(a, a.r); } return; }
  if (S.mode !== 'play') return;
  S.t += dt; S.wave = 1 + Math.floor(S.t / 25); S.cd -= dt;
  if (S.banner && (S.banner.t -= dt) <= 0) S.banner = null;
  if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 14);
  if (S.flash > 0) S.flash -= dt;
  addXP(dt * .5);
  if (P.dead > 0) {
    P.dead -= dt;
    if (P.dead <= 0) {
      if (S.lives <= 0) { S.mode = 'over'; if (S.score > HI) { HI = Math.floor(S.score); S.newHi = true; saveHi(); } showOver(); }
      else { P.dead = 0; P.x = W / 2; P.y = H / 2; P.vx = P.vy = 0; P.a = -Math.PI / 2; P.inv = 3; }
    }
  } else {
    const rot = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0);
    P.a += rot * 3.8 * dt;
    const V = VEH[S.level - 1];
    if (rot) jet(V.hw - 3, rot > 0 ? -V.hh : V.hh, rot > 0 ? -Math.PI / 2 : Math.PI / 2, 1);
    let ax = 0, ay = 0, gas = false;
    if (k('ArrowUp', 'KeyW')) { ax += Math.cos(P.a) * 150; ay += Math.sin(P.a) * 150; jet(-V.hw, -V.hh * .45, Math.PI); jet(-V.hw, V.hh * .45, Math.PI); gas = true; }
    if (k('ArrowDown', 'KeyS')) { ax -= Math.cos(P.a) * 95; ay -= Math.sin(P.a) * 95; jet(V.hw, -2, 0, 1); jet(V.hw, 2, 0, 1); gas = true; }
    if (k('KeyQ')) { ax += Math.sin(P.a) * 90; ay -= Math.cos(P.a) * 90; jet(0, V.hh, Math.PI / 2); gas = true; }
    if (k('KeyE')) { ax -= Math.sin(P.a) * 90; ay += Math.cos(P.a) * 90; jet(0, -V.hh, -Math.PI / 2); gas = true; }
    if (gas && (S.hiss -= dt) <= 0) { noise(.09, .018, 2600); S.hiss = .08; }
    P.vx += ax * dt; P.vy += ay * dt;
    const sp = Math.hypot(P.vx, P.vy), max = 165; if (sp > max) { P.vx *= max / sp; P.vy *= max / sp; }
    P.x += P.vx * dt; P.y += P.vy * dt; wrap(P, 6);
    if (P.inv > 0) P.inv -= dt;
    if (k('Space', 'KeyJ', 'KeyF')) fire();
  }
  for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; wrap(b, 2); }
  for (const a of asts) { a.x += a.vx * dt; a.y += a.vy * dt; a.rot += a.av * dt; wrap(a, a.r); if (a.flash > 0) a.flash -= dt; }
  for (const b of bullets) {
    if (b.life <= 0) continue;
    for (const a of asts) {
      if (a.dead || b.hit.has(a)) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) {
        b.hit.add(a); damage(a, b.dmg);
        burst(b.x, b.y, 3, [b.c, '#fff'], 40, .3);
        if (b.splash) {
          rings.push({ x: b.x, y: b.y, r: 3, max: b.splash, life: .45, c: b.c }); S.shake = Math.max(S.shake, b.splash / 12);
          for (const o of asts) if (o !== a && !o.dead && Math.hypot(o.x - b.x, o.y - b.y) < b.splash + o.r) damage(o, Math.ceil(b.dmg / 2));
          noise(.25, .05, 400);
        }
        if (b.pierce > 0) b.pierce--; else { b.life = 0; break; }
      }
    }
  }
  if (!P.dead && P.inv <= 0) for (const a of asts) if (!a.dead && Math.hypot(a.x - P.x, a.y - P.y) < a.r + VEH[S.level - 1].r) { damage(a, 99); killPlayer(); break; }
  if (born.length) { asts.push(...born); born.length = 0; }
  asts = asts.filter(a => !a.dead); bullets = bullets.filter(b => b.life > 0);
  for (const c of crystals) {
    c.life -= dt; c.ph += dt * 6;
    const dx = P.x - c.x, dy = P.y - c.y, d = Math.hypot(dx, dy);
    if (!P.dead && d < 45) { c.vx += dx / d * 160 * dt; c.vy += dy / d * 160 * dt; }
    c.vx *= .98; c.vy *= .98; c.x += c.vx * dt; c.y += c.vy * dt; wrap(c, 4);
    if (!P.dead && d < 9) { c.life = 0; addXP(c.v * 2); S.score += 25 * c.v; sfx.core(); burst(c.x, c.y, 6, ['#ffffff', '#e31937'], 30, .4); }
  }
  crystals = crystals.filter(c => c.life > 0);
  for (const c of crates) {
    c.life -= dt; c.x += c.vx * dt; c.y += c.vy * dt; wrap(c, 5);
    if (!P.dead && Math.hypot(P.x - c.x, P.y - c.y) < 10) { c.life = 0; const add = Math.ceil(weapon().ammo * .5); S.ammo += add; S.banner = { l1: 'AMMO +' + add, l2: weapon().name, t: 1.4, c: '#ffffff' }; [660, 880].forEach((f, i) => beep(f, .09, 'square', .04, 0, i * .06)); }
  }
  crates = crates.filter(c => c.life > 0);
  const mass = asts.reduce((s, a) => s + a.size, 0), target = Math.min(36, 7 + S.wave * 2);
  if ((S.spawnT -= dt) <= 0) { S.spawnT = Math.max(.6, 1.6 - S.wave * .08); if (mass < target) asts.push(edgeAst(Math.random() < .7 ? 3 : 2)); }
  if ((S.crysT -= dt) <= 0) { S.crysT = S.level === 1 ? 2.2 : 4; if (crystals.length < 5) { let x, y; do { x = rnd(20, W - 20); y = rnd(30, H - 30); } while (Math.hypot(x - P.x, y - P.y) < 50); crystals.push({ x, y, vx: rnd(-8, 8), vy: rnd(-8, 8), v: 1, life: 10, ph: 0 }); } }
  if (S.level >= 2 && (S.crateT -= dt) <= 0) { S.crateT = rnd(12, 18); if (crates.length < 1) crates.push({ x: rnd(30, W - 30), y: rnd(40, H - 40), vx: rnd(-10, 10), vy: rnd(-10, 10), life: 14 }); }
}
function arcRender() {
  ctx.fillStyle = '#0b0c0f'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (S.shake > 0 && !RM) ctx.translate(Math.round(rnd(-S.shake, S.shake)), Math.round(rnd(-S.shake, S.shake)));
  for (const s of stars) { ctx.fillStyle = ['#393c41', '#6b6d72', '#f4f4f4'][s.l]; ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1); }
  const now = performance.now() / 1000;
  for (const c of crystals) { if (c.life < 2 && Math.floor(c.life * 8) % 2) continue; drawGlyph(ctx, '*', c.x, c.y, now, { ph: c.ph }); }
  for (const c of crates) { if (c.life < 3 && Math.floor(c.life * 8) % 2) continue; const x = Math.round(c.x) - 4, y = Math.round(c.y) - 4; ctx.fillStyle = '#f4f4f4'; ctx.fillRect(x, y, 9, 9); ctx.fillStyle = '#171a20'; ctx.fillRect(x + 1, y + 1, 7, 7); ctx.fillStyle = '#e31937'; ctx.fillRect(x + 3, y + 2, 3, 1); ctx.fillRect(x + 2, y + 3, 1, 4); ctx.fillRect(x + 6, y + 3, 1, 4); ctx.fillRect(x + 3, y + 5, 3, 1); }
  for (const a of asts) drawAst(a);
  drawBullets(); drawFx();
  if (S.mode !== 'title' && !P.dead && !(P.inv > 0 && Math.floor(P.inv * 12) % 2)) drawCar(P.x, P.y, P.a, 1, S.level);
  ctx.restore();
  if (S.flash > 0) { ctx.globalAlpha = Math.min(.6, S.flash * 2.4); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  if (S.mode === 'title') return drawTitle();
  drawHUD();
}
function drawHUD() {
  txt(String(Math.floor(S.score)).padStart(6, '0'), 8, 6);
  txt('HI ' + String(Math.max(HI, Math.floor(S.score))).padStart(6, '0'), W - 8, 6, '#8e8f93', 'right');
  txt('SECTOR ' + S.wave, W / 2, 6, '#e31937', 'center');
  const w = weapon(), prev = S.level === 1 ? 0 : (S.level < 7 ? NEXT[S.level - 2] : S.odNext - 120), nxt = S.level < 7 ? NEXT[S.level - 1] : S.odNext;
  const pct = Math.max(0, Math.min(1, (S.xp - prev) / (nxt - prev)));
  txt('LV' + S.level, 8, 18, w.c);
  ctx.fillStyle = '#24272e'; ctx.fillRect(34, 19, 90, 6); ctx.fillStyle = w.c; ctx.fillRect(34, 19, Math.round(90 * pct), 6); ctx.fillStyle = '#fff'; ctx.globalAlpha = .25; ctx.fillRect(34, 19, Math.round(90 * pct), 1); ctx.globalAlpha = 1;
  txt(S.level < 7 ? 'XP' : 'OD', 128, 18, '#8e8f93');
  { const v = VEH[S.level - 1], sc = Math.min(.6, 13 / v.w), gap = Math.max(10, v.h * sc + 3); for (let i = 0; i < S.lives; i++) drawCar(W - 12 - i * gap, 30, -Math.PI / 2, sc, S.level); }
  if (S.level === 1) { if (Math.floor(performance.now() / 500) % 2) txt('WEAPONS OFFLINE  COLLECT CORES', W / 2, H - 14, '#8e8f93', 'center'); }
  else {
    txt(w.name, W / 2, H - 26, w.c, 'center');
    const low = S.ammo < 10 && Math.floor(performance.now() / 250) % 2;
    txt('AMMO ' + String(S.ammo).padStart(3, '0'), W / 2, H - 14, low ? '#e31937' : '#f4f4f4', 'center');
  }
  drawBanner(S.banner);
}
function drawBanner(b) {
  if (!b) return;
  const bw = Math.max(b.l1.length * 16, (b.l2 || '').length * 8) + 24, x = (W - bw) / 2, y = H / 2 - 58, hh = b.l2 ? 40 : 28;
  ctx.fillStyle = 'rgba(11,12,15,.85)'; ctx.fillRect(x, y, bw, hh); ctx.strokeStyle = b.c; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, bw - 1, hh - 1);
  txt(b.l1, W / 2, y + 6, b.c, 'center', 16); if (b.l2) txt(b.l2, W / 2, y + 27, '#f4f4f4', 'center');
}
function drawTitle() {
  ctx.fillStyle = 'rgba(11,12,15,.35)'; ctx.fillRect(0, 0, W, H);
  ctx.font = '28px ' + PX; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = '#5c0a14'; ctx.fillText('TEZZIE', W / 2 + 3, 14 + 3); ctx.fillStyle = '#e31937'; ctx.fillText('TEZZIE', W / 2, 14);
  txt('COLD-GAS ASTEROID RUN', W / 2, 50, '#d0d1d2', 'center');
  drawCar(P.x, P.y, P.a, 2.2);
  ctx.font = '6px ' + PX; ctx.textAlign = 'center'; ctx.fillStyle = '#6b6d72'; ctx.fillText('© 2026 SARJ VIRTUAL ASSOCIATES LLC', W / 2, 231);
}

// =====================================================================
// MISSIONS (campaign, custom, daily, random and editor test runs)
// =====================================================================
const MP = { rot: 3.6, thr: 150, brk: 95, str: 90, vmax: 170, r: 7, crash: 75, wind: 80, wellR: 110, wellA: 260, repR: 80, repA: 230 };
function startMission(def, src) {
  audio();
  const v = KIT.validate(def);
  if (!v.ok) { toast(v.errors[0]); return; }
  const L = v.L, lv = clamp(Math.round(+def.world || 1), 1, 7), fuel = Math.max(0, +def.fuel || 0);
  const c = p => ({ x: p.x * TS + TS / 2, y: p.y * TS + TS / 2 });
  M = {
    def, src, L, lv, t: 0, deaths: 0, state: 'play', paused: false, deadT: 0, clearT: 0, shown: false,
    cores: 0, key: false, fuelMax: fuel, fuel, cd: 0, shake: 0, flash: 0, hint: def.hint ? 5 : 0,
    ammo: +def.ammo > 0 ? +def.ammo : Infinity, hp: new Map(), lt: 0, wormCD: 0, banner: null, hiss: 0, emptyWarned: false,
    spawn: Object.assign(c(L.start), { a: 0 }), newRocks: []
  };
  M.theme = def.theme === 'orbit' ? 'orbit' : 'classic'; M.kid = M.theme === 'orbit';
  M.ship = M.kid ? 1 : lv; M.crash = M.kid ? 115 : MP.crash;
  M.fx = M.kid ? { die: ORB_SPARKS, pick: ['#ffe14d', '#ffffff', '#ff6bd6'], fuel: ['#5dff8f', '#ffffff'], debris: ['#ffe14d', '#ff9a1f', '#ffffff', '#ff6bd6'], rock: ['#ffffff', '#d9d0ff', '#ffe14d', '#59f2ff'], boom: ['#ff6bd6', '#ffe14d', '#59f2ff', '#ffffff'], win: ['#5dff8f', '#ffe14d', '#59f2ff', '#ff6bd6', '#fff'] }
    : { die: ['#e31937', '#ff6b7d', '#fff', '#d0d1d2'], pick: ['#fff', '#e31937'], fuel: ['#d0d1d2', '#e31937'], debris: ['#5c5e62', '#8e8f93', '#1b1d21'], rock: ['#8e8f93', '#5c5e62', '#e31937', '#fff'], boom: ['#e31937', '#ff6b7d', '#fff', '#8e8f93'], win: ['#fff', '#e31937', '#d0d1d2'] };
  M.coreList = L.cores.map(p => Object.assign(c(p), { got: false, ph: Math.random() * TAU }));
  M.total = M.coreList.length;
  M.fuelList = L.fuel.map(p => Object.assign(c(p), { got: false }));
  M.keyList = L.keys.map(p => Object.assign(c(p), { got: false }));
  M.checkList = L.checks.map(p => Object.assign(c(p), { on: false }));
  M.exitList = L.exits.map(c);
  const R = KIT.rng(hashStr(String(def.name || '')) + L.w * 131 + L.h);
  M.rocks = L.rocks.map(p => { const q = c(p), a = R() * TAU, sp = p.big ? 14 + R() * 10 : 22 + R() * 16; return mkRock(p.big ? 2 : 1, q.x, q.y, Math.cos(a) * sp, Math.sin(a) * sp, p.big ? 6 : 2); });
  M.mines = L.mines.map(p => Object.assign(c(p), { arm: -1, dead: false }));
  M.wells = L.wells.map(c); M.reps = L.reps.map(c);
  M.worms = L.worms.map(c); M.worms.forEach((w, i) => { w.to = i % 2 === 0 ? (i + 1 < M.worms.length ? i + 1 : -1) : i - 1; });
  bullets = []; parts = []; rings = [];
  respawn(true);
  camUpdate(0, true);
  scene = 'mission'; for (const x in keys) keys[x] = false;
  showOverlay(null); setChrome(); updateLadder();
  cv.focus({ preventScroll: true });
}
function respawn(first) { P = { x: M.spawn.x, y: M.spawn.y, a: M.spawn.a, vx: 0, vy: 0, inv: first ? 0 : 1.2, dead: 0 }; M.fuel = M.fuelMax; M.emptyWarned = false; M.state = 'play'; }
function restartMission() { if (M) startMission(M.def, M.src); }
function mTile(x, y) { const L = M.L; if (x < 0 || y < 0 || x >= L.w || y >= L.h) return '#'; return L.g[y][x]; }
const mSolid = c => c === '#' || c === '%' || (c === 'D' && !M.key);
function collideWalls(o, r, e) {
  const x0 = Math.floor((o.x - r) / TS), x1 = Math.floor((o.x + r) / TS), y0 = Math.floor((o.y - r) / TS), y1 = Math.floor((o.y + r) / TS);
  let worst = 0;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!mSolid(mTile(tx, ty))) continue;
    const nx = clamp(o.x, tx * TS, tx * TS + TS), ny = clamp(o.y, ty * TS, ty * TS + TS);
    let dx = o.x - nx, dy = o.y - ny, d = Math.hypot(dx, dy);
    if (d >= r) continue;
    if (d < 1e-4) { const sp = Math.hypot(o.vx, o.vy) || 1; dx = -o.vx / sp; dy = -o.vy / sp; d = 0; } else { dx /= d; dy /= d; }
    o.x += dx * (r - d); o.y += dy * (r - d);
    const vn = o.vx * dx + o.vy * dy;
    if (vn < 0) { worst = Math.max(worst, -vn); o.vx -= (1 + e) * vn * dx; o.vy -= (1 + e) * vn * dy; if (e < 1) { o.vx *= .92; o.vy *= .92; } }
  }
  return worst;
}
function laserHit(x, y, r) {
  const x0 = Math.floor((x - r) / TS), x1 = Math.floor((x + r) / TS), y0 = Math.floor((y - r) / TS), y1 = Math.floor((y + r) / TS);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const ch = mTile(tx, ty); if (!isLaserCh(ch) || laserPhase(ch, M.lt) !== 2) continue;
    const horiz = isLaserCh(mTile(tx - 1, ty)) || isLaserCh(mTile(tx + 1, ty));
    const rx = horiz ? tx * TS : tx * TS + 6, ry = horiz ? ty * TS + 6 : ty * TS, rw = horiz ? TS : 4, rh = horiz ? 4 : TS;
    if (Math.hypot(x - clamp(x, rx, rx + rw), y - clamp(y, ry, ry + rh)) < r) return true;
  }
  return false;
}
const near = (o, r) => Math.hypot(o.x - P.x, o.y - P.y) < r;
function mBanner(l1, l2, c) { M.banner = { l1, l2, t: 1.6, c }; }
function mUpdate(dt) {
  updParts(dt);
  if (M.paused) return;
  M.lt += dt;
  if (M.hint > 0) M.hint -= dt;
  if (M.shake > 0) M.shake = Math.max(0, M.shake - dt * 14);
  if (M.flash > 0) M.flash -= dt;
  if (M.banner && (M.banner.t -= dt) <= 0) M.banner = null;
  if (M.wormCD > 0) M.wormCD -= dt;
  M.cd -= dt;
  if (M.state === 'play' || M.state === 'dead') M.t += dt;
  for (const r of M.rocks) { r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.av * dt; if (r.flash > 0) r.flash -= dt; collideWalls(r, r.r * .85, 1); }
  for (const m of M.mines) {
    if (m.dead) continue;
    if (m.arm < 0 && M.state === 'play' && near(m, 30)) { m.arm = .55; beep(1400, .06, 'square', .04); }
    if (m.arm >= 0) { m.arm -= dt; if (m.arm <= 0) mineBoom(m); }
  }
  if (M.state === 'dead') { M.deadT -= dt; if (M.deadT <= 0) respawn(false); }
  else if (M.state === 'play') mPlayer(dt);
  else if (M.state === 'clear') { M.clearT -= dt; P.vx *= .94; P.vy *= .94; P.x += P.vx * dt; P.y += P.vy * dt; P.a += dt * 5; if (M.clearT <= 0 && !M.shown) { M.shown = true; showResult(); } }
  mBullets(dt);
  camUpdate(dt);
}
function mPlayer(dt) {
  const V = VEH[M.ship - 1], sc = vehScale(M.ship), hw = V.hw * sc, hh = V.hh * sc;
  const rot = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0);
  P.a += rot * MP.rot * dt;
  if (rot) jet(hw - 3, rot > 0 ? -hh : hh, rot > 0 ? -Math.PI / 2 : Math.PI / 2, 1);
  let ax = 0, ay = 0, burn = 0;
  const has = M.fuelMax <= 0 || M.fuel > 0;
  if (has) {
    if (k('ArrowUp', 'KeyW')) { ax += Math.cos(P.a) * MP.thr; ay += Math.sin(P.a) * MP.thr; jet(-hw, -hh * .45, Math.PI); jet(-hw, hh * .45, Math.PI); burn += 1; }
    if (k('ArrowDown', 'KeyS')) { ax -= Math.cos(P.a) * MP.brk; ay -= Math.sin(P.a) * MP.brk; jet(hw, -2, 0, 1); jet(hw, 2, 0, 1); burn += .6; }
    if (k('KeyQ')) { ax += Math.sin(P.a) * MP.str; ay -= Math.cos(P.a) * MP.str; jet(0, hh, Math.PI / 2); burn += .6; }
    if (k('KeyE')) { ax -= Math.sin(P.a) * MP.str; ay += Math.cos(P.a) * MP.str; jet(0, -hh, -Math.PI / 2); burn += .6; }
  } else if (k('ArrowUp', 'KeyW', 'ArrowDown', 'KeyS') && !M.emptyWarned) { M.emptyWarned = true; mBanner('OUT OF FUEL', 'COAST TO A CANISTER', '#e31937'); beep(200, .2, 'square', .04); }
  if (burn) { if (M.fuelMax > 0) M.fuel = Math.max(0, M.fuel - dt * Math.min(1.4, burn)); if ((M.hiss -= dt) <= 0) { noise(.09, .018, 2600); M.hiss = .08; } }
  const tc = mTile(Math.floor(P.x / TS), Math.floor(P.y / TS));
  if (tc === '^') ay -= MP.wind; else if (tc === 'v') ay += MP.wind; else if (tc === '<') ax -= MP.wind; else if (tc === '>') ax += MP.wind;
  for (const g of M.wells) { const dx = g.x - P.x, dy = g.y - P.y, d = Math.hypot(dx, dy); if (d < 8) { mDie(); return; } if (d < MP.wellR) { const a = MP.wellA * Math.pow(1 - d / MP.wellR, 1.2); ax += dx / d * a; ay += dy / d * a; } }
  for (const g of M.reps) { const dx = P.x - g.x, dy = P.y - g.y, d = Math.hypot(dx, dy) || 1; if (d < MP.repR) { const a = MP.repA * (1 - d / MP.repR); ax += dx / d * a; ay += dy / d * a; } }
  P.vx += ax * dt; P.vy += ay * dt;
  const sp = Math.hypot(P.vx, P.vy); if (sp > MP.vmax) { P.vx *= MP.vmax / sp; P.vy *= MP.vmax / sp; }
  P.x += P.vx * dt; P.y += P.vy * dt;
  const imp = collideWalls(P, MP.r, .4);
  if (imp > M.crash) { mDie(); return; }
  if (imp > 20) { burst(P.x, P.y, 4, ['#d0d1d2', '#8e8f93'], 30, .3); beep(160, .05, 'square', .03); }
  if (P.inv > 0) P.inv -= dt;
  if (laserHit(P.x, P.y, MP.r * .75)) { mDie(); return; }
  if (P.inv <= 0) for (const r of M.rocks) if (!r.dead && Math.hypot(r.x - P.x, r.y - P.y) < r.r * .85 + MP.r * .8) { mDie(); return; }
  for (const o of M.coreList) if (!o.got && near(o, 11)) { o.got = true; M.cores++; sfx.core(); burst(o.x, o.y, 8, M.fx.pick, 35, .4); }
  for (const o of M.fuelList) if (!o.got && near(o, 11)) { o.got = true; if (M.fuelMax > 0) M.fuel = Math.min(M.fuelMax, M.fuel + 4); M.emptyWarned = false; sfx.fuel(); burst(o.x, o.y, 8, M.fx.fuel, 35, .4); }
  for (const o of M.keyList) if (!o.got && near(o, 12)) { o.got = true; if (!M.key) { M.key = true; mBanner('DOORS OPEN', '', '#e31937'); sfx.key(); M.flash = .15; } }
  for (const o of M.checkList) if (!o.on && near(o, 13)) { M.checkList.forEach(q => q.on = false); o.on = true; M.spawn = { x: o.x, y: o.y, a: P.a }; mBanner('CHECKPOINT', '', '#f4f4f4'); sfx.check(); }
  if (M.wormCD <= 0) for (const w of M.worms) { if (w.to < 0 || !near(w, 10)) continue; const to = M.worms[w.to]; rings.push({ x: w.x, y: w.y, r: 2, max: 20, life: .4, c: '#f4f4f4' }); P.x = to.x; P.y = to.y; M.wormCD = .8; rings.push({ x: to.x, y: to.y, r: 2, max: 24, life: .5, c: '#e31937' }); sfx.warp(); break; }
  for (const e of M.exitList) if (near(e, 13)) { mClear(); return; }
  if (k('Space', 'KeyJ', 'KeyF')) mFire();
}
function mDie() {
  if (M.state !== 'play') return;
  M.state = 'dead'; M.deadT = .95; M.deaths++; M.shake = 6;
  burst(P.x, P.y, 40, M.fx.die, 90, 1.1);
  rings.push({ x: P.x, y: P.y, r: 4, max: 40, life: .5, c: M.kid ? '#ffe14d' : '#e31937' });
  if (M.kid) { beep(620, .28, 'sine', .07, -380); beep(300, .2, 'triangle', .04, 200, .12); mBanner('BONK!', 'TRY AGAIN', '#ffe14d'); M.banner.t = .9; }
  else { noise(.5, .11, 700); beep(220, .45, 'sawtooth', .05, -180); }
}
function mClear() {
  M.state = 'clear'; M.clearT = .9;
  const par = +M.def.par || 0;
  M.stars = [true, M.cores >= M.total, par > 0 ? M.t <= par + 1e-6 : true];
  const n = M.stars.filter(Boolean).length;
  rings.push({ x: P.x, y: P.y, r: 4, max: 70, life: .7, c: '#f4f4f4' }); burst(P.x, P.y, 40, M.fx.win, 80, .8); M.flash = .25; sfx.win();
  const id = M.src.id; M.prev = id ? PROG[id] : null; M.newBest = false;
  if (id) { const p = PROG[id] || {}; M.newBest = !p.t || M.t < p.t; PROG[id] = { s: Math.max(p.s || 0, n), t: p.t ? Math.min(p.t, M.t) : M.t }; saveProg(); }
}
function mFire() {
  const w = WEAPONS[M.lv - 1]; if (!w.dmg || M.cd > 0 || M.ammo <= 0) return;
  const sc = vehScale(M.ship), V = VEH[M.ship - 1], n = w.count || 1;
  for (let i = 0; i < n; i++) {
    const m = i - (n - 1) / 2, ang = P.a + (w.spread ? m * w.spread : 0), off = w.offset ? m * w.offset * 2 : 0;
    const [x, y] = toWorld(V.hw * sc, off);
    bullets.push({ x, y, vx: Math.cos(ang) * w.spd + P.vx * .4, vy: Math.sin(ang) * w.spd + P.vy * .4, r: w.r, dmg: w.dmg, pierce: w.pierce || 0, splash: w.splash || 0, c: w.c, life: 1.1, hit: new Set() });
  }
  if (w.recoil) { P.vx -= Math.cos(P.a) * w.recoil; P.vy -= Math.sin(P.a) * w.recoil; }
  M.ammo--; M.cd = w.cd; shotSound(M.lv);
}
function hitTile(tx, ty, d) {
  const key = ty * M.L.w + tx, hp = (M.hp.has(key) ? M.hp.get(key) : 3) - d;
  if (hp <= 0) { M.L.g[ty][tx] = '.'; M.hp.delete(key); burst(tx * TS + 8, ty * TS + 8, 10, M.fx.debris, 50, .6); noise(.15, .05, 600); }
  else M.hp.set(key, hp);
}
function hitRock(r, d) {
  if (r.dead) return; r.hp -= d; r.flash = .08;
  if (r.hp > 0) return;
  r.dead = true; burst(r.x, r.y, 6 + r.size * 6, M.fx.rock, 30 + r.size * 15, .8); if (M.kid) rings.push({ x: r.x, y: r.y, r: 2, max: 10 + r.r, life: .4, c: '#ffffff' }); noise(.12 + r.size * .08, .06, 600);
  if (r.size >= 2) for (let i = 0; i < 2; i++) { const a = rnd(0, TAU), sp = rnd(20, 34); M.newRocks.push(mkRock(1, r.x + Math.cos(a) * 4, r.y + Math.sin(a) * 4, r.vx * .5 + Math.cos(a) * sp, r.vy * .5 + Math.sin(a) * sp, 2)); }
}
function splashAt(x, y, b) {
  rings.push({ x, y, r: 3, max: b.splash, life: .45, c: b.c }); M.shake = Math.max(M.shake, b.splash / 12); noise(.25, .05, 400);
  const d = Math.max(1, Math.ceil(b.dmg / 2)), R = b.splash;
  for (const r of M.rocks) if (!r.dead && Math.hypot(r.x - x, r.y - y) < R + r.r) hitRock(r, d);
  for (const m of M.mines) if (!m.dead && Math.hypot(m.x - x, m.y - y) < R + 6) mineBoom(m);
  const t0x = Math.floor((x - R) / TS), t1x = Math.floor((x + R) / TS), t0y = Math.floor((y - R) / TS), t1y = Math.floor((y + R) / TS);
  for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) if (mTile(tx, ty) === '%' && Math.hypot(tx * TS + 8 - x, ty * TS + 8 - y) < R + 8) hitTile(tx, ty, d);
}
function mineBoom(m) {
  if (m.dead) return; m.dead = true;
  rings.push({ x: m.x, y: m.y, r: 4, max: 36, life: .5, c: '#e31937' }); burst(m.x, m.y, 26, M.fx.boom, 80, .8);
  M.shake = Math.max(M.shake, 4); noise(.4, .1, 500);
  if (M.state === 'play' && near(m, 36)) mDie();
  for (const o of M.mines) if (!o.dead && o.arm < 0 && Math.hypot(o.x - m.x, o.y - m.y) < 48) o.arm = .18;
  for (const r of M.rocks) if (!r.dead && Math.hypot(r.x - m.x, r.y - m.y) < 36 + r.r) hitRock(r, 99);
  const tx0 = Math.floor((m.x - 36) / TS), tx1 = Math.floor((m.x + 36) / TS), ty0 = Math.floor((m.y - 36) / TS), ty1 = Math.floor((m.y + 36) / TS);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (mTile(tx, ty) === '%') hitTile(tx, ty, 99);
}
function mBullets(dt) {
  for (const b of bullets) {
    if (b.life <= 0) continue;
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    const tx = Math.floor(b.x / TS), ty = Math.floor(b.y / TS), c = mTile(tx, ty);
    if (mSolid(c)) { if (c === '%') hitTile(tx, ty, b.dmg); if (b.splash) splashAt(b.x, b.y, b); burst(b.x - b.vx * dt, b.y - b.vy * dt, 3, [b.c, '#8e8f93'], 30, .25); b.life = 0; continue; }
    for (const r of M.rocks) {
      if (r.dead || b.hit.has(r)) continue;
      if (Math.hypot(r.x - b.x, r.y - b.y) < r.r + b.r) { b.hit.add(r); hitRock(r, b.dmg); burst(b.x, b.y, 3, [b.c, '#fff'], 40, .3); if (b.splash) splashAt(b.x, b.y, b); if (b.pierce > 0) b.pierce--; else { b.life = 0; break; } }
    }
    if (b.life <= 0) continue;
    for (const m of M.mines) if (!m.dead && Math.hypot(m.x - b.x, m.y - b.y) < 6 + b.r) { mineBoom(m); if (b.pierce > 0) b.pierce--; else { b.life = 0; break; } }
  }
  bullets = bullets.filter(b => b.life > 0);
  if (M.newRocks.length) { M.rocks.push(...M.newRocks); M.newRocks.length = 0; }
  M.rocks = M.rocks.filter(r => !r.dead);
}
function camUpdate(dt, snap) {
  const Lw = M.L.w * TS, Lh = M.L.h * TS;
  let tx = P.x + P.vx * .3 - W / 2, ty = P.y + P.vy * .3 - H / 2;
  tx = Lw <= W ? (Lw - W) / 2 : clamp(tx, 0, Lw - W); ty = Lh <= H ? (Lh - H) / 2 : clamp(ty, 0, Lh - H);
  if (snap) { CAM.x = tx; CAM.y = ty; return; }
  const q = Math.min(1, dt * 5); CAM.x += (tx - CAM.x) * q; CAM.y += (ty - CAM.y) * q;
}
function mRender() {
  if (M.kid) drawOrbitBg(ctx, CAM.x, CAM.y, M.lt); else { ctx.fillStyle = '#0b0c0f'; ctx.fillRect(0, 0, W, H); drawStarsParallax(CAM.x, CAM.y); }
  ctx.save();
  if (M.shake > 0 && !RM) ctx.translate(Math.round(rnd(-M.shake, M.shake)), Math.round(rnd(-M.shake, M.shake)));
  ctx.translate(-Math.round(CAM.x), -Math.round(CAM.y));
  const t = M.lt, L = M.L, get = (x, y) => mTile(x, y), o = { keyOpen: M.key, theme: M.theme }, th = M.theme;
  const x0 = Math.max(0, Math.floor(CAM.x / TS) - 1), x1 = Math.min(L.w - 1, Math.floor((CAM.x + W) / TS) + 1);
  const y0 = Math.max(0, Math.floor(CAM.y / TS) - 1), y1 = Math.min(L.h - 1, Math.floor((CAM.y + H) / TS) + 1);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) { const ch = L.g[ty][tx]; if (ch === '.') continue; o.hp = ch === '%' ? M.hp.get(ty * L.w + tx) : undefined; drawTile(ctx, get, tx, ty, ch, t, o); }
  const vis = q => q.x > CAM.x - 120 && q.x < CAM.x + W + 120 && q.y > CAM.y - 120 && q.y < CAM.y + H + 120;
  for (const q of M.wells) if (vis(q)) drawGlyph(ctx, 'G', q.x, q.y, t, { theme: th });
  for (const q of M.reps) if (vis(q)) drawGlyph(ctx, 'R', q.x, q.y, t, { theme: th });
  for (const q of M.worms) if (vis(q)) drawGlyph(ctx, 'W', q.x, q.y, t, { theme: th });
  for (const q of M.exitList) if (vis(q)) drawGlyph(ctx, 'E', q.x, q.y, t, { theme: th });
  for (const q of M.checkList) if (vis(q)) drawGlyph(ctx, 'C', q.x, q.y, t, { on: q.on, theme: th });
  for (const q of M.coreList) if (!q.got && vis(q)) drawGlyph(ctx, '*', q.x, q.y + Math.sin(t * 3 + q.ph) * 1.5, t, { ph: q.ph, theme: th });
  for (const q of M.fuelList) if (!q.got && vis(q)) drawGlyph(ctx, '+', q.x, q.y, t, { theme: th });
  for (const q of M.keyList) if (!q.got && vis(q)) drawGlyph(ctx, 'k', q.x, q.y + Math.sin(t * 3) * 1.5, t, { theme: th });
  for (const q of M.mines) if (!q.dead && vis(q)) drawGlyph(ctx, 'M', q.x, q.y, t, { armed: q.arm >= 0, theme: th });
  for (const r of M.rocks) if (vis(r)) { if (M.kid) drawSootling(ctx, r.x, r.y, r.r * 1.15, r.flash); else drawAst(r); }
  drawBullets(th); drawFx(th);
  if (M.state !== 'dead' && !(P.inv > 0 && Math.floor(P.inv * 12) % 2)) drawCar(P.x, P.y, P.a, vehScale(M.ship), M.ship);
  ctx.restore();
  if (M.flash > 0) { ctx.globalAlpha = Math.min(.6, M.flash * 2.4); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  mHUD();
}
function mHUD() {
  ctx.fillStyle = M.kid ? 'rgba(20,12,63,.65)' : 'rgba(11,12,15,.6)'; ctx.fillRect(0, 0, W, 16);
  txt(String(M.src.label || M.def.name || '').toUpperCase().slice(0, 20), 6, 4, '#8e8f93');
  const par = +M.def.par || 0;
  txt(fmtTime(M.t), W / 2, 4, par && M.t > par ? '#8e8f93' : '#f4f4f4', 'center');
  if (M.total) { drawGlyph(ctx, '*', W - 44, 8, M.lt, { theme: M.theme }); txt(M.cores + '/' + M.total, W - 6, 4, M.cores >= M.total ? '#e31937' : '#f4f4f4', 'right'); }
  if (M.key) drawGlyph(ctx, 'k', W - 70, 8, M.lt, { theme: M.theme });
  if (M.fuelMax > 0) {
    const f = M.fuel / M.fuelMax, low = f < .25;
    ctx.fillStyle = 'rgba(11,12,15,.6)'; ctx.fillRect(0, 16, 104, 12);
    txt('FUEL', 6, 19, '#8e8f93', 'left', 6);
    ctx.fillStyle = '#24272e'; ctx.fillRect(34, 20, 64, 4); ctx.fillStyle = low ? '#e31937' : '#f4f4f4'; ctx.fillRect(34, 20, Math.round(64 * f), 4);
  }
  if (M.hint > 0 && M.state === 'play') {
    const lines = wrapText(M.def.hint, 40), bw = Math.max(...lines.map(l => l.length)) * 8 + 16, bh = lines.length * 12 + 8, x = (W - bw) / 2, y = 34;
    ctx.globalAlpha = Math.min(1, M.hint); ctx.fillStyle = 'rgba(11,12,15,.85)'; ctx.fillRect(x, y, bw, bh); ctx.strokeStyle = '#393c41'; ctx.strokeRect(x + .5, y + .5, bw - 1, bh - 1);
    lines.forEach((l, i) => txt(l, W / 2, y + 6 + i * 12, '#f4f4f4', 'center'));
    ctx.globalAlpha = 1;
  }
  drawBanner(M.banner);
}

// =====================================================================
// EDITOR
// =====================================================================
const SHORT = { '#': 'Rock', '%': 'Cracked', 'E': 'Exit', 'C': 'Check', '*': 'Core', '+': 'Fuel', 'o': 'Rock', 'O': 'Big rock', 'G': 'Gravity', 'R': 'Repulse', '^': 'Wind up', 'v': 'Wind dn', '<': 'Wind lt', '>': 'Wind rt', 'W': 'Worm', 'l': 'Laser A', 'L': 'Laser B' };
const ED_TOOLS = ['move', 'erase', ...'#%SECk*+DoOMlLGR^v<>W'];
function edNewDef() { return { name: 'My Level', world: 1, fuel: 0, par: 30, hint: '', theme: 'orbit', map: KIT.blank(48, 15) }; }
const edTheme = () => ED && ED.def.theme === 'orbit' ? 'orbit' : 'classic';
function tileInfo(tl) { if (edTheme() === 'orbit' && KIT.ORBIT_NAMES[tl]) { const [name, tip] = KIT.ORBIT_NAMES[tl]; return { name, tip, group: KIT.TILES[tl].group }; } return KIT.TILES[tl]; }
const SHORT_ORBIT = { '#': 'Hull', '%': 'Static', 'E': 'Charge', 'C': 'Pylon', '*': 'Spark', '+': 'Battery', 'k': 'Key card', 'D': 'Field', 'o': 'Sootling', 'O': 'Big soot', 'M': 'Bubble', 'l': 'Cyan', 'L': 'Pink', 'G': 'Swirl', 'R': 'Bumper', '^': 'Breeze up', 'v': 'Breeze dn', '<': 'Breeze lt', '>': 'Breeze rt', 'W': 'Warp' };
function openEditor(def) {
  def = JSON.parse(JSON.stringify(def || store.get('tezzie-draft', null) || edNewDef()));
  const rows = KIT.rows(def.map);
  ED = { def, g: rows.map(r => r.split('')), cam: { x: -24, y: -40 }, tool: ED && ED.tool || '#', drag: null, hover: null, v: null };
  ED.def.map = rows;
  scene = 'editor'; showOverlay('ov-editor'); setChrome();
  buildPalette(); edSync(false); edCenter();
}
const edW = () => ED.g[0].length, edH = () => ED.g.length;
function edCenter() { const s = ED.def.map.join('').indexOf('S'), w = edW(); const sx = s >= 0 ? s % w : 0, sy = s >= 0 ? Math.floor(s / w) : 0; ED.cam.x = sx * TS - 80; ED.cam.y = sy * TS - H / 2 + 6; edClampCam(); }
function edClampCam() { const Lw = edW() * TS, Lh = edH() * TS; ED.cam.x = clamp(ED.cam.x, -60, Math.max(-60, Lw - W + 60)); ED.cam.y = clamp(ED.cam.y, -44, Math.max(-44, Lh - H + 60)); }
function edSync(save = true) {
  ED.def.map = ED.g.map(r => r.join(''));
  if (save) store.set('tezzie-draft', ED.def);
  ED.v = KIT.validate(ED.def);
  const chip = $('e-chip'), v = ED.v;
  chip.className = 'echip ' + (v.ok ? (v.warnings.length ? 'warn' : 'ok') : 'bad');
  chip.textContent = v.ok ? (v.warnings.length ? 'PLAYABLE · ' + v.warnings.length + ' NOTE' + (v.warnings.length > 1 ? 'S' : '') : 'ROUTE OK') : 'NOT PLAYABLE';
  $('e-name').textContent = (ED.def.name || 'Untitled').toUpperCase();
  $('e-world').textContent = edTheme() === 'orbit' ? 'W' + (ED.def.world || 1) + ' TEZZIE' + ((ED.def.world || 1) > 1 ? ' · ZAP' : '') : 'W' + (ED.def.world || 1) + ' ' + VEH[(ED.def.world || 1) - 1].name;
}
function evPos(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
const edTileAt = p => ({ x: Math.floor((p.x + ED.cam.x) / TS), y: Math.floor((p.y + ED.cam.y) / TS) });
function edPaint(p) {
  const t = edTileAt(p); if (t.x < 0 || t.y < 0 || t.x >= edW() || t.y >= edH()) return;
  const ch = ED.tool === 'erase' ? '.' : ED.tool;
  if (ED.g[t.y][t.x] === ch) return;
  if (ch === 'S') for (const r of ED.g) for (let i = 0; i < r.length; i++) if (r[i] === 'S') r[i] = '.';
  ED.g[t.y][t.x] = ch; ED.changed = true;
}
cv.addEventListener('pointerdown', e => {
  if (scene !== 'editor') return; e.preventDefault(); audio();
  try { cv.setPointerCapture(e.pointerId); } catch (er) {}
  const p = evPos(e);
  ED.drag = { x: p.x, y: p.y, cx: ED.cam.x, cy: ED.cam.y, pan: ED.tool === 'move' || e.button === 1 || e.button === 2 };
  if (!ED.drag.pan) edPaint(p);
});
cv.addEventListener('pointermove', e => {
  if (scene !== 'editor') return;
  const p = evPos(e); ED.hover = edTileAt(p);
  if (!ED.drag) return;
  if (ED.drag.pan) { ED.cam.x = ED.drag.cx - (p.x - ED.drag.x); ED.cam.y = ED.drag.cy - (p.y - ED.drag.y); edClampCam(); }
  else edPaint(p);
});
['pointerup', 'pointercancel'].forEach(t => cv.addEventListener(t, () => { if (scene === 'editor' && ED.drag) { ED.drag = null; if (ED.changed) { ED.changed = false; edSync(); } } }));
cv.addEventListener('pointerleave', () => { if (scene === 'editor') ED.hover = null; });
cv.addEventListener('contextmenu', e => { if (scene === 'editor') e.preventDefault(); });
cv.addEventListener('wheel', e => { if (scene !== 'editor') return; e.preventDefault(); const r = cv.getBoundingClientRect(), s = W / r.width; ED.cam.x += (e.shiftKey ? e.deltaY : e.deltaX) * s; ED.cam.y += (e.shiftKey ? 0 : e.deltaY) * s; edClampCam(); }, { passive: false });
function edUpdate(dt) {
  const sp = 260 * dt;
  if (k('ArrowLeft', 'KeyA')) ED.cam.x -= sp; if (k('ArrowRight', 'KeyD')) ED.cam.x += sp;
  if (k('ArrowUp', 'KeyW')) ED.cam.y -= sp; if (k('ArrowDown', 'KeyS')) ED.cam.y += sp;
  edClampCam();
}
function edRender() {
  const kidLook = edTheme() === 'orbit';
  if (kidLook) { drawOrbitBg(ctx, ED.cam.x, ED.cam.y, performance.now() / 1000); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, H); } else { ctx.fillStyle = '#060708'; ctx.fillRect(0, 0, W, H); }
  ctx.save(); ctx.translate(-Math.round(ED.cam.x), -Math.round(ED.cam.y));
  const w = edW(), h = edH(), t = performance.now() / 1000;
  const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? '#' : ED.g[y][x];
  ctx.fillStyle = kidLook ? 'rgba(53,23,110,.45)' : '#0d0f13'; ctx.fillRect(0, 0, w * TS, h * TS);
  const x0 = Math.max(0, Math.floor(ED.cam.x / TS)), x1 = Math.min(w - 1, Math.floor((ED.cam.x + W) / TS));
  const y0 = Math.max(0, Math.floor(ED.cam.y / TS)), y1 = Math.min(h - 1, Math.floor((ED.cam.y + H) / TS));
  for (let x = x0; x <= x1 + 1; x++) { ctx.fillStyle = x % 5 ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.08)'; ctx.fillRect(x * TS, y0 * TS, 1, (y1 - y0 + 1) * TS); }
  for (let y = y0; y <= y1 + 1; y++) { ctx.fillStyle = y % 5 ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.08)'; ctx.fillRect(x0 * TS, y * TS, (x1 - x0 + 1) * TS, 1); }
  const o = { editor: true, theme: edTheme() };
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) { const ch = ED.g[ty][tx]; if ('#%D^v<>lL'.includes(ch)) drawTile(ctx, get, tx, ty, ch, t, o); }
  let wn = 0;
  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
    const ch = ED.g[ty][tx]; if (!'SECk*+oOMGRW'.includes(ch)) continue;
    const n = ch === 'W' ? Math.floor(wn++ / 2) + 1 : 0;
    const big = ch === 'G' || ch === 'R';
    if (!big && (tx < x0 - 1 || tx > x1 + 1 || ty < y0 - 1 || ty > y1 + 1)) continue;
    drawGlyph(ctx, ch, tx * TS + 8, ty * TS + 8, t, { editor: true, lv: ED.def.world || 1, n, theme: edTheme() });
  }
  ctx.strokeStyle = '#5c5e62'; ctx.lineWidth = 1; ctx.strokeRect(-.5, -.5, w * TS + 1, h * TS + 1);
  if (ED.hover && ED.hover.x >= 0 && ED.hover.y >= 0 && ED.hover.x < w && ED.hover.y < h) { ctx.strokeStyle = '#e31937'; ctx.strokeRect(ED.hover.x * TS + .5, ED.hover.y * TS + .5, TS - 1, TS - 1); }
  ctx.restore();
}
function toolIcon(tool) {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32; const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  if (tool === 'move') { x.fillStyle = '#d0d1d2'; x.fillRect(15, 7, 2, 18); x.fillRect(7, 15, 18, 2); for (let i = 0; i < 4; i++) { x.fillRect(16 - i, 6 + i, 2 * i, 1); x.fillRect(16 - i, 25 - i, 2 * i, 1); x.fillRect(6 + i, 16 - i, 1, 2 * i); x.fillRect(25 - i, 16 - i, 1, 2 * i); } return c; }
  if (tool === 'erase') { x.strokeStyle = '#8e8f93'; x.strokeRect(8.5, 8.5, 15, 15); x.fillStyle = '#e31937'; for (let i = 0; i < 12; i++) { x.fillRect(10 + i, 10 + i, 2, 2); x.fillRect(21 - i, 10 + i, 2, 2); } return c; }
  const ch = tool, get = () => '.';
  x.translate(8, 8);
  const th = edTheme();
  if (th === 'orbit') { x.save(); x.translate(-8, -8); x.fillStyle = '#1d1452'; x.fillRect(0, 0, 32, 32); x.restore(); }
  if ('#%D^v<>lL'.includes(ch)) drawTile(x, get, 0, 0, ch, 0.3, { editor: true, theme: th });
  else { x.translate(-8, -8); x.save(); if (ch === 'G' || ch === 'R' || ch === 'E' || ch === 'W') { x.translate(16, 16); x.scale(.75, .75); x.translate(-16, -16); } drawGlyph(x, ch, 16, 16, 0.4, { lv: ED ? ED.def.world || 1 : 1, on: true, theme: th }); x.restore(); }
  return c;
}
function buildPalette() {
  const pal = $('e-pal'); pal.innerHTML = '';
  const names = { move: ['Move', 'Drag to look around the map. You can also scroll or use the arrow keys.'], erase: ['Erase', 'Clear tiles back to empty space.'] };
  let group = '';
  for (const tl of ED_TOOLS) {
    const info = names[tl] ? { name: names[tl][0], tip: names[tl][1], group: 'Tools' } : tileInfo(tl);
    if (info.group !== group) { group = info.group; const g = document.createElement('span'); g.className = 'pgroup'; g.textContent = group.toUpperCase(); pal.appendChild(g); }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ptool'; b.dataset.tool = tl; b.title = info.name + ': ' + info.tip;
    b.setAttribute('aria-pressed', ED.tool === tl); b.setAttribute('aria-label', info.name);
    const ic = toolIcon(tl); ic.className = 'picon'; b.appendChild(ic);
    const s = document.createElement('span'); s.textContent = ((edTheme() === 'orbit' ? SHORT_ORBIT[tl] : SHORT[tl]) || info.name).toUpperCase(); b.appendChild(s);
    b.addEventListener('click', () => { ED.tool = tl; [...pal.querySelectorAll('.ptool')].forEach(x => x.setAttribute('aria-pressed', x.dataset.tool === tl)); $('e-tip').textContent = info.name + ': ' + info.tip; sfx.click(); });
    pal.appendChild(b);
  }
  const cur = names[ED.tool] ? { name: names[ED.tool][0], tip: names[ED.tool][1] } : tileInfo(ED.tool);
  $('e-tip').textContent = cur.name + ': ' + cur.tip;
}
function edSettings() {
  const d = ED.def, worlds = KIT.WORLDS.map((w, i) => `<option value="${i + 1}"${(d.world || 1) === i + 1 ? ' selected' : ''}>World ${i + 1}: ${w.vehicle}, ${w.weapon}</option>`).join('');
  const box = dialog(`<h3>LEVEL SETTINGS</h3>
  <label>Name<input id="f-name" maxlength="32" value="${esc(d.name || '')}"></label>
  <div class="two"><label>Look<select id="f-theme">${Object.entries(KIT.THEMES).map(([k2, v]) => `<option value="${k2}"${(d.theme === 'orbit' ? 'orbit' : 'classic') === k2 ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
  <label>Ship and weapon (Orbit Ring always flies Tezzie)<select id="f-world">${worlds}</select></label></div>
  <div class="two"><label>Fuel in seconds (0 = unlimited)<input id="f-fuel" type="number" min="0" max="120" value="${+d.fuel || 0}"></label>
  <label>Par time for 3 stars (seconds)<input id="f-par" type="number" min="0" max="999" value="${+d.par || 0}"></label></div>
  <label>Hint shown at the start<input id="f-hint" maxlength="80" value="${esc(d.hint || '')}"></label>
  <div class="two"><label>Width in tiles (${KIT.MIN_W}-${KIT.MAX_W})<input id="f-w" type="number" min="${KIT.MIN_W}" max="${KIT.MAX_W}" value="${edW()}"></label>
  <label>Height in tiles (${KIT.MIN_H}-${KIT.MAX_H})<input id="f-h" type="number" min="${KIT.MIN_H}" max="${KIT.MAX_H}" value="${edH()}"></label></div>
  <div class="row"><button class="btn pri" id="f-apply" type="button">APPLY</button><button class="btn" id="f-cancel" type="button">CANCEL</button></div>
  <p class="note">Start over</p>
  <div class="row"><button class="btn" id="f-new" type="button">BLANK MAP</button><button class="btn" id="f-gen" type="button">RANDOM COURSE</button></div>`);
  $('f-cancel').onclick = closeDialog;
  $('f-apply').onclick = () => {
    d.name = $('f-name').value.trim() || 'Untitled'; d.world = clamp(+$('f-world').value || 1, 1, 7); d.theme = $('f-theme').value === 'orbit' ? 'orbit' : 'classic';
    d.fuel = clamp(Math.round(+$('f-fuel').value || 0), 0, 120); d.par = clamp(Math.round(+$('f-par').value || 0), 0, 999); d.hint = $('f-hint').value.trim();
    edResize(clamp(Math.round(+$('f-w').value || edW()), KIT.MIN_W, KIT.MAX_W), clamp(Math.round(+$('f-h').value || edH()), KIT.MIN_H, KIT.MAX_H));
    closeDialog(); buildPalette(); edSync(); edClampCam(); toast('Settings saved');
  };
  const twoTap = (btn, fn) => { let armed = false; btn.onclick = () => { if (!armed) { armed = true; btn.textContent = 'TAP AGAIN TO REPLACE THE MAP'; setTimeout(() => { armed = false; }, 3000); return; } fn(); }; };
  twoTap($('f-new'), () => { const w = clamp(+$('f-w').value || 48, KIT.MIN_W, KIT.MAX_W), h = clamp(+$('f-h').value || 15, KIT.MIN_H, KIT.MAX_H); ED.g = KIT.blank(w, h).map(r => r.split('')); delete ED.def.id; closeDialog(); edSync(); edCenter(); toast('New blank map'); });
  twoTap($('f-gen'), () => { const g = KIT.generate((Math.random() * 1e9) >>> 0, { world: clamp(+$('f-world').value || 1, 1, 7) }); Object.assign(ED.def, { world: g.world, fuel: g.fuel, par: g.par, hint: g.hint }); delete ED.def.id; ED.g = KIT.rows(g.map).map(r => r.split('')); closeDialog(); buildPalette(); edSync(); edCenter(); toast('Random course loaded. Edit away.'); });
  return box;
}
function edResize(nw, nh) {
  const ow = edW(), oh = edH(); if (nw === ow && nh === oh) return;
  const old = ED.g, rightWall = old.every(r => r[ow - 1] === '#'), bottomWall = old[oh - 1].every(c => c === '#');
  const g = Array.from({ length: nh }, (_, y) => Array.from({ length: nw }, (_, x) => (y < oh && x < ow) ? old[y][x] : '.'));
  if (nw > ow && rightWall) { for (let y = 0; y < Math.min(oh, nh); y++) g[y][ow - 1] = (y === 0 || (bottomWall && y === oh - 1)) ? '#' : '.'; for (let y = 0; y < nh; y++) g[y][nw - 1] = '#'; }
  if (nh > oh && bottomWall) { for (let x = 1; x < Math.min(ow, nw) - 1; x++) g[oh - 1][x] = '.'; for (let x = 0; x < nw; x++) g[nh - 1][x] = '#'; for (let y = oh - 1; y < nh; y++) { g[y][0] = '#'; g[y][nw - 1] = '#'; } }
  if (nw > ow) for (let x = ow; x < nw; x++) { g[0][x] = old[0][ow - 1] === '#' ? '#' : g[0][x]; }
  ED.g = g;
}
function edShare() {
  const code = KIT.encode(ED.def);
  dialog(`<h3>SHARE "${esc((ED.def.name || '').toUpperCase())}"</h3>
  <p class="note">Anyone with Tezzie can paste this code in Missions, then Import code, to play your level.</p>
  <textarea id="f-code" readonly rows="4">${esc(code)}</textarea>
  <div class="row"><button class="btn pri" id="f-copy" type="button">COPY CODE</button><button class="btn" id="f-close" type="button">DONE</button></div>`);
  $('f-close').onclick = closeDialog;
  $('f-copy').onclick = () => copyText(code, $('f-code'), $('f-copy'));
}
function edSave() {
  if (!ED.v || !ED.v.ok) { toast('Fix the route first: ' + (ED.v ? ED.v.errors[0] : '')); return; }
  if (!ED.def.id) ED.def.id = 'c' + Date.now().toString(36);
  const copy = JSON.parse(JSON.stringify(ED.def)), i = CUSTOM.findIndex(c => c.id === copy.id);
  if (i >= 0) CUSTOM[i] = copy; else CUSTOM.unshift(copy);
  saveCustom(); edSync(); toast('Saved to Your Levels');
}
function edTest() {
  if (!ED.v || !ED.v.ok) { edReport(); return; }
  startMission(JSON.parse(JSON.stringify(ED.def)), { type: 'editor', label: 'TEST ' + (ED.def.name || '') });
}
function edReport() {
  const v = ED.v;
  dialog(`<h3>${v.ok ? 'LEVEL CHECK' : 'NOT PLAYABLE YET'}</h3>
  ${v.errors.length ? '<ul class="issues bad">' + v.errors.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>' : '<p class="note">There is a route from the start to an exit for this ship.</p>'}
  ${v.warnings.length ? '<ul class="issues">' + v.warnings.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>' : ''}
  <div class="row"><button class="btn pri" id="f-close" type="button">OK</button></div>`);
  $('f-close').onclick = closeDialog;
}

// =====================================================================
// SCREENS AND OVERLAYS
// =====================================================================
function showOverlay(id) { document.querySelectorAll('.screen > .ov').forEach(o => { o.hidden = o.id !== id; }); }
function dialog(html) { const d = $('ov-dialog'); $('dlg').innerHTML = html; d.hidden = false; const f = $('dlg').querySelector('input,select,textarea,button'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 30); return $('dlg'); }
function closeDialog() { $('ov-dialog').hidden = true; }
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
function copyText(text, area, btn) {
  const done = () => { btn.textContent = 'COPIED'; };
  const sel = () => { area.focus(); area.select(); btn.textContent = 'SELECTED, NOW COPY'; };
  try { navigator.clipboard.writeText(text).then(done, sel); } catch (e) { sel(); }
}
function setChrome() {
  const playing = (scene === 'arcade' && S.mode === 'play') || (scene === 'mission' && !M.paused && M.state !== 'clear');
  $('padL').hidden = $('padR').hidden = !playing;
  $('fireBtn').hidden = scene === 'mission' && M && M.lv === 1;
  $('pbtn').hidden = !playing;
  $('sbtn').textContent = $('p-sound').textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  document.body.dataset.scene = scene;
}
function openMenu() {
  scene = 'menu'; if (!S || S.mode !== 'title') reset('title');
  M = null; bullets = []; for (const x in keys) keys[x] = false;
  const ts = totalStars();
  $('m-stars').innerHTML = '<span class="sg">★</span> ' + ts + ' / ' + LEVELS.length * 3;
  $('m-hi').textContent = 'HI ' + String(HI).padStart(6, '0');
  const db = PROG['daily-' + todayKey()];
  $('m-daily').textContent = db ? 'BEST ' + fmtTime(db.t) : 'NEW COURSE TODAY';
  showOverlay('ov-menu'); setChrome();
}
function startArcade() { audio(); reset('play'); scene = 'arcade'; showOverlay(null); setChrome(); cv.focus({ preventScroll: true }); }
function showOver() {
  $('o-score').textContent = String(Math.floor(S.score)).padStart(6, '0');
  $('o-detail').textContent = 'REACHED LV' + S.level + ' ' + VEH[S.level - 1].name + ' · SECTOR ' + S.wave;
  $('o-hi').textContent = S.newHi ? 'NEW HIGH SCORE' : 'HI ' + String(HI).padStart(6, '0');
  $('o-hi').className = S.newHi ? 'hot' : '';
  showOverlay('ov-over'); setChrome(); setTimeout(() => $('o-again').focus({ preventScroll: true }), 50);
}
function pauseGame() {
  for (const x in keys) keys[x] = false;
  document.querySelectorAll('.pad button.on').forEach(b => b.classList.remove('on'));
  if (scene === 'arcade' && S.mode === 'play') S.mode = 'pause';
  else if (scene === 'mission' && M && !M.paused && M.state !== 'clear') M.paused = true;
  else return;
  $('p-title').textContent = scene === 'mission' ? String(M.src.label || M.def.name).toUpperCase() : 'ARCADE';
  $('p-restart').hidden = false;
  showOverlay('ov-pause'); setChrome(); setTimeout(() => $('p-resume').focus({ preventScroll: true }), 50);
}
function resumeGame() {
  if (scene === 'arcade' && S.mode === 'pause') S.mode = 'play';
  else if (scene === 'mission' && M) M.paused = false;
  showOverlay(null); setChrome(); cv.focus({ preventScroll: true });
}
const isPaused = () => (scene === 'arcade' && S.mode === 'pause') || (scene === 'mission' && M && M.paused);
function quitToSource() {
  if (scene === 'arcade') return openMenu();
  const src = M && M.src || {};
  if (src.type === 'editor') return backToEditor();
  if (src.type === 'campaign' || src.type === 'custom') return openLevels();
  openMenu();
}
function backToEditor() { scene = 'editor'; M = null; showOverlay('ov-editor'); setChrome(); edSync(false); }
function showResult() {
  const src = M.src, n = M.stars.filter(Boolean).length, par = +M.def.par || 0;
  $('r-title').textContent = M.kid ? 'CHARGED UP!' : (src.type === 'editor' ? 'TEST CLEAR' : (src.type === 'random' || src.type === 'daily' ? 'COURSE CLEAR' : 'LEVEL CLEAR'));
  $('r-name').textContent = String(src.label || M.def.name).toUpperCase();
  const labels = ['CLEARED', M.kid ? 'ALL SPARKS' : 'ALL CORES', par ? 'UNDER ' + fmtTime(par) : 'NO PAR'];
  $('r-stars').innerHTML = M.stars.map((s, i) => `<span class="st${s ? ' on' : ''}"><b class="sg">★</b><small>${labels[i]}</small></span>`).join('');
  const best = M.src.id && PROG[M.src.id] ? PROG[M.src.id].t : null;
  $('r-stats').innerHTML = `<span>TIME <b>${fmtTime(M.t)}</b>${M.newBest && M.prev ? ' <em>NEW BEST</em>' : (best && best < M.t ? ' <i>BEST ' + fmtTime(best) + '</i>' : '')}</span><span>${M.kid ? 'SPARKS' : 'CORES'} <b>${M.cores}/${M.total}</b></span><span>${M.kid ? 'BONKS' : 'WRECKS'} <b>${M.deaths}</b></span>${src.seed ? `<span>SEED <b>${src.seed}</b></span>` : ''}`;
  const btns = [];
  if (src.type === 'campaign') { const i = nextInTrack(src.index); if (i >= 0) btns.push(['NEXT', () => playCampaign(i), true]); btns.push(['RETRY', restartMission]); btns.push(['LEVELS', openLevels]); }
  else if (src.type === 'custom') { btns.push(['RETRY', restartMission, true]); btns.push(['EDIT', () => openEditor(M.def)]); btns.push(['LEVELS', openLevels]); }
  else if (src.type === 'editor') { btns.push(['BACK TO EDITOR', backToEditor, true]); btns.push(['RETRY', restartMission]); }
  else if (src.type === 'random') { btns.push(['NEW COURSE', () => playRandom(), true]); btns.push(['RETRY', restartMission]); btns.push(['EDIT', () => openEditor(Object.assign({}, M.def, { name: M.def.name }))]); btns.push(['MENU', openMenu]); }
  else { btns.push(['RETRY', restartMission, true]); btns.push(['MENU', openMenu]); }
  const box = $('r-btns'); box.innerHTML = '';
  btns.forEach(([t, fn, pri]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (pri ? ' pri' : ''); b.textContent = t; b.onclick = () => { sfx.click(); fn(); }; box.appendChild(b); });
  showOverlay('ov-result'); setChrome(); setTimeout(() => box.firstChild && box.firstChild.focus({ preventScroll: true }), 50);
}
function playCampaign(i) { const l = LEVELS[i]; startMission(l, { type: 'campaign', id: l.id, index: i, label: l.id + ' ' + l.name }); }
function playRandom(seed) { seed = seed || ((Math.random() * 1e9) >>> 0); const d = KIT.generate(seed); startMission(d, { type: 'random', seed, label: d.name }); }
function playDaily() { const d = dailyDef(); startMission(d, { type: 'daily', id: 'daily-' + todayKey(), label: 'DAILY ' + d.name }); }
function openLevels() {
  scene = 'menu'; if (!S || S.mode !== 'title') reset('title'); M = null;
  buildLevels(); showOverlay('ov-levels'); setChrome();
}
function buildLevels() {
  $('lv-stars').innerHTML = '<span class="sg">★</span> ' + totalStars() + ' / ' + LEVELS.length * 3;
  const box = $('lv-list'); box.innerHTML = '';
  CAMPAIGN.worlds.forEach((wd, wi) => {
    const row = document.createElement('section'); row.className = 'wrow';
    const info = document.createElement('div'); info.className = 'winfo';
    const kid = !!wd.zone, n = kid ? 1 : wd.num;
    if (kid) row.classList.add('kids');
    info.innerHTML = kid
      ? `<img alt="" src="${sprites[0].toDataURL()}"><span class="wn">FOR YOUNG PILOTS</span><span class="wt">${esc(wd.name.toUpperCase())}</span><span class="wd">${esc(wd.desc)}</span><span class="ww" style="color:#ffe14d">TEZZIE \u00B7 SPARK ZAP</span>`
      : `<img alt="" src="${sprites[n - 1].toDataURL()}"><span class="wn">WORLD ${n}</span><span class="wt">${esc(wd.name.toUpperCase())}</span><span class="wd">${esc(wd.desc)}</span><span class="ww" style="color:${WEAPONS[n - 1].c}">${VEH[n - 1].name} \u00B7 ${WEAPONS[n - 1].name}</span>`;
    row.appendChild(info);
    const grid = document.createElement('div'); grid.className = 'lgrid';
    LEVELS.forEach((l, i) => {
      if (kid ? l.zone !== wd.zone : (l.zone || l.world !== n)) return;
      const open = isUnlocked(i), p = PROG[l.id], s = p ? p.s : 0;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lvb' + (p ? ' done' : ''); b.disabled = !open;
      b.innerHTML = `<span class="lid">${l.id}</span><span class="lname">${open ? esc(l.name.toUpperCase()) : 'LOCKED'}</span><span class="lst">${open ? starHTML(s) : ''}</span>${p ? `<span class="lt">${fmtTime(p.t)}</span>` : ''}`;
      if (open) b.onclick = () => { sfx.click(); playCampaign(i); };
      grid.appendChild(b);
    });
    row.appendChild(grid); box.appendChild(row);
  });
  const cs = $('lv-custom'); cs.innerHTML = '';
  if (!CUSTOM.length) cs.innerHTML = '<p class="empty">No levels yet. Build one in the editor or import a code someone shared with you.</p>';
  CUSTOM.forEach((c, ci) => {
    const p = PROG[c.id], s = p ? p.s : 0, card = document.createElement('div'); card.className = 'ccard';
    card.innerHTML = `<img alt="" src="${sprites[(c.world || 1) - 1].toDataURL()}"><span class="cname">${esc(String(c.name || 'Untitled').toUpperCase())}<small>W${c.world || 1} ${starHTML(s)}</small></span>`;
    const acts = document.createElement('span'); acts.className = 'cacts';
    const add = (t, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm' + (cls ? ' ' + cls : ''); b.textContent = t; b.onclick = () => fn(b); acts.appendChild(b); };
    add('PLAY', () => startMission(c, { type: 'custom', id: c.id, label: c.name }), 'pri');
    add('EDIT', () => openEditor(c));
    add('SHARE', () => { const code = KIT.encode(c); dialog(`<h3>SHARE "${esc(String(c.name).toUpperCase())}"</h3><textarea id="f-code" readonly rows="4">${esc(code)}</textarea><div class="row"><button class="btn pri" id="f-copy" type="button">COPY CODE</button><button class="btn" id="f-close" type="button">DONE</button></div>`); $('f-close').onclick = closeDialog; $('f-copy').onclick = () => copyText(code, $('f-code'), $('f-copy')); });
    add('DELETE', b => { if (b.dataset.armed) { CUSTOM.splice(ci, 1); saveCustom(); buildLevels(); toast('Level deleted'); return; } b.dataset.armed = '1'; b.textContent = 'SURE?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'DELETE'; } }, 3000); });
    card.appendChild(acts); cs.appendChild(card);
  });
  $('lv-test').hidden = !TEST_TOOLS;
  $('lv-unlock').textContent = unlockAll ? 'LOCK LEVELS AGAIN' : 'UNLOCK ALL (TESTING)';
}
function importDialog() {
  dialog(`<h3>IMPORT A LEVEL</h3><p class="note">Paste a level code. Codes start with TZ1-.</p>
  <textarea id="f-code" rows="4" placeholder="TZ1-..."></textarea><p class="err" id="f-err" hidden></p>
  <div class="row"><button class="btn pri" id="f-imp" type="button">IMPORT</button><button class="btn" id="f-close" type="button">CANCEL</button></div>`);
  $('f-close').onclick = closeDialog;
  $('f-imp').onclick = () => {
    const err = $('f-err');
    try {
      const d = KIT.decode($('f-code').value), v = KIT.validate(d);
      if (!v.ok) throw new Error('This level cannot be finished: ' + v.errors[0]);
      d.id = 'c' + Date.now().toString(36); CUSTOM.unshift(d); saveCustom(); closeDialog(); buildLevels(); toast('Imported "' + d.name + '"');
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  };
}

// ---------- buttons ----------
const on = (id, fn) => $(id).addEventListener('click', () => { audio(); sfx.click(); fn(); });
on('m-missions', openLevels); on('m-arcade', startArcade); on('m-dailyb', playDaily); on('m-random', () => playRandom()); on('m-editor', () => openEditor());
on('lv-back', openMenu); on('lv-new', () => { store.set('tezzie-draft', null); openEditor(edNewDef()); }); on('lv-import', importDialog); on('lv-editor', () => openEditor());
on('lv-unlock', () => { unlockAll = !unlockAll; store.set('tezzie-unlock', unlockAll); buildLevels(); });
on('p-resume', resumeGame); on('p-restart', () => { if (scene === 'arcade') startArcade(); else restartMission(); }); on('p-quit', quitToSource);
on('o-again', startArcade); on('o-menu', openMenu);
on('e-back', openMenu); on('e-set', edSettings); on('e-name', edSettings); on('e-world', edSettings); on('e-chip', edReport); on('e-share', edShare); on('e-save', edSave); on('e-test', edTest);
$('ov-dialog').addEventListener('click', e => { if (e.target.id === 'ov-dialog') closeDialog(); });
const garage = $('garage');
on('gbtn', () => { garage.hidden = false; updateLadder(); });
on('gclose', () => { garage.hidden = true; });
on('pbtn', () => { if (isPaused()) resumeGame(); else pauseGame(); });
const toggleSound = () => { muted = !muted; store.set('tezzie-muted', muted); setChrome(); if (!muted) sfx.click(); };
on('sbtn', toggleSound); on('p-sound', toggleSound);

// ---------- input ----------
const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyJ', 'KeyF'];
addEventListener('keydown', e => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { if (e.code === 'Escape') closeDialog(); return; }
  if (!$('ov-dialog').hidden) { if (e.code === 'Escape') closeDialog(); return; }
  if (!garage.hidden) { if (e.code === 'Escape') garage.hidden = true; return; }
  const live = (scene === 'arcade' && S.mode === 'play') || (scene === 'mission' && M && !M.paused && !M.shown) || scene === 'editor';
  if (GAME_KEYS.includes(e.code) && live) { e.preventDefault(); keys[e.code] = true; audio(); }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (scene === 'arcade' || scene === 'mission') { if (isPaused()) resumeGame(); else if (scene === 'mission' && M && M.shown) quitToSource(); else if (scene === 'arcade' && S.mode === 'over') openMenu(); else pauseGame(); }
    else if (scene === 'editor' && e.code === 'Escape') openMenu();
    else if (scene === 'menu' && e.code === 'Escape' && !$('ov-levels').hidden) openMenu();
  }
  if (e.code === 'KeyR' && scene === 'mission' && M && !M.paused) restartMission();
  if (e.code === 'KeyM') toggleSound();
});
addEventListener('keyup', e => { keys[e.code] = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
addEventListener('blur', () => { for (const c in keys) keys[c] = false; pauseGame(); });
document.querySelectorAll('.pad button').forEach(b => {
  const c = b.dataset.k;
  const down = e => { e.preventDefault(); audio(); keys[c] = true; b.classList.add('on'); };
  const up = () => { keys[c] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', down); ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => b.addEventListener(t, up));
  b.addEventListener('contextmenu', e => e.preventDefault());
});
function fitUI() { const r = $('screen').getBoundingClientRect(); if (r.width) document.documentElement.style.setProperty('--u', (r.width / W) + 'px'); }
addEventListener('resize', fitUI); if (window.ResizeObserver) new ResizeObserver(fitUI).observe($('screen')); fitUI();
try { window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar && window.Capacitor.Plugins.StatusBar.hide(); } catch (e) {}

// test hook used by the screenshot and playtest scripts
window.__tezzie = { startMission, playCampaign, playRandom, openEditor, openLevels, openMenu, startArcade, levels: LEVELS, kit: KIT, get M() { return M; }, get P() { return P; }, keys };

// ---------- loop ----------
openMenu();
let last = performance.now();
function loop(now) {
  const dt = Math.min(.033, (now - last) / 1000); last = now;
  if (scene === 'menu' || scene === 'arcade') { arcUpdate(dt); arcRender(); }
  else if (scene === 'mission') { mUpdate(dt); mRender(); }
  else if (scene === 'editor') { edUpdate(dt); edRender(); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
