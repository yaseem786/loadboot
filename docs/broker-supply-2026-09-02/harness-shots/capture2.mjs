import { login, srv } from './portal.mjs';
const OUT = '/tmp/shots-raw';
const HIDE = '#lbc-fab,#lbc-teaser,#lb-btt{display:none!important} .cp-top{position:static!important} *{caret-color:transparent!important}';
const who = process.argv[2];
const { b, pg } = await login(who);
await pg.addStyleTag({ content: HIDE }); await pg.waitForTimeout(2500);
const shot = async (loc, name) => { await loc.scrollIntoViewIfNeeded(); await pg.waitForTimeout(500); await loc.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); };
if (who === 'shipper') {
  await pg.evaluate(() => window.scrollTo(0, 0)); await pg.screenshot({ path: `${OUT}/shipper-dashboard.png` }); console.log('shot shipper-dashboard');
  await shot(pg.locator('.bt-hero').first(), 'shipper-trust-ladder');
  await shot(pg.locator('.bt-card').filter({ hasText: 'is confirmed' }).first(), 'shipper-business-confirmed');
  await shot(pg.locator('.cp-card').filter({ hasText: 'My loads' }).first(), 'shipper-my-loads');
  await pg.evaluate(() => { location.hash = '#onboarding'; }); await pg.waitForTimeout(3000);
  const cn = pg.locator('input[placeholder="Contact name"]'); if (await cn.count()) { await cn.fill('Priya Natarajan'); await pg.locator('input[placeholder="Phone"]').fill('(559) 555-0140'); await pg.click('button:has-text("Save & continue")'); await pg.waitForTimeout(3500); }
  await pg.addStyleTag({ content: HIDE });
  await pg.click('button:has-text("Continue")').catch(()=>{}); await pg.waitForTimeout(1500);
  await shot(pg.locator('.cp-content .cp-card').first(), 'shipper-packet');
  console.log((await pg.locator('.cp-content').innerText()).slice(0, 400).replace(/\n+/g, ' | '));
} else if (who === 'agent') {
  await shot(pg.locator('.bt-hero').first(), 'agent-trust-ladder');
  await shot(pg.locator('.bt-card').filter({ hasText: '1 · Post under your brokerage' }).first(), 'agent-brokerages');
}
await b.close(); srv.close();
