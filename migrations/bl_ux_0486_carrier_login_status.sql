-- bl_ux_0486_carrier_login_status.sql (27 Sep 2026)
-- Carrier 360 header: is the carrier in the portal RIGHT NOW, when did they last use it, when did they last sign in.
--
--   live now      = the carrier portal pinged device_seen() within the last 3 minutes. The portal pings on load and
--                   every 2 minutes while the tab is visible (app/carrier/app.js, same commit).
--   last seen     = max(app_private.user_devices.last_seen) for the owner user (device + browser label).
--   last sign-in  = auth.users.last_sign_in_at (a token refresh does not move it, so "last seen" is the better signal).
--
-- Read-only staff RPC, gate = carriers.view (same as cc_carrier_360). New public function → revoke public + anon
-- explicitly (CLAUDE.md §4). Anon SECURITY DEFINER surface unchanged (36 prod / 35 staging).

create or replace function public.cc_carrier_login_status(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private', 'public'
as $function$
declare v_uid uuid; v_signin timestamptz; v_seen timestamptz; v_label text; v_devices int;
begin
  if not public.has_global_permission('carriers.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select o.owner_user_id into v_uid from public.organizations o where o.id = p_org;
  if v_uid is null then return jsonb_build_object('error', 'carrier not found'); end if;
  select u.last_sign_in_at into v_signin from auth.users u where u.id = v_uid;
  select d.last_seen, d.label into v_seen, v_label from app_private.user_devices d where d.user_id = v_uid order by d.last_seen desc limit 1;
  select count(*) into v_devices from app_private.user_devices d where d.user_id = v_uid;
  return jsonb_build_object(
    'live',           v_seen is not null and v_seen > now() - interval '3 minutes',
    'last_seen',      v_seen,
    'device',         v_label,
    'devices',        v_devices,
    'last_sign_in',   v_signin,
    'never',          v_seen is null and v_signin is null);
end $function$;
revoke execute on function public.cc_carrier_login_status(uuid) from public, anon;
grant  execute on function public.cc_carrier_login_status(uuid) to authenticated, service_role;
comment on function public.cc_carrier_login_status(uuid) is
  'bl_ux_0486: Carrier 360 header — live now (portal ping < 3 min), last seen + device, last sign-in. Staff (carriers.view) only.';
