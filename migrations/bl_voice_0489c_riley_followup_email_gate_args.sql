-- bl_voice_0489c — Riley follow-up "Send email" always failed: email_gate called with its arguments swapped · 28 Sep 2026
--
-- email_gate(p_key, p_to, p_user). bl_voice_0485's cc_riley_followup_act called email_gate(v_email, 'riley.followup', null),
-- so the gate validated the string 'riley.followup' as an address → {allowed:false, code:'invalid_address'} on every
-- send; CC showed "Something went wrong". Found when the owner tried to send plan #6 (JMS) on 28 Sep. No other caller
-- has the swap (checked every email_gate( call in public + app_private). One anchor, asserted. No ACL change.

do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cc_riley_followup_act(bigint, text, jsonb)'::regprocedure);
  if position('email_gate(''riley.followup'', v_email' in d) = 0 then
    n := replace(d, $a$g := app_private.email_gate(v_email, 'riley.followup', null);$a$,
                    $a$g := app_private.email_gate('riley.followup', v_email, null);   -- bl_voice_0489c: (key, to) order$a$);
    if n = d then raise exception 'bl_voice_0489c: anchor not found'; end if;
    execute n;
  end if;
end $mig$;
