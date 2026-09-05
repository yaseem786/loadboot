import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = '/tmp/portal'; const SB = 'https://snslhvmkjusozgjelghi.supabase.co';
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
export const srv = http.createServer(async (q, r) => {
  if (q.url.startsWith('/sb/')) {   // relay to Supabase (browser cannot reach the egress proxy reliably)
    const chunks = []; for await (const c of q) chunks.push(c);
    const headers = {}; for (const [k, v] of Object.entries(q.headers)) if (!['host', 'connection', 'content-length', 'accept-encoding'].includes(k)) headers[k] = v;
    try {
      const up = await fetch(SB + q.url.slice(3), { method: q.method, headers, body: ['GET', 'HEAD'].includes(q.method) ? undefined : Buffer.concat(chunks), redirect: 'manual' });
      const out = {}; up.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(k)) out[k] = v; });
      const buf = Buffer.from(await up.arrayBuffer()); r.writeHead(up.status, out); r.end(buf);
    } catch (e) { console.log('relay error', q.url.slice(0, 80), e.message); r.writeHead(502); r.end(); }
    return;
  }
  let u = decodeURIComponent(q.url.split('?')[0].split('#')[0]); if (u.endsWith('/')) u += 'index.html'; const p = path.join(ROOT, u);
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8340);
export async function login(who, opts = {}) {
  const creds = { broker: ['ops@atlasfreight-demo.com', 'LbDemo!2026'], shipper: ['ops@acmemfg-demo.com', 'LbDemo!2026'], agent: ['marcus@freightagents-demo.com', 'LbDemo!2026'] }[who];
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 200)));
  await pg.goto('http://localhost:8340/app/partner/'); await pg.waitForSelector('input[type=email]', { timeout: 15000 });
  await pg.fill('input[type=email]', creds[0]); await pg.fill('input[type=password]', creds[1]);
  await pg.click('button:has-text("Sign in")'); await pg.waitForSelector('.cp-shell .cp-content, .cp-shell-1col', { timeout: 40000 }); await pg.waitForTimeout(5000);
  return { b, pg };
}
if (process.argv[1].endsWith('portal.mjs')) {
  const who = process.argv[2] || 'broker';
  const { b, pg } = await login(who);
  console.log('title', await pg.evaluate(() => (document.querySelector('.cp-top-title') || {}).textContent), 'font', await pg.evaluate(() => document.fonts.check('800 16px Manrope')));
  await pg.screenshot({ path: `/tmp/shot-${who}-dashboard.png` });
  await b.close(); srv.close();
}
