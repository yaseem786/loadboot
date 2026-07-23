-- bl_disp_0140 — DISPATCHER operational system: core schema + verification RPCs.
-- The SALARIED dispatcher is a NEW, distinct role from the referral 'agent'/referrer.
-- LoadBoot's Command Center hires, verifies and assigns dispatchers to carriers.
-- Additive & reversible: three new tables in app_private + SECURITY DEFINER RPCs.
-- Compliance posture (design doc): a dispatcher works PER-CARRIER as that carrier's
-- agent, never allocates freight across carriers, never touches freight money.
-- Applied to STAGING (snslhvmkjusozgjelghi) first; PROD only after owner + attorney sign-off.

-- ============================================================ TABLES
create table if not exists app_private.dispatcher_profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  phone         text,
  country       text,
  city          text,
  english_level text,                 -- self-declared / tested proficiency
  years_exp     integer,
  load_boards   jsonb   not null default '[]'::jsonb,   -- boards they can operate
  skills        jsonb   not null default '{}'::jsonb,   -- test scores: english/negotiation/loadboard/fmcsa/geography
  refs          jsonb   not null default '[]'::jsonb,   -- references
  background    text,                 -- background-check note/status
  trial         jsonb   not null default '{}'::jsonb,   -- paid-trial record
  currency      text    not null default 'PKR',
  base_salary   numeric not null default 0,
  per_truck     numeric not null default 0,
  status        text    not null default 'applied'
                 check (status in ('applied','screening','skills_test','trial','verified','active','suspended','rejected','withdrawn')),
  review_note   text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists app_private.dispatcher_assignments (
  id                 uuid primary key default gen_random_uuid(),
  dispatcher_user_id uuid not null references auth.users(id) on delete cascade,
  carrier_org_id     uuid not null references public.organizations(id) on delete cascade,
  status             text not null default 'active' check (status in ('active','paused','ended')),
  sop                jsonb not null default '{}'::jsonb,  -- lanes, min_rate, home_time, equipment, rules
  assigned_by        uuid,
  assigned_at        timestamptz not null default now(),
  ended_at           timestamptz,
  end_reason         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- A carrier gets ONE dedicated active dispatcher at a time (guaranteed-dedicated model).
create unique index if not exists dispatcher_assignments_one_active_per_carrier
  on app_private.dispatcher_assignments (carrier_org_id) where status = 'active';
create index if not exists dispatcher_assignments_by_dispatcher
  on app_private.dispatcher_assignments (dispatcher_user_id) where status = 'active';

create table if not exists app_private.dispatcher_salary_ledger (
  id                 uuid primary key default gen_random_uuid(),
  dispatcher_user_id uuid not null references auth.users(id) on delete cascade,
  period             date not null,                 -- first day of the month
  currency           text not null default 'PKR',
  base               numeric not null default 0,
  per_truck_rate     numeric not null default 0,
  active_trucks      integer not null default 0,
  per_truck_total    numeric not null default 0,
  performance_bonus  numeric not null default 0,
  total              numeric not null default 0,
  kpi                jsonb not null default '{}'::jsonb,   -- utilization/on_time/gross_per_truck/cancels/retention
  status             text not null default 'draft' check (status in ('draft','approved','paid')),
  note               text,
  approved_by        uuid,
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (dispatcher_user_id, period)
);

-- ============================================================ RLS
alter table app_private.dispatcher_profiles     enable row level security;
alter table app_private.dispatcher_assignments  enable row level security;
alter table app_private.dispatcher_salary_ledger enable row level security;

-- A dispatcher can see (and self-manage their application) their own rows.
-- All staff/CC access goes through SECURITY DEFINER RPCs (which bypass RLS).
drop policy if exists dp_self_sel on app_private.dispatcher_profiles;
create policy dp_self_sel on app_private.dispatcher_profiles for select using (user_id = auth.uid());
drop policy if exists dp_self_ins on app_private.dispatcher_profiles;
create policy dp_self_ins on app_private.dispatcher_profiles for insert with check (user_id = auth.uid());
drop policy if exists dp_self_upd on app_private.dispatcher_profiles;
create policy dp_self_upd on app_private.dispatcher_profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists da_self_sel on app_private.dispatcher_assignments;
create policy da_self_sel on app_private.dispatcher_assignments for select using (dispatcher_user_id = auth.uid());

drop policy if exists dsl_self_sel on app_private.dispatcher_salary_ledger;
create policy dsl_self_sel on app_private.dispatcher_salary_ledger for select using (dispatcher_user_id = auth.uid());

-- ============================================================ HELPER
create or replace function app_private.disp_is_staff()
returns boolean language sql stable security definer set search_path to 'app_private, public' as $$
  select public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage');
$$;

-- ============================================================ DISPATCHER-SIDE RPCs
-- Submit / save a dispatcher application. p_submit=true moves draft/applied -> screening
-- and notifies staff. Never blocks; upserts the caller's own row.
create or replace function public.dispatcher_apply(p jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_uid uuid := auth.uid(); v_status text; v_name text;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  insert into app_private.dispatcher_profiles as d (user_id, full_name, phone, country, city, english_level, years_exp, load_boards, skills, refs, status, updated_at)
  values (v_uid, p->>'full_name', p->>'phone', p->>'country', p->>'city', p->>'english_level',
          nullif(p->>'years_exp','')::int, coalesce(p->'load_boards','[]'::jsonb), coalesce(p->'skills','{}'::jsonb),
          coalesce(p->'refs','[]'::jsonb),
          case when p_submit then 'screening' else 'applied' end, now())
  on conflict (user_id) do update set
    full_name = coalesce(excluded.full_name, d.full_name),
    phone = coalesce(excluded.phone, d.phone),
    country = coalesce(excluded.country, d.country),
    city = coalesce(excluded.city, d.city),
    english_level = coalesce(excluded.english_level, d.english_level),
    years_exp = coalesce(excluded.years_exp, d.years_exp),
    load_boards = coalesce(excluded.load_boards, d.load_boards),
    skills = coalesce(excluded.skills, d.skills),
    refs = coalesce(excluded.refs, d.refs),
    status = case when p_submit and d.status in ('applied','withdrawn') then 'screening' else d.status end,
    updated_at = now()
  returning status, full_name into v_status, v_name;

  if p_submit then
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','dispatcher.applied',
        jsonb_build_object('user', v_uid, 'title', '🧑‍✈️ New dispatcher application',
          'body', coalesce(v_name,'A candidate') || ' applied to be a LoadBoot dispatcher. Open Dispatchers to screen.',
          'tone','info','url','/app/command-center/#/dispatchers'),
        'sent', now());
    exception when others then null; end;
    begin
      perform app_private.sys_email('hello@loadboot.com','dispatcher.applied',
        'LoadBoot Dispatcher — new application: ' || coalesce(v_name,'candidate'),
        '<p><b>' || coalesce(v_name,'A candidate') || '</b> applied to be a LoadBoot dispatcher. Open the Command Center → Dispatchers to screen.</p>',
        null, 'dispatchapply:'||v_uid::text||':'||to_char(now(),'YYYYMMDDHH24MI'));
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- Dispatcher's own status + assignments + latest salary.
create or replace function public.dispatcher_my_status()
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  select case when auth.uid() is null then jsonb_build_object('error','not signed in') else
    jsonb_build_object(
      'profile', (select to_jsonb(d) - 'reviewed_by' from app_private.dispatcher_profiles d where d.user_id = auth.uid()),
      'assignments', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'carrier_org_id', a.carrier_org_id,
          'carrier', (select name from public.organizations o where o.id = a.carrier_org_id),
          'status', a.status, 'sop', a.sop, 'assigned_at', a.assigned_at,
          'trucks', (select count(*) from app_private.fleet_trucks t where t.carrier_id = a.carrier_org_id)
        ) order by a.assigned_at desc)
        from app_private.dispatcher_assignments a where a.dispatcher_user_id = auth.uid() and a.status <> 'ended'), '[]'::jsonb),
      'salary', (select to_jsonb(s) from app_private.dispatcher_salary_ledger s where s.dispatcher_user_id = auth.uid() order by s.period desc limit 1)
    ) end;
$$;

-- ============================================================ CC (staff) RPCs
create or replace function public.cc_dispatchers_list()
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized')
    else coalesce(jsonb_agg(jsonb_build_object(
      'user_id', d.user_id, 'name', d.full_name, 'email', (select email from auth.users u where u.id = d.user_id),
      'country', d.country, 'status', d.status, 'years_exp', d.years_exp,
      'applied_at', d.created_at,
      'active_trucks', (select count(*) from app_private.dispatcher_assignments a
                          join app_private.fleet_trucks t on t.carrier_id = a.carrier_org_id
                          where a.dispatcher_user_id = d.user_id and a.status = 'active'),
      'carriers', (select count(*) from app_private.dispatcher_assignments a
                     where a.dispatcher_user_id = d.user_id and a.status = 'active')
    ) order by d.created_at desc), '[]'::jsonb) end
  from app_private.dispatcher_profiles d;
$$;

create or replace function public.cc_dispatcher_360(p_user uuid)
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  select case when not app_private.disp_is_staff() then jsonb_build_object('error','not authorized')
    else jsonb_build_object(
      'profile', (select to_jsonb(d) from app_private.dispatcher_profiles d where d.user_id = p_user),
      'email', (select email from auth.users u where u.id = p_user),
      'assignments', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'carrier_org_id', a.carrier_org_id,
          'carrier', (select name from public.organizations o where o.id = a.carrier_org_id),
          'status', a.status, 'sop', a.sop, 'assigned_at', a.assigned_at, 'ended_at', a.ended_at,
          'trucks', (select count(*) from app_private.fleet_trucks t where t.carrier_id = a.carrier_org_id)
        ) order by a.assigned_at desc)
        from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_user), '[]'::jsonb),
      'salary', coalesce((select jsonb_agg(to_jsonb(s) order by s.period desc)
        from app_private.dispatcher_salary_ledger s where s.dispatcher_user_id = p_user), '[]'::jsonb)
    ) end;
$$;

-- Move a dispatcher through the pipeline: screening/skills_test/trial/verified/active/reject/suspend/reinstate.
create or replace function public.cc_dispatcher_decide(p_user uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_new text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  v_new := case p_action
    when 'screening'   then 'screening'
    when 'skills_test' then 'skills_test'
    when 'trial'       then 'trial'
    when 'verify'      then 'verified'
    when 'activate'    then 'active'
    when 'reject'      then 'rejected'
    when 'suspend'     then 'suspended'
    when 'reinstate'   then 'verified'
    else null end;
  if v_new is null then return jsonb_build_object('error','bad action'); end if;
  update app_private.dispatcher_profiles
     set status = v_new, review_note = coalesce(p_note, review_note), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where user_id = p_user;
  return jsonb_build_object('ok', true, 'status', v_new);
end $$;

grant execute on function public.dispatcher_apply(jsonb, boolean) to authenticated;
grant execute on function public.dispatcher_my_status() to authenticated;
grant execute on function public.cc_dispatchers_list() to authenticated;
grant execute on function public.cc_dispatcher_360(uuid) to authenticated;
grant execute on function public.cc_dispatcher_decide(uuid, text, text) to authenticated;
