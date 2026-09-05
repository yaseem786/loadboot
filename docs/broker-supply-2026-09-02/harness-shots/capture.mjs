import { login, srv } from './portal.mjs';
import fs from 'fs';
const OUT = '/tmp/shots-raw'; fs.mkdirSync(OUT, { recursive: true });
const HIDE = '#lbc-fab,#lbc-teaser,#lb-btt{display:none!important} .cp-top{position:static!important} *{caret-color:transparent!important}';
async function prep(pg) { await pg.addStyleTag({ content: HIDE }); await pg.evaluate(() => { document.querySelectorAll('#lbc-fab,#lbc-teaser').forEach(e => e.remove()); }); }
// screenshot a card whose text starts with `txt` (searching .cp-card / section containers)
async function card(pg, txt, name, sel = '.cp-card, .cp-content > div, .cp-content section') {
  const el = pg.locator(sel).filter({ hasText: txt }).first();
  await el.scrollIntoViewIfNeeded(); await pg.waitForTimeout(600);
  await el.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name);
}
const who = process.argv[2];
const { b, pg } = await login(who);
await prep(pg);
const phase = process.argv[3] || 'a';
if (who === 'broker' && phase === 'a') {
  await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${OUT}/broker-dashboard.png` }); console.log('shot broker-dashboard');
  await card(pg, 'Broker onboarding', 'broker-trust-ladder', '.bt-hero');
  await card(pg, '1 · Screen your broker authority', 'broker-fmcsa-screen', '.bt-card');
  await card(pg, '3 · ', 'broker-posting-limit', '.bt-card');
} else if (who === 'broker') {
  // post form
  await pg.click('button:has-text("Post a load")'); await pg.waitForTimeout(2500); await prep(pg);
  const f = pg.locator('#bd-postload').first(); await f.scrollIntoViewIfNeeded(); await pg.waitForTimeout(600);
  await f.screenshot({ path: `${OUT}/broker-post-wizard.png` }); console.log('shot broker-post-wizard');
  await pg.evaluate(() => { location.hash = '#loads'; }); await pg.waitForTimeout(3000); await prep(pg);
  await pg.locator('.cp-content .cp-card').first().screenshot({ path: `${OUT}/broker-my-loads.png` }); console.log('shot broker-my-loads');
  await pg.evaluate(() => { location.hash = '#agents'; }); await pg.waitForTimeout(3500); await prep(pg);
  await pg.locator('.cp-content').screenshot({ path: `${OUT}/broker-agents.png` }); console.log('shot broker-agents');
  await pg.evaluate(() => { location.hash = '#onboarding'; }); await pg.waitForTimeout(3000); await prep(pg);
  // fill step 1 and continue to the packet step
  const cn = pg.locator('input[placeholder="Contact name"]'); if (await cn.count()) { await cn.fill('Dana Whitfield'); await pg.locator('input[placeholder="Phone"]').fill('(469) 555-0100'); await pg.click('button:has-text("Save & continue")'); await pg.waitForTimeout(3500); await prep(pg); }
  await pg.locator('.cp-content .cp-card').first().screenshot({ path: `${OUT}/broker-documents-packet.png` }); console.log('shot broker-documents-packet');
  console.log('step2 text:', (await pg.locator('.cp-content').innerText()).slice(0, 300).replace(/\n/g, ' | '));
} else {
  await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${OUT}/shipper-dashboard.png` }); console.log('shot shipper-dashboard');
  console.log('text:', (await pg.locator('.cp-main, #lb-app').first().innerText()).slice(0, 1200).replace(/\n/g, ' | '));
  await pg.screenshot({ path: `${OUT}/shipper-full.png`, fullPage: true, scale: 'css' });
}
await b.close(); srv.close();
