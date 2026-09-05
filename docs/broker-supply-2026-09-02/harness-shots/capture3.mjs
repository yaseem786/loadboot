import { login, srv } from './portal.mjs';
const OUT = '/tmp/shots-raw';
const HIDE = '#lbc-fab,#lbc-teaser,#lb-btt{display:none!important} .cp-top{position:static!important} *{caret-color:transparent!important}';
const { b, pg } = await login('broker');
await pg.addStyleTag({ content: HIDE });
await pg.evaluate(() => { location.hash = '#onboarding'; }); await pg.waitForTimeout(3000); await pg.addStyleTag({ content: HIDE });
// go to step 2 (Authority & legal)
for (let i = 0; i < 3; i++) { const t = await pg.locator('.cp-content .cp-card').first().innerText(); if (/Step 2 of 4/.test(t)) break; if (/Step 1 of 4/.test(t)) { await pg.click('button:has-text("Save & continue")'); } else { await pg.click('button:has-text("← Back")'); } await pg.waitForTimeout(2500); }
const c = pg.locator('.cp-content .cp-card').first(); await c.screenshot({ path: `${OUT}/broker-documents-packet.png` }); console.log('shot packet:', (await c.innerText()).slice(0, 80).replace(/\n/g, ' | '));
await pg.click('button:has-text("Continue")'); await pg.waitForTimeout(1500); await c.screenshot({ path: `${OUT}/broker-documents-step3.png` }); console.log('shot step3:', (await c.innerText()).slice(0, 80).replace(/\n/g, ' | '));
await b.close(); srv.close();
