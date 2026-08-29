-- bl_fix_0304_carrier_status_jsonb_cast
-- 29 Aug 2026
--
-- Every carrier status change from the Command Center failed. Carrier directory ->
-- open a carrier -> Approve showed the red "Something went wrong. Please try again."
--
-- Cause: public.cc_set_carrier_status is declared RETURNS jsonb and does
--     declare r jsonb; ... r := public.cc_set_carrier_status_core(...);
-- but cc_set_carrier_status_core RETURNS text and returns the bare status word.
-- Assigning text 'active' to a jsonb variable makes Postgres cast it as JSON, and
-- `active` is not valid JSON, so the call died with 22P02 "invalid input syntax for
-- type json" AFTER the core had already done its work — the update rolled back with it.
--
-- Two things hid this for weeks. The failure comes from the wrapper, not the logic, so
-- nothing in the audit log showed a refusal; and humanizeError() has no branch for
-- 22P02, so the only thing anyone ever saw was the generic sentence. Both Approve and
-- Send back go through this function, so neither has worked from Carrier directory.
--
-- Fix: to_jsonb() instead of the implicit cast. The client is unchanged — PostgREST
-- still returns the same string and carriers.js keeps doing 'Carrier set to ' + r.
-- Signature and return type untouched, so CREATE OR REPLACE, no drop.
--
-- Verified on production by calling it inside a subtransaction that was then rolled
-- back: before the fix, sqlstate 22P02; after, PROBE_OK returned="active".
--
-- Reversible: restore `r := public.cc_set_carrier_status_core(p_carrier, p_status, p_note);`

CREATE OR REPLACE FUNCTION public.cc_set_carrier_status(p_carrier uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare r jsonb;
begin
  -- bl_fix_0304: to_jsonb(), because the core returns text and a bare word is not JSON.
  r := to_jsonb(public.cc_set_carrier_status_core(p_carrier, p_status, p_note));
  begin
    perform app_private.notify_org(p_carrier,'account.status','Account status updated: '||upper(coalesce(p_status,'')),
      coalesce(nullif(p_note,''),'Your LoadBoot account status changed to '||coalesce(p_status,'')||'. Contact support if this looks wrong.'),
      '/app/carrier/#account', case when p_status in ('suspended','paused','rejected') then 'warning' else 'info' end,
      'status:'||p_carrier::text||':'||coalesce(p_status,'')||':'||to_char(now(),'YYYYMMDDHH24MI'));
  exception when others then raise warning 'status notify failed: %', sqlerrm; end;
  return r;
end
$function$;
