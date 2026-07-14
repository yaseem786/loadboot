-- bl_stops_0090 — BOARD REDACTION for multi-stop + agent loads.
-- cc_pocket_available_loads previously returned loads.details verbatim: browsing carriers could
-- see extra-stop street addresses, GPS pins, zips, doc numbers AND the agent's LOAD SOURCE
-- before booking. Now: details minus 'load_source'; stops reduced to {seq, city, state, kind, purpose}
-- (enough for the board's "+N STOPS" chip). Full route still unlocks after booking via cc_load_stops.
-- Applied to staging 2026-07-14 (verified: leak fields absent). Replay on PROD.

create or replace function public.cc_pocket_available_loads(p_limit integer default 24)
 returns table(id uuid, origin text, destination text, equipment text, miles integer, rate numeric, rpm numeric, pickup_date date, delivery_date date, commodity text, weight text, deadhead integer, requirements text, broker text, pickup_lat double precision, pickup_lng double precision, hazmat boolean, details jsonb, accessorials jsonb, direct_to_you boolean, direct_offer_expired boolean)
 language plpgsql stable security definer
 set search_path to 'app_private, public'
as $function$
declare v_me uuid;
begin
  v_me := app_private.my_carrier_org();
  if v_me is null and not public.is_active_staff() then
    raise exception 'not authorized: carrier session required' using errcode='42501';
  end if;
  return query
    select l.id, l.origin, l.destination, l.equipment, l.miles, l.rate,
      case when l.miles>0 then round(l.rate/l.miles,2) else null end,
      l.pickup_date, l.delivery_date, l.commodity, l.weight, l.deadhead, l.requirements, l.broker,
      round(l.pickup_lat::numeric,1)::double precision, round(l.pickup_lng::numeric,1)::double precision,
      coalesce(l.hazmat,false),
      (coalesce(l.details,'{}'::jsonb) - 'load_source')
        || case when coalesce(l.details,'{}'::jsonb) ? 'stops' then jsonb_build_object('stops',
             coalesce((select jsonb_agg(jsonb_build_object(
                 'seq', s->>'seq', 'city', s->>'city', 'state', s->>'state',
                 'kind', s->>'kind', 'purpose', s->>'purpose')
               order by (s->>'seq')::int nulls last)
               from jsonb_array_elements(l.details->'stops') s), '[]'::jsonb))
           else '{}'::jsonb end,
      coalesce(l.accessorials,'{}'::jsonb),
      (coalesce(l.details,'{}'::jsonb) ? 'direct_carrier_id' and (l.details->>'direct_carrier_id')::uuid = v_me),
      exists (select 1 from app_private.load_offers oe
               where oe.load_id = l.id and oe.carrier_id = v_me
                 and oe.status in ('sent','viewed','expired') and oe.expiry_at <= now())
    from public.loads l
    where l.status='available'
      and (l.pickup_date is null or l.pickup_date >= current_date)
      and (not (coalesce(l.details,'{}'::jsonb) ? 'direct_carrier_id')
           or (l.details->>'direct_carrier_id')::uuid = v_me
           or public.is_active_staff())
      and not exists (select 1 from app_private.load_offers o
                       where o.load_id = l.id and o.carrier_id = v_me
                         and o.status in ('sent','viewed') and o.expiry_at > now())
    order by ((coalesce(l.details,'{}'::jsonb) ? 'direct_carrier_id') and (l.details->>'direct_carrier_id')::uuid = v_me) desc,
             l.created_at desc
    limit greatest(1, least(coalesce(p_limit,24),50));
end; $function$;

notify pgrst, 'reload schema';
