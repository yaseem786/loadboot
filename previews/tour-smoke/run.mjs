// run.mjs — drives every portal tour flow through the real engine on a stub page (index.html here) and fails on
// any page error or a flow that does not reach its "done" card. Usage, from the repo root:
//   python3 -m http.server 8765 --bind 127.0.0.1 &
//   node previews/tour-smoke/run.mjs            (playwright is resolved from the global npm root; LB_CHROMIUM=/path overrides the browser)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const runs = [['partner','broker',0],['partner','shipper',0],['partner','broker',1],['agent','dispatcher',0],['agent','referral',0],['agent','both',0],['agent','dispatcher',1],['investor','investor',0],['investor','investor',1],['developer','developer',0]];
const browser = await chromium.launch({ executablePath: process.env.LB_CHROMIUM || undefined, args: ['--no-sandbox'] });
let fail = 0;
for (const [portal, role, empty] of runs) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:8765/previews/tour-smoke/index.html?portal=${portal}&role=${role}&empty=${empty}`);
  await page.waitForSelector('.lbt-card.lbt-in', { timeout: 5000 }).catch(() => {});
  let titles = [], guard = 0;
  while (guard++ < 40) {
    const t = await page.evaluate(() => { const c = document.querySelector('.lbt-card'); return c ? (c.querySelector('.lbt-title') || {}).textContent : null; });
    if (t) titles.push(t);
    const done = await page.evaluate(() => !!document.querySelector('.lbt-card .lbt-quick') || !document.querySelector('.lbt-card'));
    if (done) break;
    // primary button: Show me around / Next / Got it
    const clicked = await page.evaluate(() => { const b = document.querySelector('.lbt-card .lbt-btn.pri'); if (b) { b.click(); return true; } return false; });
    if (!clicked) break;
    await page.waitForTimeout(350);
  }
  const alive = await page.evaluate(() => window.__tour && window.__tour.active);
  const log = await page.evaluate(() => window.__log.slice(-3));
  const pageErr = await page.evaluate(() => window.__err);
  const ok = titles.length > 2 && errs.length === 0 && pageErr.length === 0 && titles[titles.length - 1] && !alive === false;
  const reachedDone = await page.evaluate(() => !!document.querySelector('.lbt-card .lbt-quick'));
  if (!(errs.length === 0 && pageErr.length === 0 && reachedDone)) fail++;
  console.log(`${portal}/${role} empty=${empty}: ${titles.length} cards, done=${reachedDone}, errors=${errs.length + pageErr.length}${errs.length ? ' ' + errs.join(' | ').slice(0, 300) : ''}${pageErr.length ? ' ' + pageErr.join(' | ').slice(0, 300) : ''}`);
  if (!reachedDone) console.log('   titles:', titles.join(' > ').slice(0, 400), ' log:', log.join(', '));
  await page.close();
}
await browser.close();
console.log(fail ? 'SMOKE FAIL ' + fail : 'SMOKE OK');
