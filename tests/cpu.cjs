const { chromium, devices } = require('playwright');
(async () => {
  const out = process.argv[2], b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + __dirname + '/../dist/greed.html'); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('[data-close]').click());
  // new-game panel with computer selected
  await p.evaluate(() => { __greed.showNew(); document.querySelector('[data-mode=computer]').click(); document.querySelector('[data-lvl=smart]').click(); document.querySelector('[data-spd=fast]').click(); document.querySelector('[data-size=medium]').click(); });
  await p.screenshot({ path: out + '/cpu-new.png' });
  await p.evaluate(() => document.querySelector('[data-go]').click());
  await p.waitForTimeout(3000);
  await p.screenshot({ path: out + '/cpu-play.png' });
  console.log('fast after 3s moves', await p.evaluate(() => __greed.G.g.history.length));
  await p.keyboard.press(' '); const a = await p.evaluate(() => __greed.G.g.history.length); await p.waitForTimeout(800);
  console.log('paused holds', a === await p.evaluate(() => __greed.G.g.history.length), await p.evaluate(() => __greed.G.paused));
  await p.keyboard.press('.'); await p.waitForTimeout(400); console.log('step', await p.evaluate(() => __greed.G.g.history.length) - a);
  await p.keyboard.press('h'); // ignored
  await p.evaluate(() => __greed.setCpuSpeed('instant')); await p.keyboard.press(' ');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: out + '/cpu-over.png' });
  // every level, instant, classic board
  for (const lv of ['random', 'greedy', 'smart', 'expert']) {
    for (let i = 0; i < 3; i++) {
      await p.evaluate(lv => { document.querySelector('[data-close]')?.click(); __greed.S.set.cpuLevel = lv; __greed.S.set.cpuSpeed = 'instant'; __greed.newGame({ mode: 'computer', size: 'medium' }); }, lv);
      await p.waitForFunction(() => __greed.G.over, null, { timeout: 20000 });
    }
  }
  // a player game, then the background benchmark
  await p.evaluate(() => { document.querySelector('[data-close]')?.click(); __greed.S.set.speed = 'off'; __greed.newGame({ mode: 'classic', size: 'medium' }); const G = __greed.G; while (!G.g.over) __greed.tryMove(G.g.moves()[0]); });
  await p.waitForTimeout(2500);
  console.log('vs:', await p.evaluate(() => document.getElementById('vsline')?.textContent));
  await p.screenshot({ path: out + '/player-over.png' });
  await p.evaluate(() => __greed.showStats('cpu'));
  await p.screenshot({ path: out + '/cpu-stats.png' });
  console.log('errors:', errs.length ? errs : 'none');
  // phone view of computer play
  const c2 = await b.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 }); const q = await c2.newPage();
  await q.goto('file://' + __dirname + '/../dist/greed.html'); await q.waitForTimeout(700);
  await q.evaluate(() => { document.querySelector('[data-close]').click(); __greed.S.set.cpuSpeed = 'normal'; __greed.newGame({ mode: 'computer' }); });
  await q.waitForTimeout(2500); await q.screenshot({ path: out + '/cpu-phone.png' });
  await b.close();
})();
