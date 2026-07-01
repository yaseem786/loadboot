-- booking_matrix.sql — Increments 48+49. Transactional first-valid-acceptance booking. Run against STAGING.
-- Personas: reviewer aaaa...a1 (staff); Ironhide user 11111111-...-101 / org f2e3d0fa-...; Golden user a0000000-...-009 / org efc5a051-...
do $$
declare reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  ironUser constant uuid:='11111111-1111-1111-1111-111111111101'; ironOrg constant uuid:='f2e3d0fa-6631-4999-91b9-73734b53e9ed';
  goldUser constant uuid:='a0000000-0000-4000-8000-000000000009'; goldOrg constant uuid:='efc5a051-5b63-4a55-98ff-d843c7e4f6fe';
  v_load uuid; v_load2 uuid; v jsonb; v_offI uuid; v_offG uuid; v_off2 uuid; v_st text; v_cnt int; fails text[]:='{}'; n int:=0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  v_load  := public.cc_create_load_sourced(jsonb_build_object('origin','BOOK-A','destination','BOOK-B','equipment','Dry Van','rate','2400','miles','800','source_type','staff_entered'));
  v_load2 := public.cc_create_load_sourced(jsonb_build_object('origin','BOOK2-A','destination','BOOK2-B','equipment','Dry Van','rate','1500','miles','400','source_type','staff_entered'));
  perform public.cc_offer_send(v_load, array[ironOrg, goldOrg], 2500, 60);
  perform public.cc_offer_send(v_load2, array[ironOrg], 1600, 60);
  select id into v_offI from app_private.load_offers where load_id=v_load and carrier_id=ironOrg;
  select id into v_offG from app_private.load_offers where load_id=v_load and carrier_id=goldOrg;
  select id into v_off2 from app_private.load_offers where load_id=v_load2 and carrier_id=ironOrg;
  begin n:=n+1; if v_offI is null or v_offG is null or v_off2 is null then fails:=fails||'B0 offers missing'; end if; end;
  perform public.cc_load_set_verification(v_load2, 'verified', 'high');
  perform set_config('request.jwt.claims', json_build_object('sub',ironUser,'role','authenticated')::text, true);
  begin perform public.cc_offer_respond(v_off2,'accept'); fails:=fails||'B1 stale accept should reject'; exception when others then n:=n+1; end;
  begin select status into v_st from public.loads where id=v_load2; n:=n+1; if v_st='booked' then fails:=fails||'B1b stale booked'; end if; end;
  begin v := public.cc_offer_respond(v_offI,'accept'); n:=n+1; if (v->>'booked')<>'true' then fails:=fails||('B2 '||v::text); end if; exception when others then fails:=fails||('B2 '||SQLERRM); end;
  begin select status into v_st from public.loads where id=v_load; n:=n+1; if v_st<>'booked' then fails:=fails||('B3 '||v_st); end if; end;
  begin select count(*) into v_cnt from app_private.trips where load_id=v_load; n:=n+1; if v_cnt<>1 then fails:=fails||('B4 trips '||v_cnt::text); end if; end;
  begin select status into v_st from app_private.load_offers where id=v_offG; n:=n+1; if v_st<>'expired' then fails:=fails||('B5 '||v_st); end if; end;
  begin select count(*) into v_cnt from app_private.load_document_checklist where subject_type='load' and subject_id=v_load; n:=n+1; if v_cnt<>8 then fails:=fails||('B6 '||v_cnt::text); end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub',goldUser,'role','authenticated')::text, true);
  begin perform public.cc_offer_respond(v_offG,'accept'); fails:=fails||'B7 expired accept reject'; exception when others then n:=n+1; end;
  update app_private.load_offers set status='sent', expiry_at=now()+interval '1 hour', responded_at=null where id=v_offG;
  begin perform public.cc_offer_respond(v_offG,'accept'); fails:=fails||'B8 booked-load accept reject'; exception when others then n:=n+1; end;
  begin select count(*) into v_cnt from app_private.trips where load_id=v_load; n:=n+1; if v_cnt<>1 then fails:=fails||('B8b double trip '||v_cnt::text); end if; end;
  perform set_config('request.jwt.claims', json_build_object('sub',ironUser,'role','authenticated')::text, true);
  begin v := public.cc_booking_status(v_load); n:=n+1; if (v->>'checklist_complete')<>'false' or (v->'trip'->>'id') is null then fails:=fails||('B9 '||v::text); end if; exception when others then fails:=fails||('B9 '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('sub',goldUser,'role','authenticated')::text, true);
  begin perform public.cc_booking_status(v_load); fails:=fails||'B10 loser DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_booking_status(v_load); fails:=fails||'B11 anon DENY'; exception when others then n:=n+1; end;
  delete from app_private.load_document_checklist where subject_id in (v_load, v_load2);
  delete from app_private.trips where load_id in (v_load, v_load2);
  delete from app_private.load_offers where load_id in (v_load, v_load2);
  delete from public.loads where id in (v_load, v_load2);
  if array_length(fails,1) is not null then raise exception E'BOOKING MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'BOOKING MATRIX: PASS (% checks)', n;
end $$;
