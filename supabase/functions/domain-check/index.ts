import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
async function fetchSite(url: string, ms: number) {
  const t0 = Date.now(); const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "Accept": "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0 (compatible; LoadBootVerify/1.0; +https://loadboot.com)" }, signal: ctrl.signal });
    const text = (await r.text().catch(() => "")).slice(0, 400000);
    return { ok: r.ok, status: r.status, final_url: r.url, text, took: Date.now() - t0 };
  } catch (e) { return { ok: false, status: 0, final_url: url, text: "", err: String((e as Error)?.name === "AbortError" ? `timeout after ${ms}ms` : ((e as Error)?.message ?? e)), took: Date.now() - t0 }; }
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
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const auth = req.headers.get("Authorization") || "";
    if (anon && auth !== `Bearer ${anon}` && !auth.startsWith("Bearer ey")) return out({ ok: false, error: "unauthorized" });
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
