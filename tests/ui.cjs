const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const out = process.argv[2];
  const errs = [];
  for (const [name, opt] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', devices['Pixel 7']], ['tablet', { ...devices['Galaxy Tab S4 landscape'] }]]) {
    const ctx = await b.newContext({ ...opt, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ': ' + e.message));
    p.on('console', m => m.type() === 'error' && errs.push(name + ': ' + m.text()));
    await p.goto('file://' + __dirname + '/../dist/greed.html');
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${out}/${name}-help.png` });
    await p.evaluate(() => document.querySelector('[data-close]').click());
    // play some moves with the hint bot in Relaxed
    await p.evaluate(() => { __greed.S.set.speed = 'off'; __greed.newGame({ mode: 'relaxed' }); });
    for (let k = 0; k < 25; k++) await p.evaluate(() => { const G = __greed.G; if (!G.over) __greed.tryMove(G.g.hint()); });
    await p.evaluate(() => { __greed.S.set.showMoves = true; });
    await p.keyboard.press('p'); await p.keyboard.press('p');
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${name}-play.png` });
    // finish it
    await p.evaluate(() => { const G = __greed.G; while (!G.g.over) __greed.tryMove(G.g.hint()); });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}/${name}-over.png` });
    await p.evaluate(() => __greed.showStats('overview'));
    await p.screenshot({ path: `${out}/${name}-stats.png` });
    if (name === 'desktop') {
      for (const th of ['green', 'amber', 'c64']) {
        await p.evaluate(t => { document.querySelector('[data-close]')?.click(); __greed.S.set.theme = t; __greed.S.set.scan = 'heavy'; __greed.newGame({ mode: 'treasure' }); }, th);
        await p.evaluate(() => { __greed.showOpts(); }); await p.evaluate(() => document.querySelector('[data-k=theme][data-v=' + __greed.S.set.theme + ']').click());
        await p.evaluate(() => document.querySelector('[data-close]').click());
        await p.waitForTimeout(300);
        await p.screenshot({ path: `${out}/${name}-${th}.png` });
      }
      await p.evaluate(() => __greed.showOpts()); await p.screenshot({ path: `${out}/${name}-opts.png` });
      // daily + reload resumes
      await p.evaluate(() => { document.querySelector('[data-close]').click(); __greed.newGame({ mode: 'daily' }); __greed.tryMove(__greed.G.g.moves()[0]); });
      await p.waitForTimeout(400);
      await p.reload(); await p.waitForTimeout(900);
      console.log('resumed:', await p.evaluate(() => [__greed.G.mode, __greed.G.g.history.length].join(' ')));
    }
    console.log(name, await p.evaluate(() => `${__greed.G.g.w}x${__greed.G.g.h} games=${__greed.S.games.length}`));
    await ctx.close();
  }
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
