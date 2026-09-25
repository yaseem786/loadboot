// Agent/Dispatcher portal audit harness (adapted from docs/ux-audit-2026-09/harness/cc-walk.mjs).
//   node ag-walk.mjs <width> [route ...]   (no routes = all shell + workspace tabs)
// Env: CC_PASS, CC_EMAIL (default agent@lb.test), CC_TRACK (dispatcher|referral|both, default both),
//      CC_ACTIONS (js eval after load), CC_SKIP (extra selectors excluded from overflow probe), CC_STACKS=1
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EMAIL = process.env.CC_EMAIL || 'agent@lb.test';
const STATE = path.join(HERE, 'ag-state-' + EMAIL.replace(/[^a-z0-9]+/gi, '_') + '.json');
const OUT = path.join(HERE, 'ag-shots');
fs.mkdirSync(OUT, { recursive: true });

const width = Number(process.argv[2] || 390);
const argRoutes = process.argv.slice(3);
const SHELL = ['dashboard', 'referral', 'chain', 'earnings', 'payouts', 'verify', 'settings'];
const DW = ['today', 'board', 'trucks', 'bookings', 'brokers', 'money', 'messages', 'email', 'packet', 'kpis'];
const routes = argRoutes.length ? argRoutes : [...SHELL, ...DW];
const single = argRoutes.length === 1;
const BASE = 'http://localhost:8080/app/agent/';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--ignore-certificate-errors', '--disable-http2', `--proxy-server=${process.env.HTTPS_PROXY}`,
    '--proxy-bypass-list=localhost;127.0.0.1'],
});
const ctxOpts = { viewport: { width, height: width < 600 ? 844 : 768 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true,
  geolocation: { latitude: 36.16, longitude: -86.78 }, permissions: ['geolocation'] };
if (width < 600) { ctxOpts.isMobile = true; ctxOpts.hasTouch = true; }
if (fs.existsSync(STATE)) ctxOpts.storageState = STATE;
const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();

const errors = []; const bad = []; const stacks = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300) + (m.location && m.location().url ? ' @' + m.location().url.slice(0, 140) : '')); });
page.on('pageerror', e => { errors.push('PAGEERROR ' + String(e.message).slice(0, 200)); stacks.push(String(e.stack || e)); });
page.on('response', r => { const s = r.status(); if (s >= 400 && !/track_web_event|realtime|websocket/.test(r.url())) bad.push(`${s} ${r.request().method()} ${r.url().slice(0, 200)}`); });

await page.goto(BASE + '#dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
if (await page.locator('.cp-shell').count() === 0) {
  if (!process.env.CC_PASS) { console.error('CC_PASS not set and no saved state'); process.exit(2); }
  const track = process.env.CC_TRACK || 'both';
  const card = page.locator('.cp-rolecard', { hasText: track === 'both' ? 'Do both' : track === 'referral' ? 'Referral Partner' : 'Work as a Dispatcher' });
  if (await card.count()) { await card.first().click(); await page.waitForTimeout(400); }
  const sw = page.locator('a', { hasText: /^Sign in$/ });
  if (await sw.count()) { await sw.first().click(); await page.waitForTimeout(300); }
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', process.env.CC_PASS);
  await page.locator('button.cp-btn-lg', { hasText: /^Sign in$/ }).first().click();
  try { await page.waitForSelector('.cp-shell', { timeout: 30000 }); }
  catch (e) { const t = await page.evaluate(() => document.body.innerText.slice(0, 600)); console.error('LOGIN FAILED. Page text:\n' + t); await page.screenshot({ path: path.join(OUT, 'login-fail.png') }); process.exit(3); }
  await ctx.storageState({ path: STATE });
  console.log('signed in as', EMAIL, '→ state saved');
} else console.log('reused saved state');

const rows = [];
for (const r of routes) {
  errors.length = 0; bad.length = 0; stacks.length = 0;
  await page.goto('about:blank'); await page.goto(BASE + '#' + r, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([w, sk]) => { window.__W = w; window.__SKIP = sk; }, [width, process.env.CC_SKIP || '']);
  await page.waitForTimeout(single ? 4500 : 4000);
  // shot-only: carrier-dark.css body background is `attachment:fixed`; Chromium's fullPage capture paints it for the first viewport only
  await page.addStyleTag({ content: 'body{background-attachment:scroll!important}' });
  if (process.env.CC_ACTIONS) { try { await page.evaluate(process.env.CC_ACTIONS); await page.waitForTimeout(1500); } catch (e) { console.log('CC_ACTIONS failed:', e.message); } }
  const m = await page.evaluate(() => {
    const de = document.documentElement; const W = window.__W || 390;
    const wide = [];
    document.querySelectorAll('body *').forEach(n => { if (n.closest('.cp-tabbar,.cp-side,.cp-drawer,svg,script,style' + (window.__SKIP ? ',' + window.__SKIP : ''))) return; const b = n.getBoundingClientRect(); if (b.right > W + 1 && b.width > 0) wide.push({ t: n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''), r: Math.round(b.right) }); });
    const title = (document.querySelector('.cp-title') || document.querySelector('h1,h2') || {}).textContent || '';
    return { h: de.scrollHeight, sw: de.scrollWidth, iw: innerWidth, buttons: document.querySelectorAll('button').length, wide: wide.sort((a,b)=>b.r-a.r).slice(0, 14), title, hash: location.hash, dw: (document.querySelector('.dw-tab.on') || {}).textContent || '' };
  });
  const file = path.join(OUT, `${width}-${r.replace(/[^a-z0-9-]+/gi, '_')}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const ov = m.sw > width ? 'YES' : 'no';
  console.log(`${r.padEnd(10)} h=${String(m.h).padStart(6)} sw=${m.sw}/${m.iw} ${ov.padEnd(3)} btn=${String(m.buttons).padStart(3)} err=${errors.length} 4xx=${bad.length}  ${m.title.trim().slice(0, 28)} | ${m.hash} ${m.dw.trim().slice(0, 16)}`);
  if (m.wide.length) console.log('   wide:', m.wide.map(w => `${w.t}(r=${w.r})`).join(' '));
  for (const e of [...new Set(errors)].slice(0, single ? 50 : 4)) console.log('   ERR', e);
  for (const b of [...new Set(bad)].slice(0, single ? 50 : 4)) console.log('   4xx', b);
  if (single || process.env.CC_STACKS) for (const s of stacks) console.log('--- STACK ---\n' + s + '\n');
}
await browser.close();
