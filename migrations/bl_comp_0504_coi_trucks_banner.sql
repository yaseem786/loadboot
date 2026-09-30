-- bl_comp_0504 — carrier dashboard banner "Insurance approved → post the trucks on your certificate"
-- (owner decision 30 Sep 2026). Shows once the COI is valid: FMCSA power units vs VINs covered
-- on the certificate (app_private.coi_vehicles / coi_coverage.mode). Hides when the carrier
-- taps ✕, or on its own 2 days after the first time that user saw it. A new approval or a
-- change in covered VINs / coverage mode makes a new key, so the banner comes back once.

create table if not exists app_private.carrier_banner_seen (
  user_id       uuid not null,
  banner_key    text not null,
  first_seen_at timestamptz not null default now(),
  dismissed_at  timestamptz,
  primary key (user_id, banner_key)
);
alter table app_private.carrier_banner_seen enable row level security;

create or replace function public.carrier_coi_trucks_banner()
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); v_ok timestamptz; v_mode text; v_exp date;
  v_units int; v_vins jsonb; v_n int; v_key text; s app_private.carrier_banner_seen;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null or v_uid is null then return jsonb_build_object('show', false); end if;

  select c.verified_at into v_ok from app_private.carrier_compliance c
   where c.carrier_id = v_org and c.requirement_key = 'insurance_coi' and c.status = 'valid';
  if not found then return jsonb_build_object('show', false); end if;

  select coalesce(cv.mode, 'unknown'), cv.expiry_date into v_mode, v_exp
    from app_private.coi_coverage cv where cv.org_id = v_org;
  v_mode := coalesce(v_mode, 'unknown');
  select coalesce(jsonb_agg(jsonb_build_object('vin', v.vin, 'descr', v.descr) order by v.vin), '[]'::jsonb), count(*)
    into v_vins, v_n from app_private.coi_vehicles v where v.org_id = v_org;
  select cv.power_units into v_units from app_private.carrier_verifications cv
   where cv.carrier_org = v_org and cv.power_units is not null
   order by cv.verified_at desc nulls last limit 1;

  v_key := 'coi_trucks:' || coalesce(to_char(v_ok, 'YYYYMMDDHH24MISS'), 'x') || ':' || v_mode || ':' || v_n;
  insert into app_private.carrier_banner_seen(user_id, banner_key) values (v_uid, v_key)
    on conflict (user_id, banner_key) do nothing;
  select * into s from app_private.carrier_banner_seen where user_id = v_uid and banner_key = v_key;

  return jsonb_build_object(
    'show', s.dismissed_at is null and s.first_seen_at > now() - interval '2 days',
    'key', v_key, 'mode', v_mode, 'expiry', v_exp,
    'fmcsa_units', v_units,            -- NULL = no FMCSA snapshot on file (unknown)
    'covered', v_n, 'vins', v_vins,
    'hides_at', s.first_seen_at + interval '2 days');
end $$;

create or replace function public.carrier_coi_trucks_banner_dismiss(p_key text)
returns void language plpgsql security definer set search_path = app_private, public as $$
begin
  if auth.uid() is null then return; end if;
  update app_private.carrier_banner_seen set dismissed_at = now()
   where user_id = auth.uid() and banner_key = p_key and dismissed_at is null;
end $$;

revoke all on function public.carrier_coi_trucks_banner() from public, anon;
revoke all on function public.carrier_coi_trucks_banner_dismiss(text) from public, anon;
grant execute on function public.carrier_coi_trucks_banner() to authenticated;
grant execute on function public.carrier_coi_trucks_banner_dismiss(text) to authenticated;
