-- bl_ux_0504 — CC Carriers list: portal presence per row (live / last seen / device / last sign-in),
-- the same facts Carrier 360 shows (cc_carrier_login_status), fetched for the whole page in ONE call.
create or replace function public.cc_carriers_login_status(p_orgs uuid[])
returns jsonb
language plpgsql stable security definer
set search_path to 'app_private', 'public'
as $$
begin
  if not public.has_global_permission('carriers.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_object_agg(o.id::text, jsonb_build_object(
        'live',         d.last_seen is not null and d.last_seen > now() - interval '3 minutes',
        'last_seen',    d.last_seen,
        'device',       d.label,
        'devices',      coalesce(dc.n, 0),
        'last_sign_in', u.last_sign_in_at,
        'never',        d.last_seen is null and u.last_sign_in_at is null))
      from public.organizations o
      left join auth.users u on u.id = o.owner_user_id
      left join lateral (select ud.last_seen, ud.label from app_private.user_devices ud
                          where ud.user_id = o.owner_user_id order by ud.last_seen desc nulls last limit 1) d on true
      left join lateral (select count(*) n from app_private.user_devices ud where ud.user_id = o.owner_user_id) dc on true
     where o.id = any((coalesce(p_orgs, '{}'::uuid[]))[1:500])
  ), '{}'::jsonb);
end $$;
revoke all on function public.cc_carriers_login_status(uuid[]) from public, anon;
grant execute on function public.cc_carriers_login_status(uuid[]) to authenticated;
