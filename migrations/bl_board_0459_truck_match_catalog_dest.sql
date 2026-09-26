-- bl_board_0459 — Post-a-Truck load alerts: catalog row, destination matching, weekend hold on the
-- post-time matcher. Follow-up to audit #4 in claude/BOARD-AUDIT-0457.md (the 0459 section).
--
-- 1. app_private.email_catalog gets `load.match.posted_truck` (class O, load_ops, opt-out-able).
--    tp_match_new_load sent under the unregistered key `truck_match`; it now sends under the
--    catalog key (CLAUDE.md §6). The in-app notification keeps template_key 'truck_match' (not email).
-- 2. app_private.tp_load_matches honours dest_pref, which the post form has always saved and the
--    matcher ignored. The form (buildDestPicker) writes '' | 'TX' | 'Dallas, TX':
--      'TX'          → load destination state must be TX
--      'Dallas, TX'  → load delivery pin within 150 mi of the city pin; without a pin on either
--                      side, the destination state must match
--      anything else → ignored (prod has two junk values, '500' and 'Devor'; they keep matching
--                      exactly as before)
--    Checked last, so the geo_resolve lookup only runs for loads that passed every other filter.
-- 3. app_private.geo_enqueue_trg also queues a city-style dest_pref for geocoding, and the trigger
--    on truck_postings now fires on dest_pref changes too.
-- 4. app_private.tp_run_matcher (runs on post / edit / "scan") now applies the same weekend hold as
--    tp_match_new_load: a weekend pickup for a carrier with weekend_ok = false is matched and shown,
--    but never auto-requested. Before this, a no-weekends carrier with auto_request on could get
--    a weekend load requested for them at post time.
--
-- All bodies are patched in place from the live definition, each anchor must hit or the migration
-- aborts. Same signatures → create or replace keeps every ACL. No new functions, so the anon SECDEF
-- surface is unchanged.

insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type,
  trigger_source, cadence, cap_note, stop_condition, preference_group, unsub_allowed, cc_deep_link,
  status, discovered_in, owner_note)
values ('load.match.posted_truck', 'Load matches your posted truck',
  'A newly posted load fits a carrier''s live truck posting (equipment, dates, min RPM, haul band, pickup radius, destination).',
  'O', 'carrier', 'event', 'app_private.tp_match_new_load (trigger trg_load_posted_match on public.loads)',
  'per matching load', 'once per posting + load (dedupe key match:<posting>:<load>)',
  'posting paused, expired or past available_to', 'load_ops', true, '#/carriers',
  'live', '{code}', 'bl_board_0459: was sent as unregistered key truck_match')
on conflict (key) do nothing;

do $mig$
declare
  v_old text; v_new text; v_prev text;
begin
  -- 2. tp_load_matches: destination
  select pg_get_functiondef('app_private.tp_load_matches'::regproc) into v_old;
  v_new := v_old;
  v_prev := v_new;
  v_new := replace(v_new, 'declare v_rpm numeric; v_basis text := ''''; v_haul text[]; v_band text;',
    'declare v_rpm numeric; v_basis text := ''''; v_haul text[]; v_band text; v_dst text; v_dlat double precision; v_dlng double precision;');
  if v_new = v_prev then raise exception '0459: tp_load_matches declare anchor not found'; end if;
  v_prev := v_new;
  v_new := replace(v_new, 'return coalesce(nullif(v_basis,''''),''open-criteria'');',
$r$-- bl_board_0459: destination from the post form ('TX' or 'Dallas, TX'); other text is ignored.
  v_dst := upper(btrim(coalesce(p.dest_pref,'')));
  if v_dst ~ '^[A-Z]{2}$' then
    if upper(right(btrim(coalesce(l.destination,'')),2)) ~ '^[A-Z]{2}$' then
      if upper(right(btrim(l.destination),2)) <> v_dst then return null; end if;
      v_basis := v_basis || 'dest ' || v_dst || ';';
    end if;
  elsif v_dst ~ '^[^,]+,\s*[A-Z]{2}$' then
    select g.lat, g.lng into v_dlat, v_dlng from app_private.geo_resolve(p.dest_pref) g;
    if v_dlat is not null and l.delivery_lat is not null and l.delivery_lng is not null then
      if app_private.haversine_miles(v_dlat, v_dlng, l.delivery_lat, l.delivery_lng) > 150 then return null; end if;
      v_basis := v_basis || 'dest 150mi;';
    elsif upper(right(btrim(coalesce(l.destination,'')),2)) ~ '^[A-Z]{2}$' then
      if upper(right(btrim(l.destination),2)) <> right(v_dst,2) then return null; end if;
      v_basis := v_basis || 'dest ' || right(v_dst,2) || ';';
    end if;
  end if;

  return coalesce(nullif(v_basis,''),'open-criteria');$r$);
  if v_new = v_prev then raise exception '0459: tp_load_matches return anchor not found'; end if;
  execute v_new;

  -- 1. tp_match_new_load: catalog key
  select pg_get_functiondef('app_private.tp_match_new_load'::regproc) into v_old;
  v_new := replace(v_old, '''truck_match'', ''New load matches your posted truck — ''',
                          '''load.match.posted_truck'', ''New load matches your posted truck — ''');
  if v_new = v_old then raise exception '0459: tp_match_new_load key anchor not found'; end if;
  execute v_new;

  -- 4. tp_run_matcher: weekend hold on auto-request
  select pg_get_functiondef('app_private.tp_run_matcher'::regproc) into v_old;
  v_new := v_old;
  v_prev := v_new;
  v_new := replace(v_new, 'v_n int := 0; v_exists boolean;', 'v_n int := 0; v_exists boolean; v_wk_off boolean;');
  if v_new = v_prev then raise exception '0459: tp_run_matcher declare anchor not found'; end if;
  v_prev := v_new;
  v_new := replace(v_new, 'if p.auto_request then',
$r$-- bl_board_0459: same weekend hold as tp_match_new_load — match it, never auto-request it.
    v_wk_off := l.pickup_date is not null
      and extract(isodow from l.pickup_date) in (6,7)
      and exists (select 1 from app_private.carrier_dispatch_prefs d
                   where d.carrier_id = p.carrier_id and d.weekend_ok = false);
    if v_wk_off then
      update app_private.truck_posting_matches
         set match_basis = match_basis || ' · weekend pickup — auto-request held (carrier keeps weekends off)'
       where posting_id = p.id and load_id = l.id;
    end if;
    if p.auto_request and not v_wk_off then$r$);
  if v_new = v_prev then raise exception '0459: tp_run_matcher auto_request anchor not found'; end if;
  execute v_new;

  -- 3. geo_enqueue_trg: queue a city-style destination too
  select pg_get_functiondef('app_private.geo_enqueue_trg'::regproc) into v_old;
  v_new := replace(v_old, 'perform app_private.geo_enqueue(new.origin, ''truck_posting'');',
$r$perform app_private.geo_enqueue(new.origin, 'truck_posting');
      if coalesce(new.dest_pref,'') ~ '^[^,]+,\s*[A-Za-z]{2}\s*$' then
        perform app_private.geo_enqueue(btrim(new.dest_pref), 'truck_posting_dest');
      end if;$r$);
  if v_new = v_old then raise exception '0459: geo_enqueue_trg anchor not found'; end if;
  execute v_new;
end
$mig$;

drop trigger if exists trg_geo_truck_posting on app_private.truck_postings;
create trigger trg_geo_truck_posting after insert or update of origin, dest_pref on app_private.truck_postings
  for each row execute function app_private.geo_enqueue_trg();
