# Retell dashboard — the two URL changes (for Yaseen)

Everything on our side is already live on production and tested. Nothing is switched on yet, so **right now
both the old and the new routes work**. That is deliberate: it means you can make these changes at any time,
and if anything looks wrong you just put the old URL back.

Set aside about five minutes. Do them one at a time, not both at once.

---

## Before you start — the two new addresses

```
Call webhook (after a call ends):
https://rwscphuhpjoudvljvmdk.supabase.co/functions/v1/retell-hook

Inbound-call webhook (before the agent speaks):
https://rwscphuhpjoudvljvmdk.supabase.co/functions/v1/retell-inbound-hook
```

Write down whatever URL is in each box **before** you change it. That is your undo.

---

## Change 1 — the call webhook (the safer one, do this first)

1. Log in to the Retell dashboard.
2. Find the agent's settings, and the **Webhook URL** field (the one that fires when a call ends).
3. Copy the existing value somewhere safe.
4. Replace it with the `retell-hook` URL above. Save.

**What should happen:** nothing visible. Calls carry on ending, transcripts and leads carry on appearing in CC
and CRM exactly as before. The only difference is that we now record, for each delivery, whether Retell's
signature checked out.

**How we confirm it worked:** after a real call, run this and look at the newest rows —

```sql
select at, verified, reason, forwarded, event
from app_private.retell_hook_log
order by at desc limit 20;
```

We want to see `verified = true` and `reason = 'signature_ok'`. If we see that on real traffic for a day or so,
the signature format is confirmed against reality and we can close the old door.

---

## Change 2 — the inbound-call webhook (the one that matters most)

1. In the Retell dashboard, go to the **phone number** settings — not the agent.
2. Find the **inbound call webhook** field (the one that supplies the caller's details before the agent speaks).
3. Copy the existing value somewhere safe.
4. Replace it with the `retell-inbound-hook` URL above. Save.

**What should happen:** nothing visible. Call your own number. The agent should greet you exactly as it does
today — by name if you are in the system, as a new caller if not.

**If the greeting suddenly becomes generic** — everyone is "there", nobody is recognised — that means the new
route is not verifying. Put the old URL back and tell me. Nothing is lost; the old route still works.

**How we confirm it worked:** the same query as above. Look for rows with `event = 'call_inbound'` and
`verified = true`.

---

## What I will do afterwards, and only with your say-so

Once real deliveries are verifying on both, I close the two old doors — separately, so we can stop after either:

1. `update app_private.retell_config set allow_unsigned_webhook = false;`
   Closes the old call-webhook door. One line to undo.
2. Remove the public access from `public.retell_inbound`.
   Closes the identity lookup — the one where anyone could type in a phone number and get back a person's name,
   company, MC, DOT and equipment. This is the real prize.

Both have a full rollback ready:
`select app_private.bl_sec_0329_rollback();` and `select app_private.bl_sec_0330_rollback();`

---

## If something goes wrong at any point

Put the old URL back in the Retell dashboard. That is the whole recovery — the old routes are still live and
still work, and nothing on our side has been taken away yet. Then tell me what you saw.
