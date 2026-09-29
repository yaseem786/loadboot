-- bl_disp_0501 — "Hold from dispatchers" (29 Sep 2026, Yaseen)
-- A carrier LoadBoot does not want picked right now (e.g. Warren's Courier: owner went quiet / said "no need")
-- stays VISIBLE in the dispatcher "Choose your carrier" list but is LOCKED: card shows "Not available yet",
-- the choose RPC refuses it, and it sorts last. CC toggles it from Carrier 360. Nothing else changes:
-- disp_carrier_available() is untouched, existing assignments are untouched, staff can still assign directly.

create table if not exists app_private.carrier_dispatch_holds (
  carrier_org_id uuid primary key references public.organizations(id) on delete cascade,
  reason   text,
  set_by   uuid,
  set_at   timestamptz not null default now()
);
alter table app_private.carrier_dispatch_holds enable row level security;

create or replace function app_private.disp_carrier_held(p_org uuid) returns boolean
language sql stable security definer set search_path = app_private, public as $$
  select exists (select 1 from app_private.carrier_dispatch_holds h where h.carrier_org_id = p_org)
$$;
revoke all on function app_private.disp_carrier_held(uuid) from public, anon;

-- choosing a held carrier is refused at the table, whatever path inserts the choice
create or replace function app_private.disp_choice_hold_guard() returns trigger
language plpgsql security definer set search_path = app_private, public as $$
begin
  if new.status = 'pending' and app_private.disp_carrier_held(new.carrier_org_id) then
    raise exception 'this carrier is not available yet — pick another' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function app_private.disp_choice_hold_guard() from public, anon;
drop trigger if exists disp_choice_hold_guard on app_private.dispatcher_carrier_choices;
create trigger disp_choice_hold_guard before insert on app_private.dispatcher_carrier_choices
  for each row execute function app_private.disp_choice_hold_guard();

-- dispatcher list: add 'held' to each card and sort held carriers last (rank 9, so exact_count ignores them).
-- Patched in place (staging and prod bodies differ slightly); refuses loudly if the shape ever changes.
do $mig$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.dispatcher_carrier_options()'::regprocedure);
  if position('disp_carrier_held' in d) > 0 then return; end if;
  d2 := replace(d, $x$b || jsonb_build_object('match_kind', m,$x$,
                   $x$b || jsonb_build_object('held', app_private.disp_carrier_held(o.id), 'match_kind', m,$x$);
  d2 := replace(d2, $x$case m when 'exact' then 0 when 'partial' then 1 when 'related' then 2 when 'unknown' then 3 else 4 end rank$x$,
                    $x$case when app_private.disp_carrier_held(o.id) then 9 else case m when 'exact' then 0 when 'partial' then 1 when 'related' then 2 when 'unknown' then 3 else 4 end end rank$x$);
  if position($x$'held', app_private.disp_carrier_held$x$ in d2) = 0 or position('then 9 else case m' in d2) = 0 then
    raise exception 'bl_disp_0501: dispatcher_carrier_options shape changed — patch not applied';
  end if;
  execute d2;
end $mig$;

-- CC: read / set / clear the hold.  p_on null = read only.
create or replace function public.cc_carrier_dispatch_hold(p_org uuid, p_on boolean default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare r record;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if not exists (select 1 from public.organizations where id = p_org and kind = 'carrier') then
    return jsonb_build_object('error','not a carrier');
  end if;
  if p_on is true then
    insert into app_private.carrier_dispatch_holds (carrier_org_id, reason, set_by, set_at)
    values (p_org, nullif(btrim(coalesce(p_reason,'')),''), auth.uid(), now())
    on conflict (carrier_org_id) do update set reason = excluded.reason, set_by = excluded.set_by, set_at = now();
    perform app_private.disp_audit('carrier.dispatch_hold.on', 'carrier', p_org::text, null,
      'held from dispatchers' || coalesce(' — ' || nullif(btrim(coalesce(p_reason,'')),''), ''), '{}'::jsonb);
  elsif p_on is false then
    delete from app_private.carrier_dispatch_holds where carrier_org_id = p_org;
    if found then
      perform app_private.disp_audit('carrier.dispatch_hold.off', 'carrier', p_org::text, null, 'released for dispatchers', '{}'::jsonb);
    end if;
  end if;
  select * into r from app_private.carrier_dispatch_holds where carrier_org_id = p_org;
  return jsonb_build_object('ok', true, 'held', r.carrier_org_id is not null, 'reason', r.reason, 'set_at', r.set_at,
    'set_by_name', case when r.set_by is not null then app_private.cfs_name_of(r.set_by) end);
end $$;
revoke all on function public.cc_carrier_dispatch_hold(uuid, boolean, text) from public, anon;
grant execute on function public.cc_carrier_dispatch_hold(uuid, boolean, text) to authenticated;
