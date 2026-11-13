// Greed: the board and its rules, without any drawing. Also used by the Node tests.
//
// The board is filled with the digits 1-9. From your square you pick one of the eight directions; the digit
// next to you in that direction says how many squares you move, and you eat every square you cross.
// A move is not allowed if it would leave the board or cross a square that is already eaten.
// The game ends when no direction is possible. Your score is the number of squares eaten.

export const DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
export const DIR_NAMES = ['up-left', 'up', 'up-right', 'left', 'right', 'down-left', 'down', 'down-right'];

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// short codes for seeds, easy to read out: no 0/O, 1/I/L. Six of them give 887 million boards.
export const SEEDS = 31 ** 6;
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function seedCode(seed) { let s = '', n = (seed >>> 0) % SEEDS; for (let i = 0; i < 6; i++) { s += ALPHA[n % 31]; n = Math.floor(n / 31); } return s; }
export function codeSeed(code) {
  const c = String(code).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (c.length !== 6 || [...c].some(ch => !ALPHA.includes(ch))) return null;
  let n = 0; for (let i = 5; i >= 0; i--) n = n * 31 + ALPHA.indexOf(c[i]);
  return n >>> 0;
}

export class Greed {
  constructor(w, h, seed) {
    this.w = w; this.h = h; this.seed = seed >>> 0;
    const r = rng(this.seed);
    this.grid = new Uint8Array(w * h);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = 1 + Math.floor(r() * 9);
    this.x = Math.floor(r() * w); this.y = Math.floor(r() * h);
    this.grid[this.y * w + this.x] = 0;
    this.start = { x: this.x, y: this.y };
    this.order = new Int32Array(w * h).fill(-1);   // move number that ate each square (for the heat map)
    this.order[this.y * w + this.x] = 0;
    this.history = [];
    this.score = 0;
  }
  get total() { return this.w * this.h - 1; }
  get percent() { return (100 * this.score) / this.total; }
  at(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? -1 : this.grid[y * this.w + x]; }

  // what moving in direction d would do: null if impossible, else { n, cells: [index...], x, y }
  look(d, x = this.x, y = this.y, grid = this.grid) {
    const [dx, dy] = DIRS[d];
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) return null;
    const n = grid[ny * this.w + nx];
    if (!n) return null;
    const cells = [];
    for (let k = 1; k <= n; k++) {
      const cx = x + dx * k, cy = y + dy * k;
      if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return null;
      const i = cy * this.w + cx;
      if (!grid[i]) return null;
      cells.push(i);
    }
    return { n, cells, x: x + dx * n, y: y + dy * n };
  }
  moves() { const out = []; for (let d = 0; d < 8; d++) if (this.look(d)) out.push(d); return out; }
  get over() { return this.moves().length === 0; }

  move(d) {
    const m = this.look(d);
    if (!m) return null;
    const vals = m.cells.map(i => this.grid[i]);
    const num = this.history.length + 1;
    for (const i of m.cells) { this.grid[i] = 0; this.order[i] = num; }
    this.history.push({ d, fx: this.x, fy: this.y, cells: m.cells, vals });
    this.x = m.x; this.y = m.y;
    this.score += m.n;
    return m;
  }
  undo() {
    const h = this.history.pop();
    if (!h) return false;
    h.cells.forEach((i, k) => { this.grid[i] = h.vals[k]; this.order[i] = -1; });
    this.x = h.fx; this.y = h.fy;
    this.score -= h.cells.length;
    return true;
  }

  // a hint: look a few moves ahead; count the squares eaten on the way, and at the end of the line prefer
  // positions with many ways out that sit in a big open region (so you don't cut yourself off)
  hint(depth = this.w * this.h > 1300 ? 3 : 4) {
    const g = this.grid.slice(), W = this.w, H = this.h, N = W * H;
    const seen = new Int32Array(N), q = new Int32Array(N); let stamp = 0;
    const region = (x, y) => {
      stamp++; let h = 0, t = 0;
      const push = (x0, y0) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = x0 + dx, Y = y0 + dy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const j = Y * W + X;
          if (g[j] && seen[j] !== stamp) { seen[j] = stamp; q[t++] = j; }
        }
      };
      push(x, y);
      while (h < t) { const i = q[h++]; push(i % W, (i / W) | 0); }
      return t;
    };
    const search = (x, y, dep) => {
      let best = -1e9, bestD = -1;
      for (let d = 0; d < 8; d++) {
        const m = this.look(d, x, y, g);
        if (!m) continue;
        const saved = m.cells.map(i => g[i]);
        for (const i of m.cells) g[i] = 0;
        let v = m.n;
        if (dep > 1) { const r = search(m.x, m.y, dep - 1); v += r.d < 0 ? -1000 : r.v; }
        else {
          let room = 0;
          for (let e = 0; e < 8; e++) if (this.look(e, m.x, m.y, g)) room++;
          v += room ? region(m.x, m.y) + room : -1000;
        }
        m.cells.forEach((i, k) => { g[i] = saved[k]; });
        if (v > best) { best = v; bestD = d; }
      }
      return { v: best, d: bestD };
    };
    return search(this.x, this.y, depth).d;
  }

  // the computer player: how it picks a move at each level
  cpuMove(level = 'expert') {
    const ms = this.moves();
    if (!ms.length) return -1;
    if (level === 'random') return ms[Math.floor(Math.random() * ms.length)];
    if (level === 'greedy') {
      let best = 0, pick = [];
      for (const d of ms) { const n = this.look(d).n; if (n > best) { best = n; pick = [d]; } else if (n === best) pick.push(d); }
      return pick[Math.floor(Math.random() * pick.length)];
    }
    if (level === 'smart') return this.hint(2);
    return this.hint();
  }

  // the moves of a game, to replay it on a fresh board with the same seed
  get path() { return this.history.map(h => h.d); }
}

// board sizes: the original is 79 x 22 (an 80 x 24 terminal minus the status line)
export const SIZES = {
  classic: { w: 79, h: 22, name: 'Classic 79×22' },
  wide: { w: 60, h: 30, name: 'Tablet 60×30' },
  tall: { w: 34, h: 46, name: 'Phone 34×46' },
  small: { w: 24, h: 30, name: 'Small 24×30' },
};
