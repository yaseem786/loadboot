import { login, srv } from './portal.mjs';
const OUT = '/tmp/shots-raw';
const HIDE = '#lbc-fab,#lbc-teaser{display:none!important} .cp-top{position:static!important} #lb-btt,[class*="backtotop"],[class*="back-to-top"]{display:none!important} *{caret-color:transparent!important}';
const { b, pg } = await login('broker');
await pg.addStyleTag({ content: HIDE });
await pg.click('button:has-text("Post a load")'); await pg.waitForTimeout(2500);
const f = pg.locator('#bd-postload').first();
const fill = async (ph, val, idx = 0) => { const l = f.locator(`input[placeholder="${ph}"], textarea[placeholder="${ph}"]`).nth(idx); if (await l.count()) await l.fill(val); else console.log('no input', ph); };
const dump = async (tag) => { const inputs = await f.locator('input, select, textarea, button').evaluateAll(els => els.map(e => e.tagName[0] + ':' + (e.placeholder || e.name || e.textContent.trim().slice(0, 28) || e.type) + (e.tagName === 'SELECT' ? '[' + [...e.options].slice(0, 8).map(o => o.value).join('/') + ']' : ''))); console.log(tag, inputs.join(' ; ').slice(0, 1400)); };
await fill('Street address', '4500 Cold Storage Rd', 0); await fill('City', 'Laredo', 0); await fill('State (2 letters)', 'TX', 0); await fill('ZIP *', '78045', 0);
await fill('Street address', '2200 S Ashland Ave', 1); await fill('City', 'Chicago', 1); await fill('State (2 letters)', 'IL', 1); await fill('ZIP *', '60608', 1);
await fill('Miles', '1416'); await fill('Reference (optional)', 'PO-88214');
await pg.evaluate(() => document.activeElement && document.activeElement.blur()); await f.scrollIntoViewIfNeeded(); await pg.waitForTimeout(400); await f.screenshot({ path: `${OUT}/broker-post-step1.png` });
await f.locator('button:has-text("Next")').first().click(); await pg.waitForTimeout(1000);
// step 2
await f.locator('text=FCFS — first come, first served').nth(0).click(); await pg.waitForTimeout(300);
await f.locator('text=FCFS — first come, first served').nth(1).click(); await pg.waitForTimeout(300);
await dump('S2');
const d = new Date(); d.setDate(d.getDate() + 2); const d2 = new Date(d); d2.setDate(d2.getDate() + 2);
const iso = x => x.toISOString().slice(0, 10);
await f.locator('input[type=date]').nth(0).fill(iso(d)); await f.locator('input[type=date]').nth(1).fill(iso(d2));
await fill('e.g. Shipping office · (414) 555-0192', 'Dock office · (956) 555-0140'); await fill('e.g. Receiving · (404) 555-0138', 'Receiving · (312) 555-0188');
await f.locator('input[type=time]').nth(0).fill('06:00'); await f.locator('input[type=time]').nth(1).fill('14:00'); await f.locator('input[type=time]').nth(2).fill('07:00'); await f.locator('input[type=time]').nth(3).fill('15:00'); await dump('S2b');
await f.scrollIntoViewIfNeeded(); await pg.waitForTimeout(400); await f.screenshot({ path: `${OUT}/broker-post-step2.png` });
await f.locator('button:has-text("Next")').first().click(); await pg.waitForTimeout(1000);
for (let i = 3; i <= 5; i++) { console.log('S'+i+' text', (await f.innerText()).slice(0, 900).replace(/\n/g, ' | ')); await dump('S'+i); await f.screenshot({ path: `${OUT}/broker-post-step${i}-raw.png` });
  if (i === 3) { await f.locator('select').nth(0).selectOption('Reefer'); await f.locator('select').nth(1).selectOption('Full truckload (FTL)');
    await fill('Start typing… e.g. frozen chicken, steel coils, drywall', 'Fresh produce (palletized)'); await pg.keyboard.press('Escape'); await fill('Weight (lb) *', '42000'); await fill('Pallets / pieces', '26'); await fill('Rate ($) *', '4400'); await pg.waitForTimeout(800);
    await fill('Cargo value ($ — carrier checks cargo insurance)', '68000'); await fill('Temperature (°F) — required for reefer *', '34');
    await f.locator('select').nth(2).selectOption('Live load'); await f.locator('select').nth(3).selectOption('Live unload');

    await pg.evaluate(() => document.activeElement && document.activeElement.blur()); await pg.waitForTimeout(500); await f.screenshot({ path: `${OUT}/broker-post-step3.png` }); }
  if (i === 4) { const sels = f.locator('select'); await sels.nth(1).selectOption('no'); const cbs = f.locator('input[type=checkbox]'); const n = await cbs.count(); for (let k = 0; k < n; k++) { const lbl = await cbs.nth(k).evaluate(e => (e.closest('label') || e.parentElement).textContent || ''); if (/agree|accept/i.test(lbl) && !(await cbs.nth(k).isChecked())) await cbs.nth(k).check({ force: true }).catch(()=>{}); }
    await f.locator('button:has-text("Tracking required")').click().catch(()=>{}); await pg.waitForTimeout(400); await f.screenshot({ path: `${OUT}/broker-post-step4.png` }); }
  if (i === 5) { await f.screenshot({ path: `${OUT}/broker-post-step5.png` }); }
  const err = await f.locator('.cp-err').allInnerTexts(); if (err.join('').trim()) console.log('  err:', err.join(' '));
  if (i < 5) { await f.locator('button:has-text("Next")').first().click(); await pg.waitForTimeout(1000); } }
await b.close(); srv.close();
