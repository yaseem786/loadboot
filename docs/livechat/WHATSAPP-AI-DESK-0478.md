# WhatsApp AI desk — owner notified on every inbound, per-chat "Give to AI / Take from AI", dispatcher chats locked (design, 27 Sep 2026)

Owner's ask (27 Sep, his words condensed): *WhatsApp pe bhi AI kaam kare. Abhi message aata hai to pata nahi chalta
aur banda chala jaata hai. Har chat ke saath "AI ko do / AI se lo" button — main na hoon to AI reply de, main hoon to
main loon. Ek switch poore WhatsApp ke liye. Lekin jo carrier kisi dispatcher ko assigned hai, us ki chat AI kabhi na
le.* Nothing below is built; §1 is what exists today (read from the repo this session).

---

## 1. What exists today (and why he does not find out)

- Inbound: Telnyx → `supabase/functions/telnyx-whatsapp` → `app_private.wa_hook` (`bl_wa_0368`) → `wa_threads` +
  `wa_messages`. `wa_route()` resolves the sender: a carrier's number → that carrier's **active dispatcher**
  (`dispatcher_assignments`, unique active row per carrier), a broker contact → the dispatcher who keeps it, else
  **pool** (`owner_user_id null`).
- **Notification goes only to `owner_user_id`** (web push, tag `lb-wa`, deep link `/app/agent/#today` — the
  dispatcher app). A pool thread notifies **nobody**. The owner is never on that list. That is the whole bug.
- CC screen `app/command-center/views/whatsappLive.js`: overview, assign to staff, thread status/label, templates,
  composer with media (`waSend` → `wa_send_prepare`). No AI, no presence, no per-thread mode.
- Send rules already in SQL (`wa_send_prepare`, `bl_wa_0375`): free text only inside the **24-hour window**
  (`last_inbound_at`), approved templates outside it, 120/hour cap. Auto notices go through `wa_auto_outbox` +
  `wa-auto-worker` (a pipe; every rule is SQL).
- Patterns to copy: live chat's per-conversation `bot_paused / bot_paused_by / bot_paused_at` (`bl_lc_0312`) and
  the presence check `app_private.lc_staff_online()`. Brain rows already waiting: `source.wa` (planned, off) and
  `tool.send_whatsapp` (prep, approved templates only) in `brain_permissions`.

## 2. Design

### 2.1 The owner always finds out (session 1, no AI yet)
- `wa_hook`: on **every** inbound, besides the routed dispatcher, push the owner (CC admin role) through
  `push_outbox` with deep link `/app/command-center/#/whatsapp?thread=<id>`; pool threads always.
- Unanswered 10 minutes (no outbound, no AI reply, thread still open) → one email `staff.wa_unanswered` (catalog,
  class S `staff_internal`, cap 1 per thread per day, trigger = `wa_unanswered_sweep`, contact tokens only).
- CC: unread count on the WhatsApp nav item; the screen plays a short tone when a new inbound lands while open.

### 2.2 Who holds each chat — three states, one global switch
- `wa_threads.ai_mode text not null default 'auto' check (ai_mode in ('auto','ai','human'))`, `ai_set_by uuid`,
  `ai_set_at timestamptz`.
  - `auto` — AI answers **only while the owner is away** (no CC heartbeat for `away_after_min`, default 3).
  - `ai` — "🤖 Give to AI": AI answers even if he is present.
  - `human` — "🙋 Take from AI": AI is silent; typing a reply in the CC composer sets this automatically; it falls
    back to `auto` after 12 h of silence (so a chat he took once does not stay dead the next day).
- Global: `wa_config.ai_when_away boolean default false` + `away_after_min int default 3` (the one switch he asked
  for: **"🤖 AI answers WhatsApp while I'm away"** in the screen header). Off = no AI anywhere, whatever the thread says.
- Presence: `app_private.cc_owner_present()` = CC heartbeat within `away_after_min` (same mechanism as
  `lc_staff_online`, scoped to the CC).

### 2.3 The law, in SQL, not in the UI
`app_private.wa_ai_allowed(p_thread uuid) returns table(allowed bool, reason text)` — checked **twice**: when
`wa_hook` decides whether to enqueue, and again inside the send executor right before the message leaves (an
assignment can change in between). Order:
1. Thread routed to a **dispatcher** — carrier with an active `dispatcher_assignments` row, or `owner_user_id` is a
   dispatcher (broker contact / booking) → `false, 'dispatcher:<name>'`. **Absolute**: `ai_mode = 'ai'` does not
   override it, the CC button is disabled with the tooltip *"Assigned to dispatcher <name> — AI never takes this
   chat"*, and a forced attempt is logged. Only pool threads and threads the owner assigned to himself qualify.
2. Demo org (`organizations.is_demo`) → false. Contact blocked (`bl_wa_0391`) or last inbound is STOP → false.
   Thread closed → false. Outside the 24-hour window → false, `'window'` (templates are the owner's call).
3. Global switch off → false. `ai_mode = 'human'` → false. `'ai'` → true. `'auto'` → true only if
   `not cc_owner_present()`.
Enforcement lives in Postgres (`brain_enqueue` refuses a `wa` job whose thread is not allowed; `brain_tool_exec`
for `send_whatsapp` re-checks) — same law as the rest of the brain (CLAUDE.md §9).

### 2.4 The AI reply path (session 2)
- `source.wa` → live. `wa_hook` → allowed → `brain_enqueue('wa', thread_id, route 'wa')` with the last 20 messages,
  the contact's kind/name/org and the same facts the chat route reads. One job per inbound; a second inbound
  before the reply cancels and re-queues (answer the latest state, not each line).
- Reply delivery = a row in a `wa_outbox` (the `wa_auto_outbox` pattern, kind `ai_reply`) that **`wa-auto-worker`
  sends** — no new Telnyx code, the 24-hour/window/cap rules stay in `wa_send_prepare`. `wa_messages.sender_kind
  = 'ai'`; the CC bubble shows **🤖 LoadBoot Support**.
- Persona: **LoadBoot Support, no personal name** (`bl_brain_0476`); says it is an AI assistant if asked; replies
  in the sender's language; never quotes money, legal or identity values; "talk to a person" / anger / a money or
  legal question → `ai_mode = 'human'` + owner push *"wants a person"* and a holding line ("a person will reply
  shortly"). Caps: 1 reply per inbound, 20 per thread per day, daily cap in the `tool.send_whatsapp` row; model =
  the chat route's (Sonnet 5, `bl_brain_0475`).
- `tool.send_whatsapp` → live, restricted to source `wa`, free text only inside the window; templates stay owner-only.

### 2.5 The screen (`whatsappLive.js`)
Header switch (2.2). Filter chips: **Needs you · AI handling · Dispatcher · All**. Thread row badge: *You* / *AI* /
*Dispatcher <name>* (locked, grey). Thread pane: one button that flips — **🤖 Give to AI** ↔ **🙋 Take from AI** —
disabled with the reason when 2.3 says no. Message bubbles tagged who answered (you / AI / dispatcher). Everything
through `openDrawer()` where a dialog is needed (CLAUDE.md §8). Every flip → `brain_log` (CC change log).

## 3. Gates

Staging (`snslhvmkjusozgjelghi`), seeded threads, then purged:
1. Pool thread, owner away, switch on → AI reply within 60 s, bubble tagged AI, `wa_messages.sender_kind='ai'`.
2. Same thread, owner present → no AI; owner push arrives; after 10 min the `staff.wa_unanswered` email.
3. Carrier with an active dispatcher, `ai_mode` forced to `ai` → **no reply, ever**; `wa_ai_allowed` says
   `dispatcher:<name>`; the button is disabled in the CC.
4. STOP → nothing; outside the 24-hour window → nothing + owner line.
5. "Take from AI" while a job is queued → job cancelled, no reply; typing in the composer sets `human`.
6. Assignment created *between* enqueue and send → the executor refuses (second check).
Prod: switch off by default; 4-week spot-check copies every AI WhatsApp reply into the owner digest
(`REP-PLAN-0477.md` §3). Anon SECDEF surface unchanged — no new public function; CC RPCs are `authenticated`,
revoked from public/anon at creation.

## 4. Sessions and decisions

| # | Piece | Sessions |
|---|---|---|
| 1 | 2.1 notify + 2.2 schema/switch + 2.3 `wa_ai_allowed` + 2.5 buttons (AI still off) | 1 |
| 2 | 2.4 brain `wa` route + outbox + worker + prompt; `source.wa`/`tool.send_whatsapp` live; gates 1–6 | 1–2 |

Owner decisions: (a) `away_after_min` — 3 minutes ok? (b) when he is present but silent, AI stays silent
(recommended, his words) or steps in after 10 min? (c) threads he assigned to himself count as his pool — yes?
(d) the 10-minute unanswered email — yes/no. (e) Session 1 can ship before the consent work in `REP-PLAN-0477.md`
because every AI reply here answers a message the person sent first (inside the window) — no business-initiated
message comes from this desk.
