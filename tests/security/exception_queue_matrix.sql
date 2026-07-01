-- exception_queue_matrix.sql
-- Server-side matrix for the staff exception queue (cuu_staff_exception_queue), via JWT-claim simulation.
-- staff = dispatch.manage user; carrier = carrier A owner. Seeds one exception, exercises RBAC + resolve,
-- cleans up. RAISES on any failed expectation.

do $$
declare
  staff   constant uuid:='44444444-4444-4444-4444-444444444444';
  carrier constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  tripA   constant uuid:='ff000000-0000-0000-0000-000000000001';
  v_ex uuid; v_n int; fails text[]:='{}'; n int:=0; v_res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  v_ex := public.cc_pocket_report_issue(tripA,'detention','EXQTEST detention');

  perform set_config('request.jwt.claims', json_build_object('sub',staff,'role','authenticated')::text, true);
  begin select count(*) into v_n from public.cc_list_exceptions('open',200) where id=v_ex; n:=n+1; if v_n<1 then fails:=fails||'EX1 staff should see open exception'; end if; exception when others then fails:=fails||('EX1 '||SQLERRM); end;

  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_list_exceptions('open',10); fails:=fails||'EX2 carrier list should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_resolve_exception(v_ex,'x'); fails:=fails||'EX3 carrier resolve should DENY'; exception when others then n:=n+1; end;

  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_list_exceptions('open',10); fails:=fails||'EX4 anon list should DENY'; exception when others then n:=n+1; end;

  perform set_config('request.jwt.claims', json_build_object('sub',staff,'role','authenticated')::text, true);
  begin v_res:=public.cc_resolve_exception(v_ex,'Handled with broker'); n:=n+1; if v_res<>'resolved' then fails:=fails||'EX5 resolve return'; end if;
    v_res:=public.cc_resolve_exception(v_ex,'again'); if v_res<>'resolved' then fails:=fails||'EX6 idempotent resolve'; end if;
  exception when others then fails:=fails||('EX5 resolve: '||SQLERRM); end;
  begin select count(*) into v_n from public.cc_list_exceptions('resolved',200) where id=v_ex; n:=n+1; if v_n<1 then fails:=fails||'EX7 should be in resolved list'; end if; exception when others then fails:=fails||('EX7 '||SQLERRM); end;

  delete from app_private.trip_exceptions where id=v_ex;
  if array_length(fails,1) is not null then raise exception E'EXCEPTION QUEUE MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'EXCEPTION QUEUE MATRIX: PASS (% checks)', n;
end $$;
