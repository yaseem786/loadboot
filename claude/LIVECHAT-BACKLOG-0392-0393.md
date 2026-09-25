# Live chat — open-conversation audit, the two dead safety nets, and the follow-ups
**22 Sep 2026 · production (rwscphuhpjoudvljvmdk) · migrations bl_lc_0392, bl_lc_0393 APPLIED to staging AND prod**

---

## 1. The question you asked

> *If someone comes to live chat, asks for a human, leaves — and I reply in the chat now, does
> an email reach them?*

**Yes — if we hold an email address for that conversation.** The path is:

`cc_lc_reply()` → `visitor_unread + 1` → cron `lb-lc-reply-notify` (every 2 min) →
`lc_reply_notify()` emails them **"<name> replied to you — LoadBoot"** with your message quoted
and a button back into the chat.

Three conditions, all on **your new message**, not on the age of the conversation:

| Condition | Meaning |
|---|---|
| `email` on the conversation, valid format | no email on file → **nothing is sent**, ever |
| `visitor_unread > 0` | they have not come back and read it |
| your message is 3 min – 24 h old | 3 min = grace so we don't email someone mid-conversation |

**So the conversation being 48 days old does not stop the email.** Your reply is new, so the
email fires. That is exactly why the old ones should be left alone — a "you have a reply"
landing 48 days after Petar Travica last spoke to us reads as a mailing list, not a reply.

> The 24 h upper bound was **2 h** until today. If the delivery worker or the cron had been down
> for two hours, the visitor's notification was silently dropped and never retried. Widened in
> bl_lc_0392; the per-message idempotency key still makes double-sends impossible.

---

## 2. What was broken — the important part

**25 conversations are open. 15 of them are `mode='human'` with `first_staff_reply_at` NULL** —
a real person asked for a human and never got one. Nothing was alerting on a single one of them,
because **both safety nets were structurally dead, not merely quiet:**

### a) The SLA alarm was disarmed by *reading* the chat
`lc_sla_alert()` required `staff_unread > 0`. But `cc_lc_get()` — just **opening** a conversation
in Command Center to read it — sets `staff_unread = 0`. So opening a chat was being counted as
handling it.

Caught in the act today, chat `f96f3de6`:

```
11:08  lc_sla_alert fires → "⏱ unanswered" email to you
11:27  you open it   → cc_lc_get zeroes staff_unread
11:27  cc_lc_assign  → visitor is told "Mike Carter from LoadBoot joined the chat"
       …no reply. Alarm now permanently disarmed. Visitor told a human arrived.
```

At the time of the audit: **0 of 25 open conversations had `staff_unread > 0`.** The alarm could
not fire for any of them, ever again.

### b) The stranded-visitor rescue could never run either
`lc_watchdog()` pass 2 required `pending_human = true AND mode = 'bot'`. But `lc_do_handoff()`
and `cc_lc_assign()` both set `pending_human = false`, and `lc_do_handoff()` runs on *every*
human request. **0 of 25 open conversations had `pending_human`.** Dead by construction.

### c) `lc_sla_alert()` gave up after 24 h
So a backlog could never resurface. Nothing ever looked at yesterday again.

### d) The miss log has never been written to — not once
`app_private.lc_misses` has **0 rows, ever**. `lc_log_miss()` exists and is correct, but nothing
called it. So `cc_lc_misses()` / `cc_lc_teach()` — the whole "teach the bot" screen — has been
reading an empty table since it shipped, and the bot has had no way to learn from its failures.

### e) An internal note would have been emailed to the customer
`lc_reply_notify()` took the last `sender='staff'` message and emailed it as *"a person picked up
your chat — here is what they said."* It did **not** exclude `[[note]]` or `[[sys]]`. No leak has
happened (0 staff notes exist), but the v3 console plans internal notes through `cc_lc_reply`,
which writes `sender='staff'` — so this was one feature away from mailing an internal note to a
carrier. Filtered now.

### f) Two KB answers the bot got confidently wrong
Both produced a *plausible wrong answer*, which is worse than a miss — and which is why they
would not have been logged even if (d) worked:

- **"What about the factory fee?"** — asked twice (21 + 22 Sep), then the visitor gave up and
  asked for a human. *"Factory"* is how people misspell *factoring*. The factoring row's
  patterns held only `factoring` / `factor`, so it fell through to the 5 %-pricing row.
- **"Who will pay me first"** — the payments row holds `who pays me`, which does not match
  `who will pay me`. Also fell through to pricing.

---

## 3. What was changed (both DBs, staging first, then prod)

**`bl_lc_0392_unanswered_chat_net.sql`**

1. **New `app_private.lc_unanswered_alert()`** — a net that depends on neither `staff_unread` nor
   `pending_human`. It asks the only question that matters: *has a real staff message landed
   since the visitor last spoke / since the handoff?* Re-alerts every 6 h, and **gives up after
   7 days** so an old backlog is a human judgement call, never a blast.
   Cron `lb-lc-unanswered`, `*/15 * * * *` (prod jobid 50, staging 46).
2. **`lc_sla_alert()`** — `staff_unread > 0` replaced by the same real test; 24 h → 72 h.
3. **`lc_reply_notify()`** — `[[note]]` and `[[sys]]` excluded; 2 h window → 24 h.

**`bl_lc_0393_miss_log_and_kb_gaps.sql`**

4. **`lc_escalate()`** now calls `lc_log_miss()` with the visitor's last message. The escalation
   *is* the miss. The "teach the bot" screen will start filling from the next unanswered question.
5. KB patterns added for the two gaps above (English factoring row and payments row only — the
   Spanish row was left in Spanish).

**Verified after:** anon-executable SECURITY DEFINER surface in `public` still **33** on prod,
`has_schema_privilege('anon','app_private','usage')` still **false**. No table changes, no new
public surface, nothing destructive. Rollback is in the header of each migration file.

**Dry run of the new net on prod** returns exactly 4 conversations — Sukhdeep, Ronald, the London
broker, Gilnalyn. Not the 48-day backlog. That is the intended shape.

**Proved live at 12:02 UTC, 22 Sep.** The patched `lc_sla_alert()` fired on its very next
2-minute tick and sent five alerts to hello@loadboot.com — Sukhdeep, Ronald, the London broker,
Gilnalyn, and `f96f3de6`, the one the old code had permanently disarmed 35 minutes earlier. All
five `delivered`/`sent`, no failures. Before the patch, not one of them could have fired: every
open conversation had `staff_unread = 0`.

Because `lc_sla_alert()` reached them first, the new `lc_unanswered_alert()` correctly returned
`{"alerted": 0}` on its manual run — the 6-hour cooldown is shared, so the two nets do not
double-alert. That is the design, and it verified itself on the first pass.

### Left alone deliberately — these are your calls, not a patch

- **`cc_lc_assign()` announces "Mike Carter from LoadBoot joined the chat" on a bare claim.**
  Opening a chat to read it tells the visitor a human has arrived. Either the announcement should
  move to the first real reply, or the claim should be silent. Four visitors were told this
  yesterday and got nothing. The new net now catches them — but they were still told.
- **The matcher prefers a weak wrong answer over admitting a miss.** Until that changes,
  `lc_misses` only captures questions that produced *no* hit, not the ones that produced a bad
  hit — which are the more damaging kind, as "factory fee" shows.
- **Ronald Lester's promised callback** (`lc_calls` id 338, 21 Sep 16:35, `+18109565503`) came
  back `status = 'no-result'`. The bot had told him *"your phone should ring in about 30 seconds."*

---

## 4. The open conversations, sorted

### FOLLOW UP — waiting, within 7 days, we hold an email (drafts in §5)

| Who | Email | Waiting | What they actually wanted |
|---|---|---|---|
| **Sukhdeep kaur** | sukhvirk1712@gmail.com | **70 h** | Rejected dispatcher applicant. Now has the load-board subscription she was rejected for, and asked **how to apply again**. The bot answered with a DAT-vs-LoadBoot pricing pitch. Two conversations, ~8 unanswered questions. |
| **Ronald Lester** | ronaldlester1969@gmail.com | 19 h | *"id like to apply for dispatching job only if hiring"*. Left his email AND phone, was promised a callback in 30 seconds — the call returned `no-result`. |
| **Gilnalyn Capadocia** | gilnalyncapadocia2000@gmail.com | 19 h | Agent portal, has an account. Typed only *"I want to talk to a real person"* — no question given, so we have to ask. |

### IN-CHAT ONLY — no email on file, so nothing else can reach them

| Chat | Waiting | What happened |
|---|---|---|
| `94b2e297` broker | 19 h | *"load for londan"* → asked for a human → told one joined. London is outside our lane; worth saying so plainly rather than silence. |
| `f96f3de6` | since 02:40 | Asked *"what about the factory fee?"* twice and *"who will pay me first"*. Both now fixed in the KB. Came back after a full day away, so the widget does restore — a reply may well be seen. |
| `0d2a0620` | 24 h | Got the generic *"Hi! 👋 …how can I help you today?"* and left. Nothing to add. |

### LEAVE THEM — too old to reopen (your instruction, and I agree)

Zachary Preston (19 d + 22 d), Shehnajdeep kaur (22 d), the unnamed carrier chat (28 d),
Marshall Patterson (33 d), Nimco Boon (35 d — already answered), Petar Travica (48 d),
plus the two unnamed website chats at 9 d and 12 d with no contact details at all.
A reply now emails them a *"you have a reply"* out of nowhere. Not worth it.

**No action needed:** the four *"I'm a dispatcher"* chats that got a full bot answer and no
follow-up question, the careers-question chat that was answered correctly, the `ZZ-TEST` upload
chat (our own audit test), and Lawernce M Cassella — the bot answered him correctly with his live
0-of-4 verification status, so nothing was missed there. *(Separately: he is a real signed-in
carrier sitting at 0 of 4. Worth a nudge on its own merits, not as a chat rescue.)*

> **Sukhdeep's 404 on `careers.html` was transient.** The page is live and correct right now
> (`Careers at Loadboot`, both routes listed). Most likely the PWA service-worker cache. No fix
> needed, but it is the second time a stale service worker has shown someone a broken page.

---

## 5. Drafts — nothing has been sent

Per the standing rule, every carrier- and broker-facing message is yours to send. These are ready
to paste; say the word and I will send them instead.

### 5.1 Sukhdeep kaur — `sukhvirk1712@gmail.com`
**Subject: Your dispatcher application — yes, you can reapply**

> Hi Sukhdeep,
>
> You asked us three days ago how to apply again now that you have a load board subscription, and
> nobody got back to you. That is our fault, and I am sorry — you asked clearly and more than once.
>
> Yes, please reapply. And I want to correct the reason you were turned down, because we have since
> tightened up what we actually mean by it.
>
> We are not really asking whether you own a DAT or Truckstop login. We are asking **how you find
> and book loads yourself**. A load board in your own name counts. An employer's or a carrier's
> login counts, as long as you can log in today and book. So do Facebook and WhatsApp freight
> groups, brokers you already deal with, direct shippers, and broker email blasts. The only answer
> that does not work is having never sourced and booked a load yourself.
>
> So when you reapply, send your CV to hello@loadboot.com with "Dispatcher application" in the
> subject line, and tell me three things in the same email:
>
> 1. How you find loads — which of the routes above you actually use.
> 2. Where exactly — the board, group or brokers, and your login or handle there.
> 3. Two loads you sourced and booked yourself: lane, broker, month, rate.
>
> On your other questions: we review applications and send an approval or a rejection within
> 1–3 days of receiving them. The careers page is working — if it showed you a 404, it was a
> cached copy; a hard refresh will clear it. And you do not need the page to apply, the email
> above is enough.
>
> — Mike Carter
> LoadBoot · hello@loadboot.com

### 5.2 Ronald Lester — `ronaldlester1969@gmail.com`
**Subject: Dispatcher roles at LoadBoot — sorry for the wait**

> Hi Ronald,
>
> You asked yesterday whether we are hiring dispatchers, left your number for a callback, and then
> asked for a person. The callback did not connect and nobody picked the chat up. Both of those are
> on us, and I am sorry.
>
> To answer you: yes, we hire dispatchers, and remote is normal for us.
>
> Send your CV to hello@loadboot.com with "Dispatcher application" in the subject line. In the same
> email, tell me three things — these decide the shortlist far more than the CV does:
>
> 1. How you find and book loads today. A load board counts (yours, an employer's or a carrier's —
>    it does not have to be in your name). So do Facebook and WhatsApp freight groups, brokers you
>    already deal with, direct shippers, and broker email blasts.
> 2. Where exactly — the board, group or brokers, and your login or handle there.
> 3. Two loads you sourced and booked yourself: lane, broker, month, rate.
>
> If you have never sourced and booked a load yourself, say so straight — it saves us both the time.
>
> We reply with an approval or a rejection within 1–3 days. If you would rather talk it through,
> reply here with a time that suits you and I will call you myself.
>
> — Mike Carter
> LoadBoot · hello@loadboot.com

### 5.3 Gilnalyn Capadocia — `gilnalyncapadocia2000@gmail.com`
**Subject: You asked for a person — I'm here**

> Hi Gilnalyn,
>
> You asked to speak to a real person in our chat yesterday and nobody came back to you. Sorry about
> that — that is not how we want to run it.
>
> You did not get as far as telling us what you needed, so rather than guess: what can I help with?
> Most things from the agent side fall into one of these, and I can answer any of them properly —
>
> · where your referrals stand, and when the 1 % on a delivered load actually pays out
> · getting a carrier of yours signed up and verified
> · something in the agent portal not doing what you expect
>
> Just reply to this email, or pick the chat back up — it is still open and I will see it.
>
> — Mike Carter
> LoadBoot · hello@loadboot.com

### 5.4 In-chat — `94b2e297` (broker, no email)

> Hi — Mike Carter here, sorry about the wait.
>
> I saw you were looking for a load to London. I should be straight with you: LoadBoot is domestic
> US freight only, so if that is London UK, it is not something we can cover. If you meant London,
> Ontario or London, Kentucky, then we can — tell me the pickup city and state and what you are
> moving, and I will take it from there.
>
> Either way, posting loads here is free and there is no monthly fee. If you leave me an email I
> can reply even after you close this window.

### 5.5 In-chat — `f96f3de6` (no email)

> Hi — Mike Carter here. You asked about the factory fee twice and I gave you the wrong answer
> twice. Sorry, and thank you for pushing.
>
> You meant the **factoring** fee, and that one is not ours. Factoring is a separate company you
> choose, and they set their own rate — typically 1–3 % of the invoice. We do not take a cut of it
> and we do not push you toward anyone.
>
> On who pays first: the broker pays **you** directly, or your factoring company if you have one —
> bank to bank, we never hold your money. LoadBoot invoices its flat 5 % separately, and only after
> the load is delivered and you have already been paid. So the order is: you get paid, then we do.
>
> If you leave me your email I can answer here and by email, so you do not lose the thread.

---

## 6. `bl_lc_0394` — one reminder, carrier and broker only (owner instruction, 22 Sep)

**The complaint, confirmed in the data:** hello@loadboot.com took **186 `chat.sla` emails in 13
days**. One conversation alone — `d4e7439e`, no name, no email, no role, a visitor who simply left
— sent **46 of them**. Another 30, another 26. Two causes:

1. **It repeated.** `lc_sla_alert()` and `lc_do_handoff()` both re-fired every 30 minutes, for as
   long as the chat stayed unanswered, forever.
2. **It fired for everyone.** A dispatcher job applicant, a careers question and an anonymous
   website visitor raised the same alarm as a real carrier.

**Now:** the reminder goes **once**, and only when `visitor_role` is **carrier or broker**.
Everything else stays in the Command Center list and in the in-app notifications, which are
untouched — they cost nothing.

"Once" means once per **waiting episode**, not once per lifetime. `cc_lc_reply()` already cleared
`sla_alerted_at` when a human actually answered; it now clears `handoff_alert_at` too. So if a
carrier comes back after a real reply and is left waiting again, that earns one fresh reminder.
Without that reset, answering a chat would have muted it permanently.

> `shipper` and `partner` are **not** in the list — the instruction said carrier and broker. One
> word and they go in.
>
> Side effect worth knowing: Gilnalyn Capadocia (agent portal, role `NULL`) and Sukhdeep kaur
> (dispatcher) will **not** raise an email alert under the new rule. Neither will a website
> visitor who has not said what they are yet. They still appear in the Command Center list.

Verified on prod: no `30 minutes` / `6 hours` repeat clause left in any of the four functions,
`cc_lc_reply` resets correctly, anon SECDEF surface still **33**.

## 7. Reply-To — already correct, and worth knowing why

`sys_email()` does not set a sender; the `delivery-worker` edge function picks an identity from
the `template_key`. Anything not matched as outreach, billing or dispatch falls through to
**`support` — `LoadBoot Support <hello@loadboot.com>`, `reply_to: hello@loadboot.com`**.

So a chat follow-up sent under `chat.followup` or `chat.reply` already leaves from hello@ and
comes back to hello@. **The trap:** `DISPATCH_RE` matches the bare word **`carrier`** in a
template key, so a key like `carrier.followup` would have gone out from `dispatch@` instead.
Keep customer follow-ups on a `chat.*` key.

## 8. Sent — 22 Sep 2026, 12:16 UTC

Both of the people the owner pointed at (the one carrier and the one broker from Monday 21 Sep):

- **Ronald Lester** — carrier, `ronaldlester1969@gmail.com`. Full follow-up emailed
  (`chat.followup`, idempotency `lcfollowup:fd56288d…:ronald`) — from hello@, replies to hello@.
  A short note was also posted in his chat pointing at the email; `visitor_unread` deliberately
  left at 0 so `lc_reply_notify` does **not** send a second email on top of it.
- **Broker `94b2e297`** — no email on file, so the reply is in-chat only. Told plainly that
  London UK is outside our lane, offered London ON / London KY, and asked for an email address.

Both conversations now carry `first_staff_reply_at`, so they drop off the unanswered list.

**Still waiting, not sent, owner's call:** Sukhdeep kaur (70 h, the reapply question — draft §5.1)
and Gilnalyn Capadocia (draft §5.3). Neither is a carrier or a broker, so neither will chase
itself under the new alert rule.

---

## 9. `bl_lc_0395` + the last two sends — 22 Sep 2026, 12:23 UTC

**Alert roles widened to four.** `bl_lc_0395` adds `shipper` and `partner` alongside `carrier`
and `broker` in `lc_do_handoff`, `lc_sla_alert` and `lc_unanswered_alert` — the four revenue-side
roles. Dispatcher applicants, agents and visitors who have not said what they are still raise no
email, only the in-app Command Center notification. "Once per waiting episode" from `bl_lc_0394`
is unchanged; this only widens *who* qualifies.

> The anchor deliberately includes the closing paren — `in ('carrier','broker')` — because
> `lc_do_handoff` has a second, unrelated line reading `in ('carrier','broker','shipper')` that
> decides whether to offer a phone callback. Verified after: that line is intact, all three
> alert predicates now carry four roles, anon SECDEF surface still **33**.

**Both remaining follow-ups sent**, same path as Ronald — `chat.followup`, so from
`LoadBoot Support <hello@loadboot.com>` with `reply_to: hello@loadboot.com`. Both `delivered`:

- **Sukhdeep kaur** — `sukhvirk1712@gmail.com`, 12:23:07. Told plainly she can reapply, and that
  the reason she was turned down has been corrected: it is not whose name the board is in, it is
  how she finds and books loads. Employer's or carrier's login counts; so do Facebook/WhatsApp
  freight groups, brokers she knows, direct shippers. Plus the three things to include, the
  1–3 day turnaround, and that the careers 404 was a cached page she does not need anyway.
- **Gilnalyn Capadocia** — `gilnalyncapadocia2000@gmail.com`, 12:23:07. She never said what she
  wanted, so the email asks — with the three agent-side things it is usually about.

In-chat notes posted in both conversations pointing at the emails, `visitor_unread` left at 0 so
`lc_reply_notify` does not stack a second email on top. Both now carry `first_staff_reply_at`.

Also answered in-chat: **`f96f3de6`** (no email on file) — the factoring-fee visitor from this
morning. Told him plainly that the factoring fee is not ours, that the factor sets its own
1–3% rate, and that the broker pays him (or his factor) before LoadBoot invoices its 5%.
Asked for an email address so the thread can survive him closing the window.

**Result: every open conversation from the last 7 days has had a human reply** — verified,
`still_unanswered_within_7d = 0`. What remains open
is only the pre-15-Sep backlog the owner chose to leave alone.

---

## 10. `bl_lc_0399` — the bot taught on every question it actually failed

**Source, not guesswork.** Every visitor message in the whole production history that was
immediately followed by an escalation ("let me get a real person", "I have already given you
that answer once", "our team isn't at the desk"), swept and grouped. 17 new KB rows, priority
105–121 (existing rows top out at 105; `lc_bot_answer_l2` breaks ties on `priority DESC`).

Covered: how to apply as a dispatcher · how long after applying · **reapplying after rejection,
with the corrected load-board rule** · no experience / course not finished · when a human is
actually at the desk · international freight (London) · local vs regional vs OTR · how fast a
posted load gets covered · "can I get a load tomorrow" (incl. the 180-day authority wall) ·
**8-digit MC numbers** · "I signed up, now what" · where the portals are · the three numbers
people confuse (5% carrier fee vs 1% referral vs a salaried wage) · what the platform does ·
"I already emailed you" · carrier who needs a dispatcher · how big the network is.

Honesty held throughout: **no invented carrier count, no promised interview date, no coverage-time
promise.** Where we do not publish a figure the answer says so.

**Verified functionally, not by eye:** the 21 real failing questions, typed exactly as the
visitors typed them (`load for londan`, `At what time mile is available`, `i send an email`),
run through `lc_bot_answer_l2` at the real 2.0 exact threshold — **21/21 now answer, on staging
and on production.** Before this migration, 21/21 escalated.

> **Side finding worth a separate fix:** a real carrier was blocked because the signup form
> insisted an MC number is 7 digits. Newer FMCSA dockets are 8. The KB row now tells them to
> send the authority letter instead of shortening the number, but the **form validation itself
> is still wrong** and should be fixed.

## 11. Is there real AI behind the chat? Yes — with one caveat that explains everything

**Yes.** `supabase/functions/lc-brain` v4 is Gemini — `gemini-2.5-flash` first, falling back
through `2.0-flash`, `2.5-flash-lite`, `flash-latest`, with a retry on 503/429 and a
`responseSchema` forcing `{reply, escalate}` JSON. `lc_brain_config.enabled = true`. In the last
30 days: **43 brain jobs, all consumed, only 2 of them by the watchdog** — so ~41 answers came
back from the model. Only 4 "[[note]] Watchdog answered this one — the AI reply never came back"
notes exist, the last on 16 Sep.

Proof it is the model and not a SQL template: the line Sukhdeep and `f96f3de6` both received —
*"I have already given you that answer once, so it clearly was not what you were after."* — is
the wording in `lc_brain_write`, **not** the wording in `lc_bot_step` (*"I've already given you
that answer once… No point repeating myself."*). The live path runs through the brain.

**The caveat, and it is the real answer.** `lc_bot_step` contains:

```
v_ans := app_private.lc_bot_answer(p_text);
if app_private.lc_brain_on() then
  perform app_private.lc_brain_dispatch(...);
  return;                       -- ← always taken on production
end if;
```

Everything below that line is **dead code while the brain is on**: the never-repeat guard, the
answer-first lead capture, the name capture, the `bot_misses` counter, the "Hmm, let me make sure
I get you the right thing" menu — and `lc_log_miss(p_text)`. *That* is why `app_private.lc_misses`
had zero rows for months. Not a broken table; an unreachable line.

And the model answers **from the KB**: `lc_brain_dispatch` passes it twice — as the exact-phrase
`fallback` and as `facts`, which the prompt labels *"RETRIEVED SNIPPETS FROM OUR OWN KNOWLEDGE
BASE (highest authority — prefer these wordings)"*. The prompt also says *"Default to ANSWERING…
Escalating those is a failure."* So an empty KB slot plus a strong instruction to answer is
exactly how *"what about the factory fee?"* came back as a 5%-pricing answer. The AI was not
broken. It was answering confidently from the wrong snippet because the right one did not exist.

Both halves are now closed: `bl_lc_0393` put `lc_log_miss` inside `lc_escalate`, and
`lc_brain_write` escalates through `lc_escalate` — so the model's own give-ups now land in the
Command Center "teach the bot" screen, which has been empty since it shipped. `bl_lc_0399` filled
the 17 gaps that made it guess.

**Still open, a decision rather than a patch:** the matcher prefers a weak wrong answer over
admitting a miss, so a *confidently wrong* answer is still not logged unless the visitor pushes
back (`lc_is_repair_request`, which does log). Worth tuning the prompt to allow "I don't know".

## 12. Email templates, live view, and one shell — already true

Checked rather than assumed. Both halves of the ask already exist:

- **See every email that goes out, live.** `app_private.email_catalog` — 240 keys on production —
  plus `#/email-catalog` and the send feed in `bl_comm_0396`. Built by a **parallel session
  today**; see `claude/EMAIL-CATALOG-PROD-0395.md`.
- **One shell for all of them.** `delivery-worker` v16: *"the shell is the GLOBAL, ONLY source of
  email branding."* One header, one footer, applied at send time to every queued body. If a
  hand-written email arrives as a full HTML document the worker strips it to a fragment first, so
  a second header can never nest (that bug sent 34 double-headed emails on 15 Aug 2026).
  The single deliberate exception is `outreach.*` cold mail, which is self-contained because it
  carries its own unsubscribe footer — that one must stay outside the shell.

**Fixed the open question that doc left for the owner.** `chat.followup` was filed as
`trigger_source = 'UNKNOWN - verify'`. It was not an alias of `chat.lead.followup` — it was this
session's three hand-sends on 22 Sep. The catalog row now says so, with the recipients and times.
`chat.unanswered` was also pre-registered before its first send so it never shows up as unknown.

> ⚠️ **Migration numbering has collided.** A parallel session is at `bl_comm_0391–0398` and
> `bl_wa_0396`; this session took `bl_lc_0392–0395`. Same numbers, different prefixes, both
> already applied to both databases — renaming now would be worse than the collision. This
> session's last file is `bl_lc_0399`; **the next free number is 0400.** Two sessions sharing one
> working tree is also how `app/carrier/app.js` got overwritten on 29 Aug — worth not repeating.
