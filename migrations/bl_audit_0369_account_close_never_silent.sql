-- bl_audit_0369 — close-account requests never switch the organization off by themselves (review of 0342, 24 Sep 2026).
-- Finding: on PROD, public.cc_request_account_action('close') closed the organization on the spot (status='closed',
-- broker_visible=false) whenever there was no live trip and no unpaid settlement, and mailed "press Reopen my account" —
-- but the carrier portal has NO reopen button, and the confirm the carrier just accepted says "Nothing is deactivated
-- until you confirm" / "we confirm with you first". Staging already runs the 0342 version that never closes.
-- Fix (prod): remove the silent auto-close branch, so a close becomes an open request that staff handle, exactly as the
-- UI promises. No data changed: prod had 0 account_requests and 0 closed organizations at apply time.
-- On staging (0342 body, search_path=pg_catalog) this file is a no-op.
do $m$
declare d text; a int; b int; n text;
  start_mark constant text := E'  if p_action = ''close'' and not v_blocked then\n';
  end_mark   constant text := E'  -- Pause, or a close we will not do silently.\n';
begin
  d := pg_get_functiondef('public.cc_request_account_action(text,text)'::regprocedure);
  if md5(d) = '0eb0ef3600efedb7d489465167a913a7' then
    a := position(start_mark in d); b := position(end_mark in d);
    if a = 0 or b = 0 or b < a then raise exception 'bl_audit_0369: markers not found'; end if;
    n := substr(d, 1, a - 1)
      || E'  -- bl_audit_0369: no silent auto-close. A close is always an open request that a person handles with the carrier.\n\n'
      || substr(d, b);
    execute n;
  elsif d ~ 'search_path TO ''pg_catalog''' and d !~ 'set status = ''closed''' then
    raise notice 'bl_audit_0369: staging 0342 body already never closes — no-op';
  else
    raise exception 'bl_audit_0369: unknown cc_request_account_action baseline (md5 %), refusing', md5(d);
  end if;
end $m$;
