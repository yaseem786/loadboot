-- Staging-first: current sessions for staff finance and exact approved payout accounting.
DO $patch$
DECLARE old_acl text;
BEGIN
 IF md5(pg_get_functiondef('app_private.assert_payment_session()'::regprocedure)) IS DISTINCT FROM '18344c1e6ac6a2b76e2dae5ee7659334' THEN RAISE EXCEPTION 'Session helper drift'; END IF;
 IF md5(pg_get_functiondef('public.cc_carrier_payment_profile(uuid)'::regprocedure)) IS DISTINCT FROM '6033fb014532f5e0cf92c4a79a527a6e' THEN RAISE EXCEPTION 'Source drift: cc_carrier_payment_profile'; END IF;
 IF md5(pg_get_functiondef('public.cc_payment_profiles_queue(text)'::regprocedure)) IS DISTINCT FROM '699ac3566ead0af78000a43b10767a91' THEN RAISE EXCEPTION 'Source drift: cc_payment_profiles_queue'; END IF;
 IF md5(pg_get_functiondef('public.cc_referral_payout_decide(uuid,text,text)'::regprocedure)) IS DISTINCT FROM 'd79403d32cc9aa98867bf6e3d47558f4' THEN RAISE EXCEPTION 'Source drift: cc_referral_payout_decide'; END IF;
 IF md5(pg_get_functiondef('public.cc_referral_payout_queue(text)'::regprocedure)) IS DISTINCT FROM 'cbad02dd128029aae1db46a833667d0b' THEN RAISE EXCEPTION 'Source drift: cc_referral_payout_queue'; END IF;
 IF md5(pg_get_functiondef('public.cc_verify_payment_profile(uuid,boolean,text)'::regprocedure)) IS DISTINCT FROM 'a7570054ceca4dc83f4d5f71360c7b78' THEN RAISE EXCEPTION 'Source drift: cc_verify_payment_profile'; END IF;
 SELECT proacl::text INTO old_acl FROM pg_proc WHERE oid='public.cc_carrier_payment_profile(uuid)'::regprocedure;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.cc_carrier_payment_profile(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare r app_private.org_payment_profiles;
begin
  perform app_private.assert_payment_session();
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select * into r from app_private.org_payment_profiles where org_id = p_org;
  if r.org_id is null then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object('exists', true, 'bank_name', r.bank_name, 'account_title', r.account_title,
    'account_number', r.account_number, 'routing_number', r.routing_number, 'account_type', r.account_type,
    'payment_method', r.payment_method, 'bank_address', r.bank_address, 'swift_bic', r.swift_bic,
    'beneficiary_address', r.beneficiary_address, 'remittance_email', r.remittance_email, 'bank_phone', r.bank_phone,
    'tax_id', r.tax_id, 'factoring_company', r.factoring_company, 'factoring_noa', r.factoring_noa,
    'factor_details', r.factor_details, 'noa_status', r.noa_status, 'noa_doc', r.noa_doc,
    'direct_brokers', r.direct_brokers,
    'verified', r.verified, 'verified_at', r.verified_at, 'updated_at', r.updated_at);
end; $function$
$source$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_carrier_payment_profile(uuid)'::regprocedure) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'ACL drift: cc_carrier_payment_profile'; END IF;
 SELECT proacl::text INTO old_acl FROM pg_proc WHERE oid='public.cc_payment_profiles_queue(text)'::regprocedure;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.cc_payment_profiles_queue(p_status text DEFAULT 'unverified'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
begin
  perform app_private.assert_payment_session();
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('org_id', pp.org_id, 'org', o.name, 'kind', o.kind,
      'bank_name', pp.bank_name, 'account_title', pp.account_title, 'account_number', pp.account_number,
      'verified', pp.verified, 'updated_at', pp.updated_at) order by pp.updated_at)
    from app_private.org_payment_profiles pp join public.organizations o on o.id = pp.org_id
    where case when p_status = 'unverified' then not pp.verified else true end), '[]'::jsonb);
end; $function$
$source$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_payment_profiles_queue(text)'::regprocedure) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'ACL drift: cc_payment_profiles_queue'; END IF;
 SELECT proacl::text INTO old_acl FROM pg_proc WHERE oid='public.cc_referral_payout_decide(uuid,text,text)'::regprocedure;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.cc_referral_payout_decide(p_id uuid, p_action text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_commission_ids uuid[]; v_locked_total numeric; v_req app_private.referral_payout_requests; v_n int := 0; v_user uuid; v_email text; v_title text; v_body text; v_subj text; v_html text;
begin
  perform app_private.assert_payment_session();
  if not public.has_global_permission('finance.approve') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_action is null or p_action not in ('approve','reject','paid') then raise exception 'action must be approve, reject or paid' using errcode='22023'; end if;
  select * into v_req from app_private.referral_payout_requests where id = p_id for update;
  if v_req.id is null then raise exception 'payout request not found' using errcode='22023'; end if;
  if v_req.requested_by = auth.uid() then raise exception 'requester cannot decide their own payout' using errcode='42501'; end if;
  if p_action = 'approve' then
    if v_req.status <> 'requested' then raise exception 'only a requested payout can be approved' using errcode='22023'; end if;
    update app_private.referral_payout_requests set status='approved', decided_by=auth.uid(), decided_at=now(), note=coalesce(p_note,note) where id=p_id;
  elsif p_action = 'reject' then
    if v_req.status not in ('requested','approved') then raise exception 'only an open payout can be rejected' using errcode='22023'; end if;
    update app_private.referral_payout_requests set status='rejected', decided_by=auth.uid(), decided_at=now(), note=coalesce(p_note,note) where id=p_id;
  else
    if v_req.status <> 'approved' then raise exception 'approve the payout before marking it paid' using errcode='22023'; end if;
    -- Capture/lock the exact payable rows; never sweep commissions arriving later.
    select array_agg(c.id), coalesce(sum(c.amount),0) into v_commission_ids, v_locked_total
      from (select id,amount from app_private.referral_commissions
             where referrer_id=v_req.referrer_id and status='payable'
             order by id for update) c;
    if v_locked_total is distinct from v_req.amount then
      raise exception 'Payable balance changed since this payout was requested; review the request before marking it paid' using errcode='22023';
    end if;
    update app_private.referral_commissions set status='paid', paid_at=now(), paid_by=auth.uid()
      where id=any(v_commission_ids) and referrer_id=v_req.referrer_id and status='payable';
    get diagnostics v_n = row_count;
    update app_private.referral_payout_requests set status='paid', decided_by=auth.uid(), decided_at=now(), note=coalesce(p_note,note) where id=p_id;
  end if;
  perform app_private.log_audit('referral.payout_'||p_action,'payout_request',p_id::text,null,
    format('%s ($%s, %s commissions)', p_action, v_req.amount, v_n), null);
  select r.user_id into v_user from app_private.referrers r where r.id = v_req.referrer_id;
  if v_user is not null then
    select email into v_email from auth.users where id = v_user;
    if p_action = 'approve' then
      v_title := '✅ Payout APPROVED — $' || v_req.amount;
      v_body  := 'Your payout was approved. The transfer goes out next — bank transfers typically land 3–5 business days after SENT.';
      v_subj  := 'LoadBoot: payout approved — $' || v_req.amount;
    elsif p_action = 'reject' then
      v_title := '✕ Payout request not approved';
      v_body  := coalesce(nullif(trim(p_note),''), 'See the note in your Payout Center — your balance stays payable and you can request again.');
      v_subj  := 'LoadBoot: payout request update';
    else
      v_title := '💸 Payout SENT — $' || v_req.amount || ' is on the way';
      v_body  := 'The transfer to your ' || coalesce(v_req.payout_details->>'method','payout') || ' account went out. Bank transfers typically land in 3–5 business days. Tap "✓ Received" in the Payout Center when it arrives.';
      v_subj  := 'LoadBoot: 💸 $' || v_req.amount || ' payout SENT — arriving in 3–5 business days';
    end if;
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (v_user, 'in_app', 'agent.payout_' || p_action, jsonb_build_object(
        'title', v_title, 'body', v_body, 'tone', case when p_action='reject' then 'warning' else 'success' end, 'url', '/app/agent/#payouts'), 'sent', now());
    exception when others then null; end;
    begin
      if v_email is not null then
        v_html := '<div style="font-family:Inter,Arial,sans-serif"><h2>' || v_title || '</h2><p>' || v_body || '</p>'
          || '<p><a href="https://loadboot.com/app/agent/#payouts" style="background:#0883F7;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800">Open Payout Center →</a></p></div>';
        perform app_private.sys_email(v_email, 'agent.payout_' || p_action, v_subj, v_html, null, 'agentpayout:' || p_id::text || ':' || p_action);
      end if;
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok',true,'id',p_id,'action',p_action,'commissions_paid',v_n,
    'note','this records the decision only; transfer money through the normal payment rail');
end; $function$
$source$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_referral_payout_decide(uuid,text,text)'::regprocedure) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'ACL drift: cc_referral_payout_decide'; END IF;
 SELECT proacl::text INTO old_acl FROM pg_proc WHERE oid='public.cc_referral_payout_queue(text)'::regprocedure;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.cc_referral_payout_queue(p_status text DEFAULT 'open'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
begin
  perform app_private.assert_payment_session();
  if not public.has_global_permission('finance.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'amount', r.amount, 'status', r.status, 'note', r.note,
      'requested_at', r.requested_at, 'decided_at', r.decided_at,
      'payout_details', r.payout_details,
      'referrer_code', f.code, 'referrer_kind', f.kind, 'referrer_name', coalesce(f.display_name, f.code),
      'payable_now', coalesce((select sum(c.amount) from app_private.referral_commissions c
                               where c.referrer_id = f.id and c.status='payable'),0)
    ) order by r.requested_at)
    from app_private.referral_payout_requests r
    join app_private.referrers f on f.id = r.referrer_id
    where case when p_status = 'open' then r.status in ('requested','approved') else true end), '[]'::jsonb);
end; $function$
$source$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_referral_payout_queue(text)'::regprocedure) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'ACL drift: cc_referral_payout_queue'; END IF;
 SELECT proacl::text INTO old_acl FROM pg_proc WHERE oid='public.cc_verify_payment_profile(uuid,boolean,text)'::regprocedure;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.cc_verify_payment_profile(p_org uuid, p_ok boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
begin
  perform app_private.assert_payment_session();
  if not public.has_global_permission('finance.approve') then raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(p_ok,false) = false and coalesce(trim(p_note),'') = '' then
    raise exception 'a written reason is required when rejecting/revoking bank details' using errcode='22023';
  end if;
  update app_private.org_payment_profiles set verified = coalesce(p_ok, false),
    verified_by = case when coalesce(p_ok,false) then auth.uid() else null end,
    verified_at = case when coalesce(p_ok,false) then now() else null end
    where org_id = p_org;
  if not found then raise exception 'no payment profile for that org' using errcode='22023'; end if;
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload)
    select m.user_id, 'in_app', 'bank.' || case when coalesce(p_ok,false) then 'verified' else 'rejected' end,
           jsonb_build_object('title', case when coalesce(p_ok,false) then 'Bank details verified ✓' else 'Bank details need attention' end,
                              'body', coalesce(p_note, 'Your payout bank details were verified by LoadBoot.'), 'url', '/app/carrier/#account')
    from public.organization_memberships m where m.org_id = p_org and m.status='active' limit 3;
  exception when others then null; end;
  perform app_private.log_audit('payments.profile_verify','org',p_org::text,null,
    case when coalesce(p_ok,false) then 'bank profile VERIFIED' else 'bank verification REJECTED/revoked: ' || coalesce(p_note,'') end, null);
  return jsonb_build_object('ok',true,'org',p_org,'verified',coalesce(p_ok,false));
end; $function$
$source$;
 IF (SELECT proacl::text FROM pg_proc WHERE oid='public.cc_verify_payment_profile(uuid,boolean,text)'::regprocedure) IS DISTINCT FROM old_acl THEN RAISE EXCEPTION 'ACL drift: cc_verify_payment_profile'; END IF;
END $patch$;
