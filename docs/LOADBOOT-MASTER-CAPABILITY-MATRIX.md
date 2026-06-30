# LoadBoot — Master Capability Matrix (truth-based)

Last updated: 30 June 2026. This is the single source of truth. A capability is only **Live** if it has a secured backend, real UI, real mutation, server-side authorization, audit, states, and proven workflow. "Module exists" is not counted.

**Status legend**
- ✅ **Live** — backend + UI + workflow proven (Golden Workflow or browser/DB test)
- 🟦 **Backend live, UI light** — secured backend + workflow proven; UI minimal or list-only
- 🟨 **Partial** — data model present, workflow incomplete
- 📥 **Queued only** — recorded but not transmitted externally
- 🔑 **Needs provider credentials** (owner action)
- 💳 **Needs billing** (owner action)
- ⬜ **Missing / deferred**

**Golden Workflow:** executed end-to-end on staging — **17/17 PASS** (lead → account → onboarding → docs → compliance → approve → load → match → trip → carrier confirm in Pocket → dispatch → check-call → delivery → auto-invoice → settlement → payout held for approval → carrier views invoice → audit + analytics). Money is never auto-released; carrier isolation held.

---

## A. Platform & security
orgs/multi-tenancy ✅ · staff & roles ✅ · scopes/permissions ✅ (51) · feature flags ✅ · typed settings ✅ · audit ✅ · monitoring/health ✅ (`cc_system_health`) · sessions ✅ · MFA readiness 🟨 · staff invitations 🟨 (flag off) · security events 🟨 · data retention ⬜ · **backup/DR 💳** · incident runbook 🟨

## B. CRM & sales
leads ✅ · pipeline stages ✅ · source attribution ✅ · activities (calls/emails/notes) ✅ · tasks/follow-ups ✅ (automation) · carrier companies ✅ · contacts 🟨 · conversion reporting 🟨 · shippers ⬜ · brokers ⬜ · campaigns ⬜

## C. Carrier onboarding
applications ✅ · MC/DOT ✅ · W-9 ✅ · authority ✅ · MCS-150 ✅ · insurance/COI ✅ · onboarding checklist ✅ · approval ✅ · rejection ✅ · renewal/expiry alerts ✅ (daily cron) · equipment/lanes/rate prefs 🟨 (profile fields) · suspension 🟨 · BOC-3 ⬜ · UCR ⬜ · drivers ⬜ · agreements/e-sign ⬜

## D. Compliance & safety
authority status ✅ · insurance expiration ✅ · compliance checklist + gate ✅ · expiry automation ✅ · scorecards 🟨 · exceptions 🟨 · FMCSA/SAFER ⬜ (integration) · safety scores ⬜ · driver qualification files ⬜ · license/medical expiry ⬜ · incidents/claims ⬜ · retention ⬜

## E. Loads & dispatch
load creation ✅ · carrier matching ✅ (scored) · assignment ✅ · cancellation ✅ · dispatch board ✅ · multi-stop 🟨 (stops table) · rate confirmation 🟨 (template, no PDF) · deadhead 🟨 · reassignment 🟨 · exception mgmt 🟨 · import ⬜ · offers ⬜ · RPM/all-in RPM ⬜ · equipment compatibility ⬜ · HOS ⬜ · broker/credit/factoring checks ⬜ · negotiation records ⬜ · recurring lanes ⬜ · team-driver ⬜

## F. Trips & execution
status milestones ✅ · check-ins ✅ (notes + automated check-call) · delivery completion ✅ · driver/truck/trailer 🟨 (fields) · appointments/windows 🟨 · POD 🟨 (note, no file) · rescheduling 🟨 · route planning ⬜ · ETA ⬜ · GPS/ELD/location ⬜ · detention/layover/lumper/TONU ⬜ · breakdown/weather/missed-appointment exceptions ⬜

## G. Communications
in-app messaging ✅ · load/carrier threads ✅ · internal notes ✅ · templates ✅ · automated check-calls ✅ · escalations ✅ (SLA) · **email 📥🔑** · **SMS 📥🔑** · push ⬜ · delivery receipts ⬜ · notification preferences ⬜ · broadcast ⬜

## H. Documents
document review ✅ (status) · expiry ✅ · POD 🟨 (note) · invoices 🟨 (data, **no PDF yet**) · W-9/COI 🟨 (records, **no real file storage**) · rate cons/BOL ⬜ (PDF gen) · version history ⬜ · OCR-ready ⬜ · e-signature ⬜ · signed private access ⬜ · malware/file validation ⬜ · retention ⬜

## I. Finance
dispatch fees (flat 5%) ✅ · invoices ✅ · **auto-invoice on delivery ✅** · payout approval (human gate) ✅ · payment status ✅ · revenue reports ✅ · settlement lines 🟨 · accessorials/deductions ⬜ · advances/quick pay ⬜ · reconciliation ⬜ · disputes/refunds ⬜ · factoring ⬜ · accounting export ⬜ · carrier statements ⬜ · 1099 ⬜

## J. Support & operations
SLA ✅ · escalations ✅ (auto) · internal notes ✅ · ops radar ✅ · priorities 🟨 · incident mgmt 🟨 · tickets/cases ⬜ · ownership/resolutions ⬜ · knowledge base ⬜

## K. Analytics & intelligence
revenue ✅ · carrier performance ✅ · on-time rate ✅ · document expiry ✅ · automation performance ✅ (health) · smart matching ✅ · margin/finance aging 🟨 · sales conversion 🟨 · RPM/deadhead/lane history ⬜ · dispatcher performance ⬜ · anomaly alerts ⬜ · forecasting ⬜

## L. Marketing & content
pages ✅ · blog ✅ · publish workflow ✅ · tags/categories 🟨 · SEO 🟨 · revisions ⬜ · redirects ⬜ · forms ⬜ · banners ⬜ · email campaigns ⬜ · Search Console ⬜ · consent ⬜

## M. Integrations
webhooks ✅ (config + queued, no auto-send) · **email provider 🔑** · **SMS provider 🔑** · FMCSA/SAFER ⬜ · Maps/routing ⬜ · ELD ⬜ · push ⬜ · e-signature ⬜ · Stripe/banking ⬜ · factoring ⬜ · QuickBooks ⬜ · load boards ⬜ · public API ⬜ · import/export ⬜

## N. Carrier Pocket App
auth ✅ · trip status ✅ · load approval (confirm) ✅ · invoices ✅ · compliance ✅ · **strict per-carrier isolation ✅ (proven)** · profile 🟨 · settlements 🟨 · notifications 🟨 · installable PWA / offline shell 🟨 · equipment/drivers ⬜ · available loads (self-serve) ⬜ · document upload ⬜ · messaging ⬜ · support ⬜ · consented location ⬜

---

## P0 production blockers — current truth

| P0 | Status | Evidence / owner action |
|---|---|---|
| P0.1 Backups / PITR | **BLOCKED 💳** | Free Supabase plan, no automatic backups. **Owner must upgrade the plan** to enable PITR. No code can substitute. |
| P0.2 Credential hygiene | Partial | Leaked-password protection is OFF (advisor notice) — owner toggles in Auth settings. Secrets rotation is an owner task. |
| P0.3 Real user activation | Owner | Real signup/auth (carrier + staff) cannot be created by the assistant. Owner provisions accounts; the flows are built and proven with synthetic users. |
| P0.4 Real email/SMS delivery | **BLOCKED 🔑** | Infra written (`supabase/functions/notification-dispatcher`). **Owner must set `RESEND_API_KEY` (email) / `TWILIO_*` (SMS) secrets**, then the dispatcher + cron deliver. Until then, notifications are queued (no silent sends). |
| P0.5 Observability | **DONE ✅** | `cc_system_health` live on production — automation queue, cron job last-run status, notification + security health. Verified: status healthy, jobs succeeding. |

## What is genuinely autonomous now
Three scheduled jobs run in production with verified successful runs: outbox processing (every minute), SLA escalation (every 5 min), compliance-expiry scan (daily 06:00). Auto-invoicing fires on delivery via DB trigger. All high-risk actions (carrier approval, payout, privilege changes) remain human-gated by design.
