-- offers_matrix.sql — Increment 47. Offer waves, expiry, carrier response. Run against STAGING.
-- Carrier persona 33ff... / org cc000000-...-0001; other user dd000000-...-0001.
do $$
declare reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  carrierUser constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1'; carrierOrg constant uuid:='cc000000-0000-0000-0000-000000000001';
  otherUser constant uuid:='dd000000-0000-0000-0000-000000000001';
  v_load uuid; v jsonb; v_off uuid; v_st text; v_cnt int; fails text[]:='{}'; n int:=0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  v_load := public.cc_create_load_sourced(jsonb_build_object('origin','OFF-A','destination','OFF-B','equipment','Dry Van','rate','2000','miles','500','source_type','staff_entered'));
  begin v := public.cc_offer_send(v_load, array[carrierOrg, gen_random_uuid()], 2100, 60); n:=n+1;
    if (v->>'skipped_ineligible')::int < 1 then fails:=fails||('O1 '||v::text); end if; exception when others then fails:=fails||('O1 '||SQLERRM); end;
  insert into app_private.load_offers(load_id,carrier_id,offered_rate,expiry_at,status) values (v_load, carrierOrg, 2100, now()+interval '1 hour','sent')
    on conflict (load_id,carrier_id) do update set status='sent', expiry_at=now()+interval '1 hour', responded_at=null;
  select id into v_off from app_private.load_offers where load_id=v_load and carrier_id=carrierOrg;
  perform set_config('request.jwt.claims', json_build_object('sub',carrierUser,'role','authenticated')::text, true);
  begin v := public.cc_offer_respond(v_off,'view'); n:=n+1; select status into v_st from app_private.load_offers where id=v_off; if v_st<>'viewed' then fails:=fails||('O2 '||v_st); end if; exception when others then fails:=fails||('O2 '||SQLERRM); end;
  begin v := public.cc_offer_respond(v_off,'counter',null,2300,'Need 2300'); n:=n+1; select status into v_st from app_private.load_offers where id=v_off; if v_st<>'countered' then fails:=fails||('O3 '||v_st); end if; exception when others then fails:=fails||('O3 '||SQLERRM); end;
  begin v := public.cc_offer_respond(v_off,'accept'); n:=n+1; select status into v_st from app_private.load_offers where id=v_off; if v_st<>'accepted' then fails:=fails||('O4 '||v_st); end if; exception when others then fails:=fails||('O4 '||SQLERRM); end;
  begin perform public.cc_offer_respond(v_off,'decline'); fails:=fails||'O5 respond-after-accept raise'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('sub',otherUser,'role','authenticated')::text, true);
  begin perform public.cc_offer_respond(v_off,'view'); fails:=fails||'O6 cross-carrier DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin select count(*) into v_cnt from public.cc_load_offers(v_load); n:=n+1; if v_cnt<1 then fails:=fails||'O7 empty'; end if; exception when others then fails:=fails||('O7 '||SQLERRM); end;
  update app_private.load_offers set status='sent', expiry_at=now()-interval '1 minute' where id=v_off;
  begin select public.cc_offers_expire() into v_cnt; n:=n+1; if v_cnt<1 then fails:=fails||'O8 expire 0'; end if;
    select status into v_st from app_private.load_offers where id=v_off; if v_st<>'expired' then fails:=fails||('O8b '||v_st); end if; exception when others then fails:=fails||('O8 '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_offer_send(v_load, array[carrierOrg], 2000, 60); fails:=fails||'O9 anon DENY'; exception when others then n:=n+1; end;
  delete from app_private.load_offers where load_id=v_load; delete from public.loads where id=v_load;
  if array_length(fails,1) is not null then raise exception E'OFFERS MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'OFFERS MATRIX: PASS (% checks)', n;
end $$;
