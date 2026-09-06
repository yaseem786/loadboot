// domain_check_v4_ip_cases.mjs — audit F02. Unit cases for domain-check v4's ipIsPrivate().
// Run: node docs/audit-2026-09/tests/domain_check_v4_ip_cases.mjs   (exit 0 = all pass)
// The v4 function below is COPIED VERBATIM from supabase/functions/domain-check/index.ts with the TS types
// stripped — if you edit the edge function, re-copy it here. v3 is kept alongside so the regression the fix
// closes is demonstrated, not just asserted: the cases marked V3_BUG are the ones v3 got wrong.
// RESULT 2026-09-06: 30/30 PASS on v4; v3 gets 8 of them WRONG (all "public" when they are not):
//   fe90::1, fea0::1, feaf::dead:beef, febf::1   — the fe80::/10 range bug Codex found
//   0:0:0:0:0:0:0:1, 0:0:0:0:0:0:0:0             — uncompressed loopback/unspecified
//   2002:7f00:1::1, 64:ff9b::7f00:1              — 6to4 and NAT64 smuggling 127.0.0.1
// (v3 happens to get ::127.0.0.1 right, by accident: its charset test rejects the dots.)

function v6Words(h) {
  const parts = h.split("::");
  if (parts.length > 2) return null;
  const expand = (arr) => {
    const out = [];
    for (const g of arr) {
      if (g === "") return null;
      if (g.includes(".")) {
        const q = g.split(".").map((x) => Number(x));
        if (q.length !== 4 || q.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
        out.push(((q[0] << 8) | q[1]) >>> 0, ((q[2] << 8) | q[3]) >>> 0);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
        out.push(parseInt(g, 16));
      }
    }
    return out;
  };
  const head = expand(parts[0] ? parts[0].split(":") : []);
  if (head === null) return null;
  if (parts.length === 1) return head.length === 8 ? head : null;
  const tail = expand(parts[1] ? parts[1].split(":") : []);
  if (tail === null) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return head.concat(new Array(fill).fill(0), tail);
}
function v4(ip) {
  const h = String(ip || "").trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!h) return true;
  if (h.includes(":")) {
    const w = v6Words(h);
    if (!w) return true;
    const zeros = (n) => w.slice(0, n).every((x) => x === 0);
    if (zeros(8)) return true;
    if (zeros(7) && w[7] === 1) return true;
    if (w[0] >= 0xfe80 && w[0] <= 0xfebf) return true;
    if (w[0] >= 0xfc00 && w[0] <= 0xfdff) return true;
    if (w[0] >= 0xff00) return true;
    const asV4 = (a, b) => `${(a >> 8) & 255}.${a & 255}.${(b >> 8) & 255}.${b & 255}`;
    if (zeros(5) && w[5] === 0xffff) return v4(asV4(w[6], w[7]));
    if (zeros(6) && !(w[6] === 0 && w[7] === 0)) return true;
    if (w[0] === 0x2002) return v4(asV4(w[1], w[2]));
    if (w[0] === 0x0064 && w[1] === 0xff9b) return v4(asV4(w[6], w[7]));
    return false;
  }
  const p = h.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0)
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}
// v3, kept only to show what it got wrong.
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
console.log(`${CASES.length - fail}/${CASES.length} PASS on v4  |  v3 got ${v3fail} of them wrong`);
process.exit(fail === 0 ? 0 : 1);
