# Carrier emails + SMS (bl_dial_0550) — staging + prod 14 Oct 2026

Owner plan (14 Oct hand-off): carrier emails can carry a text. One switch + one text per Email-catalog row.

## How it works
- `email_catalog.sms_enabled` + `sms_text` (+ `sms_updated_at/by`). CC → Email catalog → a row → **📱 Text message too**:
  On/Off, text editor, live "what the carrier gets" bubble with SMS count, last 20 texts for that email with the reason.
  RPCs `cc_email_sms(key)` (comm.view) and `cc_email_sms_set(key, enabled, text, dry)` (`can_manage_comms`).
- `app_private.sys_email`: after the email row is really inserted (`found`) and the catalog row is `live` (not Test/Off),
  `email_sms_note()` queues ONE row on `doc_sms_queue` (`kind='email'`, `status='pending'`, `catalog_key`, `user_id`, `idem`).
  So a text only goes where the email itself passed every gate (suppression, preference group, unsubscribe).
  Own exception block — a texting problem never stops an email. While **Email texts** is off nothing is queued.
- `doc_sms_queue` is the general SMS queue: same `doc-sms-worker`, same claim, same CC feed. `doc_sms_sweep` calls
  `email_sms_sweep()` every minute before it pings the worker.
- Number: the recipient's own phone if it has live `sms_consent`, else the carrier's consented owner/admin. Same key to the
  same number within 6 h = one text (email to two admins → one SMS). Demo orgs never get one.
- Gates (first failing one is the reason in CC): Email texts switch · master SMS switch · catalog row still on and allowed ·
  consent · STOP · `dial_blocked` · test mode (`allow_all=false` → only test numbers) · sending number · docs reminder
  skipped if a document-decision text went that day · quiet hours 8 am–9 pm carrier tz (held to 9:00) · daily cap.
- **Daily cap is now shared by ALL texts to a carrier** (`doc_sms_config.max_per_day`, default 3). `account_critical`
  texts (pause, violation, authority, dispatcher assigned/changed/unreachable, confirm email) are never held back by it
  but still count.
- Never for marketing/outreach: `email_sms_allowed()` refuses class M/P, groups marketing/newsletter/
  product_announcements/digests, and any audience without `carrier`. Checked in the setter, the note, the sweep and the claim.
- Text rules (`email_sms_text_problem`): plain GSM characters only, no Riley number, no `{{tokens}}`, ≤ 2 SMS with
  "LoadBoot: " + " Reply STOP to opt out.".

## State left on prod
- 16 starter rows on (`sms_enabled=true` with a text): dispatcher.assigned.carrier, dispatcher.changed.carrier,
  dispatcher.carrier.unreachable, account.pause, account.violation, authority_lapsed, carrier.reminder.* (10).
- `doc_sms_config.email_enabled = false` → **nothing is texted** until the owner turns on step 5 "Email texts" in
  CC → Text messages. Real carriers only after step 6 "Every carrier" (`allow_all`, needs a delivered test text).
- anon SECDEF: prod 36 / staging 35, names md5 unchanged.

## Staging proof (one transaction, rolled back)
email → message_deliveries row + pending SMS row to the consented number · same key again → deduped · same idem → no
second row · catalog Test mode → no SMS · sweep → ready, preview built · claim → item from +18153651168 · Email texts off →
skipped with reason · STOP → skipped "This number replied STOP." · M/marketing and dispatcher-audience refused · Riley
number and emoji refused.

## Known
- First text to a number is 4 SMS while `sms_first_msg_suffix` has the "—" (UCS-2). CC → Text messages → Main line → "Fix it".
- An email that is bounced/suppressed gets no text either (the text rides with the email).
- UI (emailCatalog.js, smsCenter.js) was syntax-checked only, not rendered in a browser.
