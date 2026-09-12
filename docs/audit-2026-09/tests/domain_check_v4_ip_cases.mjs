// F02 regression: evaluate the current edge implementation, not a copied classifier.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const source = readFileSync(new URL('../../../supabase/functions/domain-check/index.ts', import.meta.url), 'utf8');
const start = source.indexOf('function v6Words('), end = source.indexOf('async function hostIsSafe(');
if (start < 0 || end <= start) throw new Error('Classifier source boundaries changed');
const actual = stripTypeScriptTypes(source.slice(start, end));
const v4 = vm.runInNewContext(actual + '\nipIsPrivate;');

function v3(ip) {
  const h = String(ip || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("ff")) return true;
    const m = h.match(/^::ffff:(.+)$/);
    if (m) {
      const t = m[1];
      if (t.includes(".")) return v3(t);
      const hx = t.split(":");
      if (hx.length === 2) {
        const a = parseInt(hx[0], 16), b = parseInt(hx[1], 16);
        if (Number.isFinite(a) && Number.isFinite(b) && a <= 0xffff && b <= 0xffff)
          return v3(`${(a >> 8) & 255}.${a & 255}.${(b >> 8) & 255}.${b & 255}`);
      }
      return true;
    }
    if (!/^[0-9a-f:]+$/.test(h)) return true;
    return false;
  }
  const p = h.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0)
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

const CASES = [
  // --- the fe80::/10 range. link-local is fe80 THROUGH febf, not just fe80. ---
  ["[fe80::1]",                 true,  "link-local, low end"],
  ["fe90::1",                   true,  "link-local — V3_BUG, v3 said public"],
  ["fea0::1",                   true,  "link-local — V3_BUG"],
  ["feaf::dead:beef",           true,  "link-local — V3_BUG"],
  ["febf::1",                   true,  "link-local, high end — V3_BUG"],
  ["fec0::1",                   false, "site-local (deprecated) is OUTSIDE fe80::/10 — must stay public"],
  ["fe7f::1",                   false, "just below the range — must stay public"],
  // --- loopback / unspecified, every spelling ---
  ["[::1]",                     true,  "loopback, bracketed"],
  ["::1",                       true,  "loopback"],
  ["0:0:0:0:0:0:0:1",           true,  "loopback uncompressed — V3_BUG"],
  ["::",                        true,  "unspecified"],
  ["0:0:0:0:0:0:0:0",           true,  "unspecified uncompressed"],
  // --- ULA + multicast ---
  ["fc00::1",                   true,  "unique-local low"],
  ["fd00::1",                   true,  "unique-local"],
  ["fdff:ffff::1",              true,  "unique-local high"],
  ["ff02::1",                   true,  "multicast"],
  // --- v4-mapped, dotted AND the hex form the URL parser produces ---
  ["[::ffff:127.0.0.1]",        true,  "v4-mapped loopback, dotted"],
  ["[::ffff:7f00:1]",           true,  "v4-mapped loopback, hex (what new URL() actually returns)"],
  ["::ffff:10.0.0.5",           true,  "v4-mapped 10/8"],
  ["::ffff:a9fe:a9fe",          true,  "v4-mapped 169.254.169.254 metadata, hex"],
  ["::ffff:8.8.8.8",            false, "v4-mapped public must stay public"],
  ["::ffff:0808:0808",          false, "v4-mapped public, hex"],
  // --- transition mechanisms that smuggle a v4 address ---
  ["2002:7f00:1::1",            true,  "6to4 wrapping 127.0.0.1 — V3_BUG"],
  ["2002:0808:0808::1",         false, "6to4 wrapping 8.8.8.8 stays public"],
  ["64:ff9b::7f00:1",           true,  "NAT64 wrapping 127.0.0.1"],
  ["::127.0.0.1",               true,  "v4-compatible loopback (deprecated) — V3_BUG"],
  // --- ordinary public IPv6 must NOT be broken by any of this ---
  ["2606:4700::1111",           false, "Cloudflare"],
  ["[2001:4860:4860::8888]",    false, "Google DNS, bracketed"],
  // --- junk refuses instead of passing ---
  ["fe80::1::2",                true,  "two '::' — unparsable, refuse"],
  ["not:an:address",            true,  "garbage — refuse"],
];

let fail = 0, v3fail = 0;
for (const [ip, want, why] of CASES) {
  const got = v4(ip);
  const ok = got === want;
  if (!ok) { fail++; console.log(`FAIL  ${ip}  want ${want} got ${got}  (${why})`); }
  if (v3(ip) !== want) v3fail++;
}
console.log(`${CASES.length - fail}/${CASES.length} PASS on current source  |  v3 got ${v3fail} of them wrong`);
process.exit(fail === 0 ? 0 : 1);
