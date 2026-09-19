# Live chat v3 console — handoff (19 Sep 2026)

**Status:** built, headless-tested (stub API, 0 page errors, desktop 1600px + mobile 390px), committed on `main`. NOT yet built/pushed/deployed — owner runs `python build_site.py`, pushes from GitHub Desktop, then hard-refreshes the CC.

## Files
- `app/command-center/views/liveChatV3.js` — the console (additive; v2 untouched except a 3-line switch).
- `app/command-center/livechat-v3.css` — all `.lcv-*`; the module injects its own `<link>`.
- `app/shared/ui/lucide.js` — 69 Lucide icons as one sprite (`ico()`, `icoHtml()`, `ensureIcons()`). Distinct from `icons.js` (the CC nav set).
- `app/command-center/views/liveChat.js` — `renderLiveChat()` now delegates to v3 unless the hash carries `v=2`.
- `previews/cc-livechat-v3.html` — the approved interactive preview (mock data).

## Routes / deep links
- `#/live-chat` → v3 · `#/live-chat?v=2` → old console · `#/live-chat?id=<conversation>` → opens that chat (hash is kept in sync on select; use it in notifications/e-mails).
- Playbook + context links go to real CC routes: `#/carrier?id=<account.org_id>[&tab=documents]`, `#/fleet?org=`, `#/broker?id=`, `#/broker-trust`, `#/dispatchers`, `#/agents`, `#/crm`, `#/loads`. `org_id` comes from `cc_lc_get().account` (lc_account_snapshot); when absent the button falls back to the list screen.
- Customer links inserted into the composer (never auto-sent): carrier `#documents/insurance`, `#documents/w9`, `#account/payments`, `#loads`; agent `#money`; `/get-started`, `/pricing`.

## Backend used (all pre-existing)
cc_lc_list/get/reply/set_status/stats/misses/teach/miss_dismiss/assign/canned_*/calls/presence_get/presence_set/heartbeat/typing/bot_resume, cc_retell_callback. No migration. Anon SECDEF surface untouched (still verify after any later migration: 33 prod / 32 staging, compare names).

## Not built (needs backend) — the ⚡ items from the preview
1. AI suggested reply (lc-brain draft RPC) 2. Auto-translate EN⇄ES 3. Transfer to a named teammate (`cc_lc_assign` has no assignee arg) 4. Collision presence ("Asim is viewing") 5. Journey events before the chat (page visits/uploads) 6. Internal notes — `[[note]]` via cc_lc_reply would pause the AI; needs a note RPC 7. Resolve disposition column 8. `[[card:]]` rich link cards in the widget.

## Verify after deploy
Open CC → Live chat: queue tabs count correctly; pick a chat → header shows First asked + state pill; hover a playbook button → link bar at bottom-left shows the target; `/` opens saved replies; ⌘K palette; 🔔 alerts; phone width → bottom tab bar. If anything is off: `#/live-chat?v=2` is the old screen, one hash away.
