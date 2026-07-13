-- bl_agent_0075 — AGENT ONBOARDING + CC APPROVAL (Phase A of AGENT-PORTAL-SPEC).
-- Profile + 3-step wizard data + agreement e-sign; referrers.status gates earnings:
-- agent signup => referrer 'pending' → submit onboarding => profile 'under_review'
-- → CC approve => referrer 'active' (accrual engine already honors status).

create table if not exists app_private.agent_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text, phone text, city text, state text, agency text, website text,
  years_exp int, network jsonb default '{}'::jsonb,
  payout_method text, payout_details jsonb default '{}'::jsonb,
  tax_form text, tax_id_last4 text,
  agreement_signed_at timestamptz, agreement_name text, agreement_ip text,
  status text not null default 'draft' check (status in ('draft','under_review','approved','rejected','info_needed')),
  review_note text, reviewed_by uuid, reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- agent signups start PENDING (no earnings until CC approves)
create or replace function public.handle_new_user()
 returns trigger language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  admin_exists boolean; v_role text; v_company text; v_org uuid;
begin
  select exists(select 1 from public.profiles where role='admin') into admin_exists;
  v_role    := case when admin_exists then 'carrier' else 'admin' end;
  v_company := coalesce(new.raw_user_meta_data->>'company','');
  insert into public.profiles (id, email, company, contact_name, role, status)
  values (new.id, new.email, v_company, coalesce(new.raw_user_meta_data->>'name',''), v_role,
          case when admin_exists then 'pending' else 'active' end);
  if v_role = 'carrier' and coalesce(new.raw_user_meta_data->>'role','') not in ('driver','agent') then
    begin
      insert into public.organizations (kind, name, owner_user_id, status)
      values ('carrier', coalesce(nullif(trim(v_company), ''), split_part(new.email, '@', 1), 'New Carrier'), new.id, 'active')
      returning id into v_org;
      insert into public.organization_memberships (org_id, user_id, member_role, status)
      values (v_org, new.id, 'owner', 'active');
    exception when others then null;
    end;
  end if;
  if coalesce(new.raw_user_meta_data->>'role','') = 'agent' then
    begin
      insert into app_private.referrers (user_id, org_id, kind, code, display_name, status)
      values (new.id, null, 'affiliate',
              'LB' || upper(substr(md5(new.id::text || now()::text), 1, 6)),
              coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), 'pending');
      insert into app_private.agent_profiles (user_id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'name',''));
    exception when others then null;
    end;
  end if;
  return new;
end;
$function$;

-- ---------- agent: read own onboarding state ----------
create or replace function public.agent_onboarding_status()
 returns jsonb language sql stable security definer
 set search_path to 'app_private, public'
as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) - 'payout_details' from app_private.agent_profiles p where p.user_id = auth.uid()),
    'referrer_status', (select r.status from app_private.referrers r where r.user_id = auth.uid() order by r.created_at limit 1));
$$;
revoke all on function public.agent_onboarding_status() from public;
grant execute on function public.agent_onboarding_status() to authenticated;

-- ---------- agent: save/submit onboarding ----------
create or replace function public.agent_save_onboarding(p jsonb, p_submit boolean default false)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_status text;
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
      values ('staff', 'inapp', 'agent.review_requested',
        jsonb_build_object('user', auth.uid(), 'title', '🤝 Agent verification requested', 'body', coalesce(p->>'full_name','An agent') || ' submitted onboarding — review in Ops Radar.'));
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end; $$;
revoke all on function public.agent_save_onboarding(jsonb, boolean) from public;
grant execute on function public.agent_save_onboarding(jsonb, boolean) to authenticated;

-- ---------- CC: queue + decide ----------
create or replace function public.cc_agents_queue()
 returns jsonb language sql stable security definer
 set search_path to 'app_private, public'
as $$
  select case when not (public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage'))
    then jsonb_build_object('error','not authorized')
    else coalesce(jsonb_agg(jsonb_build_object(
      'user_id', ap.user_id, 'name', ap.full_name, 'phone', ap.phone, 'city', ap.city, 'state', ap.state,
      'agency', ap.agency, 'years_exp', ap.years_exp, 'network', ap.network,
      'payout_method', ap.payout_method, 'tax_form', ap.tax_form,
      'agreement_signed', ap.agreement_signed_at is not null, 'signed_name', ap.agreement_name,
      'email', (select email from auth.users u where u.id = ap.user_id),
      'code', (select code from app_private.referrers r where r.user_id = ap.user_id order by created_at limit 1),
      'submitted_at', ap.updated_at
    ) order by ap.updated_at), '[]'::jsonb) end
  from app_private.agent_profiles ap where ap.status = 'under_review';
$$;
revoke all on function public.cc_agents_queue() from public;
grant execute on function public.cc_agents_queue() to authenticated;

create or replace function public.cc_agent_decide(p_user uuid, p_action text, p_note text default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_email text; v_name text;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if p_action not in ('approve','reject','info') then raise exception 'action must be approve, reject or info' using errcode='22023'; end if;
  update app_private.agent_profiles set
    status = case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'info_needed' end,
    review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where user_id = p_user;
  if not found then raise exception 'agent profile not found' using errcode='22023'; end if;
  update app_private.referrers set status = case when p_action = 'approve' then 'active' else 'pending' end
   where user_id = p_user;
  select u.email, coalesce(ap.full_name, split_part(u.email,'@',1)) into v_email, v_name
    from auth.users u left join app_private.agent_profiles ap on ap.user_id = u.id where u.id = p_user;
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (p_user, 'in_app', 'agent.decision', jsonb_build_object(
      'title', case p_action when 'approve' then '🎉 You are APPROVED — your chain can earn now' when 'reject' then 'Your agent application was not approved' else 'We need more info on your application' end,
      'body', coalesce(p_note,''), 'tone', case p_action when 'approve' then 'success' else 'warning' end, 'url', '/app/agent/'), 'sent', now());
  exception when others then null; end;
  begin
    if v_email is not null then
      perform app_private.sys_email(v_email, 'agent.decision',
        case p_action when 'approve' then '🎉 LoadBoot Agent: APPROVED — you are live' when 'reject' then 'LoadBoot Agent application update' else 'LoadBoot Agent: one more thing needed' end,
        '<div style="font-family:Inter,Arial,sans-serif"><h2>' ||
        case p_action when 'approve' then 'Welcome aboard, ' || v_name || ' — your chain earns from today'
          when 'reject' then 'Application not approved' else 'We need a bit more information' end || '</h2><p>' || coalesce(p_note,'') || '</p>'
        || case when p_action='approve' then '<p><a href="https://loadboot.com/app/agent/" style="background:#16a34a;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800">Open your dashboard →</a></p>' else '' end
        || '</div>', null, 'agentdecision:' || p_user::text || ':' || p_action);
    end if;
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'action', p_action);
end; $$;
revoke all on function public.cc_agent_decide(uuid, text, text) from public;
grant execute on function public.cc_agent_decide(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
