import { Greed, seedCode, codeSeed, SEEDS } from '../web/game.js';
import assert from 'node:assert';
// codes round-trip
for (let k = 0; k < 2000; k++) { const s = Math.floor(Math.random() * SEEDS); assert.equal(codeSeed(seedCode(s)), s); }
assert.equal(codeSeed('abc-234'), codeSeed('ABC234')); assert.equal(codeSeed('ABC10I'), null); assert.equal(codeSeed(seedCode(SEEDS - 1)), SEEDS - 1);
const s = 123456; assert.equal(codeSeed(seedCode(s)), s);
// same seed, same board
const a = new Greed(40, 24, 99), b = new Greed(40, 24, 99);
assert.deepEqual([...a.grid], [...b.grid]); assert.equal(a.x, b.x);
// play random games, check invariants, undo all the way back
let tot = 0, hintTot = 0;
for (let n = 0; n < 60; n++) {
  const g = new Greed(40, 24, n), start = g.grid.slice();
  while (!g.over) {
    const ms = g.moves(); const d = ms[Math.floor(Math.random() * ms.length)];
    const m = g.move(d); assert.ok(m); assert.equal(g.grid[g.y * g.w + g.x], 0);
  }
  const eaten = [...g.grid].filter(v => v === 0).length - 1;
  assert.equal(eaten, g.score);
  for (let d = 0; d < 8; d++) assert.equal(g.move(d), null);
  tot += g.percent;
  while (g.undo()); assert.deepEqual([...g.grid], [...start]); assert.equal(g.score, 0);
  const h = new Greed(40, 24, n);
  while (!h.over) h.move(h.hint());
  hintTot += h.percent;
}
console.log('random avg', (tot / 60).toFixed(1) + '%', ' hint-bot avg', (hintTot / 60).toFixed(1) + '%');
// classic size full game with hint is quick enough
const t = Date.now(); const c = new Greed(79, 22, 7); while (!c.over) c.move(c.hint()); console.log('classic hint game', c.percent.toFixed(1) + '%', Date.now() - t, 'ms');
console.log('ok');
