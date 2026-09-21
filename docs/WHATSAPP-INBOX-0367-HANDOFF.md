# WhatsApp inbox (bl_wa_0367 + 0368 + 0369 + 0370) — STAGING, first live message received 21 Sep 2026. Handoff.

Closes `DIALER-GOLIVE-HANDOFF.md` §6 item 5 ("WhatsApp inbox") on **staging only**. **PRODUCTION IS UNTOUCHED.**
Reads with `WHATSAPP-OWNER-STEPS.md` (the WABA facts) and `DIALER-GOLIVE-HANDOFF.md` (the phone line).

## 1. What was built

| Layer | File | State |
|---|---|---|
| DB | `migrations/bl_wa_0367_whatsapp_inbox.sql` | **APPLIED ON STAGING** (snslhvmkjusozgjelghi). 4 tables, 16 functions, 3 templates seeded, `cc_dialer_config_set` patched |
| DB | `migrations/bl_wa_0370_wa_real_payload.sql` | **APPLIED ON STAGING 21 Sep, after the first REAL inbound message.** Rewrites `wa_hook`'s reading of the payload to Telnyx's actual shape (see §3). The first message had arrived with an empty body because 0367 was guessing; replayed through the fixed function it stored "hey" correctly |
| DB | `migrations/bl_wa_0369_wa_carrier_only.sql` | **APPLIED ON STAGING 21 Sep.** The final rule (decision 1): dispatchers get carrier + driver conversations only; brokers, shippers and unknown numbers are Command Center's. Replaces `wa_route`, `wa_can_take`, `wa_lock_reason`, `wa_inbox`, `wa_start`. Verified: carrier number → its dispatcher; broker and unknown numbers → `{}` (CC); a dispatcher is refused on any thread without one of his carriers |
| DB | `migrations/bl_wa_0368_wa_routing.sql` | **APPLIED ON STAGING 21 Sep.** Auto-routing + locked claim (see decision 1). Replaces 5 wa_* functions, adds `wa_route` / `wa_can_take` / `wa_lock_reason`. No table changes. Verified on staging: a carrier's number routed to its assigned dispatcher with the push, an unknown number fell to the pool, an unassigned dispatcher was refused by name; test rows deleted |
| Send | `supabase/functions/telnyx-whatsapp/index.ts` | **DEPLOYED ON STAGING v1** (verify_jwt = true) |
| Receive | `supabase/functions/telnyx-hook/index.ts` → **v6** | **DEPLOYED ON STAGING v9** (verify_jwt = false). Routes `message.*` / `whatsapp.*` to `wa_hook` when the event looks like WhatsApp, otherwise to the SMS hook as before |
| Dispatcher UI | `app/shared/dialer-wa.js` (new) + 7 small edits in `app/shared/dialer.js` | **ON DISK, NOT COMMITTED, NOT BROWSER-TESTED** |
| API | `app/shared/api.js` | `waInbox / waThread / waClaim / waStart / waSend / ccWa*` added |
| CC | `app/command-center/views/whatsappLive.js` (new) + nav tab in `app/command-center/app.js` (Team → **WhatsApp**, `/whatsapp`) | **ON DISK, NOT COMMITTED, NOT BROWSER-TESTED** |

Verified with esbuild (`node --check` is not enough — standing rule): `app/shared/dialer.js` and
`app/command-center/app.js` both bundle clean. The one warning (duplicate `back` key in dialer.js's icon map)
was already there.

Nothing was committed or pushed: other sessions have uncommitted work in this repo right now
(`dispatcher-360.js`, `ui/components.js`, `bl_disp_0366`, `bl_dmail_0365`, docs/appstore-screenshots). Only the
files listed above are mine.

## 2. The three decisions the design rests on

1. **WhatsApp is a CARRIER channel for dispatchers; everything else is Command Center's (bl_wa_0369, Yaseen 21 Sep).**
   +1 815 365 1168 is LoadBoot's public number — it goes in e-mail signatures and on the website — so strangers,
   shippers and brokers land on it. On every inbound message `app_private.wa_route()` looks the number up:
   a **carrier's own number, or one of that carrier's drivers** → straight to that carrier's **active** dispatcher,
   with the push; nobody has to take it. **Everything else stays unowned and is answered by Command Center** —
   a dispatcher cannot see it, open it or claim it. A dispatcher may also only **start** a conversation with his
   own carriers and their drivers; anything else is refused with "On WhatsApp you handle your own carriers and
   their drivers. Command Center looks after everyone else."
   Why brokers are deliberately NOT routed (Yaseen, 21 Sep): the same broker is worked by several dispatchers at
   once, so a broker's message cannot honestly be attributed to one of them — and dispatchers are not allowed to
   do broker business on WhatsApp at all. That rule belongs in the Phone Terms at their next version bump.
   A carrier whose dispatcher is not set yet also stays with CC. `cc_wa_assign` is the one override: CC can hand
   any conversation to any dispatcher by name.
2. **Meta's 24-hour window is enforced in Postgres, not in the browser.** Free text only while the other side's
   last message is < 24 h old; outside it only a template whose status is `approved` in `wa_templates`. The dock
   shows the countdown, or the template picker, or an honest "nothing can be sent yet".
3. **Templates are Meta's to approve.** All three (`call_follow_up`, `load_rc_follow_up`, `callback_request`) are
   seeded with status **pending** because that is what WhatsApp Manager shows. CC → WhatsApp → Templates is where
   they are flipped to `approved` once Meta says so. Until then, outside the window nothing goes out — by design.

Carrier WhatsApp **groups stay on the old Business App** (+1 928 393 6198) exactly as decided — this inbox is the
API number only, and it does not touch them.

## 3. What is NOT done / NOT verified (do not assume otherwise)

- **Prod: nothing.** No migration, no function, no frontend.
- **RESOLVED 21 Sep 2026 — the real inbound payload, read off the first live message** (Telnyx documents none of it):
  ```
  data.event_type = "message.received"
  data.payload = { id, to: "+18153651168" (a STRING, not the array SMS uses),
                   from: { phone_number: "+19283936198", carrier, line_type },
                   type: "WHATSAPP" (uppercase), direction: "inbound", messaging_profile_id,
                   body: { id, from, type: "text", text: { body: "hey" },
                           timestamp, foreign_id: "wamid.…" (Meta's own id), from_user_id } }
  ```
  The message text is at **`payload.body.text.body`** — one level deeper than bl_wa_0367 guessed, which is why the
  very first message landed with an empty body. `bl_wa_0370` fixes it, keeps the old guesses as harmless fallbacks,
  and for a non-text message (`body.type` = image / document / audio / location) stores the whole `body` object in
  `wa_messages.media` and reads a caption from `body.<type>.caption`. **Telnyx DOES sign WhatsApp webhooks with the
  same Ed25519 key** — the live event came through `verified = true`. Every raw event is still logged.
- **Still unseen: the OUTBOUND status webhook.** The status branch of `wa_hook` is unchanged guesswork until the
  first reply is sent; check `wa_webhook_log` right after that first send.
- **Whether Telnyx signs WhatsApp webhooks with the same Ed25519 key is unknown.** `telnyx-hook` still refuses
  unsigned requests with 401. If the first test message never appears, set the edge-function secret `WA_CAPTURE=1`
  on staging for a few minutes: an unsigned WhatsApp-looking body is then **logged only** (`verified = false` in
  CC → Last webhook events) and still refused. Unset it afterwards.
- **`/v2/messages/whatsapp` has never been called by us.** `messaging_profile_id` is deliberately NOT sent (not
  documented for that endpoint; `from` routes the message). If Telnyx answers 422, the error text lands in
  `wa_messages.error` and is shown on the bubble.
- **Inbound is PROVEN on staging** (21 Sep, 08:59 UTC: a WhatsApp from +1 928 393 6198 → signed event → conversation
  + message row, correctly left unassigned for Command Center because that number is not a carrier). **Outbound has
  never been sent** — the first reply also tests whether the staging `TELNYX_API_KEY` secret exists at all.
- The CC screen has been used by Yaseen; the dispatcher dock screen has still not been opened in a browser.
- Media in (images, PDFs) is stored as the raw `media` JSON and shown as `[attachment]`. Sending media is not built.
- "Forward to driver" is not an RPC: open the driver's conversation and paste. A one-click forward needs the same
  window/template rules, so it waits until the window behaviour is proven live.
- Routing reads the numbers LoadBoot already holds. A carrier whose owner profile has no phone/WhatsApp, and whose
  drivers have no phone, cannot be recognised — that conversation lands in the open pool like any stranger. Keeping
  carrier and driver phone numbers current in the portal is what makes routing right.
- A carrier is matched by `organizations.kind = 'carrier'`. Brokers and shippers are never routed to a dispatcher
  at all — by decision, not by accident.
- A dispatcher's FIRST message to a carrier still obeys Meta's window: if that carrier has never messaged the
  LoadBoot number, only an approved template can open the conversation — and all three templates are still
  pending at Meta. Until they are approved, the honest way in is to get the carrier to message first (a `wa.me`
  link in the assignment e-mail, the portal, or the signature).
- Telnyx's per-conversation WhatsApp price is still unread. No figure is stored or shown anywhere.
- The Phone Terms (bl_dial_0362) still have no WhatsApp point. `wa_send_prepare` already refuses to send for a
  dispatcher who has not accepted the current version while `terms_required` is on, but the text itself needs a
  WhatsApp line at the next version bump.

## 4. Yaseen's steps, in order (staging)

1. **Telnyx → Messaging → Messaging Profiles → create "LoadBoot WhatsApp"** (a profile of its own — do NOT touch
   "LoadBoot Dispatch", it carries the voice/SMS number and points at PROD).
   - Inbound webhook URL (API v2): `https://snslhvmkjusozgjelghi.supabase.co/functions/v1/telnyx-hook`
   - Assign **+1 815 365 1168** to this profile (the WhatsApp number only).
   - Copy the profile id.
2. **Telnyx → Messaging → WhatsApp** → confirm the number still shows **Connected**, and set the webhook there too
   if that screen offers its own field (Telnyx documents both places; whichever exists, point it at the same URL).
3. **CC → Team → WhatsApp → The line**: paste the messaging profile id (number, WABA id and phone number id are
   already filled on staging), Save, then **Switch sending ON**.
4. **Test inbound first** (it needs no template and no approval): from your own phone's WhatsApp, message
   +1 815 365 1168. Then check, in this order:
   - CC → WhatsApp → **Last webhook events** — is there a row? is `Signed` yes?
   - CC → WhatsApp → **Conversations** — did an *Unassigned* conversation appear with your message?
   - Dispatcher dock → **Texts → WhatsApp** — your own number is not a carrier, so it must NOT appear for a
     dispatcher; it belongs to CC. To test the dispatcher side, message from a number that belongs to one of his
     carriers (the carrier's own profile phone/WhatsApp, or one of its drivers).
   - Tell Claude at once what each of those showed, and paste the newest `wa_webhook_log.payload` if the row is
     there but no conversation appeared — that one payload is what fixes `wa_hook` for good.
5. **Test outbound inside the window**: reply from the dock within 24 h of your inbound message. Watch the bubble
   go Sending… → Sent → Delivered (Read if the other side has read receipts on).
6. **Test the closed window**: `update app_private.wa_threads set last_inbound_at = now() - interval '25 hours'
   where counterparty = '<your number>';` on staging → the composer must be replaced by the template picker, and
   with all three templates still `pending` it must say nothing can be sent. That is the correct answer, not a bug.
7. Once Meta approves the templates: CC → WhatsApp → Templates → set that template to `approved`, then send it from
   the closed-window screen and confirm it arrives with the variables filled in.
8. **Only then prod**: `migrations/bl_wa_0367_whatsapp_inbox.sql` **then `bl_wa_0368_wa_routing.sql`, then `bl_wa_0369_wa_carrier_only.sql`** (in that order) in the prod SQL editor → deploy `telnyx-whatsapp`
   and `telnyx-hook` v6 to prod → set number/ids/profile in CC → switch sending on → repeat step 4 once on prod.
   Order matters: the migration is additive and inert (`wa_enabled` defaults false), so it is safe to apply first.

## 5. Where things live in the database (staging)

- `app_private.wa_threads` — one row per conversation. `owner_user_id` null = unassigned. `last_inbound_at` is the
  only thing that decides the 24-hour window.
- `app_private.wa_messages` — every message, in and out, with `status` (queued → sent → delivered → read, or failed
  with the Telnyx reason in `error`), `kind` (`text` / `template` / `media`), `template_name`, `template_vars`.
- `app_private.wa_templates` — the registry Meta's approval is mirrored into.
- `app_private.wa_webhook_log` — every webhook event, raw, with `verified`.
- `app_private.dialer_config` — `wa_enabled`, `wa_number`, `wa_waba_id`, `wa_phone_number_id`,
  `wa_messaging_profile_id`, `max_wa_per_hour` (120). `wa_capture_until` exists but nothing reads it (reserved);
  the real debug switch is the `WA_CAPTURE` secret.

Rollback at any time: `update app_private.dialer_config set wa_enabled = false;` — the tables stay, inert.

## 6. Templates — LoadBoot now asks Meta instead of guessing (bl_wa_0377, 21 Sep 2026)

Until this migration the portal's idea of "approved" was whatever a staff member had typed into a dropdown after
looking at a Meta screen. That is worth nothing: Telnyx is what refuses the send, and Telnyx goes by Meta's real
answer. So LoadBoot asks.

- **`migrations/bl_wa_0377_wa_template_sync.sql`** (applied on staging). Adds `meta_id`, `meta_template_id`,
  `rejection_reason`, `components`, `example_vars`, `synced_at` to `app_private.wa_templates`; widens the status
  CHECK to Meta's nine real statuses (the old four would have made a sync fail); adds
  `app_private.wa_tpl_vars(text)` (counts `{{n}}`), `public.cc_wa_templates_prep(text)` and
  `public.cc_wa_templates_sync(jsonb, boolean)` — both staff-only.
- **`supabase/functions/telnyx-wa-templates/index.ts`** (v1, deployed on staging, verify_jwt = true).
  `GET /v2/whatsapp/message_templates?filter[waba_id]=…&page[size]=100` with the Telnyx key, paged, then hands the
  rows to `cc_wa_templates_sync` **as the caller** — so a non-staff token gets "staff only" from Postgres and the
  function never decides who is allowed. `{ action: 'submit', name }` sends one drafted template to Meta
  (`POST /v2/whatsapp/message_templates` with `components:[{type:'BODY',text,example:{body_text:[[…]]}}]`).
- **CC → WhatsApp → Templates**: a **Sync from Meta** button, the real status as a pill, Meta's rejection reason
  when there is one, when it was last read, and the variable labels under each body. The hand-set dropdown is
  still there as the override, and now says out loud that the next sync will overwrite it.

What the sync keeps and what it replaces: Meta owns status, category, language, body, rejection reason, the raw
components and the ids. LoadBoot owns `var_labels` and `example_vars` (Meta has no such thing) and those survive.
A template LoadBoot knows about that Meta does not return gets a note saying so rather than silently staying
"approved". Drafts are left alone.

### The fourth template — `dispatcher_assigned` (draft, NOT submitted)

The three live templates all need a load id, so none of them can open a conversation with a carrier who has just
been handed to a dispatcher and has never written to LoadBoot's WhatsApp number. This one can:

> Hi {{1}}, this is {{2}} from LoadBoot Dispatch. I have been assigned as the dispatcher for {{3}}, and this
> number is where you can reach me about your loads, your truck and your paperwork. Reply here whenever you need me.

Utility · en_US · `{{1}}` contact first name, `{{2}}` dispatcher name, `{{3}}` carrier company name.
Examples sent to Meta: Ali / Hamza Khan / Sunrise Carriers LLC. It sits at status `draft`, which `wa_inbox` never
offers to anyone, until somebody presses **Submit to Meta** in Command Center. Meta decides, as always.

Reminder about what templates are actually for: nothing in the inbox waits on them. The moment a carrier or driver
writes to the number, the 24-hour window is open and a dispatcher can reply freely — text, photo, document, voice
note. A template is only needed to speak FIRST, or after 24 hours of silence.

### What the first live sync proved (21 Sep 2026)

Telnyx **found the account** — Meta WABA `1620552536337068` is Telnyx record `9014dd78-fc87-4bed-a2b9-1f6cfa2d10fe`
— and then returned **zero templates**, with the Telnyx id, with the Meta id, and with no filter at all. The three
templates were created in Meta's own WhatsApp Manager on 20 Sep, and Telnyx's template list does not contain them.
Telnyx's documentation does not say either way; this is what the account actually does.

So, until a template exists in Telnyx's own registry:

- **Sync from Meta cannot read its status.** Use the **Override** dropdown for the three existing ones, reading
  the status off WhatsApp Manager by eye — which is exactly what the override is for.
- **Create new templates with Submit to Meta** (the `dispatcher_assigned` button). That goes through Telnyx, so
  Telnyx's registry knows it, the sync reads it from then on, and there is no doubt about the send path.
- **Open question, not yet testable:** whether Telnyx will SEND on a template it does not have in its registry.
  Telnyx resolves a template by name, so it probably reaches Meta fine — but all three are still `pending`, so
  nothing can be sent on them yet and this is unverified. The first approved template will settle it. If a send
  is refused, the fix is to recreate that template through Telnyx under a new name (Meta will not accept the same
  name and language twice).
