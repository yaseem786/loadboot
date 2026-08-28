-- bl_disp_0292 — carrier side: my dispatcher + my trucks' availability in one read, so the carrier
-- can keep "empty at / home by / driver / HOS" current from his own dashboard card (writes go through
-- dispatcher_set_availability, which already accepts carrier members). Applied on STAGING 28 Aug.
create or replace function public.carrier_my_dispatcher()
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select coalesce((select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'carrier_org_id', a.carrier_org_id, 'assigned_at', a.assigned_at,
      'dispatcher', jsonb_build_object('name', dp.full_name, 'phone', dp.phone, 'country', dp.country, 'status', dp.status),
      'trucks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'unit_no', t.unit_no, 'equipment', t.equipment,
                    'availability', (select to_jsonb(av) - 'truck_id' - 'carrier_id' from app_private.truck_availability av where av.truck_id = t.id)) order by t.unit_no)
                  from app_private.fleet_trucks t where t.carrier_id = a.carrier_org_id and coalesce(t.status,'active') <> 'retired'), '[]'::jsonb)))
    from app_private.dispatcher_assignments a join app_private.dispatcher_profiles dp on dp.user_id = a.dispatcher_user_id
    where a.status = 'active' and app_private.disp_is_carrier_member(a.carrier_org_id)), '[]'::jsonb);
$$;
revoke all on function public.carrier_my_dispatcher() from public, anon;
grant execute on function public.carrier_my_dispatcher() to authenticated;
