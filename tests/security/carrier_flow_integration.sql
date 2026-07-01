-- carrier_flow_integration.sql
-- End-to-end proof that the carrier self-service increments COMPOSE: a trip goes
-- dispatched -> confirm -> in_transit -> delivered -> POD upload -> staff review queue -> approve ->
-- invoice.prep_requested (exactly once). Via JWT-claim simulation on staging. Restores trip state + cleans up.

do $$
declare
  A constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  trip constant uuid:='ff000000-0000-0000-0000-000000000001';
  orig text; v_doc uuid; v_ev int; fails text[]:='{}'; n int:=0; path text;
begin
  select status into orig from app_private.trips where id=trip;
  update app_private.trips set status='dispatched', delivered_at=null where id=trip;
  delete from app_private.document_files where file_name like 'FLOWTEST%';

  perform set_config('request.jwt.claims', json_build_object('sub',A,'role','authenticated')::text, true);
  perform public.cc_pocket_confirm_trip(trip); n:=n+1;
  perform public.cc_pocket_advance_trip(trip,'in_transit'); n:=n+1;
  perform public.cc_pocket_advance_trip(trip,'delivered'); n:=n+1;

  path := A::text||'/pod/'||trip::text||'/flow.pdf';
  v_doc := public.cc_pocket_upload_pod(trip, path, 'FLOWTEST.pdf', 'application/pdf', 111000); n:=n+1;
  if v_doc is null then fails:=fails||'FLOW: POD upload failed'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  perform 1 from public.cc_pod_review_queue('pending',200) where id=v_doc; if not found then fails:=fails||'FLOW: POD not in review queue'; end if; n:=n+1;
  perform public.cc_review_pod(v_doc,'approved',null); n:=n+1;

  select count(*) into v_ev from app_private.domain_events where event_type='invoice.prep_requested' and payload->>'document'=v_doc::text;
  if v_ev<>1 then fails:=fails||('FLOW: invoice.prep_requested count '||v_ev); end if; n:=n+1;

  delete from app_private.document_files where file_name like 'FLOWTEST%';
  update app_private.trips set status=orig, delivered_at=null where id=trip;
  if array_length(fails,1) is not null then raise exception E'END-TO-END CARRIER FLOW: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'END-TO-END CARRIER FLOW: PASS (% steps)', n;
end $$;
