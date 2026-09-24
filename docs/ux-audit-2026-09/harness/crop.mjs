// node crop.mjs <png> [partHeight=1600]  → <png>-pN.png slices (Playwright-only environment, no PIL)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs'; import path from 'node:path';
const file = path.resolve(process.argv[2]); const ph = Number(process.argv[3] || 1600);
const b64 = fs.readFileSync(file).toString('base64');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0"><img id=i src="data:image/png;base64,${b64}"></body></html>`);
const { w, h } = await page.evaluate(() => new Promise(r => { const i = document.getElementById('i'); const f = () => r({ w: i.naturalWidth, h: i.naturalHeight }); i.complete ? f() : (i.onload = f); }));
await page.setViewportSize({ width: w, height: Math.min(h, 4000) });
let k = 0; for (let y = 0; y < h; y += ph) { const out = file.replace(/\.png$/, `-p${k}.png`); await page.screenshot({ path: out, clip: { x: 0, y, width: w, height: Math.min(ph, h - y) }, fullPage: true }); console.log(out, y, Math.min(ph, h - y)); k++; }
await browser.close();
