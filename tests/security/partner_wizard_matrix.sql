-- partner_wizard_matrix.sql — Increment 44. Broker Load Wizard submission + duplicate detection + checklist.
-- Run against STAGING. Broker persona 253abb41-... / org cc000000-...-0002 (Persona Broker LLC).
do $$
declare broker constant uuid:='253abb41-5b01-4b32-8c29-e84e0dfda450';
  reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'; carrier constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  v jsonb; v_id uuid; v_cnt int; v_item uuid; v_st text; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.load_document_checklist where subject_id in (select id from app_private.partner_loads where origin='WZ-Origin');
  delete from app_private.partner_loads where origin='WZ-Origin';
  perform set_config('request.jwt.claims', json_build_object('sub',broker,'role','authenticated')::text, true);
  begin v := public.cc_partner_submit_load(jsonb_build_object('origin','WZ-Origin','destination','WZ-Dest','equipment','Reefer','rate','3100','miles','1200','pickup_date','2026-08-01','appointment_required',true)); n:=n+1;
    v_id := (v->>'id')::uuid; if v_id is null or (v->>'status')<>'submitted' then fails:=fails||('W1 '||v::text); end if; exception when others then fails:=fails||('W1 '||SQLERRM); end;
  begin select count(*) into v_cnt from public.cc_load_checklist('partner_load', v_id); n:=n+1; if v_cnt<>5 then fails:=fails||('W2 '||v_cnt::text); end if; exception when others then fails:=fails||('W2 '||SQLERRM); end;
  begin perform public.cc_partner_submit_load(jsonb_build_object('origin','WZ-Origin','destination','WZ-Dest','pickup_date','2026-08-01')); fails:=fails||'W3 dup blocked'; exception when others then n:=n+1; end;
  begin v := public.cc_partner_submit_load(jsonb_build_object('origin','WZ-Origin','destination','WZ-Dest','pickup_date','2026-08-01','confirm_duplicate','true')); n:=n+1; if (v->>'duplicate_flagged')<>'true' then fails:=fails||('W4 '||v::text); end if; exception when others then fails:=fails||('W4 '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin select id into v_item from public.cc_load_checklist('partner_load', v_id) limit 1; n:=n+1;
    perform public.cc_load_checklist_set(v_item,'received');
    select status into v_st from app_private.load_document_checklist where id=v_item; if v_st<>'received' then fails:=fails||('W5 '||v_st); end if; exception when others then fails:=fails||('W5 '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_load_checklist('partner_load', v_id); fails:=fails||'W6 carrier read DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_load_checklist_set(v_item,'verified'); fails:=fails||'W6b carrier set DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_partner_submit_load(jsonb_build_object('origin','X','destination','Y')); fails:=fails||'W7 anon DENY'; exception when others then n:=n+1; end;
  delete from app_private.load_document_checklist where subject_id in (select id from app_private.partner_loads where origin='WZ-Origin');
  delete from app_private.partner_loads where origin='WZ-Origin';
  if array_length(fails,1) is not null then raise exception E'PARTNER WIZARD MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'PARTNER WIZARD MATRIX: PASS (% checks)', n;
end $$;
