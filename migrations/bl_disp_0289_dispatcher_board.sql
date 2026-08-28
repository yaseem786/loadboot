-- bl_disp_0289 — Dispatcher Workspace P1: internal load board, truck posting, book requests, KPIs.
-- Mechanism: the carrier engines (cc_carrier_best_loads, cc_pocket_available_loads, cc_post_truck,
-- cc_request_book_load, …) all resolve the caller's carrier through app_private.my_carrier_org().
-- We teach my_carrier_org() ONE extra source: a transaction-local setting `app.dispatch_as`, honoured
-- only when the caller holds an ACTIVE dispatcher assignment for that org. Only the dispatcher_*
-- wrappers below ever set it, so nothing changes for carriers, staff or anon.
-- Additive. Apply to STAGING first, then PROD. Re-check anon grants after (same signature → ACL kept).

create or replace function app_private.my_carrier_org()
returns uuid language sql stable security definer set search_path = app_private, public as $$
  select coalesce(
    (select om.org_id
       from public.organization_memberships om
       join public.organizations o on o.id = om.org_id
      where om.user_id = auth.uid() and om.status = 'active' and o.kind = 'carrier'
      order by om.created_at limit 1),
    (select a.carrier_org_id
       from app_private.dispatcher_assignments a
      where a.dispatcher_user_id = auth.uid() and a.status = 'active'
        and a.carrier_org_id::text = nullif(current_setting('app.dispatch_as', true), '')
      limit 1));
$$;

-- guard + context switch used by every wrapper
create or replace function app_private.disp_act_as(p_org uuid)
returns void language plpgsql security definer set search_path = app_private, public as $$
begin
  if p_org is null or not app_private.disp_is_assigned(p_org) then
    raise exception 'you are not assigned to this carrier' using errcode = '42501';
  end if;
  perform set_config('app.dispatch_as', p_org::text, true);
end $$;

-- ---------------------------------------------------------------- board
create or replace function public.dispatcher_board(p_org uuid, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_best jsonb; v_avail jsonb; v_req jsonb; v_post jsonb;
begin
  begin perform app_private.disp_act_as(p_org); exception when others then return jsonb_build_object('error', sqlerrm); end;
  begin v_best := public.cc_carrier_best_loads(null, p_limit); exception when others then v_best := jsonb_build_object('error', sqlerrm); end;
  begin
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_avail from public.cc_pocket_available_loads(least(coalesce(p_limit,20), 50)) x;
  exception when others then v_avail := jsonb_build_object('error', sqlerrm); end;
  begin v_req := public.cc_my_book_requests(50); exception when others then v_req := '[]'::jsonb; end;
  begin v_post := public.cc_my_truck_postings(); exception when others then v_post := '[]'::jsonb; end;
  return jsonb_build_object('best', v_best, 'available', v_avail, 'requests', v_req, 'postings', v_post);
end $$;

create or replace function public.dispatcher_load_detail(p_org uuid, p_load uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v jsonb;
begin
  begin perform app_private.disp_act_as(p_org); exception when others then return jsonb_build_object('error', sqlerrm); end;
  begin v := public.cc_load_detail(p_load); exception when others then return jsonb_build_object('error', sqlerrm); end;
  return v;
end $$;

-- request to book an internal load, on the carrier's behalf. The carrier engine's own gates
-- (prefs complete, compliance ok, hazmat, pickup passed, duplicate) all still apply.
create or replace function public.dispatcher_request_book(p_org uuid, p_load uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v jsonb; v_uid uuid := auth.uid();
begin
  begin perform app_private.disp_act_as(p_org); exception when others then return jsonb_build_object('error', sqlerrm); end;
  begin
    v := public.cc_request_book_load(p_load, coalesce(p_note, '') || ' [requested by dispatcher]');
  exception when others then return jsonb_build_object('error', sqlerrm); end;
  begin perform app_private.log_audit('dispatcher.book_request', 'load', p_load::text, p_org, 'dispatcher requested load for carrier', jsonb_build_object('dispatcher', v_uid, 'result', v)); exception when others then null; end;
  return v;
end $$;

-- ---------------------------------------------------------------- truck posting on the carrier's behalf
create or replace function public.dispatcher_post_truck(p_org uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v jsonb; v_p jsonb; v_av record;
begin
  begin perform app_private.disp_act_as(p_org); exception when others then return jsonb_build_object('error', sqlerrm); end;
  -- dispatcher postings never auto-request: a human confirms every load
  v_p := coalesce(p, '{}'::jsonb) || jsonb_build_object('auto_request', false);
  if coalesce(v_p->>'origin','') = '' and nullif(v_p->>'truck_id','') is not null then
    select * into v_av from app_private.truck_availability where truck_id = (v_p->>'truck_id')::uuid;
    if v_av.empty_location is not null then v_p := v_p || jsonb_build_object('origin', v_av.empty_location); end if;
  end if;
  begin v := public.cc_post_truck(v_p); exception when others then return jsonb_build_object('error', sqlerrm); end;
  return v;
end $$;

create or replace function public.dispatcher_update_posting(p_org uuid, p_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v jsonb;
begin
  begin perform app_private.disp_act_as(p_org); exception when others then return jsonb_build_object('error', sqlerrm); end;
  begin v := public.cc_update_truck_posting(p_id, p_action); exception when others then return jsonb_build_object('error', sqlerrm); end;
  return v;
end $$;

create or replace function public.dispatcher_posting_matches(p_org uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v jsonb;
begin
  begin perform app_private.disp_act_as(p_org); exception when others then return jsonb_build_object('error', sqlerrm); end;
  begin v := public.cc_truck_posting_matches(p_id); exception when others then return jsonb_build_object('error', sqlerrm); end;
  return v;
end $$;

-- ---------------------------------------------------------------- computed KPIs (no hand-typed numbers)
create or replace function app_private.disp_kpis(p_user uuid, p_days int default 30)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  with b as (
    select * from app_private.dispatcher_bookings
     where dispatcher_user_id = p_user and created_at > now() - make_interval(days => p_days)
  ), moving as (
    select b.id, b.status, b.updated_at,
           (select count(*) from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind = 'check_call') as calls,
           (select max(e.created_at) from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind in ('check_call','status')) as last_touch,
           (select min(e.created_at) from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind = 'status' and e.note like 'dispatched%') as dispatched_at,
           (select min(e.created_at) from app_private.dispatcher_booking_events e where e.booking_id = b.id and e.kind = 'status' and e.note like 'delivered%') as delivered_at,
           b.delivery_at
      from b
  )
  select jsonb_build_object(
    'days', p_days,
    'bookings', (select count(*) from b),
    'delivered', (select count(*) from b where status in ('delivered','invoiced','paid')),
    'cancelled', (select count(*) from b where status in ('cancelled','rejected')),
    'gross', coalesce((select sum(gross) from b where status not in ('cancelled','rejected')), 0),
    'avg_rpm', (select round(avg(gross / miles)::numeric, 2) from b where miles > 0 and status not in ('cancelled','rejected')),
    'below_min_share', (select round(100.0 * count(*) filter (where below_min) / nullif(count(*),0)) from b),
    'on_time_pct', (select round(100.0 * count(*) filter (where delivered_at <= delivery_at) / nullif(count(*) filter (where delivered_at is not null and delivery_at is not null),0)) from moving),
    'check_calls_per_load', (select round(avg(calls)::numeric, 1) from moving where dispatched_at is not null),
    'rc_attach_rate', (select round(100.0 * count(*) filter (where rc_doc_path is not null) / nullif(count(*),0)) from b),
    'brokers_used', (select count(distinct lower(broker)) from b),
    'loads_per_week', (select round(count(*)::numeric / greatest(p_days / 7.0, 1), 1) from b where status not in ('cancelled','rejected'))
  );
$$;

create or replace function public.cc_dispatcher_kpis(p_user uuid, p_days int default 30)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else app_private.disp_kpis(p_user, p_days) end;
$$;

create or replace function public.dispatcher_my_kpis(p_days int default 30)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when auth.uid() is null then jsonb_build_object('error','not signed in') else app_private.disp_kpis(auth.uid(), p_days) end;
$$;

-- ---------------------------------------------------------------- grants
revoke all on function public.dispatcher_board(uuid, int) from public, anon;
revoke all on function public.dispatcher_load_detail(uuid, uuid) from public, anon;
revoke all on function public.dispatcher_request_book(uuid, uuid, text) from public, anon;
revoke all on function public.dispatcher_post_truck(uuid, jsonb) from public, anon;
revoke all on function public.dispatcher_update_posting(uuid, uuid, text) from public, anon;
revoke all on function public.dispatcher_posting_matches(uuid, uuid) from public, anon;
revoke all on function public.cc_dispatcher_kpis(uuid, int) from public, anon;
revoke all on function public.dispatcher_my_kpis(int) from public, anon;
revoke all on function app_private.disp_act_as(uuid) from public, anon, authenticated;
revoke all on function app_private.disp_kpis(uuid, int) from public, anon, authenticated;
grant execute on function public.dispatcher_board(uuid, int), public.dispatcher_load_detail(uuid, uuid), public.dispatcher_request_book(uuid, uuid, text),
  public.dispatcher_post_truck(uuid, jsonb), public.dispatcher_update_posting(uuid, uuid, text), public.dispatcher_posting_matches(uuid, uuid),
  public.cc_dispatcher_kpis(uuid, int), public.dispatcher_my_kpis(int) to authenticated;
