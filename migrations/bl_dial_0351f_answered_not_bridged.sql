-- bl_dial_0351f — live test finding: Telnyx sends call.bridged while the far end is still RINGING (early media), ~15 s before
-- call.answered. Treating bridged as answered (a) stamped answered_at too early (an unanswered call showed talk time) and
-- (b) fired record_start before the call was answered → 422 "Call not answered yet", so nothing was recorded.
-- Only call.answered now marks the call active and starts the recording. Patches 0351's hook in place (idempotent). STAGING first.
do $$
declare s text;
begin
  s := pg_get_functiondef('public.dialer_hook_event(jsonb,boolean)'::regprocedure);
  if position($o$ev in ('call.answered','call.bridged')$o$ in s) > 0 then
    s := replace(s, $o$ev in ('call.answered','call.bridged')$o$, $n$ev = 'call.answered'$n$);
    execute s;
  end if;
end $$;
