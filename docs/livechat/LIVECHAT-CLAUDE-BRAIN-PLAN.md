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
4. §3 live chat on Claude — 1–2 sessions
5. §4 brain on email + Mailbox screen — 2 sessions
6. §5 carrier onboarding, then dispatcher hiring, then agent, then broker/shipper — 3–4 sessions
7. §7 sales + §8 admin + digest — 2 sessions
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
