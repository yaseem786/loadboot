// theme-contrast-check.mjs — WCAG AA gate for app/shared/theme.css (bl_ui_theme, 15 Oct 2026).
// Reads the light (:root) and dark (html[data-lbtheme="dark"]) token blocks and the "contrast-pairs" comment,
// computes the WCAG 2.x contrast ratio of every pair in BOTH themes, prints them, and exits 1 if any pair is
// below its minimum (4.5:1 unless the pair says text:bg:3 for >=18px bold use). Also fails on pure #FFF / #000 text.
// Run: node tools/theme-contrast-check.mjs [path/to/theme.css]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const file = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'shared', 'theme.css');
const css = readFileSync(file, 'utf8');

const block = (re) => { const m = css.match(re); if (!m) throw new Error('token block not found: ' + re); return m[1]; };
const tokens = (src) => { const o = {}; for (const m of src.matchAll(/--lbc-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) o[m[1]] = m[2]; return o; };
const light = tokens(block(/^:root\s*\{([^}]*)\}/m));
const dark = Object.assign({}, light, tokens(block(/^html\[data-lbtheme="dark"\][^{]*\{([^}]*)\}/m)));

const pairsSrc = (css.match(/contrast-pairs[^\n]*\n([\s\S]*?)\*\//) || [])[1] || '';
const pairs = pairsSrc.split(/\s+/).filter(Boolean).map((p) => { const [t, b, min] = p.split(':'); return { t, b, min: min ? Number(min) : 4.5 }; });
if (!pairs.length) { console.error('theme-contrast-check: no contrast-pairs listed in ' + file); process.exit(1); }

const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

let fail = 0;
for (const [name, set] of [['light', light], ['dark', dark]]) {
  for (const p of pairs) {
    const a = set[p.t], b = set[p.b];
    if (!a || !b) { console.log(`FAIL ${name} ${p.t} on ${p.b}: token missing`); fail++; continue; }
    // no pure white / black TEXT (brief rule)
    if (/^#(f{6}|0{6})$/i.test(a)) { console.log(`FAIL ${name} ${p.t} is pure ${a}`); fail++; continue; }
    const r = ratio(a, b);
    const ok = r >= p.min;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(5)} --lbc-${p.t} ${a} on --lbc-${p.b} ${b}  ${r.toFixed(2)}:1 (min ${p.min})`);
  }
}
if (fail) { console.error(`theme-contrast-check: ${fail} pair(s) below WCAG AA`); process.exit(1); }
console.log(`THEME CONTRAST OK — ${pairs.length * 2} pairs pass WCAG AA`);
