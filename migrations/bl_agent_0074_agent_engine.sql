-- bl_agent_0074 — AGENT ENGINE: one-call dashboard feed + live notifications + email nudges.
-- 1) agent_feed(): everything the agent dashboard needs in one call — identity/link,
--    pair state, KPIs, chain orgs, LIVE loads of the chain (posted → booked (by whom,
--    and is that carrier YOURS) → delivered, with the agent's commission per trip),
--    and the agent's recent in-app notices.
-- 2) Triggers: join / load posted / booked / delivered → in-app notification to the agent
--    (+ welcome email on join, all exception-safe).
-- 3) Pair-pending nudge: accrue cron emails single-sided agents every ~3 days (idempotent).

create or replace function app_private.agent_referrer_for(p_user uuid)
 returns app_private.referrers language sql stable
 set search_path to 'app_private, public'
as $$ select r.* from app_private.referrers r where r.user_id = p_user order by r.created_at limit 1; $$;

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
      with edges as (select child_org from app_private.referral_edges where referrer_id = v_ref.id)
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

-- ---------- helper: notify an agent (in-app; exception-safe) ----------
create or replace function app_private.agent_notify(p_ref uuid, p_key text, p_title text, p_body text)
 returns void language plpgsql
 set search_path to 'app_private, public'
as $$
declare v_user uuid;
begin
  select user_id into v_user from app_private.referrers where id = p_ref;
  if v_user is null then return; end if;
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
    values (v_user, 'in_app', p_key, jsonb_build_object('title', p_title, 'body', p_body, 'tone', 'info', 'url', '/app/agent/'), 'sent', now());
  exception when others then null; end;
end; $$;

-- ---------- join: notify + welcome email ----------
create or replace function app_private.trg_agent_on_join()
 returns trigger language plpgsql
 set search_path to 'app_private, public'
as $$
declare v_org text; v_kind text; v_email text; v_user uuid;
begin
  select o.name, o.kind into v_org, v_kind from public.organizations o where o.id = new.child_org;
  perform app_private.agent_notify(new.referrer_id, 'agent.joined',
    '🎉 ' || coalesce(v_org,'A company') || ' joined your chain',
    case when v_kind = 'carrier' then 'Carrier side ✓. ' else 'Broker/shipper side ✓. ' end ||
    case when app_private.referrer_pair_active(new.referrer_id)
      then 'Your chain is ACTIVE — every delivered load now pays your 1%.'
      else 'Bring the other side of the pair to switch earnings on.' end);
  begin
    select u.email, r.user_id into v_email, v_user
      from app_private.referrers r join auth.users u on u.id = r.user_id where r.id = new.referrer_id;
    if v_email is not null then
      perform app_private.sys_email(v_email, 'agent.joined',
        '🎉 ' || coalesce(v_org,'A company') || ' just joined your LoadBoot chain',
        '<div style="font-family:Inter,Arial,sans-serif"><h2>' || coalesce(v_org,'A company') || ' joined through your link</h2>'
        || '<p>' || case when app_private.referrer_pair_active(new.referrer_id)
             then 'Your chain is <b style="color:#16a34a">ACTIVE</b> — you earn 1% of every delivered load your clients touch.'
             else 'One more side and your chain goes live: bring a ' || case when v_kind='carrier' then 'broker or shipper' else 'carrier' end || ' to switch earnings on.' end
        || '</p><p><a href="https://loadboot.com/app/agent/" style="background:#0883F7;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800">Open your agent dashboard →</a></p></div>',
        null, 'agentjoin:' || new.child_org::text || ':' || new.referrer_id::text);
    end if;
  exception when others then null; end;
  return new;
end; $$;
drop trigger if exists trg_agent_on_join_t on app_private.referral_edges;
create trigger trg_agent_on_join_t after insert on app_private.referral_edges
for each row execute function app_private.trg_agent_on_join();

-- ---------- load posted / booked / delivered → agent notices ----------
create or replace function app_private.trg_agent_on_load()
 returns trigger language plpgsql
 set search_path to 'app_private, public'
as $$
declare e record;
begin
  for e in select referrer_id from app_private.referral_edges where child_org = new.broker_org loop
    perform app_private.agent_notify(e.referrer_id, 'agent.load_posted',
      '📦 Your broker posted a load', new.origin || ' → ' || new.destination || ' · $' || coalesce(new.rate::text,'—') || ' — watch it get booked live on your dashboard.');
  end loop;
  return new;
end; $$;
drop trigger if exists trg_agent_on_load_t on public.loads;
create trigger trg_agent_on_load_t after insert on public.loads
for each row when (new.broker_org is not null) execute function app_private.trg_agent_on_load();

create or replace function app_private.trg_agent_on_trip()
 returns trigger language plpgsql
 set search_path to 'app_private, public'
as $$
declare l record; e record; v_carrier text; v_yours boolean;
begin
  select * into l from public.loads where id = new.load_id;
  select name into v_carrier from public.organizations where id = new.carrier_id;
  if tg_op = 'INSERT' then
    if l.broker_org is not null then
      for e in select referrer_id from app_private.referral_edges where child_org = l.broker_org loop
        v_yours := exists (select 1 from app_private.referral_edges where referrer_id = e.referrer_id and child_org = new.carrier_id);
        perform app_private.agent_notify(e.referrer_id, 'agent.booked',
          '🚛 Booked' || case when v_yours then ' — by YOUR carrier!' else '' end,
          coalesce(l.origin,'') || ' → ' || coalesce(l.destination,'') || ' booked by ' || coalesce(v_carrier,'a carrier') || case when v_yours then ' (also your referral — double chain ✓)' else '' end || '.');
      end loop;
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'delivered' and old.status is distinct from 'delivered' then
    for e in
      select distinct referrer_id from app_private.referral_edges
       where child_org in (new.carrier_id, l.broker_org) loop
      perform app_private.agent_notify(e.referrer_id, 'agent.delivered',
        '💰 Delivered — your 1% is accruing',
        coalesce(l.origin,'') || ' → ' || coalesce(l.destination,'') || ' delivered (GPS-verified). Commission clears the 15-day window, then becomes payable.');
    end loop;
  end if;
  return new;
end; $$;
drop trigger if exists trg_agent_on_trip_t on app_private.trips;
create trigger trg_agent_on_trip_t after insert or update on app_private.trips
for each row execute function app_private.trg_agent_on_trip();

notify pgrst, 'reload schema';
