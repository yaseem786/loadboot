# Retell — Change 1 only (call webhook), step by step

This is the safe one. It cannot break anything, because the new endpoint runs in OBSERVE mode: it forwards
every delivery whether or not the signature checks out, and just records the verdict.

## What you are changing

The URL Retell calls **after a call ends** — the one that produces the transcript, the recording link and the
lead in CRM.

New URL:

```
https://rwscphuhpjoudvljvmdk.supabase.co/functions/v1/retell-hook
```

## Steps

1. Log in to the Retell dashboard.
2. Open **Agents** → **Riley Inbound**. (Start with this one agent only.)
3. Find the **Webhook URL** field in the agent's settings.
4. **Copy the existing value somewhere safe first.** That is your undo.
5. Paste the new URL. Save.

That is the whole change.

## What should happen

Nothing visible. Calls end as before, transcripts appear as before, leads appear as before.

## How we confirm

After a real call (or call the number yourself and hang up), run:

```sql
select at, verified, reason, forwarded, event
from app_private.retell_hook_log
order by at desc limit 20;
```

- `verified = true`, `reason = 'signature_ok'` → the signature format is confirmed against real traffic. Good.
- `verified = false` → **nothing broke**; the message still went through. It only means Retell's signature does
  not match what the docs describe, which is exactly what observe mode exists to find out.

## If anything looks wrong

Put the old URL back. The old route was never disabled.

## Afterwards

Once this looks right, repeat the same field change on the other three agents: **Riley Outbound**,
**Riley Broker Outbound**, **LoadBoot Verify**. If your dashboard has an account- or workspace-level webhook
setting, changing that one place covers all four instead.
