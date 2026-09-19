-- bl_ops_0350 — email health: a stale 'claimed' row is a straggler, not a backlog.
-- Bug (19 Sep 2026): 3 outreach rows claimed on 12-13 Sep were never marked, so v_waiting
-- stayed at 3 forever; any quiet 6h window (0 sent) then raised a false
-- "Email delivery has stopped" alarm (fired 14, 16, 17 Sep). Delivery was healthy throughout.
-- Fix: v_waiting counts 'claimed' only while the claim is fresh (< 6h). Queued/scheduled
-- rows still count at any age, so a real stoppage still alarms.
-- Patch-in-place so every later edit to the function is preserved; aborts if no match.
do $mig$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('app_private.cron_email_health'::regproc);
  v_new := regexp_replace(v_def,
    $re$and status in \('queued','scheduled','claimed'\)(\s+)and coalesce\(scheduled_at, created_at\) <= now\(\);$re$,
    $rp$and (status in ('queued','scheduled')\1     or (status = 'claimed' and claimed_at > now() - interval '6 hours'))\1and coalesce(scheduled_at, created_at) <= now();$rp$);
  if v_new = v_def then
    if v_def like '%status = ''claimed'' and claimed_at > now() - interval ''6 hours''%' then
      raise notice 'bl_ops_0350 already applied'; return;
    end if;
    raise exception 'bl_ops_0350: v_waiting pattern not found in cron_email_health';
  end if;
  execute v_new;
end $mig$;
