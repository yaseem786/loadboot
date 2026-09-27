# bl_brain_0474 — AI suggested reply, "why the AI said this", who-answered stats, and the CC **AI Brain** screen

Plan: `docs/livechat/LIVECHAT-CLAUDE-BRAIN-PLAN.md` §3 (the two UI items) + the owner's ask of 27 Sep 2026:
*"UX, UI CC mein Amazon standard ki ho"* and *"jaise Claude app ka context-window panel hai, waise CC mein API
ka sab kuch dikhe"* (the screenshot: one number on top, stacked bar, one line per part with value + %, limits
as progress bars).

## What shipped (27 Sep 2026)

### Database — `migrations/bl_brain_0474_assist.sql` (staging ✅ · prod ✅)

| Piece | What |
|---|---|
| `source.assist` | New brain source, **on by default**, low risk, **$3/day**, 300 jobs/day. The brain drafts a reply for a HUMAN agent. `brain_sink` has no branch for it, so the result stays on the job row — nothing reaches the visitor. |
| `brain_jobs.source` CHECK | + `'assist'` (staging learned it the hard way: applied there as `bl_brain_0474b_source_check`; prod carries it inside 0474). |
| `brain_config` | `effort.assist = low`, `max_tokens.assist = 4000`. |
| `app_private.brain_user_text` | `'assist'` branch beside `'chat'`: same VISITOR / ACCOUNT / HISTORY / KB blocks, different opener — *write the exact message the human will send, in their voice, no chips / forms / emoji, never promise money, dates or approvals*. |
| `public.cc_lc_assist(uuid)` | Staff (`lc_cc_ok`) enqueue one draft. One in flight per conversation (90 s window). Context = `lc_brain_chat_context` + `staff_online=true`, `staff_name`, `mode`, `bot_paused`. Tools: `kb_search`, `get_facts`, `account_lookup`. |
| `public.cc_lc_brain(uuid)` | Staff read: `engine` (claude / gemini), `assist_on`, `usd` on this chat, latest `assist` (reply, confidence, escalate reason, tools, cost, secs), latest `escalation` (the summary + suggested reply the brain wrote when it handed off), every Claude `jobs` row with confidence, actions, tools, `fell_back`. |
| `public.cc_lc_stats` | + `who_7d {claude, gemini, human, total}`, `claude_usd_7d`, `chat_on_claude`. claude = done Claude chat job and no handoff · human = handed off · gemini = bot reply with neither. |
| index | `brain_jobs (source, ref_id, id desc)` for the per-conversation reads. |

Anon SECURITY DEFINER surface: **36 prod / 35 staging — unchanged** (both new functions revoked from `public, anon`).

### Staging gate (27 Sep 2026, project `snslhvmkjusozgjelghi`)

- Job 45 (`assist`, seeded conv `…0473`, "my COI was rejected why"): **done in 17.5 s, $0.33, 85% sure, 0 tool calls**
  (account file already in the context). Draft is in the agent's voice, names the reviewer's note verbatim, asks one
  closing question, no emoji, no chips. It also self-reported the status/note mismatch the chat job had filed as finding #2.
- `cc_lc_assist` as an authenticated staff user: first call → `queued`, second call while running → `{"status":"running"}`.
- `cc_lc_brain` / `cc_lc_stats` / `cc_brain_overview` as that user: all return (stats: who_7d = 2 Claude · 0 Gemini · 3 human of 5).

### Command Center

**Live chat (`views/liveChatV3.js`, `livechat-v3.css?v=20260927`)**
- **AI suggested reply** card above the composer (staff only). States: *Suggest a reply* → *Drafting…* (polls every 2 s)
  → the draft with **Use this** (drops it in the box; you still press Send), **Copy**, **Redo**, `% sure · tools · secs · $`
  and a *why?* link into Details. Low confidence shows an amber *read before sending* line with the reason. When the
  brain handed the chat off on its own, the card shows its **summary + the reply it suggested** without asking for a
  new draft. Hidden on closed chats and when `source.assist` is off.
- **Why the AI said this** card in Details: engine for visitors, Claude spend on this chat, every Claude answer with
  confidence, what it says it did, tool calls (red if denied/failed), fallback-to-Gemini with the error.
- Stats strip: **Who answered** — Claude · Gemini · human (7 d) with a three-colour bar; tooltip carries Claude's cost;
  says *Claude off* when `source.chat` is off; click → AI Brain.

**AI Brain (`views/brain.js`, nav Insights & Admin → AI Brain, `#/ai-brain…`, `settings.manage`)**
- **Overview** — status pills (brain on/off, function key, over cap, spot-check, failures), model + gate; switches:
  kill switch (confirm), *Live chat on Claude* (`source.chat`), *Staff suggested replies* (`source.assist`), daily cap;
  **Try a question** (real Claude call, filed under Test jobs, answer inline with tool calls).
  **Spend today** panel — the one the owner asked for: `$spent / $cap (%)`, stacked bar by source, one line per source
  with $ and share + *Left under the cap*, then **Tokens today** (input / cache read / cache write / output with %
  and cache-hit), then **Limits** as progress bars (daily cap, every source's $ cap and jobs/day), then a 7-day bar.
  Right: KPIs (done / failed / escalated / avg answer / findings open), **Running now**, **What the brain just did**.
- **Jobs** — filter by source / status; when, source·route, status (+ *→ person*), question, sure %, tools, tokens
  in / cache / out, cost, time. Row → drawer: full answer, what it says it did, every tool call with input + result,
  findings filed, the context it was given.
- **Permissions** — Sources / Tools / Rules, each a switch + risk + mode + caps + 7-day usage; high-risk on and
  `tool.escalate` off ask first; Edit drawer (mode, risk, caps, sources, note, reason); add / delete custom rules.
- **Findings** — open / accepted / done / dismissed; card = kind, title, surface, detail, evidence, suggested fix, job link.
- **Facts** — the registry, inline edit (next answer uses it, no deploy).
- **Change log** — `brain_permission_log` with a field-level diff.

## Not done / owner's side

- **Prod `ANTHROPIC_API_KEY`** is still not in the Edge Function secrets (3 test jobs failed on it at 13:46–14:04 UTC).
  Until it is, every prod assist / chat job fails and falls back — the CC shows that honestly (*Draft failed: …*).
- **`source.chat` on prod is OFF** (visitors get Gemini). Flip in CC → AI Brain → Overview once the key is in and one
  *Try a question* comes back.
- `$3/day` on `source.assist` is ~9 drafts at today's $0.33 each. Raise in Permissions if staff use it a lot; the cost
  is mostly the cached system block per call.
- Plan doc §3 status lines: not edited here — the previous session's §3 status edits live on the owner's machine,
  unpushed; add "UI items shipped in 0474" there when merging.
- Not built: the `A` keyboard shortcut for *Suggest a reply*; Spanish draft check on staging (the route passes `lang`,
  the model is bilingual — untested).
