# SMS main line + CC "Text messages" (bl_dial_0547) — prod 13 Oct 2026

Owner (13 Oct): "laga do". Document texts go from the MAIN line; a dispatcher's text goes from the number of the dispatcher
who is sending it; everything visible in CC.

## On prod (rwscphuhpjoudvljvmdk), 13 Oct
- `bl_dial_0540_doc_decision_sms` (item N) + `doc-sms-worker` v1 (verify_jwt=false) + worker_url config.
- `bl_dial_0547_sms_main_line` + `bl_dial_0547b_segments_suffix` (staging first, same SQL; rolled-back proof below).
  The file `migrations/bl_dial_0547_sms_main_line.sql` = both together.
- anon SECDEF 36, names = baseline. New public functions `cc_sms_center`, `cc_doc_sms_config_set`, `cc_doc_sms_test`
  (authenticated, disp_is_staff), `doc_sms_worker_claim` (service_role) — none anon-executable.
- State left: `doc_sms_config.enabled=false`, test mode, no test numbers, `from_e164=+18153651168`;
  `dialer_config.sms_enabled=false` (unchanged). **Nothing can text a carrier until the owner throws the switches in CC.**

## What changed
1. `doc_sms_config.from_e164` = main line (default = `dialer_config.wa_number`, the one public number). The claim sends from
   it with NO messaging_profile_id unless `doc_sms_config.messaging_profile_id` is set (Telnyx then uses the number's own
   profile). `line_id` is only a fallback.
2. `dialer_sms_hook` used to skip every inbound text to a number that is not a dispatcher line, so a STOP to 815 would have
   been lost. Now the main line is handled: STOP/START recorded, the reply lands in the SMS inbox (line_id null, routed by
   wa_route) and a dispatcher answers from their own line.
3. `dialer_sms_prepare`: sender's own active line → thread line (CC staff without a line) → thread owner's line.
4. `cc_doc_sms_test(number)`: a test text through queue → worker → Telnyx (consent + STOP still enforced). `allow_all=true`
   is refused until a test text reached `sent` in the last 30 days.
5. `cc_doc_sms_config_set({first_suffix_ascii:true})` = owner decision (d): "—" → "-" in `sms_first_msg_suffix`.

## CC
Team → **Text messages** (`#/sms`, `app/command-center/views/smsCenter.js`): go-live track (1 Telnyx SMS · 2 main line ·
3 test text · 4 document texts · 5 every carrier), main-line card, test numbers with "Send test", dispatcher lines (sent /
received 7 d), live feed with the exact reason a text did not go, Advanced (debounce, daily cap, the "—" fix).

## Staging proof (one transaction, rolled back)
STOP from +12145550147 to 815 → optout row + inbound message (line_id null); a text to a foreign number → still 'no line';
test without consent → refused with the consent sentence; with consent → queued, claimed `from +18153651168`,
`messaging_profile_id null`, works with document texts OFF; go-live before a sent test → refused; `cc_sms_center` ok.

## Not verified (needs the Telnyx portal — no Telnyx access from a session)
- 815 must be on a messaging profile that is on campaign **CS3VIAJ**, and that profile's webhook must point at
  `telnyx-hook` (so replies/STOP reach `dialer_sms_hook`). The first "Send test" answers the first half: a Telnyx error
  shows in the feed.
