-- bl_voice_0523 — a phone menu / hold queue is labelled "ivr", never "wrong_number" · 1 Oct 2026
--
-- WHY. Calls 407 and 412 (1 Oct, TQL main line) reached TQL's recorded menu and hold queue; nobody said "wrong number".
-- Retell's post-call analysis still labelled both interest_level = wrong_number (407: disconnection_reason ivr_reached;
-- 412: 8 min of menus and hold, then user_hangup). CC showed "Wrong number" on a correct number, and on a plan call
-- riley_plan_on_call would have put that number on app_private.voice_dnc (bl_voice_0489 only spares voicemail).
--
-- WHAT. Same shape as bl_voice_0489d (voicemail):
--   1. retell_webhook: wrong_number / not_interested + disconnection_reason ivr_reached  -> interest_level 'ivr'.
--      wrong_number + a summary that describes a phone menu / hold queue                 -> interest_level 'ivr'.
--      (A summary match never relabels not_interested: a person who refused after a transfer is still a refusal.)
--      Retell's own word is kept in interest_level_retell.
--   2. riley_plan_on_call: disconnection_reason ivr_reached joins the voicemail guard, so a menu never lands on DNC.
--   3. Existing rows corrected the same way (lc_calls.analysis + riley_call_plans.outcome.interest).
-- 'ivr' is not hot/warm/cold, so no CRM lead is created from it (same as wrong_number / voicemail).
-- Patched by anchor on the live definitions, each asserted. No new function, no ACL change -> anon SECDEF surface
-- unchanged. STAGING FIRST, then prod. Idempotent.

do $mig$
declare d text; n text;
  ivr_re constant text := $r$\mivr\M|automated (phone )?(menu|system|attendant)|phone (menu|tree)|recorded (menu|greeting)|hold (music|queue)|placed on hold|waiting on hold$r$;
begin
  -- 1. retell_webhook
  d := pg_get_functiondef('public.retell_webhook(jsonb)'::regprocedure);
  if position('bl_voice_0523' in d) = 0 then
    n := replace(d, $a$    v_an := v_an || jsonb_build_object('interest_level', 'voicemail', 'interest_level_retell', v_an->>'interest_level');
  end if;$a$,
$a$    v_an := v_an || jsonb_build_object('interest_level', 'voicemail', 'interest_level_retell', v_an->>'interest_level');
  end if;
  -- bl_voice_0523: a phone menu / hold queue answered — "ivr", never "wrong number"
  if v_an is not null
     and ((coalesce(call->>'disconnection_reason', '') = 'ivr_reached' and v_an->>'interest_level' in ('wrong_number', 'not_interested'))
          or (v_an->>'interest_level' = 'wrong_number'
              and coalesce(call->'call_analysis'->>'call_summary', '') ~* '$a$ || ivr_re || $a$')) then
    v_an := v_an || jsonb_build_object('interest_level', 'ivr', 'interest_level_retell', v_an->>'interest_level');
  end if;$a$);
    if n = d then raise exception 'bl_voice_0523: retell_webhook anchor (bl_voice_0489d block) not found'; end if;
    execute n;
  end if;

  -- 2. riley_plan_on_call: a phone menu is never a refusal
  d := pg_get_functiondef('app_private.riley_plan_on_call(text, text)'::regprocedure);
  if position('ivr_reached' in d) = 0 then
    n := replace(d, $a$in ('voicemail_reached', 'machine_detected')$a$,
                    $a$in ('voicemail_reached', 'machine_detected', 'ivr_reached')   -- bl_voice_0523$a$);
    if n = d then raise exception 'bl_voice_0523: riley_plan_on_call anchor (bl_voice_0489 guard) not found'; end if;
    execute n;
  end if;

  -- 3. existing rows
  update app_private.lc_calls
     set analysis = analysis || jsonb_build_object('interest_level', 'ivr', 'interest_level_retell', analysis->>'interest_level'),
         updated_at = now()
   where (analysis->>'disconnection_reason' = 'ivr_reached' and analysis->>'interest_level' in ('wrong_number', 'not_interested'))
      or (analysis->>'interest_level' = 'wrong_number' and coalesce(summary, '') ~* ivr_re);

  update app_private.riley_call_plans p
     set outcome = p.outcome || jsonb_build_object('interest', 'ivr'), updated_at = now()
    from app_private.lc_calls c
   where c.id = p.call_id and c.analysis->>'interest_level' = 'ivr' and p.outcome->>'interest' in ('wrong_number', 'not_interested');
end $mig$;
