-- carrier_assign_matrix.sql
-- Server-side matrix for carrier trip assignment (cut_carrier_assign_trip), via JWT-claim simulation.
-- Seeds a disposable driver/truck for carrier A, exercises assignment, and cleans up. RAISES on failure.

do $$
declare
  A constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  B constant uuid:='dd000000-0000-0000-0000-000000000001';
  tripA constant uuid:='ff000000-0000-0000-0000-000000000001';
  tripB constant uuid:='ff000000-0000-0000-0000-000000000002';
  drvA uuid; trkA uuid; fails text[]:='{}'; n int:=0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',A,'role','authenticated')::text, true);
  drvA:=public.cc_pocket_upsert_driver(null,'ASSIGNDRV','1',null,null,null,null,null);
  trkA:=public.cc_pocket_upsert_truck(null,'ASSIGNUNIT',null,null,'Dry Van');
  begin perform public.cc_pocket_assign_trip(tripA, drvA, trkA); n:=n+1; exception when others then fails:=fails||('AS1 own assign: '||SQLERRM); end;
  begin perform public.cc_pocket_assign_trip(tripB, drvA, null); fails:=fails||'AS2 assign to other trip should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_pocket_assign_trip(tripA, '00000000-0000-0000-0000-0000000000aa', null); fails:=fails||'AS3 foreign driver should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('sub',B,'role','authenticated')::text, true);
  begin perform public.cc_pocket_assign_trip(tripB, drvA, null); fails:=fails||'AS4 cross-carrier driver should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_pocket_assign_trip(tripA, null, null); fails:=fails||'AS5 anon should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('sub',A,'role','authenticated')::text, true);
  update app_private.trips set driver_id=null, truck_id=null where id=tripA;
  delete from app_private.fleet_drivers where name='ASSIGNDRV';
  delete from app_private.fleet_trucks where unit_no='ASSIGNUNIT';
  if array_length(fails,1) is not null then raise exception E'CARRIER ASSIGN MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'CARRIER ASSIGN MATRIX: PASS (% checks)', n;
end $$;
