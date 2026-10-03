-- bl_ux_0504b — CC Carriers list "Portal" column showed "Never logged in" for everyone: cc_list_carriers rows carry the
-- OWNER USER id, not the org id, and 0504 matched org ids only. Now each input id may be an org id OR a user id;
-- the result stays keyed by the id that was passed in.
CREATE OR REPLACE FUNCTION public.cc_carriers_login_status(p_orgs uuid[])
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
begin
  if not public.has_global_permission('carriers.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_object_agg(x.k::text, jsonb_build_object(
        'live',         d.last_seen is not null and d.last_seen > now() - interval '3 minutes',
        'last_seen',    d.last_seen,
        'device',       d.label,
        'devices',      coalesce(dc.n, 0),
        'last_sign_in', u.last_sign_in_at,
        'never',        d.last_seen is null and u.last_sign_in_at is null))
      from (select distinct k from unnest((coalesce(p_orgs, '{}'::uuid[]))[1:500]) k) x
      cross join lateral (select coalesce((select o.owner_user_id from public.organizations o where o.id = x.k), x.k) uid) r
      left join auth.users u on u.id = r.uid
      left join lateral (select ud.last_seen, ud.label from app_private.user_devices ud
                          where ud.user_id = r.uid order by ud.last_seen desc nulls last limit 1) d on true
      left join lateral (select count(*) n from app_private.user_devices ud where ud.user_id = r.uid) dc on true
  ), '{}'::jsonb);
end $function$;
revoke all on function public.cc_carriers_login_status(uuid[]) from public, anon;
grant execute on function public.cc_carriers_login_status(uuid[]) to authenticated;
