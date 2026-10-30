-- bl_mail_0578 — cc_mail_list learns the phase-2 work views (bl_mail_0577)
-- New argument p_view: 'needs_reply' | 'mine' | 'late' | 'waiting' | 'done' (NULL = the old folder behaviour, unchanged).
-- needs_reply / mine / late are sorted by reply deadline (soonest first) — the Amazon queue order — and return up to 200.
-- Every row also carries owner, status, deadline, escalation level, follow-up flag and "someone else is reading this".
drop function if exists public.cc_mail_list(integer, text, text, timestamptz, text, text);

create or replace function public.cc_mail_list(p_limit integer default 50, p_mailbox text default null, p_search text default null,
  p_before timestamptz default null, p_folder text default 'inbox', p_role text default null, p_view text default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare
  v_limit  int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_q      text := nullif(btrim(coalesce(p_search, '')), '');
  v_box    text := nullif(lower(btrim(coalesce(p_mailbox, ''))), '');
  v_role   text := nullif(lower(btrim(coalesce(p_role, ''))), '');
  v_view   text := case when p_view in ('needs_reply','mine','late','waiting','done') then p_view end;
  v_folder text := case when v_view is not null then 'all'
                        when p_folder in ('inbox', 'system', 'all', 'starred', 'snoozed', 'sent', 'drafts', 'trash', 'urgent') then p_folder else 'inbox' end;
  v_due_sort boolean := v_view in ('needs_reply','mine','late');
  v_vis    text[];
  v_rows   jsonb;
  v_next   timestamptz;
  v_total  int;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_vis := app_private.mail_visible_boxes();
  if v_due_sort then v_limit := 200; end if;

  with hidden as (
    select distinct h.thread_key from app_private.mail_messages h
     where not (coalesce(lower(h.mailbox), 'hello@loadboot.com') = any(v_vis))
  ), latest as (
    select distinct on (m.thread_key) m.*
      from app_private.mail_messages m
     where (v_box is null or coalesce(lower(m.mailbox), 'hello@loadboot.com') = v_box)
       and (v_folder not in ('inbox', 'system', 'urgent') or m.folder = case when v_folder = 'urgent' then 'inbox' else v_folder end)
       and not exists (select 1 from hidden x where x.thread_key = m.thread_key)
     order by m.thread_key, m.created_at desc
  ), filtered as (
    select l.*, s.starred_at, s.snoozed_until, s.archived_at, s.trashed_at,
           s.owner_user_id, s.work_status, s.reply_due_at, s.sla_level, s.follow_up, s.viewing_by, s.viewing_at,
           s.urgency as s_urg, s.urgency_reason as s_reason,
           (select max(i.created_at) from app_private.mail_messages i where i.thread_key = l.thread_key and i.direction = 'in') as last_in_at,
           (select i.sender_role from app_private.mail_messages i where i.thread_key = l.thread_key and i.direction = 'in' order by i.created_at desc limit 1) as t_role,
           (select i.sender_org_id from app_private.mail_messages i where i.thread_key = l.thread_key and i.sender_org_id is not null order by i.created_at desc limit 1) as t_org,
           (select i.urgency from app_private.mail_messages i where i.thread_key = l.thread_key and i.direction = 'in' order by i.created_at desc limit 1) as t_urgency,
           (select i.urgency_reason from app_private.mail_messages i where i.thread_key = l.thread_key and i.direction = 'in' order by i.created_at desc limit 1) as t_reason
      from latest l
      left join app_private.mail_thread_state s on s.thread_key = l.thread_key
     where (v_q is null or exists (select 1 from app_private.mail_messages q
                     where q.thread_key = l.thread_key
                       and (q.subject ilike '%' || v_q || '%' or q.peer_email ilike '%' || v_q || '%'
                            or q.peer_name ilike '%' || v_q || '%' or q.body_text ilike '%' || v_q || '%')))
  ), foldered as (
    select f.* from filtered f
     where (v_role is null or coalesce(f.t_role, 'unknown') = v_role)
       and case
       when v_view is not null then f.trashed_at is null and case v_view
         when 'needs_reply' then f.work_status = 'open' and (f.snoozed_until is null or f.snoozed_until <= now())
         when 'mine'        then f.work_status = 'open' and f.owner_user_id = auth.uid() and (f.snoozed_until is null or f.snoozed_until <= now())
         when 'late'        then f.work_status = 'open' and f.sla_level >= 2 and (f.snoozed_until is null or f.snoozed_until <= now())
         when 'waiting'     then f.work_status = 'waiting'
         when 'done'        then f.work_status = 'done'
         else false end
       when v_folder = 'trash'  then f.trashed_at is not null
       when v_folder = 'drafts' then exists (select 1 from app_private.mail_messages d where d.thread_key = f.thread_key and d.status = 'draft')
       else f.trashed_at is null and case v_folder
         when 'inbox'   then f.last_in_at is not null
                         and (f.snoozed_until is null or f.snoozed_until <= now())
                         and (f.archived_at is null or f.last_in_at > f.archived_at)
         when 'urgent'  then f.last_in_at is not null and coalesce(f.s_urg, f.t_urgency) = 'urgent'
                         and (f.snoozed_until is null or f.snoozed_until <= now())
                         and (f.archived_at is null or f.last_in_at > f.archived_at)
         when 'starred' then f.starred_at is not null
         when 'snoozed' then f.snoozed_until > now()
         when 'sent'    then exists (select 1 from app_private.mail_messages o where o.thread_key = f.thread_key and o.status = 'sent')
         else true
       end
     end
  ), page as (
    select * from foldered
     where (v_due_sort or p_before is null or created_at < p_before)
     order by case when v_due_sort then reply_due_at end asc nulls last, created_at desc
     limit v_limit
  )
  select (select count(*) from foldered),
         (select jsonb_agg(t order by case when v_due_sort then (t->>'reply_due_at') end asc nulls last, (t->>'last_at') desc) from page p cross join lateral (
            select jsonb_build_object(
              'thread_key', p.thread_key, 'mailbox', p.mailbox, 'folder', p.folder, 'mail_class', p.mail_class,
              'peer_email', p.peer_email, 'peer_name', p.peer_name, 'subject', p.subject,
              'preview', left(coalesce(p.body_text, ''), 160), 'direction', p.direction, 'status', p.status, 'last_at', p.created_at,
              'unread', (select count(*) from app_private.mail_messages u where u.thread_key = p.thread_key and u.direction = 'in' and u.read_at is null),
              'msg_count', (select count(*) from app_private.mail_messages c where c.thread_key = p.thread_key),
              'has_draft', exists (select 1 from app_private.mail_messages d where d.thread_key = p.thread_key and d.status = 'draft'),
              'has_sent', exists (select 1 from app_private.mail_messages o where o.thread_key = p.thread_key and o.status = 'sent'),
              'has_in', p.last_in_at is not null,
              'starred', p.starred_at is not null,
              'snoozed_until', case when p.snoozed_until > now() then p.snoozed_until end,
              'archived', p.archived_at is not null and (p.last_in_at is null or p.last_in_at <= p.archived_at),
              'trashed', p.trashed_at is not null,
              'sender_role', coalesce(p.t_role, p.sender_role, 'unknown'),
              'org_id', p.t_org,
              'org_name', (select o.name from public.organizations o where o.id = p.t_org),
              'urgency', coalesce(p.s_urg, p.t_urgency),
              'urgency_reason', coalesce(p.s_reason, p.t_reason),
              'work_status', p.work_status,
              'owner_id', p.owner_user_id,
              'owner_name', (select coalesce(nullif(u.raw_user_meta_data->>'full_name',''), u.email) from auth.users u where u.id = p.owner_user_id),
              'reply_due_at', case when p.work_status = 'open' then p.reply_due_at end,
              'sla_level', case when p.work_status = 'open' then p.sla_level else 0 end,
              'follow_up', coalesce(p.follow_up, false),
              'viewing', case when p.viewing_by is not null and p.viewing_by <> auth.uid() and p.viewing_at > now() - interval '90 seconds'
                              then (select coalesce(nullif(u.raw_user_meta_data->>'full_name',''), u.email) from auth.users u where u.id = p.viewing_by) end
            ) as t) x),
         (select min(created_at) from page)
    into v_total, v_rows, v_next;

  return jsonb_build_object(
    'threads', coalesce(v_rows, '[]'::jsonb), 'folder', v_folder, 'view', v_view, 'mailbox', v_box, 'role', v_role,
    'total', coalesce(v_total, 0),
    'next_before', case when v_due_sort or jsonb_array_length(coalesce(v_rows, '[]'::jsonb)) < v_limit then null else v_next end
  );
end;
$function$;
grant execute on function public.cc_mail_list(integer, text, text, timestamptz, text, text, text) to authenticated;
revoke all on function public.cc_mail_list(integer, text, text, timestamptz, text, text, text), public.cc_mail_owners(), public.cc_mail_assign(text[], uuid),
  public.cc_mail_set_status(text[], text), public.cc_mail_viewing(text), public.cc_mail_work_counts() from public, anon;
grant execute on function public.cc_mail_owners(), public.cc_mail_assign(text[], uuid), public.cc_mail_set_status(text[], text),
  public.cc_mail_viewing(text), public.cc_mail_work_counts() to authenticated;
