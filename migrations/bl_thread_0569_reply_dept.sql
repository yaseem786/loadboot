-- bl_thread_0569 — dispatcher thread: reply-to-message + LoadBoot department label
-- 1) A message can quote ("reply to") an earlier message in the same thread.
-- 2) Staff (Command Center) messages carry a department, shown to everyone as
--    "LoadBoot Support", "LoadBoot Compliance", … instead of a bare "LoadBoot".
-- Backward compatible: old 2-arg calls dispatcher_thread_send(p_assignment, p_body)
-- still work (new params default to null; staff default dept = support).

alter table app_private.dispatcher_messages
  add column if not exists reply_to uuid references app_private.dispatcher_messages(id) on delete set null,
  add column if not exists sender_dept text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'dispatcher_messages_sender_dept_chk') then
    alter table app_private.dispatcher_messages add constraint dispatcher_messages_sender_dept_chk
      check (sender_dept is null or sender_dept in ('support','dispatch_ops','compliance','billing','safety'));
  end if;
end $$;

create index if not exists dispatcher_messages_reply_to_idx
  on app_private.dispatcher_messages(reply_to) where reply_to is not null;

create or replace function app_private.disp_dept_label(p_dept text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case p_dept
    when 'support'      then 'LoadBoot Support'
    when 'dispatch_ops' then 'LoadBoot Dispatch Ops'
    when 'compliance'   then 'LoadBoot Compliance'
    when 'billing'      then 'LoadBoot Billing'
    when 'safety'       then 'LoadBoot Safety & Claims'
    else 'LoadBoot' end
$$;

drop function if exists public.dispatcher_thread_send(uuid, text);

create function public.dispatcher_thread_send(p_assignment uuid, p_body text, p_reply_to uuid default null, p_dept text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private', 'public'
as $function$
declare v_a record; v_role text; v_id uuid; v_owner uuid; v_from text; v_urgent boolean; v_dept text;
begin
  if coalesce(btrim(p_body),'') = '' then return jsonb_build_object('error','empty message'); end if;
  if length(p_body) > 4000 then return jsonb_build_object('error','message is longer than 4000 characters'); end if;
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null then return jsonb_build_object('error','not found'); end if;
  if v_a.status <> 'active' and not app_private.disp_is_staff() then return jsonb_build_object('error','this assignment is ' || v_a.status); end if;
  v_role := app_private.disp_role_for(v_a.carrier_org_id);
  if v_role is null then return jsonb_build_object('error','not authorized'); end if;
  if p_reply_to is not null and not exists (select 1 from app_private.dispatcher_messages where id = p_reply_to and assignment_id = p_assignment) then
    return jsonb_build_object('error','the message you replied to is not in this thread');
  end if;
  if v_role = 'staff' then
    v_dept := coalesce(nullif(btrim(p_dept),''), 'support');
    if v_dept not in ('support','dispatch_ops','compliance','billing','safety') then return jsonb_build_object('error','unknown department'); end if;
  end if;
  insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_user, sender_role, body, reply_to, sender_dept)
    values (p_assignment, v_a.carrier_org_id, auth.uid(), v_role, p_body, p_reply_to, v_dept) returning id into v_id;
  insert into app_private.dispatcher_thread_reads(assignment_id, user_id, read_at) values (p_assignment, auth.uid(), now()) on conflict (assignment_id, user_id) do update set read_at = now();
  select owner_user_id into v_owner from public.organizations where id = v_a.carrier_org_id;
  v_from := case v_role when 'dispatcher' then coalesce((select full_name from app_private.dispatcher_profiles where user_id = auth.uid()), 'your dispatcher') when 'staff' then app_private.disp_dept_label(v_dept) else 'the carrier' end;
  v_urgent := p_body ~* '(urgent|breakdown|accident|refus|cancel|detention|late|emergency|police|damage)';
  if v_role <> 'dispatcher' then
    perform app_private.disp_notify(v_a.dispatcher_user_id, 'dispatcher', 'dispatcher.thread', 'Message from ' || v_from, left(p_body, 300), '/app/agent/#dashboard', true);
  end if;
  if v_role <> 'carrier' and v_owner is not null then
    perform app_private.disp_notify(v_owner, 'carrier', 'dispatcher.thread', 'Message from ' || v_from, left(p_body, 300), '/app/carrier/', true);
  end if;
  if v_role <> 'staff' then
    perform app_private.disp_notify(null, 'staff', case when v_urgent then 'dispatcher.thread.exception' else 'dispatcher.thread' end,
      (case when v_urgent then 'URGENT thread message from ' else 'Thread: ' end) || v_from || ' · ' || (select name from public.organizations where id = v_a.carrier_org_id), left(p_body, 300), '/app/command-center/#dispatchers?assignment=' || p_assignment::text, v_urgent);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'role', v_role, 'dept', v_dept);
end $function$;

revoke all on function public.dispatcher_thread_send(uuid, text, uuid, text) from public, anon;
grant execute on function public.dispatcher_thread_send(uuid, text, uuid, text) to authenticated, service_role;

create or replace function app_private.disp_msg_by(p_role text, p_user uuid, p_dept text)
returns text language sql stable security definer set search_path = app_private, public as $$
  select case p_role
    when 'staff' then app_private.disp_dept_label(p_dept)
    when 'system' then 'LoadBoot'
    when 'dispatcher' then (select full_name from app_private.dispatcher_profiles where user_id = p_user)
    else (select coalesce(nullif(pr.contact_name,''), 'Carrier') from public.profiles pr where pr.id = p_user) end
$$;
revoke all on function app_private.disp_msg_by(text, uuid, text) from public, anon, authenticated;

create or replace function public.dispatcher_thread_list(p_assignment uuid, p_limit integer default 200)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'app_private', 'public'
as $function$
declare v_a record; v_role text;
begin
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null then return jsonb_build_object('error','not found'); end if;
  v_role := app_private.disp_role_for(v_a.carrier_org_id);
  if v_role is null then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object('role', v_role, 'status', v_a.status, 'participants', jsonb_build_object(
      'dispatcher', (select full_name from app_private.dispatcher_profiles where user_id = v_a.dispatcher_user_id),
      'carrier', (select coalesce(nullif(p.contact_name,''), o.name) from public.organizations o left join public.profiles p on p.id = o.owner_user_id where o.id = v_a.carrier_org_id),
      'staff', 'LoadBoot'),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'role', m.sender_role, 'body', m.body, 'at', m.created_at, 'mine', m.sender_user = auth.uid(),
      'dept', m.sender_dept,
      'by', app_private.disp_msg_by(m.sender_role, m.sender_user, m.sender_dept),
      'reply_to', case when q.id is null then null else jsonb_build_object('id', q.id, 'role', q.sender_role,
          'by', app_private.disp_msg_by(q.sender_role, q.sender_user, q.sender_dept), 'body', left(q.body, 160)) end
      ) order by m.created_at)
    from (select * from app_private.dispatcher_messages where assignment_id = p_assignment order by created_at desc limit p_limit) m
    left join app_private.dispatcher_messages q on q.id = m.reply_to), '[]'::jsonb));
end $function$;

