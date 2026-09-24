// node mk-sections.mjs <width> <page> — per-section height map of a signed-out page (which block eats the phone)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const width = Number(process.argv[2] || 390); const p = process.argv[3] || 'index.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--ignore-certificate-errors', '--disable-http2', `--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=localhost;127.0.0.1'] });
const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 768 }, isMobile: width < 600, hasTouch: width < 600, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await page.goto('http://localhost:8080/' + (p === 'index.html' ? '' : p), { waitUntil: 'load' }); await page.waitForTimeout(1500);
const rows = await page.evaluate(() => {
  const out = []; const walk = (el, depth) => { for (const c of el.children) { const b = c.getBoundingClientRect(); if (b.height < 40) continue; const t = (c.querySelector('h1,h2,h3,.eyebrow,b') || c).textContent.trim().replace(/\s+/g, ' ').slice(0, 60); out.push({ d: depth, tag: c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') + (typeof c.className === 'string' && c.className ? '.' + c.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''), h: Math.round(b.height), top: Math.round(b.top + scrollY), t, a: c.querySelectorAll('a[href]').length }); if (depth < 1 && /main|body|div/.test(c.tagName.toLowerCase()) && !/section|footer|header/.test(c.tagName.toLowerCase())) walk(c, depth + 1); } };
  walk(document.body, 0); return out;
});
for (const r of rows) console.log(`${' '.repeat(r.d * 2)}${r.tag.padEnd(34)} h=${String(r.h).padStart(5)} top=${String(r.top).padStart(6)} a=${String(r.a).padStart(3)}  ${r.t}`);
await browser.close();
