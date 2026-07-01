-- pod_backend_matrix.sql
-- Deterministic server-side POD security & failure matrix, proven via JWT-claim simulation.
-- Run against STAGING (snslhvmkjusozgjelghi). The whole matrix runs inside ONE DO block, i.e. one
-- transaction: on PASS every tagged fixture is cleaned up and committed; on any failed expectation the
-- block RAISES, which rolls the entire transaction back (including the temporary trip-state flip), so
-- the database is never left dirty either way.
--
-- Identities are simulated with set_config('request.jwt.claims', ...) so auth.uid() resolves through the
-- SECURITY DEFINER RPCs exactly as a real logged-in user would.
--
-- Personas (staging seed):
--   A_owner   = 33ff093f-4cf5-48b1-934e-8fe1fe6904d1  (Carrier A owner)  trip_A delivered
--   B_owner   = dd000000-0000-0000-0000-000000000001  (Carrier B owner)  trip_B delivered
--   reviewer  = aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1  (staff: dispatch/finance/compliance.manage)
--   A_owner also serves as an authenticated NON-reviewer for review-authorization tests.
--
-- Covers directive section D checks 1,3,5,6,7,8,9,10,11,13,14,15,16,17,18,20 at the backend layer.
-- Checks 2 (assigned driver), 4 (non-assigned driver), 12 (expired signed URL) and 19 (browser network
-- failure) are proven at the browser layer (tests/security/pod_workflow.spec.js), because they depend on
-- Auth driver identity / Storage signed-URL TTL / client network state that SQL simulation cannot exercise.
--
-- Exit contract: RAISES on the first failed expectation; prints 'POD BACKEND MATRIX: PASS (N checks)'.

do $$
declare
  A_owner   constant uuid := '33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  B_owner   constant uuid := 'dd000000-0000-0000-0000-000000000001';
  reviewer  constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  trip_A    constant uuid := 'ff000000-0000-0000-0000-000000000001';
  trip_B    constant uuid := 'ff000000-0000-0000-0000-000000000002';
  v_doc uuid; v_doc2 uuid; v_doc3 uuid; v_doc4 uuid;
  v_ref jsonb; v_res text; v_n int; fails text[] := '{}'; n_checks int := 0; v_note text;
begin
  delete from app_private.document_files where file_name like 'TESTPOD%';

  -- 1. assigned carrier owner uploads valid POD -> PASS
  perform set_config('request.jwt.claims', json_build_object('sub',A_owner,'role','authenticated')::text, true);
  begin v_doc := public.cc_pocket_upload_pod(trip_A, A_owner::text||'/pod/'||trip_A::text||'/tp1.pdf', 'TESTPOD-valid.pdf', 'application/pdf', 120000);
    n_checks:=n_checks+1; if v_doc is null then fails:=fails||'T1 null'; end if;
  exception when others then fails:=fails||('T1 valid upload should PASS: '||SQLERRM); end;

  -- 3. different carrier uploads to A's trip -> DENIED
  perform set_config('request.jwt.claims', json_build_object('sub',B_owner,'role','authenticated')::text, true);
  begin perform public.cc_pocket_upload_pod(trip_A, B_owner::text||'/pod/'||trip_A::text||'/x.pdf', 'TESTPOD-cross.pdf', 'application/pdf', 100);
    fails:=fails||'T3 cross-carrier should DENY'; exception when others then n_checks:=n_checks+1; end;

  -- 5. anonymous upload -> DENIED
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_pocket_upload_pod(trip_A, 'anon/pod/'||trip_A::text||'/a.pdf', 'TESTPOD-anon.pdf', 'application/pdf', 100);
    fails:=fails||'T5 anon should DENY'; exception when others then n_checks:=n_checks+1; end;

  -- 6. unsupported MIME -> DENIED
  perform set_config('request.jwt.claims', json_build_object('sub',A_owner,'role','authenticated')::text, true);
  begin perform public.cc_pocket_upload_pod(trip_A, A_owner::text||'/pod/'||trip_A::text||'/e.exe', 'TESTPOD.exe', 'application/x-msdownload', 100);
    fails:=fails||'T6 unsupported MIME should DENY'; exception when others then n_checks:=n_checks+1; end;

  -- 7. oversized file -> DENIED
  begin perform public.cc_pocket_upload_pod(trip_A, A_owner::text||'/pod/'||trip_A::text||'/big.pdf', 'TESTPOD-big.pdf', 'application/pdf', 10485761);
    fails:=fails||'T7 oversized should DENY'; exception when others then n_checks:=n_checks+1; end;

  -- 10. malformed object path (traversal + wrong-trip prefix) -> DENIED
  begin perform public.cc_pocket_upload_pod(trip_A, '../../etc/passwd', 'TESTPOD-path.pdf', 'application/pdf', 100);
    fails:=fails||'T10 malformed path should DENY'; exception when others then n_checks:=n_checks+1; end;
  begin perform public.cc_pocket_upload_pod(trip_A, A_owner::text||'/pod/'||trip_B::text||'/wrongtrip.pdf', 'TESTPOD-path2.pdf', 'application/pdf', 100);
    fails:=fails||'T10b wrong-trip path should DENY'; exception when others then n_checks:=n_checks+1; end;

  -- 9. duplicate retry -> a distinct immutable version each time (no crash)
  begin v_doc2 := public.cc_pocket_upload_pod(trip_A, A_owner::text||'/pod/'||trip_A::text||'/tp2.pdf', 'TESTPOD-dupe.pdf', 'application/pdf', 130000);
    n_checks:=n_checks+1; if v_doc2 is null or v_doc2=v_doc then fails:=fails||'T9 retry distinct version'; end if;
  exception when others then fails:=fails||('T9 retry should PASS: '||SQLERRM); end;

  -- extra pending doc for the reject flow
  v_doc3 := public.cc_pocket_upload_pod(trip_A, A_owner::text||'/pod/'||trip_A::text||'/tp3.pdf', 'TESTPOD-reject.pdf', 'image/jpeg', 90000);

  -- 8. invalid trip state -> DENIED (temporarily flip A to a non-permitted state, then restore)
  update app_private.trips set status='dispatched' where id=trip_A;
  begin perform public.cc_pocket_upload_pod(trip_A, A_owner::text||'/pod/'||trip_A::text||'/s.pdf', 'TESTPOD-state.pdf', 'application/pdf', 100);
    fails:=fails||'T8 upload on non-delivered trip should DENY'; exception when others then n_checks:=n_checks+1; end;
  update app_private.trips set status='delivered' where id=trip_A;

  -- 20. cross-carrier document read -> DENIED
  perform set_config('request.jwt.claims', json_build_object('sub',B_owner,'role','authenticated')::text, true);
  begin perform public.cc_pocket_trip_pods(trip_A);
    fails:=fails||'T20 cross-carrier read should DENY'; exception when others then n_checks:=n_checks+1; end;

  -- 20b. carrier reads its own PODs -> PASS
  perform set_config('request.jwt.claims', json_build_object('sub',A_owner,'role','authenticated')::text, true);
  begin select count(*) into v_n from public.cc_pocket_trip_pods(trip_A);
    n_checks:=n_checks+1; if v_n<3 then fails:=fails||('T20b own read got '||v_n); end if;
  exception when others then fails:=fails||('T20b own read should PASS: '||SQLERRM); end;

  -- 11. reviewer opens signed preview -> PASS ; non-reviewer -> DENIED
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin v_ref := public.cc_pod_signed_ref(v_doc);
    n_checks:=n_checks+1; if v_ref->>'bucket'<>'documents' or (v_ref->>'path') is null then fails:=fails||'T11 signed ref malformed'; end if;
  exception when others then fails:=fails||('T11 reviewer preview should PASS: '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('sub',A_owner,'role','authenticated')::text, true);
  begin perform public.cc_pod_signed_ref(v_doc);
    fails:=fails||'T11b non-reviewer preview should DENY'; exception when others then n_checks:=n_checks+1; end;

  -- 14. unauthorized reviewer action -> DENIED
  begin perform public.cc_review_pod(v_doc2,'approved',null);
    fails:=fails||'T14 non-reviewer approve should DENY'; exception when others then n_checks:=n_checks+1; end;

  -- 15. reject without reason / blank reason -> DENIED
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin perform public.cc_review_pod(v_doc3,'rejected',null);
    fails:=fails||'T15 reject no reason should DENY'; exception when others then n_checks:=n_checks+1; end;
  begin perform public.cc_review_pod(v_doc3,'rejected','   ');
    fails:=fails||'T15b reject blank reason should DENY'; exception when others then n_checks:=n_checks+1; end;

  -- 16. reject with reason -> PASS ; carrier can read the reason
  begin v_res := public.cc_review_pod(v_doc3,'rejected','Signature illegible — please re-scan the delivery receipt.');
    n_checks:=n_checks+1; if v_res<>'rejected' then fails:=fails||'T16 reject return'; end if;
  exception when others then fails:=fails||('T16 reject should PASS: '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('sub',A_owner,'role','authenticated')::text, true);
  begin select review_note into v_note from public.cc_pocket_trip_pods(trip_A) where id=v_doc3;
    n_checks:=n_checks+1; if v_note is null or v_note not like 'Signature illegible%' then fails:=fails||'T16b carrier reason'; end if;
  exception when others then fails:=fails||('T16b carrier reason should PASS: '||SQLERRM); end;

  -- 17. resubmission -> a new immutable version; old rejected version unchanged
  begin v_doc4 := public.cc_pocket_upload_pod(trip_A, A_owner::text||'/pod/'||trip_A::text||'/tp3b.png', 'TESTPOD-resubmit.png', 'image/png', 95000);
    n_checks:=n_checks+1; if v_doc4 is null or v_doc4=v_doc3 then fails:=fails||'T17 resubmit new version'; end if;
    perform 1 from app_private.document_files where id=v_doc3 and status='rejected';
    if not found then fails:=fails||'T17b old version should stay rejected/immutable'; end if;
  exception when others then fails:=fails||('T17 resubmit should PASS: '||SQLERRM); end;

  -- 13 + 18. authorized reviewer approves -> PASS ; invoice prep emitted exactly once (idempotent re-approve)
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin v_res := public.cc_review_pod(v_doc,'approved',null);
    n_checks:=n_checks+1; if v_res<>'approved' then fails:=fails||'T13 approve return'; end if;
    v_res := public.cc_review_pod(v_doc,'approved',null);
    if v_res<>'approved' then fails:=fails||'T18a re-approve should stay approved'; end if;
  exception when others then fails:=fails||('T13 approve should PASS: '||SQLERRM); end;
  select count(*) into v_n from app_private.domain_events where event_type='invoice.prep_requested' and payload->>'document'=v_doc::text;
  n_checks:=n_checks+1; if v_n<>1 then fails:=fails||('T18 invoice.prep_requested must fire exactly once, got '||v_n); end if;

  -- cleanup
  delete from app_private.document_files where file_name like 'TESTPOD%';

  if array_length(fails,1) is not null then
    raise exception E'POD BACKEND MATRIX: FAIL\n - %', array_to_string(fails, E'\n - ');
  end if;
  raise notice 'POD BACKEND MATRIX: PASS (% checks)', n_checks;
end $$;
