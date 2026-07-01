-- carrier_fleet_matrix.sql
-- Server-side matrix for carrier self-service fleet (cuq_carrier_self_fleet), via JWT-claim simulation.
-- Runs in ONE transaction; RAISES on any failed expectation (rolls back), prints PASS otherwise.
-- Personas (staging seed): A_owner=carrier A owner (org cc..0001), B_owner=carrier B owner (org cc..0009).

do $$
declare
  A_owner constant uuid := '33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  B_owner constant uuid := 'dd000000-0000-0000-0000-000000000001';
  v_drv uuid; v_trk uuid; v_n int; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.fleet_drivers where name like 'TESTDRV%';
  delete from app_private.fleet_trucks where unit_no like 'TESTUNIT%';

  -- A adds a driver + truck (own account) -> PASS
  perform set_config('request.jwt.claims', json_build_object('sub',A_owner,'role','authenticated')::text, true);
  begin v_drv:=public.cc_pocket_upsert_driver(null,'TESTDRV One','555','a@b.co','DL1','TX',null,null); n:=n+1; if v_drv is null then fails:=fails||'D1 add driver null'; end if;
  exception when others then fails:=fails||('D1 add driver: '||SQLERRM); end;
  begin v_trk:=public.cc_pocket_upsert_truck(null,'TESTUNIT-100','PLT1','VIN1','Dry Van'); n:=n+1; if v_trk is null then fails:=fails||'T1 add truck null'; end if;
  exception when others then fails:=fails||('T1 add truck: '||SQLERRM); end;

  -- A lists own -> sees at least 1
  begin select count(*) into v_n from public.cc_pocket_drivers() where name like 'TESTDRV%'; n:=n+1; if v_n<1 then fails:=fails||'D2 list own drivers'; end if; exception when others then fails:=fails||('D2 '||SQLERRM); end;

  -- driver/truck name/unit required -> DENIED
  begin perform public.cc_pocket_upsert_driver(null,'   '); fails:=fails||'D-req blank name should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_pocket_upsert_truck(null,''); fails:=fails||'T-req blank unit should DENY'; exception when others then n:=n+1; end;

  -- B cannot edit A's driver / truck -> DENIED
  perform set_config('request.jwt.claims', json_build_object('sub',B_owner,'role','authenticated')::text, true);
  begin perform public.cc_pocket_upsert_driver(v_drv,'HACKED'); fails:=fails||'D3 cross-carrier driver edit should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_pocket_upsert_truck(v_trk,'HACKED'); fails:=fails||'T3 cross-carrier truck edit should DENY'; exception when others then n:=n+1; end;

  -- B does not see A's driver in own list
  begin select count(*) into v_n from public.cc_pocket_drivers() where id=v_drv; n:=n+1; if v_n<>0 then fails:=fails||'D4 B should not see A driver'; end if; exception when others then fails:=fails||('D4 '||SQLERRM); end;

  -- anon denied
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_pocket_drivers(); fails:=fails||'D5 anon list should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_pocket_upsert_driver(null,'x'); fails:=fails||'D6 anon add should DENY'; exception when others then n:=n+1; end;

  -- A edits own driver -> PASS
  perform set_config('request.jwt.claims', json_build_object('sub',A_owner,'role','authenticated')::text, true);
  begin perform public.cc_pocket_upsert_driver(v_drv,'TESTDRV One Edited'); n:=n+1; exception when others then fails:=fails||('D7 own edit: '||SQLERRM); end;

  delete from app_private.fleet_drivers where name like 'TESTDRV%';
  delete from app_private.fleet_trucks where unit_no like 'TESTUNIT%';
  if array_length(fails,1) is not null then raise exception E'CARRIER FLEET MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'CARRIER FLEET MATRIX: PASS (% checks)', n;
end $$;
