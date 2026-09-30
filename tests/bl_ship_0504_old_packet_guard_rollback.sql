-- bl_ship_0504 rollback test (staging only). One DO block that ends with RAISE, so nothing is kept.
-- Throwaway shipper + user created inside the block. Staff = the 0499 staging test staff user.
do $$
declare
  v_staff uuid := '4e57f205-4dc6-4379-9d68-b66c3db151f8';
  v_user uuid := gen_random_uuid(); v_org uuid := gen_random_uuid();
  r jsonb; ok text[] := '{}'; bad text[] := '{}';
begin
  insert into auth.users(id, email, email_confirmed_at, aud, role) values (v_user, 'bl0504-' || left(v_user::text, 8) || '@bl0504test.com', now(), 'authenticated', 'authenticated');
  insert into public.organizations(id, kind, name, owner_user_id) values (v_org, 'shipper', 'BL0504 Test Old Packet LLC', v_user);
  insert into public.organization_memberships(org_id, user_id, member_role, status) values (v_org, v_user, 'owner', 'active') on conflict do nothing;
  insert into app_private.org_onboarding_items(org_id, item_key, status, data, ref, submitted_at) values
    (v_org, 'legal_entity', 'submitted', null, 'Legal name: BL0504 Test Old Packet LLC; EIN 12-3456789', now()),   -- old packet
    (v_org, 'cargo_profile', 'submitted', '{}'::jsonb, 'general freight', now()),                                  -- empty object
    (v_org, 'physical_address', 'submitted', '{"street":"1 Main St","city":"Denver","state":"CO","zip":"80202"}', null, now());
  insert into app_private.agreement_signatures(org_id, kind, version, signer_user, signer_name, signer_title, consent_text, body_sha256)
    values (v_org, 'shipper_platform', 2, v_user, 'Test Signer', 'Manager', 'I agree', repeat('0', 64));
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  -- T1 old packet (data null, answer in ref) → verify refused
  begin perform public.cc_onboarding_review_item(v_org, 'legal_entity', 'verify', null); bad := bad || text 'T1 null-data verified';
  exception when others then if sqlstate = '22023' and sqlerrm like '%no form data%' then ok := ok || text 'T1 null data refused'; else bad := bad || ('T1 ' || sqlerrm); end if; end;
  -- T2 empty object → refused
  begin perform public.cc_onboarding_review_item(v_org, 'cargo_profile', 'verify', null); bad := bad || text 'T2 empty-data verified';
  exception when others then if sqlstate = '22023' and sqlerrm like '%no form data%' then ok := ok || text 'T2 empty data refused'; else bad := bad || ('T2 ' || sqlerrm); end if; end;
  -- T3 no row at all → refused
  begin perform public.cc_onboarding_review_item(v_org, 'ap_contact', 'verify', null); bad := bad || text 'T3 missing verified';
  exception when others then if sqlstate = '22023' and sqlerrm like '%no form data%' then ok := ok || text 'T3 no row refused'; else bad := bad || ('T3 ' || sqlerrm); end if; end;
  -- T4 real form data → verify works
  begin perform public.cc_onboarding_review_item(v_org, 'physical_address', 'verify', null);
    if (select status from app_private.org_onboarding_items where org_id = v_org and item_key = 'physical_address') = 'verified'
      then ok := ok || text 'T4 data verified'; else bad := bad || text 'T4 not verified'; end if;
  exception when others then bad := bad || ('T4 ' || sqlerrm); end;
  -- T5 reject on the old packet still works
  begin perform public.cc_onboarding_review_item(v_org, 'legal_entity', 'reject', 'Please fill the new form');
    if (select status from app_private.org_onboarding_items where org_id = v_org and item_key = 'legal_entity') = 'rejected'
      then ok := ok || text 'T5 reject ok'; else bad := bad || text 'T5 not rejected'; end if;
  exception when others then bad := bad || ('T5 ' || sqlerrm); end;
  -- T6 partner 360: shipper_platform published list (published + legal_approved) and the e-signature in agreements
  begin r := public.cc_partner_360(v_org);
    if exists (select 1 from jsonb_array_elements(r->'agreements_published') e where e->>'kind' = 'shipper_platform' and (e->>'version')::int = 2)
       and not exists (select 1 from jsonb_array_elements(r->'agreements_published') e where e->>'kind' = 'broker_shipper')
      then ok := ok || text 'T6 published list'; else bad := bad || ('T6 published ' || coalesce(r->>'agreements_published', 'null')); end if;
    if exists (select 1 from jsonb_array_elements(r->'agreements') e where e->>'kind' = 'shipper_platform' and (e->>'version')::int = 2 and e->>'accepted_by' like 'bl0504-%')
      then ok := ok || text 'T7 signature listed'; else bad := bad || ('T7 agreements ' || coalesce(r->>'agreements', 'null')); end if;
  exception when others then bad := bad || ('T6 ' || sqlerrm); end;

  raise exception 'bl0504 test: % ok [%] · % bad [%]', cardinality(ok), array_to_string(ok, ' | '), cardinality(bad), array_to_string(bad, ' | ');
end $$;
