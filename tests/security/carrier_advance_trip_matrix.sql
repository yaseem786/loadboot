-- carrier_advance_trip_matrix.sql
-- Server-side matrix for carrier trip advancement (cux_carrier_advance_trip), via JWT-claim simulation.
-- Saves + restores trip_A's status; RAISES on any failed expectation.

do $$
declare A constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1'; B constant uuid:='dd000000-0000-0000-0000-000000000001';
  tripA constant uuid:='ff000000-0000-0000-0000-000000000001'; orig text; fails text[]:='{}'; n int:=0; r text;
begin
  select status into orig from app_private.trips where id=tripA;
  update app_private.trips set status='dispatched', delivered_at=null where id=tripA;
  perform set_config('request.jwt.claims', json_build_object('sub',A,'role','authenticated')::text, true);
  begin r:=public.cc_pocket_advance_trip(tripA,'in_transit'); n:=n+1; if r<>'in_transit' then fails:=fails||'AV1'; end if; exception when others then fails:=fails||('AV1 '||SQLERRM); end;
  begin r:=public.cc_pocket_advance_trip(tripA,'delivered'); n:=n+1; if r<>'delivered' then fails:=fails||'AV2'; end if; exception when others then fails:=fails||('AV2 '||SQLERRM); end;
  begin perform public.cc_pocket_advance_trip(tripA,'in_transit'); fails:=fails||'AV3 backward should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_pocket_advance_trip(tripA,'paid'); fails:=fails||'AV4 finance state should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('sub',B,'role','authenticated')::text, true);
  begin perform public.cc_pocket_advance_trip(tripA,'delivered'); fails:=fails||'AV5 cross-carrier should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_pocket_advance_trip(tripA,'delivered'); fails:=fails||'AV6 anon should DENY'; exception when others then n:=n+1; end;
  update app_private.trips set status=orig where id=tripA;
  if array_length(fails,1) is not null then raise exception E'ADVANCE TRIP MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'ADVANCE TRIP MATRIX: PASS (% checks)', n;
end $$;
