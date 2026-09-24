-- bl_sec_0436 — investor lane: six public SECURITY DEFINER functions lose their anon EXECUTE (24 Sep 2026, O10)
--
-- Why they had it: Supabase's default privileges (`alter default privileges for role postgres in schema
-- public grant execute on functions to anon, authenticated, service_role`) attach an EXPLICIT anon=X to
-- every new public function. bl_inv_0408/0409/0410/0412/0413 each ran `revoke all ... from public` +
-- `grant execute ... to authenticated`, which removes PUBLIC but leaves that explicit anon entry in place.
-- Result on 24 Sep: prod anon-SECDEF surface 39 = the 33-name baseline + these six; staging 38 = 32 + 6.
--
-- Why revoking is safe: all six authorise on their first statement — auth.uid() is null → 42501
-- 'not signed in' (inv_claim_by_email, inv_self_onboard), app_private.inv_can_manage() (cc_inv_*),
-- app_private.inv_my_investor() (inv_publish_self_doc). An anon caller never got past that line; the
-- grant was one missing layer, not a working door. authenticated + service_role keep EXECUTE.
--
-- Lesson for every future migration that creates a public function: `revoke execute ... from anon`
-- explicitly (PUBLIC alone is not enough here), then re-run the baseline query and compare NAMES.
-- Idempotent; asserts the result. Rollback: grant execute ... to anon on each (not recommended).

revoke execute on function public.cc_inv_expense_attach(jsonb)        from public, anon;
revoke execute on function public.cc_inv_request_attach(uuid, jsonb)  from public, anon;
revoke execute on function public.cc_inv_set_txn_time(jsonb)          from public, anon;
revoke execute on function public.inv_claim_by_email()                from public, anon;
revoke execute on function public.inv_publish_self_doc(jsonb)         from public, anon;
revoke execute on function public.inv_self_onboard(jsonb)             from public, anon;

do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and p.proname in ('cc_inv_expense_attach','cc_inv_request_attach','cc_inv_set_txn_time','inv_claim_by_email','inv_publish_self_doc','inv_self_onboard')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE') or not has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if n > 0 then raise exception 'bl_sec_0436: % investor function(s) still anon-executable or lost authenticated/service_role', n; end if;
end $$;
