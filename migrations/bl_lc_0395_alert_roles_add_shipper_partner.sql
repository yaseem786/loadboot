-- bl_lc_0395 — live chat alerts: add shipper and partner to the alert roles
--
-- bl_lc_0394 narrowed the hello@ reminder to carrier and broker, exactly as instructed.
-- Owner then added shipper and partner (22 Sep 2026). These are the four revenue-side roles;
-- dispatcher applicants, agents and visitors who have not said what they are still raise no
-- email, only the in-app Command Center notification.
--
-- "Once per waiting episode" from bl_lc_0394 is unchanged — this only widens WHO qualifies.
--
-- Idempotent: after it runs the anchor no longer exists, so a second run is a no-op.
-- Rollback: replace the four-role list with ('carrier','broker') again.

do $patch$
declare d text; f text;
begin
  foreach f in array array[
    'app_private.lc_do_handoff(uuid,text)',
    'app_private.lc_sla_alert()',
    'app_private.lc_unanswered_alert(integer)'
  ] loop
    d := pg_get_functiondef(f::regprocedure);
    -- NOTE the closing paren in the anchor: it is what stops this from also rewriting
    -- lc_do_handoff's v_phone_ok line, which reads in ('carrier','broker','shipper').
    d := replace(d, 'in (''carrier'',''broker'')',
                    'in (''carrier'',''broker'',''shipper'',''partner'')');
    execute d;
  end loop;
end $patch$;
