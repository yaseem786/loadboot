-- carrier_team_matrix.sql
-- Server-side matrix for carrier team management (cus_carrier_team), via JWT-claim simulation.
-- Personas (staging seed): owner_u = carrier A owner, drv_u = carrier A driver member, B_owner = carrier B owner.
-- Restores any mutated state; RAISES on any failed expectation, prints PASS otherwise.

do $$
declare
  owner_u constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  drv_u   constant uuid:='ea9ca61f-ec02-4006-a9de-429aa0013da7';
  B_owner constant uuid:='dd000000-0000-0000-0000-000000000001';
  v_n int; fails text[]:='{}'; n int:=0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',owner_u,'role','authenticated')::text, true);
  begin select count(*) into v_n from public.cc_pocket_team(); n:=n+1; if v_n<2 then fails:=fails||('TM1 team count '||v_n); end if; exception when others then fails:=fails||('TM1 '||SQLERRM); end;
  begin perform public.cc_pocket_set_member(drv_u,'manager',null); n:=n+1; exception when others then fails:=fails||('TM2 role change: '||SQLERRM); end;
  begin perform public.cc_pocket_set_member(drv_u,null,'suspended'); n:=n+1; exception when others then fails:=fails||('TM3 suspend: '||SQLERRM); end;
  perform public.cc_pocket_set_member(drv_u,'driver','active'); -- restore
  begin perform public.cc_pocket_set_member(drv_u,'staff',null); fails:=fails||'TM4 staff role should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_pocket_set_member(owner_u,null,'suspended'); fails:=fails||'TM5 self-modify should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('sub',drv_u,'role','authenticated')::text, true);
  begin perform public.cc_pocket_set_member(owner_u,'driver',null); fails:=fails||'TM6 non-owner manage should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('sub',B_owner,'role','authenticated')::text, true);
  begin perform public.cc_pocket_set_member(drv_u,'manager',null); fails:=fails||'TM7 cross-org manage should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_pocket_team(); fails:=fails||'TM8 anon view should DENY'; exception when others then n:=n+1; end;
  if array_length(fails,1) is not null then raise exception E'CARRIER TEAM MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'CARRIER TEAM MATRIX: PASS (% checks)', n;
end $$;
