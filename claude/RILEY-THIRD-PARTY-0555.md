# Riley "call someone else" — third-party call plans (bl_voice_0555, 15 Oct 2026)

Spec: `claude/NEXT-SESSION-0539.md` §P. Migration: `migrations/bl_voice_0555_third_party_plans.sql`.

## Status
- **Staging** (`snslhvmkjusozgjelghi`): applied 15 Oct (as five parts `bl_voice_0555a…f`, same SQL as the file).
- **Prod** (`rwscphuhpjoudvljvmdk`): **applied 15 Oct** ("laga do") as one migration `bl_voice_0555_third_party_plans`
  (the file minus its own `begin;`/`commit;` — `apply_migration` is one transaction). Before applying: all anchors found
  on prod, and prod's `riley_dial_gate` / `riley_plan_gate_view` were the exact pre-0555 bodies (nothing else lost).
  After: anon SECDEF **36**, names md5 `06f779f74423a983253c79ab9d4e1e84` (unchanged); all 15 patch tags
  `bl_voice_0555a…o` present; new public RPCs not anon/public-executable; `riley_plan_create` not callable by
  `authenticated`; 5 `target_*` columns; existing plans 18/19 read `target.kind = carrier` and the gate view still
  says ok. Third-party booking stays blocked (`prompt_old`) until the Outbound prompt with `"third_party"` is published.
- anon SECURITY DEFINER surface: staging 35 → 35, names md5 unchanged (`b862e7e2…`). Prod before: 36
  (`06f779f7…`) — must still read 36 / same md5 after. The two new `public` functions are revoked from
  `public, anon` (granted to `authenticated, service_role`).

## What staff get (CC)
- **Carrier 360 → "Plan a Riley call"**: new choice *Who does Riley call?* → **The carrier** (unchanged) |
  **Someone else for this carrier** (name, organisation, role factoring / insurance / broker / shipper / other,
  phone → checked on blur: E.164, time zone from the area code (editable), do-not-call / STOP / "this is a
  carrier's own number" warnings; purpose note required).
- **Riley → Call plans → "Custom call"**: the same form with no carrier (purpose note required).
- Plan card: who is called, their role, "about carrier", their time zone + Mon–Fri 9:00–17:00; Book dialog shows the
  estimated cost (≈ 4 min × $0.13/min + brain) before booking. After the call: **What they confirmed**.
- **Carrier 360 → "Riley calls"** card (new): every plan for the carrier — to the carrier and about the carrier —
  with "What they confirmed" for third-party calls, so staff approve documents with that evidence.

## Rules enforced in Postgres
| Rule | Where |
|---|---|
| Staff only; a person always books (never auto, never auto follow-up, never a carrier email) | `riley_plan_create` (auto_book=false), `riley_dial_gate` (`auto_third_party`), `riley_plan_predial` (a booking with no human booker is cancelled), `riley_followup_rule_noanswer` / `riley_followup_enqueue` / `cc_riley_followup_act` email guard |
| Redacted brain file: carrier name, MC/DOT, dispatcher name, documents the note names (status only, amounts stripped), `confirm X` → yes/no items. No bank/account, TIN, insurance amounts, phone, email, address. Brain tools: `get_facts`, `kb_search` only (no `account_lookup`) | `riley_third_party_context`, `riley_plan_context` branch |
| Opener "Hi, this is Riley, an AI assistant calling on behalf of LoadBoot." + "this call is recorded"; no sales/marketing (brain sets confidence 0.2 → "check first") | `brain_user_text` third-party branch |
| Window Mon–Fri 09:00–17:00 in the TARGET's zone (last start 16:45) | `riley_plan_window` (book, gate view, pre-dial) |
| One call per target number per day; 3 per 7 days (third party counts per number only; carrier plans keep per-carrier-or-number) | `riley_dial_gate` |
| Riley do-not-call list + SMS STOP block; carrier must be real, non-demo | `riley_dial_gate` (unchanged checks) |
| Consent basis recorded: "business contact named by staff (B2B, service call about a shared customer)" + who + when | `riley_plan_create` |
| Retell gets `source = third_party`, `name` = their name, `role` = their role, `topic` = "the carrier X" | `retell_dial`, `riley_plan_book` |
| outcome.confirmed = Retell analysis field `confirmed`, else the call summary; staff get an in-app notification | `riley_plan_on_call` |

Schema: `riley_call_plans` + `target_kind` ('carrier'|'third_party', default carrier), `target_name`, `target_org`,
`target_role`, `target_tz`; `org_id` nullable with `check ((carrier and org_id) or (third_party and name, role, tz,
number and (org_id or note)))`. No DROP anywhere: `riley_plan_new` (7 args) now delegates to the new
`riley_plan_create` (13 args); CC uses the new `cc_riley_plan_create_target` (old `cc_riley_plan_create` untouched).
New helpers: `npa_tz(number)` (area code → US zone, null when unknown), `riley_plan_tz_of(plan)`,
`riley_plan_window(plan, from)`, `public.cc_riley_number_check(number)`.

## Owner actions before the first real third-party call (booking is blocked until done — fail-closed)
1. **CC → Riley → Prompts → Outbound**: add this bullet to the list of sources (next to `"account"`), then **Publish
   Outbound**. Until the published prompt contains `"third_party"`, the gate says *"Riley Outbound's prompt has no
   "third_party" section yet"*.

   ```
   - "third_party": you are NOT calling the carrier. You are calling {{name}}, a {{role}} contact, on behalf of LoadBoot about {{topic}}. As soon as they answer say: "Hi, this is Riley, an AI assistant calling on behalf of LoadBoot. This call is recorded." Then follow the briefing's OPENER and CONFIRM lines. Ask only what the briefing asks. Never give or ask for bank or account numbers, routing numbers, TIN, EIN or SSN, insurance amounts or limits, or anyone's personal details. For each CONFIRM item ask a yes or no question and accept the answer; never read a value out. If they need written authorisation, or ask for anything beyond the briefing, thank them, say a LoadBoot team member will follow up, and end the call. No sales, no offers. Voicemail: "Hi, this is Riley, an AI assistant calling on behalf of LoadBoot for {{name}}. A LoadBoot team member will call back. Thank you." — never leave details on a voicemail.
   ```
   Note: the Outbound `begin_message` is still "Hi, is this {{name}}? It's Riley from LoadBoot." — for a third
   party Riley says that line first, then the AI + recorded line above. If you want the very first words to be the
   spec opener, the clean way is a follow-up: pass an `opener` variable from `retell_dial` and set begin_message to
   `{{opener}}` (not done here — begin_message is shared by every outbound call).
2. **`confirmed` post-call field — nothing to do by hand.** It is in `POST_CALL_ANALYSIS` in
   `supabase/functions/retell-admin/index.ts` (deployed 15 Oct: prod v9, staging v7), so step 1's Publish puts it on the
   agent. Do NOT add it in the Retell dashboard: every Publish overwrites the post-call fields with that list, so a
   dashboard-only field would be wiped by the next Publish. Without it, `outcome.confirmed` falls back to the call summary.
3. **Staging and prod share ONE Retell Outbound agent** (same agent id + API key; checked 15 Oct). Publishing from
   STAGING CC pushes staging's prompt text and begin_message onto the live Riley that prod dials with. So never press
   Publish on staging. For a staging phone test: publish on PROD (step 1), then copy prod's Outbound prompt row into
   staging's `riley_prompts` and mark it published there by SQL (no Retell call), and switch staging's
   `tool.schedule_riley_call` on for the test only (it is off). Staging dials from +1 (737) 306-1175.

## Test (staging, 15 Oct)
- Validation: no name / bad role / bad number / unknown area code / non-US zone / no purpose note / no carrier for a
  carrier call — each returns its plain-English error, nothing inserted.
- Plan #12 (test carrier `77c6e374…`, fake `+1 312 555 0199`, factoring): redacted file correct ($1M stripped from the
  COI name, two `confirm` items, no phone/email); brain plan ready in seconds, $0.017, confidence 0.90, opener
  verbatim, CONFIRM as yes/no, DO NOT SAY lists bank/TIN/amounts/sales.
- Rolled-back runs: window (Thu 16:50 CT → Fri 9:00; Fri 17:00 → Mon 9:00; 8:00 → 9:00); gate (`auto_third_party`,
  `prompt_old` without the section, ok with it, `dnc`); booking (lc_calls role=factoring, topic "the carrier …",
  Retell source third_party); pre-dial `dial` with a human booker, `cancel` with none; after the call status
  `called`, `followup_status` null, `outcome.confirmed` filled, one staff notification, no follow-up brain job.
- Carrier plan regression (7-arg `riley_plan_new`): unchanged — full carrier file, `target.kind = carrier`.
- Plan #12 was cancelled afterwards.

## Prod apply ("laga do")
Apply `migrations/bl_voice_0555_third_party_plans.sql` through the Supabase MCP (one `apply_migration`; it contains no
DROP / `delete from`, so it does not stall). Then: anon SECDEF must read **36**, names md5 `06f779f74423a983253c79ab9d4e1e84`;
`select position('bl_voice_0555o' in pg_get_functiondef('app_private.retell_dial(bigint)'::regprocedure)) > 0`.
On prod `tool.schedule_riley_call` is live (mode prep), so third-party booking opens the moment the Outbound prompt
with the `"third_party"` bullet is published.
