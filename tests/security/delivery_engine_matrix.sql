-- delivery_engine_matrix.sql
-- End-to-end server-side matrix for the unified delivery engine (cvb/cvc/cvd), via JWT-claim simulation.
-- Proves: preview counts, consent + suppression enforcement, CONFIRM-COUNT SAFETY GUARD (wrong count denied),
-- idempotent enqueue (no double-send), atomic claim, delivery marking, bounce auto-suppression, provider
-- event logging, and non-staff / anon denial. The whole matrix runs inside ONE DO block (one transaction):
-- on PASS every DELIVTEST fixture is deleted and committed; on any failed expectation the block RAISES,
-- rolling the entire transaction back — so the database is never left dirty either way.
--
-- Run against STAGING (snslhvmkjusozgjelghi).
--
-- Personas (staging seed):
--   reviewer = aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1  (staff, passes app_private.can_manage_comms)
--   carrier  = 33ff093f-4cf5-48b1-934e-8fe1fe6904d1  (carrier owner, does NOT pass can_manage_comms)
--
-- Exit contract: RAISES on the first failed expectation; prints 'DELIVERY ENGINE MATRIX: PASS (N checks)'.

do $$
declare
  reviewer constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  carrier  constant uuid := '33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  v_aud uuid; v_cmp uuid; v_prev jsonb; v_res jsonb; v_ids uuid[]; v_del uuid; v_bnc uuid;
  v_new text; v_cnt int; fails text[] := '{}'; n int := 0;
begin
  -- ---- fixtures: 3 newsletter subscribers (explicit opt-in) ----
  delete from app_private.form_submissions where email like '%@delivtest.example';
  insert into app_private.form_submissions(form_key,email,spam_score,name) values
    ('newsletter','alice@delivtest.example',0,'DELIVTEST a'),
    ('newsletter','bob@delivtest.example',0,'DELIVTEST b'),
    ('newsletter','carol@delivtest.example',0,'DELIVTEST c');
  insert into app_private.audiences(name,type) values ('DELIVTEST aud','newsletter') returning id into v_aud;
  insert into app_private.campaigns(name,utm_campaign,audience_id,channels,subject,status)
    values ('DELIVTEST campaign','delivtest',v_aud,array['email'],'Hello DELIVTEST','draft') returning id into v_cmp;

  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  perform public.cc_campaign_approve(v_cmp, true);  -- approval gate (cvi): created_by null so approver allowed

  -- 1. preview counts 3 opted-in, 0 suppressed, 3 final
  begin v_prev := public.cc_campaign_audience_preview(v_cmp); n:=n+1;
    if (v_prev->>'final_recipients')::int<>3 or (v_prev->>'after_consent')::int<>3 or (v_prev->>'suppressed')::int<>0
      then fails:=fails||('D1 preview '||v_prev::text); end if;
  exception when others then fails:=fails||('D1 '||SQLERRM); end;

  -- 2. suppress carol → preview final drops to 2, suppressed 1
  begin perform public.cc_suppress('email','carol@delivtest.example','manual'); n:=n+1; exception when others then fails:=fails||('D2 suppress '||SQLERRM); end;
  begin v_prev := public.cc_campaign_audience_preview(v_cmp); n:=n+1;
    if (v_prev->>'final_recipients')::int<>2 or (v_prev->>'suppressed')::int<>1 then fails:=fails||('D2b preview '||v_prev::text); end if;
  exception when others then fails:=fails||('D2b '||SQLERRM); end;

  -- 3. SAFETY GUARD: enqueue with the STALE count (3) must be DENIED
  begin perform public.cc_campaign_enqueue(v_cmp, 3); fails:=fails||'D3 wrong confirm-count should DENY';
  exception when others then n:=n+1; end;

  -- 4. enqueue with correct count (2) → 2 newly queued
  begin v_res := public.cc_campaign_enqueue(v_cmp, 2); n:=n+1;
    if (v_res->>'newly_queued')::int<>2 or (v_res->>'final_recipients')::int<>2 then fails:=fails||('D4 '||v_res::text); end if;
  exception when others then fails:=fails||('D4 '||SQLERRM); end;

  -- 5. IDEMPOTENT: enqueue again with count 2 → 0 newly queued (no double-send)
  begin v_res := public.cc_campaign_enqueue(v_cmp, 2); n:=n+1;
    if (v_res->>'newly_queued')::int<>0 then fails:=fails||('D5 idempotency '||v_res::text); end if;
  exception when others then fails:=fails||('D5 '||SQLERRM); end;

  -- 6. atomic claim → exactly 2 rows, status becomes claimed
  begin select array_agg(id) into v_ids from public.cc_delivery_claim(50,'email') where campaign_id=v_cmp; n:=n+1;
    if v_ids is null or array_length(v_ids,1)<>2 then fails:=fails||('D6 claimed '||coalesce(array_length(v_ids,1),0)::text); end if;
  exception when others then fails:=fails||('D6 '||SQLERRM); end;

  -- identify the two deliveries by recipient
  select id into v_del from app_private.message_deliveries where campaign_id=v_cmp and recipient_email='alice@delivtest.example';
  select id into v_bnc from app_private.message_deliveries where campaign_id=v_cmp and recipient_email='bob@delivtest.example';

  -- 7. mark alice delivered
  begin v_new := public.cc_delivery_mark(v_del,'delivered',null,'resend','pe-del-1'); n:=n+1;
    if v_new<>'delivered' then fails:=fails||('D7 '||v_new); end if;
  exception when others then fails:=fails||('D7 '||SQLERRM); end;

  -- 8. mark bob bounced → auto-suppress bob
  begin v_new := public.cc_delivery_mark(v_bnc,'bounced','hard bounce','resend','pe-bnc-1'); n:=n+1;
    if v_new<>'bounced' then fails:=fails||('D8 '||v_new); end if;
  exception when others then fails:=fails||('D8 '||SQLERRM); end;
  begin select count(*) into v_cnt from app_private.suppressions where channel='email' and address='bob@delivtest.example'; n:=n+1;
    if v_cnt<>1 then fails:=fails||'D8b bounce should auto-suppress'; end if;
  exception when others then fails:=fails||('D8b '||SQLERRM); end;

  -- 9. provider events logged (idempotent) — at least the 2 we marked
  begin select count(*) into v_cnt from app_private.provider_events where dedupe_key in ('pe-del-1','pe-bnc-1'); n:=n+1;
    if v_cnt<>2 then fails:=fails||('D9 provider_events '||v_cnt::text); end if;
  exception when others then fails:=fails||('D9 '||SQLERRM); end;
  -- re-post same webhook dedupe_key → no duplicate row
  begin perform public.cc_delivery_mark(v_del,'delivered',null,'resend','pe-del-1'); n:=n+1;
    select count(*) into v_cnt from app_private.provider_events where dedupe_key='pe-del-1';
    if v_cnt<>1 then fails:=fails||('D9b dedupe '||v_cnt::text); end if;
  exception when others then fails:=fails||('D9b '||SQLERRM); end;

  -- 10. health returns a jsonb histogram
  begin v_res := public.cc_delivery_health(); n:=n+1;
    if v_res is null or jsonb_typeof(v_res)<>'object' then fails:=fails||'D10 health'; end if;
  exception when others then fails:=fails||('D10 '||SQLERRM); end;

  -- 11. carrier (not comms-staff) → preview DENIED
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_campaign_audience_preview(v_cmp); fails:=fails||'D11 carrier preview should DENY';
  exception when others then n:=n+1; end;
  begin perform public.cc_campaign_enqueue(v_cmp, 2); fails:=fails||'D11b carrier enqueue should DENY';
  exception when others then n:=n+1; end;

  -- 12. anon → enqueue + claim + suppress all DENIED
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_campaign_enqueue(v_cmp, 2); fails:=fails||'D12 anon enqueue should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_delivery_claim(50,'email'); fails:=fails||'D12b anon claim should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_suppress('email','x@delivtest.example'); fails:=fails||'D12c anon suppress should DENY'; exception when others then n:=n+1; end;

  -- ---- cleanup ----
  delete from app_private.provider_events where delivery_id in (select id from app_private.message_deliveries where campaign_id=v_cmp);
  delete from app_private.message_deliveries where campaign_id=v_cmp;
  delete from app_private.suppressions where address like '%@delivtest.example';
  delete from app_private.campaigns where id=v_cmp;
  delete from app_private.audiences where id=v_aud;
  delete from app_private.form_submissions where email like '%@delivtest.example';

  if array_length(fails,1) is not null then
    raise exception E'DELIVERY ENGINE MATRIX: FAIL\n - %', array_to_string(fails,E'\n - ');
  end if;
  raise notice 'DELIVERY ENGINE MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- Analytics + transactional enqueue matrix (cve). Same PASS/RAISE contract.
-- ---------------------------------------------------------------------------
do $$
declare
  reviewer constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  carrier  constant uuid := '33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  v_cmp uuid; v jsonb; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.message_deliveries where recipient_email like '%@txntest.example';
  delete from app_private.suppressions where address like '%@txntest.example';
  insert into app_private.campaigns(name,utm_campaign,channels,status) values ('TXNTEST cmp','txntest',array['email'],'sending') returning id into v_cmp;
  insert into app_private.message_deliveries(source,campaign_id,channel,provider,recipient_email,idempotency_key,status) values
    ('campaign',v_cmp,'email','resend','a@txntest.example','txntest:'||v_cmp::text||':a','delivered'),
    ('campaign',v_cmp,'email','resend','b@txntest.example','txntest:'||v_cmp::text||':b','bounced'),
    ('campaign',v_cmp,'email','resend','c@txntest.example','txntest:'||v_cmp::text||':c','queued');
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin v := public.cc_campaign_analytics(v_cmp); n:=n+1;
    if (v->>'total')::int<>3 or (v->>'delivered')::int<>1 or (v->>'bounced')::int<>1 or (v->>'pending')::int<>1
      then fails:=fails||('T1 analytics '||v::text); end if;
  exception when others then fails:=fails||('T1 '||SQLERRM); end;
  begin v := public.cc_enqueue_transactional('email','new@txntest.example','welcome','Hi',null,'{}'::jsonb,null); n:=n+1;
    if (v->>'queued')<>'true' then fails:=fails||('T2 '||v::text); end if;
  exception when others then fails:=fails||('T2 '||SQLERRM); end;
  begin v := public.cc_enqueue_transactional('email','dupe@txntest.example','welcome','Hi','FIXEDKEY-txntest','{}'::jsonb,null); n:=n+1;
    v := public.cc_enqueue_transactional('email','dupe@txntest.example','welcome','Hi','FIXEDKEY-txntest','{}'::jsonb,null);
    if (v->>'status')<>'duplicate' then fails:=fails||('T3 idempotency '||v::text); end if;
  exception when others then fails:=fails||('T3 '||SQLERRM); end;
  begin perform public.cc_suppress('email','blocked@txntest.example','manual'); n:=n+1;
    v := public.cc_enqueue_transactional('email','blocked@txntest.example','welcome','Hi',null,'{}'::jsonb,null);
    if (v->>'queued')<>'false' or (v->>'reason')<>'suppressed' then fails:=fails||('T4 suppressed '||v::text); end if;
  exception when others then fails:=fails||('T4 '||SQLERRM); end;
  begin perform public.cc_enqueue_transactional('email','not-an-email','welcome',null,null,'{}'::jsonb,null); fails:=fails||'T5 invalid email should raise'; exception when others then n:=n+1; end;
  begin perform public.cc_enqueue_transactional('carrierpigeon','x@txntest.example',null,null,null,'{}'::jsonb,null); fails:=fails||'T5b invalid channel should raise'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_campaign_analytics(v_cmp); fails:=fails||'T6 carrier analytics should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_enqueue_transactional('email','x@txntest.example',null,null,null,'{}'::jsonb,null); fails:=fails||'T6b carrier txn should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_campaign_analytics(v_cmp); fails:=fails||'T7 anon analytics should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_enqueue_transactional('email','x@txntest.example',null,null,null,'{}'::jsonb,null); fails:=fails||'T7b anon txn should DENY'; exception when others then n:=n+1; end;
  delete from app_private.message_deliveries where campaign_id=v_cmp or recipient_email like '%@txntest.example';
  delete from app_private.suppressions where address like '%@txntest.example';
  delete from app_private.campaigns where id=v_cmp;
  if array_length(fails,1) is not null then raise exception E'ANALYTICS/TXN MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'ANALYTICS/TXN MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- Scheduled-release matrix (cvf): due scheduled → queued; idempotent; staff-gated.
-- ---------------------------------------------------------------------------
do $$
declare
  reviewer constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  carrier  constant uuid := '33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  v_cmp uuid; v_n int; v_cnt int; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.message_deliveries where recipient_email like '%@reltest.example';
  insert into app_private.campaigns(name,utm_campaign,channels,status) values ('RELTEST cmp','reltest',array['email'],'scheduled') returning id into v_cmp;
  insert into app_private.message_deliveries(source,campaign_id,channel,provider,recipient_email,idempotency_key,status,scheduled_at) values
    ('campaign',v_cmp,'email','resend','past@reltest.example','reltest:past','scheduled', now()-interval '1 hour'),
    ('campaign',v_cmp,'email','resend','future@reltest.example','reltest:future','scheduled', now()+interval '1 day');
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin v_n := public.cc_delivery_release_due('email'); n:=n+1; if v_n<>1 then fails:=fails||('R1 released '||v_n::text); end if;
  exception when others then fails:=fails||('R1 '||SQLERRM); end;
  begin select count(*) into v_cnt from app_private.message_deliveries where campaign_id=v_cmp and status='queued'; n:=n+1;
    if v_cnt<>1 then fails:=fails||('R2 queued '||v_cnt::text); end if;
    select count(*) into v_cnt from app_private.message_deliveries where campaign_id=v_cmp and status='scheduled';
    if v_cnt<>1 then fails:=fails||('R2b scheduled '||v_cnt::text); end if;
  exception when others then fails:=fails||('R2 '||SQLERRM); end;
  begin v_n := public.cc_delivery_release_due('email'); n:=n+1; if v_n<>0 then fails:=fails||('R3 second '||v_n::text); end if;
  exception when others then fails:=fails||('R3 '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_delivery_release_due('email'); fails:=fails||'R4 carrier should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_delivery_release_due('email'); fails:=fails||'R5 anon should DENY'; exception when others then n:=n+1; end;
  delete from app_private.message_deliveries where campaign_id=v_cmp;
  delete from app_private.campaigns where id=v_cmp;
  if array_length(fails,1) is not null then raise exception E'RELEASE-DUE MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'RELEASE-DUE MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- Service-role worker matrix (cvg): claim/mark/resolve behave; OFF the anon+authenticated surface.
-- ---------------------------------------------------------------------------
do $$
declare v_cmp uuid; v_id uuid; v_claim int; v_res uuid; v_new text; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.message_deliveries where recipient_email like '%@wrk.example';
  insert into app_private.campaigns(name,utm_campaign,channels,status) values ('WRK cmp','wrk',array['email'],'sending') returning id into v_cmp;
  insert into app_private.message_deliveries(source,campaign_id,channel,provider,recipient_email,idempotency_key,status)
    values ('campaign',v_cmp,'email','resend','w@wrk.example','wrk:key:1','queued') returning id into v_id;
  begin select count(*) into v_claim from public.cc_delivery_worker_claim(50,'email') where id=v_id; n:=n+1;
    if v_claim<>1 then fails:=fails||('W1 claim '||v_claim::text); end if;
  exception when others then fails:=fails||('W1 '||SQLERRM); end;
  begin v_res := public.cc_delivery_worker_resolve('wrk:key:1', null); n:=n+1; if v_res<>v_id then fails:=fails||'W2 resolve-by-ref'; end if;
  exception when others then fails:=fails||('W2 '||SQLERRM); end;
  begin v_res := public.cc_delivery_worker_resolve(null,'W@WRK.EXAMPLE'); n:=n+1; if v_res<>v_id then fails:=fails||'W3 resolve-by-email'; end if;
  exception when others then fails:=fails||('W3 '||SQLERRM); end;
  begin v_new := public.cc_delivery_worker_mark(v_id,'sent',null,'resend','send:1'); n:=n+1; if v_new<>'sent' then fails:=fails||('W4 '||v_new); end if;
  exception when others then fails:=fails||('W4 '||SQLERRM); end;
  begin if has_function_privilege('anon','public.cc_delivery_worker_claim(integer,text)','EXECUTE')
        or has_function_privilege('authenticated','public.cc_delivery_worker_mark(uuid,text,text,text,text)','EXECUTE')
        or has_function_privilege('anon','public.cc_delivery_worker_resolve(text,text)','EXECUTE')
      then fails:=fails||'W5 worker RPC exposed to anon/auth'; else n:=n+1; end if;
  exception when others then fails:=fails||('W5 '||SQLERRM); end;
  delete from app_private.message_deliveries where campaign_id=v_cmp;
  delete from app_private.campaigns where id=v_cmp;
  if array_length(fails,1) is not null then raise exception E'WORKER MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'WORKER MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- Template render + content-snapshot matrix (cvh): render substitutes/flags vars; enqueue snapshots body.
-- ---------------------------------------------------------------------------
do $$
declare reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v jsonb; v_aud uuid; v_cmp uuid; v_res jsonb; v_meta jsonb; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.comm_templates where key='rndtest';
  insert into app_private.comm_templates(key,name,channel,subject,body,body_text,status,channels)
    values ('rndtest','RND','email','Hi {{first_name}}','<p>Hello {{first_name}} — {{unknown_var}}</p>','Hello {{first_name}}','active',array['email']);
  delete from app_private.form_submissions where email like '%@rnd.example';
  insert into app_private.form_submissions(form_key,email,spam_score) values ('newsletter','a@rnd.example',0);
  insert into app_private.audiences(name,type) values ('RND aud','newsletter') returning id into v_aud;
  insert into app_private.campaigns(name,utm_campaign,audience_id,channels,subject,template_key,status)
    values ('RND cmp','rnd',v_aud,array['email'],'Fallback subj','rndtest','draft') returning id into v_cmp;
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  perform public.cc_campaign_approve(v_cmp, true);  -- approval gate (cvi)
  begin v := public.cc_render_template('rndtest', jsonb_build_object('first_name','Sam')); n:=n+1;
    if (v->>'subject')<>'Hi Sam' or position('Hello Sam' in (v->>'html'))=0 or (v->'unresolved')::text not like '%unknown_var%'
      then fails:=fails||('R1 render '||v::text); end if;
  exception when others then fails:=fails||('R1 '||SQLERRM); end;
  begin v_res := public.cc_campaign_enqueue(v_cmp, 1); n:=n+1;
    if (v_res->>'newly_queued')::int<>1 then fails:=fails||('R2 enqueue '||v_res::text); end if;
    select meta into v_meta from app_private.message_deliveries where campaign_id=v_cmp limit 1;
    if (v_meta->>'subject')<>'Hi {{first_name}}' or position('Hello' in (v_meta->>'body_html'))=0 then fails:=fails||('R3 snapshot '||v_meta::text); end if;
  exception when others then fails:=fails||('R2 '||SQLERRM); end;
  begin perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    perform public.cc_render_template('rndtest','{}'::jsonb); fails:=fails||'R4 anon render should DENY';
  exception when others then n:=n+1; end;
  delete from app_private.message_deliveries where campaign_id=v_cmp;
  delete from app_private.campaigns where id=v_cmp; delete from app_private.audiences where id=v_aud;
  delete from app_private.form_submissions where email like '%@rnd.example';
  delete from app_private.comm_templates where key='rndtest';
  if array_length(fails,1) is not null then raise exception E'RENDER/SNAPSHOT MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'RENDER/SNAPSHOT MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- Campaign approval / maker-checker matrix (cvi): approval required to send; creator can't self-approve.
-- ---------------------------------------------------------------------------
do $$
declare
  approver constant uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  other    constant uuid := 'dd000000-0000-0000-0000-000000000001';
  carrier  constant uuid := '33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  v_aud uuid; v_c1 uuid; v_c2 uuid; v jsonb; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.form_submissions where email like '%@aptest.example';
  delete from app_private.campaigns where utm_campaign in ('aptest1','aptest2');
  insert into app_private.form_submissions(form_key,email,spam_score) values ('newsletter','a@aptest.example',0),('newsletter','b@aptest.example',0);
  insert into app_private.audiences(name,type) values ('AP aud','newsletter') returning id into v_aud;
  insert into app_private.campaigns(name,utm_campaign,audience_id,channels,subject,status,created_by) values ('AP c1','aptest1',v_aud,array['email'],'Hi','draft',approver) returning id into v_c1;
  insert into app_private.campaigns(name,utm_campaign,audience_id,channels,subject,status,created_by) values ('AP c2','aptest2',v_aud,array['email'],'Hi','draft',other) returning id into v_c2;
  perform set_config('request.jwt.claims', json_build_object('sub',approver,'role','authenticated')::text, true);
  begin perform public.cc_campaign_enqueue(v_c2, 2); fails:=fails||'A1 unapproved enqueue should DENY'; exception when others then n:=n+1; end;
  begin perform public.cc_campaign_approve(v_c1, true); fails:=fails||'A2 creator self-approve should DENY'; exception when others then n:=n+1; end;
  begin v := public.cc_campaign_approve(v_c2, true); n:=n+1; if (v->>'approved')<>'true' then fails:=fails||('A3 '||v::text); end if; exception when others then fails:=fails||('A3 '||SQLERRM); end;
  begin v := public.cc_campaign_enqueue(v_c2, 2); n:=n+1; if (v->>'newly_queued')::int<>2 then fails:=fails||('A4 '||v::text); end if; exception when others then fails:=fails||('A4 '||SQLERRM); end;
  begin perform public.cc_campaign_approve(v_c2, false); n:=n+1; exception when others then fails:=fails||('A5 '||SQLERRM); end;
  begin perform public.cc_campaign_enqueue(v_c2, 2); fails:=fails||'A5b revoked enqueue should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_campaign_approve(v_c2, true); fails:=fails||'A6 carrier approve should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_campaign_approve(v_c2, true); fails:=fails||'A7 anon approve should DENY'; exception when others then n:=n+1; end;
  delete from app_private.message_deliveries where campaign_id in (v_c1,v_c2);
  delete from app_private.campaigns where id in (v_c1,v_c2); delete from app_private.audiences where id=v_aud;
  delete from app_private.form_submissions where email like '%@aptest.example';
  if array_length(fails,1) is not null then raise exception E'APPROVAL MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'APPROVAL MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- Campaign attribution matrix (cvj): web conversions tied to a campaign via utm_campaign.
-- ---------------------------------------------------------------------------
do $$
declare reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'; carrier constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  v_cmp uuid; v jsonb; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.form_submissions where email like '%@attrtest.example';
  delete from app_private.campaigns where utm_campaign='attrtest';
  insert into app_private.campaigns(name,utm_campaign,channels,status) values ('ATTR cmp','attrtest',array['email'],'sending') returning id into v_cmp;
  insert into app_private.message_deliveries(source,campaign_id,channel,provider,recipient_email,idempotency_key,status) values
    ('campaign',v_cmp,'email','resend','x@attrtest.example','attr:x','delivered'),
    ('campaign',v_cmp,'email','resend','y@attrtest.example','attr:y','opened');
  insert into app_private.form_submissions(form_key,email,utm_campaign,spam_score) values
    ('contact','p@attrtest.example','attrtest',0),('newsletter','q@attrtest.example','ATTRTEST',0);
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin v := public.cc_campaign_attribution(v_cmp); n:=n+1;
    if (v->>'delivered')::int<>2 or (v->>'attributed_submissions')::int<>2
       or (v->'by_form'->>'contact')::int<>1 or (v->'by_form'->>'newsletter')::int<>1 then fails:=fails||('AT1 '||v::text); end if;
  exception when others then fails:=fails||('AT1 '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_campaign_attribution(v_cmp); fails:=fails||'AT2 carrier should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_campaign_attribution(v_cmp); fails:=fails||'AT3 anon should DENY'; exception when others then n:=n+1; end;
  delete from app_private.message_deliveries where campaign_id=v_cmp;
  delete from app_private.campaigns where id=v_cmp;
  delete from app_private.form_submissions where email like '%@attrtest.example';
  if array_length(fails,1) is not null then raise exception E'ATTRIBUTION MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'ATTRIBUTION MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- Transactional SMS matrix (cvk): sms validates+stores phone; email path intact; sms suppression enforced.
-- ---------------------------------------------------------------------------
do $$
declare reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v jsonb; v_did uuid; fails text[]:='{}'; n int:=0; v_ch text; v_phone text;
begin
  delete from app_private.message_deliveries where recipient_phone like '+1555%' or recipient_email like '%@smstest.example';
  delete from app_private.suppressions where address in ('+15559990001','x@smstest.example');
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin v := public.cc_enqueue_transactional('sms','+15559990001','trip_update','Trip update',null,'{}'::jsonb,null); n:=n+1;
    if (v->>'queued')<>'true' or (v->>'channel')<>'sms' then fails:=fails||('S1 '||v::text); end if;
    v_did := (v->>'delivery_id')::uuid;
    select channel, recipient_phone into v_ch, v_phone from app_private.message_deliveries where id=v_did;
    if v_ch<>'sms' or v_phone<>'+15559990001' then fails:=fails||('S1b '||coalesce(v_ch,'null')||'/'||coalesce(v_phone,'null')); end if;
  exception when others then fails:=fails||('S1 '||SQLERRM); end;
  begin perform public.cc_enqueue_transactional('sms','not-a-phone',null,null,null,'{}'::jsonb,null); fails:=fails||'S2 bad phone should raise'; exception when others then n:=n+1; end;
  begin v := public.cc_enqueue_transactional('email','x@smstest.example','welcome','Hi',null,'{}'::jsonb,null); n:=n+1;
    if (v->>'queued')<>'true' or (v->>'channel')<>'email' then fails:=fails||('S3 '||v::text); end if; exception when others then fails:=fails||('S3 '||SQLERRM); end;
  begin perform public.cc_suppress('sms','+15559990001','manual'); n:=n+1;
    v := public.cc_enqueue_transactional('sms','+15559990001','x',null,'newkey-sms','{}'::jsonb,null);
    if (v->>'queued')<>'false' or (v->>'reason')<>'suppressed' then fails:=fails||('S4 '||v::text); end if; exception when others then fails:=fails||('S4 '||SQLERRM); end;
  delete from app_private.message_deliveries where recipient_phone like '+1555%' or recipient_email like '%@smstest.example';
  delete from app_private.suppressions where address in ('+15559990001','x@smstest.example');
  if array_length(fails,1) is not null then raise exception E'SMS TXN MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'SMS TXN MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- One-click unsubscribe matrix (cvl): token→suppress+mark; unknown token safe; off anon+authenticated surface.
-- ---------------------------------------------------------------------------
do $$
declare v_cmp uuid; v_id uuid; v_tok uuid; v jsonb; v_st text; v_cnt int; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.message_deliveries where recipient_email like '%@unsub.example';
  delete from app_private.suppressions where address like '%@unsub.example';
  insert into app_private.campaigns(name,utm_campaign,channels,status) values ('UNSUB cmp','unsub',array['email'],'sending') returning id into v_cmp;
  insert into app_private.message_deliveries(source,campaign_id,channel,provider,recipient_email,idempotency_key,status)
    values ('campaign',v_cmp,'email','resend','u@unsub.example','unsub:1','delivered') returning id, correlation_id into v_id, v_tok;
  begin v := public.cc_delivery_worker_unsubscribe(v_tok); n:=n+1;
    if (v->>'ok')<>'true' then fails:=fails||('U1 '||v::text); end if;
    select status into v_st from app_private.message_deliveries where id=v_id;
    select count(*) into v_cnt from app_private.suppressions where channel='email' and address='u@unsub.example';
    if v_st<>'unsubscribed' or v_cnt<>1 then fails:=fails||('U1b '||v_st||'/'||v_cnt::text); end if;
  exception when others then fails:=fails||('U1 '||SQLERRM); end;
  begin v := public.cc_delivery_worker_unsubscribe(gen_random_uuid()); n:=n+1; if (v->>'ok')<>'false' then fails:=fails||('U2 '||v::text); end if; exception when others then fails:=fails||('U2 '||SQLERRM); end;
  begin if has_function_privilege('anon','public.cc_delivery_worker_unsubscribe(uuid)','EXECUTE')
        or has_function_privilege('authenticated','public.cc_delivery_worker_unsubscribe(uuid)','EXECUTE')
      then fails:=fails||'U3 exposed to anon/auth'; else n:=n+1; end if; exception when others then fails:=fails||('U3 '||SQLERRM); end;
  delete from app_private.message_deliveries where campaign_id=v_cmp;
  delete from app_private.suppressions where address like '%@unsub.example';
  delete from app_private.campaigns where id=v_cmp;
  if array_length(fails,1) is not null then raise exception E'UNSUBSCRIBE MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'UNSUBSCRIBE MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- A/B testing matrix (cvm/cvn): variant split deterministic + weighted; per-variant snapshot; winner; denial.
-- No-variant path unchanged (asserted separately).
-- ---------------------------------------------------------------------------
do $$
declare reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'; carrier constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  v_aud uuid; v_cmp uuid; v jsonb; v_a int; v_b int; v_dist int; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.form_submissions where email like '%@abtest.example';
  delete from app_private.campaigns where utm_campaign='abtest';
  insert into app_private.form_submissions(form_key,email,spam_score)
    select 'newsletter','u'||g||'@abtest.example',0 from generate_series(1,20) g;
  insert into app_private.audiences(name,type) values ('AB aud','newsletter') returning id into v_aud;
  insert into app_private.campaigns(name,utm_campaign,audience_id,channels,subject,status,created_by)
    values ('AB cmp','abtest',v_aud,array['email'],'Default subj','draft', null) returning id into v_cmp;
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin perform public.cc_campaign_set_variant(v_cmp,'A','Subject A','<p>A</p>','A',1); perform public.cc_campaign_set_variant(v_cmp,'B','Subject B','<p>B</p>','B',1); n:=n+1; exception when others then fails:=fails||('AB1 '||SQLERRM); end;
  begin select count(*) into v_dist from public.cc_campaign_variants(v_cmp); n:=n+1; if v_dist<>2 then fails:=fails||('AB1b '||v_dist::text); end if; exception when others then fails:=fails||('AB1b '||SQLERRM); end;
  perform public.cc_campaign_approve(v_cmp, true);
  begin v := public.cc_campaign_enqueue(v_cmp, 20); n:=n+1; if (v->>'newly_queued')::int<>20 or (v->>'variants')::int<>2 then fails:=fails||('AB2 '||v::text); end if; exception when others then fails:=fails||('AB2 '||SQLERRM); end;
  select count(*) filter (where meta->>'variant'='A'), count(*) filter (where meta->>'variant'='B') into v_a, v_b from app_private.message_deliveries where campaign_id=v_cmp;
  begin n:=n+1; if v_a+v_b<>20 or v_a=0 or v_b=0 then fails:=fails||('AB3 split A='||v_a||' B='||v_b); end if; exception when others then fails:=fails||('AB3 '||SQLERRM); end;
  begin n:=n+1; if not exists(select 1 from app_private.message_deliveries where campaign_id=v_cmp and meta->>'variant'='A' and meta->>'subject'='Subject A') then fails:=fails||'AB4 variant A content'; end if; exception when others then fails:=fails||('AB4 '||SQLERRM); end;
  update app_private.message_deliveries set status='delivered' where campaign_id=v_cmp and meta->>'variant'='A';
  begin v := public.cc_campaign_variant_analytics(v_cmp); n:=n+1; if (v->>'winner')<>'A' then fails:=fails||('AB5 '||v::text); end if; exception when others then fails:=fails||('AB5 '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_campaign_set_variant(v_cmp,'C','x',null,null,1); fails:=fails||'AB6 carrier should DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_campaign_variants(v_cmp); fails:=fails||'AB7 anon should DENY'; exception when others then n:=n+1; end;
  delete from app_private.message_deliveries where campaign_id=v_cmp;
  delete from app_private.campaign_variants where campaign_id=v_cmp;
  delete from app_private.campaigns where id=v_cmp; delete from app_private.audiences where id=v_aud;
  delete from app_private.form_submissions where email like '%@abtest.example';
  if array_length(fails,1) is not null then raise exception E'A/B MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'A/B MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- Event-triggered automations matrix (cvo): no-op until active; fires w/ rendered vars; suppression; denial.
-- ---------------------------------------------------------------------------
do $$
declare reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'; carrier constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  v_cnt int; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.message_deliveries where recipient_email like '%@trigtest.example';
  delete from app_private.form_submissions where email like '%@trigtest.example';
  delete from app_private.suppressions where address like '%@trigtest.example';
  delete from app_private.comm_triggers where event_type='form.submitted';
  delete from app_private.comm_templates where key='trig_ack';
  insert into app_private.comm_templates(key,name,channel,subject,body,body_text,status,channels)
    values ('trig_ack','Ack','email','Thanks {{first_name}}','<p>Thanks {{first_name}}</p>','Thanks {{first_name}}','active',array['email']);
  insert into app_private.form_submissions(form_key,email,name,spam_score) values ('contact','a@trigtest.example','Sam Rider',0);
  select count(*) into v_cnt from app_private.message_deliveries where recipient_email='a@trigtest.example';
  n:=n+1; if v_cnt<>0 then fails:=fails||('G1 no-op '||v_cnt::text); end if;
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin perform public.cc_set_comm_trigger('form.submitted','email','trig_ack','Thanks!',true); n:=n+1; exception when others then fails:=fails||('G2 '||SQLERRM); end;
  perform set_config('request.jwt.claims', 'null', true);
  insert into app_private.form_submissions(form_key,email,name,spam_score) values ('contact','b@trigtest.example','Dana Fleet',0);
  select count(*) into v_cnt from app_private.message_deliveries where recipient_email='b@trigtest.example' and meta->>'trigger'='form.submitted' and meta->>'subject' like 'Thanks%';
  n:=n+1; if v_cnt<>1 then fails:=fails||('G3 '||v_cnt::text); end if;
  select count(*) into v_cnt from app_private.message_deliveries where recipient_email='b@trigtest.example' and meta->>'body_text' like '%Dana%';
  n:=n+1; if v_cnt<>1 then fails:=fails||'G3b var render'; end if;
  insert into app_private.suppressions(channel,address,reason) values ('email','c@trigtest.example','manual');
  insert into app_private.form_submissions(form_key,email,name,spam_score) values ('contact','c@trigtest.example','X',0);
  select count(*) into v_cnt from app_private.message_deliveries where recipient_email='c@trigtest.example';
  n:=n+1; if v_cnt<>0 then fails:=fails||('G4 suppressed '||v_cnt::text); end if;
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_set_comm_trigger('form.submitted','email','trig_ack',null,true); fails:=fails||'G5 carrier DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_comm_triggers(); fails:=fails||'G6 anon DENY'; exception when others then n:=n+1; end;
  delete from app_private.message_deliveries where recipient_email like '%@trigtest.example';
  delete from app_private.form_submissions where email like '%@trigtest.example';
  delete from app_private.suppressions where address like '%@trigtest.example';
  delete from app_private.comm_triggers where event_type='form.submitted';
  delete from app_private.comm_templates where key='trig_ack';
  if array_length(fails,1) is not null then raise exception E'TRIGGER MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'TRIGGER MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- Domain-event → webhook fan-out matrix (cvp): only subscribed+active endpoints; idempotent; catalog; denial.
-- ---------------------------------------------------------------------------
do $$
declare reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  ep1 uuid; ev bigint; v_n int; v_cnt int; v_cat int; fails text[]:='{}'; n int:=0;
begin
  delete from app_private.webhook_deliveries where event_type='fanout.test';
  delete from app_private.webhook_endpoints where name like 'FANOUT%';
  delete from app_private.domain_events where event_type='fanout.test';
  insert into app_private.webhook_endpoints(name,url,event_types,active,signing_configured) values ('FANOUT sub','https://example.com/a', array['fanout.test'], true, false) returning id into ep1;
  insert into app_private.webhook_endpoints(name,url,event_types,active,signing_configured) values ('FANOUT other','https://example.com/b', array['other.event'], true, false);
  insert into app_private.webhook_endpoints(name,url,event_types,active,signing_configured) values ('FANOUT inactive','https://example.com/c', array['fanout.test'], false, false);
  select app_private.emit_event('fanout.test','test','agg-1', jsonb_build_object('k','v')) into ev;
  select app_private.fanout_domain_events(100) into v_n; n:=n+1;
  select count(*) into v_cnt from app_private.webhook_deliveries where event_type='fanout.test';
  if v_cnt<>1 then fails:=fails||('F1 '||v_cnt::text); end if;
  select count(*) into v_cnt from app_private.webhook_deliveries where event_type='fanout.test' and endpoint_id=ep1;
  if v_cnt<>1 then fails:=fails||'F1b wrong endpoint'; end if;
  select app_private.fanout_domain_events(100) into v_n; n:=n+1;
  select count(*) into v_cnt from app_private.webhook_deliveries where event_type='fanout.test';
  if v_cnt<>1 then fails:=fails||('F2 idempotent '||v_cnt::text); end if;
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin select count(*) into v_cat from public.cc_event_catalog() where event_type in ('campaign.enqueued','comm.unsubscribe','form.submitted'); n:=n+1; if v_cat<>3 then fails:=fails||('F3 '||v_cat::text); end if; exception when others then fails:=fails||('F3 '||SQLERRM); end;
  begin perform public.cc_webhooks_flush(); n:=n+1; exception when others then fails:=fails||('F4 '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_webhooks_flush(); fails:=fails||'F5 anon flush DENY'; exception when others then n:=n+1; end;
  begin if has_function_privilege('anon','public.cc_fanout_domain_events(integer)','EXECUTE') or has_function_privilege('authenticated','public.cc_fanout_domain_events(integer)','EXECUTE') then fails:=fails||'F6 exposed'; else n:=n+1; end if; exception when others then fails:=fails||('F6 '||SQLERRM); end;
  delete from app_private.webhook_deliveries where event_type='fanout.test';
  delete from app_private.webhook_endpoints where name like 'FANOUT%';
  delete from app_private.domain_events where event_type='fanout.test';
  if array_length(fails,1) is not null then raise exception E'FANOUT MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'FANOUT MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- Webhook sender matrix (cvq): claim sets in-flight; mark delivered; retry→terminal; off anon+auth surface.
-- Parks pre-existing queued deliveries so the global claim doesn't disturb real data.
-- ---------------------------------------------------------------------------
do $$
declare ep uuid; d1 uuid; d2 uuid; v_status text; v_new text; v_cnt int; fails text[]:='{}'; n int:=0; i int; v_other uuid[];
begin
  select array_agg(id) into v_other from app_private.webhook_deliveries where status='queued';
  update app_private.webhook_deliveries set status='skipped' where status='queued';
  delete from app_private.webhook_deliveries where event_type='send.test';
  delete from app_private.webhook_endpoints where name='SENDTEST';
  insert into app_private.webhook_endpoints(name,url,event_types,active,signing_configured) values ('SENDTEST','https://example.com/hook', array['send.test'], true, false) returning id into ep;
  insert into app_private.webhook_deliveries(endpoint_id,event_type,payload,status) values (ep,'send.test','{}'::jsonb,'queued') returning id into d1;
  insert into app_private.webhook_deliveries(endpoint_id,event_type,payload,status) values (ep,'send.test','{}'::jsonb,'queued') returning id into d2;
  select count(*) into v_cnt from public.cc_webhook_claim(50) where event_type='send.test'; n:=n+1;
  if v_cnt<>2 then fails:=fails||('S1 '||v_cnt::text); end if;
  select status into v_status from app_private.webhook_deliveries where id=d1;
  if v_status<>'sending' then fails:=fails||('S1b '||v_status); end if;
  begin v_new := public.cc_webhook_mark(d1, true, 'HTTP 200'); n:=n+1; if v_new<>'delivered' then fails:=fails||('S2 '||v_new); end if; exception when others then fails:=fails||('S2 '||SQLERRM); end;
  for i in 1..6 loop
    perform public.cc_webhook_mark(d2, false, 'HTTP 500');
    perform 1 from public.cc_webhook_claim(50) where id=d2;
  end loop;
  select status into v_status from app_private.webhook_deliveries where id=d2; n:=n+1;
  if v_status<>'failed' then fails:=fails||('S3 '||v_status); end if;
  begin if has_function_privilege('anon','public.cc_webhook_claim(integer)','EXECUTE') or has_function_privilege('authenticated','public.cc_webhook_mark(uuid,boolean,text)','EXECUTE') then fails:=fails||'S4 exposed'; else n:=n+1; end if; exception when others then fails:=fails||('S4 '||SQLERRM); end;
  delete from app_private.webhook_deliveries where event_type='send.test';
  delete from app_private.webhook_endpoints where name='SENDTEST';
  if v_other is not null then update app_private.webhook_deliveries set status='queued' where id = any(v_other); end if;
  if array_length(fails,1) is not null then raise exception E'WEBHOOK SENDER MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'WEBHOOK SENDER MATRIX: PASS (% checks)', n;
end $$;

-- ---------------------------------------------------------------------------
-- Pipeline reliability health matrix (cvr): shape + staff gate + denial.
-- ---------------------------------------------------------------------------
do $$
declare reviewer constant uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'; carrier constant uuid:='33ff093f-4cf5-48b1-934e-8fe1fe6904d1';
  v jsonb; fails text[]:='{}'; n int:=0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',reviewer,'role','authenticated')::text, true);
  begin v := public.cc_pipeline_health(); n:=n+1;
    if not (v ? 'message_deliveries' and v ? 'webhook_deliveries' and v ? 'domain_events' and v ? 'campaigns_in_flight') then fails:=fails||('P1 '||v::text); end if;
    if jsonb_typeof(v->'domain_events'->'pending')<>'number' then fails:=fails||'P1b'; end if;
  exception when others then fails:=fails||('P1 '||SQLERRM); end;
  perform set_config('request.jwt.claims', json_build_object('sub',carrier,'role','authenticated')::text, true);
  begin perform public.cc_pipeline_health(); fails:=fails||'P2 carrier DENY'; exception when others then n:=n+1; end;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  begin perform public.cc_pipeline_health(); fails:=fails||'P3 anon DENY'; exception when others then n:=n+1; end;
  if array_length(fails,1) is not null then raise exception E'PIPELINE HEALTH MATRIX: FAIL\n - %', array_to_string(fails,E'\n - '); end if;
  raise notice 'PIPELINE HEALTH MATRIX: PASS (% checks)', n;
end $$;
