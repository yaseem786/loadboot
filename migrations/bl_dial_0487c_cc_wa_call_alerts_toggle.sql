-- bl_dial_0487c — CC toggle for WhatsApp call alerts (owner, 28 Sep 2026)
-- cc_dialer_config_set now takes `wa_call_alerts` ('off' | 'offline' | 'always'); anything else is ignored.
-- Staff-only as before (disp_is_staff) and written to the audit log by the existing disp_audit call.
-- CC → Phone → Phone settings shows it as a dropdown. In-place anchor patch, idempotent. No new function,
-- so the anon SECURITY DEFINER surface is untouched.
do $$
declare s text;
begin
  s := pg_get_functiondef('public.cc_dialer_config_set(jsonb)'::regprocedure);
  if position('wa_call_alerts' in s) = 0 then
    if position($o$    record_calls = coalesce((p->>'record_calls')::boolean, record_calls),$o$ in s) = 0 then
      raise exception 'bl_dial_0487c: expected text not found in cc_dialer_config_set'; end if;
    s := replace(s, $o$    record_calls = coalesce((p->>'record_calls')::boolean, record_calls),$o$, $n$    wa_call_alerts = case when p->>'wa_call_alerts' in ('off','offline','always') then p->>'wa_call_alerts' else wa_call_alerts end,
    record_calls = coalesce((p->>'record_calls')::boolean, record_calls),$n$);
    execute s;
  end if;
end $$;
