-- bl_ship_0509c rollback test (staging only). One DO block that ends with RAISE, so nothing is kept.
-- Throwaway shipper; staff = the 0499 staging test staff user.
do $$
declare
  v_staff uuid := '4e57f205-4dc6-4379-9d68-b66c3db151f8';
  u uuid := gen_random_uuid(); o uuid := gen_random_uuid();
  k text; ok text[] := '{}'; bad text[] := '{}'; e text;
begin
  insert into auth.users(id, email, email_confirmed_at, aud, role) values (u, 'bl0509c-' || left(u::text, 8) || '@bl0509test.com', now(), 'authenticated', 'authenticated');
  insert into public.organizations(id, kind, name, owner_user_id) values (o, 'shipper', 'BL0509c Test LLC', u);
  insert into app_private.shipper_trust(org_id) values (o) on conflict do nothing;
  insert into app_private.org_onboarding_items(org_id, item_key, status, data, submitted_at)
    values (o, 'payment_terms', 'submitted', '{"terms":"net_30"}', now());
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  -- T1-T6 hand-verify refused for every item with its own proof step
  foreach k in array array['phone_verify','independent_callback','email_verify','facility_rules','platform_terms','shipper_carrier_terms'] loop
    begin
      perform public.cc_onboarding_review_item(o, k, 'verify', null);
      bad := bad || (k || ' verified by hand');
    exception when sqlstate '22023' then
      get stacked diagnostics e = message_text;
      if e like '%cannot be marked verified by hand%' then ok := ok || (k || ' refused'); else bad := bad || (k || ' other error: ' || e); end if;
    end;
  end loop;
  if app_private.shipper_item_status(o, 'phone_verify') = 'pending' and app_private.shipper_item_status(o, 'independent_callback') = 'pending'
    then ok := ok || text 'statuses still pending'; else bad := bad || text 'a status moved'; end if;

  -- T7 registry_check keeps its own (card-only) message
  begin
    perform public.cc_onboarding_review_item(o, 'registry_check', 'verify', null); bad := bad || text 'registry verified by hand';
  exception when sqlstate '22023' then
    get stacked diagnostics e = message_text;
    if e like '%from its card%' then ok := ok || text 'registry keeps card gate'; else bad := bad || ('registry: ' || e); end if;
  end;

  -- T8 a form item with data still verifies
  begin
    perform public.cc_onboarding_review_item(o, 'payment_terms', 'verify', null);
    if app_private.shipper_item_status(o, 'payment_terms') = 'verified' then ok := ok || text 'form item verifies'; else bad := bad || text 'form item not verified'; end if;
  exception when others then get stacked diagnostics e = message_text; bad := bad || ('form verify error: ' || e); end;

  -- T9 waive with a reason still works (the deliberate override)
  begin
    perform public.cc_onboarding_review_item(o, 'phone_verify', 'waive', 'test waive');
    if app_private.shipper_item_status(o, 'phone_verify') = 'waived' then ok := ok || text 'waive works'; else bad := bad || text 'waive did not stick'; end if;
  exception when others then get stacked diagnostics e = message_text; bad := bad || ('waive error: ' || e); end;

  raise exception 'bl_ship_0509c test: % pass, % fail | PASS: % | FAIL: %', cardinality(ok), cardinality(bad), array_to_string(ok, '; '), array_to_string(bad, '; ');
end $$;
