-- Isolated source copies: all dependencies are pg_temp; no real emails.
BEGIN; SET LOCAL plpgsql.check_asserts=on;

CREATE TEMP TABLE mock_agent_profiles(user_id uuid primary key,full_name text,payout_method text,payout_details jsonb,updated_at timestamptz);
CREATE TEMP TABLE mock_users(id uuid primary key,email text);
CREATE TEMP TABLE mock_notifications(recipient_user uuid,channel text,template_key text,payload jsonb,status text,sent_at timestamptz);
CREATE TEMP TABLE mock_email_log(template text);
CREATE FUNCTION pg_temp.actor() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
CREATE FUNCTION pg_temp.allowed(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('audit.mock_permission',true)=p,false) $$;
CREATE FUNCTION pg_temp.session_check() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
 IF current_setting('audit.mock_session',true) IS DISTINCT FROM 'valid' THEN RAISE EXCEPTION 'invalid mock session' USING ERRCODE='42501'; END IF;
END $f$;
CREATE FUNCTION pg_temp.record_email(a text,b text,c text,d text,e text DEFAULT NULL,f text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ INSERT INTO pg_temp.mock_email_log VALUES(b) $$;
CREATE OR REPLACE FUNCTION pg_temp.baseline_verify(p_user uuid, p_ok boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_email text;
begin
  if not (pg_temp.allowed('finance.approve') or pg_temp.allowed('carriers.approve')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if not p_ok and coalesce(trim(p_reason),'') = '' then
    raise exception 'rejection reason required' using errcode='22023';
  end if;
  update pg_temp.mock_agent_profiles set
    payout_details = coalesce(payout_details,'{}'::jsonb) || jsonb_build_object(
      'payout_status', case when p_ok then 'verified' else 'rejected' end,
      'payout_reason', p_reason, 'payout_reviewed_at', now()),
    updated_at = now()
  where user_id = p_user;
  if not found then raise exception 'agent profile not found' using errcode='22023'; end if;
  begin
    insert into pg_temp.mock_notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (p_user, 'in_app', 'agent.payout_review', jsonb_build_object(
      'title', case when p_ok then 'Payout details verified' else 'Payout details need a fix' end,
      'body', coalesce(p_reason, case when p_ok then 'Your payout method is verified.' else 'Please correct your payout details.' end),
      'tone', case when p_ok then 'success' else 'urgent' end, 'url', '/app/agent/#verify'), 'sent', now());
  exception when others then null; end;
  if not p_ok then
    begin
      select email into v_email from pg_temp.mock_users where id = p_user;
      if v_email is not null then
        perform pg_temp.record_email(v_email, 'agent.payout_review', 'Payout details need a correction',
          '<div style="font-family:Inter,Arial,sans-serif"><h2>Your payout details need a correction</h2><p><b>Reason:</b> ' || p_reason || '</p><p>Open your Verification Center and update your payout method.</p></div>',
          null, 'agentpayout:' || p_user::text || ':' || to_char(now(),'YYYYMMDDHH24MI'));
      end if;
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'verified', p_ok);
end $function$;
CREATE OR REPLACE FUNCTION pg_temp.cc_agent_payout_approve_method(p_user uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_method text; v_pd jsonb;
begin
  perform pg_temp.session_check();
  if not (pg_temp.allowed('finance.approve') or pg_temp.allowed('carriers.approve')) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  select payout_method, coalesce(payout_details,'{}'::jsonb) into v_method, v_pd
    from pg_temp.mock_agent_profiles where user_id = p_user;
  if not found then raise exception 'agent profile not found' using errcode='22023'; end if;
  if coalesce(v_method,'') <> 'other' then
    raise exception 'this agent is not on an alternative payout method' using errcode='22023';
  end if;

  -- Refuse to bless a rail we cannot actually send to. An approved method with
  -- no account number is how a payout run silently fails later.
  if coalesce(nullif(trim(coalesce(v_pd->>'iban','')),''), nullif(trim(coalesce(v_pd->>'account','')),'')) is null then
    raise exception 'add the IBAN / account number before approving this method' using errcode='22023';
  end if;
  if nullif(trim(coalesce(v_pd->>'account_title','')),'') is null then
    raise exception 'account title is required before approving this method' using errcode='22023';
  end if;

  update pg_temp.mock_agent_profiles set
    payout_details = coalesce(payout_details,'{}'::jsonb) || jsonb_build_object(
      'other_approved', jsonb_build_object(
        'by', pg_temp.actor(), 'at', now(),
        'label', coalesce(v_pd->>'other','alternative method'),
        'note', nullif(trim(coalesce(p_note,'')),''))),
    updated_at = now()
  where user_id = p_user;

  begin
    insert into pg_temp.mock_notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (p_user, 'in_app', 'agent.payout_method_approved', jsonb_build_object(
      'title', 'Your payout method was approved',
      'body', coalesce(v_pd->>'other','Your requested method') || ' is approved for LoadBoot commission payouts.',
      'tone', 'success', 'url', '/app/agent/#verify'), 'sent', now());
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'method', v_pd->>'other');
end $function$;

CREATE OR REPLACE FUNCTION pg_temp.cc_agent_payout_request_details(p_user uuid, p_fields text[], p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_email text; v_name text; v_list text; v_html text; v_f text;
begin
  perform pg_temp.session_check();
  if not (pg_temp.allowed('finance.approve') or pg_temp.allowed('carriers.approve')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if p_fields is null or array_length(p_fields,1) is null then
    raise exception 'pick at least one detail to request' using errcode='22023';
  end if;

  select full_name into v_name from pg_temp.mock_agent_profiles where user_id = p_user;
  if not found then raise exception 'agent profile not found' using errcode='22023'; end if;
  select email into v_email from pg_temp.mock_users where id = p_user;

  update pg_temp.mock_agent_profiles set
    payout_details = coalesce(payout_details,'{}'::jsonb) || jsonb_build_object(
      'payout_status', 'info_requested',
      'details_requested', jsonb_build_object(
        'by', pg_temp.actor(), 'at', now(), 'fields', to_jsonb(p_fields), 'note', nullif(trim(coalesce(p_note,'')),''))),
    updated_at = now()
  where user_id = p_user;

  -- in-app
  begin
    v_list := array_to_string(p_fields, ', ');
    insert into pg_temp.mock_notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (p_user, 'in_app', 'agent.payout_details_requested', jsonb_build_object(
      'title', 'We need a few payout details',
      'body', 'To approve your payout method we still need: ' || v_list || '. Add them in your Verification Center.',
      'tone', 'urgent', 'url', '/app/agent/#verify'), 'sent', now());
  exception when others then null; end;

  -- branded email
  begin
    if v_email is not null then
      v_html := '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ' || coalesce(v_name,'there') || ',</p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Thanks for setting up your LoadBoot agent account. You chose a payout method outside our standard list, which is fine &mdash; we just need the full receiving-account details before we can approve it, so your first commission lands without a failed transfer.</p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0 0 8px;"><strong>Please add:</strong></p><ul style="font-size:16px;line-height:1.7;margin:0 0 16px;padding-left:22px;">';
      foreach v_f in array p_fields loop
        v_html := v_html || '<li>' || v_f || '</li>';
      end loop;
      v_html := v_html || '</ul>';
      if nullif(trim(coalesce(p_note,'')),'') is not null then
        v_html := v_html || '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;background:#f8fafc;border-left:3px solid #1d4ed8;padding:10px 14px;">' || p_note || '</p>';
      end if;
      v_html := v_html
        || '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Everything must be in <strong>your own legal name</strong> &mdash; the same name as the ID you uploaded. Accounts in someone else&rsquo;s name cannot be paid.</p>'
        || '<p style="margin:0 0 16px;"><a href="https://loadboot.com/app/agent/#verify" style="display:inline-block;background:#1d4ed8;border-radius:8px;padding:12px 24px;text-decoration:none;"><span style="color:#ffffff !important;font-size:16px;font-weight:bold;">Add my payout details</span></a></p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Not sure where to find something? Just reply &mdash; a real person answers.</p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0;">Riley<br>Agent Support, LoadBoot<br><a href="https://loadboot.com" style="color:#1d4ed8;"><span style="color:#1d4ed8 !important;">loadboot.com</span></a> &middot; +1 (469) 253-7575</p>';
      perform pg_temp.record_email(v_email, 'agent.payout_details_requested',
        'A few payout details needed before we can approve your account', v_html, null,
        'agentpayoutreq:' || p_user::text || ':' || to_char(now(),'YYYYMMDDHH24MI'));
    end if;
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'requested', to_jsonb(p_fields), 'emailed', v_email is not null);
end $function$;

CREATE OR REPLACE FUNCTION pg_temp.cc_agent_payout_verify(p_user uuid, p_ok boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_email text;
begin
  perform pg_temp.session_check();
  if not (pg_temp.allowed('finance.approve') or pg_temp.allowed('carriers.approve')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if p_ok is null then raise exception 'an explicit approve or reject decision is required' using errcode='22023'; end if;
  if not p_ok and coalesce(trim(p_reason),'') = '' then
    raise exception 'rejection reason required' using errcode='22023';
  end if;
  update pg_temp.mock_agent_profiles set
    payout_details = coalesce(payout_details,'{}'::jsonb) || jsonb_build_object(
      'payout_status', case when p_ok then 'verified' else 'rejected' end,
      'payout_reason', p_reason, 'payout_reviewed_at', now()),
    updated_at = now()
  where user_id = p_user;
  if not found then raise exception 'agent profile not found' using errcode='22023'; end if;
  begin
    insert into pg_temp.mock_notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (p_user, 'in_app', 'agent.payout_review', jsonb_build_object(
      'title', case when p_ok then 'Payout details verified' else 'Payout details need a fix' end,
      'body', coalesce(p_reason, case when p_ok then 'Your payout method is verified.' else 'Please correct your payout details.' end),
      'tone', case when p_ok then 'success' else 'urgent' end, 'url', '/app/agent/#verify'), 'sent', now());
  exception when others then null; end;
  if not p_ok then
    begin
      select email into v_email from pg_temp.mock_users where id = p_user;
      if v_email is not null then
        perform pg_temp.record_email(v_email, 'agent.payout_review', 'Payout details need a correction',
          '<div style="font-family:Inter,Arial,sans-serif"><h2>Your payout details need a correction</h2><p><b>Reason:</b> ' || p_reason || '</p><p>Open your Verification Center and update your payout method.</p></div>',
          null, 'agentpayout:' || p_user::text || ':' || to_char(now(),'YYYYMMDDHH24MI'));
      end if;
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'verified', p_ok);
end $function$;

DO $tests$
DECLARE target uuid:='00000000-0000-0000-0000-000000000002'; r jsonb; before_row jsonb; failed boolean; stmt text;
BEGIN
 INSERT INTO pg_temp.mock_users VALUES(target,'synthetic@example.invalid');
 INSERT INTO pg_temp.mock_agent_profiles VALUES(target,'SYNTHETIC','other','{"other":"synthetic","account":"123456789","account_title":"SYNTHETIC"}',now());
 PERFORM set_config('audit.mock_permission','finance.approve',true);
 PERFORM set_config('audit.mock_session','valid',true);
 r:=pg_temp.baseline_verify(target,NULL);
 ASSERT r->>'ok'='true' AND r->'verified'='null'::jsonb,'baseline response';
 ASSERT (SELECT payout_details->>'payout_status'='rejected' FROM pg_temp.mock_agent_profiles WHERE user_id=target),'baseline not reproduced';
 UPDATE pg_temp.mock_agent_profiles SET payout_details='{"other":"synthetic","account":"123456789","account_title":"SYNTHETIC"}' WHERE user_id=target;
 TRUNCATE pg_temp.mock_notifications,pg_temp.mock_email_log;
 SELECT to_jsonb(p) INTO before_row FROM pg_temp.mock_agent_profiles p WHERE user_id=target;
 failed:=false; BEGIN PERFORM pg_temp.cc_agent_payout_verify(target,NULL); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END; ASSERT failed,'NULL accepted';
 failed:=false; BEGIN PERFORM pg_temp.cc_agent_payout_verify(target,false); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END; ASSERT failed,'blank rejection accepted';
 ASSERT (SELECT to_jsonb(p)=before_row FROM pg_temp.mock_agent_profiles p WHERE user_id=target),'invalid mutation';
 ASSERT NOT EXISTS(SELECT FROM pg_temp.mock_notifications),'invalid notification';
 ASSERT NOT EXISTS(SELECT FROM pg_temp.mock_email_log),'invalid email';
 r:=pg_temp.cc_agent_payout_verify(target,true); ASSERT r->>'verified'='true','approve';
 r:=pg_temp.cc_agent_payout_verify(target,false,'synthetic reason'); ASSERT r->>'verified'='false','reject';
 ASSERT (SELECT count(*)=1 FROM pg_temp.mock_email_log),'reject email contract';
 r:=pg_temp.cc_agent_payout_approve_method(target); ASSERT r->>'ok'='true','method';
 failed:=false; BEGIN PERFORM pg_temp.cc_agent_payout_request_details(target,ARRAY[]::text[]); EXCEPTION WHEN invalid_parameter_value THEN failed:=true; END; ASSERT failed,'empty details accepted';
 r:=pg_temp.cc_agent_payout_request_details(target,ARRAY['account_title'],'synthetic'); ASSERT r->>'ok'='true','details';
 ASSERT (SELECT count(*)=2 FROM pg_temp.mock_email_log),'details email contract';
 ASSERT (SELECT payout_details->>'payout_status'='info_requested' FROM pg_temp.mock_agent_profiles WHERE user_id=target),'details state';
 PERFORM set_config('audit.mock_permission','carriers.approve',true);
 r:=pg_temp.cc_agent_payout_verify(target,true); ASSERT r->>'ok'='true','carrier approve';
 r:=pg_temp.cc_agent_payout_approve_method(target); ASSERT r->>'ok'='true','carrier method';
 r:=pg_temp.cc_agent_payout_request_details(target,ARRAY['account_title']); ASSERT r->>'ok'='true','carrier details';
 PERFORM set_config('audit.mock_permission','denied',true);
 FOREACH stmt IN ARRAY ARRAY[format('select pg_temp.cc_agent_payout_verify(%L::uuid,true)',target),format('select pg_temp.cc_agent_payout_approve_method(%L::uuid)',target),format('select pg_temp.cc_agent_payout_request_details(%L::uuid,ARRAY[''account_title''])',target)] LOOP
 failed:=false; BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN failed:=true; END; ASSERT failed,'denied permission accepted';
 END LOOP;
 PERFORM set_config('audit.mock_permission','finance.approve',true);
 PERFORM set_config('audit.mock_session','invalid',true);
 FOREACH stmt IN ARRAY ARRAY[format('select pg_temp.cc_agent_payout_verify(%L::uuid,true)',target),format('select pg_temp.cc_agent_payout_approve_method(%L::uuid)',target),format('select pg_temp.cc_agent_payout_request_details(%L::uuid,ARRAY[''account_title''])',target)] LOOP
 failed:=false; BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN failed:=true; END; ASSERT failed,'invalid session accepted';
 END LOOP;
END $tests$;
ROLLBACK;
SELECT 'PASS: 24 isolated source-contract assertions; mocked permissions, session and email; no deployed function or real data changed' result;

