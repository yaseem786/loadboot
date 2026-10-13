-- bl_ops_0547 — STAGING ONLY. Bring staging's demo isolation up to prod (bl_demo_0214–0221).
--
-- WHY: prod got the demo-isolation wave on 6 Aug 2026 (bl_demo_0214_demo_isolation_base …
-- bl_demo_0221_keep_demo_out_of_kpis). None of it reached staging: no
-- app_private.session_is_demo(), no app_private.stamp_load_demo() trigger, and the carrier
-- board / booking / offer / KPI functions on staging still treat demo freight as real.
-- The carrier-training sandbox (bl_train_0548) is built on that plumbing, so testing it on a
-- staging without it would prove nothing. Those prod migrations were never committed to the
-- repo; their text was read back from prod's supabase_migrations.schema_migrations.
--
-- Same anchor-patch technique as the originals: read the CURRENT staging definition, replace
-- one anchor string, execute. A missing anchor aborts instead of leaving a silent hole.
-- The only anchor that differs from prod is book_load (staging still has the older body).
-- The play.* store-review seed (0217/0218/0232) is NOT ported — staging has no play accounts.
--
-- Do NOT run on prod: prod already has all of this.

alter table public.organizations add column if not exists is_demo boolean not null default false;
alter table public.loads add column if not exists is_demo boolean not null default false;

create index if not exists loads_is_demo_status_idx
  on public.loads (is_demo, status)
  where status = 'available';

create or replace function app_private.session_is_demo()
returns boolean
language sql
stable
security definer
set search_path to 'app_private, public'
as $fn$
  select exists (
    select 1
      from public.organization_memberships om
      join public.organizations o on o.id = om.org_id
     where om.user_id = auth.uid()
       and o.is_demo
  );
$fn$;
revoke all on function app_private.session_is_demo() from public, anon, authenticated;

create or replace function app_private.stamp_load_demo()
returns trigger
language plpgsql
security definer
set search_path to 'app_private, public'
as $fn$
begin
  new.is_demo := coalesce((
    select bool_or(o.is_demo)
      from public.organizations o
     where o.id in (new.broker_org, new.shipper_org)
  ), false);
  return new;
end;
$fn$;
revoke all on function app_private.stamp_load_demo() from public, anon, authenticated;

drop trigger if exists trg_loads_stamp_demo on public.loads;
create trigger trg_loads_stamp_demo
  before insert or update of broker_org, shipper_org on public.loads
  for each row execute function app_private.stamp_load_demo();

create or replace function app_private.patch_fn(
  p_schema text, p_name text, p_anchor text, p_replacement text
) returns void
language plpgsql
as $patch$
declare d text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name limit 1;
  if v_oid is null then raise exception 'patch_fn: %.% not found', p_schema, p_name; end if;
  d := pg_get_functiondef(v_oid);
  if position(p_replacement in d) > 0 then return; end if;
  if position(p_anchor in d) = 0 then
    raise exception 'patch_fn: anchor not found in %.% — refusing to patch blind', p_schema, p_name;
  end if;
  execute replace(d, p_anchor, p_replacement);
end;
$patch$;

-- 0215 — carrier board, suggestions, matcher, booking (symmetric: a demo session sees only demo freight)
select app_private.patch_fn('public', 'cc_pocket_available_loads',
  E'    from public.loads l\n    where l.status=\'available\'',
  E'    from public.loads l\n    where l.status=\'available\'\n      and (l.is_demo = app_private.session_is_demo() or public.is_active_staff())');
select app_private.patch_fn('public', 'carrier_assignment_suggestions',
  E'    where l.status = \'available\' and l.rate is not null',
  E'    where l.status = \'available\' and l.rate is not null and l.is_demo = app_private.session_is_demo()');
select app_private.patch_fn('public', 'cc_truck_posting_matches',
  E'  where m.posting_id = p_posting;',
  E'  where m.posting_id = p_posting and l.is_demo = app_private.session_is_demo();');
select app_private.patch_fn('app_private', 'tp_run_matcher',
  E'from public.loads where status = \'available\' order by created_at desc limit 400 loop',
  E'from public.loads where status = \'available\' and not is_demo order by created_at desc limit 400 loop');
select app_private.patch_fn('public', 'cc_pocket_book_load',
  E'select * into ld from public.loads where id = p_load and status=\'available\';',
  E'select * into ld from public.loads where id = p_load and status=\'available\' and is_demo = app_private.session_is_demo();');
-- staging's older book_load body (prod's anchor also checks expires_at)
select app_private.patch_fn('public', 'book_load',
  E'where id=p_load and status=\'available\';',
  E'where id=p_load and status=\'available\' and is_demo = app_private.session_is_demo();');

-- 0216 — remaining carrier-session surfaces + auto-dispatch
select app_private.patch_fn('public', 'carrier_fleet_plan',
  E'    where l.status = \'available\' and l.rate is not null',
  E'    where l.status = \'available\' and l.rate is not null and l.is_demo = app_private.session_is_demo()');
select app_private.patch_fn('public', 'carrier_fleet_plan',
  E'        where a2.status = \'available\' and a2.rate is not null and a2.pickup_lat is not null',
  E'        where a2.status = \'available\' and a2.rate is not null and a2.is_demo = app_private.session_is_demo() and a2.pickup_lat is not null');
select app_private.patch_fn('public', 'cc_request_book_load',
  E'  select * into ld from public.loads where id=p_load and status=\'available\';',
  E'  select * into ld from public.loads where id=p_load and status=\'available\' and is_demo = app_private.session_is_demo();');
select app_private.patch_fn('public', 'cc_prebook_check',
  E'  c := (l.status = \'available\');',
  E'  c := (l.status = \'available\' and l.is_demo = app_private.session_is_demo());');
select app_private.patch_fn('public', 'cc_auto_dispatch_run',
  E'    where ld.status = \'available\'',
  E'    where ld.status = \'available\' and not ld.is_demo');

-- 0219 — public teaser board: demo freight excluded outright
select app_private.patch_fn('public', 'get_public_load_opportunities',
  E'  where status=\'available\' and (pickup_date is null or pickup_date >= current_date)',
  E'  where status=\'available\' and not is_demo and (pickup_date is null or pickup_date >= current_date)');

-- 0220 — broker → carrier offer path
select app_private.patch_fn('public', 'cc_partner_carrier_directory',
  E'      where o.kind=\'carrier\' and o.status=\'active\' and coalesce(o.broker_visible, false)',
  E'      where o.kind=\'carrier\' and o.status=\'active\' and o.is_demo = app_private.session_is_demo() and coalesce(o.broker_visible, false)');
select app_private.patch_fn('public', 'cc_partner_eligible_carriers',
  E'    where el.eligible and coalesce(o.broker_visible, false)), \'[]\'::jsonb);',
  E'    where el.eligible and o.is_demo = app_private.session_is_demo() and coalesce(o.broker_visible, false)), \'[]\'::jsonb);');
select app_private.patch_fn('public', 'cc_partner_offer_send',
  E'    select name into v_cname from public.organizations where id = c;',
  E'    select name into v_cname from public.organizations where id = c;'
  || E'\n    if (select coalesce(is_demo,false) from public.organizations where id = c) <> coalesce(l.is_demo,false) then'
  || E'\n      raise exception \'demo isolation: a demonstration load cannot be offered to a live carrier, and vice versa\' using errcode=\'42501\';'
  || E'\n    end if;');

-- 0221 — KPIs
select app_private.patch_fn('public', 'cc_analytics_overview',
  E'    \'loads_available\', (select count(*) from public.loads where status=\'available\'),',
  E'    \'loads_available\', (select count(*) from public.loads where status=\'available\' and not is_demo),');
select app_private.patch_fn('public', 'cc_get_overview',
  E'  \'loads_available\', (select count(*) from public.loads where status=\'available\'),',
  E'  \'loads_available\', (select count(*) from public.loads where status=\'available\' and not is_demo),');

drop function app_private.patch_fn(text, text, text, text);
