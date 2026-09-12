-- bl_disp_0309 — hardening pass over the skills test before the first candidate was sent one.
--
-- BACKEND. Two concurrent dispatcher_test_start() calls could each read status 'invited', and the
-- second UPDATE would re-stamp started_at/ends_at — handing the candidate a fresh 45 minutes. The
-- status guard belonged in the UPDATE, not only in the read above it.
do $patch$
declare src text; v_old text;
begin
  src := pg_get_functiondef('public.dispatcher_test_start()'::regprocedure);
  v_old := 'set status = ''in_progress'', started_at = now(), ends_at = now() + make_interval(mins => a.minutes)
   where id = a.id;';
  if position(v_old in src) = 0 then raise exception 'dispatcher_test_start: update block not found'; end if;
  src := replace(src, v_old, 'set status = ''in_progress'', started_at = now(), ends_at = now() + make_interval(mins => a.minutes)
   where id = a.id and status = ''invited'';');
  execute src;
end $patch$;

-- FRONTEND (app/agent/skills-test.js, same change set):
--  * the countdown is computed from an absolute deadline instead of decrementing a counter. A
--    background tab throttles setInterval to roughly once a minute, so the old clock showed twenty
--    minutes left when two remained — and the candidate was cut off with no warning.
--  * returning to the tab re-anchors the clock from the server even when nothing needed saving. The
--    clock used to be corrected only by a save, so a candidate who left and typed nothing came back
--    to a clock that was minutes fast.
--  * seconds-per-question now include the time the box is focused right now, so the question someone
--    worked on for twenty minutes and then submitted from is no longer recorded as 0s.
--  * if the SPA navigates away, the detached host now tears down its intervals and its beforeunload
--    handler instead of running a clock — and a "leave site?" prompt — for a screen that is gone.
--  * on a phone the points badge wrapped below the question instead of squeezing it to a column.
