// Greed: screen, input, modes, statistics and the CRT look.
// (build.py puts game.js in front of this file, so Greed, DIRS, SIZES and friends are in scope.)

const $ = (s, el = document) => el.querySelector(s);
const crt = $('#crt'), canvas = $('#board'), ctx = canvas.getContext('2d');
const native = window.GreedApp || null;   // the Android bridge, when running in the app

// ───────────────────────── storage ─────────────────────────
const KEY = 'greed.v1';
const DEFAULTS = {
  theme: 'color', font: 'vt', scan: 'med', glow: true, curve: true, flicker: false, roll: true,
  sound: true, haptic: true, oneTap: false, showMoves: false, pad: 'auto', speed: 'normal',
  mode: 'classic', size: 'auto', cpuLevel: 'expert', cpuSpeed: 'normal',
};
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch {}
  s = s && typeof s === 'object' ? s : {};
  s.set = Object.assign({}, DEFAULTS, s.set || {});
  if (!s.set._seen && matchMedia('(prefers-reduced-motion: reduce)').matches) { s.set.roll = false; s.set.flicker = false; }
  s.set._seen = 1;
  s.games ||= []; s.ach ||= {}; s.daily ||= {}; s.life ||= { digits: Array(10).fill(0), cells: 0, moves: 0, undos: 0, hints: 0 };
  return s;
}
const S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }

// ───────────────────────── modes ─────────────────────────
const MODES = {
  classic:  { name: 'Classic',  desc: 'The original. No undo, no hints. Eat as much as you can.' },
  relaxed:  { name: 'Relaxed',  desc: 'Undo and hints as often as you like. Kept in its own records.', undo: true, hint: true },
  daily:    { name: 'Daily',    desc: 'The board of the day, the same for everyone. Your first finished game counts.' },
  blitz:    { name: 'Blitz',    desc: '90 seconds on the clock. Move fast, think faster.', clock: 90 },
  treasure: { name: 'Treasure', desc: 'Gems (highlighted digits) are worth 5 points each. Plan your route to them.', gems: true },
  computer: { name: 'Computer', desc: 'Sit back and watch the computer play. Pick its level and speed; its results are tracked separately.', cpu: true },
};
const PLAYER_MODES = Object.keys(MODES).filter(m => !MODES[m].cpu);
const CPU_LEVELS = {
  random: { name: 'Random', desc: 'any legal move' },
  greedy: { name: 'Greedy', desc: 'always the biggest bite' },
  smart:  { name: 'Smart',  desc: 'looks 2 moves ahead' },
  expert: { name: 'Expert', desc: 'looks 3–4 moves ahead and keeps space open' },
};
const CPU_SPEEDS = { slow: 700, normal: 250, fast: 80, turbo: 12, instant: 0 };
const isMine = (r) => !MODES[r.m]?.cpu;
const DAILY_SIZE = { w: 40, h: 24 };
const SIZE_OPTS = { auto: 'Fit screen', classic: 'Classic 79×22', medium: 'Medium 40×24', large: 'Large 60×30' };
const FIXED = { classic: SIZES.classic, medium: { w: 40, h: 24 }, large: SIZES.wide };

function today(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function autoSize() {
  const r = $('#boardwrap').getBoundingClientRect();
  const W = Math.max(200, r.width), H = Math.max(160, r.height);
  const cw = innerWidth < 600 ? 12.5 : 14;
  return { w: Math.max(16, Math.min(79, Math.floor(W / cw))), h: Math.max(10, Math.min(40, Math.floor(H / (cw * 1.75)))) };
}

// ───────────────────────── the current game ─────────────────────────
let G = null;
// G = { g, mode, gems:Set, undos, hints, elapsed, timeLeft, started, over, recorded, day, practice, longest }

function newGame({ mode = S.set.mode, size = S.set.size, seed, w, h, path } = {}) {
  stopReplay(); endAnim(); closePanel();
  const M = MODES[mode] ? mode : 'classic';
  let day = null, practice = false;
  if (M === 'daily') {
    day = today(); ({ w, h } = DAILY_SIZE);
    seed = hashSeed('greed-daily-' + day) % SEEDS;
    practice = S.daily[day] != null;
  } else if (!w || !h) {
    ({ w, h } = size === 'auto' || !FIXED[size] ? autoSize() : FIXED[size]);
  }
  if (seed == null) seed = Math.floor(Math.random() * SEEDS);
  const g = new Greed(w, h, seed);
  G = { g, mode: M, undos: 0, hints: 0, elapsed: 0, timeLeft: MODES[M].clock || 0, started: 0, over: false, recorded: false, day, practice, gems: new Set(), view: 'board', cpu: MODES[M].cpu ? S.set.cpuLevel : null, paused: false };
  if (MODES[M].gems) {
    const r = rng(seed ^ 0x9e3779b9);
    for (let i = 0; i < w * h; i++) if (r() < 0.045 && g.grid[i]) G.gems.add(i);
  }
  if (path) for (const d of path) g.move(d);
  preview = null; hintCells = null;
  crt.classList.toggle('cpu-on', !!G.cpu); cpuBar();
  layout(); draw(); status();
  if (!path) toast(`${MODES[M].name} · ${w}×${h} · board ${seedCode(seed)}${practice ? ' · practice (daily already played)' : ''}`);
  persist();
  if (g.over) finish(); else if (G.cpu) scheduleCpu(700);
}

function points(G) {
  if (!G.gems.size) return G.g.score;
  let n = 0; for (const i of G.gems) if (G.g.grid[i] === 0 && G.g.order[i] > 0) n++;
  return G.g.score + 4 * n;
}
function gemsEaten(G) { let n = 0; for (const i of G.gems) if (G.g.order[i] > 0) n++; return n; }

function persist() {
  if (!G || G.over) { delete S.cur; save(); return; }
  S.cur = { mode: G.mode, w: G.g.w, h: G.g.h, seed: G.g.seed, path: G.g.path, undos: G.undos, hints: G.hints, elapsed: G.elapsed, timeLeft: G.timeLeft, day: G.day, practice: G.practice, cpu: G.cpu };
  save();
}
function resume() {
  const c = S.cur;
  if (!c) return false;
  if (c.mode === 'daily' && c.day !== today()) return false;
  newGame({ mode: c.mode, w: c.w, h: c.h, seed: c.seed, path: c.path });
  Object.assign(G, { undos: c.undos || 0, hints: c.hints || 0, elapsed: c.elapsed || 0, timeLeft: c.timeLeft ?? G.timeLeft, day: c.day, practice: c.practice });
  if (G.cpu && c.cpu) G.cpu = c.cpu;
  cpuBar();
  if (G.g.history.length) G.started = 1;
  status(); toast(`Welcome back · ${MODES[G.mode].name} game resumed`);
  return true;
}

// ───────────────────────── the clock ─────────────────────────
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now(), dt = (now - lastTick) / 1000; lastTick = now;
  if (!G || G.over || !G.started || !$('#overlay').hidden || document.hidden || replay) return;
  G.elapsed += dt;
  if (MODES[G.mode].clock) {
    G.timeLeft = Math.max(0, G.timeLeft - dt);
    if (G.timeLeft <= 0) { endAnim(); finish('time'); return; }
  }
  status();
}, 250);

// ───────────────────────── moving ─────────────────────────
let anim = null, preview = null, hintCells = null, hintTimer = 0;
const SPEED = { fast: 12, normal: 28, slow: 55, off: 0 };

function tryMove(d, byCpu) {
  if (!G || G.over || replay) return;
  if (G.cpu && !byCpu) { flashToast('The computer is playing. Space or a tap on the board pauses it.'); return; }
  endAnim();
  const m = G.g.move(d);
  if (!m) { bell(); buzz(40); flashToast('Not that way.'); return; }
  if (!G.started) { G.started = 1; lastTick = performance.now(); }
  preview = null; hintCells = null;
  const h = G.g.history[G.g.history.length - 1];
  if (!G.cpu) {
    for (const v of h.vals) S.life.digits[v]++;
    S.life.cells += m.n; S.life.moves++;
    buzz(12);
  }
  let ms = SPEED[S.set.speed] ?? 28;
  if (G.cpu) ms = Math.min(ms || 28, Math.floor(CPU_SPEEDS[S.set.cpuSpeed] / 12));
  if (ms >= 3) { anim = { h, k: 0 }; stepAnim(ms); } else { if (!G.cpu || CPU_SPEEDS[S.set.cpuSpeed] >= 80) tick(m.n); after(); }
}
function stepAnim(ms) {
  if (!anim) return;
  anim.k++;
  click(anim.h.vals[anim.k - 1]);
  draw();
  if (anim.k >= anim.h.cells.length) { anim = null; after(); return; }
  anim.t = setTimeout(() => stepAnim(ms), ms);
}
function endAnim() { if (anim) { clearTimeout(anim.t); anim = null; draw(); after(true); } }
function after(quiet) {
  status(); draw(); persist();
  if (G && !G.over && G.g.over) finish();
  else if (G?.cpu && !G.over) scheduleCpu();
  else if (!quiet && G && !G.over && S.set.showMoves === false && G.g.moves().length === 1) flashToast('Only one way left…');
}
function doUndo() {
  if (!G || G.over || replay) return;
  if (!MODES[G.mode].undo) { bell(); flashToast(`No undo in ${MODES[G.mode].name}. Try Relaxed mode.`); return; }
  endAnim();
  if (G.g.undo()) { G.undos++; S.life.undos++; preview = null; hintCells = null; draw(); status(); persist(); }
}
function doHint() {
  if (!G || G.over || replay) return;
  if (!MODES[G.mode].hint) { bell(); flashToast(`No hints in ${MODES[G.mode].name}. Try Relaxed mode.`); return; }
  endAnim();
  const d = G.g.hint();
  if (d < 0) return;
  G.hints++; S.life.hints++;
  hintCells = { d, cells: new Set(G.g.look(d).cells) };
  clearTimeout(hintTimer); hintTimer = setTimeout(() => { hintCells = null; draw(); }, 1800);
  draw(); status(); flashToast(`Hint: go ${DIR_NAMES[d]}.`);
}
function toggleShow() { S.set.showMoves = !S.set.showMoves; save(); draw(); syncButtons(); }

// ───────────────────────── the computer player ─────────────────────────
let cpuTimer = 0;
function scheduleCpu(delay = CPU_SPEEDS[S.set.cpuSpeed] ?? 250) {
  clearTimeout(cpuTimer);
  if (G?.cpu && !G.over && !G.paused) cpuTimer = setTimeout(cpuStep, delay);
}
function cpuStep() {
  if (!G || !G.cpu || G.over || G.paused || replay || anim) return;
  if (!$('#overlay').hidden || document.hidden) { scheduleCpu(400); return; }
  if (!G.started) { G.started = 1; lastTick = performance.now(); }
  if (CPU_SPEEDS[S.set.cpuSpeed] === 0) {
    // instant: think in slices so the screen stays responsive
    const t = performance.now();
    while (!G.g.over && performance.now() - t < 30) G.g.move(G.g.cpuMove(G.cpu));
    draw(); status();
    if (G.g.over) { persist(); finish(); } else cpuTimer = setTimeout(cpuStep, 0);
    return;
  }
  tryMove(G.g.cpuMove(G.cpu), true);
}
function cpuPause(on = !G.paused) {
  if (!G?.cpu || G.over) return;
  G.paused = on; cpuBar(); status();
  if (!on) scheduleCpu(150); else clearTimeout(cpuTimer);
}
function cpuSingle() {
  if (!G?.cpu || G.over) return;
  if (!G.paused) cpuPause(true);
  endAnim();
  if (!G.g.over) { G.started = 1; tryMove(G.g.cpuMove(G.cpu), true); }
}
function cpuSpeed(delta) {
  const k = Object.keys(CPU_SPEEDS), i = Math.max(0, Math.min(k.length - 1, k.indexOf(S.set.cpuSpeed) + delta));
  setCpuSpeed(k[i]);
}
function setCpuSpeed(v) { S.set.cpuSpeed = v; save(); cpuBar(); status(); if (G?.cpu && !G.paused) scheduleCpu(60); }
function cpuBar() {
  const el = $('#cpu');
  if (!G?.cpu) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<button data-c="pause" class="${G.paused ? 'on' : ''}">${G.paused ? '▶ Play' : '❚❚ Pause'}</button><button data-c="step">Step</button>
    <span class="dim">Speed</span>${Object.keys(CPU_SPEEDS).map(k => `<button data-c="speed" data-v="${k}" class="${k === S.set.cpuSpeed ? 'on' : ''}">${k}</button>`).join('')}
    <span class="dim">· ${CPU_LEVELS[G.cpu].name}</span>`;
}
$('#cpu').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.c === 'pause') cpuPause(); else if (b.dataset.c === 'step') cpuSingle(); else if (b.dataset.c === 'speed') setCpuSpeed(b.dataset.v);
});

// a quiet benchmark: how would the Expert computer do on the board you just played? (runs in slices)
function benchmark(rec, done) {
  if (MODES[rec.m]?.cpu || MODES[rec.m]?.clock || rec.vs != null) { done?.(); return; }
  const g = new Greed(rec.w, rec.h, rec.seed);
  const slice = () => {
    const t = performance.now();
    while (!g.over && performance.now() - t < 25) g.move(g.hint());
    if (!g.over) { setTimeout(slice, 0); return; }
    rec.vs = g.score; save(); done?.();
  };
  setTimeout(slice, 50);
}
function vsLine(rec) {
  if (rec.vs == null) return '';
  const d = rec.s - rec.vs;
  return `Expert computer on this board: <span class="hi">${rec.vs}</span> (${pct(rec.vs, rec.t)}) — ${d > 0 ? `<span class="hi">you beat it by ${d}!</span>` : d < 0 ? `it beat you by ${-d}.` : 'a tie!'}`;
}

// ───────────────────────── game over ─────────────────────────
function finish(why) {
  if (!G || G.over) return;
  G.over = true;
  const g = G.g, pts = points(G);
  let longest = 0; for (const h of g.history) longest = Math.max(longest, h.cells.length);
  const rec = {
    m: G.mode, w: g.w, h: g.h, seed: g.seed, s: g.score, p: pts, t: g.total, n: g.history.length, L: longest,
    u: G.undos, hi: G.hints, gm: gemsEaten(G), d: new Date().toISOString(), dur: Math.round(G.elapsed),
    day: G.day, pr: G.practice || undefined, why: why || undefined, lvl: G.cpu || undefined, spd: G.cpu ? S.set.cpuSpeed : undefined,
  };
  const before = rankOf(rec);
  S.games.push(rec);
  if (S.games.length > 1000) S.games.splice(0, S.games.length - 1000);
  if (G.day && !G.practice && !G.cpu) S.daily[G.day] = pts;
  clearTimeout(cpuTimer); G.paused = false; cpuBar();
  const fresh = checkAchievements(rec);
  delete S.cur; save();
  clearTimeout(toastTimer); toast('');
  status(); draw();
  sndOver();
  const me = G;
  if (G.cpu) { setTimeout(() => G === me && showCpuOver(rec, fresh), CPU_SPEEDS[S.set.cpuSpeed] < 80 ? 250 : 650); return; }
  setTimeout(() => G === me && showOver(rec, before, fresh), why === 'time' ? 300 : 650);
  benchmark(rec, () => {
    const el = document.getElementById('vsline'); if (el) el.innerHTML = vsLine(rec);
    const more = checkAchievements(rec);
    for (const a of more) flashToast(`★ Achievement: ${a.name}`);
  });
}
function rankKey(r) { return MODES[r.m]?.gems ? r.p : r.s / r.t; }
function bestList(mode, includePractice = false) {
  return S.games.filter(r => r.m === mode && (includePractice || !r.pr)).sort((a, b) => rankKey(b) - rankKey(a) || a.d.localeCompare(b.d));
}
function rankOf(rec) { if (rec.pr) return 0; const l = bestList(rec.m); let r = 1; for (const x of l) if (rankKey(x) > rankKey(rec)) r++; return r; }

function pct(s, t) { return (100 * s / t).toFixed(2) + '%'; }
function fmtTime(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function verdict(p) {
  if (p >= 90) return 'Unbelievable. Are you a computer?';
  if (p >= 75) return 'Outstanding greed.';
  if (p >= 60) return 'Very greedy indeed.';
  if (p >= 45) return 'Nicely done.';
  if (p >= 30) return 'Not bad.';
  if (p >= 15) return 'A modest appetite.';
  return 'Barely a nibble.';
}

function showOver(rec, rank, fresh) {
  const p = 100 * rec.s / rec.t;
  const list = bestList(rec.m);
  const best = list[0];
  const top = rank && rank <= 10;
  let html = `<div class="big">${MODES[rec.m].gems ? rec.p + ' pts' : rec.s}</div>
    <p>${MODES[rec.m].gems ? `${rec.s} squares + ${rec.gm} gems · ` : ''}${pct(rec.s, rec.t)} of the board · ${rec.n} moves · ${fmtTime(rec.dur)}${rec.why === 'time' ? ' · <span class="hi">time is up</span>' : ''}</p>
    <p class="hi">${verdict(p)}</p>`;
  if (rec.pr) html += `<p class="dim">Practice game: today's daily was already played (${S.daily[rec.day]}).</p>`;
  else if (rank === 1 && list.length > 1) html += `<p class="hi">*** NEW ${MODES[rec.m].name.toUpperCase()} RECORD ***</p>`;
  else if (top) html += `<p>Number ${rank} in your ${MODES[rec.m].name} top 10.${best && best !== rec ? ` Best: ${MODES[rec.m].gems ? best.p + ' pts' : pct(best.s, best.t)}.` : ''}</p>`;
  else if (best) html += `<p class="dim">Your best ${MODES[rec.m].name}: ${MODES[rec.m].gems ? best.p + ' pts' : pct(best.s, best.t)}.</p>`;
  if (rec.u || rec.hi) html += `<p class="dim">Undos ${rec.u} · hints ${rec.hi}</p>`;
  if (!MODES[rec.m].clock) html += `<p id="vsline">${rec.vs != null ? vsLine(rec) : '<span class="dim">Letting the Expert computer try this board…</span>'}</p>`;
  for (const a of fresh) html += `<p class="hi">★ Achievement: ${a.name} <span class="dim">— ${a.desc}</span></p>`;
  html += `<div class="row">
    <button data-o="again" class="on">Play again</button>
    <button data-o="same">Same board</button>
    <button data-o="heat">Heat map</button>
    <button data-o="replay">Replay</button>
    <button data-o="share">Share</button>
    <button data-o="watch">Watch the computer</button>
    <button data-o="stats">Stats</button></div>`;
  openPanel('GAME OVER', html, (b) => {
    const o = b.dataset.o;
    if (o === 'again') newGame({ mode: rec.m === 'daily' ? 'daily' : rec.m, size: S.set.size });
    else if (o === 'same') newGame({ mode: rec.m === 'daily' ? 'relaxed' : rec.m, w: rec.w, h: rec.h, seed: rec.seed });
    else if (o === 'heat') { closePanel(); G.view = 'heat'; draw(); toast('Heat map: dark = early, bright = late. Tap the board to go back.'); }
    else if (o === 'replay') { closePanel(); startReplay(); }
    else if (o === 'share') share(shareText(rec));
    else if (o === 'stats') showStats('overview');
    else if (o === 'watch') newGame({ mode: 'computer', w: rec.w, h: rec.h, seed: rec.seed });
  });
}
function showCpuOver(rec, fresh) {
  const lv = CPU_LEVELS[rec.lvl], l = S.games.filter(r => r.m === 'computer' && r.lvl === rec.lvl);
  const avg = l.reduce((a, r) => a + 100 * r.s / r.t, 0) / l.length;
  const best = l.reduce((a, r) => Math.max(a, 100 * r.s / r.t), 0);
  const mine = S.games.filter(r => isMine(r) && r.w === rec.w && r.h === rec.h && r.seed === rec.seed);
  const yourBest = mine.reduce((a, r) => Math.max(a, r.s), -1);
  let html = `<div class="big">${rec.s}</div>
    <p>${lv.name} computer · ${pct(rec.s, rec.t)} of the board · ${rec.n} moves</p>
    <p>${lv.name} so far: ${l.length} game${l.length === 1 ? '' : 's'} · average <span class="hi">${avg.toFixed(2)}%</span> · best ${best.toFixed(2)}%</p>`;
  if (yourBest >= 0) html += `<p class="hi">You scored ${yourBest} on this board — ${yourBest > rec.s ? 'you beat the computer!' : yourBest < rec.s ? `the computer beat you by ${rec.s - yourBest}.` : 'a tie.'}</p>`;
  for (const a of fresh) html += `<p class="hi">★ Achievement: ${a.name} <span class="dim">— ${a.desc}</span></p>`;
  html += `<div class="row"><button data-o="again" class="on">Next board</button><button data-o="same">Same board again</button><button data-o="mine">Play this board yourself</button>
    <button data-o="heat">Heat map</button><button data-o="replay">Replay</button><button data-o="stats">Computer stats</button></div>`;
  openPanel('COMPUTER FINISHED', html, (b) => {
    const o = b.dataset.o;
    if (o === 'again') newGame({ mode: 'computer', size: S.set.size });
    else if (o === 'same') newGame({ mode: 'computer', w: rec.w, h: rec.h, seed: rec.seed });
    else if (o === 'mine') newGame({ mode: 'classic', w: rec.w, h: rec.h, seed: rec.seed });
    else if (o === 'heat') { closePanel(); G.view = 'heat'; draw(); toast('Heat map: dark = early, bright = late. Tap the board to go back.'); }
    else if (o === 'replay') { closePanel(); startReplay(); }
    else if (o === 'stats') showStats('cpu');
  });
}
function shareText(r) {
  const tag = r.day ? `Daily ${r.day}` : MODES[r.m].name;
  const bar = '█'.repeat(Math.round(r.s / r.t * 20)).padEnd(20, '░');
  return `GREED · ${tag} · ${r.w}×${r.h} · board ${seedCode(r.seed)}\n${MODES[r.m].gems ? r.p + ' pts, ' : ''}${r.s} squares (${pct(r.s, r.t)}) in ${r.n} moves\n${bar}`;
}
async function share(text) {
  if (native?.share) { native.share(text); return; }
  try { await navigator.clipboard.writeText(text); flashToast('Copied to the clipboard.'); return; } catch {}
  const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select();
  try { document.execCommand('copy'); flashToast('Copied to the clipboard.'); } catch { flashToast('Could not copy.'); }
  t.remove();
}

// ───────────────────────── replay ─────────────────────────
let replay = null;
function startReplay() {
  if (!G) return;
  const path = G.g.path, g = new Greed(G.g.w, G.g.h, G.g.seed);
  replay = { g, path, i: 0 };
  toast('Replay… tap to stop.');
  const step = () => {
    if (!replay) return;
    if (replay.i >= path.length) { replay.t = setTimeout(stopReplay, 900); return; }
    const m = replay.g.move(path[replay.i++]); if (m) click(m.n);
    draw(); status();
    replay.t = setTimeout(step, Math.max(40, Math.min(220, 9000 / path.length)));
  };
  draw(); replay.t = setTimeout(step, 400);
}
function stopReplay() { if (!replay) return; clearTimeout(replay.t); replay = null; draw(); status(); toast(''); }

// ───────────────────────── achievements ─────────────────────────
const ACH = [
  { id: 'first', name: 'Hello, @', desc: 'Finish your first game.' },
  { id: 'p25', name: 'Snack', desc: 'Eat 25% of a board.' },
  { id: 'p50', name: 'Half the plate', desc: 'Eat 50% of a board.' },
  { id: 'p75', name: 'Glutton', desc: 'Eat 75% of a board.' },
  { id: 'p90', name: 'Bottomless', desc: 'Eat 90% of a board.' },
  { id: 'pure50', name: 'Pure greed', desc: '50% without undo or hints.' },
  { id: 'classic50', name: 'Old school', desc: '50% on the 79×22 Classic board, Classic mode.' },
  { id: 'moves150', name: 'Long haul', desc: 'Make 150 moves in one game.' },
  { id: 'nines', name: 'Cloud nine', desc: 'Make ten moves of 9 squares in one game.' },
  { id: 'oops', name: 'Oops', desc: 'Get stuck with under 3% eaten.' },
  { id: 'blitz300', name: 'Speed demon', desc: '300 squares in one Blitz game.' },
  { id: 'gems25', name: 'Treasure hunter', desc: 'Collect 25 gems in one game.' },
  { id: 'daily1', name: 'Daily bread', desc: 'Finish a daily board.' },
  { id: 'daily7', name: 'Habit', desc: 'Play the daily board 7 days in a row.' },
  { id: 'games50', name: 'Regular', desc: 'Finish 50 games.' },
  { id: 'cells10k', name: 'Ten thousand', desc: 'Eat 10,000 squares in total.' },
  { id: 'cells100k', name: 'Black hole', desc: 'Eat 100,000 squares in total.' },
  { id: 'allmodes', name: 'Variety', desc: 'Finish a game in every mode.' },
  { id: 'machine', name: 'Beat the machine', desc: 'Score more than the Expert computer on the same board.' },
  { id: 'watcher', name: 'Spectator', desc: 'Watch the computer finish 10 games.' },
];
function dailyStreak() {
  let n = 0; const d = new Date();
  if (S.daily[today(d)] == null) d.setDate(d.getDate() - 1);
  while (S.daily[today(d)] != null) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function checkAchievements(r) {
  const got = [];
  const grant = (id) => { const a = ACH.find(x => x.id === id); if (a && !S.ach[id]) { S.ach[id] = new Date().toISOString(); got.push(a); } };
  if (MODES[r.m]?.cpu) {
    if (S.games.filter(x => MODES[x.m]?.cpu).length >= 10) grant('watcher');
    if (r.lvl === 'expert' && S.games.some(x => isMine(x) && x.seed === r.seed && x.w === r.w && x.h === r.h && x.s > r.s)) grant('machine');
    save(); return got;
  }
  if (r.vs != null && r.s > r.vs) grant('machine');
  const p = 100 * r.s / r.t;
  const nines = G ? G.g.history.filter(h => h.cells.length === 9).length : 0;
  const test = {
    first: true, p25: p >= 25, p50: p >= 50, p75: p >= 75, p90: p >= 90,
    pure50: p >= 50 && !r.u && !r.hi, classic50: r.m === 'classic' && r.w === 79 && r.h === 22 && p >= 50,
    moves150: r.n >= 150, nines: nines >= 10, oops: p < 3, blitz300: r.m === 'blitz' && r.s >= 300,
    gems25: r.gm >= 25, daily1: r.m === 'daily' && !r.pr, daily7: dailyStreak() >= 7,
    games50: S.games.filter(isMine).length >= 50, cells10k: S.life.cells >= 10000, cells100k: S.life.cells >= 100000,
    allmodes: PLAYER_MODES.every(m => S.games.some(x => x.m === m)),
  };
  for (const a of ACH) if (test[a.id]) grant(a.id);
  save(); return got;
}

// ───────────────────────── drawing ─────────────────────────
const DIGIT_COLORS = ['', '#ff5f5f', '#ffaf3f', '#ffef5f', '#87ff5f', '#3fdfaf', '#5fafff', '#af87ff', '#ff6fd0', '#ffffff'];
let geo = { cw: 10, ch: 18, ox: 0, oy: 0, fs: 16, dpr: 1 };
function css(name) { return getComputedStyle(crt).getPropertyValue(name).trim(); }
let T = {};
function readTheme() {
  T = { bg: css('--bg'), fg: css('--fg'), dim: css('--dim'), hi: css('--hi'), acc: css('--acc'), sel: css('--sel') };
  native?.setBars?.(T.bg);
  document.querySelector('meta[name=theme-color]').content = T.bg;
}

function layout() {
  if (!G) return;
  const wrap = $('#boardwrap').getBoundingClientRect();
  const { w, h } = G.g;
  const vt = S.set.font === 'vt';
  let cw = wrap.width / w, ch = wrap.height / h;
  // keep cells looking like a terminal: taller than wide, but not silly
  if (ch > cw * 2.0) ch = cw * 2.0;
  if (ch < cw * 1.15) cw = ch / 1.15;
  cw = Math.floor(cw * 4) / 4; ch = Math.floor(ch * 4) / 4;
  const fs = vt ? Math.min(ch * 1.02, cw * 2.1) : Math.min(ch * 0.82, cw * 1.62);
  const dpr = Math.min(3, devicePixelRatio || 1);
  const W = cw * w, H = ch * h;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  canvas.style.left = Math.round((wrap.width - W) / 2) + 'px'; canvas.style.top = Math.round((wrap.height - H) / 2) + 'px';
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  geo = { cw, ch, fs, dpr, W, H, family: vt ? 'VT323' : "'IBM Plex Mono'" };
}

function viewGame() { return replay ? replay.g : G.g; }

function draw() {
  if (!G) return;
  const g = viewGame(), { cw, ch, fs, dpr, W, H } = geo;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  ctx.font = `${S.set.font === 'vt' ? '' : '600 '}${fs}px ${geo.family}, monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const yoff = S.set.font === 'vt' ? ch * 0.04 : ch * 0.03;

  // what to highlight
  const mark = new Map();
  if (!replay && !G.over) {
    if (S.set.showMoves) for (const d of g.moves()) { const m = g.look(d); m.cells.forEach((i, k) => mark.set(i, k === m.cells.length - 1 ? 'dest' : 'path')); }
    if (preview != null) { const m = g.look(preview); if (m) m.cells.forEach((i, k) => mark.set(i, k === m.cells.length - 1 ? 'pdest' : 'prev')); }
    if (hintCells) for (const i of hintCells.cells) mark.set(i, 'hint');
  }
  // cells still being eaten by the move animation
  const pending = new Map();
  let px = g.x, py = g.y;
  if (anim && !replay) {
    const hh = anim.h;
    for (let k = anim.k; k < hh.cells.length; k++) pending.set(hh.cells[k], hh.vals[k]);
    if (anim.k === 0) { px = hh.fx; py = hh.fy; } else { const i = hh.cells[anim.k - 1]; px = i % g.w; py = (i / g.w) | 0; }
  }
  const heat = G.view === 'heat' && !replay;
  const mono = S.set.theme !== 'color';
  const moves = Math.max(1, g.history.length);

  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x, X = x * cw, Y = y * ch;
    let v = g.grid[i];
    if (pending.has(i)) v = pending.get(i);
    if (heat && g.order[i] > 0 && !v) {
      const f = g.order[i] / moves;
      ctx.globalAlpha = 0.12 + 0.78 * f; ctx.fillStyle = mono ? T.fg : '#58d0ff';
      ctx.fillRect(X, Y, cw, ch); ctx.globalAlpha = 1;
      continue;
    }
    if (!v) continue;
    const k = mark.get(i);
    const gem = G.gems.has(i);
    if (k) {
      const col = k === 'hint' ? T.hi : k === 'prev' || k === 'pdest' ? T.acc : T.dim;
      ctx.fillStyle = col; ctx.globalAlpha = k === 'path' ? 0.55 : 1;
      ctx.fillRect(X, Y, cw, ch); ctx.globalAlpha = 1;
      ctx.fillStyle = T.bg; ctx.fillText(v, X + cw / 2, Y + ch / 2 + yoff);
      continue;
    }
    if (gem) {
      ctx.strokeStyle = mono ? T.hi : '#ffd75f'; ctx.lineWidth = 1;
      ctx.strokeRect(X + 0.5, Y + 0.5, cw - 1, ch - 1);
      ctx.fillStyle = mono ? T.hi : '#ffd75f';
    } else if (mono) {
      ctx.fillStyle = T.fg; ctx.globalAlpha = 0.55 + v * 0.05;
    } else ctx.fillStyle = DIGIT_COLORS[v];
    ctx.fillText(v, X + cw / 2, Y + ch / 2 + yoff);
    ctx.globalAlpha = 1;
  }
  // the player
  const X = px * cw, Y = py * ch;
  ctx.fillStyle = blinkOn || G.over ? T.hi : T.bg;
  ctx.fillRect(X, Y, cw, ch);
  ctx.fillStyle = blinkOn || G.over ? T.bg : T.hi;
  ctx.fillText('@', X + cw / 2, Y + ch / 2 + yoff);
  syncPad();
}

// blinking cursor: redraws only the player square
let blinkOn = true;
setInterval(() => {
  if (!G || G.over || anim || replay || document.hidden) { blinkOn = true; return; }
  blinkOn = !blinkOn;
  const { cw, ch, dpr } = geo, g = G.g, X = g.x * cw, Y = g.y * ch;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = blinkOn ? T.hi : T.bg; ctx.fillRect(X, Y, cw, ch);
  ctx.fillStyle = blinkOn ? T.bg : T.hi; ctx.fillText('@', X + cw / 2, Y + ch / 2 + (S.set.font === 'vt' ? ch * 0.04 : ch * 0.03));
}, 530);

// ───────────────────────── status line ─────────────────────────
function status() {
  if (!G) return;
  const g = viewGame(), M = MODES[G.mode];
  const parts = [`Score: <b>${String(replay ? g.score : points(G)).padStart(4, '0')}</b>`, `<b>${pct(g.score, g.total)}</b>`, `Moves <b>${g.history.length}</b>`];
  if (G.cpu) parts.push(`CPU <b>${CPU_LEVELS[G.cpu].name}</b> · ${S.set.cpuSpeed}${G.paused ? ' · <b>PAUSED</b>' : ''}`);
  if (M.gems) parts.push(`Gems <b>${gemsEaten(G)}</b>/${G.gems.size}`);
  if (M.clock) parts.push(`<span class="${G.timeLeft < 15 && !G.over ? 'warn' : ''}">Time <b>${fmtTime(Math.ceil(G.timeLeft))}</b></span>`);
  else parts.push(`<span class="dim">${fmtTime(G.elapsed)}</span>`);
  const best = bestList(G.mode).find(r => r.w === g.w && r.h === g.h && (!G.cpu || r.lvl === G.cpu));
  if (best) parts.push(`<span class="dim">Best ${M.gems ? best.p : best.s}</span>`);
  if (G.undos || G.hints) parts.push(`<span class="dim">↶${G.undos} ?${G.hints}</span>`);
  parts.push(`<span class="r">${G.day ? 'DAILY ' + G.day : M.name.toUpperCase()} ${g.w}×${g.h} #${seedCode(g.seed)}${G.over ? ' · GAME OVER' : ''}${replay ? ' · REPLAY' : ''}</span>`);
  $('#status').innerHTML = parts.map(p => `<span>${p}</span>`).join('');
}
let toastTimer = 0;
function toast(t) { $('#toast').textContent = t; }
function flashToast(t) { toast(t); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast(''), 2600); }

// ───────────────────────── sound and touch feedback ─────────────────────────
let AC = null;
function ac() { if (!AC) try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch {} if (AC?.state === 'suspended') AC.resume(); return AC; }
function tone(f, dur, type = 'square', vol = 0.035, when = 0) {
  if (!S.set.sound) return; const a = ac(); if (!a) return;
  const o = a.createOscillator(), gn = a.createGain(), t = a.currentTime + when;
  o.type = type; o.frequency.value = f; gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function click(v) { tone(300 + (v || 5) * 70, 0.03); }
function tick(n) { for (let k = 0; k < Math.min(n, 9); k++) tone(400 + k * 60, 0.03, 'square', 0.03, k * 0.02); }
function bell() { tone(880, 0.12, 'square', 0.03); tone(660, 0.15, 'square', 0.03, 0.08); }
function sndOver() { [520, 440, 370, 300, 220].forEach((f, k) => tone(f, 0.16, 'triangle', 0.06, k * 0.12)); }
function buzz(ms) { if (!S.set.haptic) return; if (native?.vibrate) native.vibrate(ms); else try { navigator.vibrate?.(ms); } catch {} }

// ───────────────────────── keyboard ─────────────────────────
const KEYMAP = {
  y: 0, k: 1, u: 2, h: 3, l: 4, b: 5, j: 6, n: 7,                      // the original vi keys
  ArrowUp: 1, ArrowLeft: 3, ArrowRight: 4, ArrowDown: 6,
  Home: 0, PageUp: 2, End: 5, PageDown: 7,                              // numpad with NumLock off
  Numpad7: 0, Numpad8: 1, Numpad9: 2, Numpad4: 3, Numpad6: 4, Numpad1: 5, Numpad2: 6, Numpad3: 7,
};
const QWE = { q: 0, w: 1, e: 2, a: 3, d: 4, z: 5, x: 6, c: 7 };
addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('#overlay').hidden) {
    if (e.key === 'Escape') { e.preventDefault(); closePanel(); }
    return;
  }
  if (replay) { stopReplay(); return; }
  if (G?.view === 'heat') { G.view = 'board'; draw(); toast(''); }
  const k = e.key;
  if (G?.cpu && !G.over) {
    if (k === ' ' || k === 'Enter') { e.preventDefault(); cpuPause(); return; }
    if (k === '.' || k === '>') { cpuSingle(); return; }
    if (k === '+' || k === '=') { cpuSpeed(1); return; }
    if (k === '-' || k === '_') { cpuSpeed(-1); return; }
  }
  let d = e.code.startsWith('Numpad') && KEYMAP[e.code] != null ? KEYMAP[e.code] : KEYMAP[k];
  if (d == null && S.set.qwe !== false && QWE[k] != null) d = QWE[k];
  if (d != null && !e.shiftKey) { e.preventDefault(); tryMove(d); return; }
  const lk = k.toLowerCase();
  if (k === 'Backspace') { e.preventDefault(); doUndo(); }
  else if (k === ' ' || k === 'Enter') { e.preventDefault(); doHint(); }
  else if (lk === 'p') toggleShow();
  else if (k === 'N') showNew();
  else if (k === 'S' || k === 's') showStats();
  else if (lk === 'o') showOpts();
  else if (k === '?' || k === 'F1') { e.preventDefault(); showHelp(); }
  else if (k === 'Escape') showNew();
}, { capture: false });

// ───────────────────────── pointer: hover, tap, swipe ─────────────────────────
function dirFromPoint(px, py) {
  const g = G.g, cx = (g.x + 0.5) * geo.cw, cy = (g.y + 0.5) * geo.ch;
  const dx = px - cx, dy = py - cy;
  if (Math.abs(dx) < geo.cw * 0.5 && Math.abs(dy) < geo.ch * 0.5) return -1;
  return angleDir(dx, dy);
}
function angleDir(dx, dy) {
  const a = Math.atan2(dy, dx);                    // 0 = right, positive = down
  const s = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return [4, 7, 6, 5, 3, 0, 1, 2][s];
}
function local(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
let down = null;
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || !G || G.over || replay || G.cpu) return;
  const d = dirFromPoint(...local(e));
  const nd = d >= 0 && G.g.look(d) ? d : null;
  if (nd !== preview) { preview = nd; draw(); }
});
canvas.addEventListener('pointerleave', () => { if (preview != null && !down) { preview = null; draw(); } });
canvas.addEventListener('pointerdown', (e) => { ac(); down = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType }; });
addEventListener('pointerup', (e) => {
  if (!down) return;
  const d0 = down; down = null;
  if (!G) return;
  if (replay) { stopReplay(); return; }
  if (G.view === 'heat') { G.view = 'board'; draw(); toast(''); return; }
  if (G.over) return;
  if (G.cpu) { if (e.target === canvas) cpuPause(); return; }
  const dx = e.clientX - d0.x, dy = e.clientY - d0.y, dist = Math.hypot(dx, dy);
  if (dist > 28 && d0.type !== 'mouse') { tryMove(angleDir(dx, dy)); return; }      // swipe
  if (e.target !== canvas) return;
  const d = dirFromPoint(...local(e));
  if (d < 0) { if (MODES[G.mode].hint) doHint(); else toggleShow(); return; }       // tap on yourself
  if (d0.type === 'mouse' || S.set.oneTap || preview === d) { tryMove(d); return; }
  if (!G.g.look(d)) { bell(); flashToast('Not that way.'); preview = null; draw(); return; }
  preview = d; draw(); flashToast(`Tap again to go ${DIR_NAMES[d]} (${G.g.look(d).n}).`);
});

// ───────────────────────── direction pad ─────────────────────────
const ARROWS = ['↖', '↑', '↗', '←', '→', '↙', '↓', '↘'];
const PAD_ORDER = [0, 1, 2, 3, -1, 4, 5, 6, 7];
const padBtns = [];
for (const d of PAD_ORDER) {
  const b = document.createElement('button');
  if (d < 0) { b.textContent = '@'; b.title = 'Hint / show moves'; b.onclick = () => (G && MODES[G.mode].hint ? doHint() : toggleShow()); }
  else { b.title = DIR_NAMES[d]; b.onclick = () => tryMove(d); padBtns[d] = b; }
  $('#dpad').append(b);
}
function syncPad() {
  if (!G) return;
  const g = viewGame();
  for (let d = 0; d < 8; d++) {
    const n = g.at(g.x + DIRS[d][0], g.y + DIRS[d][1]);
    const ok = !G.over && !replay && !G.cpu && !!g.look(d);
    padBtns[d].innerHTML = `${ARROWS[d]}<small>${n > 0 ? n : ' '}</small>`;
    padBtns[d].disabled = !ok;
  }
}
$('#b-undo').onclick = doUndo; $('#b-hint').onclick = doHint; $('#b-show').onclick = toggleShow;
function syncButtons() {
  const M = G ? MODES[G.mode] : {};
  for (const b of document.querySelectorAll('[data-act=undo], #b-undo')) b.disabled = !M.undo;
  for (const b of document.querySelectorAll('[data-act=hint], #b-hint')) b.disabled = !M.hint;
  for (const b of document.querySelectorAll('[data-act=show], #b-show')) b.classList.toggle('on', !!S.set.showMoves);
}
$('#bar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  ({ new: showNew, undo: doUndo, hint: doHint, show: toggleShow, stats: () => showStats(), opts: showOpts, help: showHelp })[b.dataset.act]?.();
});

// ───────────────────────── panels ─────────────────────────
let panelClick = null;
function openPanel(title, html, onClick) {
  $('#panel').innerHTML = `<h2><span>${title}</span><button data-close aria-label="Close">[×]</button></h2><div class="body">${html}</div>`;
  $('#overlay').hidden = false; panelClick = onClick;
  $('#panel .body').scrollTop = 0;
  const f = $('#panel .body button.on, #panel .body button'); f?.focus({ preventScroll: true });
}
function closePanel() { $('#overlay').hidden = true; panelClick = null; lastTick = performance.now(); }
$('#overlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlay' || e.target.closest('[data-close]')) { closePanel(); return; }
  const b = e.target.closest('button'); if (b && panelClick) panelClick(b, e);
});
window.__terug = () => {                     // Android back button
  if (!$('#overlay').hidden) { closePanel(); return true; }
  if (replay) { stopReplay(); return true; }
  if (G?.view === 'heat') { G.view = 'board'; draw(); return true; }
  return false;
};

function showNew() {
  let mode = S.set.mode, size = S.set.size, lvl = S.set.cpuLevel, spd = S.set.cpuSpeed;
  const render = () => {
    const daily = mode === 'daily', cpu = mode === 'computer';
    const played = S.daily[today()];
    openPanel('NEW GAME', `
      <div class="modes">${Object.entries(MODES).map(([k, m]) => `<button data-mode="${k}" class="${k === mode ? 'on' : ''}">${m.name}<span>${m.desc}${k === 'daily' && played != null ? ` Today: ${played}.` : ''}</span></button>`).join('')}</div>
      ${cpu ? `<h3>Computer level</h3><div class="row">${Object.entries(CPU_LEVELS).map(([k, l]) => `<button data-lvl="${k}" class="${k === lvl ? 'on' : ''}">${l.name} <span class="dim">${l.desc}</span></button>`).join('')}</div>
      <h3>Speed <span class="dim">(change it any time while it plays: + and −)</span></h3><div class="row">${Object.entries(CPU_SPEEDS).map(([k, v]) => `<button data-spd="${k}" class="${k === spd ? 'on' : ''}">${k}<span class="dim"> ${v ? v + ' ms' : '∞'}</span></button>`).join('')}</div>` : ''}
      <h3>Board</h3>
      <div class="row">${daily ? `<span class="dim">The daily board is always 40×24.</span>` : Object.entries(SIZE_OPTS).map(([k, n]) => `<button data-size="${k}" class="${k === size ? 'on' : ''}">${n}</button>`).join('')}</div>
      ${daily ? '' : `<h3>Board code <span class="dim">(optional, to play a board someone shared)</span></h3>
      <div class="row"><input type="text" id="code" maxlength="6" placeholder="ABC234" autocomplete="off" spellcheck="false"></div>`}
      <div class="row"><button data-go class="on">Start</button>${S.cur || (G && !G.over) ? '<button data-close>Back to game</button>' : ''}</div>`, (b) => {
      if (b.dataset.mode) { mode = b.dataset.mode; render(); }
      else if (b.dataset.size) { size = b.dataset.size; render(); }
      else if (b.dataset.lvl) { lvl = b.dataset.lvl; render(); }
      else if (b.dataset.spd) { spd = b.dataset.spd; render(); }
      else if (b.hasAttribute('data-go')) {
        const code = $('#code')?.value.trim();
        let seed;
        if (code) { seed = codeSeed(code); if (seed == null) { flashToast('That board code is not valid (6 letters/digits).'); return; } }
        S.set.mode = mode; S.set.size = size; S.set.cpuLevel = lvl; S.set.cpuSpeed = spd; save();
        if (!daily && size === 'auto') { closePanel(); requestAnimationFrame(() => newGame({ mode, size, seed })); }
        else newGame({ mode, size, seed });
      }
    });
  };
  render();
}

function showHelp() {
  openPanel('HELP', `
    <p>The board is full of numbers. You are the <span class="hi">@</span>.</p>
    <p>Pick one of the eight directions. The number next to you in that direction tells you how many squares you move — and you <span class="hi">eat</span> every square on the way.</p>
    <p>You can't move off the board or across squares that are already eaten. When no direction is left, the game is over. Your score is the number of squares you ate.</p>
    <h3>Keys</h3>
    <pre>  <kbd>y</kbd> <kbd>k</kbd> <kbd>u</kbd>     <kbd>q</kbd> <kbd>w</kbd> <kbd>e</kbd>     <kbd>7</kbd> <kbd>8</kbd> <kbd>9</kbd>
  <kbd>h</kbd> <kbd>@</kbd> <kbd>l</kbd>     <kbd>a</kbd> <kbd>@</kbd> <kbd>d</kbd>     <kbd>4</kbd> <kbd>@</kbd> <kbd>6</kbd>   arrows too
  <kbd>b</kbd> <kbd>j</kbd> <kbd>n</kbd>     <kbd>z</kbd> <kbd>x</kbd> <kbd>c</kbd>     <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>   (numpad)</pre>
    <p><kbd>p</kbd> show possible moves · <kbd>Space</kbd> hint · <kbd>Backspace</kbd> undo · <kbd>N</kbd> new game · <kbd>s</kbd> stats · <kbd>o</kbd> options · <kbd>Esc</kbd> menu</p>
    <h3>Touch and mouse</h3>
    <p>Swipe in a direction to move. Or tap the board in a direction: the path lights up, tap again to go (switch on <span class="hi">one-tap moves</span> in Options to skip that). Tap yourself for a hint or to show the moves. With a mouse, hover to preview and click to go.</p>
    <h3>Computer mode</h3>
    <p>Choose a level and a speed when you start it. While it plays: <kbd>Space</kbd> or a tap on the board pauses, <kbd>.</kbd> plays one move, <kbd>+</kbd> and <kbd>−</kbd> change the speed. After each of your own games the Expert computer quietly plays the same board, so you can see who did better.</p>
    <h3>Modes</h3>
    ${Object.values(MODES).map(m => `<p><span class="hi">${m.name}</span> — ${m.desc}</p>`).join('')}
    <h3>Tips</h3>
    <p>Big numbers clear a lot but cut the board in two. Stay away from walls and eaten areas early, keep open space around you, and watch for moves that leave you only one way out.</p>
    <p class="dim">Greed was written by Matthew Day in 1985 for Unix terminals; it shipped with BSD and later as part of Eric S. Raymond's games. This is a fan remake.</p>`);
}

// ───────────────────────── statistics ─────────────────────────
function showStats(tab = 'overview') {
  const tabs = { overview: 'Overview', top: 'Top 10', cpu: 'Computer', ach: 'Achievements', hist: 'History' };
  let mode = S.set.mode;
  const render = () => {
    let body = `<div class="tabs">${Object.entries(tabs).map(([k, n]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    const gs = S.games.filter(isMine);
    if (tab === 'cpu') body += cpuStats();
    else if (tab === 'overview') {
      if (!gs.length) body += `<p class="dim">No finished games yet. Statistics appear here after your first game.</p>`;
      else {
        const pcts = gs.map(r => 100 * r.s / r.t);
        const avg = pcts.reduce((a, b) => a + b, 0) / gs.length;
        const time = gs.reduce((a, r) => a + (r.dur || 0), 0);
        const longest = Math.max(...gs.map(r => r.n));
        const bestP = Math.max(...pcts);
        const last10 = pcts.slice(-10), avg10 = last10.reduce((a, b) => a + b, 0) / last10.length;
        body += `<table>
          <tr><td>Games finished</td><td class="n hi">${gs.length}</td><td class="dim">time played</td><td class="n">${fmtHours(time)}</td></tr>
          <tr><td>Squares eaten</td><td class="n hi">${S.life.cells.toLocaleString('en')}</td><td class="dim">moves</td><td class="n">${S.life.moves.toLocaleString('en')}</td></tr>
          <tr><td>Best</td><td class="n hi">${bestP.toFixed(2)}%</td><td class="dim">average</td><td class="n">${avg.toFixed(2)}%</td></tr>
          <tr><td>Last 10 games</td><td class="n">${avg10.toFixed(2)}%</td><td class="dim">trend</td><td class="n">${avg10 > avg + 0.5 ? '▲ up' : avg10 < avg - 0.5 ? '▼ down' : '■ steady'}</td></tr>
          <tr><td>Longest game</td><td class="n">${longest} moves</td><td class="dim">daily streak</td><td class="n">${dailyStreak()} days</td></tr>
          <tr><td>Undos / hints</td><td class="n">${S.life.undos} / ${S.life.hints}</td><td class="dim">achievements</td><td class="n">${Object.keys(S.ach).length}/${ACH.length}</td></tr>
        </table>`;
        body += `<h3>Per mode</h3><table><tr><th>Mode</th><th class="n">games</th><th class="n">best</th><th class="n">average</th></tr>${PLAYER_MODES.map(k => [k, MODES[k]]).map(([k, m]) => {
          const l = gs.filter(r => r.m === k); if (!l.length) return '';
          const b = bestList(k, true)[0];
          return `<tr><td>${m.name}</td><td class="n">${l.length}</td><td class="n hi">${m.gems ? b.p + ' pts' : pct(b.s, b.t)}</td><td class="n">${(l.reduce((a, r) => a + 100 * r.s / r.t, 0) / l.length).toFixed(1)}%</td></tr>`;
        }).join('')}</table>`;
        // how the scores spread: one bar per 10% band, drawn with block characters
        const bins = Array(10).fill(0); for (const p of pcts) bins[Math.min(9, Math.floor(p / 10))]++;
        const mx = Math.max(...bins);
        body += `<h3>Score spread</h3><pre>${bins.map((n, i) => `${String(i * 10).padStart(3)}–${String(i * 10 + 9).padStart(2)}% │${'█'.repeat(Math.round(n / mx * 24))}${n ? ' ' + n : ''}`).join('\n')}</pre>`;
        const dg = S.life.digits, dmx = Math.max(1, ...dg.slice(1));
        body += `<h3>Digits eaten</h3><pre>${dg.slice(1).map((n, i) => `  ${i + 1} │${'▓'.repeat(Math.round(n / dmx * 24))} ${n.toLocaleString('en')}`).join('\n')}</pre>`;
        // a sparkline of the last 40 games
        const spark = pcts.slice(-40).map(p => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(p / 12.5))]).join('');
        body += `<h3>Last ${Math.min(40, gs.length)} games</h3><pre>  ${spark}</pre>`;
      }
    } else if (tab === 'top') {
      body += `<div class="row">${Object.entries(MODES).map(([k, m]) => `<button data-mode="${k}" class="${k === mode ? 'on' : ''}">${m.name}</button>`).join('')}</div>`;
      const l = bestList(mode).slice(0, 10);
      if (!l.length) body += `<p class="dim">No ${MODES[mode].name} games yet.</p>`;
      else body += `<table><tr><th>#</th><th class="n">${MODES[mode].gems ? 'points' : 'score'}</th><th class="n">%</th><th class="n">moves</th><th>board</th><th>date</th><th></th></tr>${l.map((r, i) => `<tr><td>${i + 1}</td><td class="n hi">${MODES[mode].gems ? r.p : r.s}</td><td class="n">${(100 * r.s / r.t).toFixed(1)}</td><td class="n">${r.n}</td><td>${r.w}×${r.h} <span class="dim">${seedCode(r.seed)}</span></td><td class="dim">${r.day || r.d.slice(0, 10)}</td><td><button data-play="${S.games.indexOf(r)}">play</button></td></tr>`).join('')}</table>`;
    } else if (tab === 'ach') {
      body += ACH.map(a => `<div class="ach ${S.ach[a.id] ? '' : 'lock'}"><span>${S.ach[a.id] ? '★' : '☆'}</span><span><span class="t">${a.name}</span> — ${a.desc}${S.ach[a.id] ? ` <span class="dim">${S.ach[a.id].slice(0, 10)}</span>` : ''}</span></div>`).join('');
    } else if (tab === 'hist') {
      const l = S.games.slice(-30).reverse();
      if (!l.length) body += `<p class="dim">No games yet.</p>`;
      else body += `<table><tr><th>date</th><th>mode</th><th class="n">score</th><th class="n">%</th><th>board</th><th></th></tr>${l.map(r => `<tr><td class="dim">${r.d.slice(0, 16).replace('T', ' ')}</td><td>${MODES[r.m]?.cpu ? 'CPU ' + (CPU_LEVELS[r.lvl]?.name || '') : MODES[r.m]?.name || r.m}${r.pr ? '*' : ''}</td><td class="n hi">${MODES[r.m]?.gems ? r.p : r.s}</td><td class="n">${(100 * r.s / r.t).toFixed(1)}</td><td>${r.w}×${r.h} <span class="dim">${seedCode(r.seed)}</span></td><td><button data-play="${S.games.indexOf(r)}">play</button></td></tr>`).join('')}</table><p class="dim">* practice game</p>`;
    }
    openPanel('STATISTICS', body, (b) => {
      if (b.dataset.tab) { tab = b.dataset.tab; render(); }
      else if (b.dataset.mode) { mode = b.dataset.mode; render(); }
      else if (b.dataset.play) { const r = S.games[+b.dataset.play]; if (r.lvl) S.set.cpuLevel = r.lvl; newGame({ mode: r.m === 'daily' ? 'relaxed' : r.m, w: r.w, h: r.h, seed: r.seed }); }
      else if (b.dataset.watch) { S.set.cpuLevel = b.dataset.watch; save(); newGame({ mode: 'computer', size: S.set.size }); }
    });
  };
  render();
}
function cpuStats() {
  let h = '';
  const cg = S.games.filter(r => MODES[r.m]?.cpu);
  h += `<h3>Computer games, per level</h3>`;
  if (!cg.length) h += `<p class="dim">The computer hasn't finished a game yet. Start one with New → Computer, or press a level below.</p>`;
  h += `<table><tr><th>Level</th><th class="n">games</th><th class="n">best</th><th class="n">average</th><th class="n">worst</th><th class="n">moves</th><th></th></tr>${Object.entries(CPU_LEVELS).map(([k, lv]) => {
    const l = cg.filter(r => r.lvl === k), ps = l.map(r => 100 * r.s / r.t);
    const cell = (v) => l.length ? v : '–';
    return `<tr><td>${lv.name}</td><td class="n">${l.length}</td><td class="n hi">${cell(Math.max(...ps).toFixed(1) + '%')}</td><td class="n">${cell((ps.reduce((a, b) => a + b, 0) / l.length).toFixed(1) + '%')}</td><td class="n">${cell(Math.min(...ps).toFixed(1) + '%')}</td><td class="n">${cell(Math.round(l.reduce((a, r) => a + r.n, 0) / l.length))}</td><td><button data-watch="${k}">watch</button></td></tr>`;
  }).join('')}</table>`;
  for (const [k, lv] of Object.entries(CPU_LEVELS)) {
    const ps = cg.filter(r => r.lvl === k).slice(-40).map(r => 100 * r.s / r.t);
    if (ps.length > 1) h += `<pre>${lv.name.padEnd(7)} ${ps.map(p => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(p / 7.5))]).join('')}</pre>`;
  }
  // you against the Expert computer, board for board
  const vs = S.games.filter(r => isMine(r) && r.vs != null);
  h += `<h3>You vs the Expert computer</h3>`;
  if (!vs.length) h += `<p class="dim">After each of your games (not Blitz) the Expert computer plays the same board in the background. The comparison appears here.</p>`;
  else {
    const won = vs.filter(r => r.s > r.vs).length, lost = vs.filter(r => r.s < r.vs).length, tie = vs.length - won - lost;
    const you = vs.reduce((a, r) => a + 100 * r.s / r.t, 0) / vs.length, it = vs.reduce((a, r) => a + 100 * r.vs / r.t, 0) / vs.length;
    const bar = (p) => '█'.repeat(Math.round(p / 100 * 30));
    h += `<p>${vs.length} boards · you won <span class="hi">${won}</span>, lost ${lost}, tied ${tie}</p>
      <pre>You      │${bar(you)} ${you.toFixed(1)}%
Computer │${bar(it)} ${it.toFixed(1)}%</pre>`;
    const last = vs.slice(-12).reverse();
    h += `<table><tr><th>date</th><th>mode</th><th>board</th><th class="n">you</th><th class="n">cpu</th><th></th></tr>${last.map(r => `<tr class="${r.s > r.vs ? 'me' : ''}"><td class="dim">${r.d.slice(0, 10)}</td><td>${MODES[r.m].name}</td><td>${r.w}×${r.h} <span class="dim">${seedCode(r.seed)}</span></td><td class="n">${r.s}</td><td class="n">${r.vs}</td><td>${r.s > r.vs ? 'won' : r.s < r.vs ? 'lost' : 'tie'}</td></tr>`).join('')}</table>`;
  }
  return h;
}
function fmtHours(s) { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h}h ${m}m` : `${m}m`; }

// ───────────────────────── options ─────────────────────────
function showOpts() {
  const seg = (key, opts) => `<span class="seg">${Object.entries(opts).map(([v, n]) => `<button data-k="${key}" data-v="${v}" class="${String(S.set[key]) === v ? 'on' : ''}">${n}</button>`).join('')}</span>`;
  const onoff = (key) => seg(key, { true: 'on', false: 'off' });
  let confirm = false;
  const render = () => openPanel('OPTIONS', `
    <h3>Screen</h3>
    <div class="opt"><span>Phosphor</span>${seg('theme', { color: 'Colour', green: 'Green', amber: 'Amber', white: 'White', c64: 'C64' })}</div>
    <div class="opt"><span>Font</span>${seg('font', { vt: 'VT323', plex: 'IBM Plex' })}</div>
    <div class="opt"><span>Scanlines</span>${seg('scan', { off: 'off', light: 'light', med: 'medium', heavy: 'heavy' })}</div>
    <div class="opt"><span>Glow</span>${onoff('glow')}</div>
    <div class="opt"><span>Curved glass &amp; vignette</span>${onoff('curve')}</div>
    <div class="opt"><span>Rolling refresh bar</span>${onoff('roll')}</div>
    <div class="opt"><span>Flicker</span>${onoff('flicker')}</div>
    <h3>Play</h3>
    <div class="opt"><span>Always show possible moves</span>${onoff('showMoves')}</div>
    <div class="opt"><span>One-tap moves (touch)</span>${onoff('oneTap')}</div>
    <div class="opt"><span>Direction pad</span>${seg('pad', { auto: 'auto', on: 'on', off: 'off' })}</div>
    <div class="opt"><span>Eating speed</span>${seg('speed', { off: 'instant', fast: 'fast', normal: 'normal', slow: 'slow' })}</div>
    <div class="opt"><span>Sound</span>${onoff('sound')}</div>
    <div class="opt"><span>Vibration</span>${onoff('haptic')}</div>
    <h3>Data</h3>
    <div class="row">${confirm ? `<span class="hi">Erase all statistics and achievements?</span><button data-reset="yes">Yes, erase</button><button data-reset="no" class="on">No</button>` : `<button data-reset="ask">Reset statistics…</button>`}</div>`, (b) => {
    if (b.dataset.k) {
      const k = b.dataset.k, v = b.dataset.v;
      S.set[k] = v === 'true' ? true : v === 'false' ? false : v; save(); applySettings(); render();
    } else if (b.dataset.reset === 'ask') { confirm = true; render(); }
    else if (b.dataset.reset === 'no') { confirm = false; render(); }
    else if (b.dataset.reset === 'yes') {
      S.games = []; S.ach = {}; S.daily = {}; S.life = { digits: Array(10).fill(0), cells: 0, moves: 0, undos: 0, hints: 0 };
      save(); confirm = false; render(); status(); flashToast('Statistics erased.');
    }
  });
  render();
}

function applySettings() {
  const s = S.set;
  crt.className = [`theme-${s.theme}`, s.font === 'plex' ? 'font-plex' : '', `scan-${s.scan}`, s.glow ? 'glow' : '', s.curve ? 'curve' : '', s.roll ? 'roll' : '', s.flicker ? 'flicker' : '',
    s.pad === 'on' ? 'pad-on' : s.pad === 'off' ? 'pad-off' : '', isTouch ? 'touch' : '', crt.classList.contains('boot') ? 'boot' : '', G?.cpu ? 'cpu-on' : ''].filter(Boolean).join(' ');
  crt.style.setProperty('--scan', { off: 0, light: 0.16, med: 0.3, heavy: 0.5 }[s.scan] ?? 0.3);
  readTheme(); syncButtons();
  requestAnimationFrame(() => { layout(); draw(); });
}

// ───────────────────────── start ─────────────────────────
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
new ResizeObserver(() => { layout(); draw(); }).observe($('#boardwrap'));
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); lastTick = performance.now(); });
addEventListener('pagehide', persist);

async function start() {
  applySettings();
  try { await document.fonts.load(`20px VT323`); await document.fonts.load(`600 16px 'IBM Plex Mono'`); } catch {}
  setTimeout(() => crt.classList.remove('boot'), 600);
  readTheme(); layout();
  // a shared link: #40x24-ABC234-classic
  const m = /^#(\d+)x(\d+)-([0-9A-Za-z]{6})(?:-(\w+))?$/.exec(location.hash);
  if (m && codeSeed(m[3]) != null) {
    history.replaceState(null, '', location.pathname + location.search);
    newGame({ mode: MODES[m[4]] && m[4] !== 'daily' ? m[4] : 'classic', w: Math.min(120, +m[1]), h: Math.min(80, +m[2]), seed: codeSeed(m[3]) });
  } else if (!resume()) {
    newGame();
    if (!S.games.length) showHelp();
  }
}
start();
window.__greed = { get G() { return G; }, S, newGame, tryMove, finish, showStats, showOpts, showNew, setCpuSpeed, cpuPause };   // for tests
