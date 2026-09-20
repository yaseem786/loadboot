-- bl_disp_0360 — two carrier dispatch facts a dispatcher must otherwise ask on every first call:
--   min_rpm_basis : is the carrier's rate floor per LOADED mile, or per ALL miles (deadhead included)?
--   dat_seat      : may the dispatcher use a DAT dispatcher seat for this carrier? (yes / no / paid = allowed, seat has a cost)
-- NULL = unknown. The carrier-assignment brief (bl_disp_0361) lists every NULL as a "close this first" item, so filling
-- these makes the question disappear from the brief. Additive only: no existing function is touched.
-- Rollback: drop function public.cc_set_dispatch_terms(text,text,text,uuid);
--           alter table app_private.carrier_dispatch_prefs drop column min_rpm_basis, drop column dat_seat, drop column dat_seat_note;

alter table app_private.carrier_dispatch_prefs
  add column if not exists min_rpm_basis text check (min_rpm_basis in ('loaded','all')),
  add column if not exists dat_seat      text check (dat_seat in ('yes','no','paid')),
  add column if not exists dat_seat_note text;

-- Carrier sets its own (p_org null). Staff may set it for a carrier (p_org given) — e.g. after the dispatcher's first call.
-- Only the arguments that are passed are changed; pass '' to clear a value back to unknown.
create or replace function public.cc_set_dispatch_terms(p_min_rpm_basis text default null, p_dat_seat text default null,
  p_dat_seat_note text default null, p_org uuid default null) returns jsonb
language plpgsql security definer set search_path to 'app_private', 'public' as $fn$
declare v_org uuid; r record;
begin
  if p_org is not null then
    if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
    if not exists (select 1 from public.organizations where id = p_org) then return jsonb_build_object('error','carrier not found'); end if;
    v_org := p_org;
  else
    v_org := app_private.my_carrier_org();
    if v_org is null then return jsonb_build_object('error','not a carrier account'); end if;
  end if;
  if coalesce(p_min_rpm_basis,'') not in ('','loaded','all') then return jsonb_build_object('error','rate floor basis must be loaded or all'); end if;
  if coalesce(p_dat_seat,'') not in ('','yes','no','paid') then return jsonb_build_object('error','DAT seat must be yes, no or paid'); end if;

  insert into app_private.carrier_dispatch_prefs as dp (carrier_id, min_rpm_basis, dat_seat, dat_seat_note, updated_by, updated_at)
  values (v_org, nullif(p_min_rpm_basis,''), nullif(p_dat_seat,''), nullif(btrim(left(coalesce(p_dat_seat_note,''),300)),''), auth.uid(), now())
  on conflict (carrier_id) do update set
    min_rpm_basis = case when p_min_rpm_basis is null then dp.min_rpm_basis else nullif(p_min_rpm_basis,'') end,
    dat_seat      = case when p_dat_seat      is null then dp.dat_seat      else nullif(p_dat_seat,'') end,
    dat_seat_note = case when p_dat_seat_note is null then dp.dat_seat_note else nullif(btrim(left(p_dat_seat_note,300)),'') end,
    updated_by = auth.uid(), updated_at = now();

  select min_rpm_basis, dat_seat, dat_seat_note into r from app_private.carrier_dispatch_prefs where carrier_id = v_org;
  return jsonb_build_object('ok', true, 'min_rpm_basis', r.min_rpm_basis, 'dat_seat', r.dat_seat, 'dat_seat_note', r.dat_seat_note);
end $fn$;

revoke all on function public.cc_set_dispatch_terms(text,text,text,uuid) from public, anon;
grant execute on function public.cc_set_dispatch_terms(text,text,text,uuid) to authenticated;
