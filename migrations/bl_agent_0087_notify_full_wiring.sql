-- bl_agent_0087 — COMPLETE notification + email wiring for the agent program.
-- Every event now reaches BOTH sides (agent in-app+email, CC in-app):
--   1. onboarding submitted  -> agent gets "application received" (in-app+email); staff in-app already existed
--   2. payout requested      -> agent gets confirmation (in-app+email); staff in-app already existed
--   3. payout decided        -> agent notified+emailed on APPROVE / REJECT / PAID(sent)   [was: silent]
--   4. payout received       -> staff notified when the agent taps ✓ Received             [was: silent]
--   5. CC thread reply       -> agent also gets an EMAIL (in-app already existed)
--   6. agent recruits agent  -> upline also gets an EMAIL (in-app already existed)
-- Plus: referral_accrue_core new_commissions counter now counts REAL inserts only.

-- ---------- 1. onboarding submit: confirm to the agent ----------
create or replace function public.agent_save_onboarding(p jsonb, p_submit boolean default false)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_status text; v_email text;
begin
  if auth.uid() is null then raise exception 'not authorized' using errcode='42501'; end if;
  insert into app_private.agent_profiles as ap (user_id, full_name, phone, city, state, agency, website, years_exp, network, payout_method, payout_details, tax_form, tax_id_last4, agreement_signed_at, agreement_name, agreement_ip, status, updated_at)
  values (auth.uid(), p->>'full_name', p->>'phone', p->>'city', p->>'state', p->>'agency', p->>'website',
          nullif(p->>'years_exp','')::int, coalesce(p->'network','{}'::jsonb),
          p->>'payout_method', coalesce(p->'payout_details','{}'::jsonb), p->>'tax_form', p->>'tax_id_last4',
          case when coalesce(p->>'agreement_name','') <> '' then now() end, nullif(p->>'agreement_name',''), p->>'agreement_ip',
          case when p_submit then 'under_review' else 'draft' end, now())
  on conflict (user_id) do update set
    full_name = coalesce(excluded.full_name, ap.full_name), phone = coalesce(excluded.phone, ap.phone),
    city = coalesce(excluded.city, ap.city), state = coalesce(excluded.state, ap.state),
    agency = coalesce(excluded.agency, ap.agency), website = coalesce(excluded.website, ap.website),
    years_exp = coalesce(excluded.years_exp, ap.years_exp),
    network = case when excluded.network <> '{}'::jsonb then excluded.network else ap.network end,
    payout_method = coalesce(excluded.payout_method, ap.payout_method),
    payout_details = case when excluded.payout_details <> '{}'::jsonb then excluded.payout_details else ap.payout_details end,
    tax_form = coalesce(excluded.tax_form, ap.tax_form), tax_id_last4 = coalesce(excluded.tax_id_last4, ap.tax_id_last4),
    agreement_signed_at = coalesce(excluded.agreement_signed_at, ap.agreement_signed_at),
    agreement_name = coalesce(excluded.agreement_name, ap.agreement_name),
    agreement_ip = coalesce(excluded.agreement_ip, ap.agreement_ip),
    status = case when p_submit then 'under_review' else ap.status end,
    updated_at = now()
  returning status into v_status;
  if p_submit then
    if not exists (select 1 from app_private.agent_profiles ap2 where ap2.user_id = auth.uid()
                     and coalesce(ap2.full_name,'') <> '' and coalesce(ap2.phone,'') <> ''
                     and ap2.agreement_signed_at is not null and coalesce(ap2.payout_method,'') <> '') then
      raise exception 'complete name, phone, payout method and sign the agreement before submitting' using errcode='22023';
    end if;
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload)
      values ('staff', 'in_app', 'agent.review_requested',
        jsonb_build_object('user', auth.uid(), 'title', '🤝 Agent verification requested', 'body', coalesce(p->>'full_name','An agent') || ' submitted onboarding — review in the Agents tab.'));
    exception when others then null; end;
    -- NEW: confirm receipt to the agent (in-app + email)
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (auth.uid(), 'in_app', 'agent.submitted', jsonb_build_object(
        'title', '📨 Application received — under review',
        'body', 'Our team reviews within 1 business day. You will get an email the moment a decision is made. Track progress in the Verification Center.',
        'tone', 'info', 'url', '/app/agent/#verify'), 'sent', now());
    exception when others then null; end;
    begin
      select email into v_email from auth.users where id = auth.uid();
      if v_email is not null then
        perform app_private.sys_email(v_email, 'agent.submitted', 'LoadBoot Agent: application received ✅',
          '<div style="font-family:Inter,Arial,sans-serif"><h2>Got it — your application is under review</h2>'
          || '<p>Thanks ' || coalesce(p->>'full_name','') || '! A real person reviews every agent application — typically within <b>1 business day</b>. '
          || 'You will get an email (and an in-app notification) the moment a decision is made.</p>'
          || '<p>Meanwhile you can track every step in your <a href="https://loadboot.com/app/agent/#verify">Verification Center</a>.</p></div>',
          null, 'agentsubmit:' || auth.uid()::text || ':' || to_char(now(),'YYYYMMDD'));
      end if;
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end; $$;
revoke all on function public.agent_save_onboarding(jsonb, boolean) from public;
grant execute on function public.agent_save_onboarding(jsonb, boolean) to authenticated;

-- ---------- 2. payout requested: confirm to the agent ----------
create or replace function public.agent_request_payout()
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_ref app_private.referrers; v_prof app_private.agent_profiles; v_payable numeric; v_id uuid; v_email text;
begin
  v_ref := app_private.agent_referrer_for(auth.uid());
  if v_ref.id is null then raise exception 'no agent account' using errcode='42501'; end if;
  select * into v_prof from app_private.agent_profiles where user_id = auth.uid();
  if v_prof.status is distinct from 'approved' then raise exception 'verification incomplete — payouts unlock after approval' using errcode='22023'; end if;
  if coalesce(v_prof.payout_method,'') = '' then raise exception 'no payout account on file — add it in Get Verified' using errcode='22023'; end if;
  select coalesce(sum(amount) filter (where status = 'payable'), 0) into v_payable
    from app_private.referral_commissions where referrer_id = v_ref.id;
  if v_payable < 100 then raise exception 'payable balance $% is below the $100 minimum', v_payable using errcode='22023'; end if;
  if exists (select 1 from app_private.referral_payout_requests r where r.referrer_id = v_ref.id and r.status in ('requested','approved')) then
    raise exception 'a payout request is already in progress' using errcode='22023';
  end if;
  insert into app_private.referral_payout_requests (referrer_id, requested_by, amount, payout_details, status)
  values (v_ref.id, auth.uid(), v_payable,
          coalesce(v_prof.payout_details, '{}'::jsonb) || jsonb_build_object('method', v_prof.payout_method, 'account_title', coalesce(v_prof.payout_details->>'account_title', v_prof.full_name)),
          'requested')
  returning id into v_id;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload)
    values ('staff', 'in_app', 'agent.payout_requested',
      jsonb_build_object('title', '💸 Agent payout requested', 'body', coalesce(v_prof.full_name,'Agent') || ' — $' || v_payable || ' to ' || v_prof.payout_method, 'request', v_id));
  exception when others then null; end;
  -- NEW: confirmation to the agent (in-app + email)
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (auth.uid(), 'in_app', 'agent.payout_requested_self', jsonb_build_object(
      'title', '💸 Payout request received — $' || v_payable,
      'body', 'A person reviews it, then the transfer goes out to your ' || v_prof.payout_method || ' account. Bank transfers typically land 3–5 business days after SENT. Track it in Payouts.',
      'tone', 'info', 'url', '/app/agent/#payouts'), 'sent', now());
  exception when others then null; end;
  begin
    select email into v_email from auth.users where id = auth.uid();
    if v_email is not null then
      perform app_private.sys_email(v_email, 'agent.payout_requested_self', 'LoadBoot: payout request received — $' || v_payable,
        '<div style="font-family:Inter,Arial,sans-serif"><h2>💸 Your payout request is in</h2>'
        || '<p><b>$' || v_payable || '</b> → your ' || v_prof.payout_method || ' account. A person reviews every payout, then the transfer goes out. '
        || 'Bank transfers typically land <b>3–5 business days after SENT</b>.</p>'
        || '<p>Track every step: <a href="https://loadboot.com/app/agent/#payouts">Payout Center</a></p></div>',
        null, 'agentpayoutreq:' || v_id::text);
    end if;
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'id', v_id, 'amount', v_payable,
    'note', 'Payout requested — a person reviews it, then the transfer goes out. Bank transfers typically land in 3–5 business days after SENT.');
end; $$;
revoke all on function public.agent_request_payout() from public;
grant execute on function public.agent_request_payout() to authenticated;

-- ---------- 3. payout decision: agent notified + emailed on every transition ----------
create or replace function public.cc_referral_payout_decide(p_id uuid, p_action text, p_note text default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_req app_private.referral_payout_requests; v_n int := 0; v_user uuid; v_email text; v_title text; v_body text; v_subj text; v_html text;
begin
  if not public.has_global_permission('finance.approve') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_action not in ('approve','reject','paid') then raise exception 'action must be approve, reject or paid' using errcode='22023'; end if;
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
    update app_private.referral_commissions set status='paid', paid_at=now(), paid_by=auth.uid()
      where referrer_id = v_req.referrer_id and status='payable';
    get diagnostics v_n = row_count;
    update app_private.referral_payout_requests set status='paid', decided_by=auth.uid(), decided_at=now(), note=coalesce(p_note,note) where id=p_id;
  end if;
  perform app_private.log_audit('referral.payout_'||p_action,'payout_request',p_id::text,null,
    format('%s ($%s, %s commissions)', p_action, v_req.amount, v_n), null);
  -- NEW: tell the agent (in-app + email) at every transition
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
      v_body  := 'The transfer to your ' || coalesce(v_req.payout_details->>'method','payout') || ' account went out. Bank transfers typically land in 3–5 business days. Tap “✓ Received” in the Payout Center when it arrives.';
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
end; $$;
revoke all on function public.cc_referral_payout_decide(uuid, text, text) from public;
grant execute on function public.cc_referral_payout_decide(uuid, text, text) to authenticated;

-- ---------- 4. agent confirms received: close the loop for CC ----------
create or replace function public.agent_confirm_payout_received(p_id uuid)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_ref app_private.referrers; v_amt numeric;
begin
  v_ref := app_private.agent_referrer_for(auth.uid());
  if v_ref.id is null then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.referral_payout_requests
     set status = 'received', note = coalesce(note,'') || ' · agent confirmed received ' || to_char(now(),'Mon DD')
   where id = p_id and referrer_id = v_ref.id and status in ('paid','approved','sent')
   returning amount into v_amt;
  if not found then raise exception 'request not found or not yet sent' using errcode='22023'; end if;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload)
    values ('staff', 'in_app', 'agent.payout_received',
      jsonb_build_object('title', '✅ Agent confirmed payout received', 'body', coalesce(v_ref.display_name,'Agent') || ' confirmed $' || v_amt || ' landed — payout loop closed.', 'request', p_id));
  exception when others then null; end;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.agent_confirm_payout_received(uuid) from public;
grant execute on function public.agent_confirm_payout_received(uuid) to authenticated;

-- ---------- 5. CC thread reply: agent also gets an EMAIL ----------
create or replace function public.cc_agent_msg_send(p_user uuid, p_body text)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_email text; v_msg uuid;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if coalesce(trim(p_body),'') = '' then raise exception 'empty message' using errcode='22023'; end if;
  insert into app_private.agent_messages(user_id, sender, body, sent_by) values (p_user, 'staff', trim(p_body), auth.uid()) returning id into v_msg;
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (p_user, 'in_app', 'agent.message',
      jsonb_build_object('title', '💬 LoadBoot dispatch replied', 'body', left(trim(p_body), 200), 'tone', 'info', 'url', '/app/agent/#verify'), 'sent', now());
  exception when others then null; end;
  begin
    select email into v_email from auth.users where id = p_user;
    if v_email is not null then
      perform app_private.sys_email(v_email, 'agent.message', 'LoadBoot: new message from the review team 💬',
        '<div style="font-family:Inter,Arial,sans-serif"><h2>💬 The LoadBoot team replied</h2>'
        || '<blockquote style="border-left:3px solid #0883F7;margin:0;padding:6px 14px;color:#333">' || left(trim(p_body), 400) || '</blockquote>'
        || '<p><a href="https://loadboot.com/app/agent/#verify">Reply in your Verification Center →</a></p></div>',
        null, 'agentmsg:' || v_msg::text);
    end if;
  exception when others then null; end;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.cc_agent_msg_send(uuid, text) from public;
grant execute on function public.cc_agent_msg_send(uuid, text) to authenticated;

-- ---------- 6. agent recruits agent: upline also gets an EMAIL ----------
create or replace function public.agent_claim_upline(p_code text)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_ref app_private.referrers; v_parent app_private.referrers; v_email text;
begin
  v_ref := app_private.agent_referrer_for(auth.uid());
  if v_ref.id is null then return jsonb_build_object('ok', false); end if;
  if v_ref.parent_referrer is not null then return jsonb_build_object('ok', true, 'note', 'already linked'); end if;
  select * into v_parent from app_private.referrers where upper(code) = upper(trim(p_code)) limit 1;
  if v_parent.id is null or v_parent.id = v_ref.id or v_parent.user_id = auth.uid() then return jsonb_build_object('ok', false); end if;
  update app_private.referrers set parent_referrer = v_parent.id where id = v_ref.id;
  perform app_private.agent_notify(v_parent.id, 'agent.joined',
    '🤝 A new AGENT joined YOUR team', coalesce(v_ref.display_name,'An agent') || ' signed up through your link — you now earn level-2 overrides on their whole chain.');
  begin
    select email into v_email from auth.users where id = v_parent.user_id;
    if v_email is not null then
      perform app_private.sys_email(v_email, 'agent.team_joined', 'LoadBoot: 🤝 a new agent joined YOUR team',
        '<div style="font-family:Inter,Arial,sans-serif"><h2>🤝 ' || coalesce(v_ref.display_name,'A new agent') || ' joined your team</h2>'
        || '<p>They signed up through your link. From now on you earn a <b>level-2 override (0.50% of gross)</b> on every delivered load their whole chain touches — and deeper levels as they recruit too.</p>'
        || '<p><a href="https://loadboot.com/app/agent/#chain">See your chain →</a></p></div>',
        null, 'agentteam:' || v_ref.id::text);
    end if;
  exception when others then null; end;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.agent_claim_upline(text) from public;
grant execute on function public.agent_claim_upline(text) to authenticated;

-- ---------- 7. truthful accrual counter (only count real inserts) ----------
create or replace function app_private.referral_accrue_core()
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare inv record; v_ref app_private.referrers; v_lvl int; v_pct numeric; v_new int:=0; v_ins int; v_promoted int:=0;
begin
  for inv in
    select fi.id, fi.trip_id, fi.carrier_id as src_org, fi.fee from app_private.fin_invoices fi
    where fi.status in ('sent','paid') and coalesce(fi.fee,0) > 0
      and exists (select 1 from app_private.referral_edges e where e.child_org = fi.carrier_id)
  loop
    select r.* into v_ref from app_private.referral_edges e join app_private.referrers r on r.id=e.referrer_id where e.child_org = inv.src_org limit 1;
    v_lvl := 1;
    while v_lvl <= 5 and v_ref.id is not null and v_ref.status = 'active' loop
      select pct into v_pct from app_private.referral_levels where level = v_lvl;
      exit when v_pct is null or v_pct <= 0;
      if app_private.referrer_pair_active(v_ref.id) or v_lvl > 1 then
        insert into app_private.referral_commissions(invoice_id, trip_id, source_org, referrer_id, level, base_fee, pct, amount, payable_at)
          values (inv.id, inv.trip_id, inv.src_org, v_ref.id, v_lvl, inv.fee, v_pct,
                  round(inv.fee * v_pct / 5.0, 2), now() + interval '15 days')
          on conflict (invoice_id, referrer_id) do nothing;
        get diagnostics v_ins = row_count; v_new := v_new + v_ins;
      end if;
      v_ref := app_private.referral_next(v_ref); v_lvl := v_lvl + 1;
    end loop;
  end loop;
  for inv in
    select fi.id, fi.trip_id, l.broker_org as src_org, fi.fee
      from app_private.fin_invoices fi
      join app_private.trips t on t.id = fi.trip_id
      join public.loads l on l.id = t.load_id
    where fi.status in ('sent','paid') and coalesce(fi.fee,0) > 0 and l.broker_org is not null
      and exists (select 1 from app_private.referral_edges e where e.child_org = l.broker_org)
  loop
    select r.* into v_ref from app_private.referral_edges e join app_private.referrers r on r.id=e.referrer_id where e.child_org = inv.src_org limit 1;
    v_lvl := 1;
    while v_lvl <= 5 and v_ref.id is not null and v_ref.status = 'active' loop
      select pct into v_pct from app_private.referral_levels where level = v_lvl;
      exit when v_pct is null or v_pct <= 0;
      if app_private.referrer_pair_active(v_ref.id) or v_lvl > 1 then
        insert into app_private.referral_commissions(invoice_id, trip_id, source_org, referrer_id, level, base_fee, pct, amount, payable_at)
          values (inv.id, inv.trip_id, inv.src_org, v_ref.id, v_lvl, inv.fee, v_pct,
                  round(inv.fee * v_pct / 5.0, 2), now() + interval '15 days')
          on conflict (invoice_id, referrer_id) do nothing;
        get diagnostics v_ins = row_count; v_new := v_new + v_ins;
      end if;
      v_ref := app_private.referral_next(v_ref); v_lvl := v_lvl + 1;
    end loop;
  end loop;
  update app_private.referral_commissions set status='payable'
    where status='accrued' and payable_at <= now();
  get diagnostics v_promoted = row_count;
  perform app_private.log_audit('referral.accrue','system','referral',null,
    format('%s new commissions, %s promoted payable', v_new, v_promoted), null);
  return jsonb_build_object('ok',true,'new_commissions',v_new,'promoted_payable',v_promoted);
end; $$;

notify pgrst, 'reload schema';
