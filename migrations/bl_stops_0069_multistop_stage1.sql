-- bl_stops_0069 — MULTI-STOP Stage 1: extra-stop ADDRESSES ride the existing pipes.
-- Posting UI puts stops into payload.stops (partner_loads.stops column already exists)
-- AND payload.details.stops — cc_decide_partner_load copies details wholesale into
-- public.loads, so loads.details->'stops' arrives with ZERO changes to that engine.
-- This migration adds the READ gate: full addresses only for staff / the posting broker /
-- the booked carrier; browsing carriers see City, ST + count (same privacy rule as
-- origin_full). Stage 2 (trip-map geofences per stop) builds on this.

create or replace function public.cc_load_stops(p_load uuid)
 returns jsonb language plpgsql stable security definer
 set search_path to 'app_private, public'
as $$
declare l record; v_stops jsonb; v_full boolean := false;
begin
  select * into l from public.loads where id = p_load;
  if l is null then raise exception 'load not found' using errcode='22023'; end if;
  if auth.uid() is null then raise exception 'not authorized' using errcode='42501'; end if;
  v_stops := coalesce(l.details->'stops', '[]'::jsonb);
  if jsonb_typeof(v_stops) is distinct from 'array' then v_stops := '[]'::jsonb; end if;
  if public.has_global_permission('dispatch.manage') then v_full := true;
  elsif l.broker_org is not null and app_private.my_partner_org() = l.broker_org then v_full := true;
  elsif exists (select 1 from app_private.trips t where t.load_id = p_load
                  and t.carrier_id = app_private.my_carrier_org()
                  and t.status not in ('cancelled')) then v_full := true;
  end if;
  if v_full then
    return jsonb_build_object('count', jsonb_array_length(v_stops), 'full', true, 'stops', v_stops);
  end if;
  return jsonb_build_object('count', jsonb_array_length(v_stops), 'full', false,
    'stops', coalesce((select jsonb_agg(jsonb_build_object('seq', s->>'seq', 'city', s->>'city', 'state', s->>'state'))
                         from jsonb_array_elements(v_stops) s), '[]'::jsonb));
end; $$;
revoke all on function public.cc_load_stops(uuid) from public;
grant execute on function public.cc_load_stops(uuid) to authenticated;

notify pgrst, 'reload schema';
