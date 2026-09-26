-- bl_disp_0459c — dispatcher_carrier_gaps v2 (26 Sep 2026, Yaseen's review of 0459b):
--   • no WhatsApp-group wording anywhere (LoadBoot runs Meta/Telnyx WhatsApp on its own line; the group era is over)
--   • every driver with a phone (not just the first) so the sheet can offer call + copy for owner and driver separately
--   • the carrier's / driver's OWN availability post (app_private.truck_postings — what "Post availability" in the carrier
--     portal writes) per truck, with who posted it and when it was last confirmed, so the dispatcher never asks for
--     what is already posted; track A/B now counts an active post too
--   • the static call script is dropped from the payload (the guides live in the section headers on the page)
create or replace function public.dispatcher_carrier_gaps(p_assignment uuid) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); a app_private.dispatcher_assignments; v_owner uuid; v_name text; v_prof jsonb; v_prefs jsonb;
        v_fields jsonb := '[]'::jsonb; f record; t record; v_val jsonb; s record; v_track text; v_disp text;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null or a.dispatcher_user_id <> v_uid or a.status <> 'active' or not app_private.disp_is_assigned(a.carrier_org_id) then
    return jsonb_build_object('error','not your active assignment');
  end if;
  select o.owner_user_id, o.name into v_owner, v_name from public.organizations o where o.id = a.carrier_org_id;
  select to_jsonb(p) into v_prof from public.profiles p where p.id = v_owner;
  select to_jsonb(pf) into v_prefs from app_private.carrier_dispatch_prefs pf where pf.carrier_id = a.carrier_org_id;
  select full_name into v_disp from app_private.dispatcher_profiles where user_id = v_uid;

  for f in select * from app_private.carrier_fill_fields order by sort loop
    if f.tbl = 'truck' then
      for t in select id, unit_no, to_jsonb(x) j from app_private.fleet_trucks x where x.carrier_id = a.carrier_org_id and coalesce(x.status,'active') not in ('inactive','retired') order by unit_no loop
        v_val := t.j -> f.field;
        select set_by_role, set_by, set_at into s from app_private.carrier_field_sources where carrier_org_id = a.carrier_org_id and tbl = 'truck' and field = f.field and truck_id = t.id;
        v_fields := v_fields || jsonb_build_object('tbl', f.tbl, 'field', f.field, 'label', f.label, 'why', f.why, 'kind', f.kind, 'options', f.options, 'core', f.core,
          'truck_id', t.id, 'unit_no', t.unit_no, 'value', v_val, 'empty', app_private.cfs_is_empty(v_val),
          'locked', (not app_private.cfs_is_empty(v_val)) and not coalesce(s.set_by_role = 'dispatcher' and s.set_by = v_uid, false),
          'source', case when s.set_by_role is null then null else jsonb_build_object('role', s.set_by_role, 'by', s.set_by, 'by_name', app_private.cfs_name_of(s.set_by), 'at', s.set_at) end);
      end loop;
    else
      v_val := case when f.tbl = 'profile' then v_prof -> f.field else v_prefs -> f.field end;
      select set_by_role, set_by, set_at into s from app_private.carrier_field_sources where carrier_org_id = a.carrier_org_id and tbl = f.tbl and field = f.field and truck_id is null;
      v_fields := v_fields || jsonb_build_object('tbl', f.tbl, 'field', f.field, 'label', f.label, 'why', f.why, 'kind', f.kind, 'options', f.options, 'core', f.core,
        'truck_id', null, 'unit_no', null, 'value', v_val, 'empty', app_private.cfs_is_empty(v_val),
        'locked', (not app_private.cfs_is_empty(v_val)) and not coalesce(s.set_by_role = 'dispatcher' and s.set_by = v_uid, false),
        'source', case when s.set_by_role is null then null else jsonb_build_object('role', s.set_by_role, 'by', s.set_by, 'by_name', app_private.cfs_name_of(s.set_by), 'at', s.set_at) end);
    end if;
  end loop;

  -- Track A = the carrier is active (a live post, or a daily line touched in the last 7 days); Track B = nothing → call first
  v_track := case when exists (select 1 from app_private.truck_availability av where av.carrier_id = a.carrier_org_id and av.updated_at > now() - interval '7 days')
                    or exists (select 1 from app_private.truck_postings tp where tp.carrier_id = a.carrier_org_id and tp.status = 'active' and coalesce(tp.available_to, current_date) >= current_date)
             then 'A' else 'B' end;

  return jsonb_build_object(
    'assignment_id', a.id, 'carrier_org_id', a.carrier_org_id, 'carrier_name', v_name, 'dispatcher_name', v_disp,
    'phone', nullif(v_prof ->> 'phone', ''), 'whatsapp', nullif(v_prof ->> 'whatsapp', ''), 'contact_name', nullif(v_prof ->> 'contact_name', ''),
    'drivers', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'phone', d.phone) order by d.name) from app_private.fleet_drivers d
                  where d.carrier_id = a.carrier_org_id and coalesce(d.status,'active') <> 'inactive' and nullif(d.phone,'') is not null), '[]'::jsonb),
    -- what the carrier / driver posted themselves (carrier portal → Post availability). One row per truck (newest live post), plus org-level posts with no truck.
    'postings', coalesce((select jsonb_agg(jsonb_build_object(
          'id', tp.id, 'truck_id', tp.truck_id, 'origin', coalesce(nullif(tp.origin,''), concat_ws(', ', tp.origin_city, tp.origin_state)), 'origin_zip', tp.origin_zip,
          'dest_pref', tp.dest_pref, 'equipment', tp.equipment, 'min_rpm', tp.min_rpm, 'radius_miles', tp.radius_miles,
          'available_from', tp.available_from, 'available_to', tp.available_to, 'notes', tp.notes, 'hos_drive_left_h', tp.hos_drive_left_h,
          'status', tp.status, 'created_at', tp.created_at, 'last_confirmed_at', tp.last_confirmed_at,
          'live', tp.status = 'active' and coalesce(tp.available_to, current_date) >= current_date and coalesce(tp.last_confirmed_at, tp.created_at) > now() - interval '24 hours',
          'posted_by_role', case when tp.created_by = v_owner then 'carrier'
                                 when exists (select 1 from app_private.fleet_drivers d2 where d2.user_id = tp.created_by and d2.carrier_id = a.carrier_org_id) then 'driver'
                                 when tp.created_by = v_uid or exists (select 1 from app_private.dispatcher_profiles dp where dp.user_id = tp.created_by) then 'dispatcher'
                                 when app_private.disp_is_staff_user(tp.created_by) then 'staff' else 'carrier' end,
          'posted_by_name', app_private.cfs_name_of(tp.created_by)) order by tp.created_at desc)
        from (select distinct on (coalesce(truck_id, '00000000-0000-0000-0000-000000000000'::uuid)) * from app_private.truck_postings
               where carrier_id = a.carrier_org_id and status in ('active','paused') and coalesce(available_to, current_date) >= current_date - 1
               order by coalesce(truck_id, '00000000-0000-0000-0000-000000000000'::uuid), created_at desc) tp), '[]'::jsonb),
    'assigned_at', a.assigned_at, 'has_trucks', exists (select 1 from app_private.fleet_trucks x where x.carrier_id = a.carrier_org_id and coalesce(x.status,'active') not in ('inactive','retired')),
    'fields', v_fields,
    'total_core', (select count(*) from jsonb_array_elements(v_fields) e where (e->>'core')::boolean),
    'open_core',  (select count(*) from jsonb_array_elements(v_fields) e where (e->>'core')::boolean and (e->>'empty')::boolean),
    'open_all',   (select count(*) from jsonb_array_elements(v_fields) e where (e->>'empty')::boolean),
    'track', v_track);
end $$;
revoke all on function public.dispatcher_carrier_gaps(uuid) from public, anon;
grant execute on function public.dispatcher_carrier_gaps(uuid) to authenticated;
