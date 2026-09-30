-- bl_sec_0513 — the read-only QA bot (auditor) must be refused by every staff write RPC. PROD (qa-bot exists only there).
-- Every call runs inside one DO block that ends in RAISE, so the whole thing rolls back even if a gate is broken.
-- Expected: qa_writer=false, owner_writer=true, and every RPC reports "not authorized" / "staff only". "PASSED GATE" = bug.
do $t$
declare res jsonb := '{}'; z uuid := '00000000-0000-0000-0000-000000000000'; v jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"b7b28e16-608a-4ff7-9197-f763b80857e8","role":"authenticated"}', true);
  res := res || jsonb_build_object('owner_writer', app_private.is_staff_writer(), 'owner_fin', public.has_global_permission('finance.approve'));
  perform set_config('request.jwt.claims', '{"sub":"20b2ae25-d96e-4159-8640-23e1857130c2","role":"authenticated"}', true);
  res := res || jsonb_build_object('qa_writer', app_private.is_staff_writer(), 'qa_staff', public.is_active_staff());
  set local role authenticated;
  begin perform public.cc_review_accessorial(z,'approve',1,'x'); res:=res||'{"accessorial":"PASSED GATE"}'; exception when others then res:=res||jsonb_build_object('accessorial',SQLERRM); end;
  begin perform public.cc_review_accessorial(z,'reject',null,'x'); res:=res||'{"accessorial_rej":"PASSED GATE"}'; exception when others then res:=res||jsonb_build_object('accessorial_rej',SQLERRM); end;
  begin perform public.cc_org_set_docket(z,'123456',null); res:=res||'{"docket":"PASSED GATE"}'; exception when others then res:=res||jsonb_build_object('docket',SQLERRM); end;
  begin perform public.cc_packet_set_dates(z,'x',null,null); res:=res||'{"packet":"PASSED GATE"}'; exception when others then res:=res||jsonb_build_object('packet',SQLERRM); end;
  begin perform public.cc_load_checklist_set(z,'received'); res:=res||'{"checklist":"PASSED GATE"}'; exception when others then res:=res||jsonb_build_object('checklist',SQLERRM); end;
  begin perform public.cc_post_chat('x','x'); res:=res||'{"chat":"PASSED GATE"}'; exception when others then res:=res||jsonb_build_object('chat',SQLERRM); end;
  begin perform public.cc_record_document_file('carrier','x','x','x','x','x',1::bigint); res:=res||'{"docfile":"PASSED GATE"}'; exception when others then res:=res||jsonb_build_object('docfile',SQLERRM); end;
  begin perform public.cc_task_start(z); res:=res||'{"task":"PASSED GATE"}'; exception when others then res:=res||jsonb_build_object('task',SQLERRM); end;
  begin perform public.cc_admin_note('x','x','x'); res:=res||'{"admin_note":"PASSED GATE"}'; exception when others then res:=res||jsonb_build_object('admin_note',SQLERRM); end;
  begin perform public.cc_retry_webhook_delivery(z); res:=res||'{"webhook":"PASSED GATE"}'; exception when others then res:=res||jsonb_build_object('webhook',SQLERRM); end;
  begin v := public.cc_email_broker_verify(z,true); res:=res||jsonb_build_object('broker_verify',v); exception when others then res:=res||jsonb_build_object('broker_verify',SQLERRM); end;
  -- cc_decide_book_request looks the request up before its staff check; it is covered by qa_writer=false above.
  raise exception 'RESULT %', res;
end $t$;
-- 30 Sep 2026 prod result: every RPC "not authorized" (admin_note / broker_verify "staff only"), qa_writer=false, owner_writer=true.
