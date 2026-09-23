-- bl_agent_0406 — CC can read the same per-referral activity a partner sees (22 Sep 2026).
-- The 0403 query moves into app_private.referral_activity_for(referrer_id) — one engine, two doors:
--   public.agent_referral_activity(p_limit)            the partner, own row only (unchanged contract)
--   public.cc_agent_referral_activity(p_user, p_limit) staff (app_private.disp_is_staff()) for the CC 360
-- Additive; no data changes; anon surface unchanged.

create or replace function app_private.referral_activity_for(p_ref uuid, p_limit int default 40)
returns jsonb
language plpgsql
stable security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_ref uuid := p_ref;
  v_out jsonb;
begin
  if v_ref is null then return '[]'::jsonb; end if;
  with mine as (
    select e.child_org, e.created_at as joined_at
      from app_private.referral_edges e where e.referrer_id = v_ref
  ),
  org_loads as (
    select l.id, l.broker_org as org, l.origin, l.destination, l.created_at
      from public.loads l join mine m on m.child_org = l.broker_org
    union all
    select l.id, l.shipper_org, l.origin, l.destination, l.created_at
      from public.loads l join mine m on m.child_org = l.shipper_org
     where l.shipper_org is distinct from l.broker_org
  ),
  org_trips as (
    select t.*, m.child_org as org, l.origin, l.destination
      from app_private.trips t join mine m on m.child_org = t.carrier_id
      left join public.loads l on l.id = t.load_id
    union all
    select t.*, ol.org, ol.origin, ol.destination
      from app_private.trips t join org_loads ol on ol.id = t.load_id
     where t.carrier_id is distinct from ol.org
  ),
  ev as (
    -- 1 · joined
    select child_org as org, joined_at as at, 'joined' as kind, 'Joined LoadBoot through your link' as title, null::numeric as amount from mine
    -- 2 · carrier verification packet
    union all select co.carrier_id, co.submitted_at, 'packet', 'Submitted their verification packet', null
      from app_private.carrier_onboarding co join mine m on m.child_org = co.carrier_id where co.submitted_at is not null
    union all select co.carrier_id, co.decided_at,
      case when co.stage = 'approved' then 'verified' else 'packet_issue' end,
      case when co.stage = 'approved' then 'Verified — cleared to book loads' when co.stage = 'rejected' then 'Verification needs fixes' else 'Verification under review' end, null
      from app_private.carrier_onboarding co join mine m on m.child_org = co.carrier_id where co.decided_at is not null
    -- 3 · documents (type only, never the file)
    union all select d.carrier_id, d.created_at, 'doc', 'Uploaded ' || replace(coalesce(d.type, 'a document'), '_', ' '), null
      from public.documents d join mine m on m.child_org = d.carrier_id
    union all select d.carrier_id, d.reviewed_at, 'doc_' || d.status,
      replace(coalesce(d.type, 'Document'), '_', ' ') || case when d.status = 'approved' then ' approved' else ' needs a re-upload' end, null
      from public.documents d join mine m on m.child_org = d.carrier_id where d.reviewed_at is not null and d.status in ('approved', 'rejected')
    -- 4 · fleet
    union all select f.carrier_id, f.created_at, 'truck', 'Added a truck' || case when f.equipment is not null then ' — ' || f.equipment else '' end, null
      from app_private.fleet_trucks f join mine m on m.child_org = f.carrier_id
    -- 5 · loads posted (brokers / shippers)
    union all select ol.org, ol.created_at, 'posted', 'Posted a load — ' || coalesce(ol.origin, '?') || ' → ' || coalesce(ol.destination, '?'), null from org_loads ol
    -- 6 · trips
    union all select org, created_at, 'booked', 'Booked — ' || coalesce(origin, '?') || ' → ' || coalesce(destination, '?'), null from org_trips
    union all select org, coalesce(started_at, dispatched_at), 'transit', 'In transit — ' || coalesce(origin, '?') || ' → ' || coalesce(destination, '?'), null
      from org_trips where coalesce(started_at, dispatched_at) is not null
    union all select org, delivered_at, 'delivered', 'Delivered — ' || coalesce(origin, '?') || ' → ' || coalesce(destination, '?'), null
      from org_trips where delivered_at is not null
    union all select org, cancel_at, 'cancelled', 'Load cancelled — ' || coalesce(origin, '?') || ' → ' || coalesce(destination, '?'), null
      from org_trips where cancel_at is not null
    -- 7 · the partner's own money from this referral
    union all select rc.source_org, rc.accrued_at, 'credited', '1% credited — clears ' || to_char(rc.payable_at, 'Mon DD'), rc.amount
      from app_private.referral_commissions rc where rc.referrer_id = v_ref and rc.status <> 'void'
    union all select rc.source_org, rc.payable_at, 'payable', 'Cleared — now payable', rc.amount
      from app_private.referral_commissions rc where rc.referrer_id = v_ref and rc.status in ('payable', 'paid') and rc.payable_at <= now()
    union all select rc.source_org, rc.paid_at, 'paid', 'Paid out to you', rc.amount
      from app_private.referral_commissions rc where rc.referrer_id = v_ref and rc.paid_at is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'org_id', o.id, 'org', o.name, 'side', o.kind, 'joined_at', m.joined_at,
           'events', coalesce((
              select jsonb_agg(jsonb_build_object('at', x.at, 'kind', x.kind, 'title', x.title, 'amount', x.amount) order by x.at desc)
                from (select * from ev where ev.org = o.id and ev.at is not null order by ev.at desc limit greatest(1, least(p_limit, 200))) x
           ), '[]'::jsonb)
         ) order by m.joined_at desc), '[]'::jsonb)
    into v_out
    from mine m join public.organizations o on o.id = m.child_org;
  return v_out;
end $$;
revoke all on function app_private.referral_activity_for(uuid, int) from public, anon, authenticated;

create or replace function public.agent_referral_activity(p_limit int default 40)
returns jsonb
language plpgsql
stable security definer
set search_path = public, app_private, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_ref uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select r.id into v_ref from app_private.referrers r where r.user_id = v_uid limit 1;
  return app_private.referral_activity_for(v_ref, p_limit);
end $$;
revoke all on function public.agent_referral_activity(int) from public, anon;
grant execute on function public.agent_referral_activity(int) to authenticated;

create or replace function public.cc_agent_referral_activity(p_user uuid, p_limit int default 60)
returns jsonb
language plpgsql
stable security definer
set search_path = public, app_private, pg_temp
as $$
declare v_ref uuid;
begin
  if not app_private.disp_is_staff() then raise exception 'not authorized' using errcode = '42501'; end if;
  select r.id into v_ref from app_private.referrers r where r.user_id = p_user limit 1;
  return app_private.referral_activity_for(v_ref, p_limit);
end $$;
revoke all on function public.cc_agent_referral_activity(uuid, int) from public, anon;
grant execute on function public.cc_agent_referral_activity(uuid, int) to authenticated;
