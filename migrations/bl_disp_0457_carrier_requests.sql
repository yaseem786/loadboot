-- bl_disp_0457 — CC "Carrier requests" queue: every carrier-side pause / resume / change-dispatcher request in ONE place,
-- with Keep / Reassign / Resume / Dismiss. Additive: new table, a trigger on audit_logs (the carrier functions already
-- audit these actions — carrier_dispatcher_change_request → 'dispatcher.change_requested', carrier_dispatcher_pause →
-- 'dispatcher.carrier_pause'), a backfill, and 2 staff RPCs. No existing function is touched.

create table if not exists app_private.dispatcher_carrier_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  carrier_org_id uuid,
  dispatcher_user_id uuid,
  kind text not null check (kind in ('change','pause')),
  reason text,
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text check (resolution in ('kept','reassigned','resumed','dismissed','carrier_resumed')),
  note text,
  audit_id bigint unique,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
alter table app_private.dispatcher_carrier_requests enable row level security;
create index if not exists dispatcher_carrier_requests_open on app_private.dispatcher_carrier_requests (created_at desc) where status = 'open';

-- one row per carrier action, derived from the audit row the carrier functions already write
create or replace function app_private.dispatcher_carrier_requests_from_audit() returns trigger language plpgsql as $$
declare a app_private.dispatcher_assignments; v_kind text; v_reason text;
begin
  if new.action not in ('dispatcher.change_requested','dispatcher.carrier_pause') then return new; end if;
  select * into a from app_private.dispatcher_assignments where id::text = new.target_id;
  if a.id is null then return new; end if;
  if new.action = 'dispatcher.change_requested' then
    v_kind := 'change'; v_reason := new.summary;
  elsif new.summary like 'resumed%' then
    -- carrier resumed it themselves: close the open pause request, no new row
    update app_private.dispatcher_carrier_requests set status = 'resolved', resolution = 'carrier_resumed', resolved_at = now()
      where assignment_id = a.id and kind = 'pause' and status = 'open';
    return new;
  else
    v_kind := 'pause'; v_reason := nullif(regexp_replace(new.summary, '^paused:?\s*', ''), '');
  end if;
  insert into app_private.dispatcher_carrier_requests (assignment_id, carrier_org_id, dispatcher_user_id, kind, reason, audit_id, created_at)
  values (a.id, a.carrier_org_id, a.dispatcher_user_id, v_kind, v_reason, new.id, new.occurred_at)
  on conflict (audit_id) do nothing;
  return new;
end $$;
drop trigger if exists dispatcher_carrier_requests_from_audit on app_private.audit_logs;
create trigger dispatcher_carrier_requests_from_audit after insert on app_private.audit_logs
  for each row execute function app_private.dispatcher_carrier_requests_from_audit();

-- backfill the last 60 days (idempotent via audit_id)
insert into app_private.dispatcher_carrier_requests (assignment_id, carrier_org_id, dispatcher_user_id, kind, reason, audit_id, created_at)
select a.id, a.carrier_org_id, a.dispatcher_user_id,
       case when l.action = 'dispatcher.change_requested' then 'change' else 'pause' end,
       case when l.action = 'dispatcher.change_requested' then l.summary else nullif(regexp_replace(l.summary, '^paused:?\s*', ''), '') end,
       l.id, l.occurred_at
  from app_private.audit_logs l join app_private.dispatcher_assignments a on a.id::text = l.target_id
 where l.occurred_at > now() - interval '60 days'
   and (l.action = 'dispatcher.change_requested' or (l.action = 'dispatcher.carrier_pause' and l.summary not like 'resumed%'))
on conflict (audit_id) do nothing;
-- a pause the carrier already lifted, or an assignment that already ended, is not open
update app_private.dispatcher_carrier_requests r set status = 'resolved', resolution = case when a.status = 'active' then 'carrier_resumed' else 'dismissed' end, resolved_at = coalesce(a.ended_at, a.updated_at, now())
  from app_private.dispatcher_assignments a
 where a.id = r.assignment_id and r.status = 'open' and r.kind = 'pause' and a.status <> 'paused';
update app_private.dispatcher_carrier_requests r set status = 'resolved', resolution = 'reassigned', resolved_at = coalesce(a.ended_at, a.updated_at, now())
  from app_private.dispatcher_assignments a
 where a.id = r.assignment_id and r.status = 'open' and a.status not in ('active','paused');

-- list: open first, then the last 30 resolved
create or replace function public.cc_dispatcher_requests() returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object(
    'open', coalesce((select jsonb_agg(x order by x->>'created_at') from (
        select jsonb_build_object('id', r.id, 'kind', r.kind, 'reason', r.reason, 'created_at', r.created_at, 'status', r.status,
          'assignment_id', r.assignment_id, 'assignment_status', a.status, 'assigned_at', a.assigned_at,
          'carrier_org_id', r.carrier_org_id, 'carrier', o.name, 'dispatcher_user_id', r.dispatcher_user_id, 'dispatcher', d.full_name, 'dispatcher_status', d.status,
          'thread', (select jsonb_agg(jsonb_build_object('at', m.created_at, 'role', m.sender_role, 'body', m.body) order by m.created_at desc)
                       from (select * from app_private.dispatcher_messages m where m.assignment_id = r.assignment_id order by m.created_at desc limit 5) m)) x
          from app_private.dispatcher_carrier_requests r
          join app_private.dispatcher_assignments a on a.id = r.assignment_id
          left join public.organizations o on o.id = r.carrier_org_id
          left join app_private.dispatcher_profiles d on d.user_id = r.dispatcher_user_id
         where r.status = 'open') q), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', r.id, 'kind', r.kind, 'reason', r.reason, 'created_at', r.created_at, 'resolution', r.resolution, 'note', r.note,
          'resolved_at', r.resolved_at, 'carrier', o.name, 'dispatcher', d.full_name) x
          from app_private.dispatcher_carrier_requests r
          left join public.organizations o on o.id = r.carrier_org_id
          left join app_private.dispatcher_profiles d on d.user_id = r.dispatcher_user_id
         where r.status = 'resolved' order by r.resolved_at desc nulls last limit 30) q), '[]'::jsonb));
end $$;

-- resolve: keep (dispatcher stays; carrier + dispatcher told in-app) · resume (staff lifts a carrier pause) ·
--          reassign (cc_dispatcher_unassign → its own carrier/dispatcher e-mails; the carrier reopens in Choose-your-carrier) · dismiss
create or replace function public.cc_dispatcher_request_resolve(p_id uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare r app_private.dispatcher_carrier_requests; a app_private.dispatcher_assignments; v_owner uuid; v_cname text; v_dname text; v_res text; x jsonb;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into r from app_private.dispatcher_carrier_requests where id = p_id;
  if r.id is null then return jsonb_build_object('error','request not found'); end if;
  if r.status <> 'open' then return jsonb_build_object('error','already resolved'); end if;
  select * into a from app_private.dispatcher_assignments where id = r.assignment_id;
  select name, owner_user_id into v_cname, v_owner from public.organizations where id = r.carrier_org_id;
  select full_name into v_dname from app_private.dispatcher_profiles where user_id = r.dispatcher_user_id;
  if p_action = 'keep' then
    v_res := 'kept';
    if v_owner is not null then
      perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.request.kept', 'LoadBoot reviewed your dispatcher request',
        coalesce(nullif(btrim(p_note),''), 'We looked into it and ' || coalesce(v_dname,'your dispatcher') || ' stays on your account. Reply in your Dispatcher tab if anything else comes up.'),
        '/app/carrier/#dispatcher', true);
    end if;
    perform app_private.disp_notify(r.dispatcher_user_id, 'dispatcher', 'dispatcher.request.kept', coalesce(v_cname,'The carrier') || ' raised a concern — you stay assigned',
      'LoadBoot reviewed it. ' || coalesce(nullif(btrim(p_note),''), 'Fix what they raised and keep the carrier updated before they have to ask.'), '/app/agent/#dashboard', true);
  elsif p_action = 'resume' then
    if a.status <> 'paused' then return jsonb_build_object('error','the assignment is not paused'); end if;
    update app_private.dispatcher_assignments set status = 'active', updated_at = now() where id = a.id;
    insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_user, sender_role, body)
      values (a.id, a.carrier_org_id, auth.uid(), 'system', 'LoadBoot resumed the dispatcher assignment' || coalesce(': ' || nullif(btrim(p_note),''), '.'));
    perform app_private.disp_notify(r.dispatcher_user_id, 'dispatcher', 'dispatcher.resumed_by_staff', 'Assignment resumed — ' || coalesce(v_cname,'carrier'), coalesce(nullif(btrim(p_note),''), 'Back to normal service.'), '/app/agent/#dashboard', true);
    if v_owner is not null then
      perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.resumed_by_staff', 'Your dispatcher assignment is active again', coalesce(nullif(btrim(p_note),''), coalesce(v_dname,'Your dispatcher') || ' is back on your account.'), '/app/carrier/#dispatcher', true);
    end if;
    v_res := 'resumed';
  elsif p_action = 'reassign' then
    if a.status not in ('active','paused') then return jsonb_build_object('error','the assignment already ended'); end if;
    x := public.cc_dispatcher_unassign(a.id, 'carrier request: ' || coalesce(nullif(btrim(p_note),''), coalesce(r.reason,'change requested')), false);
    if x ? 'error' then return x; end if;
    v_res := 'reassigned';
  elsif p_action = 'dismiss' then
    v_res := 'dismissed';
  else
    return jsonb_build_object('error','action must be keep, resume, reassign or dismiss');
  end if;
  update app_private.dispatcher_carrier_requests set status = 'resolved', resolution = v_res, note = nullif(btrim(p_note),''), resolved_at = now(), resolved_by = auth.uid() where id = p_id;
  -- one decision closes every open request on the same assignment
  update app_private.dispatcher_carrier_requests set status = 'resolved', resolution = v_res, resolved_at = now(), resolved_by = auth.uid() where assignment_id = r.assignment_id and status = 'open';
  perform app_private.disp_audit('dispatcher.request.' || v_res, 'assignment', r.assignment_id::text, r.carrier_org_id, coalesce(v_cname,'carrier') || ' / ' || coalesce(v_dname,'dispatcher') || ': ' || r.kind || ' → ' || v_res, jsonb_build_object('request_id', p_id, 'note', p_note));
  return jsonb_build_object('ok', true, 'resolution', v_res);
end $$;

-- email catalog rows (CLAUDE.md §6): both are fired through app_private.disp_notify(..., p_email => true) from cc_dispatcher_request_resolve
insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition, preference_group, unsub_allowed, cc_deep_link, status)
values
 ('dispatcher.request.kept', 'Dispatcher request reviewed — kept', 'Tells the carrier (and the dispatcher) that LoadBoot reviewed a pause / change request and the dispatcher stays assigned.', 'T', 'carrier', 'event', 'public.cc_dispatcher_request_resolve (keep)', 'once per request', 'once per request', null, 'account_critical', false, '#/dispatchers', 'live'),
 ('dispatcher.resumed_by_staff', 'Assignment resumed by LoadBoot', 'Tells the carrier and the dispatcher that LoadBoot lifted a carrier pause on the assignment.', 'T', 'carrier', 'event', 'public.cc_dispatcher_request_resolve (resume)', 'once per request', 'once per request', null, 'account_critical', false, '#/dispatchers', 'live')
on conflict (key) do nothing;

do $$
declare f text;
begin
  foreach f in array array['public.cc_dispatcher_requests()','public.cc_dispatcher_request_resolve(uuid,text,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
