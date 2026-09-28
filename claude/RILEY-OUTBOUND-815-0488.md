# bl_voice_0488 — One main line: Riley calls out from +1 (815) 365-1168

Written 28 Sep 2026. Migration `migrations/bl_voice_0488_riley_outbound_815.sql`, CC card in
`app/command-center/views/riley.js` (Riley → Settings → "Outbound caller id"), edge `retell-admin` (status op).

## What the code does
- `app_private.retell_config.outbound_from_number` (NULL = old behaviour, everything from the Riley number 469).
- `app_private.retell_out_from()` = the one place that picks the caller id. `retell_dial` + `retell_dial_verify` dial from
  it and write the number actually used onto `lc_calls.from_number`.
- `retell_webhook` accepts calls on 469 **or** 815; anything else still ignored (NULL-safe, tested).
- CC card: type the number → Save (asks first) → the card reads Retell live (`get-phone-number/815`) and shows
  **✓ in Retell** or a red warning. **Test call** rings a staff mobile through the normal `cc_retell_callback` path.
  **Clear** = back to 469 instantly (rollback).
- Inbound is untouched: 815 stays on the Telnyx Call Control app (dialer → dispatcher → Riley). A carrier who calls
  815 back gets the same chain as today.

## Owner steps — in this order (docs read 28 Sep: docs.retellai.com/deploy/telnyx, api-references/import-phone-number)
**Telnyx (Mission Control)**
1. Outbound Voice Profiles → new profile "Retell outbound", allow USA/Canada.
2. Voice → SIP Trunking → create: type **FQDN**, name "Retell outbound (815)". FQDN `sip.retellai.com`, DNS type **SRV**.
3. Authentication → **Credentials** → pick a username + password (you type these; do not paste them in chat).
4. Inbound settings (Retell's guide): number format **+E.164**, codecs **G722, G711U, G711A**, transport **TCP**.
5. Outbound settings → select the "Retell outbound" profile.
6. **SKIP Retell's Step 2 ("move numbers to the trunk").** 815 stays on its current Call Control app — moving it would
   send every inbound 815 call (and WhatsApp calls) straight to Retell and break the dispatcher chain.

**Retell dashboard**
7. Phone Numbers → + → Import (SIP trunking): number `+18153651168`, termination URI **`sip.telnyx.com`**, SIP username +
   password from step 3, extra SIP header **`X-Telnyx-Username: <the username>`** (Telnyx requires it on outbound),
   nickname "LoadBoot main 815 (outbound)", inbound agent **none**, outbound agent Riley Outbound.

**CC**
8. CC → Riley → Settings → "Outbound caller id" → `+1 815 365 1168` → Save → the pill must turn green "✓ in Retell".
9. Test call to your own mobile → the screen must show (815) 365-1168. Then call 815 back → the normal chain answers.
10. If anything fails: **Clear** → Riley calls from 469 again, nothing else changes.

## Verified vs guessed
- Verified (Retell docs): `create-phone-call` `from_number` "must be a number purchased from Retell or imported to Retell";
  otherwise 422. Import API: `phone_number` + `termination_uri` required; `sip_trunk_auth_username/password`, `nickname`,
  `inbound_agents` (nullable), `outbound_agents`, `transport` optional. Webhook carries `from_number`, `to_number`, `direction`.
- Verified (Telnyx caller-ID policy): outbound caller id only has to be a valid number format (+E.164); the policy states
  no rule that it must be assigned to the calling connection. International spoofing is refused (we only call US).
- **Guessed / not in the docs:** (a) that Retell is fine with an imported number that never receives inbound — the field is
  nullable, the behaviour is not described; (b) STIR/SHAKEN attestation should be "A" because 815 is on our Telnyx account;
  (c) whether Retell bills less per minute for imported numbers (not published). The test call in step 9 settles (a)+(b).
- `retell_dial` is fire-and-forget (pg_net). If 815 is saved but not imported, dials fail silently and rows stay
  `dialing` — that is why the CC card checks Retell and the test call comes before any carrier call.

## Tests (staging, all inside rolled-back blocks)
NULL outbound + unrelated numbers → ignored · 815 without `direction` → accepted as outbound · 469 inbound → accepted ·
`retell_dial` body + row carry 815 · `retell_dial_verify` body + row carry 815 · settings: "12345" refused, "(815) 365-1168"
→ `+18153651168`, escalation number refused, "" clears (effective = Riley number). anon SECDEF 35 staging, names unchanged;
`retell_out_from` not executable by anon/authenticated.
