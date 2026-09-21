# WhatsApp — START HERE (next session)

Written 21 Sep 2026 at the end of the session that built the in-portal WhatsApp inbox.
Everything below is **staging only**. Nothing WhatsApp-related exists on production yet.
Read `docs/WHATSAPP-INBOX-0367-HANDOFF.md` for the long version; this page is what you need to pick the work up.

---

## 1. What LoadBoot is building and why

One WhatsApp Business number for the whole company — **+1 815 365 1168**, display name "LoadBoot LLC",
WABA `1620552536337068`, phone number id `1293822517154161`, limit 250 conversations / 24 h. It is the number
printed on the website and in every e-mail signature, so anyone may write to it.

The point of the build is that the conversation has an **owner** even though the number does not:

- A message from a **carrier's own number, or one of that carrier's drivers**, is routed automatically to that
  carrier's active dispatcher. Nobody has to claim it.
- **Everything else — brokers, shippers, strangers — belongs to Command Center.** Yaseen's reason, in his words:
  the same broker is worked by ten dispatchers at once, so a broker's message cannot be attributed to one of
  them, and dispatchers were never allowed to do broker business on WhatsApp anyway.
- A dispatcher can only start a conversation with his own carriers and their drivers.
- Command Center can hand any conversation to any dispatcher or staff member by name — the one override.

All of that is enforced in **Postgres**, not in the browser.

---

## 2. What is built and working (verified on staging with real messages)

| Piece | Where | State |
|---|---|---|
| Tables, RPCs, seeds | `migrations/bl_wa_0367_whatsapp_inbox.sql` | applied |
| Routing (carrier → his dispatcher) | `bl_wa_0368_wa_routing.sql` | applied |
| Carrier-only rule for dispatchers | `bl_wa_0369_wa_carrier_only.sql` | applied |
| **Real** Telnyx inbound payload | `bl_wa_0370_wa_real_payload.sql` | applied |
| 15-second duplicate-send guard | `bl_wa_0371_wa_no_double_send.sql` | applied |
| Incoming media (photo / voice / PDF) | `bl_wa_0372_wa_media.sql` | applied |
| Assign to staff as well as dispatchers | `bl_wa_0373_wa_assign_staff.sql` | applied |
| Private `wa-media` bucket + RLS | `bl_wa_0374_wa_media_bucket.sql` | applied |
| Outgoing media / voice notes | `bl_wa_0375_wa_send_media.sql` | applied |
| "Your WhatsApp conversations are ready" e-mail | `bl_wa_0376_wa_assigned_email.sql` | applied |
| Template sync + `dispatcher_assigned` draft | `bl_wa_0377_wa_template_sync.sql` (+ `0377a` amendment inside it) | applied |
| **Outbound-media read + bucket lockdown + Chrome voice notes** | `bl_wa_0378_wa_outbound_media_read.sql` | applied |

Edge functions on staging: `telnyx-hook` v6 (routes WhatsApp events to `wa_hook`, Ed25519-verified),
`telnyx-whatsapp` v2 (sends, signs 15-minute links for outgoing files), `telnyx-wa-media` **v2** (streams one
attachment after the DB authorises it — inbound from Telnyx, outbound from our own bucket), `telnyx-wa-templates` **v3** (template sync + submit).

Frontend: `app/shared/dialer-wa.js` (dispatcher dock panel, WhatsApp-style bubbles, day separators, delivery
ticks, attach / record, full-screen), `app/shared/dialer.js` (channel chips + unread badge),
`app/shared/wa-opus.js` (WebM→Ogg Opus remux so Chrome voice notes are accepted, bl_wa_0378),
`app/command-center/views/whatsappLive.js` (the line, KPIs, conversations, thread panel, templates, webhook log,
New conversation, Email dispatcher), `app/shared/api.js` (all calls).

**Proven live:** inbound text, inbound photo / voice note / PDF, outbound text, delivery ticks, auto-routing,
the carrier-only refusal, the assignment e-mail, template submit through Telnyx.

---

## 3. The template situation — read this before touching templates

Meta approves templates; LoadBoot only mirrors their state. A template is needed **only** to speak first, or
after 24 hours of silence. Inside the 24-hour window a dispatcher replies freely (text, photo, document, voice).

**Proven on 21 Sep 2026:** Telnyx keeps its own template registry. It found the account
(Meta WABA `1620552536337068` = Telnyx record `9014dd78-fc87-4bed-a2b9-1f6cfa2d10fe`) but returned **zero**
templates — with the Telnyx id, with the Meta id, and unfiltered. The three original templates were created in
**Meta's own WhatsApp Manager** on 20 Sep and Telnyx does not list them. Telnyx's docs do not say either way;
this is what the account actually does.

Therefore:

| Template | Created via | Status 21 Sep | How its status gets updated |
|---|---|---|---|
| `call_follow_up` | Meta WhatsApp Manager | pending | **Override dropdown**, read off WhatsApp Manager by eye |
| `load_rc_follow_up` | Meta WhatsApp Manager | pending | same |
| `callback_request` | Meta WhatsApp Manager | pending | same |
| `dispatcher_assigned` | **Telnyx** (Submit to Meta button) | pending, Meta template id `2301249754033480` | **Sync from Meta** reads it by itself |

Rule from here on: **create new templates with the Submit to Meta button**, never in WhatsApp Manager — then the
sync can read them and there is no doubt about the send path.

**UNVERIFIED, and the next real question:** will Telnyx SEND on a template it does not hold in its registry?
Telnyx resolves a template by name, so it probably reaches Meta — but all four are still `pending`, so nothing
can be sent on any of them yet. The first approval settles it. If a send is refused, recreate that template
through Telnyx under a **new name** (Meta will not accept the same name and language twice).

---

## 3a. bl_wa_0378 — three faults in the outbound-media path, fixed 21 Sep before anything was sent

The whole outbound chain (browser → private `wa-media` bucket → 15-minute signed link → Telnyx) was read line
by line. Three faults. None of them raised an error; all three would have looked like the feature working.

1. **An outbound attachment could never be opened again.** `wa_media_ref` (bl_wa_0372) reads the file's
   location from `media->:type->'url'` — Telnyx's storage, where an *inbound* file lives. bl_wa_0375 stores an
   outbound file as `media->:type->'path'`, an object in our own bucket; there is no `url`. So every outbound
   photo, voice note and document answered *"That message has no attachment."* — a dispatcher could send a rate
   confirmation and never see it again, and his own bubble read "Photo unavailable". `wa_media_ref` now returns
   either a `url` (inbound) or `bucket` + `path` (outbound) and `telnyx-wa-media` **v2** fetches whichever it is
   handed, with the service role for our own bucket.
2. **Every dispatcher could read every carrier's attachments.** bl_wa_0374's `"wa media read"` policy let ANY
   wa actor `select` ANY object in `wa-media`. The paths are random, but `storage.list()` enumerates them — one
   dispatcher could have listed and downloaded every WhatsApp file LoadBoot ever sent. The browser never reads
   this bucket (it only uploads), so the policy bought nothing; it is now staff-only, and uploads are pinned to
   a thread the uploader may actually write to instead of any path under `wa/`.
3. **No voice note recorded in Chrome could ever have been delivered.** WhatsApp takes `audio/ogg` (Opus),
   `aac`, `mp4`, `mpeg`, `amr`. It does **not** take `audio/webm`, and webm is all Chrome's MediaRecorder can
   produce — `isTypeSupported('audio/ogg;codecs=opus')` is false there. `app/shared/wa-opus.js` lifts the Opus
   packets out of the WebM blocks and writes them into an Ogg container: no decode, no resample, a few
   milliseconds. It fails by returning `null`, in which case the original blob goes out exactly as before —
   a bug in the remuxer can only cost the improvement, never the feature. Firefox and Safari are untouched.
   Tested with ffmpeg, not assumed: mono 3.7 s and stereo 62 s (long enough to cross the 255-segment page
   boundary) remuxed and read back with ffprobe — ogg/opus, right channels, right duration — and the decoded
   PCM is byte-identical to the source over the common region (~13 ms more leading audio, WebM CodecDelay is
   not applied).

Staging state after this: `bl_wa_0378` applied, `telnyx-wa-media` at **v2**, anon-executable SECURITY DEFINER
surface in `public` still reads **32**.

---

## 4. What is still untested

- **Outbound media and voice notes from the portal.** Everything above is code that has been read and, for the
  remuxer, tested offline — but **no outbound media row has ever been created** and nothing has gone through
  Telnyx. That is still the first test to run.
- **The dispatcher dock in a real browser.** Command Center has been exercised; the dock panel has not.
- **A template send.** Blocked until Meta approves something.
- **Production.** Nothing has been applied or deployed there.

---

## 5. How to run it locally

```
set LOADBOOT_STAGING_ANON_KEY=<staging anon key>        REM Supabase -> snslhvmkjusozgjelghi -> API
python build_site.py                                    REM look for "BUILD OK"
python -m http.server 8080 --directory C:\Users\HP\Documents\GitHub\loadboot\site
```

Then `localhost:8080/app/command-center/` → Team → WhatsApp. After any change: rebuild, then **Ctrl+Shift+R**
(the carrier portal is a PWA — a stale service worker is the usual reason a change "did not appear").

Diagnosis aids: every webhook event is kept raw in `app_private.wa_webhook_log` and shown in CC under
"Last webhook events"; `verified: false` there means the request was **not** signed with LoadBoot's Telnyx key
and was logged only, never acted on. The template sync prints `[wa templates probe]` to the browser console with
every Telnyx call it tried and how many rows came back.

---

## 6. Next steps, in order

1. **Send a file and a voice note** from the dispatcher dock and from CC, inside an open 24-hour window. Confirm
   the row, the bubble, the tick, **that your own bubble can re-open the file** (that is the bl_wa_0378 fix), and
   that the recipient actually receives it. For the voice note, check the phone shows a playable voice message —
   if it arrives as an unplayable file, the Ogg remux is the place to look, and the console will have no error
   because the fallback is silent by design. This is the last unproven engine.
2. **Test the dock** (Texts → WhatsApp) as a dispatcher whose carrier has written in. A number that is not a
   carrier must NOT appear for him — that is correct behaviour, not a bug.
3. When Meta answers: press **Sync from Meta** for `dispatcher_assigned`; use **Override** for the other three.
   Then send one template into a closed window and watch what Telnyx does with a Meta-Manager template.
4. **Only then production**, in this order: apply `bl_wa_0367` → `0368` → `0369` → `0370` → `0371` → `0372` →
   `0373` → `0374` → `0375` → `0376` → `0377` → `0378` in the prod SQL editor; deploy `telnyx-hook`, `telnyx-whatsapp`,
   `telnyx-wa-media`, `telnyx-wa-templates`; set the number and ids in CC → The line; switch sending on; repeat
   one inbound and one outbound test on prod.
   The migrations are additive and inert — `wa_enabled` defaults to false, so applying them changes nothing until
   the switch is thrown. Rollback at any moment: `update app_private.dialer_config set wa_enabled = false;`

## 7. Standing rules that bit us this session

- **Never test on production.** Staging is `snslhvmkjusozgjelghi`, production is `rwscphuhpjoudvljvmdk`.
- **Verify JS with esbuild, not `node --check`.**
- **Edit large files with bash/python**, not the Write tool.
- **Never invent data.** When the first inbound message stored an empty body, the fix was to read the raw logged
  payload and rewrite `wa_hook` around it — not to guess a shape and not to type the message in by hand.
- An edge function should return **200 `{ error: "..." }`** for a refusal it wrote itself. supabase-js turns any
  non-2xx into its own generic error and the real sentence never reaches the screen — that cost a round trip here.

---

## 8. 21 Sep, later that day — what was PROVEN in the database, and bl_wa_0379

The outbound-media path was still listed above as "code that has been read". The database half of it has
now been **executed** on staging, inside a transaction that was rolled back, so nothing was sent, no row
survived and no object was written (`wa_messages` still 7, `queued` 0, `wa-media` objects 0):

| What was run as the thread's owning dispatcher | Result |
|---|---|
| `wa_send_prepare` with a voice note (`audio/ogg`, `voice: true`) | `ok`, queued row written, payload `{"type":"audio","audio":{}}` for the edge function to fill with the signed link |
| `wa_media_ref` on that new outbound row | `{ok, bucket: "wa-media", path: "wa/<thread>/…", mime, kind}` — **the bl_wa_0378 fault is really fixed**; before it, this answered "That message has no attachment." |
| `wa_media_ref` on the same row as a different user | `{"error":"Not allowed."}` |
| `wa_can_write_object` — own thread / another thread / a hand-made path | `true` / `false` / `false` (the bl_wa_0378 bucket lockdown) |

The browser builds the upload path as `wa/<thread_id>/<uuid>.<ext>` (`api.js` → `waUploadMedia`), which is
exactly the two-segment shape `wa_can_write_object` accepts — checked, not assumed.

**What is still unproven is only the last hop:** Telnyx fetching the 15-minute signed link, and the phone
rendering the Ogg as a playable voice message. Nothing in LoadBoot can prove that; it needs one real send.

### bl_wa_0379 — the double-send guard now covers attachments

Found while reading the same path: bl_wa_0371's 15-second guard begins `if md is null`, so it never applied
to a file. It compares message bodies and a voice note has none — so a dispatcher who tapped Send twice, or
whose browser retried, sent the same photo twice. A file's identity is its uploaded object path, which the
browser mints fresh (`crypto.randomUUID`) for every upload, so a genuinely different file is never refused.

`migrations/bl_wa_0379_wa_media_no_double_send.sql` — **applied on staging**, verified in a rolled-back
transaction: same path twice → *"That file just went out a moment ago."*, a different file → accepted.
Add it to the end of the production apply order in §6.

### The three-minute test to run tomorrow (in this order)

1. Dispatcher dock → Texts → WhatsApp → the open thread → **attach a photo with a caption**. Expect: bubble,
   tick, and **tap your own bubble — the photo must open** (that is the bl_wa_0378 fix; before it this said
   "Photo unavailable").
2. Tap Send on the same photo twice quickly → the second must be refused with *"That file just went out a
   moment ago."* (bl_wa_0379).
3. **Record a voice note in Chrome** and send it. On the phone it must appear as a playable voice message,
   not a file. If it arrives unplayable, the Ogg remux (`app/shared/wa-opus.js`) is the place to look — the
   console will show no error, because the fallback to the original webm is silent by design.
4. Repeat 1 and 3 from Command Center → Team → WhatsApp.
5. Send a **PDF**: the filename must survive to the phone.

If any of these fails at Telnyx rather than in the browser, the reason is on the bubble — `wa_messages.error` —
and the raw event is in `app_private.wa_webhook_log`.
