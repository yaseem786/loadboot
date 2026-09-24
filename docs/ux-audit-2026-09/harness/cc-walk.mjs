// CC audit harness. Usage:
//   node cc-walk.mjs <width> [route ...]      (no routes = all 24 nav routes)
// Env: CC_PASS (staging persona password), CC_EMAIL (default owner@lb.test), CC_ACTIONS (js to eval on the page after load)
// Reuses ./cc-state.json (Playwright storageState) when present, so the password is used once per session.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(HERE, 'cc-state.json');
const OUT = path.join(HERE, 'cc-shots');
fs.mkdirSync(OUT, { recursive: true });

const width = Number(process.argv[2] || 390);
const argRoutes = process.argv.slice(3);
const ALL = ['/', '/automation', '/loads', '/market-rates', '/rate-standards', '/carriers', '/compliance', '/documents',
  '/carrier-reminders', '/partners', '/partner-intake', '/dispatchers', '/finance', '/live-chat', '/mailbox', '/support',
  '/crm', '/forms', '/bi', '/web-analytics', '/email-catalog', '/templates', '/integrations', '/settings'];
const routes = argRoutes.length ? argRoutes : ALL;
const single = argRoutes.length === 1;
const BASE = 'http://localhost:8080/app/command-center/';
const EMAIL = process.env.CC_EMAIL || 'owner@lb.test';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--ignore-certificate-errors', '--disable-http2', `--proxy-server=${process.env.HTTPS_PROXY}`,
    '--proxy-bypass-list=localhost;127.0.0.1'],
});
const ctxOpts = { viewport: { width, height: width < 600 ? 844 : 768 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true };
if (width < 600) { ctxOpts.isMobile = true; ctxOpts.hasTouch = true; }
if (fs.existsSync(STATE)) ctxOpts.storageState = STATE;
const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();

const errors = []; const bad = []; const stacks = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300) + (m.location && m.location().url ? ' @' + m.location().url.slice(0, 140) : '')); });
page.on('pageerror', e => { errors.push('PAGEERROR ' + String(e.message).slice(0, 200)); stacks.push(String(e.stack || e)); });
page.on('response', r => { const s = r.status(); if (s >= 400 && !/track_web_event|realtime|websocket/.test(r.url())) bad.push(`${s} ${r.request().method()} ${r.url().slice(0, 160)}`); });

await page.goto(BASE + '#/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
if (await page.locator('input[type=password]').count()) {
  if (!process.env.CC_PASS) { console.error('CC_PASS not set and no saved state'); process.exit(2); }
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', process.env.CC_PASS);
  await page.click('button[type=submit]');
  await page.waitForSelector('.cc-shell', { timeout: 30000 });
  await ctx.storageState({ path: STATE });
  console.log('signed in as', EMAIL, '→ state saved');
} else {
  await page.waitForSelector('.cc-shell', { timeout: 30000 });
  console.log('reused saved state');
}

const slug = r => (r === '/' ? 'today' : r.replace(/^\//, '').replace(/[^a-z0-9-]+/gi, '_'));
const rows = [];
for (const r of routes) {
  errors.length = 0; bad.length = 0; stacks.length = 0;
  await page.goto(BASE + '#' + r, { waitUntil: 'domcontentloaded' }); await page.evaluate(([w, sk]) => { window.__W = w; window.__SKIP = sk; }, [width, process.env.CC_SKIP || '']);
  await page.waitForTimeout(single ? 4000 : 3500);
  if (process.env.CC_ACTIONS) { try { await page.evaluate(process.env.CC_ACTIONS); await page.waitForTimeout(1500); } catch (e) { console.log('CC_ACTIONS failed:', e.message); } }
  const m = await page.evaluate(() => {
    const de = document.documentElement; const W = window.__W || 390;
    const wide = [];
    document.querySelectorAll('body *').forEach(n => { if (n.closest('.cc-tabbar,.cc-nav-scrim,.cc-side,svg' + (window.__SKIP ? ',' + window.__SKIP : ''))) return; const b = n.getBoundingClientRect(); if (b.right > W + 1 && b.width > 0) wide.push({ t: n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''), r: Math.round(b.right) }); });
    return { h: de.scrollHeight, sw: de.scrollWidth, iw: innerWidth, buttons: document.querySelectorAll('button').length, wide: wide.sort((a,b)=>b.r-a.r).slice(0, 14), title: (document.querySelector('h1,h2') || {}).textContent || '' };
  });
  const file = path.join(OUT, `${width}-${slug(r)}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const row = { route: r, h: m.h, sw: m.sw, iw: m.iw, buttons: m.buttons, overflow: m.sw > width ? 'YES' : 'no', errors: errors.length, bad: bad.length };
  rows.push(row);
  console.log(`${r.padEnd(20)} h=${String(m.h).padStart(6)} sw=${m.sw}/${m.iw} ${row.overflow.padEnd(3)} btn=${String(m.buttons).padStart(3)} err=${errors.length} 4xx=${bad.length}  ${m.title.trim().slice(0, 40)}`);
  if (m.wide.length) console.log('   wide:', m.wide.map(w => `${w.t}(r=${w.r})`).join(' '));
  for (const e of [...new Set(errors)].slice(0, single ? 50 : 4)) console.log('   ERR', e);
  for (const b of [...new Set(bad)].slice(0, single ? 50 : 4)) console.log('   4xx', b);
  if (single || process.env.CC_STACKS) for (const s of stacks) console.log('--- STACK ---\n' + s + '\n');
}
await browser.close();
