-- bl_pref_0533 — a column DEFAULT is not a carrier's answer (8 Oct 2026)
--
-- SPRINT SHIFT LOGISTICS: prefs.weekend_ok = true, stamped set_by_role='carrier' on 6 Oct 18:43:28 — the same
-- second as mc / dot / team_drivers=false / hazmat=false. Proved on prod:
--   * app_private.carrier_dispatch_prefs.weekend_ok has DEFAULT true;
--   * update_my_carrier_profile (the onboarding wizard) fires sync_hazmat_pref, which does
--       insert into carrier_dispatch_prefs (carrier_id, hazmat) …   -- first prefs row for the org
--   * cfs_track (AFTER INSERT) stamps EVERY non-empty fill field of the new row as set by auth.uid() — the carrier.
--   So "Runs weekends? = Yes" was never chosen by anyone; the default was recorded as his answer and the
--   field locked for his dispatcher. (haul_types and preferred_equipment are NOT defaulted — those were the
--   carrier's own ticks in Account → Dispatch on 7 Oct; the UI there is not pre-selected.)
--
-- Fix, additive and reversible:
--   1. weekend_ok and team_drivers lose their DEFAULT — a new prefs row starts UNANSWERED (null).
--      Existing rows are untouched (owner rule: never change existing carriers' values).
--      Readers already coalesce: cc_match_rank / tp_run_matcher test `weekend_ok = false` (null = no filter),
--      directories coalesce(weekend_ok,false), the carrier UI shows null as "not answered" (bl_pref_0242).
--   2. cfs_track: on INSERT a field whose value equals the column's DEFAULT is not stamped at all — a default
--      can never become provenance. (hazmat keeps its DEFAULT false: it is synced from the profile toggle.)
-- Rollback: alter column … set default true / false; re-create cfs_track from bl_disp_0459.

begin;

alter table app_private.carrier_dispatch_prefs alter column weekend_ok   drop default;
alter table app_private.carrier_dispatch_prefs alter column team_drivers drop default;

-- the column's DEFAULT as jsonb (null when the column has none / cannot be evaluated)
create or replace function app_private.cfs_col_default(p_schema text, p_table text, p_col text)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_def text; v jsonb;
begin
  select column_default into v_def from information_schema.columns
   where table_schema = p_schema and table_name = p_table and column_name = p_col;
  if v_def is null then return null; end if;
  execute format('select to_jsonb(%s)', v_def) into v;
  return v;
exception when others then return null;
end $$;
revoke execute on function app_private.cfs_col_default(text, text, text) from public, anon, authenticated;

create or replace function app_private.cfs_track() returns trigger
language plpgsql security definer set search_path = app_private, public as $$
declare v_tbl text; v_org uuid; v_truck uuid; v_new jsonb; v_old jsonb; f record; v_uid uuid := auth.uid();
begin
  begin
    if tg_table_name = 'profiles' then
      v_tbl := 'profile';
      select id into v_org from public.organizations where owner_user_id = coalesce(new.id, old.id) and kind = 'carrier' order by created_at limit 1;
    elsif tg_table_name = 'carrier_dispatch_prefs' then
      v_tbl := 'prefs'; v_org := coalesce(new.carrier_id, old.carrier_id);
    elsif tg_table_name = 'fleet_trucks' then
      v_tbl := 'truck'; v_org := coalesce(new.carrier_id, old.carrier_id); v_truck := coalesce(new.id, old.id);
    else
      return coalesce(new, old);
    end if;
    if v_org is null then return coalesce(new, old); end if;
    if tg_op = 'DELETE' then
      delete from app_private.carrier_field_sources where carrier_org_id = v_org and tbl = v_tbl
        and (v_truck is null or truck_id = v_truck);
      return old;
    end if;
    v_new := to_jsonb(new); v_old := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
    for f in select field from app_private.carrier_fill_fields where tbl = v_tbl loop
      if tg_op = 'INSERT' or (v_new -> f.field) is distinct from (v_old -> f.field) then
        if tg_op = 'INSERT' and app_private.cfs_is_empty(v_new -> f.field) then continue; end if;
        -- bl_pref_0533: a value that is just the column DEFAULT was not answered by anyone — never stamp it
        if tg_op = 'INSERT' and (v_new -> f.field) is not distinct from app_private.cfs_col_default(tg_table_schema, tg_table_name, f.field) then continue; end if;
        perform app_private.cfs_stamp(v_org, v_tbl, f.field, v_truck, v_new -> f.field, v_uid);
      end if;
    end loop;
  exception when others then null;   -- provenance must never break a carrier / CC write
  end;
  return coalesce(new, old);
end $$;

do $$
declare n int;
begin
  if (select column_default from information_schema.columns where table_schema='app_private' and table_name='carrier_dispatch_prefs' and column_name='weekend_ok') is not null then
    raise exception 'bl_pref_0533: weekend_ok still has a default';
  end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  raise notice 'bl_pref_0533: anon SECURITY DEFINER surface in public = % (expect 36 prod / 35 staging)', n;
end $$;

commit;
