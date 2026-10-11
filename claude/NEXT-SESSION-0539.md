# Next sessions — hand-off written 11 Oct 2026 (after the SPRINT SHIFT sprint, bl_ob_0532 … bl_avail_0538)

Paste the relevant block into a NEW session (one session per item). Roman Urdu + English, CLAUDE.md applies.
Migration numbers: start at **bl_*_0539** (0532–0538 are taken; a parallel session also used 0532–0534 with other prefixes).
Staging `snslhvmkjusozgjelghi` · prod `rwscphuhpjoudvljvmdk` (prod SQL = separate file for the owner unless he says "laga do").
Supabase MCP quirk: a SECURITY DEFINER body containing a literal `delete from` hangs apply_migration/execute_sql for 60 s —
write that one statement as `execute 'dele' || 'te from …' using …` (see bl_fill_0535c). Supabase SQL Editor (browser)
mis-splits long plpgsql files — the owner applies prod through a Claude session with MCP, not the editor.

## State right now
- Branch `claude/sprint-shift-logistics-bugs-49o43m` fully merged into main (quick-post included). All 5 migrations
  (0532 Home gaps · 0533 no-default answers · 0534 field suggestions · 0535 call→fields · 0536 prefs card) are ON PROD.
  anon SECDEF 36 prod / 35 staging, names = baseline.
- Staging test leftovers (delete if in the way): dialer_calls `0535c000-0000-4000-8000-00000000000[1-2]`,
  carrier_field_suggestions #1 (accepted), call_field_candidates for those calls — all on test org `77c6e374-…`.
- Open owner tasks: WhatsApp "Reply" (quoted reply) — spec in the 8 Oct chat; item P below; N and O below.

---------------------------------------------------------------------------------------------------------------
## P. Riley "call someone else" — third-party call plans (CC staff only)  — REVIEW DONE, nothing built

Owner spec (verbatim, 11 Oct): target choice "The carrier" | "Someone else for this carrier" (name, organisation, role
factoring/insurance/broker/shipper/other, phone E.164 validated, time zone default from area code, editable);
"Custom call" from the Call plans tab with no carrier (purpose note required); riley_call_plans gets nullable
target_kind ('carrier'|'third_party'), target_name, target_org, target_role, target_tz; riley_plan_new takes optional
p_to_number / p_target_* (old signature keeps working); brain briefing for third-party = note + only the carrier facts
the note needs, NO bank/account numbers, TIN, insurance amounts or other PII unless the note says "confirm X" (then
yes/no only); opener always "Hi, this is Riley, an AI assistant calling on behalf of LoadBoot" + "this call is recorded";
business hours = TARGET's tz Mon–Fri 9:00–17:00; one call per target number per day; outcome = transcript + short
"what they confirmed" summary on the plan AND on the carrier's CC page; staff-only; no marketing calls; block DNC/opt-out;
show est. cost ≈ $0.13/min before booking. Test on staging with the owner's own phone as the third party.

What exists (staging = prod, read 11 Oct):
- `app_private.riley_call_plans`: id, **org_id uuid NOT NULL**, contact_name, to_number, contact_role ('carrier'),
  consent jsonb, reason (CHECK: welcome|onboarding_gap|document_missing|choice_pending|no_reply|custom|follow_up),
  note, lang (en|es), status (planning|ready|failed|scheduled|dialing|called|no_answer|cancelled), job_id, plan_text,
  plan, confidence, review_note, brain_usd, est_minutes=4, call_id→lc_calls, error, created_by, parent_id, attempt,
  auto_book, scheduled_for, booked_by/at, called_at, outcome jsonb, followup_* …
  → for "Custom call" either make org_id nullable with `check (org_id is not null or target_kind='third_party')`,
    and fix every `riley_plan_tz(p.org_id)` / org lookups to tolerate null.
- `app_private.lc_calls` (what Retell dials): org_id nullable, to_number, contact_name, contact_role, topic,
  context (= plan_text briefing), source ('account' for plans), scheduled_at, analysis/summary/transcript/recording_url.
  Dialling path: `app_private.voice_run_scheduled` → `app_private.retell_dial` (cron). `riley_plan_predial(call)`
  re-gates right before the dial; `riley_plan_on_call(call_id, event)` writes `outcome` (summary, sentiment, interest,
  next_step, needs_human) from lc_calls.analysis and adds voice_dnc on not_interested/wrong_number.
- `app_private.riley_plan_new(p_org, p_reason, p_note, p_lang, p_actor, p_parent, p_auto_book)`: carrier-only
  checks (kind='carrier', not demo), phone from profiles, consent = "existing account — number given at signup",
  inserts plan, `riley_plan_context(plan)` (FULL carrier facts: mc/dot, compliance snapshot via lc_account_snapshot,
  dispatcher, choices, recent calls), then `brain_enqueue('voice', plan_id, 'voice_plan', question, ctx, null,
  array['get_facts','kb_search','account_lookup'], lang)`. The sink (`brain_sink` → voice_plan branch) stores
  plan_text/plan/confidence. `public.cc_riley_plan_create(p_org, p_reason, p_note, p_lang)` wraps it
  (permission: comm.manage | dispatch.manage | settings.manage).
- `app_private.brain_user_text` voice_plan branch prints WHY THIS CALL / STAFF NOTE / CALL LANGUAGE then the WHOLE
  context JSON (minus user_id/plan_id/reason/staff_note/lang) — third-party must branch on `target_kind` and feed a
  REDACTED context (write `riley_third_party_context(plan)`: carrier name, MC/DOT, the document/topic named in the
  note, dispatcher name; never bank/TIN/insurance amounts; "confirm X" → `{confirm: [{item, expected_yes_no}]}`).
- `app_private.riley_plan_book(plan, when, actor, force, auto)`: tz = `riley_plan_tz(org)` (= us_state_tz(home_base)),
  slot = `riley_call_window(tz, from)` (Mon–Fri **09:00–18:30** local, 11:00 start when tz unknown) → for third-party
  use `target_tz` and a 09:00–17:00 window (add a p_end param or a sibling function). Then `riley_dial_gate` →
  inserts lc_calls (source 'account', contact_role 'carrier') → plan 'scheduled'.
- `app_private.riley_dial_gate(p, auto, slot)` checks, in order: tool.schedule_riley_call enabled/live/mode; brain
  master switch; org is a real carrier (**must be skipped/changed for third_party and custom**); consent.ok; number
  `^\+1[2-9][0-9]{9}$`; `voice_dnc` (last10); SMS STOP in `sms_consent` (treated as do-not-call); retell_config
  (api_key, outbound_agent_id, from_number); outbound prompt has "account" line AND is published
  (`riley_prompts.published_at >= updated_at`); cap_day = one call per (org OR last10) per 20 h (already per number);
  cap_week 3/7d; attempts ≤3; global max_per_day. Consent for a third party: record basis
  'business contact named by staff (B2B, service call about a shared customer)' + actor + at.
- Prompt: `app_private.riley_prompts` (agent_key 'outbound'), begin_message = "Hi, is this {{name}}? It's Riley from
  LoadBoot." and the general prompt branches on `{{source}}` (chat | cc | account). Third-party needs a NEW source
  (e.g. `third_party`) in the prompt: opener "Hi, this is Riley, an AI assistant calling on behalf of LoadBoot …
  this call is recorded", receptionist handling already exists. Prompt edits are an owner action (CC → Riley →
  Prompts → Publish) — the gate blocks booking until published. Variables Retell gets: name, role, topic, source,
  context (= plan_text). Check `retell_dial` for how they are built (from lc_calls.contact_role/source/context).
- Cost: `riley_plan_json` already returns cost {retell_per_min 0.13, est_minutes, brain_usd, est_total} — show it
  on the Plan card before "Book".
- DNC lists: `app_private.voice_dnc` (last10, reason, source, plan_id) via `voice_dnc_add(number, reason, source,
  plan, actor)`; `app_private.sms_consent` revoked_at (STOP); also `app_private.suppressions`, `dialer_sms_optout`.
- Outcome on the carrier's CC page: `riley_plan_on_call` already fills plan.outcome.summary; add
  `outcome.confirmed` (short "what they confirmed" line, from analysis.custom_analysis or the summary) and render it
  in carrier360.js (Riley section) with the document it was about, so staff approve with that evidence.
- CC view: grep `Call plans` / `cc_riley_plans` in app/command-center/views/ (riley*.js) and `ccRileyPlan*` in
  app/shared/api.js. "Plan a Riley call" form is there.
- Migration shape: bl_voice_0539_third_party_plans.sql — columns + check, riley_plan_new (new optional params; old
  signature preserved via a wrapper), riley_third_party_context, brain_user_text branch (anchor patch), riley_dial_gate
  branch (anchor patch or full rewrite), riley_call_window end-hour param, riley_plan_book tz/window branch,
  cc_riley_plan_create new optional params, outcome.confirmed; prompt text change for the owner (not SQL).

---------------------------------------------------------------------------------------------------------------
## N. Document decision SMS (carrier campaign CS3VIAJ) — not started

Spec (11 Oct): on staff approve/reject in CC, queue ONE SMS per carrier per review session (debounce 10 min after the
last decision, then a single summary). Send only if (a) carrier ticked the SMS consent box (`app_private.sms_consent`,
revoked_at null), (b) sms_enabled=true, (c) at least one item rejected / still missing — OR all required docs just
became approved ("You're fully approved"). ≤2 segments, no PII/amounts/TINs:
"LoadBoot: 1 document needs your attention — COI: liability must be $1M. Fix it here:
https://loadboot.com/app/carrier/#documents Reply STOP to opt out." Prefix + STOP suffix come from the shared SMS send
path (prompt K — another session's work; find it: grep `sms_send|telnyx-sms|dialer_messages` in migrations/). Email
unchanged. Log every SMS in dialer_messages (or the SMS outbox) with the doc ids. CC carrier page shows "SMS sent 10:42"
under the decision. Staging only, SMS test number only.
Pointers: the decision hook is `app_private.compliance_decision_notify(p_org, p_req_key, p_status, p_note, p_expiry,
p_document)` (called from the CC decide RPC — grep `compliance_decision_notify` in migrations); `carrier_mandatory_ok(org)`
says "fully approved"; build a `doc_sms_queue` (org, due_at, doc_ids[]) + cron sweep every minute (pattern:
`brain_housekeep` cron in bl_brain_0470). Email catalog rule (CLAUDE.md §6) is for e-mails; SMS has its own consent law.

---------------------------------------------------------------------------------------------------------------
## O. Wrong-slot uploads (T Strick, O&O Murray, 9–10 Oct) — not started

1. AI precheck not saving: only ~6 of ~70 carrier documents in 45 days have `documents.ai_verdict`, 0 of 6 on 10 Oct.
   Start: `lbAiPrecheck` in app/carrier/app.js → edge fn `supabase/functions/doc-precheck/index.ts` (check its logs via
   get_logs, keys, timeouts, and whether a failure silently passes the upload gate). A failed check must show as
   failed in CC, never as "passed".
2. Type mismatch: precheck says MC certificate but slot = COI → carrier sees "This looks like your MC Authority, not
   a COI — upload it to MC Authority instead?" with one-tap move; CC shows a "possible wrong slot" flag.
3. Cheap pre-AI fallback: file name names another type (authority/mc, coi/insurance, w9, noa, bank/void) → confirm
   before submit.
4. Replacing a file in a slot must not silently supersede the old one when the new file is a different kind; confirm
   first; never supersede an approved document (see `carrierUploadDocument` / `cc_pocket_upload_document` and the
   'superseded' status in migrations).
5. CC: one-click "Move to correct slot" per document → `public.cc_reclassify_document` (already updates documents.type
   AND app_private.carrier_compliance); make sure it can restore a superseded document to pending.
Numbers for proof: `select count(*) filter (where ai_verdict is not null), count(*) from public.documents where
created_at > now() - interval '45 days'` (prod, read-only).
