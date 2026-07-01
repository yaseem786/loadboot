-- cwd_carrier_pnl.sql
-- Increment 55 — CARRIER P&L AND PERFORMANCE DASHBOARDS.
-- Honest-numbers rule: every figure is labeled with its basis — confirmed booked rates vs manually-entered
-- expenses vs measured timestamps. Nothing is presented as audited accounting truth; estimates say ESTIMATE.
--
--   * app_private.carrier_expenses — carrier-entered operating expenses (fuel, tolls, driver pay, …).
--   * cc_carrier_add_expense / cc_carrier_expenses / cc_carrier_delete_expense — carrier self-scoped
--     (delete allowed only on the carrier's own MANUAL entries).
--   * cc_carrier_pnl(from, to, carrier) — the P&L: revenue (confirmed booked rates + billable accessorials),
--     expenses by category, est. profit, per-mile / per-load metrics, on-time % (only from real recorded
--     timestamps), lane + truck breakdowns, 6-month trend. Carrier sees own; staff (dispatch.view) any.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create table if not exists app_private.carrier_expenses (
  id uuid primary key default gen_random_uuid(),
  carrier_id uuid not null,
  trip_id uuid,
  category text not null check (category in ('fuel','tolls','driver_pay','maintenance','repairs','insurance','truck_payment','trailer','permits','factoring_fee','dispatch_fee','misc')),
  amount numeric not null check (amount > 0),
  incurred_on date not null default current_date,
  note text,
  source text not null default 'manual' check (source in ('manual','system')),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists carrier_expenses_carrier_idx on app_private.carrier_expenses(carrier_id, incurred_on);

create or replace function public.cc_carrier_add_expense(p jsonb)
returns uuid language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_id uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  insert into app_private.carrier_expenses(carrier_id, trip_id, category, amount, incurred_on, note, created_by)
    values (v_org, nullif(p->>'trip_id','')::uuid, p->>'category', (p->>'amount')::numeric,
            coalesce(nullif(p->>'incurred_on','')::date, current_date), p->>'note', auth.uid())
    returning id into v_id;
  perform app_private.log_audit('carrier.expense.add','carrier',v_org::text,null,
    format('%s $%s', p->>'category', p->>'amount'), p);
  return v_id;
end; $$;
revoke execute on function public.cc_carrier_add_expense(jsonb) from anon, public;
grant  execute on function public.cc_carrier_add_expense(jsonb) to authenticated;

create or replace function public.cc_carrier_expenses(p_from date default null, p_to date default null, p_limit integer default 200)
returns table(id uuid, trip_id uuid, category text, amount numeric, incurred_on date, note text, source text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return query select e.id, e.trip_id, e.category, e.amount, e.incurred_on, e.note, e.source, e.created_at
    from app_private.carrier_expenses e
    where e.carrier_id=v_org and (p_from is null or e.incurred_on>=p_from) and (p_to is null or e.incurred_on<=p_to)
    order by e.incurred_on desc, e.created_at desc limit least(greatest(coalesce(p_limit,200),1),1000);
end; $$;
revoke execute on function public.cc_carrier_expenses(date, date, integer) from anon, public;
grant  execute on function public.cc_carrier_expenses(date, date, integer) to authenticated;

create or replace function public.cc_carrier_delete_expense(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; n int;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  delete from app_private.carrier_expenses where id=p_id and carrier_id=v_org and source='manual';
  get diagnostics n = row_count;
  if n=0 then raise exception 'expense not found (only your own manual entries can be deleted)' using errcode='22023'; end if;
  perform app_private.log_audit('carrier.expense.delete','carrier',v_org::text,null,null,jsonb_build_object('id',p_id));
  return jsonb_build_object('ok',true);
end; $$;
revoke execute on function public.cc_carrier_delete_expense(uuid) from anon, public;
grant  execute on function public.cc_carrier_delete_expense(uuid) to authenticated;

-- THE P&L. Carrier self, or staff (dispatch.view) for any carrier.
create or replace function public.cc_carrier_pnl(p_from date default null, p_to date default null, p_carrier uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_my uuid; v_org uuid; v_from date; v_to date;
  v_linehaul numeric; v_acc numeric; v_acc_draft numeric; v_miles numeric; v_trips int; v_cancelled int;
  v_ot_ontime int; v_ot_total int; v_exp jsonb; v_exp_total numeric;
  v_lanes jsonb; v_trucks jsonb; v_trend jsonb; v_rev numeric; v_profit numeric;
begin
  v_my := app_private.my_carrier_org();
  if v_my is not null then v_org := v_my;
  elsif public.has_global_permission('dispatch.view') then
    v_org := p_carrier;
    if v_org is null then raise exception 'p_carrier required for staff' using errcode='22023'; end if;
  else raise exception 'not authorized' using errcode='42501'; end if;
  v_from := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to   := coalesce(p_to, current_date);

  select coalesce(sum(t.rate),0), coalesce(sum(t.miles),0), count(*),
         count(*) filter (where t.delivered_at is not null and t.scheduled_delivery is not null and t.delivered_at <= t.scheduled_delivery),
         count(*) filter (where t.delivered_at is not null and t.scheduled_delivery is not null)
    into v_linehaul, v_miles, v_trips, v_ot_ontime, v_ot_total
    from app_private.trips t
    where t.carrier_id=v_org and t.status in ('delivered','invoiced')
      and t.delivered_at::date between v_from and v_to;
  select count(*) into v_cancelled from app_private.trips t
    where t.carrier_id=v_org and t.status='cancelled' and t.updated_at::date between v_from and v_to;
  select coalesce(sum(a.amount) filter (where a.billable),0), coalesce(sum(a.amount) filter (where not a.billable),0)
    into v_acc, v_acc_draft
    from app_private.trip_accessorials a join app_private.trips t on t.id=a.trip_id
    where t.carrier_id=v_org and a.created_at::date between v_from and v_to;

  select coalesce(jsonb_object_agg(category, total), '{}'::jsonb), coalesce(sum(total),0)
    into v_exp, v_exp_total
    from (select category, sum(amount) total from app_private.carrier_expenses
          where carrier_id=v_org and incurred_on between v_from and v_to group by category) q;

  select coalesce(jsonb_agg(jsonb_build_object('lane', lane, 'trips', n, 'revenue', rev) order by rev desc), '[]'::jsonb)
    into v_lanes
    from (select coalesce(l.origin,'?')||' → '||coalesce(l.destination,'?') lane, count(*) n, sum(t.rate) rev
          from app_private.trips t left join public.loads l on l.id=t.load_id
          where t.carrier_id=v_org and t.status in ('delivered','invoiced') and t.delivered_at::date between v_from and v_to
          group by 1 order by sum(t.rate) desc nulls last limit 5) q;

  select coalesce(jsonb_agg(jsonb_build_object('truck', truck, 'trips', n, 'revenue', rev) order by rev desc), '[]'::jsonb)
    into v_trucks
    from (select coalesce(t.truck_no,'unassigned') truck, count(*) n, sum(t.rate) rev
          from app_private.trips t
          where t.carrier_id=v_org and t.status in ('delivered','invoiced') and t.delivered_at::date between v_from and v_to
          group by 1 order by sum(t.rate) desc nulls last limit 5) q;

  select coalesce(jsonb_agg(jsonb_build_object('month', m, 'trips', n, 'revenue', rev) order by m), '[]'::jsonb)
    into v_trend
    from (select to_char(date_trunc('month', t.delivered_at),'YYYY-MM') m, count(*) n, coalesce(sum(t.rate),0) rev
          from app_private.trips t
          where t.carrier_id=v_org and t.status in ('delivered','invoiced')
            and t.delivered_at >= date_trunc('month', current_date) - interval '5 months'
          group by 1) q;

  v_rev := v_linehaul + v_acc;
  v_profit := v_rev - v_exp_total;
  return jsonb_build_object(
    'carrier', v_org, 'from', v_from, 'to', v_to,
    'revenue', jsonb_build_object(
      'linehaul', v_linehaul, 'accessorials_billable', v_acc, 'total', v_rev,
      'accessorials_draft_excluded', v_acc_draft,
      'basis', 'confirmed booked trip rates + billable accessorials; drafts excluded'),
    'expenses', jsonb_build_object('by_category', v_exp, 'total', v_exp_total,
      'basis', 'manually entered by the carrier — not audited accounting'),
    'metrics', jsonb_build_object(
      'delivered_trips', v_trips, 'cancelled_trips', v_cancelled, 'total_miles', v_miles,
      'loaded_rpm', case when v_miles>0 then round(v_linehaul/v_miles,2) end,
      'est_profit', v_profit,
      'profit_per_load', case when v_trips>0 then round(v_profit/v_trips,0) end,
      'profit_per_mile', case when v_miles>0 then round(v_profit/v_miles,2) end,
      'on_time_pct', case when v_ot_total>0 then round(100.0*v_ot_ontime/v_ot_total,0) end,
      'on_time_basis', v_ot_total||' of '||v_trips||' delivered trips have both scheduled + actual delivery timestamps',
      'note', 'est_profit is an ESTIMATE: confirmed revenue minus manually-entered expenses'),
    'by_lane', v_lanes, 'by_truck', v_trucks, 'monthly_trend', v_trend);
end; $$;
revoke execute on function public.cc_carrier_pnl(date, date, uuid) from anon, public;
grant  execute on function public.cc_carrier_pnl(date, date, uuid) to authenticated;
