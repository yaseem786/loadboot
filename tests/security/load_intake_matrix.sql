-- load_intake_matrix.sql — Increment 43. Source-attributed load creation + intake list + verification.
-- Run against STAGING. RAISES on failure; prints LOAD INTAKE MATRIX: PASS.
do $$
declare reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'; carrier constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  v_id uuid; v_cnt int; v_ver text; fails text[]:='{}'; n int:=0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin perform public.cc_create_load_sourced(jsonb_build_object('origin','Dallas, TX','destination','Atlanta, GA')); fails:=fails||'L1 missing source_type should raise'; exception when others then n:=n+1; end;
  begin v_id := public.cc_create_load_sourced(jsonb_build_object('origin','Dallas, TX','destination','Atlanta, GA','equipment','Dry Van','rate','2450','miles','780','source_type','staff_entered','verification_state','partial','confidence','high')); n:=n+1;
    if v_id is null then fails:=fails||'L2 null id'; end if; exception when others then fails:=fails||('L2 '||SQLERRM); end;
  begin perform public.cc_create_load_sourced(jsonb_build_object('origin','A','destination','B','source_type','magic')); fails:=fails||'L3 invalid source should raise'; exception when others then n:=n+1; end;
  begin select count(*) into v_cnt from public.cc_load_intake_list('staff_entered',null,null,50) where id=v_id; n:=n+1; if v_cnt<>1 then fails:=fails||('L4 '||v_cnt::text); end if; exception when others then fails:=fails||('L4 '||SQLERRM); end;
  begin perform public.cc_load_set_verification(v_id,'verified','high'); n:=n+1; select verification_state into v_ver from public.loads where id=v_id; if v_ver<>'verified' then fails:=fails||('L5 '||v_ver); end if; exception when others then fails:=fails||('L5 '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_create_load_sourced(jsonb_build_object('origin','A','destination','B','source_type','staff_entered')); fails:=fails||'L6 carrier create DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_load_intake_list(null,null,null,10); fails:=fails||'L6b carrier list DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_load_intake_list(null,null,null,10); fails:=fails||'L7 anon DENY'; exception when others then n:=n+1; end;
  delete from public.loads where id=v_id;
  if array_length(fails,1) is not null then raise exception E'LOAD INTAKE MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'LOAD INTAKE MATRIX: PASS (% checks)', n;
end $$;
