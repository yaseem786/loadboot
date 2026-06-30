# LoadBoot — Control Tower Expansion, Wave A

Date: 30 June 2026. Wave A turns the marketing site + Command Center into one connected enterprise OS for everything that happens *before* a load: how visitors find LoadBoot, the enquiries they send, and the keywords/pages that bring them. Built on the non-negotiable Control Tower principle — **every number, status and record is clickable and drills into the underlying detail.** Additive, RBAC-gated, audited, proven on staging, and rolled out to production behind flags that stay OFF until you merge the frontend.

## What shipped in Wave A

**Analytics Control Center (first-party, privacy-safe).** A live, cookie-light analytics surface built on our own beacon — no third party required to see who is on the site right now. It shows live visitors (active now / last 30 min, with a per-visitor drill-down), a traffic overview (sessions, pageviews, conversions, form submits), traffic-by-source with click-through to the referrers behind each class, top pages, referrers, and a dedicated **AI-assistant referrals** panel that attributes visits coming from ChatGPT, Perplexity, Gemini, Copilot and Claude. Bots and internal staff traffic are excluded automatically. Every table exports to CSV, Excel and PDF.

**Forms inbox → CRM leads.** Website contact and quote submissions arrive here via a public, honeypot-protected beacon (`submit_web_form`), spam-scored on the way in. Staff triage, assign, close or mark spam, and **convert a submission into a CRM lead in one click** — which also fires the sales follow-up automation (a high-priority task to marketing within 4 hours). Full submission detail opens in a side drawer; the list filters by status and free-text search and exports three ways.

**SEO & Website control center.** Two surfaces: keyword rank tracking (current / previous / best position, click & impression columns, intent, priority, status, with an up/down delta indicator) and a **redirect manager** for 301/302 rules. The redirect manager rejects loops (source = destination) and chains (destination is itself a redirect source) at the database level, so you can't create a broken redirect. Keyword positions are entered manually today and will auto-populate once Search Console is connected — no fabricated ranks.

**Integration shells (honest, not faked).** Six providers are registered as connection points: Google Analytics 4, Google Search Console, Resend (email), Twilio (SMS), Maps/Routing, and FMCSA/SAFER. All show **"Not connected"** until you supply credentials. The Analytics Control Center surfaces GA4 and Search Console as connect-me cards and shows *no* numbers from them until connected.

## Clickable-everything (drill-down) — as required

Live visitor row → visitor session detail. Traffic-source bar → the referrers in that class. Referrer row → its sessions/conversions. Top-page row → that page's traffic. Form row → full submission + actions. Keyword row → edit/track form. None of these are dead KPIs.

## Security & privacy (unchanged posture)

The only anonymous writes are the two public beacons (`track_web_event`, `submit_web_form`) — both `SECURITY DEFINER`, validated, size-capped, and storing no personal identity beyond an anonymous id, page, referrer and self-classified source. All staff reads/writes go through `cc_*` RPCs gated on `analytics.view`, `forms.view`/`forms.manage`, `seo.view`/`seo.manage`, and `integrations.view`/`integrations.manage`. The `app_private` tables remain deny-by-default (RLS on, no API-role grants).

## Production rollout status

| Backend | Staging | Production | Flag (default) |
|---|---|---|---|
| WA1 — Web analytics (`web_sessions`, `web_events`, `track_web_event`, `cc_web_*`) | ✅ proven | ✅ applied | `web_analytics_enabled` = **off** |
| WA2 — Forms → leads (`form_submissions`, `submit_web_form`, `cc_forms_*`) | ✅ proven | ✅ applied | `forms_enabled` = **off** |
| WA3 — SEO (`seo_keywords`, `redirects`, `cc_seo_*`) | ✅ proven | ✅ applied | `seo_enabled` = **off** |
| WA4 — Integration shells (`integration_configs`, `cc_integration_status`) | ✅ proven | ✅ applied | (always visible under Integrations) |

Production data fingerprint after rollout: web_sessions 0, forms 0, keywords 0, redirects 0, integrations 6 (all not_connected). Zero leakage — the flags are off, so nothing new appears in the live Command Center until you merge the frontend and flip the flags.

## Frontend (this PR)

New nav: **Analytics Control Center** (Overview), **Forms inbox** (Sales), **SEO & redirects** (new "SEO & Website" group). Three new views (`analyticsWeb.js`, `forms.js`, `seo.js`), a shared CSV/Excel/PDF exporter (`exporters.js`), Wave A API wrappers, and the routing/flag wiring. All views render clean (no view-level console errors) and are gated behind their flags + permissions, so production stays unchanged until enabled.

## Owner actions to activate the optional layers

These are credential/billing steps only you can do — Wave A works fully on first-party data without them:

- **GA4**: create a GA4 property, then connect it in Integrations (property id is non-secret; any API secret lives in Supabase secrets, never in the browser).
- **Search Console**: verify the domain in Google Search Console and connect it to auto-populate keyword clicks/impressions/positions.
- **Real email/SMS** (carried over): set `RESEND_API_KEY` / `TWILIO_*` secrets to turn queued notifications into real sends.
- **Backups/PITR** (carried over): upgrade the Supabase plan to enable automatic backups.

## How to turn Wave A on (after merge)

In the Command Center, open **Feature flags** and enable `web_analytics_enabled`, `forms_enabled`, and `seo_enabled`. The three new sections appear immediately for staff with the matching permissions. The analytics beacon already ships in every marketing page, so live data begins flowing the moment the flag is on.
