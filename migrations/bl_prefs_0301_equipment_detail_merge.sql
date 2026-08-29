-- bl_prefs_0301_equipment_detail_merge
-- 29 Aug 2026
--
-- carrier_dispatch_prefs.equipment_detail is written from two directions:
--   * staff, by hand, with the operating knowledge a dispatcher needs — VIN, payload,
--     liftgate, dock height, the deadline and why it exists (Warren's row holds 18 such keys);
--   * the carrier, through the Equipment micro-ask in prefs-strength.js, which sends
--     exactly { note: "<free text>" }  — or {} when they leave the box empty.
--
-- cc_prefs_save_section assigned the incoming object WHOLESALE:
--     equipment_detail = p->'equipment_detail'
-- so the first time a carrier touched that micro-ask, every staff key was silently
-- destroyed and replaced by a single `note`. Nothing warned anyone, and the loss only
-- shows up later as a truck nobody can describe.
--
-- This merges instead. The carrier's keys still win on collision, so their own answer is
-- never ignored; the staff keys they never sent simply survive. An empty object clears the
-- carrier's own `note` and nothing else, so "clear the box" still works as they expect.
--
-- Only that one line changes. Everything else is the function exactly as it was.
-- Reversible: replace `coalesce(c.equipment_detail,'{}'::jsonb) || ...` with `p->'equipment_detail'`.

CREATE OR REPLACE FUNCTION public.cc_prefs_save_section(p_section text, p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_org uuid; v_stamp jsonb;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if p_section not in ('lanes','home_base','equipment','rate_floor','home_time','weekends','load_size','facility','boards') then
    raise exception 'unknown section %', p_section using errcode='22023';
  end if;

  insert into app_private.carrier_dispatch_prefs(carrier_id, updated_by, updated_at)
  values (v_org, auth.uid(), now())
  on conflict (carrier_id) do nothing;

  if coalesce((p->>'_skip')::boolean, false) then
    v_stamp := jsonb_build_object('skipped_at', now(), 'snooze_until', now() + interval '3 days');
  else
    v_stamp := jsonb_build_object('answered_at', now());
    update app_private.carrier_dispatch_prefs c set
      preferred_lanes = case when p_section='lanes' and p ? 'preferred_lanes'
        then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'preferred_lanes') x), '{}') else c.preferred_lanes end,
      home_base = case when p_section='home_base' and p ? 'home_base' then nullif(p->>'home_base','') else c.home_base end,
      operating_radius_miles = case when p_section='home_base' and p ? 'operating_radius_miles' then nullif(p->>'operating_radius_miles','')::int else c.operating_radius_miles end,
      max_deadhead_miles = case when p_section='home_base' and p ? 'max_deadhead_miles' then nullif(p->>'max_deadhead_miles','')::int else c.max_deadhead_miles end,
      preferred_equipment = case when p_section='equipment' and p ? 'preferred_equipment'
        then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'preferred_equipment') x), '{}') else c.preferred_equipment end,
      -- bl_prefs_0301: MERGE, never replace. See header.
      equipment_detail = case when p_section='equipment' and p ? 'equipment_detail' and jsonb_typeof(p->'equipment_detail')='object'
        then case when (p->'equipment_detail') = '{}'::jsonb
                  then coalesce(c.equipment_detail,'{}'::jsonb) - 'note'
                  else coalesce(c.equipment_detail,'{}'::jsonb) || (p->'equipment_detail') end
        else c.equipment_detail end,
      min_rpm = case when p_section='rate_floor' and p ? 'min_rpm' then nullif(p->>'min_rpm','')::numeric else c.min_rpm end,
      min_total_rate = case when p_section='rate_floor' and p ? 'min_total_rate' then nullif(p->>'min_total_rate','')::numeric else c.min_total_rate end,
      home_time = case when p_section='home_time' and p ? 'home_time' then nullif(p->>'home_time','') else c.home_time end,
      weekend_ok = case when p_section='weekends' and p ? 'weekend_ok' then coalesce((p->>'weekend_ok')::boolean, c.weekend_ok) else c.weekend_ok end,
      load_size = case when p_section='load_size' and p ? 'load_size' then nullif(p->>'load_size','') else c.load_size end,
      facility_likes = case when p_section='facility' and p ? 'facility_likes'
        then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'facility_likes') x), '{}') else c.facility_likes end,
      facility_dislikes = case when p_section='facility' and p ? 'facility_dislikes'
        then coalesce((select array_agg(x) from jsonb_array_elements_text(p->'facility_dislikes') x), '{}') else c.facility_dislikes end,
      external_boards = case when p_section='boards' and p ? 'external_boards' and jsonb_typeof(p->'external_boards')='object'
        then p->'external_boards' else c.external_boards end,
      updated_by = auth.uid(), updated_at = now()
    where c.carrier_id = v_org;
  end if;

  update app_private.carrier_dispatch_prefs
    set prefs_sections = jsonb_set(coalesce(prefs_sections,'{}'::jsonb), array[p_section], coalesce(prefs_sections->p_section,'{}'::jsonb) || v_stamp)
  where carrier_id = v_org;

  perform app_private.log_audit('carrier.prefs','carrier',v_org::text,null,'prefs section saved: '||p_section, p - '_skip');
  return app_private.prefs_strength(v_org);
end; $function$;
