-- bl_voice_0489 — a voicemail is never a "wrong number" (Riley do-not-call guard) · 28 Sep 2026
--
-- WHY. On 28 Sep two Monday plan calls hit a FULL mailbox (Warren's, Cassella). Retell's post-call analysis labelled
-- both `interest_level = wrong_number`, and riley_plan_on_call put both carriers on app_private.voice_dnc. Nobody said
-- "wrong number" — a machine answered. The rows were deleted by hand the same day (claude/RILEY-OUTBOUND-815-0488.md).
--
-- WHAT.
--   1. retell_webhook keeps Retell's own voicemail facts on the call row: analysis.in_voicemail +
--      analysis.disconnection_reason (from call.call_analysis.in_voicemail / call.disconnection_reason).
--   2. riley_plan_on_call adds a number to voice_dnc on wrong_number / not_interested ONLY when the call was not a
--      voicemail (in_voicemail, disconnection_reason voicemail_reached / machine_detected, or a summary that says
--      voicemail / mailbox). Staff can still add a number by hand (plan action 'dnc').
--   3. Plans #5 and #9 get the note the manual cleanup could not write.
--
-- Patched by ANCHOR on the live definitions (bl_wa_0487 pattern), each asserted. No new function, no ACL change →
-- anon SECDEF surface unchanged. STAGING FIRST, then prod. Idempotent.

do $mig$
declare d text; n text;
begin
  -- 1. retell_webhook: keep in_voicemail + disconnection_reason
  d := pg_get_functiondef('public.retell_webhook(jsonb)'::regprocedure);
  if position('bl_voice_0489' in d) = 0 then
    n := replace(d, $a$    analysis = case when v_an is null then analysis else coalesce(analysis,'{}'::jsonb) || v_an end,$a$,
$a$    analysis = case when v_an is null and call->'call_analysis'->'in_voicemail' is null and call->'disconnection_reason' is null then analysis
                    else coalesce(analysis,'{}'::jsonb) || coalesce(v_an,'{}'::jsonb)
                         || jsonb_strip_nulls(jsonb_build_object('in_voicemail', call->'call_analysis'->'in_voicemail',
                                                                 'disconnection_reason', call->'disconnection_reason')) end,   -- bl_voice_0489$a$);
    if n = d then raise exception 'bl_voice_0489: retell_webhook anchor not found'; end if;
    execute n;
  end if;

  -- 2. riley_plan_on_call: a voicemail never lands on do-not-call
  d := pg_get_functiondef('app_private.riley_plan_on_call(text, text)'::regprocedure);
  if position('bl_voice_0489' in d) = 0 then
    n := replace(d, $a$  if v_int in ('wrong_number', 'not_interested') then$a$,
$a$  -- bl_voice_0489: Retell marks a full mailbox as "wrong_number"; a machine answering is never a refusal.
  if v_int in ('wrong_number', 'not_interested')
     and not (coalesce((c.analysis ->> 'in_voicemail')::boolean, false)
              or coalesce(c.analysis ->> 'disconnection_reason', '') in ('voicemail_reached', 'machine_detected')
              or coalesce(c.summary, '') ~* 'voice ?mail|mailbox') then$a$);
    if n = d then raise exception 'bl_voice_0489: riley_plan_on_call anchor not found'; end if;
    execute n;
  end if;
end $mig$;

-- 3. the note the 28 Sep manual cleanup could not write (prod plan ids; harmless no-op where they do not exist)
update app_private.riley_call_plans
   set note = coalesce(note || E'\n', '') || 'Removed from Riley do-not-call on Sep 28: the mailbox was full, Retell mislabelled it "wrong number" (bl_voice_0489).',
       updated_at = now()
 where id in (5, 9) and coalesce(note, '') not like '%bl_voice_0489%'
   and exists (select 1 from app_private.lc_calls c where c.id = riley_call_plans.call_id and c.summary ~* 'mailbox');
