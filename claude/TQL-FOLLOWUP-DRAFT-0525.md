# TQL follow-up — draft, NOT sent (1 Oct 2026)

**Status:** waiting on the owner's yes. Nothing has gone out from this file.

## What has already happened (1 Oct, prod)

| When (UTC) | What | Result |
|---|---|---|
| 12:05 | `welcome.broker` → iclark@tql.com | delivered, not opened |
| 15:19 | `onboarding.broker_next_steps` ("TQL is cleared … your next step: sign the Master Broker Agreement"), idempotency `broker-next-steps:0f2b9548-…:agreement` | delivered, not opened |
| 18:39 | Riley call 399 → 513-495-6760 (FMCSA phone) | Brad's personal mailbox |
| 19:07 | Riley call 407 → (800) 580-3101 | menu, Retell hung up (`ivr_reached`) |
| 19:49 | Riley call 412 → (800) 580-3101 | 8 min of menus and hold, no person |

Two emails and three calls to one broker contact in one day is already a lot. **Recommendation:** no more Riley calls to TQL, and send the note below **Monday 5 Oct** only if the agreement is still unsigned. It is short and personal, a reply-style nudge, not a second full checklist.

## Gate (checked 1 Oct, prod)

`app_private.email_gate('onboarding.broker_next_steps', 'iclark@tql.com', null)` → `allowed: true`, code `ok`, group
`compliance` ("Documents & compliance emails are on for this address"). No opt-out in any group.
**Re-run `select public.cc_email_can_send('iclark@tql.com', 'onboarding.broker_next_steps')` (CC → Unsubscribes →
"Can I send this?") on the day of sending.** If `allowed` is false, do not send.

## Draft

- **Key:** `onboarding.broker_next_steps` (catalog row is live, hand-sent; no new key)
- **Idempotency:** `broker-next-steps:0f2b9548-653f-4dd4-ba83-95eb39f876b4:agreement-nudge`
- **To:** Isaac Clark <iclark@tql.com>

**Subject:** Isaac, one signature left for TQL on LoadBoot

> Hi Isaac,
>
> Quick one. TQL's account is verified on our side (authority, BMC-84 and BOC-3 all confirmed on FMCSA), so the only
> thing between you and your first posted load is the Master Broker Agreement.
>
> It's in the portal under Onboarding → Signed Broker Agreement, about a minute to read and sign:
> https://loadboot.com/app/partner/#onboarding
>
> If someone else at TQL handles carrier-platform agreements, just tell me who and I'll send it their way instead.
>
> {{contact_inline}}
>
> — Muhammad Yaseen, LoadBoot

Notes:
- `{{contact_inline}}` is filled at send time by `app_private.contact_expand` (one number, +1 (815) 365-1168 / WhatsApp,
  CLAUDE.md §7). No 253-7575 anywhere in the draft.
- The "who handles this" line gives Isaac an easy reply if he is the wrong person, which three calls could not find out.
- Signed by the owner by name. Change it to "The LoadBoot team" if you would rather not sign it yourself.
