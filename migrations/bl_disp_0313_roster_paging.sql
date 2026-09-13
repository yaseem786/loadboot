-- bl_disp_0313 — CC dispatcher roster at scale: server-side search / stage filter / keyset paging
-- (cc_dispatchers_page) + one cheap stats call (cc_dispatchers_stats). cc_dispatchers_list is
-- untouched; the old list still works. Staff-gated, authenticated-only, anon revoked. 13 Sep 2026.
create extension if not exists pg_trgm;
create index if not exists dispatcher_profiles_status_created_idx
  on app_private.dispatcher_profiles (status, created_at desc, user_id desc);
create index if not exists dispatcher_profiles_created_idx
  on app_private.dispatcher_profiles (created_at desc, user_id desc);
create index if not exists dispatcher_profiles_name_trgm_idx
  on app_private.dispatcher_profiles using gin (lower(coalesce(full_name,'')) gin_trgm_ops);

create or replace function public.cc_dispatchers_page(
  p_q text default null, p_status text default null,
  p_before timestamptz default null, p_before_id uuid default null,
  p_limit int default 50, p_user uuid default null)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private', 'public' as $$
declare v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200); v_q text := nullif(trim(coalesce(p_q,'')), '');
        v_rows jsonb; v_n int;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  with base as (
    select d.user_id, d.full_name, d.country, d.status, d.years_exp, d.created_at, d.commission_pct, d.trial_start, d.trial_end,
           u.email
      from app_private.dispatcher_profiles d
      left join auth.users u on u.id = d.user_id
     where (p_user is null or d.user_id = p_user)
       and (p_status is null or p_status = 'all' or d.status = p_status)
       and (v_q is null
            or lower(coalesce(d.full_name,'')) like '%' || lower(v_q) || '%'
            or lower(coalesce(u.email,'')) like '%' || lower(v_q) || '%'
            or lower(coalesce(d.country,'')) like '%' || lower(v_q) || '%')
       and (p_before is null or (d.created_at, d.user_id) < (p_before, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid)))
     order by d.created_at desc, d.user_id desc
     limit v_lim + 1)
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
      'user_id', b.user_id, 'name', b.full_name, 'email', b.email, 'country', b.country, 'status', b.status,
      'years_exp', b.years_exp, 'applied_at', b.created_at, 'commission_pct', b.commission_pct,
      'trial_start', b.trial_start, 'trial_end', b.trial_end,
      'carriers', (select count(*) from app_private.dispatcher_assignments a where a.dispatcher_user_id = b.user_id and a.status = 'active'),
      'active_trucks', (select count(*) from app_private.dispatcher_assignments a
                          join app_private.fleet_trucks t on t.carrier_id = a.carrier_org_id and coalesce(t.status,'active') not in ('inactive','retired')
                         where a.dispatcher_user_id = b.user_id and a.status = 'active'),
      'open_rc', (select count(*) from app_private.dispatcher_bookings k where k.dispatcher_user_id = b.user_id and k.status = 'rc_received'),
      'moving', (select count(*) from app_private.dispatcher_bookings k where k.dispatcher_user_id = b.user_id and k.status in ('approved','dispatched','picked_up')),
      'test', (select jsonb_build_object('status', t.status, 'decision', t.decision, 'score', t.staff_score, 'max', t.max_score, 'told', t.passed_email_at is not null)
                 from app_private.skills_test_attempts t where t.user_id = b.user_id order by t.created_at desc limit 1)
    ) order by b.created_at desc, b.user_id desc), '[]'::jsonb)
    into v_n, v_rows
    from base b;
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(v_rows) with ordinality x(e, i) where i <= v_lim), '[]'::jsonb),
    'has_more', v_n > v_lim);
end $$;
revoke all on function public.cc_dispatchers_page(text,text,timestamptz,uuid,int,uuid) from public, anon;
grant execute on function public.cc_dispatchers_page(text,text,timestamptz,uuid,int,uuid) to authenticated, service_role;

create or replace function public.cc_dispatchers_stats()
returns jsonb language sql stable security definer
set search_path to 'app_private', 'public' as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized') else jsonb_build_object(
    'total', (select count(*) from app_private.dispatcher_profiles),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from app_private.dispatcher_profiles group by status) s),
    'applied_7d', (select count(*) from app_private.dispatcher_profiles where created_at > now() - interval '7 days'),
    'trials_ending_7d', (select count(*) from app_private.dispatcher_profiles where status = 'trial' and trial_end between now() and now() + interval '7 days'),
    'tests_to_review', (select count(*) from app_private.skills_test_attempts where status = 'submitted'),
    'rc_open', (select count(*) from app_private.dispatcher_bookings where status = 'rc_received')
  ) end;
$$;
revoke all on function public.cc_dispatchers_stats() from public, anon;
grant execute on function public.cc_dispatchers_stats() to authenticated, service_role;
