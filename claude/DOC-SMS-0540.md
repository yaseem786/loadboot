# Item N — Document decision SMS (bl_dial_0540) — staging done, prod pending

## What it does
Staff approve/reject a carrier document in CC → `compliance_decision_notify` (every CC decide path goes through it) →
`app_private.doc_sms_note` puts the decision on ONE open `doc_sms_queue` row per carrier, `due_at` = last decision + 10 min.
Cron `doc_sms_sweep` (every minute) turns a due row into ONE summary text from the carrier's **current** state, runs every
gate, and stores the reason when it does not send. Only when a row is `ready` does it ping edge fn `doc-sms-worker`, which
claims it (writes the `dialer_messages` row + SMS thread first), sends through Telnyx, and marks it sent/failed.
Email is unchanged. `lb.compdec_mute` silences the SMS too.

Texts (GSM-only, ≤2 segments; detail dropped level by level until it fits; prefix + STOP from `sms_compose`):
- `LoadBoot: 1 document needs your attention - COI: Liability must be $1M. Fix it here: https://loadboot.com/app/carrier/#documents Reply STOP to opt out.` (1 segment, staging)
- `LoadBoot: W-9 approved. Still needed: COI, Dispatch agreement. Upload here: … Reply STOP to opt out.`
- `LoadBoot: You're fully approved - every required document is verified. See it here: …` (once per carrier, ever)
- Only approvals with nothing rejected/missing left except things still in review → no text ("Nothing to text").
Staff notes are scrubbed: e-mails removed, digit runs with 9+ digits (TIN, account, phone) → `#`, fancy punctuation → ASCII.

## Gates (in order; the first that fails is the reason CC shows)
nothing to say · `doc_sms_config.enabled` · `dialer_config.enabled AND sms_enabled` · live `sms_consent` row for a member's
number (owner/admin first) · `dialer_sms_optout` (STOP) · `dial_blocked` · test mode (`allow_all=false` → only
`test_numbers`) · `max_per_day` (3/24 h per carrier) · active `line_id`. Quiet hours: outside 8:00–21:00 carrier time
(`riley_plan_tz`, default Chicago) the row is held to 9:00. The claim re-checks the switches, STOP and consent at send time.
A `sending` row the worker never confirmed is marked failed after 10 min, **never re-sent**.

## CC
Carrier page → Onboarding & compliance: under each document a line from `cc_doc_sms_status` —
`📱 SMS sent 10:42 to ***0142` (green) · `SMS goes ~10:52` · `No SMS: <reason>` · `SMS failed: <reason>` (red). Hover = full text.

## Staging state (12 Oct)
Applied `bl_dial_0540_doc_decision_sms` + `bl_dial_0540_sms_clean_fix`; `doc-sms-worker` v1 deployed (verify_jwt false),
pinged once → `{"ok":true,"claimed":0}`. Config: enabled=true, allow_all=false, test_numbers='{}' (empty → nobody gets
texted), line = staging line `643089bd…` (+1 469-527-2754), worker_url set. `dialer_config.sms_enabled` is still **false**
on staging, so every real decision ends as "No SMS: Text messaging is switched off" — the preview text is still stored.
anon SECDEF 35, names = baseline (the 3 new public functions are not anon-executable).

Proof (one transaction, rolled back — nothing left behind): 2 decisions in the window → 1 row, due +10 min; not due →
sweep 0; due → ready; claim → dialer_messages row + thread + `confirmation_sent_at`; done → sent; 2nd session → 1-segment
text above; STOP after `ready` → failed "This number replied STOP before the send"; no-login call to
`cc_doc_sms_status` → "not authorized".

## Owner: to test a real text on staging
1. `update app_private.dialer_config set sms_enabled = true, telnyx_messaging_profile_id = '<staging profile>' where id = 1;`
2. Your phone on the test carrier (org `77c6e374-…`, owner user) with the SMS box ticked in the carrier portal.
3. `update app_private.doc_sms_config set test_numbers = array['+1YOURNUMBER'] where id = 1;`
4. Reject the COI on that carrier in CC with a note → wait 10 min → text arrives; CC shows "SMS sent hh:mm".

## Known: first text is 4 segments
`dialer_config.sms_first_msg_suffix` contains an em dash (`—`), which makes the whole first text UCS-2 (70 chars per
segment). The first document text therefore drops to "1 document needs your attention. Fix it here: …" + suffix and is
still 4 segments. With `-` instead of `—` (same words) the full-detail first text is 2 segments. Owner decision — line in
`migrations/PROD-bl_dial_0540.sql`. Also: that suffix says "texts about your loads"; the campaign wording is the owner's.

## Prod
`migrations/PROD-bl_dial_0540.sql` — SQL → edge fn → config (still OFF) → owner decisions (sending line on CS3VIAJ,
sms_enabled + profile, test number, suffix) → merge. Rollback: unschedule `doc_sms_sweep`, `enabled=false`.
