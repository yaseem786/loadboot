-- bl_dial_0351g — live test finding #2: the dispatcher's browser mirrors call state (dialer_call_update) and usually marks
-- the call 'active' a moment BEFORE Telnyx's call.answered webhook lands, so the hook's "status in (dialing, ringing)" guard
-- skipped record_start and nothing was recorded. The guard is now "recording not requested yet" (rec_requested), so the
-- recording starts exactly once on call.answered whichever side reported the answer first. Patches the hook in place. STAGING first.
alter table app_private.dialer_calls add column if not exists rec_requested boolean not null default false;

do $$
declare s text;
begin
  s := pg_get_functiondef('public.dialer_hook_event(jsonb,boolean)'::regprocedure);
  if position('rec_requested' in s) = 0 then
    if position($o$    elsif c.status in ('dialing','ringing') and (c.direction = 'outbound' or v_leg = 'b') then
      update app_private.dialer_calls set status = 'active', answered_at = coalesce(answered_at, now()), updated_at = now() where id = c.id;$o$ in s) = 0 then
      raise exception 'bl_dial_0351g: expected text not found in hook/answered'; end if;
    s := replace(s, $o$    elsif c.status in ('dialing','ringing') and (c.direction = 'outbound' or v_leg = 'b') then
      update app_private.dialer_calls set status = 'active', answered_at = coalesce(answered_at, now()), updated_at = now() where id = c.id;$o$,
$n$    elsif c.status in ('dialing','ringing','active') and not c.rec_requested and (c.direction = 'outbound' or v_leg = 'b') then
      update app_private.dialer_calls set status = 'active', answered_at = coalesce(answered_at, now()), rec_requested = true, updated_at = now() where id = c.id;$n$);
    execute s;
  end if;
end $$;
