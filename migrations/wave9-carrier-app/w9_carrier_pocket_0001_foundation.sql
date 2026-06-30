-- WAVE 9 — CARRIER POCKET APP foundation.
-- A carrier-facing mobile surface. The defining security property: every pocket RPC resolves
-- the caller's carrier org from auth.uid() via organization_memberships — there is NO carrier-id
-- parameter, so a carrier can only ever see their OWN trips, invoices and compliance. A user
-- who is not an active member of a carrier org gets nothing (error). SECURITY DEFINER + RBAC by
-- construction (self-scoping), audited. Feature-flagged (carrier_pocket_enabled, default OFF).
-- Production-safe additive — reads existing trips/invoices/compliance; no schema changes elsewhere.
-- Applied to STAGING as ledger name w9_carrier_pocket_0001_foundation.
-- DOWN: drop public cc_pocket_* fns + app_private.my_carrier_org() + the flag row.

-- resolve the caller's carrier org (active membership of a kind='carrier' org). null if none.
create or replace function app_private.my_carrier_org()
returns uuid language sql stable security definer set search_path to 'app_private, public' as $function$
  select om.org_id
  from public.organization_memberships om
  join public.organizations o on o.id=om.org_id
  where om.user_id=auth.uid() and om.status='active' and o.kind='carrier'
  order by om.created_at
  limit 1;
$function$;

create or replace function public.cc_pocket_overview()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return jsonb_build_object(
    'carrier', (select name from public.organizations where id=v_org),
    'trips_active',    (select count(*) from app_private.trips where carrier_id=v_org and status in ('planned','dispatched','in_transit')),
    'trips_delivered', (select count(*) from app_private.trips where carrier_id=v_org and status in ('delivered','invoiced')),
    'invoices_due',    (select coalesce(sum(fee),0) from app_private.fin_invoices where carrier_id=v_org and status='sent'),
    'onboarding_stage',(select coalesce(stage,'not_started') from app_private.carrier_onboarding where carrier_id=v_org),
    'compliance_ok',   app_private.carrier_mandatory_ok(v_org));
end; $function$;

create or replace function public.cc_pocket_trips(p_limit int default 50)
returns table (id uuid, origin text, destination text, status text, rate numeric, scheduled_pickup timestamptz, scheduled_delivery timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_org uuid; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return query
    select t.id,l.origin,l.destination,t.status,t.rate,t.scheduled_pickup,t.scheduled_delivery
    from app_private.trips t join public.loads l on l.id=t.load_id
    where t.carrier_id=v_org
    order by t.updated_at desc limit v_limit;
end; $function$;

create or replace function public.cc_pocket_invoices(p_limit int default 50)
returns table (invoice_no text, gross numeric, fee numeric, net numeric, status text, due_at date)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_org uuid; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return query
    select i.invoice_no,i.gross,i.fee,i.net,i.status,i.due_at
    from app_private.fin_invoices i where i.carrier_id=v_org
    order by i.created_at desc limit v_limit;
end; $function$;

create or replace function public.cc_pocket_compliance()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_org uuid; j jsonb;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name',r.name,'mandatory',r.mandatory,
            'status',coalesce(c.status,'missing'),'expiry_date',c.expiry_date) order by r.sort),'[]'::jsonb)
    into j
    from app_private.compliance_requirements r
    left join app_private.carrier_compliance c on c.requirement_key=r.key and c.carrier_id=v_org
    where r.active;
  return jsonb_build_object('carrier',(select name from public.organizations where id=v_org),
    'mandatory_ok',app_private.carrier_mandatory_ok(v_org),'requirements',j);
end; $function$;

-- a carrier can confirm receipt of a dispatched trip (the one carrier-side write; scoped to own trips)
create or replace function public.cc_pocket_confirm_trip(p_trip uuid)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_org uuid; v_status text;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select status into v_status from app_private.trips where id=p_trip and carrier_id=v_org;
  if v_status is null then raise exception 'trip not found' using errcode='22023'; end if;  -- not theirs => invisible
  insert into app_private.trip_events(trip_id,kind,note,created_by)
    values (p_trip,'note','Carrier confirmed receipt of dispatch',auth.uid());
  perform app_private.log_audit('pocket.trip.confirm','trip',p_trip::text,null,'carrier confirmed dispatch', '{}'::jsonb);
  return 'confirmed';
end; $function$;

revoke all on all functions in schema app_private from public, anon, authenticated;
do $$ declare fn text; begin
  for fn in select unnest(array[
    'public.cc_pocket_overview()','public.cc_pocket_trips(int)','public.cc_pocket_invoices(int)',
    'public.cc_pocket_compliance()','public.cc_pocket_confirm_trip(uuid)']) loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

insert into app_private.feature_flags(key,enabled,description,environment,audience)
  values ('carrier_pocket_enabled',false,'Enable the Carrier Pocket App','all','public')
on conflict (key) do nothing;
