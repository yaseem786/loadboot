# CC text inbox + main-line replies (bl_sms_0609) — prod 15 Nov 2026

## What changed
**CC → Phones & live calls → Text inbox** (`app/command-center/views/smsInbox.js`, mounted by `dialerLive.js`) replaces the
flat "Text conversations" table. Two panes:
- left — every conversation (owner-less first): name/number, last message, unread badge, owner pill, kind, STOP;
  search + filters All / Unassigned / Unread / Opted out; "New text".
- right — the full conversation (day separators, quoted replies, who sent each text, which line it left from, delivery
  status + Telnyx error), the Owner menu (hand to a dispatcher / back to Command Center), and the reply box with a
  word-for-word preview of what leaves ("LoadBoot: … Reply STOP to opt out.") and the segment count.
- When the server would refuse (STOP, closed, broker texting off, no consent) the reply box is replaced by the reason;
  "Record their consent" opens the consent form (`dialer_sms_consent_record`). Popups are `openDrawer()` only.
- Phone: one pane at a time with a back arrow. Polls: list 15 s, open conversation 8 s, only while visible.
The flat "Text message log" stays underneath (its table class was `dl-tbl`, which had no CSS — now `dl-t`).

## The access check (why a migration was needed)
- READ: `dialer_sms_thread` lets staff read ANY conversation. Opening an owner-less one marks it read; opening a
  dispatcher's conversation does not touch the dispatcher's unread count.
- REPLY: `dialer_sms_prepare` let staff reply on any conversation but only knew dispatcher lines. 14 of the 16
  owner-less conversations on prod came in on the main number (thread `line_id` null), so staff without a line got
  "No LoadBoot line is attached…", and staff with a line would have answered from a number the customer never texted.
- `bl_sms_0609` (`migrations/bl_sms_0609_staff_main_line_reply.sql`, staging + prod): staff answering a conversation with
  no owner and no line send FROM THE MAIN LINE (`doc_sms_config.from_e164`, fallback `dialer_config.wa_number`), with
  `doc_sms_config.messaging_profile_id`; the main line is also staff's last resort when no dispatcher line exists.
  Dispatchers are unchanged. Consent / STOP / broker switch / hourly cap / guards unchanged.
  `sms_msg_json` gained `sender` (name) and `line`.
- Anchor-patched in place, idempotent, no new function. Anon SECURITY DEFINER surface after: 36 on prod, same names.

## Tested
- Staging, rolled-back transaction, throwaway thread +1 202 555 0143: staff (no line) reads it; reply without consent →
  the consent refusal (not the "no line" one); with consent → queued row, `from = +18153651168`, `line_id` null.
- UI driven in headless Chromium against mocked RPCs (desktop + 390 px): open, mark read, quoted reply, send, hand-over,
  STOP gate, consent gate → form → composer, filters, search, new text. No console errors.

## NOT tested — do this once by hand
No real text was sent. A live send from the main line through Telnyx is unproven from this path (the document-text
sender uses the same number, but `doc_sms_config.enabled` was false in test mode on 13 Oct). Reply once to your own
mobile from the inbox and confirm it arrives from (815) 365-1168; a Telnyx refusal shows in red under the bubble.
