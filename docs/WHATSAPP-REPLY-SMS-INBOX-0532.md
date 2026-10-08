# bl_wa_0532 + bl_sms_0533 — WhatsApp "Reply", SMS inbox on WhatsApp's rules, /sms-brokers.html, silent portal updates

Built 8 Oct 2026 on branch `claude/cool-cori-3aymt3` (from main). **STAGING ONLY** (snslhvmkjusozgjelghi). Production has none
of it. Reads with `docs/WHATSAPP-INBOX-0367-HANDOFF.md`, `docs/WHATSAPP-0377-NEXT-SESSION.md` and `migrations/bl_dial_0390_sms_consent.sql`.

## 1. What is on staging now

| Piece | Where | State |
|---|---|---|
| WA reply columns + hook + send + json | `migrations/bl_wa_0532_wa_reply_quote.sql` | **applied on staging** (5 inbound rows got their `wamid` backfilled from the webhook log) |
| WA send with `context.message_id` | `supabase/functions/telnyx-whatsapp/index.ts` (v3) | **deployed on staging** (Supabase version 4), verify_jwt = true |
| SMS threads, routing, branding, broker gate, CC queue | `migrations/bl_sms_0533_sms_inbox_rules.sql` | **applied on staging** (the one existing text got a thread; `sms_enabled` still **false**) |
| SMS send on the owner's line + profile | `supabase/functions/telnyx-sms/index.ts` (v2) | **deployed on staging** (Supabase version 3), verify_jwt = true |
| Dock: WhatsApp reply | `app/shared/dialer-wa.js` | esbuild clean, **not browser-tested** |
| Dock: Texts tab on the new rules | `app/shared/dialer.js` | esbuild clean, **not browser-tested** |
| CC WhatsApp: reply | `app/command-center/views/whatsappLive.js` | esbuild clean, **not browser-tested** |
| CC Phone: SMS conversations queue + Hand to + broker settings | `app/command-center/views/dialerLive.js` | esbuild clean, **not browser-tested** |
| Public broker SMS page | `sms_brokers_module.py` + `build_site.py` | `python build_site.py` → BUILD OK, `site/sms-brokers.html`, in sitemap, footer link "Text messages (brokers)" |
| Portals update silently | `app/shared/sw-register.js` | no banner; new worker takes over at once, never reloads under the user |

Anon-executable SECURITY DEFINER surface in `public` on staging after both migrations: **35, same names** (checked).

## 2. WhatsApp Reply — how it works

- **Columns** (`wa_messages`): `wamid` (Meta's id — inbound `body.foreign_id`), `reply_to` (FK, same thread, on delete set null), `reply_to_wamid` (raw id quoted).
- **Inbound** (`wa_hook`): Meta's `context.id` on a reply is matched against `wamid` OR `telnyx_message_id` in the same thread → `reply_to`. The raw id is kept either way; a quote of something LoadBoot never stored renders "Original message not available".
- **Outbound** (`wa_send_prepare` + edge v3): `{ reply_to }` on text, template and media. The target must be in the thread; a dispatcher cannot quote a message hidden from him. The payload gets `context: { message_id }` — Telnyx's documented shape (checked 8 Oct: their docs show a wamid).
  - **Our own messages have no wamid**: Telnyx's send response and its status webhooks do not carry one (read off staging's `wa_webhook_log`). So quoting our own message sends the Telnyx id as context, and if Telnyx refuses it the edge function sends the **same** message once more **without** context (`context_fallback`). A refused request sends nothing, so nothing is doubled; the UI then says the quote shows in LoadBoot only. **Whether Telnyx accepts its own id as context is UNVERIFIED** — the first reply-to-own-message on the test number settles it.
- **UI** (both screens): Reply is the first item in the bubble menu (right-click / chevron / long-press in CC; right-click in the dock), double-click, or swipe right on a phone. A reply bar sits above the composer with × and **Esc**. The quote block inside a bubble is a button: click → scrolls to the original and flashes it; not loaded → "Original message not available"; hidden from the dispatcher (bl_wa_0487) → "Message hidden" (the server never hands him the text).

## 3. SMS inbox — the rules, enforced in Postgres

- `app_private.sms_threads`: one row per contact number, `owner_user_id` null = Command Center's queue. `dialer_messages.dispatcher_user_id` is now **nullable** (a queued message has no dispatcher); new `thread_id`, `reply_to`, `sender_user_id`.
- **Inbound** (`dialer_sms_hook`): routed with `app_private.wa_route` — a carrier's number or one of its drivers → that carrier's active dispatcher (push sent). Brokers, shippers, strangers → nobody; CC answers or hands it out. STOP/START as before; the consent trigger still records an inbound as consent.
- **A dispatcher cannot start a conversation** (`dialer_sms_prepare` refuses with the reason; the dock no longer shows the "Text a new number" box to dispatchers — staff still have it). He can only text threads he owns, or take a waiting one for his own carrier ("Take it", `dialer_sms_claim`).
- **Branding, server-side** (`app_private.sms_compose`): `LoadBoot: ` in front unless the text already starts with LoadBoot; ` Reply STOP to opt out.` at the end unless it already says "reply STOP". **First text to a number**: bl_dial_0390's trigger appends `dialer_config.sms_first_msg_suffix` instead; the short suffix is skipped. The composer shows the final text greyed and the segment count (GSM-7 160/153, Unicode 70/67 — the first-message suffix has an em dash, so that one counts as Unicode; that is honest, not a bug).
- **Consent** stays the trigger; `dialer_sms_prepare` checks it first so the dispatcher gets the sentence, not a 500. **Brokers**: refused with "Broker texting not enabled yet" until CC → Phone settings → *Broker texting switched on* (`dialer_config.sms_broker_enabled`).
- **Two messaging profiles**: `telnyx_messaging_profile_id` (carriers/drivers, NULL today) and new `telnyx_broker_messaging_profile_id` (brokers), chosen by the thread's contact kind. Both set in CC → Phone settings. `sms_enabled` stays **false**.
- **Which line**: the thread's line, else the owner's active line. A queued (owner-less) thread keeps the line the text arrived on, so CC can answer from it. Handing a thread to a dispatcher with a line moves it to his line (`cc_sms_assign`).
- **CC**: Dialer → "Text conversations" card — owner / Unassigned pill / consent pill / **Hand to** select (Command Center or any dispatcher).
- **Quoted replies** on SMS are LoadBoot-only (SMS carries no quote); same UI as WhatsApp.

## 4. /sms-brokers.html

`sms_brokers_module.py`, built by `build_site.py` next to `sms.html` (which is untouched, as is the `/text-us` redirect). The verbal script and the first-message disclosure are **word for word** what `dialer_config` holds on staging (`v1-2026-09-21`) — if either changes in the DB it must change there and in the Telnyx campaign. `SMS_BROKER_NUMBER` is **empty** until the owner assigns the number; the page says so instead of inventing one. The spec doc `claude/TELNYX-BROKER-CAMPAIGN.md` is **not in the repo** (nor is `claude/SMS-CONSENT-0390.md`), so the content follows the standard 10DLC checklist (program, opt-in methods, script, confirmation text, frequency, rates, STOP/HELP, privacy, keywords, samples, contact). Compare it with that doc before submitting the campaign.

## 5. Test on staging (test number only)

1. **WA reply, inbound**: from the test phone, long-press one of LoadBoot's messages → Reply → send. CC → WhatsApp: the bubble shows the quote; click it → the original flashes.
2. **WA reply, outbound to THEIR message**: right-click their bubble → Reply → send. The phone must show it as a quoted reply (context = their wamid).
3. **WA reply to OUR OWN message**: same, on a LoadBoot bubble. Either it arrives quoted (Telnyx accepted its id) or arrives unquoted with the toast "quote shows in LoadBoot only" — check `wa_messages.error` is empty either way.
4. **SMS**: nothing can be sent while `sms_enabled = false` — correct. The inbox rules can still be checked: text a dispatcher line from a carrier's number → thread owned by that dispatcher, push received; from an unknown number → CC → Dialer → Text conversations shows it Unassigned; "Hand to" moves it.

## 6. Prod — not yet

In order, after the staging tests: `bl_wa_0532` (needs 0367…0507 first — prod has NO WhatsApp yet), `bl_sms_0533` (needs 0352 + 0390, both on prod), deploy `telnyx-whatsapp` v3 and `telnyx-sms` v2, then check the anon SECURITY DEFINER names (36 on prod).
