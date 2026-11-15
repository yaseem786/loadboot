-- bl_dial_0607 — "Phones & live calls": finished voicemail calls stayed on the live board for ever (15 Nov 2026)
--
-- Yaseen 15 Nov (screenshot: nine "incoming · Voicemail" cards with clocks at 150 h … 727 h).
-- Cause: 'voicemail' is BOTH a state while the caller is leaving a message AND the final result of the call
-- (dialer_hook_event keeps status = 'voicemail' on hangup and sets ended_at). cc_dialer_overview listed as "live"
-- every call with status in ('dialing','ringing','active','voicemail') and never looked at ended_at, so each
-- voicemail ever left sat on the board with its clock running. It showed up now because Riley stopped answering
-- (Retell balance), so far more calls ended in voicemail — but the oldest card was from 16 Oct.
--
-- Fix (anchors replaced in the live definition; aborts if one is missing):
--   1. live = not ended (ended_at is null) AND status in (...).
--   2. the stale sweep also closes a voicemail leg whose hangup webhook never arrived (15 min), keeping the
--      result 'voicemail'; the sweep moves to app_private.dial_stale_sweep() and also runs from cron every
--      10 minutes, so the data is right even when nobody has the page open.
-- No public function added; anon surface unchanged.
-- Rollback: select cron.unschedule('lb-dial-stale-sweep'); replace the two anchors back.

create or replace function app_private.dial_stale_sweep()
returns int language plpgsql security definer set search_path = app_private, public as $$
declare n int;
begin
  update app_private.dialer_calls
     set status = case when status = 'voicemail' then 'voicemail' when answered_at is not null then 'ended' else 'failed' end,
         ended_at = case when status = 'voicemail' then started_at + interval '3 minutes' else now() end,
         hangup_cause = coalesce(hangup_cause, 'stale_sweep'), updated_at = now()
   where ended_at is null
     and (   status in ('dialing','ringing') and started_at < now() - interval '5 minutes'
          or status = 'active' and started_at < now() - interval '4 hours'
          or status = 'voicemail' and started_at < now() - interval '15 minutes');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function app_private.dial_stale_sweep() from public, anon, authenticated;

do $$
declare d text; miss constant text := 'bl_dial_0607: anchor not found in cc_dialer_overview: ';
  a_live constant text := 'where c.status in (''dialing'',''ringing'',''active'',''voicemail'')), ''[]''::jsonb),';
  a_ret  constant text := '  return jsonb_build_object(';
begin
  d := pg_get_functiondef('public.cc_dialer_overview()'::regprocedure);
  if position(a_live in d) = 0 then raise exception '%live', miss; end if;
  if position(a_ret in d) = 0 then raise exception '%return', miss; end if;
  d := replace(d, a_live, 'where c.ended_at is null and c.status in (''dialing'',''ringing'',''active'',''voicemail'')), ''[]''::jsonb),   -- bl_dial_0607: a finished voicemail is not live');
  -- first occurrence only: the sweep runs right before the result is built
  d := overlay(d placing E'  perform app_private.dial_stale_sweep();   -- bl_dial_0607\n' || a_ret from position(a_ret in d) for length(a_ret));
  execute d;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'lb-dial-stale-sweep';
select cron.schedule('lb-dial-stale-sweep', '*/10 * * * *', 'select app_private.dial_stale_sweep()');
