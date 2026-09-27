# WhatsApp call alerts to dispatchers — bl_dial_0487 (27 Sep 2026)

Every dispatcher who has a LoadBoot line gets a WhatsApp message for inbound calls — India / Pakistan /
Philippines included (the "ring my mobile" forward is US/Canada only, bl_dial_0351e).

| Moment | Template (UTILITY) | When |
|---|---|---|
| Call rings | `dispatcher_call_incoming` (2 vars: caller, number) | only while the dispatcher is NOT in the portal (line not seen 3 min). `dialer_config.wa_call_alerts = 'always'` → every call |
| Call missed | `dispatcher_call_missed` (3 vars: caller, number, what happened) | every unanswered call. If Riley took it, waits up to 6 min after hang-up for her summary (`lc_calls.summary`); a trigger on `lc_calls` sends it the moment the summary lands |

Switch: `dialer_config.wa_call_alerts` = `offline` (default) / `always` / `off`. SQL only for now (no CC toggle).

## Status on prod (27 Sep 2026)
- Migration applied to staging + prod. Anon SECURITY DEFINER surface unchanged (prod 36, staging 35; names md5 same).
- **Both templates are DRAFT → nothing is sent yet.** Owner: CC → WhatsApp → Templates → Submit each one.
  Rows are only queued once Meta approves (no backlog piles up while they wait).
- All 3 current line holders (Pakistan, India, US) resolve to a WhatsApp number from their profile.

## Number
`dispatcher_profiles.wa_alert_number` (the dispatcher sets it in the dock → Settings → "WhatsApp call alerts")
or else the profile phone + profile country (`app_private.wa_staff_e164`). A bare number is never assumed to be
+1 for a non-US dispatcher. `wa_alert_off` = the dispatcher switched it off. Blocked dispatchers never get one.

## Plumbing
`dialer_hook_event` (same condition as the web-push `notify`) → `app_private.wa_call_alert` → `wa_auto_outbox`
(`call_id`, event `call_ring`/`call_missed`, unique per call) → `wa-auto-worker` → `svc_wa_auto_claim`, which asks
`app_private.wa_call_alert_ready` for the vars (or wait / skip). Ring alert older than 2 min, or the call answered /
ended first = skipped. Missed alert older than 2 h = skipped. The dispatcher's own thread is created CLOSED and
owned by them, so it does not sit in the staff inbox.

## Bug fixed on the way
`dialer_hook_event` read `v_rd.carrier_name` for a call dialled straight to a dispatcher's own number, but `v_rd`
was only filled on the WhatsApp-line path (bl_voice_0458b). Such a call raised `record "v_rd" is not assigned yet`
and the webhook failed. Prod had no such call since 0458b. Fixed in section 7a0 of the migration.

## Test (staging, rolled back)
Offline dispatcher: ring → `dispatcher_call_incoming` to +91…, closed thread owned by the dispatcher. Riley took
the call → missed row waits 45 s → lc_calls summary insert kicks it → `dispatcher_call_missed` with the summary
(newlines flattened). Duplicate hang-up = no second row. Online dispatcher = no ring row. `always` + answered before
claim = skipped.
