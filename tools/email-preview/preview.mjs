#!/usr/bin/env node
// tools/email-preview — render an email body EXACTLY as customers receive it (bl_comm_0543).
//
// It imports the real shell (supabase/functions/_shared/email-shell.ts — the same file delivery-worker uses), so the
// preview cannot drift from production. Needs Node >= 22.18 (runs .ts by stripping types).
//
//   1. build the body:  select app_private.email_kit('{...}')      (see claude/EMAIL-SHELL-0543.md)
//   2. save it:         body.html  (a FRAGMENT — no <html>, no logo, no footer, no contact line)
//   3. preview:         node tools/email-preview/preview.mjs body.html --subject "You're all set" --out preview.html
//
// Output: one page with the email in a desktop frame (640px) and a phone frame (375px) side by side, plus
// <out>.email.html = the exact full email. Contact tokens ({{contact_inline}} etc.) are NOT expanded here — the body
// should not need them; the shell's call band carries the contact line.
//
// Flags: --subject "…"  --out file.html  --no-call (emails to agents/dispatchers/referral partners carry no call band)
//        --unsub "Manage email preferences"  (optional mail: shows the footer preference link)

import { readFileSync, writeFileSync } from "node:fs";
import { renderCallBand, renderShell } from "../../supabase/functions/_shared/email-shell.ts";

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const VALUE_FLAGS = ["--subject", "--out", "--unsub"];
const bodyPath = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1]));
if (!bodyPath) { console.error("usage: node tools/email-preview/preview.mjs body.html [--subject s] [--out f] [--no-call] [--unsub label]"); process.exit(1); }

const body = readFileSync(bodyPath, "utf8");
if (/<html|<!doctype/i.test(body.slice(0, 500))) console.warn("WARNING: body is a full HTML document — the worker will strip it. Pass a fragment.");
if (/email-logo|logo[^"']*\.png/i.test(body)) console.warn("WARNING: body contains a logo — the shell already adds the logo. Remove it.");
if (/253-?7575|2537575/.test(body)) console.warn("WARNING: body contains the Riley number — never show it (CLAUDE.md §7).");

const subject = flag("--subject", "");
const out = flag("--out", "email-preview.html");
const unsubLabel = flag("--unsub", null);

// Current CC contact switch (lb_contact_channel, bl_comm_0464): one number for call + WhatsApp.
const ctx = {
  SITE: "https://loadboot.com",
  LOGO: "https://loadboot.com/email-logo-white-2x.png",
  PHONE_DISPLAY: "+1 (815) 365-1168", PHONE_TEL: "+18153651168",
  WA_DISPLAY: "+1 (815) 365-1168", WA_URL: "https://wa.me/18153651168",
  useOne: true, useWa: true, usePhone: true,
};
const email = renderShell(ctx, body, unsubLabel ? "https://loadboot.com/unsubscribe-preview" : null, subject,
  args.includes("--no-call") ? "" : renderCallBand(ctx), unsubLabel || "Unsubscribe");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Email Preview</title>
<style>
  :root{--bg:#e9edf3;--ink:#0f172a;--muted:#64748b}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b1220;--ink:#e2e8f0;--muted:#94a3b8}}
  :root[data-theme="dark"]{--bg:#0b1220;--ink:#e2e8f0;--muted:#94a3b8}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,'Segoe UI',Arial,sans-serif;padding:20px 16px}
  .meta{max-width:1060px;margin:0 auto 18px;font-size:14px;line-height:1.6}
  .meta b{color:var(--muted);font-weight:600;display:inline-block;min-width:64px}
  .row{display:flex;gap:28px;justify-content:center;align-items:flex-start;flex-wrap:wrap}
  .lbl{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
  .desk iframe{width:660px;max-width:calc(100vw - 32px);height:1280px;border:0;border-radius:12px;background:#eef2f8;box-shadow:0 10px 30px rgba(15,23,42,.18)}
  .phone{border:12px solid #111827;border-radius:44px;padding:0;background:#111827;box-shadow:0 10px 30px rgba(15,23,42,.25)}
  .phone iframe{width:375px;height:780px;border:0;border-radius:32px;display:block;background:#eef2f8}
  @media (max-width:760px){.desk{display:none}}
</style></head><body>
<div class="meta"><div><b>Subject</b> ${subject.replace(/</g, "&lt;")}</div>
<div><b>Shell</b> supabase/functions/_shared/email-shell.ts (same code as delivery-worker)</div></div>
<div class="row">
  <div class="desk"><div class="lbl">Desktop</div><iframe srcdoc="${esc(email)}"></iframe></div>
  <div><div class="lbl">Phone · 375px</div><div class="phone"><iframe srcdoc="${esc(email)}"></iframe></div></div>
</div></body></html>`;

writeFileSync(out, page);
writeFileSync(out.replace(/\.html$/, "") + ".email.html", email);
console.log(`preview: ${out}\nemail:   ${out.replace(/\.html$/, "")}.email.html`);
