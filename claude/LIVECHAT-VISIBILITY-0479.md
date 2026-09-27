# bl_brain_0479 — the owner sees what the AI is doing in live chat (27 Sep 2026)

Owner asked for all three (27 Sep, after the v6 widget deploy): AI chats on the default tab, a bell when the AI
takes a new chat, and one screen listing every AI chat answer with desk + cost.

## What shipped (staging ✅ · prod ✅ · migration `migrations/bl_brain_0479_chat_visibility.sql`)

1. **CC → Live chat → "Needs you"** now also lists chats the AI is answering (`stateOf === 'ai'`), each with an
   **AI answering** badge. The red "urgent" tint on the tab still means a person is waited on. (`views/liveChatV3.js`)
2. **Bell notification on the FIRST AI reply of a new conversation** — `livechat.ai_answered`, in-app, staff role,
   title "🤖 AI answered a new chat — <visitor> · <role>", body = the visitor's first question + page, link to
   `#/live-chat?id=<conv>`. Never per message: `lc_bot_deliver` counts bot messages BEFORE it inserts, so only
   `v_bot = 0` notifies. Switch: `brain_config.chat_notify_new` (default ON) — CC → AI Brain → Overview →
   "Tell me when the AI takes a new chat", through `cc_brain_config_set`, logged in the brain change log.
3. **CC → AI Brain → Chats** (`#/ai-brain-chats`, `public.cc_brain_chats(p_limit)`, `brain_cc_guard`): one row per
   live-chat brain job joined to its conversation — visitor, desk (the `[[as:<desk>]]` tag → Riley/Sara/Omar/Ali/
   Maya/Daniel), question, answer, "Now" (AI handling / person took over / closed), model, cost, time, "Open chat".
   Row click opens the job drawer (full answer + tool calls). Summary strip: replies, conversations, cost, hand-offs.

Patches are anchor replacements on the live definitions (`lc_bot_deliver`, `cc_brain_config_set`, `brain_state`,
`cc_brain_overview`); the DO blocks refuse to run if an anchor is missing and are idempotent.

## Checks
- Staging throwaway conversation: two `lc_bot_deliver` calls → exactly one notification, right title/body/url; cleaned up.
- Anon-executable SECURITY DEFINER surface: prod 36 / staging 35, names identical to the baseline before and after
  (`cc_brain_chats` is revoked from public/anon, granted to authenticated).

## Also found this session (not fixed here)
- `delivery-worker` + `delivery-worker-sms` call `cc_delivery_release_due` every minute with the service-role key and
  get 403 "not authorized" (≥48 h in the logs) — `can_manage_comms()` is false for service_role. Harmless today
  (no `scheduled` deliveries exist) but any future scheduled email would never be released. Separate small fix.
- Owner's "portals not opening" (27 Sep 18:36/18:54) was the carrier portal opened with the staff account
  (20190myaseen — no carrier org → "No carrier account"); the carrier account's sign-in at 18:36 happened inside the
  chat widget's onboarding, which does not hand its session to the portal. Not a deploy regression.
- `REP-PLAN-0477.md` / `WHATSAPP-AI-DESK-0478.md` named in the hand-off do not exist on any branch — never committed.
