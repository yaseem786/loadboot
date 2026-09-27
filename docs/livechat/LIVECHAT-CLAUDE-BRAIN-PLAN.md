# LoadBoot Ops Brain — Claude-powered, human-free operations (plan)

Written 27 Sep 2026. Owner brief, in his words: run live chat, hello@/dispatch@, onboarding
(carrier, broker, dispatcher, agent, shipper), dispatcher ops, sales and support "like an
Amazon team, so I need no staff and can stay on development." Everything below is built
**staging first**, section by section, in the order of §12. Nothing goes to prod without the
gate in that section.

Numbers in this doc are from prod on 27 Sep 2026 (read-only counts). Re-run §1 before
building; if they moved a lot, re-check the cost in §13.

---

## §0 Decisions (already made — do not re-open without the owner)

| Decision | Value |
|---|---|
| Brain model | **Claude Fable 5.1** (`claude-fable-5-1`) for every customer-facing reply and every judgement call. **Haiku 4.5** (`claude-haiku-4-5`) only for spam/intent gates and bulk classification. No other model. |
| Effort per route | chat reply `low` · email reply `medium` · application verdict / handoff decision / doc verdict `high` · nightly sweeps `medium` |
| Thinking | omit the `thinking` param (Fable: always on). Never `budget_tokens`. |
| Refusal fallback | on: `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"` |
| Prompt caching | system block (rules + facts + KB) cached with `ttl: "1h"`; volatile context after the breakpoint. Verify `cache_read_input_tokens > 0` in staging before prod. |
| Cost cap | `brain_config.daily_usd_cap` (default $25). Over cap → Gemini fallback for chat, hold-and-digest for email, nothing dropped. |
| Kill switch | `brain_config.enabled=false` (instant, same as today's `lc_brain_config`). |
| Stays human (the owner) | money (payouts, commissions, bank changes, refunds, disputes), partnership, legal/claims, press, gray applications, regulation approvals, angry customer with low confidence. The brain **prepares** these (summary + suggested reply); it never sends. |
| Branch | as per CLAUDE.md §0 — main. (This cloud session commits on its designated branch; the owner merges.) |

---

## §1 Verification — current state (done 27 Sep 2026; re-run before building)

Query (prod, read-only): 30-day counts.

| Thing | 30 d | Where |
|---|---|---|
| Live chat conversations / visitor msgs / brain jobs | 54 / 143 / 54 | `app_private.lc_conversations`, `lc_messages`, `lc_brain_jobs` |
| Riley calls | 35 | `lc_calls` |
| New profiles / orgs | 107 / 38 | `public.profiles`, `organizations` |
| Dispatcher / agent applications | 40 / 70 | `dispatcher_profiles`, `agent_profiles` |
| Carrier onboarding packets | 9 | `carrier_onboarding` |
| CRM leads · WhatsApp in · dialer calls | 25 · 22 · 11 | `crm_leads`, `wa_messages`, `dialer_calls` |
| CC Mailbox inbound | 93 total, **all loads@**, 86 of them system/postmaster mail | `mail_messages` (direction `in`) |
| dispatch@ (IMAP via dmail) | 8 | `dmail_messages` |
| **hello@ inbound reaching the DB** | **0** | not routed to `inbound-mail` |
| KB | 133 rows, ~62.6K chars (~16K tokens) | `lc_kb` |

Findings that shape the build:
1. Every AI function today is Gemini Flash (`lc-brain` v4 runs with `thinkingBudget 0`). No Claude anywhere.
2. `inbound-mail` (Resend webhook) works, but only `loads@` is pointed at it. hello@ never lands in CC.
3. The Mailbox is 92% noise because system mail (bounces, receipts, our own notifications) is filed as if it were a customer thread.
4. Facts are hard-coded in `lc-brain` (`FACTS` block) — the `site_facts` registry (`bl_mkt_0444`) already exists and is the right source.
5. Event plumbing (Postgres → pg_net → edge function → RPC write-back with a one-time token) is sound. Keep it.

Verification checklist to re-run each time (staging AND prod):
- [ ] anon-executable SECURITY DEFINER surface: compare NAMES to `docs/audit-2026-09/anon-secdef-baseline.md` (36 prod / 35 staging).
- [ ] `select * from app_private.lc_brain_config` — enabled state.
- [ ] Resend inbound routes: which addresses hit `inbound-mail`.
- [ ] `select count(*) from app_private.mail_messages where created_at > now()-interval '30 days'` by mailbox.

**Re-verified 27 Sep 2026 (session 2, before §2):**

| Check | prod `rwscphuhpjoudvljvmdk` | staging `snslhvmkjusozgjelghi` |
|---|---|---|
| anon SECURITY DEFINER names | **36**, identical to the baseline list (33 + `get_public_site_facts`, `newsletter_confirm`, `newsletter_request`) | **35**, same list minus `retell_inbound` |
| `has_schema_privilege('anon','app_private','usage')` | false | false |
| `lc_brain_config.enabled` | true (Gemini, `lc-brain`) | true |
| Live chat convs / brain jobs 30 d | 54 / 54 | 0 / 0 |
| `mail_messages` in, 30 d, by mailbox | `loads@loadboot.com` = 92, nothing else | 0 |
| `dmail_messages` 30 d | 8 | 2 (IMAP login failing on staging — "check the mailbox password") |
| hello@ reaching the DB | still **0** | 0 |
| KB | 133 rows | 109 rows (106 en / 3 es) |

Resend inbound routes could not be read from this session (no Resend API access here); the DB evidence says the same
thing as on the 27th: only `loads@` reaches `inbound-mail`. Owner confirms in Resend → Receiving before §4.

**§1 correction (27 Sep 2026, session 3, after `bl_mail_0471` on prod):** the "86 system/postmaster" mail is not 86
different things. Filed by `mail_classify` on the 93 prod rows: **75 `forwarder_rewrite`** (the Namecheap forwarder
rewrites the sender to `postmaster@*.jellyfish.systems` — every one of them a notification, a receipt or a password
reset; the real sender is gone), **10 `own_copy`** (our own outbound copies and `[TEST → …]` sends), 3 `noreply`,
1 `bounce`, 1 `receipt`, and **3 `human`** (Apple developer support, a carrier reply, a broker). 7 senders arrived as
SRS (`srs0=…@fwd.privateemail.com`) and are now unwrapped to the real address. Inbox = 3 threads, 1 unread.

---

## §2 Foundation — `brain` core (one function, one queue, one audit log)

Migration `bl_brain_0470_core.sql` (staging first):
- `app_private.brain_config` — `enabled`, `model`, `effort` jsonb per route, `daily_usd_cap`, `spot_check_until` (date; while set, every outbound the brain sends is also copied to the owner digest).
- `app_private.brain_jobs` — universal queue: `source` (chat|email|wa|onboarding|dispatch|sales|sweep|voice), `ref_id`, `route`, `status`, `input_tokens`, `cache_read`, `output_tokens`, `usd`, `created_at`, `done_at`, `error`. Replaces `lc_brain_jobs` (kept as a view for the CC screen until §3 lands).
- `app_private.brain_actions` — audit: every tool call the brain made (`create_lead`, `send_email`, `approve_doc`, `escalate`…), with the job, the payload and the result. This is what the owner reads when something looks wrong.
- `app_private.brain_facts` — self-updating facts (§10). Seeded from `site_facts` + the `FACTS` block.
- `app_private.brain_usage_daily` — per-day USD, feeds the cap.
- All new functions: `revoke execute ... from public, anon` explicitly (CLAUDE.md §4). The only anon-callable RPC stays `lc_brain_write`-style token writes; **no new anon secdef name** — the baseline list must not grow.

Edge function `supabase/functions/brain/index.ts` (Deno, `@anthropic-ai/sdk`):
- Same trust model as `lc-brain`: Postgres mints a one-time token and builds the context; the function has no service key; it writes back through one RPC scoped to that token.
- Request shape: `system` = [rules (frozen)] + [facts + KB (cached, 1h)] ; `messages` = context + question ; `tools` = the route's tool list (below). `output_config.effort` from `brain_config`.
- Tools (client tools, executed by Postgres via the write-back RPC, never by the function): `kb_search`, `account_lookup`, `create_lead`, `update_lead_stage`, `send_email(catalog_key, to, vars)` (goes through `sys_email` → catalog + unsub law), `send_whatsapp(template)`, `schedule_riley_call`, `send_signup_link`, `request_document`, `set_doc_verdict(advisory)`, `approve_application` (only when §5 rules say clean), `escalate(reason, summary, suggested_reply)`, `note(internal)`.
- Every reply is structured output `{reply, lang, confidence, actions[], escalate?}`; `confidence < 0.6` → escalate instead of guessing.
- Cost accounting from `response.usage` into `brain_jobs` and `brain_usage_daily` on every call.

Staging gate for §2: 20 synthetic jobs through the queue, `cache_read_input_tokens > 0` on the 2nd+ call, cap trips at the configured number, kill switch verified, secdef names unchanged.

**Build notes — staged 27 Sep 2026** (`migrations/bl_brain_0470_core.sql`, `supabase/functions/brain/index.ts`, both on staging):

- **Write-back is `public.brain_rpc(token, op, payload)`, service_role-only** (revoked from public/anon/authenticated,
  asserted in the migration). The function uses the platform-injected `SUPABASE_SERVICE_ROLE_KEY` for that one call and
  nothing else; every op is still scoped to the job the one-time token names (15-minute life, `queued|running` only).
  This is the one deliberate change from the wording above ("no service key"): it is what keeps the anon secdef list at
  **36/35 with no new name** — `lc_brain_write`-style anon RPCs would have grown it. Ops: `start`, `tool`, `done`, `fail`.
- Postgres builds everything: `brain_system(route, lang)` = frozen `brain_rules()` + `brain_facts_block()` (from
  `brain_facts` + the live contact switch) + `brain_kb_block(lang)` (whole `lc_kb`, ~51 K chars ≈ 13 K tokens) as the
  1-hour-cached block; `brain_user_text()` is the volatile turn. Tools are executed in `brain_tool_exec()` and logged to
  `brain_actions`; §2 ships `kb_search`, `get_facts`, `account_lookup` (job's own user only), `note`, `escalate`,
  `report_finding`. `brain_sink(job)` is the per-source delivery hook (§3 adds `chat`).
- Function: `claude-fable-5-1`, `thinking` omitted, `output_config.effort` per route, structured output
  (`json_schema`, lenient re-parse fallback), `strict` tools, `betas: ["server-side-fallback-2026-07-01"]` +
  `fallbacks: "default"`, refusal → escalate. Replies **202 immediately** and runs the job in `EdgeRuntime.waitUntil`,
  so pg_net's timeout never cuts a tool loop. Usage from every iteration is summed and priced by `brain_usd()` from
  `brain_config.price` (Fable cache-read price taken from the Anthropic skill notes, $0.25/MTok — correct in config if wrong).
- Extra table, owner ask of 27 Sep: `brain_findings` (bug | kb_gap | portal | growth | seo | ads | process) — the
  inbox §15 fills. `cc_brain_status()` / `cc_brain_set()` (settings.manage) are the kill switch and cap from CC/SQL.
- `lc_brain_jobs`, `lc_brain_dispatch`, `lc-brain` are untouched: chat stays on Gemini until §3.
- Staging cleanup found on the way: cron `lb-email-worker` posted to `delivery-worker` every minute with no auth header
  (401 forever; the real job is `delivery-worker-minutely`). Unscheduled on staging; prod has no such job.

Gate status (staging, 27 Sep 2026):

| Gate item | Result |
|---|---|
| secdef names unchanged | ✅ 35, list identical (migration asserts it too) |
| kill switch | ✅ `enabled=false` → job `skipped`, no POST |
| cap trips | ✅ `daily_usd_cap=0` → job `capped`, no POST |
| queue → function → write-back | ✅ job 3: pg_net 202, function wrote back through `brain_rpc` in 0.6 s |
| Claude call, `cache_read_input_tokens > 0`, cost accounting | ⏳ blocked on `ANTHROPIC_API_KEY` in staging Edge Function secrets (job 3 failed with exactly that message) |

To finish the gate once the key is in: `select app_private.brain_test_enqueue(20);` then, a minute later,
`select * from app_private.brain_gate_report();` — expect `done` rows, `cache_read > 0` from the 2nd job on, `usd`
filled, ES answers on the even rows, and the "how many carriers" / "guarantee 3 loads" probes answered without a number
or a promise. Then `select * from app_private.brain_findings;` to see what the brain filed.

---

## §3 Live chat (replaces `lc-brain` Gemini)

- `lc_brain_dispatch` enqueues a `brain_jobs` row (source `chat`) instead of calling Gemini. Fallback chain: Claude → (cap/outage) Gemini `lc-brain` v4 → exact-phrase KB → honest escalate. Never a fuzzy answer.
- Context: last 20 messages, `visitor_role`, `lead_stage`, signed-in account block (compliance rows, trucks, payments), `staff_online`, page the visitor is on, prior conversations by the same `visitor_key`/email (memory).
- The brain may: answer, capture name/email/MC, `create_lead`, send the signup link, `schedule_riley_call`, hand off to a human with a summary. It never promises a person who is not there.
- Spanish: `lc_bot_step_es` routed through the same job (the model is bilingual; `lang` comes back in the output). Closes the ES gap from `NEXT-SESSION-HANDOFF.md`.
- CC Live chat screen: "AI suggested reply" for staff (was backlog item 1), "why the brain said this" (tool calls from `brain_actions`).
- CSAT stays; add "brain vs human" split to the Live chat stats.

Staging gate: 30 scripted conversations (EN 20, ES 10) incl. the known traps: repeat question, "are you a bot", salary question, phone number, "my COI was rejected why" with a seeded account. Zero wrong facts, zero foreign phone numbers, zero promises of a human when none is online.

---

## §4 Mailbox — Amazon-standard, one inbox, AI-first

Plumbing first (nothing else in this section works without it):
1. Route **hello@** and **dispatch@** into `inbound-mail` (Resend inbound on the domain; dispatch@ can keep dmail IMAP in parallel until the cut-over is proven).
2. `cc_mail_ingest`: classify before filing. System mail (postmaster, bounces, receipts, our own notification copies, newsletters) → folder `system`, auto-read, never counted as "needs a reply". Loads@ parser mail stays with `load-mail`.
3. Result: the counters mean something — Unread = humans waiting.

Then the brain on every real inbound (source `email`):
- Haiku gate: spam / vendor / customer / candidate / partner / legal-money. Legal-money and partner go straight to the owner queue with a Fable summary + suggested reply (never auto-sent).
- Fable reply for everything else, through `send_email` → `email_catalog` key `mailbox.reply.auto` (new row: class T, audience per recipient, unsub-allowed false only for account-critical; else true). `cc_email_can_send` is honoured by `sys_email`, so an unsubscribed address never gets a reply that is not essential.
- Threads: the brain keeps the thread (`In-Reply-To`), sets a due time (SLA 1h business, 4h off-hours), and re-nudges once if the customer goes quiet on an open onboarding item.
- Owner queue = "Needs you" folder: partnership, bank/payment, legal/claims, press, refunds, gray applications. Each row: 3-line summary, suggested reply, one-click send/edit/ignore.

Mailbox screen (CC, `openDrawer` for previews, no new side drawer):
- Folders: Needs you · Waiting on customer · Done · System. Assign, snooze, SLA colour, keyboard `j/k/r/e`.
- Every thread shows: category, brain summary, actions taken (from `brain_actions`), and the draft when it is waiting on the owner.
- Signatures from `dispatch/signatures/`, contact line via `{{contact_inline}}` — never a number in the code (CLAUDE.md §7).

Staging gate: 40 seeded inbound emails across the six classes. 100% of legal-money/partner held; 0 replies to a suppressed address (check `email_blocked_log`); all system mail in `system`; every sent reply has a catalog row.

**Build notes — plumbing step 2, `migrations/bl_mail_0471_system_folder.sql` (staging 27 Sep 2026 01:44 UTC; prod 27 Sep 2026, session 3):**

- `mail_messages.folder` (`inbox` | `system`, not null, default `inbox`), `mail_class` (why), `envelope_from` (the raw
  SRS sender when unwrapped). `app_private.mail_unwrap_srs`, `mail_decode_words` (RFC 2047 subjects),
  `mail_classify(from, subject, body)` — all `app_private`, revoked from public/anon/authenticated.
- `cc_mail_ingest` unwraps SRS, classifies, files, auto-reads `system`, and raises the staff in-app notification only
  for `inbox`. Still service_role-only (asserted). `cc_mail_stats` counts the inbox only and adds `system` /
  `system_30d`; `cc_mail_list(..., p_folder default 'inbox')` (`system` | `all` on request; old 4-arg signature
  dropped); new `cc_mail_set_folder(thread, folder)` for staff (comm.manage), audited as `comm.mail_folder_set`.
- Backfill on prod: 93 inbound rows → inbox 3 (1 unread) / system 90 (75 forwarder_rewrite, 10 own_copy, 3 noreply,
  1 bounce, 1 receipt); 7 SRS senders unwrapped. Every row has a folder. Staging: 0 rows, functions + self-tests only.
- anon SECURITY DEFINER surface after: **prod 36, staging 35, names identical to the baseline** (the migration
  refuses to commit otherwise).
- CC Mailbox (`app/command-center/views/mailbox.js`): folder switch Inbox / System / All, a System KPI tile (click =
  open the folder), class pill on system rows, "Move to System" / "Move to Inbox" on a thread (comm.manage).
  `api.mailList` passes `folder`; new `api.mailSetFolder`.
- Known gap, not this migration's: when the Namecheap forwarder rewrites a sender to `postmaster@*.jellyfish.systems`
  the real address is lost before we see it, so such a mail is filed `system` even if a human wrote it. On prod all
  75 were machine mail. The fix is plumbing step 1 (route hello@/dispatch@ to the Cloudflare worker directly, so
  `inbound-mail` sees the original sender) — after it, watch `mail_class = 'forwarder_rewrite'` for a week.

---

## §5 Onboarding A→Z (per role)

Common: a state machine per applicant in `org_onboarding_items` / the role's profile; the brain's nightly sweep + event triggers move it; every message goes through the catalog; reminders capped per the catalog row (no day-one warning ladders — test on a throwaway record first, CLAUDE.md §4).

- **Carrier**: signup → welcome (chat/email/WA, their choice) → doc chase (COI, authority, W-9, agreement) → `lc-doc-check` / `doc-precheck` advisory verdict → Fable reads the verdict + FMCSA snapshot (`fmcsa-verify`) → **clean** (all four valid, authority active, no insurance gaps, VIN on COI) → `approve_application`; **gray** → owner queue with the exact reason. Rejections: drafted, owner sends.
- **Dispatcher hiring**: application → Fable score against the published careers criteria (never an unpublished salary) → screening questions by email/chat → optional Riley screening call (Phase 1 plumbing, §9) → verdict draft → owner approves → trial start, conduct terms, salary ledger untouched by the brain (money).
- **Agent / referral partner**: application → identity + payout method presence check (never reads the values) → approve clean / owner for the rest → welcome + link kit.
- **Broker / shipper**: MC verify → activate posting → first-load nudge; the email-load path (`email_brokers`, `email_loads`) gets the same brain for "missing fields" replies.
- Metric per role: time-to-active. Target: carrier < 24h, dispatcher < 72h.

Staging gate: one throwaway applicant per role driven end-to-end, then purged; every email sent matches a catalog key; no reminder fires on day one.

---

## §6 Dispatcher ops (the load book, rate cons, the carrier bridge, call QA)

- **Load hunt / booking approvals**: a dispatcher's booking or carrier request (`dispatcher_bookings`, `dispatcher_carrier_requests`) is checked by Fable against the carrier's own rules (`min_rpm`, `max_deadhead`, `avoid_states`, `weekend_ok`, `hazmat`, equipment) and LoadBoot policy (no brokering, no margin without authority). Inside rules → approved automatically with the reasoning logged; outside → carrier asked (their approval is the law: no forced dispatch); conflicting → owner.
- **Rate con**: `rc-parse` (keep) → Fable cross-checks parsed fields against the booking (rate, miles, stops, accessorials per the standard: detention $60/h after 2h, TONU $250, layover $250/day) → flags any deviation before the dispatcher confirms. Advisory; the dispatcher confirms.
- **Dispatcher ↔ carrier bridge (CC)**: one thread per booking; the brain summarises, translates EN⇄ES, nudges the silent side, and raises a flag when the carrier's tone turns (cancellation risk).
- **Call monitoring**: every `dialer_calls` / `lc_calls` recording → transcript → Fable QA (script adherence, promises made, rate quoted vs booked, compliance phrases) → score + flags in CC; anything with a money or legal promise → owner.
- **Reports**: weekly per dispatcher (loads, RPM, cancellations, QA) drafted into `dispatcher_reports`.

Staging gate: 10 seeded bookings (5 inside rules, 3 outside, 2 conflicting) route correctly; 5 seeded call transcripts score with the expected flags.

---

## §7 Sales — lead → customer

- **Lead scoring & sequences**: every `crm_leads` row gets a Fable score and a sequence (email + WhatsApp + Riley call), stops the moment they reply, hands hot leads to the owner with a one-line "call them about X".
- **Forms / quotation**: a quote request gets a reply with the lane's number from Market data (`get_public_market_rates`) and the 5% terms; the brain never invents a rate — no data → "we'll confirm" + owner.
- **Email marketing**: campaigns still authored by the owner (or the Tuesday article Routine); the brain only sends through `outreach_prepare` → catalog → unsub law. It never adds an address to a list.
- **CRM outreach**: replies to outreach are triaged like §4; interested → sequence; "stop" → `unsub_apply` (the only route, CLAUDE.md §6.5).

Staging gate: one seeded lead through the full sequence; "stop" reply suppresses within one minute; quote with no market data escalates.

---

## §8 Admin automations

- **Deletion requests**: verified request → `erasure-purge` after the identity check; the brain confirms to the requester and logs. Owner sees a digest line, not a task.
- **Market data**: weekly publish check — if Rates/Diesel/Registry are stale on publish day, the brain nudges (the `bl_mkt_0445` reminder stays) and drafts the weekly words for review.
- **Support tickets** (customer + carrier): every new ticket → Haiku gate → Fable triage (category, severity, owner-or-brain), auto-creates the follow-up task with a due time, resolves what it can (portal how-to, doc status, load status, account questions) and closes with a CSAT ask; money/legal/angry-low-confidence → owner queue. Assignment: brain by default; a human only when `staff_online` and the ticket is flagged for one. Same SLA colours as the Mailbox.
- **Carrier reminders + compliance check**: the reminder ladders stay in the catalog (capped, opt-out-able); the brain adds the **check** — nightly, per active carrier: COI expiry, authority status (`fmcsa-verify` snapshot), W-9/agreement on file, VIN-on-COI for posted trucks, out-of-service flags. Result per carrier: `ok` / `expiring` (reminder with the exact missing item) / `lapsed` (posting paused + reminder + owner digest line). Never a day-one warning; test the ladder on a throwaway carrier first (CLAUDE.md §4).
- **Rate standards**: the accessorial standard (detention $60/h after 2h free, TONU $250, layover $250/day, lumper 100% with receipt, driver assist $75 in writing, FCFS detention from check-in) lives in `brain_facts` as the `rates.*` family, edited only in CC → Market data → Registry. §6 rate-con checks, §7 quotes and §3/§4 answers all read the same rows — one edit, every surface.
- **Coverage principle — every CC screen and every portal screen**: the brain is not a chat feature, it is a worker behind every queue in the product. Each screen below gets the same `brain_jobs` route, the same audit and the same cap. Carrier portal: documents, fleet, payments (presence only, never values), load board questions, load status. Broker/shipper portal: posting help, missing fields, carrier match explanation, tracking questions. CC: Document review, Carrier reminders, Brokers & shippers, Partner intake, Dispatchers & agents, Finance (read + draft only), Live chat, Mailbox, Support tickets, CRM & outreach, Forms, Email marketing, Deletion requests, Market data, Rate standards. Anything not on this list is added by a fact row and a route, not a new AI function.
- **Owner digest** (07:00 owner time, WhatsApp + email): yesterday's counts, what the brain did, the "Needs you" list with suggested replies, cost so far this month.

---

## §9 Voice (Riley)

- **Phase 1 (with §3/§7)**: the brain schedules and triggers calls via `retell_dial()` (only to people who asked — TCPA), reads the transcript + post-call analysis back, and continues the thread. Fix first: number wiring and prompt publish per `docs/voice-agent/RILEY-0458.md`.
- **Phase 2 (after §3–§7 are stable)**: Claude as Riley's LLM through Retell's custom-LLM socket, so chat/email/call share one memory. Confirm the Retell feature and pricing at build time; keep the Retell-hosted prompt as fallback.
- Cost: Retell ≈ $0.13/min + brain ≈ $0.05/call.
- **Owner decision 27 Sep 2026:** Riley keeps running on Retell's hosted LLM while the current **$30 Retell balance** lasts (Phase 1 only touches scheduling and transcripts). When the balance is spent, cut over to Phase 2 (Claude behind Riley). Add a CC → Riley → Settings line showing the Retell balance so the cut-over date is visible, not guessed.

---

## §10 Self-updating facts & regulations

- **Product/code (automatic)**: `brain_facts` is the single source. Seed from `site_facts` + `FACTS`. Every migration that changes a customer-facing fact adds a row (`fact_key, text, audience, effective_from, source_ref`). Nightly sweep reads new commits + migration headers + `docs/SESSION-CHANGELOG.md` and drafts fact rows for anything customer-visible; they go live on the next call. The `FACTS` block in `lc-brain` is deleted once §3 lands.
- **Regulations (owner-approved)**: weekly scheduled agent fetches FMCSA news, Federal Register and the relevant 49 CFR parts (371, 387, 390–396), diffs against `regulation_facts`, and files a proposal with the source link. Owner approves in CC → row goes live. The brain never states a regulation that has no approved row. Compliance is the owner's decision (CLAUDE.md §1).

---

## §11 Guardrails (non-negotiable)

- Money, bank, payouts, legal, partnership, press: prepare only, never send, never decide.
- Anon-executable secdef surface: names unchanged (36/35). Every new `public` function revokes `public, anon`.
- Unsubscribes are law: every send through `sys_email` / `outreach_prepare`; every stop through `unsub_apply`.
- Contact line: tokens only; grep every new email for `253-7575` / `2537575`.
- Demo accounts (`is_demo`, `play.*@loadboot.com`) invisible to the brain's customer-facing paths.
- No diagnostics on real customer accounts; throwaway records, then purge.
- Spot-check window: 4 weeks after each section goes to prod, every brain-sent message is copied to the owner digest.
- Audit: no brain action without a `brain_actions` row.

---

## §12 Build order & gates

Each step: staging → gate above → owner reads the staging evidence → prod → 4-week spot-check.

1. §1 re-verify (both DBs) — 1 session
2. §2 core (migration + `brain` function + cap + kill switch) — 1–2 sessions
3. §4 plumbing only (hello@/dispatch@ routing, system-mail filter) — this alone fixes the Mailbox counters — 1 session
   — system-mail filter **done on prod 27 Sep 2026** (`bl_mail_0471`); hello@/dispatch@ routing is the owner's
   dashboard step (Namecheap forward → `*@in.loadboot.com`, Cloudflare Email Routing → the `inbound-mail` worker).
4. §3 live chat on Claude — 1–2 sessions
5. §4 brain on email + Mailbox screen — 2 sessions
6. §5 carrier onboarding, then dispatcher hiring, then agent, then broker/shipper — 3–4 sessions
7. §7 sales + §8 admin + digest — 2 sessions
   7b. §15 growth brain: findings digest, KB training loop, SEO monitor + keyword plan, ads plan (PREP) — 2 sessions
8. §6 dispatcher ops — 2–3 sessions
9. §10 facts sweep + regulation agent — 1–2 sessions
10. §9 voice phase 1, then phase 2 — 1 + 2 sessions

Session hygiene applies (CLAUDE.md §2): one section per session, handoff note at the end of each.

---

## §13 Cost (at Sep 2026 traffic; scales linearly with volume)

| Workload | AI turns / mo | Fable 5.1 |
|---|---|---|
| Live chat | ~145 | ~$50 |
| Onboarding (all roles) | ~660 | ~$130 |
| Email (200 in, ~80 replies) + Haiku gate | ~280 | ~$12 |
| Sales sequences + call summaries | ~160 | ~$22 |
| Dispatcher + carrier support | ~200 | ~$30 |
| Dispatcher ops + call QA | ~150 | ~$35 |
| Sweeps + digest | ~90 | ~$40 |
| Subtotal (uncached) | | ~$320 |
| + agentic overhead 30% | | ~$415 |
| **With caching (system block at cache-read price)** | | **~$250–$300 / month** |

Cap default $25/day (≈ $750/mo ceiling). Riley separate (§9). Model prices used: Fable 5.1 $10/$50 per MTok, Haiku 4.5 $1/$5.

**Scale.** The brain has no headcount. It handles whatever volume arrives, in parallel, 24/7; the only limits are the API rate limit and the daily cap, both of which are numbers the owner raises. "The work of 100,000 employees" is not a figure that can be verified; what can be: at 10× today's traffic the bill is ≈ 10× (~$2.5–3K/mo) and the staff count is still zero. The owner's own time stays at the §0 list, roughly 15–20 min/day, whatever the volume.

---

## §14 Control map — every surface, what the brain owns (added 27 Sep 2026, owner: "see yourself what the max should be")

Legend: **AUTO** = brain acts, logs, no human · **AUTO+OK** = brain does everything, owner taps approve · **PREP** = brain summarises/drafts, owner acts · **NEVER** = brain does not touch (money, legal, identity values, code).

### 14.1 COI vehicle schedule → VINs (owner: "especially this — auto")
Today: `lc-doc-check` already extracts the vehicles/VINs and says ANY AUTO vs SCHEDULED in its verdict, but `coiCoverage.js` still asks a reviewer to paste the schedule. The gap is wiring, not the model. Build (in §5, first item):
1. On every COI verdict (upload via portal `doc-precheck`, chat `lc-doc-check`, or CC review): brain reads the verdict + the document (vision), returns `{mode: any_auto|scheduled|unclear, vins[], exp_date, confidence}`.
2. Deterministic checks before anything is saved: VIN check-digit (ISO 3779), 17 chars, no I/O/Q; each VIN matched against Fleet (`fleet` trucks) — exact, then transposition-tolerant.
3. `confidence ≥ 0.85` and every VIN valid → **AUTO**: save coverage mode + VINs + expiry through the same RPC the screen uses, `set by: brain`, and unblock posting for the matched trucks (LB001 resolved). Fleet truck with no VIN on the COI → carrier gets the exact "have your agent add VIN X" message (catalog `document.coi.vin_missing`).
4. Anything else → **AUTO+OK**: the Document review drawer opens pre-filled (mode, chips, expiry, the schedule text), reviewer taps confirm. Never a blank textarea again.
5. Metric: % of COIs saved with zero human touch. Target 80% by week 4.

### 14.2 Riley daily follow-up plan (owner decision 27 Sep 2026)
Calls cost money; use them only where a customer is worth it. Daily 10:00–18:00 recipient local time, only to people who gave a number at signup (TCPA consent recorded), max one call attempt/day, 3 attempts total, WhatsApp/email between attempts.
- **New carriers, day 1**: welcome + "what is missing to get dispatched" (from the compliance check) — **AUTO**.
- **Signed up then vanished (no activity 48h)**: carrier, broker, shipper, agent — one call, then WhatsApp/email sequence — **AUTO**.
- **Dispatchers: NO calls** (owner rule — they will pester; not worth the minutes). Daily WhatsApp reply/nudge instead — **AUTO**.
- **Hot leads from chat/forms**: Riley call within 10 minutes of the request — **AUTO**.
- After every call: transcript + post-call analysis → brain continues the thread, updates `lead_stage`, `crm_leads`, onboarding state — **AUTO**. Money/legal promise heard on a call → owner.
- Riley stays on Retell's hosted LLM until the $30 balance is spent (§9), then Phase 2.

### 14.3 Dispatcher management (daily, all brain)
- **Hiring daily** (§5): score, screen by email/chat, verdict draft — **AUTO+OK** for the verdict; trial start, conduct terms — **AUTO** once approved.
- **Assignment**: match a new/idle dispatcher to carriers needing one (`dispatcher_assignments`, `carrier_requests`) by equipment, lanes, time zone, load — **AUTO**, with the WA assignment notice that already exists (`wa-auto-worker`).
- **Stage moves**: trial → active → senior, or trial → out, on published criteria (loads booked, RPM vs market, cancellations, QA score, response time) — **AUTO+OK** (owner taps). Salary/commission numbers — **NEVER**.
- **Performance check**: daily per dispatcher: bookings, RPM vs `get_public_market_rates`, cancellations, carrier complaints, call QA (§6), WA response time. Drift → coaching message to the dispatcher (**AUTO**), repeated drift → owner line.
- **Eyes on everything**: the owner digest (§8) carries one line per dispatcher, one per stalled carrier, one per stuck lead.

### 14.4 Carrier portal (app/carrier)
| Screen | Brain |
|---|---|
| Dashboard, Ratings, Alerts | AUTO — explains the score, what to fix next, answers "why" in chat |
| Load Board, My Loads | AUTO — load questions, status, ETA, detention clock reminders; **booking itself stays the carrier's approval (no forced dispatch)** |
| Dispatcher (relationship) | AUTO — bridge (§6): summaries, nudges, EN⇄ES |
| Profile, Fleet | AUTO — completeness nudges, VIN/COI mismatch (14.1); never edits identity values |
| Finance | PREP — explains an invoice/settlement, drafts a dispute summary; **never changes money** |
| Documents | AUTO — chase, check, verdict (§5, 14.1); gray → owner |
| Market Rates | AUTO — answers from the registry only |
| Support, Safety | AUTO triage/resolve (§8); safety incident → immediate owner alert + human line, never brain-only |
| Account (deletion, security) | AUTO for deletion flow (§8); security/password/bank — NEVER |
| Onboarding, Reinstate | AUTO state machine (§5) |
| Driver mode | AUTO — same support brain, driver audience |

### 14.5 Broker / shipper portal (app/partner)
| Screen | Brain |
|---|---|
| Dashboard, My Loads, Requests | AUTO — posting help, missing fields, "why no carrier yet", match explanation |
| Claims | PREP — collects facts, drafts the claim packet, owner decides (money/legal) |
| Carriers, Network, Market Rates | AUTO — answers, verified-carrier explanations, rate from registry |
| Agents & team | AUTO — invites, role questions |
| Documents (onboarding) | AUTO — MC verify, activation (§5) |
| Invoices | PREP — explain only |
| API & Keys | AUTO — how-to answers only; never issues or reads keys |
| Account | as carrier |
| Trust scores (broker/shipper) | AUTO — explains; the score logic stays code |

### 14.6 Dispatcher / referral-partner portal (app/agent)
| Screen | Brain |
|---|---|
| Referral Home | AUTO — link kit, "how earnings work", pipeline nudges |
| Dispatcher Workspace (Today/Board/Trucks/Bookings/Brokers/Money/Messages/Email/Packet/KPIs) | AUTO — §6 in full: booking checks, RC cross-check, bridge, email/WA triage, packet completeness, KPI explanation. **Money tab: PREP only** |
| Choose Carrier, Carrier Fill | AUTO — assignment (14.3), fill prompts |
| Skills test, Re-application gate | AUTO — grading stays code; brain explains the gap list and the reapply path |

### 14.7 Investor & developer portals
- Investor: **NEVER** for ledger, payments, statements, agreement (money + legal). Brain answers only "how does this screen work" through support.
- Developer: AUTO for docs/how-to answers and webhook debugging explanations; **NEVER** creates/reads keys.

### 14.8 Command Center (staff side) — where the brain is the worker
| Group | AUTO | AUTO+OK | PREP | NEVER |
|---|---|---|---|---|
| Home: Today, Task queue, Deletion requests | Task queue drained by brain routes; deletion verify+purge | — | Today = the digest | — |
| Loads: Load board, Dispatch, Trip, Control tower, Intake, Email loads, Smart matching, Market rates, Rate standards | intake parsing, email loads, matching explanations, trip comm, exception notes, weekly words draft | rate-standard edits | control-tower escalations | rate numbers themselves (owner edits registry) |
| Carriers: Directory, Fleet, Scorecards, Contacts, Compliance/Onboarding, Document review, Carrier reminders | onboarding, doc verdicts (14.1), reminders, compliance check, scorecard explanations | gray docs, rejections | — | — |
| Partners & People: Brokers & shippers, Partner intake, Broker trust/SLA, Dispatchers & agents, Phones, Riley, WhatsApp, Dispatcher email, Carrier requests, Referral partners & payouts, Referral program | intake, screening follow-ups, WA replies, dispatcher email triage, carrier requests routing, Riley scheduling (14.2), dispatcher mgmt (14.3) | dispatcher verdicts/stage moves, partnership replies | broker SLA breach summaries | **payouts** |
| Money & Customers: Finance, Fee approvals, Finance analytics, Investors, Live chat, Mailbox, Support, CRM, Forms, Form builder | chat (§3), mailbox (§4), support (§8), CRM sequences + quotes (§7), form replies | — | finance explanations, fee-approval summaries, dispute drafts | **fee approvals, settlements, investors** |
| Insights & Admin: BI, Analytics, Reports, Web analytics, Marketing intel, SEO, Content, Email catalog, Deliverability, Unsubscribes, Newsletter, Templates, Email builder, Campaigns, Audiences, Announcements, Automation rules, Workflows, Integrations, Settings, Staff, Brand kit, Flags, Audit, Health, Plugins | weekly report narratives, SEO/content drafts (Tuesday Routine stays), deliverability + signup-health alerts explained, unsub handling via `unsub_apply` | campaign sends, announcements, new automation rules | audit anomalies, health incidents | **staff & roles, flags, integrations/secrets, settings** |
| Ungrouped: Radar, Booking requests, Safety desk, Account health, 360 pages, Verification, POD review, Exceptions, Notifications, Ops map, Comms, Outreach | booking-request checks (§6), account-health nudges, POD completeness check, exception triage, outreach replies | POD disputes | safety desk (human line always) | — |

### 14.9 Public website (loadboot.com, `build_site.py`)
- Chat widget on every page: §3.
- Weekly numbers/words: brain drafts from Market data (§8), owner publishes — **AUTO+OK**. The build itself stays code.
- Content: articles via the Tuesday Routine (sonnet) — unchanged; brain answers "is this fact still true" against `brain_facts` before publish — **AUTO**.
- Forms (contact, quote, careers, partner): §7 — **AUTO** reply within minutes; careers → dispatcher hiring pipeline; partner → owner queue.
- Never: pricing/terms/privacy text changes without the owner (legal).

### 14.10 Scheduled jobs and channels
- Existing pg_cron jobs stay as they are. The brain adds routes on top of their outputs (expiry reminders → compliance check; signup-health → vanished-user calls; lc-sla-alert → brain takes the chat if no human; outreach-daily → replies triaged). Enable the four commented-out jobs (`lb-lc-unanswered`, `lb-notif-gap-sweep`, `lb-carrier-reminders`, `lb_autopay_due`) only after their owner-side review — `lb_autopay_due` is money, owner decides.
- Channels: WhatsApp (Telnyx WABA) — AUTO replies + templates through the catalog; SMS — transactional only, START/STOP untouched; push — brain may send through the outbox, never bypass it; Riley — 14.2; Telnyx softphone — recordings → call QA (§6).

### 14.11 Messaging rules and marketing (owner decisions 27 Sep 2026)
- **WhatsApp: utility templates only. Never a MARKETING-category template.** Every template the brain uses is Meta category `UTILITY` (transactional: assignment, doc missing, load status, appointment, reply-to-your-question). No promotions, no upsell, no "special offer" on WhatsApp. Guard in code: `send_whatsapp` refuses a template whose stored category is not `UTILITY`.
- **Templates on demand**: when a route needs a message shape that has no approved template, the brain drafts one (variables, sample values, category `UTILITY`), files it in the catalog, and submits it through `telnyx-wa-templates` — **AUTO+OK** (owner taps submit the first month, then AUTO). Rejected by Meta → brain rewrites once, then owner.
- **Riley prompts**: the brain maintains `app_private.riley_prompts` (inbound/outbound) from `brain_facts` + the same rules as chat, so a fact changes in one place and Riley says it on the next publish. Publish via `retell-admin` — **AUTO+OK** (owner reads the diff, taps publish). The canonical files in `docs/voice-agent/prompts/` are written back on every publish.
- **In-app notification marketing** (carrier, broker/shipper, dispatcher portals + push): plan and run per-audience nudges from product events — first load booked, doc verified, weekly market move on their lanes, idle 7 days, new feature that applies to them. Rules: max 2/week per user, quiet hours, one per event, each with a stop switch in the user's preferences, every one a catalog row (`notify.*` family), measured by open → action. Brain drafts the calendar monthly (**AUTO+OK**), sends daily (**AUTO**).
- **Email marketing, end to end**: audience build (from `audiences`, never from scraped lists), calendar, copy (brain drafts; premium articles stay with the Tuesday Routine), A/B subject lines, send through `campaign-manager` → `outreach_prepare` → catalog → unsub law, deliverability watch (`lb-email-health`), attribution (`lb-outreach-attrib`), monthly report in the digest. **AUTO+OK** on each campaign send for the first two months, then AUTO for sends under 500 recipients. Suppression, bounces and complaints handled only through `unsub_apply`.

---

## §15 Growth brain — bugs → fixes, KB training, portal ideas, growth / SEO / ads (owner asks, 27 Sep 2026)

Owner, mid-session: *"saath saath live — jahan bug pakre, fix mujhe de, main Claude se karwaoon; live chat ko train
karta rahe; portals mein improvement ki suggestions de; growth ki strategy de … SEO monitoring, keyword search plan,
ad-run plan, advertisement strategy … SEO planning, ranking planning. LoadBoot successful karne ke liye jo jo help
kar sakta hai kare."* Everything here is **PREP / AUTO+OK** — the brain observes, files, drafts and measures; the owner
decides and spends. Nothing in this section moves money or ships code.

The plumbing is already in §2: every finding is a `brain_findings` row (`kind`, `surface`, `title`, `detail`,
`evidence`, `suggested_fix`, `status open→accepted→done|dismissed`) filed through the `report_finding` tool, so every
section's brain (chat, mail, onboarding, dispatch) feeds the same inbox from day one.

### 15.1 Bugs → a fix the owner can paste into Claude Code (AUTO file, owner applies)
- Triggers: a tool error inside a job, a customer describing a broken path ("the upload button does nothing"), a
  portal RPC the brain saw fail in `account_lookup`, an email that bounced from our side, a repeated escalation with the
  same root cause.
- The finding carries: surface + exact page/RPC, the customer's words, counts (how many people hit it, first/last
  seen), and a **suggested fix written as a Claude Code prompt** (file path if known, expected behaviour, how to verify).
  The owner copies that prompt into a session — no reconstruction.
- Daily digest (with §8's owner digest): new bugs first, then everything else. CC → Brain → Findings screen lists
  them with one-tap accept / done / dismiss (§8 builds the screen; the RPCs are cheap once the table exists).

### 15.2 Live chat keeps training itself (AUTO propose, owner approves)
- Every escalate, `confidence < 0.6`, repeat question, CSAT ≤ 3 → `kb_gap` finding **with a drafted `lc_kb` row**
  (patterns[], answer, lang, priority) written in the KB's own style.
- Nightly sweep clusters the day's misses (same question asked different ways → one row, all the phrasings as patterns).
- Owner approves in CC → row inserted into `lc_kb` (extends `bl_lc_0399` teach-every-miss); the next job's cached system
  block picks it up within the hour. Metrics on the Live chat stats card: escalation rate, repeat-question rate, "answered
  from KB" share, ES coverage. Target: escalation rate halves in 4 weeks.

### 15.3 Portal improvement suggestions (weekly, PREP)
- Sources: chat and mail transcripts, support tickets, onboarding funnel drop-offs (profiles → orgs → packets → verified
  → first load), `track_web_event` paths, dispatcher-test outcomes, Riley call summaries.
- Output: `portal` findings ranked by *people affected × effort*, each with evidence counts and a concrete change
  ("Fleet: show 'VIN missing on COI' inline on the truck row, not only at posting — 14 carriers hit LB001 this week").
- Never a redesign essay: one screen, one change, one reason, one number.

### 15.4 Growth strategy (monthly memo, PREP)
- Data the brain reads: signups by role and source, activation (verified carriers, first posted load, first booked
  load), leads by stage, Riley/WhatsApp/email outcomes, revenue (read-only), churn signals (no login 30 d, documents
  expiring, no loads 14 d).
- Output: a one-page memo — what moved, why (with evidence), three bets for next month with a success number each,
  and what to stop. Owner picks; the picked bets become `growth` findings the sweeps track.

### 15.5 SEO monitoring + ranking plan (weekly, AUTO measure · PREP fix)
- Already wired: `gsc-insights` and `ga4-insights` edge functions, `docs/seo-audit-2026-10/` (audit + the Tuesday
  premium-article Routine), `site_facts` registry, `build_site.py`.
- Weekly sweep: Search Console queries/pages — rank movements, lost top-10 positions, "striking distance" queries
  (position 8–20 with impressions), CTR outliers, indexation/coverage errors, Core Web Vitals from GA4; each issue → `seo`
  finding with the page and the fix (title/meta rewrite drafted, internal links to add, thin page to merge, schema to add).
- Ranking plan per target cluster: current position → target → the pages that must exist or change → the articles the
  Tuesday Routine should write next (the Routine takes its topic queue from here instead of guessing). Reviewed monthly.

### 15.6 Keyword research plan (monthly, PREP)
- Seed clusters: truck dispatch service / dispatcher for owner-operators, free load board for carriers, broker & shipper
  load posting, per-state and per-equipment carrier pages, dispatcher jobs / how to become a dispatcher, factoring & NOA,
  FMCSA authority questions, accessorial standards (detention, TONU, layover), Spanish equivalents.
- The brain expands each cluster from our own GSC queries (real demand we already touch) and the questions people ask in
  chat/mail (demand we answer but do not rank for), maps keyword → existing page or new page, and prioritises by
  impressions × intent × how close we already are. Output: a keyword→page map with owners' yes/no per row; the yes rows
  feed 15.5's ranking plan and the article queue.
- No third-party volume numbers are invented: where we have no GSC data the row says "no data — test with an article".

### 15.7 Ads run plan + advertising strategy (PREP only — the brain never spends)
- Strategy draft: who to pay for (carriers with authority + trucks, brokers/shippers posting, dispatcher applicants only
  if hiring), where they are (Google Search intent terms from 15.6, YouTube/Meta retargeting of site visitors, Spanish
  campaigns), and what we can afford per verified carrier given the 5% model (target CAC set by the owner).
- Run plan: campaign structure (search campaigns per cluster, ad groups per intent, negatives — "free dispatch course",
  "dispatcher salary" …), ad copy variants written from the KB facts (no invented numbers, one contact sign), landing
  pages per campaign (existing pages first), conversion spec (`track_web_event` → GA4 events: signup, verified, first
  load), budget tiers ($10/$30/$100 a day) with the expected signal at each, a 2-week kill/scale rule.
- Owner creates the accounts and enters payment details himself (CLAUDE.md §4); the brain then reads spend + results
  weekly and files `ads` findings (pause X, move budget to Y, new negative Z). Every recommendation carries our numbers.

### 15.8 Guardrails for this section
- Every finding cites evidence from our own data; a suggestion with no number behind it is filed as an idea, not a finding.
- Money is NEVER touched (ads spend, tools purchases); identity/payment values are typed by the owner only.
- No customer is contacted by anything in §15 — it writes to the owner, never outward.
- Cost: ~40 extra sweep jobs a month ≈ $20–30 at Fable prices, inside the §13 envelope.
