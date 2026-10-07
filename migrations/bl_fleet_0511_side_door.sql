-- bl_fleet_0511 — vans (Sprinter / cargo van) load from the rear (swing doors) AND a sliding side door.
-- door_type holds one value, so the second door gets its own flag. Additive: new nullable column, and
-- cc_pocket_upsert_truck sets it only when the caller sends it (older clients are untouched).
alter table app_private.fleet_trucks add column if not exists has_side_door boolean;

do $mig$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.cc_pocket_upsert_truck(jsonb)'::regprocedure) into v_def;
  if position('has_side_door' in v_def) > 0 then return; end if;
  v_new := replace(v_def,
    '  if v_id is null then raise exception ''truck not found for your account''',
    '  if v_id is not null and p ? ''has_side_door'' and p->>''has_side_door'' is not null then   -- bl_fleet_0511
    update app_private.fleet_trucks set has_side_door = (p->>''has_side_door'')::boolean where id = v_id;
  end if;
  if v_id is null then raise exception ''truck not found for your account''');
  if v_new = v_def then raise exception 'anchor not found in cc_pocket_upsert_truck'; end if;
  execute v_new;
end $mig$;
