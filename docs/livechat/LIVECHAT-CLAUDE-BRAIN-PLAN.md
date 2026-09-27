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
- **Support tickets**: same brain as §4; a ticket is an email with a status.
- **Owner digest** (07:00 owner time, WhatsApp + email): yesterday's counts, what the brain did, the "Needs you" list with suggested replies, cost so far this month.

---

## §9 Voice (Riley)

- **Phase 1 (with §3/§7)**: the brain schedules and triggers calls via `retell_dial()` (only to people who asked — TCPA), reads the transcript + post-call analysis back, and continues the thread. Fix first: number wiring and prompt publish per `docs/voice-agent/RILEY-0458.md`.
- **Phase 2 (after §3–§7 are stable)**: Claude as Riley's LLM through Retell's custom-LLM socket, so chat/email/call share one memory. Confirm the Retell feature and pricing at build time; keep the Retell-hosted prompt as fallback.
- Cost: Retell ≈ $0.13/min + brain ≈ $0.05/call.

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
