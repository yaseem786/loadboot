-- bl_ship_0502 rollback test (staging only). Run 29 Sep 2026: 31 cases, all passing (T12 re-run with the portal header).
-- Everything runs in one DO block that ends with RAISE, so nothing is kept.
-- Throwaway shipper + user created inside the block. Staff = the 0499 staging test staff user; non-staff = marketing@lb.test.
do $$
declare
  v_staff uuid := '4e57f205-4dc6-4379-9d68-b66c3db151f8';
  v_nonstaff uuid := 'ba1d0333-725e-45f8-ad4a-2c9a808b74df';
  v_user uuid := gen_random_uuid(); v_org uuid := gen_random_uuid();
  v_shot text := '4e57f205-4dc6-4379-9d68-b66c3db151f8/registry_check/bl0502-test.png';
  v_auth text := '4e57f205-4dc6-4379-9d68-b66c3db151f8/registry_check/bl0502-auth.pdf';
  r jsonb; ok text[] := '{}'; bad text[] := '{}'; st text;
  good jsonb;
begin
  -- fixtures
  insert into auth.users(id, email, email_confirmed_at, aud, role) values (v_user, 'bl0502-' || left(v_user::text, 8) || '@bl0502test.com', now(), 'authenticated', 'authenticated');
  insert into public.organizations(id, kind, name, owner_user_id) values (v_org, 'shipper', 'BL0502 Test Registry Foods LLC', v_user);
  insert into public.organization_memberships(org_id, user_id, member_role, status) values (v_org, v_user, 'owner', 'active') on conflict do nothing;
  insert into app_private.shipper_trust(org_id, domain, free_mail, mx, site_ok) values (v_org, 'bl0502test.com', false, true, true)
    on conflict (org_id) do update set domain = excluded.domain, free_mail = false, mx = true, site_ok = true;
  insert into app_private.org_onboarding_items(org_id, item_key, status, data) values
    (v_org, 'legal_entity', 'verified', '{"legal_name":"BL0502 Test Registry Foods, L.L.C.","ein":"12-3456780","entity_type":"llc","state_of_formation":"CO","entity_number":"20261234567"}'),
    (v_org, 'physical_address', 'verified', '{"street":"123 Main St","city":"Denver","state":"CO","zip":"80202","mailing_same":true}'),
    (v_org, 'authorized_signer', 'verified', '{"name":"Jane Q Roe","title":"Manager","phone":"3035550100","email":"jane@bl0502test.com"}')
  on conflict (org_id, item_key) do update set data = excluded.data, status = excluded.status;
  insert into storage.objects(bucket_id, name, owner) values ('documents', v_shot, v_staff), ('documents', v_auth, v_staff);
  good := jsonb_build_object('state','CO','legal_name','BL0502 TEST REGISTRY FOODS LLC','entity_number','20261234567','status','active',
    'formation_date', (current_date - 400)::text, 'principal_address','123 MAIN ST, DENVER, CO 80202, US',
    'people', jsonb_build_array('Jane Roe (manager)','Bob Agent (registered agent)'), 'registry_url','https://www.coloradosos.gov/biz/BusinessEntityDetail.do?masterFileId=20261234567',
    'screenshot_path', v_shot, 'source','open_data');

  -- T0 normalizers
  if app_private.reg_norm_name('Acme Foods, L.L.C.') = app_private.reg_norm_name('ACME FOODS LLC') and app_private.reg_norm_id('0006436709') = app_private.reg_norm_id('6436709')
    then ok := ok || text 'T0 normalizers'; else bad := bad || text 'T0 normalizers'; end if;

  -- T1 non-staff refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_nonstaff, 'role', 'authenticated')::text, true);
  begin perform public.cc_shipper_registry_check(v_org, good, true); bad := bad || text 'T1 non-staff allowed';
  exception when others then if sqlstate = '42501' then ok := ok || text 'T1 non-staff 42501'; else bad := bad || ('T1 ' || sqlerrm); end if; end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  -- T2 identity gate lists registry_check before any check
  if (app_private.shipper_lane_gate(v_org, 'identity')->'missing') @> '[{"key":"registry_check"}]' then ok := ok || text 'T2 gate needs registry_check'; else bad := bad || text 'T2 gate'; end if;

  -- T3 wrong entity number → verify refused
  begin perform public.cc_shipper_registry_check(v_org, good || '{"entity_number":"20269999999"}', true); bad := bad || text 'T3 wrong number verified';
  exception when others then if sqlerrm like '%entity number does not match%' then ok := ok || text 'T3 wrong number refused'; else bad := bad || ('T3 ' || sqlerrm); end if; end;

  -- T4 direct review verify refused
  begin perform public.cc_onboarding_review_item(v_org, 'registry_check', 'verify', null); bad := bad || text 'T4 direct verify allowed';
  exception when others then if sqlerrm like 'Verify the registry check from its card%' then ok := ok || text 'T4 direct verify refused'; else bad := bad || ('T4 ' || sqlerrm); end if; end;

  -- T5 inactive / missing screenshot refused
  begin perform public.cc_shipper_registry_check(v_org, good || '{"status":"dissolved"}', true); bad := bad || text 'T5a dissolved verified';
  exception when others then if sqlerrm like '%not active%' then ok := ok || text 'T5a dissolved refused'; else bad := bad || ('T5a ' || sqlerrm); end if; end;
  begin perform public.cc_shipper_registry_check(v_org, good - 'screenshot_path', true); bad := bad || text 'T5b no screenshot verified';
  exception when others then if sqlerrm like '%Screenshot%' then ok := ok || text 'T5b no screenshot refused'; else bad := bad || ('T5b ' || sqlerrm); end if; end;
  begin perform public.cc_shipper_registry_check(v_org, good || '{"screenshot_path":"nope/x.png"}', false); bad := bad || text 'T5c fake file saved';
  exception when others then if sqlerrm like 'uploaded file not found%' then ok := ok || text 'T5c fake file refused'; else bad := bad || ('T5c ' || sqlerrm); end if; end;

  -- T6 address mismatch needs a reason
  begin perform public.cc_shipper_registry_check(v_org, good || '{"principal_address":"9 Other Rd, Boulder, CO 80301"}', true); bad := bad || text 'T6a addr verified';
  exception when others then if sqlerrm like '%not the registry address%' then ok := ok || text 'T6a address mismatch refused'; else bad := bad || ('T6a ' || sqlerrm); end if; end;

  -- T7 signer not listed → needs written authorization; callback route needs a confirmed call-back
  begin perform public.cc_shipper_registry_check(v_org, good || '{"people":["Bob Agent (registered agent)"]}', true); bad := bad || text 'T7a signer verified';
  exception when others then if sqlerrm like '%written authorization%' then ok := ok || text 'T7a signer missing refused'; else bad := bad || ('T7a ' || sqlerrm); end if; end;
  begin perform public.cc_shipper_registry_check(v_org, good || jsonb_build_object('people', jsonb_build_array('Bob Agent (registered agent)'),
      'signer_auth', jsonb_build_object('via','callback','file_path',v_auth,'note','Letter on company letterhead signed by Bob Agent')), true); bad := bad || text 'T7b callback not confirmed verified';
  exception when others then if sqlerrm like '%call-back, which is not confirmed%' then ok := ok || text 'T7b callback route needs confirmed call-back'; else bad := bad || ('T7b ' || sqlerrm); end if; end;

  -- T8 good record verifies
  r := public.cc_shipper_registry_check(v_org, good, true);
  st := app_private.shipper_item_status(v_org, 'registry_check');
  if st = 'verified' and not ((app_private.shipper_lane_gate(v_org, 'identity')->'missing') @> '[{"key":"registry_check"}]') then ok := ok || text 'T8 good record verified, gate clears it';
  else bad := bad || ('T8 status ' || st || ' ' || r::text); end if;
  if (r->'checks'->'warnings') @> '["Signer appears only as the registered agent, not as a manager or officer"]' then bad := bad || text 'T8b agent warning wrong'; else ok := ok || text 'T8b no agent warning for a manager'; end if;

  -- T9 shipper edits legal name → check drops to pending; restoring the answer restores it
  update app_private.org_onboarding_items set data = data || '{"legal_name":"Other Name LLC"}' where org_id = v_org and item_key = 'legal_entity';
  st := app_private.shipper_item_status(v_org, 'registry_check');
  if st = 'pending' then ok := ok || text 'T9a edited answer → pending'; else bad := bad || ('T9a ' || st); end if;

  -- T10 EIN letter while registry is stale → refused
  insert into app_private.org_onboarding_items(org_id, item_key, status, ref, submitted_at) values (v_org, 'ein_letter', 'submitted', 'x', now())
    on conflict (org_id, item_key) do update set status = 'submitted', submitted_at = now();
  begin perform public.cc_shipper_doc_verify(v_org, 'ein_letter', true, true); bad := bad || text 'T10 doc verified while stale';
  exception when others then if sqlerrm like 'Verify the state registry check first%' then ok := ok || text 'T10 doc refused while registry stale'; else bad := bad || ('T10 ' || sqlerrm); end if; end;
  update app_private.org_onboarding_items set data = data || '{"legal_name":"BL0502 Test Registry Foods, L.L.C."}' where org_id = v_org and item_key = 'legal_entity';
  if app_private.shipper_item_status(v_org, 'registry_check') = 'verified' then ok := ok || text 'T9b restored answer → verified'; else bad := bad || text 'T9b'; end if;

  -- T11 EIN: direct verify without tick refused; tick false refused; tick true verifies
  begin perform public.cc_onboarding_review_item(v_org, 'ein_letter', 'verify', null); bad := bad || text 'T11a no tick verified';
  exception when others then if sqlerrm like 'Tick that the name and address%' then ok := ok || text 'T11a no tick refused'; else bad := bad || ('T11a ' || sqlerrm); end if; end;
  begin perform public.cc_shipper_doc_verify(v_org, 'ein_letter', true, false); bad := bad || text 'T11b half tick verified';
  exception when others then if sqlerrm like 'Both must match%' then ok := ok || text 'T11b half tick refused'; else bad := bad || ('T11b ' || sqlerrm); end if; end;
  perform public.cc_shipper_doc_verify(v_org, 'ein_letter', true, true);
  if app_private.shipper_item_status(v_org, 'ein_letter') = 'verified' then ok := ok || text 'T11c tick verifies'; else bad := bad || text 'T11c'; end if;
  -- a re-upload after the tick needs a new tick
  update app_private.org_onboarding_items set status = 'submitted', submitted_at = now() + interval '1 second' where org_id = v_org and item_key = 'ein_letter';
  begin perform public.cc_onboarding_review_item(v_org, 'ein_letter', 'verify', null); bad := bad || text 'T11d old tick reused';
  exception when others then if sqlerrm like 'Tick that%' then ok := ok || text 'T11d re-upload needs a new tick'; else bad := bad || ('T11d ' || sqlerrm); end if; end;

  -- T12 shipper cannot submit a staff item
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{"x-lb-app":"partner"}', true);  -- the new auth user also gets a carrier org; pick the portal
  begin perform public.cc_onboarding_submit_item('independent_callback', 'x', null); bad := bad || text 'T12c shipper submitted call-back';
  exception when others then if sqlerrm like 'this item is not an upload%' then ok := ok || text 'T12c shipper cannot submit independent_callback'; else bad := bad || ('T12c ' || sqlerrm); end if; end;
  begin perform public.cc_onboarding_submit_item('registry_check', 'x', null); bad := bad || text 'T12 shipper submitted staff item';
  exception when others then if sqlerrm like 'this item is not an upload%' then ok := ok || text 'T12 shipper cannot submit staff item'; else bad := bad || ('T12 ' || sqlerrm); end if; end;
  begin perform public.cc_shipper_registry_check(v_org, good, true); bad := bad || text 'T12b shipper ran staff RPC';
  exception when others then if sqlstate = '42501' then ok := ok || text 'T12b shipper cannot run registry RPC'; else bad := bad || ('T12b ' || sqlerrm); end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  -- T13 SEC rule: name hit → confirmed email is 'submitted' until staff approve; a young domain cannot be approved
  update app_private.shipper_trust set company_email = 'jane@bl0502test.com', email_verified_at = now(),
    risk_signals = jsonb_build_object('sec_name_hit', true, 'sec_names', jsonb_build_array('BL0502 PARENT CORP'), 'rdap_created', (now() - interval '4 days')::text)
   where org_id = v_org;
  st := app_private.shipper_item_status(v_org, 'email_verify');
  if st = 'submitted' then ok := ok || text 'T13a SEC hit → email awaits staff'; else bad := bad || ('T13a ' || st); end if;
  begin perform public.cc_shipper_email_domain_approve(v_org, 'bl0502test.com', 'official_site', 'https://bl0502test.com/contact', 'listed on the contact page'); bad := bad || text 'T13b young domain approved';
  exception when others then if sqlerrm like '%too new%' then ok := ok || text 'T13b 4-day-old domain refused'; else bad := bad || ('T13b ' || sqlerrm); end if; end;
  begin perform public.cc_shipper_email_domain_approve(v_org, 'other.com', 'official_site', 'https://x.com', 'listed on the contact page'); bad := bad || text 'T13c wrong domain approved';
  exception when others then if sqlerrm like 'The confirmed inbox is on%' then ok := ok || text 'T13c wrong domain refused'; else bad := bad || ('T13c ' || sqlerrm); end if; end;
  update app_private.shipper_trust set risk_signals = risk_signals || jsonb_build_object('rdap_created', '2015-01-01T00:00:00Z') where org_id = v_org;
  perform public.cc_shipper_email_domain_approve(v_org, 'bl0502test.com', 'sec_filing', 'https://www.sec.gov/x', 'domain listed in the 10-K');
  st := app_private.shipper_item_status(v_org, 'email_verify');
  if st = 'verified' then ok := ok || text 'T13d approved domain → verified'; else bad := bad || ('T13d ' || st); end if;

  -- T14 SEC hit: registry verify needs the SEC company's number; a different number is a look-alike
  begin perform public.cc_shipper_registry_check(v_org, good, true); bad := bad || text 'T14a no SEC number verified';
  exception when others then if sqlerrm like '%record that company''s state entity number%' then ok := ok || text 'T14a SEC number required'; else bad := bad || ('T14a ' || sqlerrm); end if; end;
  begin perform public.cc_shipper_registry_check(v_org, good || '{"sec_entity_number":"2285944"}', true); bad := bad || text 'T14b look-alike verified';
  exception when others then if sqlerrm like '%NOT that company''s%' then ok := ok || text 'T14b look-alike refused'; else bad := bad || ('T14b ' || sqlerrm); end if; end;
  r := public.cc_shipper_registry_check(v_org, good || '{"sec_entity_number":"20261234567"}', true);
  if r->>'status' = 'verified' then ok := ok || text 'T14c same entity verifies'; else bad := bad || ('T14c ' || r::text); end if;

  -- T15 staff view carries the card
  r := public.cc_shipper_verification(v_org);
  if r->'registry'->>'status' = 'verified' and r->'registry'->'source'->>'od_dataset' = '4ykn-tg5h' and r->'email_domain'->>'approved' = 'bl0502test.com'
    then ok := ok || text 'T15 staff view registry + email_domain'; else bad := bad || ('T15 ' || left((r->'registry')::text, 200)); end if;

  raise exception 'BL0502_TEST passed=% failed=% | FAILED: % | PASSED: %', cardinality(ok), cardinality(bad), array_to_string(bad, ' ; '), array_to_string(ok, ' ; ');
end $$;
