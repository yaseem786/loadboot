-- bl_voice_0489d — a voicemail call is labelled "voicemail", never "wrong_number" · 30 Sep 2026
--
-- WHY. Retell's post-call analysis keeps calling a FULL MAILBOX "interest_level = wrong_number" (Warren's + Cassella
-- 28 Sep, Cassella again 30 Sep, plan #14). bl_voice_0489 already stops that from reaching voice_dnc, but CC still
-- shows "wrong number" on the plan card, which made the owner think the number was bad.
--
-- WHAT. retell_webhook: when Retell itself says call_analysis.in_voicemail = true and the label is wrong_number /
-- not_interested, store interest_level = 'voicemail' and keep Retell's word in interest_level_retell. Existing rows
-- (lc_calls.analysis + riley_call_plans.outcome.interest) are corrected the same way.
-- 'voicemail' is not hot/warm/cold, so no CRM lead is created from it (same as before). One anchor, asserted.

do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.retell_webhook(jsonb)'::regprocedure);
  if position('bl_voice_0489d' in d) = 0 then
    n := replace(d, $a$  if v_an is null or jsonb_typeof(v_an) <> 'object' then v_an := null; end if;$a$,
$a$  if v_an is null or jsonb_typeof(v_an) <> 'object' then v_an := null; end if;
  -- bl_voice_0489d: a machine answered — never "wrong number" / "not interested"
  if v_an is not null and coalesce(call->'call_analysis'->>'in_voicemail', '') = 'true'
     and v_an->>'interest_level' in ('wrong_number', 'not_interested') then
    v_an := v_an || jsonb_build_object('interest_level', 'voicemail', 'interest_level_retell', v_an->>'interest_level');
  end if;$a$);
    if n = d then raise exception 'bl_voice_0489d: retell_webhook anchor not found'; end if;
    execute n;
  end if;
end $mig$;

update app_private.lc_calls
   set analysis = analysis || jsonb_build_object('interest_level', 'voicemail', 'interest_level_retell', analysis->>'interest_level')
 where analysis->>'in_voicemail' = 'true' and analysis->>'interest_level' in ('wrong_number', 'not_interested');

update app_private.riley_call_plans p
   set outcome = p.outcome || jsonb_build_object('interest', 'voicemail'), updated_at = now()
  from app_private.lc_calls c
 where c.id = p.call_id and c.analysis->>'interest_level' = 'voicemail' and p.outcome->>'interest' in ('wrong_number', 'not_interested');
