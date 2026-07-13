-- bl_agent_0076 — AGENT-SOURCED LOADS ("carrier + load" pair):
-- Approved agents get their own lightweight BROKER org ("<name> (Agent)") so they can
-- post loads with the EXACT same wizard/pipeline brokers use (dispatch review, rate card,
-- multi-stop, direct-carrier targeting, board posting). Pair rule widens:
--   chain ACTIVE = referred CARRIER + (referred broker/shipper OR the agent posts loads).
-- Earnings: agent's own posted loads pay level-1 commission when delivered (demand side
-- they brought themselves) — carrier-side chain earnings unchanged.

-- 1) approve => ensure agent's broker org exists
create or replace function public.cc_agent_decide(p_user uuid, p_action text, p_note text default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_email text; v_name text; v_org uuid;
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
  if p_action = 'approve' and not exists (
      select 1 from public.organizations o where o.owner_user_id = p_user and o.kind <> 'carrier') then
    begin
      insert into public.organizations (kind, name, owner_user_id, status)
      values ('broker', coalesce(v_name, 'Agent') || ' (Agent)', p_user, 'active')
      returning id into v_org;
      insert into public.organization_memberships (org_id, user_id, member_role, status)
      values (v_org, p_user, 'owner', 'active');
    exception when others then null;
    end;
  end if;
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
        || case when p_action='approve' then '<p>You can now also POST LOADS yourself (dispatch reviews each one) — open the broker wizard from your dashboard.</p><p><a href="https://loadboot.com/app/agent/" style="background:#16a34a;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800">Open your dashboard →</a></p>' else '' end
        || '</div>', null, 'agentdecision:' || p_user::text || ':' || p_action);
    end if;
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'action', p_action);
end; $$;
revoke all on function public.cc_agent_decide(uuid, text, text) from public;
grant execute on function public.cc_agent_decide(uuid, text, text) to authenticated;

-- 2) pair rule v2: carrier + (referred demand-side OR own posted loads)
create or replace function app_private.referrer_pair_active(p_ref uuid)
 returns boolean language sql stable
 set search_path to 'app_private, public'
as $$
  select exists (select 1 from app_private.referral_edges e join public.organizations o on o.id = e.child_org
                  where e.referrer_id = p_ref and o.kind = 'carrier')
     and (exists (select 1 from app_private.referral_edges e join public.organizations o on o.id = e.child_org
                   where e.referrer_id = p_ref and o.kind <> 'carrier')
          or exists (select 1 from app_private.referrers r
                       join public.organizations o on o.owner_user_id = r.user_id and o.kind <> 'carrier'
                       join public.loads l on l.broker_org = o.id
                      where r.id = p_ref));
$$;

-- 3) accrual: agent's OWN posted loads pay level-1 on delivery (demand they brought)
create or replace function app_private.referral_accrue_agent_loads()
 returns int language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare inv record; v_pct numeric; v_new int := 0;
begin
  select pct into v_pct from app_private.referral_levels where level = 1;
  if coalesce(v_pct, 0) <= 0 then return 0; end if;
  for inv in
    select fi.id, fi.trip_id, l.broker_org as src_org, fi.fee, r.id as ref_id
      from app_private.fin_invoices fi
      join app_private.trips t on t.id = fi.trip_id
      join public.loads l on l.id = t.load_id
      join public.organizations o on o.id = l.broker_org and o.kind <> 'carrier'
      join app_private.referrers r on r.user_id = o.owner_user_id and r.status = 'active'
      join app_private.agent_profiles ap on ap.user_id = r.user_id and ap.status = 'approved'
    where fi.status in ('sent','paid') and coalesce(fi.fee,0) > 0
      and not exists (select 1 from app_private.referral_commissions c where c.invoice_id = fi.id and c.referrer_id = r.id)
  loop
    if app_private.referrer_pair_active(inv.ref_id) then
      insert into app_private.referral_commissions(invoice_id, trip_id, source_org, referrer_id, level, base_fee, pct, amount, payable_at)
      values (inv.id, inv.trip_id, inv.src_org, inv.ref_id, 1, inv.fee, v_pct,
              round(inv.fee * v_pct / 5.0, 2), now() + interval '15 days')
      on conflict (invoice_id, referrer_id) do nothing;
      v_new := v_new + 1;
    end if;
  end loop;
  return v_new;
end; $$;

-- wire into the main accrue pass (called by cron): append agent-load pass
create or replace function app_private.referral_accrue_all()
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare a jsonb; b int;
begin
  a := app_private.referral_accrue_core();
  b := app_private.referral_accrue_agent_loads();
  return a || jsonb_build_object('agent_load_commissions', b);
end; $$;

-- 4) agent_feed: loads list also covers the agent's OWN posted loads
create or replace function public.agent_feed()
 returns jsonb language plpgsql stable security definer
 set search_path to 'app_private, public'
as $$
declare v_ref app_private.referrers;
begin
  v_ref := app_private.agent_referrer_for(auth.uid());
  if v_ref.id is null then
    select r.* into v_ref from app_private.referrers r
     where r.org_id is not null and r.org_id in (app_private.my_carrier_org(), app_private.my_partner_org())
     order by r.created_at limit 1;
  end if;
  if v_ref.id is null then return jsonb_build_object('has_code', false); end if;
  return jsonb_build_object(
    'has_code', true, 'code', v_ref.code, 'name', v_ref.display_name,
    'link', 'https://loadboot.com/?ref=' || v_ref.code,
    'pair_active', app_private.referrer_pair_active(v_ref.id),
    'own_broker_org', (select o.id from public.organizations o where o.owner_user_id = v_ref.user_id and o.kind <> 'carrier' limit 1),
    'kpis', (select jsonb_build_object(
        'referred', count(*),
        'carriers', count(*) filter (where o.kind = 'carrier'),
        'brokers', count(*) filter (where o.kind <> 'carrier'))
      from app_private.referral_edges e join public.organizations o on o.id = e.child_org
      where e.referrer_id = v_ref.id),
    'chain', coalesce((select jsonb_agg(jsonb_build_object(
        'org', o.name, 'side', case when o.kind = 'carrier' then 'carrier' else 'broker/shipper' end,
        'status', o.status, 'joined_at', e.created_at,
        'loads_posted', (select count(*) from public.loads l where l.broker_org = o.id),
        'trips_delivered', (select count(*) from app_private.trips t where (t.carrier_id = o.id or exists (select 1 from public.loads l2 where l2.id = t.load_id and l2.broker_org = o.id)) and t.status in ('delivered','invoiced')),
        'your_earnings', coalesce((select sum(c.amount) from app_private.referral_commissions c where c.referrer_id = v_ref.id and c.source_org = o.id), 0)
      ) order by e.created_at desc)
      from app_private.referral_edges e join public.organizations o on o.id = e.child_org
      where e.referrer_id = v_ref.id), '[]'::jsonb),
    'loads', coalesce((
      with edges as (
        select child_org from app_private.referral_edges where referrer_id = v_ref.id
        union
        select o.id from public.organizations o where o.owner_user_id = v_ref.user_id and o.kind <> 'carrier')
      select jsonb_agg(row9 order by (row9->>'posted_at') desc) from (
        select jsonb_build_object(
          'lane', l.origin || ' → ' || l.destination, 'rate', l.rate,
          'posted_at', l.created_at, 'load_status', l.status,
          'broker', (select name from public.organizations o2 where o2.id = l.broker_org),
          'broker_yours', l.broker_org in (select child_org from edges),
          'trip_status', t.status, 'delivered_at', t.delivered_at,
          'booked_by', (select name from public.organizations o3 where o3.id = t.carrier_id),
          'booked_by_yours', coalesce(t.carrier_id in (select child_org from edges), false),
          'your_commission', coalesce((select sum(c.amount) from app_private.referral_commissions c
                                        where c.referrer_id = v_ref.id and c.trip_id = t.id), 0)
        ) as row9
        from public.loads l
        left join app_private.trips t on t.load_id = l.id and t.status <> 'cancelled'
        where l.broker_org in (select child_org from edges)
           or t.carrier_id in (select child_org from edges)
        order by l.created_at desc limit 25
      ) z), '[]'::jsonb),
    'totals', (select jsonb_build_object(
        'accrued', coalesce(sum(amount) filter (where status = 'accrued'), 0),
        'payable', coalesce(sum(amount) filter (where status = 'payable'), 0),
        'paid', coalesce(sum(amount) filter (where status = 'paid'), 0))
      from app_private.referral_commissions where referrer_id = v_ref.id),
    'notices', coalesce((select jsonb_agg(jsonb_build_object(
        'at', n.sent_at, 'title', n.payload->>'title', 'body', n.payload->>'body') order by n.sent_at desc)
      from (select * from app_private.notifications
             where recipient_user = v_ref.user_id and template_key like 'agent.%'
             order by sent_at desc limit 15) n), '[]'::jsonb));
end; $$;
revoke all on function public.agent_feed() from public;
grant execute on function public.agent_feed() to authenticated;

notify pgrst, 'reload schema';
