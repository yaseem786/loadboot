import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// domain-check v2 (audit F02, Sprint 1, 2026-09-05) — v1 + hardening, SAME response shape:
//   • auth: deployed with verify_jwt=true (gateway verifies the signature; v1 had it OFF and accepted
//     any "Bearer ey…" string). In-code: the verified JWT must be role anon|service_role AND for this
//     project (ref/iss). The caller (app_private.shipper_business_start via pg_net) sends
//     Bearer <fmcsa_config.auth_key> = this project's anon JWT — unchanged, works even after key rotation.
//   • SSRF: every hostname we fetch (initial + each redirect hop) is resolved first and refused if
//     any address is loopback/private/link-local/multicast/CGNAT/metadata; only ports 80/443;
//     redirects followed manually, max 3 hops, only http(s); body capped at 400 kB while streaming.
// domain-check v1 (bl_bp_0319) — automated BUSINESS check for shipper signups.
// A shipper has no FMCSA authority to read, so the identity signal is the company's email domain:
//   • MX records  → the domain really receives mail (a parked/typo domain has none)
//   • website     → https://domain (then www.) answers; <title> captured; company name words matched
//   • free_mail   → gmail/yahoo/… never count as a company
// Called from Postgres (pg_net) exactly like fmcsa-verify; the collector cron reads the JSON back.
// No third-party API, no cost. Never asserts a business is fake — "no site" is a missing signal.

const FREE = new Set(["gmail.com","yahoo.com","outlook.com","hotmail.com","aol.com","icloud.com","live.com","msn.com","protonmail.com","proton.me","ymail.com","me.com","comcast.net","att.net","sbcglobal.net","verizon.net","mail.com","zoho.com","gmx.com","yandex.com"]);
const STOP = new Set(["llc","inc","corp","corporation","co","company","ltd","limited","the","and","of","group","logistics","freight","transport","transportation","shipping","international","usa","us","services","service","industries","enterprises","holdings"]);

function corsFor(req: Request) {
  const reqHdr = req.headers.get("access-control-request-headers");
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": reqHdr || "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Max-Age": "86400" };
}
function tokens(s: string): string[] {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
}
function jwtIdentity(auth: string): { role: string; ref: string; iss: string } | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(auth || "");
  if (!m) return null;
  try {
    const b64 = m[2].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - m[2].length % 4) % 4);
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    return { role: String(claims.role || ""), ref: String(claims.ref || ""), iss: String(claims.iss || "") };
  } catch { return null; }
}
function ipIsPrivate(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6 === "::" ) return true;
    if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("ff")) return true;   // link-local, ULA, multicast
    if (v6.startsWith("::ffff:")) return ipIsPrivate(v6.slice(7));                                              // v4-mapped
    return false;
  }
  const p = ip.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;                    // unparsable → refuse
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224                                                             // this-net, 10/8, loopback, multicast+
    || (a === 169 && b === 254)                                                                                   // link-local incl. 169.254.169.254 metadata
    || (a === 172 && b >= 16 && b <= 31)                                                                          // 172.16/12
    || (a === 192 && b === 168) || (a === 192 && b === 0)                                                         // 192.168/16, 192.0.0/24 + 192.0.2/24
    || (a === 100 && b >= 64 && b <= 127)                                                                         // CGNAT 100.64/10
    || (a === 198 && (b === 18 || b === 19));                                                                     // benchmarking
}
async function hostIsSafe(host: string): Promise<{ ok: boolean; why?: string }> {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".supabase.co")) return { ok: false, why: "forbidden host" };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return ipIsPrivate(h) ? { ok: false, why: "literal private ip" } : { ok: true };
  let addrs: string[] = [];
  try { addrs = addrs.concat(await Deno.resolveDns(h, "A")); } catch (_) { /* none */ }
  try { addrs = addrs.concat(await Deno.resolveDns(h, "AAAA")); } catch (_) { /* none */ }
  if (addrs.length === 0) return { ok: false, why: "no address" };
  if (addrs.some(ipIsPrivate)) return { ok: false, why: "resolves to private address" };
  return { ok: true };
}
async function readCapped(r: Response, cap: number): Promise<string> {
  const reader = r.body?.getReader(); if (!reader) return "";
  const chunks: Uint8Array[] = []; let got = 0;
  while (got < cap) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); got += value.byteLength;
  }
  try { await reader.cancel(); } catch (_) { /* noop */ }
  const buf = new Uint8Array(Math.min(got, cap)); let o = 0;
  for (const c of chunks) { const n = Math.min(c.byteLength, buf.byteLength - o); buf.set(c.subarray(0, n), o); o += n; if (o >= buf.byteLength) break; }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}
async function fetchSite(url: string, ms: number) {
  const t0 = Date.now(); const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), ms);
  let cur = url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      let u: URL; try { u = new URL(cur); } catch { return { ok: false, status: 0, final_url: cur, text: "", err: "bad url", took: Date.now() - t0 }; }
      if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, status: 0, final_url: cur, text: "", err: "scheme refused", took: Date.now() - t0 };
      const port = u.port || (u.protocol === "https:" ? "443" : "80");
      if (port !== "443" && port !== "80") return { ok: false, status: 0, final_url: cur, text: "", err: "port refused", took: Date.now() - t0 };
      const safe = await hostIsSafe(u.hostname);
      if (!safe.ok) return { ok: false, status: 0, final_url: cur, text: "", err: `refused: ${safe.why}`, took: Date.now() - t0 };
      const r = await fetch(u.toString(), { redirect: "manual", headers: { "Accept": "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0 (compatible; LoadBootVerify/1.0; +https://loadboot.com)" }, signal: ctrl.signal });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location"); try { await r.body?.cancel(); } catch (_) { /* noop */ }
        if (!loc || hop === 3) return { ok: false, status: r.status, final_url: cur, text: "", err: loc ? "too many redirects" : "redirect without location", took: Date.now() - t0 };
        cur = new URL(loc, u).toString(); continue;
      }
      const text = await readCapped(r, 400000);
      return { ok: r.ok, status: r.status, final_url: cur, text, took: Date.now() - t0 };
    }
    return { ok: false, status: 0, final_url: cur, text: "", err: "too many redirects", took: Date.now() - t0 };
  } catch (e) { return { ok: false, status: 0, final_url: cur, text: "", err: String((e as Error)?.name === "AbortError" ? `timeout after ${ms}ms` : ((e as Error)?.message ?? e)), took: Date.now() - t0 }; }
  finally { clearTimeout(timer); }
}
function titleOf(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 200) : null;
}
function textOf(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").slice(0, 60000);
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const out = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json", ...cors } });
  try {
    // v2 auth. The gateway (verify_jwt=true) has already verified the JWT SIGNATURE, so a forged
    // "Bearer ey…" never reaches this code. Here we check WHO it is: the payload must carry
    // role anon|service_role and belong to THIS project (ref == our SUPABASE_URL subdomain, or
    // iss == our auth endpoint). Exact-key comparison was tried first and broke the real caller:
    // fmcsa_config.auth_key is a valid anon JWT for this project but not byte-equal to the
    // SUPABASE_ANON_KEY env (keys were rotated) — decoding the claims is rotation-proof.
    const auth = req.headers.get("Authorization") || "";
    const who = jwtIdentity(auth);
    const ref = (() => { try { return new URL(Deno.env.get("SUPABASE_URL") || "").hostname.split(".")[0]; } catch { return ""; } })();
    if (!who || !["anon", "service_role"].includes(who.role) || !(who.ref === ref || (who.iss || "").includes(`${ref}.supabase.co`))) return out({ ok: false, error: "unauthorized" });
    let body: any = {};
    if (req.method === "GET") { const u = new URL(req.url); body = { domain: u.searchParams.get("domain"), company: u.searchParams.get("company") }; }
    else body = await req.json().catch(() => ({}));
    const domain = String(body.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const company = String(body.company ?? "").trim();
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || /(^|\.)(local|internal|localhost|lan|home|corp|supabase\.co)$/.test(domain)) return out({ ok: false, error: "Provide a public company domain like acmefreight.com." });
    const free_mail = FREE.has(domain);

    // MX
    let mx_hosts: string[] = []; let mx_err: string | null = null;
    try { const recs = await Deno.resolveDns(domain, "MX"); mx_hosts = (recs as any[]).map((r) => String(r.exchange || r)).slice(0, 5); }
    catch (e) { mx_err = String((e as Error)?.message ?? e); }
    let a_ok = false;
    try { const a = await Deno.resolveDns(domain, "A"); a_ok = Array.isArray(a) && a.length > 0; } catch (_) { try { const a4 = await Deno.resolveDns(domain, "AAAA"); a_ok = Array.isArray(a4) && a4.length > 0; } catch (_) { a_ok = false; } }

    // website
    let site = await fetchSite(`https://${domain}`, 7000);
    if (!site.ok) { const w = await fetchSite(`https://www.${domain}`, 7000); if (w.ok || !site.text) site = w; }
    if (!site.ok && site.status === 0) { const h = await fetchSite(`http://${domain}`, 5000); if (h.ok) site = h; }
    const title = site.ok ? titleOf(site.text) : null;
    const ctoks = tokens(company);
    const hay = site.ok ? (String(title || "") + " " + textOf(site.text)).toLowerCase() : "";
    const hits = ctoks.filter((w) => hay.includes(w));
    const name_match = site.ok && ctoks.length > 0 ? (hits.length >= Math.min(2, ctoks.length)) : null;
    // the domain itself often carries the company name (acmefreight.com ↔ "Acme Freight")
    const domain_name_match = ctoks.some((w) => domain.replace(/[^a-z0-9]/g, "").includes(w));

    return out({ ok: true, domain, free_mail, mx: mx_hosts.length > 0, mx_hosts, mx_err, dns_a: a_ok,
      site: { ok: site.ok, status: site.status, final_url: site.ok ? site.final_url : null, title, took: site.took, err: (site as any).err ?? null },
      name_match, domain_name_match, company_tokens: ctoks, matched_tokens: hits });
  } catch (e) { return out({ ok: false, error: String((e as Error)?.message ?? e) }); }
});
