#!/usr/bin/env node
// Phase 2 SEO — live Google Search Console pull (Node 18+, stdlib only, no npm).
//
// Auth (first one that is set wins; the credential itself is never printed or written):
//   GOOGLE_SA_KEY_B64   base64 of a service-account JSON key (the SA must be a user on the GSC property)
//   GOOGLE_SA_KEY       the same JSON, raw, or a path to it
//   GSC_ACCESS_TOKEN / CLOUDSDK_AUTH_ACCESS_TOKEN   a ready OAuth access token (scope webmasters.readonly)
//
// Site: GSC_SITE_URL (default https://loadboot.com/). Domain properties look like sc-domain:loadboot.com.
//
// Usage:
//   node docs/seo-audit-2026-10/harness/gsc-pull.mjs                 # 28 d + 90 d + 7 d fresh, all tables
//   node docs/seo-audit-2026-10/harness/gsc-pull.mjs --page /flatbed-freight-rates.html   # one page, for a LEDGER BEFORE row
//   node docs/seo-audit-2026-10/harness/gsc-pull.mjs --days 28 --end 2026-09-19           # replay an R-window
//
// Output: docs/seo-audit-2026-10/data/gsc-<endDate>/ (csv per table + SUMMARY.md) and a short stdout summary.
// GSC "fresh" data (dataState=all) reaches up to ~yesterday; final data lags 2–3 days. Fresh rows can move a little.

import { createSign } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(name);

let SITE = process.env.GSC_SITE_URL || "sc-domain:loadboot.com";   // prod edge fns use the domain property
let AUTH = { who: "?", how: "?" };
const PAGE = opt("--page", null);               // path or full URL
const ROWS = Number(opt("--rows", 5000));
const ONLY_DAYS = opt("--days", null);          // single window instead of 7/28/90
const END = opt("--end", null);                 // yyyy-mm-dd
const QUIET = flag("--quiet");

const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const today = new Date(); today.setUTCHours(0, 0, 0, 0);
const endDate = END ? new Date(END + "T00:00:00Z") : addDays(today, -1);   // fresh data reaches yesterday

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessToken() {
  let keyJson = null;
  if (process.env.GOOGLE_SA_KEY_B64 && process.env.GOOGLE_SA_KEY_B64.trim()) {
    keyJson = Buffer.from(process.env.GOOGLE_SA_KEY_B64.trim(), "base64").toString("utf8");
  } else if (process.env.GOOGLE_SA_KEY && process.env.GOOGLE_SA_KEY.trim()) {
    const v = process.env.GOOGLE_SA_KEY.trim();
    keyJson = v.startsWith("{") ? v : readFileSync(v, "utf8");
  }
  if (keyJson) {
    let key;
    try { key = JSON.parse(keyJson); } catch { throw new Error("GOOGLE_SA_KEY(_B64) is not valid JSON"); }
    if (!key.client_email || !key.private_key) throw new Error("service-account JSON has no client_email/private_key");
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: key.token_uri || "https://oauth2.googleapis.com/token",
      iat: now, exp: now + 3600,
    }));
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    const sig = b64url(signer.sign(key.private_key));
    const res = await fetch(key.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${sig}` }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`token exchange failed: HTTP ${res.status} ${j.error || ""} ${j.error_description || ""}`.trim());
    return { token: j.access_token, who: key.client_email, how: "service account" };
  }
  const t = process.env.GSC_ACCESS_TOKEN || process.env.CLOUDSDK_AUTH_ACCESS_TOKEN;
  if (t && t.trim()) return { token: t.trim(), who: "(access token from env)", how: "bearer" };
  throw new Error("no credential: set GOOGLE_SA_KEY_B64, GOOGLE_SA_KEY, or GSC_ACCESS_TOKEN");
}

async function gsc(token, body) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ dataState: "all", ...body }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GSC ${res.status}: ${(j.error && j.error.message) || JSON.stringify(j).slice(0, 300)}`
    + (res.status === 401 ? ` — the ${AUTH.how} credential was rejected (expired access token, or not a GSC-scoped one)` : "")
    + (res.status === 403 ? ` — ${AUTH.who} is not a user on the property ${SITE} (add it in GSC → Settings → Users, or set GSC_SITE_URL=sc-domain:loadboot.com)` : ""));
  return j.rows || [];
}

async function sites(token) {
  const res = await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites", { headers: { authorization: `Bearer ${token}` } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`sites list ${res.status}: ${(j.error && j.error.message) || ""}`);
  return (j.siteEntry || []).map((s) => `${s.siteUrl} (${s.permissionLevel})`);
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function toCsv(rows, dims) {
  const head = [...dims, "clicks", "impressions", "ctr", "position"];
  const lines = [head.join(",")];
  for (const r of rows) lines.push([...(r.keys || []), r.clicks, r.impressions, (r.ctr * 100).toFixed(2), r.position.toFixed(1)].map(csvCell).join(","));
  return lines.join("\n") + "\n";
}
const fmt = (r) => r ? `${r.clicks} / ${r.impressions.toLocaleString("en-US")} / ${(r.ctr * 100).toFixed(2)} % / ${r.position.toFixed(1)}` : "0 / 0 / – / –";
const pagePath = (u) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
const mdTable = (rows, dims, n, keyFmt = (k) => k) => {
  const out = [`| ${dims.join(" · ")} | clicks | impr | CTR | pos |`, `|---|---:|---:|---:|---:|`];
  for (const r of rows.slice(0, n)) out.push(`| ${r.keys.map(keyFmt).join(" · ")} | ${r.clicks} | ${r.impressions.toLocaleString("en-US")} | ${(r.ctr * 100).toFixed(2)} % | ${r.position.toFixed(1)} |`);
  return out.join("\n");
};

async function pullWindow(token, days, outDir, pageFilter) {
  const start = addDays(endDate, -(days - 1));
  const range = { startDate: ymd(start), endDate: ymd(endDate) };
  const filters = pageFilter ? { dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: pageFilter }] }] } : {};
  const [total, byDate, byQuery, byPage, byQueryPage, byCountry, byDevice] = await Promise.all([
    gsc(token, { ...range, ...filters, dimensions: [] }),
    gsc(token, { ...range, ...filters, dimensions: ["date"] }),
    gsc(token, { ...range, ...filters, dimensions: ["query"], rowLimit: ROWS }),
    pageFilter ? Promise.resolve([]) : gsc(token, { ...range, dimensions: ["page"], rowLimit: ROWS }),
    pageFilter ? Promise.resolve([]) : gsc(token, { ...range, dimensions: ["query", "page"], rowLimit: ROWS }),
    gsc(token, { ...range, ...filters, dimensions: ["country"], rowLimit: 25 }),
    gsc(token, { ...range, ...filters, dimensions: ["device"] }),
  ]);
  const tag = pageFilter ? `page-${pagePath(pageFilter).replace(/[^a-z0-9.-]+/gi, "_")}-${days}d` : `site-${days}d`;
  writeFileSync(join(outDir, `${tag}-date.csv`), toCsv(byDate, ["date"]));
  writeFileSync(join(outDir, `${tag}-query.csv`), toCsv(byQuery, ["query"]));
  if (!pageFilter) {
    writeFileSync(join(outDir, `${tag}-page.csv`), toCsv(byPage, ["page"]));
    writeFileSync(join(outDir, `${tag}-query-page.csv`), toCsv(byQueryPage, ["query", "page"]));
  }
  writeFileSync(join(outDir, `${tag}-country.csv`), toCsv(byCountry, ["country"]));
  writeFileSync(join(outDir, `${tag}-device.csv`), toCsv(byDevice, ["device"]));
  return { days, range, total: total[0], byDate, byQuery, byPage, byQueryPage, byCountry, byDevice };
}

(async () => {
  const { token, who, how } = await accessToken();
  AUTH = { who, how };
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "..", "data", `gsc-${ymd(endDate)}`);
  mkdirSync(outDir, { recursive: true });

  let siteList = [];
  try { siteList = await sites(token); } catch (e) { siteList = [`(sites list failed: ${e.message})`]; }
  // If the configured property is not visible but its sibling (sc-domain: vs https://) is, use the sibling.
  const visible = siteList.map((s) => s.split(" ")[0]);
  if (visible.length && !visible.includes(SITE)) {
    const host = SITE.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const alt = visible.find((v) => v === `sc-domain:${host}` || v === `https://${host}/` || v === `https://www.${host}/`);
    if (alt) { console.error(`gsc-pull: ${SITE} not visible to ${who}; using ${alt}`); SITE = alt; }
  }

  const pageFilter = PAGE ? (PAGE.startsWith("http") ? PAGE : SITE.replace(/\/$/, "") + PAGE) : null;
  const windows = ONLY_DAYS ? [Number(ONLY_DAYS)] : [7, 28, 90];
  const results = [];
  for (const d of windows) results.push(await pullWindow(token, d, outDir, pageFilter));

  const md = [];
  md.push(`# GSC pull — ${SITE}${pageFilter ? ` · page ${pagePath(pageFilter)}` : ""}`);
  md.push(`Pulled ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC as ${who} (${how}); dataState=all (fresh rows up to ${ymd(endDate)}, final data lags 2–3 d).`);
  md.push(`Properties visible to this credential: ${siteList.join(" · ") || "none"}`);
  md.push("");
  md.push("## Totals (clicks / impressions / CTR / position)");
  md.push("| window | dates | site |", "|---|---|---|");
  for (const r of results) md.push(`| ${r.days} d | ${r.range.startDate} → ${r.range.endDate} | ${fmt(r.total)} |`);
  for (const r of results) {
    md.push("", `## ${r.days} d — ${r.range.startDate} → ${r.range.endDate}`);
    md.push("", `### Daily`, "", mdTable(r.byDate, ["date"], 90));
    md.push("", `### Top queries (${r.byQuery.length} rows, by clicks)`, "", mdTable([...r.byQuery].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions), ["query"], 40));
    md.push("", `### Top queries by impressions`, "", mdTable([...r.byQuery].sort((a, b) => b.impressions - a.impressions), ["query"], 40));
    if (!pageFilter) {
      md.push("", `### Top pages (${r.byPage.length} rows, by clicks)`, "", mdTable([...r.byPage].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions), ["page"], 40, pagePath));
      md.push("", `### Top pages by impressions`, "", mdTable([...r.byPage].sort((a, b) => b.impressions - a.impressions), ["page"], 40, pagePath));
    }
    md.push("", `### Country`, "", mdTable(r.byCountry, ["country"], 10));
    md.push("", `### Device`, "", mdTable(r.byDevice, ["device"], 3));
  }
  writeFileSync(join(outDir, pageFilter ? `SUMMARY-${pagePath(pageFilter).replace(/[^a-z0-9.-]+/gi, "_")}.md` : "SUMMARY.md"), md.join("\n") + "\n");

  if (!QUIET) {
    console.log(`site ${SITE}${pageFilter ? " page " + pagePath(pageFilter) : ""} · as ${who} (${how}) · out ${outDir}`);
    console.log(`properties: ${siteList.join(" · ") || "none"}`);
    for (const r of results) console.log(`${String(r.days).padStart(3)} d ${r.range.startDate}→${r.range.endDate}: ${fmt(r.total)}  (${r.byQuery.length} queries${pageFilter ? "" : `, ${r.byPage.length} pages`})`);
  }
})().catch((e) => { console.error("gsc-pull:", e.message); process.exit(1); });
