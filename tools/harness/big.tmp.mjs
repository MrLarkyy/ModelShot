import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.addInitScript(() => {
  window.__log = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (...a) { const t = performance.now(); post.apply(this, a); window.__log.push(`post ${(performance.now() - t).toFixed(1)}`); };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__log.push(`longtask ${e.duration.toFixed(0)}`); }).observe({ type: 'longtask' });
});
for (let i = 0; i < 2; i++) {
  await page.goto('http://127.0.0.1:5199/rt.html?scene=large-order&lag=1');
  await page.waitForFunction(() => window.__msFixture !== undefined);
  await page.evaluate(() => window.__msFixture.ready);
  const r = await page.evaluate(async () => { const rt = window.__msFixture.rt; await new Promise((r) => setTimeout(r, 300)); rt.resetLag(); window.__log = []; const t = performance.now(); const o = rt.bake({ samples: 1 }); const sync = performance.now() - t; const res = await o; return { sync, lag: rt.maxLag(), log: window.__log, err: res.error }; });
  console.log(JSON.stringify(r));
}
await browser.close();
