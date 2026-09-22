-- bl_audit_0360 — anon-surface hygiene for the SMS-consent lane (bl_dial_0352_sms / 0390, staging-only on 22 Sep 2026).
-- The six functions were created with Postgres' default EXECUTE-to-PUBLIC, so anon could call them. Every body returns
-- "Sign in first." when auth.uid() is null, so nothing was exploitable — but the anon SECURITY DEFINER baseline (32 staging /
-- 33 prod, names) must not silently grow. Revoke PUBLIC+anon; authenticated + service_role keep EXECUTE. Skips names that do
-- not exist (prod today). Rollback: grant execute ... to anon for the same six.
do $m$ declare f text; begin
  foreach f in array array['public.dialer_sms_consent_record(jsonb)','public.dialer_sms_consent_revoke(jsonb)','public.dialer_sms_consent_state(jsonb)',
                          'public.sms_consent_self_state()','public.sms_consent_self_sync()','public.sms_consent_set_self(jsonb)'] loop
    if to_regprocedure(f) is not null then
      execute format('revoke all on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
end $m$;
