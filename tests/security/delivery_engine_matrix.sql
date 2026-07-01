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
