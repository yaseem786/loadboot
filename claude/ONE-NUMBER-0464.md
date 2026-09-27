# ONE number — Call or WhatsApp · +1 (815) 365-1168 (bl_comm_0464, 26 Sep 2026)

## Why
Since `bl_voice_0458` the Telnyx WhatsApp line **+1 (815) 365-1168** forwards calls to Riley. So the WhatsApp number
IS the phone number. But the site, the email footers and the live-chat bot still showed the Retell caller id
**+1 (469) 253-7575** as "call us" beside 815 as "WhatsApp us". Two numbers, one desk — carriers asked which to use.

Owner decision (26 Sep): one number, one sign, everywhere, the same words and the same icons:

    📞💬 Call or WhatsApp · +1 (815) 365-1168        (+ "Open WhatsApp →" where there is room)

The 469 number is now Riley's **caller id only** (outbound callbacks still dial from it until 815 is imported into
Retell over SIP — see `docs/voice-agent/RILEY-0458.md`, known gaps) and the SMS number (START/STOP copy on
`sms.html`, `sms_consent_set_self` — CLAUDE.md §7 exception). It is shown nowhere else.

## What changed

### Database — `migrations/bl_comm_0464_one_number.sql` (staging + prod)
- `app_private.contact_channel` row 1: `channel='both'`, phone = 815 (was 469), labels "Call or WhatsApp".
- `public.lb_contact_channel()` (anon; on the 36-name baseline, ACL unchanged) adds `same: true` and
  `one: {display, tel, url, label, text}` — the sign as data. Older readers of `channel/phone/whatsapp` keep working.
- `app_private.contact_inline` / `contact_sig` (the `{{contact_inline}}` / `{{contact_sig}}` tokens in every SQL-built
  email, expanded by `sys_email` and `outreach_prepare`): when `same`, one line —
  `call or WhatsApp us on 📞💬 +1 (815) 365-1168 · Open WhatsApp →`.
- `app_private.lc_phone_display()` — what the live-chat bot (`lc_bot_answer_l*`, `lc_bot_step*`, `lc_do_handoff`),
  `outreach_call_band` and `public.support_phone()` quote — now returns the contact-channel phone when the channel is
  phone/both; the `retell_config.from_number` formula is only the whatsapp-only fallback. `from_number` itself is untouched.
- Self-check DO block: `same` must be true, all four renderers must carry 815 and never 469, anon grant intact.

### delivery-worker v21 (every Resend email)
Phone number comes from the switch (`lb_contact_channel().phone`) when the channel is phone/both, never from
`support_phone()`; when `same` the band is one line: *"📞💬 Rather just talk or message? **Call or WhatsApp** us 24/7
on +1 (815) 365-1168 · Open WhatsApp → · or have us call you →"*. Plain-text mirror in `callLine`.

### Marketing site — `build_site.py`
- `PHONE_DISP/PHONE_TEL`, `VOICE_NUMBER_*`, the topbar, mobile nav, footer, pricing/FAQ strip, contact page,
  hub CTA, schema.org `telephone` — all 815. Header: `📞💬 Call or WhatsApp  +1 (815) 365-1168`; footer:
  `📞💬 +1 (815) 365-1168 · Call or WhatsApp` + `💬 Open WhatsApp →`; mobile nav gets the same pair.
- `_contact_header` has a one-number mode (`_CONTACT_ONE`, from `lb_contact_channel().same`): every
  `data-lb-contact` link is rewritten to the sign with a `tel:` href, footer + nav get the "Open WhatsApp" link,
  `data-lb-callonly` ("or we call you") stays visible because the line takes calls, `data-lb-waonly` cards are
  revealed. The strict build guard (no 469 in header/footer) now applies in this mode too.
- Runtime switch script: a `same` branch first, idempotent with the static build (`data-lb-one`, `data-lb-wa-added`).
- `_CONTACT_FALLBACK` (offline builds) is the one-number shape.
- Contact page lead: "Call or WhatsApp +1 (815) 365-1168 any hour — Riley, our AI assistant, picks up instantly".

### Everything else that named a number
`lc-brain` FACTS line (the chat brain now says "ONE number for calls and WhatsApp… never quote any other phone number"),
`liveChatCore.js` footer, carrier app "Call or WhatsApp dispatch" button, ELD-connect help line, privacy + terms
pages, CC → Settings contact toggle (shows `📞💬 Call or WhatsApp · +1 (815) 365-1168` when `same`).

### Signatures — `dispatch/signatures/`
`hello-signature.html` (Muhammad Yaseen, hello@) and `dispatch-signature.html` (Dispatch Desk, dispatch@). Quiet,
large-company style: name, title, thin rule, logo, one accent bar, a "CALL OR WHATSAPP" pill + the number + "Open
WhatsApp →", email, web, small grey legal line. `README.md` has the Gmail/Outlook paste steps; `preview.html` shows both.
`dispatch/loadboot-signature.html` (the old 469 one) now carries the dispatch signature.

## How to check
- `select public.lb_contact_channel()->'one'` → the sign. `select app_private.contact_inline(true)` → the text line.
- Netlify deploy log: `contact channel: both (live), header ships ONE number (call or WhatsApp) +1 (815) 365-1168`.
- Any email from the queue: one contact line above the footer, 815, "Open WhatsApp →".
- `grep -rn "253-7575" build_site.py …` should hit only the build guard and `sms_module.py`.

## Flip it back
CC → Settings → contact channel → WhatsApp (or Call). The renderers, the worker and the site all follow the switch;
"Call" alone would show 815 as a plain phone line. To restore the 469 phone line: update `contact_channel` phone
columns and set the channel — no code change.
