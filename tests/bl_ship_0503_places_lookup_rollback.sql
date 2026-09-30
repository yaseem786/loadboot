-- bl_ship_0503 rollback test (staging only). Run 29 Sep 2026: 7/7 passing. Ends with RAISE, so nothing is kept (cap change included).
do $$
declare v_staff uuid := '4e57f205-4dc6-4379-9d68-b66c3db151f8'; v_non uuid := 'ba1d0333-725e-45f8-ad4a-2c9a808b74df';
  v_user uuid := gen_random_uuid(); v_org uuid := gen_random_uuid(); ok text[] := '{}'; bad text[] := '{}'; r jsonb;
begin
  insert into auth.users(id, email, aud, role) values (v_user, 'bl0503-' || left(v_user::text,8) || '@bl0503test.com', 'authenticated', 'authenticated');
  insert into public.organizations(id, kind, name, owner_user_id) values (v_org, 'shipper', 'BL0503 Test Co', v_user);
  perform set_config('request.jwt.claims', json_build_object('sub', v_non, 'role','authenticated')::text, true);
  begin perform public.cc_places_lookup_start(v_org); bad := bad || text 'P1 non-staff';
  exception when others then if sqlstate = '42501' then ok := ok || text 'P1 non-staff 42501'; else bad := bad || ('P1 ' || sqlerrm); end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role','authenticated')::text, true);
  begin perform public.cc_places_lookup_start(v_org); bad := bad || text 'P2 empty searched';
  exception when others then if sqlerrm like 'Nothing to search yet%' then ok := ok || text 'P2 nothing to search refused'; else bad := bad || ('P2 ' || sqlerrm); end if; end;
  insert into app_private.org_onboarding_items(org_id, item_key, status, data) values
    (v_org, 'legal_entity', 'submitted', '{"legal_name":"BL0503 Test Co LLC"}'), (v_org, 'physical_address', 'submitted', '{"street":"1 Main St","city":"Denver","state":"CO","zip":"80202"}');
  r := public.cc_places_lookup_start(v_org);
  if r->>'basis' = 'shipper_answers' and r->>'query' like 'BL0503 Test Co LLC, 1 Main St%' then ok := ok || text 'P3 shipper-answers basis'; else bad := bad || ('P3 ' || r::text); end if;
  perform public.cc_places_lookup_done((r->>'id')::bigint, array['ChIJx'], true, null);
  begin perform public.cc_places_lookup_done((r->>'id')::bigint, array['ChIJy'], true, null); bad := bad || text 'P4 double close';
  exception when others then if sqlerrm like 'lookup not found%' then ok := ok || text 'P4 closed once only'; else bad := bad || ('P4 ' || sqlerrm); end if; end;
  insert into app_private.org_onboarding_items(org_id, item_key, status, data) values (v_org, 'registry_check', 'submitted', '{"legal_name":"BL0503 TEST CO LLC","principal_address":"1 MAIN ST, DENVER, CO 80202"}');
  r := public.cc_places_lookup_start(v_org);
  if r->>'basis' = 'registry' then ok := ok || text 'P5 registry basis preferred'; else bad := bad || ('P5 ' || r::text); end if;
  perform public.cc_places_lookup_start(v_org);
  begin perform public.cc_places_lookup_start(v_org); bad := bad || text 'P6 4th lookup allowed';
  exception when others then if sqlerrm like 'Already looked up 3 times%' then ok := ok || text 'P6 3 per shipper per day'; else bad := bad || ('P6 ' || sqlerrm); end if; end;
  delete from app_private.places_lookups where org_id = v_org;
  update app_private.shipper_config set places_monthly_cap = (select count(*) from app_private.places_lookups where looked_at >= date_trunc('month', now())) where id;
  begin perform public.cc_places_lookup_start(v_org); bad := bad || text 'P7 over cap';
  exception when others then if sqlerrm like 'Google lookups this month%' then ok := ok || text 'P7 monthly cap refuses'; else bad := bad || ('P7 ' || sqlerrm); end if; end;
  raise exception 'BL0503_TEST passed=% failed=% | FAILED: % | PASSED: %', cardinality(ok), cardinality(bad), array_to_string(bad,' ; '), array_to_string(ok,' ; ');
end $$;
