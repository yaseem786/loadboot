// Marketing site (signed-out) audit harness — sibling of ag-walk.mjs / cc-walk.mjs.
//   node mk-walk.mjs <width> [page ...]      (no pages = every <loc> in site/sitemap.xml)
// Env: MK_SKIP (extra selectors excluded from the overflow probe), MK_ACTIONS (js eval after load),
//      MK_SHOT=0 to skip screenshots (fast full-site pass), MK_BASE (default http://localhost:8080/)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'mk-shots');
fs.mkdirSync(OUT, { recursive: true });
const width = Number(process.argv[2] || 390);
const argPages = process.argv.slice(3);
const BASE = process.env.MK_BASE || 'http://localhost:8080/';
const SHOT = process.env.MK_SHOT !== '0';
let pages = argPages;
if (!pages.length) {
  const sm = fs.readFileSync(path.join(HERE, '..', '..', '..', 'site', 'sitemap.xml'), 'utf8');
  pages = [...sm.matchAll(/<loc>https:\/\/loadboot\.com\/([^<]*)<\/loc>/g)].map(m => m[1] || 'index.html');
}
const single = pages.length === 1;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--ignore-certificate-errors', '--disable-http2', `--proxy-server=${process.env.HTTPS_PROXY}`,
    '--proxy-bypass-list=localhost;127.0.0.1'],
});
const ctxOpts = { viewport: { width, height: width < 600 ? 844 : 768 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true };
if (width < 600) { ctxOpts.isMobile = true; ctxOpts.hasTouch = true; }
const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();
const errors = []; const bad = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 240) + (m.location && m.location().url ? ' @' + m.location().url.slice(0, 120) : '')); });
page.on('pageerror', e => errors.push('PAGEERROR ' + String(e.message).slice(0, 200)));
page.on('response', r => { const s = r.status(); if (s >= 400 && !/track_web_event|realtime|websocket/.test(r.url())) bad.push(`${s} ${r.request().method()} ${r.url().slice(0, 160)}`); });

for (const p of pages) {
  errors.length = 0; bad.length = 0;
  const url = BASE + (p === 'index.html' ? '' : p);
  try { await page.goto(url, { waitUntil: 'load', timeout: 30000 }); } catch (e) { console.log(`${p.padEnd(52)} GOTO FAILED ${e.message.slice(0, 80)}`); continue; }
  await page.evaluate(([w, sk]) => { window.__W = w; window.__SKIP = sk; }, [width, process.env.MK_SKIP || '']);
  await page.waitForTimeout(single ? 2500 : 1200);
  if (process.env.MK_ACTIONS) { try { await page.evaluate(process.env.MK_ACTIONS); await page.waitForTimeout(1200); } catch (e) { console.log('MK_ACTIONS failed:', e.message); } }
  const m = await page.evaluate(() => {
    const de = document.documentElement; const W = window.__W || 390;
    const wide = [];
    document.querySelectorAll('body *').forEach(n => {
      if (n.closest('svg,script,style,noscript' + (window.__SKIP ? ',' + window.__SKIP : ''))) return;
      const cs = getComputedStyle(n); if (cs.position === 'fixed' && cs.visibility === 'hidden') return;
      const b = n.getBoundingClientRect(); if (b.right > W + 1 && b.width > 0 && b.height > 0) wide.push({ t: n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''), r: Math.round(b.right) });
    });
    const h1s = [...document.querySelectorAll('h1')].map(h => h.textContent.trim().slice(0, 60));
    const noalt = [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).map(i => (i.getAttribute('src') || '').slice(-40));
    const tiny = [...document.querySelectorAll('a,button')].filter(a => { const b = a.getBoundingClientRect(); const cs = getComputedStyle(a); return b.width > 0 && b.height > 0 && b.height < 24 && cs.display !== 'inline' && b.top < de.scrollHeight; }).length;
    const desc = (document.querySelector('meta[name=description]') || {}).content || '';
    const hero = document.querySelector('main h1, h1'); const heroTop = hero ? Math.round(hero.getBoundingClientRect().top) : -1;
    const hdr = document.querySelector('header'); const hdrH = hdr ? Math.round(hdr.getBoundingClientRect().height) : 0;
    return { h: de.scrollHeight, sw: de.scrollWidth, iw: innerWidth, buttons: document.querySelectorAll('button').length, links: document.querySelectorAll('a[href]').length,
      wide: wide.sort((a, b) => b.r - a.r).slice(0, 12), title: document.title, h1s, noalt, tiny, descLen: desc.length, heroTop, hdrH };
  });
  const file = path.join(OUT, `${width}-${(p === 'index.html' ? 'index' : p.replace(/\.html$/, '')).replace(/[^a-z0-9-]+/gi, '_')}.png`);
  if (SHOT) await page.screenshot({ path: file, fullPage: true });
  const ov = m.sw > width ? 'YES' : 'no';
  const flags = [];
  if (m.h1s.length !== 1) flags.push(`h1=${m.h1s.length}`);
  if (m.noalt.length) flags.push(`noalt=${m.noalt.length}`);
  if (m.tiny) flags.push(`tiny=${m.tiny}`);
  if (m.descLen < 50 || m.descLen > 170) flags.push(`desc=${m.descLen}`);
  if (m.title.length > 65) flags.push(`title=${m.title.length}`);
  console.log(`${p.padEnd(52)} h=${String(m.h).padStart(6)} sw=${m.sw}/${m.iw} ${ov.padEnd(3)} hdr=${m.hdrH} h1top=${m.heroTop} btn=${String(m.buttons).padStart(3)} a=${String(m.links).padStart(3)} err=${errors.length} 4xx=${bad.length} ${flags.join(' ')}`);
  if (m.wide.length) console.log('   wide:', m.wide.map(w => `${w.t}(r=${w.r})`).join(' '));
  if (m.h1s.length !== 1) console.log('   h1s:', JSON.stringify(m.h1s));
  if (m.noalt.length && (single || m.noalt.length > 2)) console.log('   noalt:', m.noalt.slice(0, 6).join(' '));
  for (const e of [...new Set(errors)].slice(0, single ? 50 : 3)) console.log('   ERR', e);
  for (const b of [...new Set(bad)].slice(0, single ? 50 : 3)) console.log('   4xx', b);
}
await browser.close();
