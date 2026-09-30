-- bl_ship_0508 rollback test (staging only). One DO block that ends with RAISE, so nothing is kept.
-- Two throwaway shippers (A signs, B does not). Staff = the 0499 staging test staff user.
do $$
declare
  v_staff uuid := '4e57f205-4dc6-4379-9d68-b66c3db151f8';
  u uuid[] := array[gen_random_uuid(), gen_random_uuid()]; o uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  a record; r jsonb; i int; ok text[] := '{}'; bad text[] := '{}';
begin
  for i in 1..2 loop
    insert into auth.users(id, email, email_confirmed_at, aud, role) values (u[i], 'bl0508-' || left(u[i]::text, 8) || '@bl0508test.com', now(), 'authenticated', 'authenticated');
    insert into public.organizations(id, kind, name, owner_user_id) values (o[i], 'shipper', 'BL0508 Test ' || i || ' LLC', u[i]);
    insert into public.organization_memberships(org_id, user_id, member_role, status) values (o[i], u[i], 'owner', 'active') on conflict do nothing;
  end loop;
  select kind, version, encode(extensions.digest(body_md, 'sha256'), 'hex') sha into a from app_private.master_agreements
   where kind = 'shipper_platform' and published and legal_approved order by version desc limit 1;
  if a.kind is null then raise exception 'no published shipper_platform on this env'; end if;

  -- A signs through the real RPC
  perform set_config('request.jwt.claims', json_build_object('sub', u[1], 'role', 'authenticated')::text, true);
  perform public.cc_shipper_agreement_sign(a.kind, a.version, a.sha, 'Test Signer', 'Owner', true);
  -- T1 shipper A reads its own copy
  r := public.cc_shipper_agreement_copy('shipper_platform');
  if (r->>'signed')::boolean and (r->>'text_matches')::boolean and r->>'signer_name' = 'Test Signer' and r->>'body_md' is not null
     and (r->'loadboot'->>'dated') = (r->>'signed_at') then ok := ok || text 'T1 own copy'; else bad := bad || ('T1 ' || left(r::text, 200)); end if;
  -- T2 unsigned kind → signed false
  r := public.cc_shipper_agreement_copy('shipper_carrier');
  if not (r->>'signed')::boolean then ok := ok || text 'T2 unsigned = false'; else bad := bad || text 'T2'; end if;
  -- T3 shipper A asks for B's org → refused
  begin perform public.cc_shipper_agreement_copy('shipper_platform', null, o[2]); bad := bad || text 'T3 cross-org read allowed';
  exception when others then if sqlstate = '42501' then ok := ok || text 'T3 cross-org refused'; else bad := bad || ('T3 ' || sqlerrm); end if; end;
  -- T4 unknown kind → refused
  begin perform public.cc_shipper_agreement_copy('broker_carrier'); bad := bad || text 'T4 unknown kind allowed';
  exception when others then if sqlstate = '22023' then ok := ok || text 'T4 unknown kind refused'; else bad := bad || ('T4 ' || sqlerrm); end if; end;
  -- T5 staff reads A by org id
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  r := public.cc_shipper_agreement_copy('shipper_platform', null, o[1]);
  if (r->>'signed')::boolean and r->>'company' = 'BL0508 Test 1 LLC' then ok := ok || text 'T5 staff reads'; else bad := bad || ('T5 ' || left(r::text, 200)); end if;
  -- T6 anon / public cannot execute
  if not has_function_privilege('anon', 'public.cc_shipper_agreement_copy(text,integer,uuid)', 'execute')
     and has_function_privilege('authenticated', 'public.cc_shipper_agreement_copy(text,integer,uuid)', 'execute')
    then ok := ok || text 'T6 anon no / authenticated yes'; else bad := bad || text 'T6 grants wrong'; end if;

  raise exception 'ROLLBACK bl_ship_0508 — ok: % | bad: %', ok, bad;
end $$;
