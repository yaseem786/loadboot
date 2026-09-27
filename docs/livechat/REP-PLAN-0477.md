# The Rep — onboarding + sales worker: consent → daily digest → nudges → Riley calls (plan, 27 Sep 2026)

Slice of `LIVECHAT-CLAUDE-BRAIN-PLAN.md` §5 (onboarding), §7 (sales), §8 (owner digest) and §14.2 (Riley daily
follow-up), in the order the owner set on 27 Sep: **consent text first, then the daily CC digest, then nudges, then
calls.** Nothing in this file is built yet except what §1 says is already live. Everything below was read from the
repo and the prod schema in this session (searched, not assumed); where I am guessing, the line says so.

Volume that makes this worth doing: **44 carrier signups in the last 7 days** on prod (`profiles.created_at`, role
carrier). Every one of them today gets the blind 14:00 reminder ladder and nothing personal.

---

## 1. Consent check — what the signup surfaces actually say today

| Surface | Phone collected | Consent text shown | Recorded where |
|---|---|---|---|
| **Carrier + agent signup** (`app/carrier/app.js` ~L577; the agent portal is the same form with `window.__LB_AGENT`) | Mobile **required** ("used for voice dispatch") | One **optional, unticked** box: *"…agree to receive **text messages** from LoadBoot… Consent is not a condition… Reply STOP…"* (10DLC-grade). **No Terms/Privacy line at all** — the 24 Sep ux-audit fix landed only on the partner form. | `app_private.sms_consent` (`bl_dial_0390`), `method=web_form`, via `sms_consent_self_sync` |
| **Partner (broker/shipper) signup** (`app/partner/app.js` ~L602) | **No phone field** | "By creating an account you agree to Terms + Privacy" ✅ | — (number arrives later through onboarding items; dispatchers use the verbal/published-CTA path) |
| **Chat onboarding concierge** (`app/shared/ui/lcOnboard.js` ~L349) | Phone (US) **required** | **None.** Only "🔒 Private — never sold, never spammed". The **📞 Call me now** tap is an explicit request for *that one* call — nothing covers later calls, SMS or WhatsApp. | `lc_request_call` (limits 2/visitor/day, 25/day, `bl_voice_0167`); no consent row |
| **Website quote form** (`contact.html`, Netlify form) | Optional | None | Netlify → nowhere in the consent registry |
| **terms.html** | — | Sections: services, dispatch agreement, responsibilities, no guarantee, liability, changes. **No "how we contact you" clause.** | — |
| **privacy.html** | — | "…communicate with you about your loads and account." No mention of automated calls, SMS, WhatsApp or AI voice. | — |

Registry today: `sms_consent` is **SMS-only by design** (it mirrors the Telnyx/TCR campaign declaration; a hard
trigger on `dialer_messages` blocks any text without a row). 18 live rows on prod (broker verbal / published_cta,
carrier web_form). **There is no voice consent and no WhatsApp consent anywhere.** `retell_dial` (`bl_voice_0458`)
has no consent, DNC or calling-hours gate. `wa-auto-worker` sends only the dispatcher assigned/changed notices
(service messages) and checks no opt-in.

### What this means for the rep (confident parts first)

- **SMS** — already right. Keep the box, keep the trigger, do not touch `sms_consent` (a campaign was rejected once
  over exactly this; the current shape is the one that passed).
- **Calls** — Riley is an **artificial/AI voice**. Under the TCPA an artificial or prerecorded-voice call to a mobile
  needs the person's prior express consent, and when the call has any marketing purpose (a lead, "come back and
  book", a plan pitch) it needs prior express **written** consent with a clear disclosure that consent is not a
  condition of purchase (an e-sign/checkbox counts). A number typed into a signup form covers ordinary account-
  servicing contact, and the one-tap "call me now" covers that one call. It does **not** cover a daily AI-voice
  follow-up programme, and it never covers a sales call. *Guess flagged:* I am not certain of the current status of
  the FCC's 2025 one-to-one consent rule after the court challenge; the wording in §2 is written so it holds either
  way (one brand, one number, plain channels). Compliance is the owner's decision (CLAUDE.md §1) — the text below is
  a draft for him, not a ruling.
- **WhatsApp** — Meta's platform rule, not law: business-initiated template messages need the person's opt-in.
  Assignment notices pass as service messages; a nudge programme does not.
- **Dispatchers** — never called (owner rule, 14.2). WhatsApp only, so they need the WhatsApp box like everyone.

## 2. Consent build (first session — after the owner OKs the words)

**Recommendation: keep the SMS box exactly as it is and add ONE more optional, unticked box** (two boxes, each its
own consent kind; one merged box would force a rewrite of the SMS wording the campaign was approved on):

> ☐ *Optional — LoadBoot may **call or WhatsApp** me at this number about my account, loads and paperwork, including
> calls made with an automated or AI voice. This is not a condition of creating an account or buying anything. I can
> stop at any time by saying "stop calling" on a call, replying STOP on WhatsApp, or telling LoadBoot in chat.*

Same block under the phone field in the **chat concierge** and on the **quote form**; a **Terms + Privacy line on the
carrier/agent form** (missing today); a **"How we contact you"** section in `terms.html` and a matching paragraph in
`privacy.html` naming email, SMS, WhatsApp, phone and AI-voice calls, the opt-out routes and that the number is one
line (+1 815 365-1168, from the contact switch — never hard-coded).

Data + gates (one migration, `bl_consent_0477`):
- New `app_private.contact_consent (number, channel in ('voice','whatsapp'), method in ('web_form','visitor_request',
  'verbal','inbound'), evidence, consented_at, revoked_at, org_id, recorded_by)` — separate from `sms_consent` on
  purpose (blast radius). One read function `app_private.consent_state(number) → {sms, voice, whatsapp}` that every
  sender uses.
- `retell_dial`: **raise** without a live voice row, except `reason='visitor_request'` from `lc_request_call`, which
  writes a `visitor_request` row scoped to that call (evidence = chat conversation id) and does not authorise later
  calls. Hours 10:00–18:00 recipient local, 1 attempt/day, 3 total — enforced here, not in the caller.
- WhatsApp: `svc_wa_auto_claim` keeps sending the two assignment notices (service); every other outbound WhatsApp
  (`tool.send_whatsapp`, future nudges) refuses without a whatsapp row. Written through one function only, like
  `unsub_apply`.
- Revoke routes: "stop calling" heard on a call (post-call analysis → revoke), STOP on WhatsApp (inbound webhook →
  revoke), CC → Unsubscribes gets a Calls/WhatsApp tab reading the same table.
- **Existing base**: extend the one-time portal card `app/carrier/sms-optin.js` (already asks late registrants once,
  records yes *and* no, snoozes 30 days) to ask the new box too. Until someone ticks it the rep reaches them by email
  (catalog, always allowed) and SMS where consented — never by call or WhatsApp.
- Anon SECDEF surface: no new public function is needed (portal self-service goes through the existing
  `sms_consent_set_self` pattern as an `authenticated` RPC; revoke explicitly from public/anon at creation).

Gate: throwaway carrier on staging ticks nothing → `retell_dial` raises, WhatsApp nudge refuses, SMS refuses, email
sends; ticks both → all pass; "stop calling" revokes within one minute; then purge the record.

## 3. Daily CC digest (second)

- **Where**: CC → Home (the plan's "Today = the digest", §14 CC table) as a screen, plus one email to the owner
  through the catalog — new key `staff.daily_digest` (class S, `staff_internal`, cadence daily, cap 1/day, trigger
  = the digest sweep). WhatsApp copy later, through the same one-number switch. Time: 07:00 owner time — store the
  zone in `brain_config` (no owner tz exists in the brain config today).
- **Engine**: flip `source.sweep` to live for route `digest` only; pg_cron `brain_digest` beside `brain_housekeep`
  (jobs 64/65 on prod). The sweep writes one `brain_findings` row per section; the CC screen and the email both
  render that JSON, so numbers can never disagree between the two.
- **Sections**: (1) yesterday's signups per role and where each is stuck (`org_onboarding_items.status`); (2) stalled
  — signed up, no activity 48h; (3) documents waiting on a human (gray verdicts); (4) leads new / untouched
  (`crm_leads`, no score column yet — add `score`, `last_touch_at`); (5) chats waiting for a person; (6) what the
  rep did yesterday per channel, and consent collected; (7) cost yesterday / month-to-date from `brain_jobs.usd`
  and the Retell balance (plan §9); (8) **Needs you** — one line each with the suggested action.
- **Activity signal gap**: `profiles` has no last-seen column. Use `auth.users.last_sign_in_at` for session starts
  and add `profiles.last_seen_at` bumped at most once an hour by the portals' existing heartbeat/telemetry path;
  without it "vanished 48h" is a guess.
- Demo orgs (`organizations.is_demo`) never appear. Digest is **read-only** reporting at this stage.

Gate: one week of staging digests on seeded data; every count reconciles with the CC screen it summarises.

## 4. Nudges (third)

- **Channel ladder per person**: email (catalog key — always) → SMS (if `sms_consent`) → WhatsApp (if whatsapp
  consent) → call (§5). **At most one nudge per person per day across all channels.** Stop on any reply, any portal
  activity, any unsubscribe (`unsub_apply` only), any "stop".
- **Reuse before inventing**: the catalog already has `onboarding.item_reminder`, `onboarding.reminder`,
  `onboarding.finish_line`, `onboarding.mc_pending_ack`, `onboarding.broker_next_steps`, `welcome.*`. The rep
  replaces the *decision* behind the 14:00 `loadboot-onboarding-reminders` cron (what exactly is missing, in the
  person's language, on their preferred channel) but keeps the keys, caps and preference groups — the catalog stays
  the law (CLAUDE.md §6). New keys only if a gap is real: `onboarding.stalled_48h`, `sales.lead_followup`.
- **Tools to flip from `prep` → `live`** (rows already exist on prod): `tool.send_email` (catalog-bound),
  `tool.send_whatsapp` (consent-bound), `tool.request_document`, `tool.update_lead_stage`, `tool.create_lead`. Each
  keeps its per-day cap in `brain_permissions` and writes `brain_log`.
- Dispatchers: WhatsApp reply/nudge only. Money, legal, identity values: NEVER (plan §13).
- 4-week spot-check: every nudge copied into the digest §(6).

Gate: throwaway carrier + throwaway lead on staging end-to-end; a fresh signup gets nothing on day one beyond the
existing welcome; a "stop" reply suppresses within one minute; every send matches a catalog key.

## 5. Riley calls (last)

Only after §2 exists and the Retell wiring in `docs/voice-agent/RILEY-0458.md` is fixed. `tool.schedule_riley_call`
→ live; executor = `retell_dial` with the §2 gate (consent, hours, attempts). Triggers per plan 14.2: new carrier
day 1 (voice consent only), vanished 48h (voice consent only), hot lead from chat/form within 10 minutes (their
explicit request). Post-call transcript → the rep updates onboarding / lead state; a money or legal promise heard
→ owner. Add the CC → Riley → Settings **Retell balance** line before this switches on ($30 balance, plan §9).
Chat never names Riley (`bl_lc_0476`); the call offer says "we can ring you".

Gate: three test calls to the owner's own number on the staging config; **no call to any real customer until the
owner says go** (CLAUDE.md §4 — a probe once fired a real notification that could not be recalled).

## 6. Sessions

| # | Piece | Sessions | Blocked on |
|---|---|---|---|
| 1 | §2 consent (migration + two forms + chat concierge + quote form + terms/privacy text + portal card) | 1 | owner OK on the wording |
| 2 | §3 digest (sweep + CC Home + `staff.daily_digest`) | 1–2 | owner tz + channel |
| 3 | §4 nudges (tools live, ladder, reuse of the 14:00 cron) | 2 | §1 |
| 4 | §5 calls | 1 (+ Riley wiring) | §1, §3 spot-check, Retell balance line |

## 7. Owner decisions needed before session 1

1. The consent wording in §2 — two boxes (recommended) or one merged box (then the SMS text changes too).
2. Ask the existing base for call/WhatsApp consent through the portal card — yes/no.
3. Digest: 07:00 in which time zone; CC + email now and WhatsApp later — ok?
4. Keep sending the two dispatcher-assignment WhatsApp notices without an opt-in row (service messages) — yes/no.
5. My recommendation: a day-1 onboarding call is **not** placed without the ticked box, even though it is
   "informational" — the voice is AI and the downside is a TCPA claim against real carriers' money.
