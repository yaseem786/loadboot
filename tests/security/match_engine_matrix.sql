-- match_engine_matrix.sql — Increments 45 (eligibility) + 46 (explainable ranking). Run against STAGING.
do $$
declare reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'; carrier constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  v_load uuid; v_total int; v_ok int; v_bad int; v_cons int; fails text[]:='{}'; n int:=0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  v_load := public.cc_create_load_sourced(jsonb_build_object('origin','MATCH-A','destination','MATCH-B','equipment','Dry Van','rate','2400','miles','800','source_type','staff_entered'));
  -- eligibility consistency
  begin select count(*), count(*) filter (where eligible), count(*) filter (where eligible=(coalesce(array_length(hard_fails,1),0)=0))
      into v_total, v_ok, v_cons from public.cc_match_eligibility(v_load); n:=n+1;
    if v_total=0 then fails:=fails||'E1 no rows'; end if;
    if v_cons<>v_total then fails:=fails||('E1b inconsistent '||v_cons||'/'||v_total); end if; exception when others then fails:=fails||('E1 '||SQLERRM); end;
  begin select count(*) into v_bad from public.cc_match_eligibility(v_load) where not eligible and coalesce(array_length(hard_fails,1),0)=0; n:=n+1;
    if v_bad<>0 then fails:=fails||('E2 ineligible w/o reason '||v_bad::text); end if; exception when others then fails:=fails||('E2 '||SQLERRM); end;
  -- ranking: score = factor sum; only eligible ranked; rpm=3.00
  begin select count(*) into v_bad from (select rr.score sc, (select sum((f->>'points')::int) from jsonb_array_elements(rr.factors) f) fsum from public.cc_match_rank(v_load) rr) x where sc<>fsum; n:=n+1;
    if v_bad<>0 then fails:=fails||('R1 score!=sum '||v_bad::text); end if; exception when others then fails:=fails||('R1 '||SQLERRM); end;
  begin select count(*) into v_bad from public.cc_match_rank(v_load) rk where not exists (select 1 from public.cc_match_eligibility(v_load) el where el.carrier_id=rk.carrier_id and el.eligible); n:=n+1;
    if v_bad<>0 then fails:=fails||('R2 ranked ineligible '||v_bad::text); end if; exception when others then fails:=fails||('R2 '||SQLERRM); end;
  begin select count(*) into v_bad from public.cc_match_rank(v_load) where loaded_rpm is distinct from 3.00; n:=n+1;
    if v_bad<>0 then fails:=fails||('R3 rpm '||v_bad::text); end if; exception when others then fails:=fails||('R3 '||SQLERRM); end;
  -- denials
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_match_eligibility(v_load); fails:=fails||'D1 carrier elig DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_match_rank(v_load); fails:=fails||'D2 carrier rank DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_match_rank(v_load); fails:=fails||'D3 anon DENY'; exception when others then n:=n+1; end;
  delete from public.loads where id=v_load;
  if array_length(fails,1) is not null then raise exception E'MATCH ENGINE MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'MATCH ENGINE MATRIX: PASS (% checks)', n;
end $$;
