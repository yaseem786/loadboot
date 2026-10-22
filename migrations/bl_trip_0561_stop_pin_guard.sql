-- bl_trip_0561 (22 Oct 2026) — the carrier map geocoded "Terrell, TX" to Terrell COUNTY (400 mi off) and saved it as the
-- trip's delivery pin; the server then demanded a GPS check-in there and the driver could never mark delivered.
-- cc_trip_set_stop_coords now refuses a pin pair whose straight-line distance disagrees with the trip's own miles.
create or replace function public.cc_trip_set_stop_coords(p_trip uuid, p_plat double precision, p_plng double precision, p_dlat double precision, p_dlng double precision)
returns jsonb language plpgsql security definer
set search_path to 'app_private', 'public'
as $function$
declare t record; v_pl double precision; v_pg double precision; v_dl double precision; v_dg double precision; v_mi double precision;
begin
  if not app_private.can_touch_trip(p_trip) then raise exception 'not authorized' using errcode='42501'; end if;
  select pickup_lat, pickup_lng, delivery_lat, delivery_lng, miles into t from app_private.trips where id = p_trip;
  v_pl := coalesce(t.pickup_lat, p_plat);  v_pg := coalesce(t.pickup_lng, p_plng);
  v_dl := coalesce(t.delivery_lat, p_dlat); v_dg := coalesce(t.delivery_lng, p_dlng);
  if v_pl is not null and v_pg is not null and v_dl is not null and v_dg is not null and coalesce(t.miles, 0) > 0 then
    v_mi := 3958.8 * 2 * asin(sqrt(power(sin(radians(v_dl - v_pl) / 2), 2) + cos(radians(v_pl)) * cos(radians(v_dl)) * power(sin(radians(v_dg - v_pg) / 2), 2)));
    if v_mi > t.miles * 1.6 + 40 then
      return jsonb_build_object('ok', false, 'reason', 'pins_disagree_with_miles', 'straight_line_mi', round(v_mi::numeric, 1), 'trip_miles', t.miles);
    end if;
  end if;
  update app_private.trips set
    pickup_lat = v_pl, pickup_lng = v_pg, delivery_lat = v_dl, delivery_lng = v_dg
  where id = p_trip;
  return jsonb_build_object('ok', true);
end; $function$;
