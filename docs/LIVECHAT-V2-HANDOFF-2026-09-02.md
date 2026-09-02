# Live chat v2 (bl_lc_0312) — handoff, 2 Sep 2026

## LIVE already (no deploy needed)
- Migration `bl_lc_0312_real_chat` applied to **staging + prod**, rollback-tested on both. Prod anon-executable SECURITY DEFINER count = 27 (was 25; +`lc_rate`, +`lc_history`). `lc_hello` is authenticated-only.
- Edge fn `lc-brain` v4 deployed to staging (v5) + prod (v3): account block + staff_online in the prompt.
- New cron `lb-lc-sla-alert` every 2 min (both envs): a handoff unanswered ≥10 min emails the alert address, repeats every 30 min.
- Effects visible on the OLD widget too: honest presence ("Mike is online" only when a CC heartbeat is <3 min old), one-tap human handoff, no fuzzy keyword answers, alert email to hello@ on every handoff.

## IN THE REPO ONLY after commit — needs `python build_site.py` + push (+ clear PWA service worker)
- `app/shared/ui/liveChatCore.js` (widget v5), `app/command-center/views/liveChat.js` (console v2), `app/command-center/command-center.css` (+ .lcx- block), `app/shared/api.js` (+3 exports, presence_set 4-arg), `migrations/bl_lc_0312_real_chat.sql`, `supabase/functions/lc-brain/index.ts`.
- If the device was offline when this session ended, these six files are attached in the chat — commit with expectedMtimeMs guards (liveChatCore 1786911052688, liveChat.js 1787428597359, command-center.css 1788078662516, api.js 1788078216722).

## Owner actions
1. In CC → Live chat: toggle **Online** with your name; set **Alerts to:** your personal email (default hello@loadboot.com). Presence auto-expires 3 min after the CC tab stops heart-beating.
2. Click **🔔 Enable desktop alerts** once in the CC.
3. Deploy the frontend stack.

## Design decisions
- Human joins (Join & take over, or just replying) → `bot_paused=true`; the AI is silent until **Hand back to AI**. Before a human joins, the AI keeps answering while the visitor waits.
- Website lead gate (`gate_after`) OFF; answer-first ride-along ask stays (max 3).
- Brain fallback and watchdog use exact-phrase KB only (`lc_bot_answer_l2 ≥ 2.0`); otherwise honest escalation.
- Rating 1–5 + transcript email via `lc_rate`; visitor "End chat"; `lc_history` (10 most recent per account/browser).
- Portal welcome via `lc_hello` (needs session) and `p_page` suffix `|hello` tells `lc_start` not to repeat the forced greeting.
- Spanish path: brain fallback patched; the ES human-request gates were left as-is (0 Spanish conversations to date).
