-- bl_mail_0488_gmail_mailbox.sql
-- CC Mailbox becomes a Gmail-style client (owner ask, 28 Sep 2026: "same to same Gmail").
-- Additive. No existing row changes meaning; every old RPC keeps its signature and output keys.
--
-- WHAT GMAIL HAS THAT THE MAILBOX DID NOT, and how each lands here:
--
--   Star / Snooze / Archive / Trash  → app_private.mail_thread_state (one row per thread, created on
--                                      first action). Mail rows are never deleted — Trash only hides.
--                                      Archive follows Gmail: a NEW inbound message brings the thread
--                                      back to the Inbox. Snooze follows Gmail: it comes back by itself
--                                      when the time passes (list-time filter, no cron).
--   Folders                          → cc_mail_list p_folder gains starred | snoozed | sent | drafts | trash.
--                                      inbox / system / all keep their bl_mail_0471 meaning, minus
--                                      trashed, snoozed and archived threads.
--   Rail counts                      → cc_mail_stats gains a 'folders' object. Old keys unchanged.
--   Bulk actions (checkboxes)        → cc_mail_thread_action(threads[], action, until).
--   New message (Compose)            → cc_mail_compose_save: a DRAFT to any address. Still drafts only;
--                                      cc_mail_send (comm.manage + confirm) is the only thing that sends.
--
-- EMAIL LAW (CLAUDE.md §6):
--   * A reply to someone who wrote to us stays mail.reply (account_critical — they asked us).
--   * A NEW message is not an answer to anyone, so it gets its own catalog keys (mail.compose,
--     dispatch.mail.compose, billing.mail.compose) in preference groups that honour opt-outs.
--   * sys_email refuses an unsubscribed address SILENTLY (returns void). cc_mail_send used to then mark
--     the draft 'sent' anyway. It now asks app_private.email_gate first and raises the gate's reason
--     sentence, so the composer shows it and the draft stays a draft (§6.5: never look for another route).
--
-- PERMISSIONS (server is the gate; the UI only hides):
--   read / unread / star / unstar       comm.view   (same as cc_mail_mark)
--   archive / snooze / move to inbox    comm.send
--   trash / untrash                     comm.manage (same as cc_mail_set_folder), audited
--   compose draft                       comm.send;  send stays comm.manage
--
-- ANON SURFACE: two new public SECURITY DEFINER functions, both revoked from public + anon explicitly
-- (Supabase's default ACL hands anon EXECUTE otherwise). Baseline stays 36 prod / 35 staging.
--
-- ROLLBACK: at the end of the file.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Thread state
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists app_private.mail_thread_state (
  thread_key    text primary key,
  starred_at    timestamptz,
  snoozed_until timestamptz,
  archived_at   timestamptz,
  trashed_at    timestamptz,
  updated_by    uuid,
  updated_at    timestamptz not null default now()
);
alter table app_private.mail_thread_state enable row level security;
revoke all on table app_private.mail_thread_state from public, anon, authenticated;

comment on table app_private.mail_thread_state is
  'Gmail-style per-thread state for the CC Mailbox (bl_mail_0488). Shared by all staff: the mailbox is a team inbox. Trash hides, never deletes.';

create index if not exists idx_mail_thread_state_starred on app_private.mail_thread_state (thread_key) where starred_at is not null;
create index if not exists idx_mail_thread_state_trashed on app_private.mail_thread_state (thread_key) where trashed_at is not null;
create index if not exists idx_mail_thread_created on app_private.mail_messages (thread_key, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Catalog rows for NEW messages (email law §6 — registered in the same migration as the sender)
-- ─────────────────────────────────────────────────────────────────────────────

insert into app_private.email_catalog
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
   stop_condition, preference_group, unsub_allowed, cc_deep_link, status)
values
  ('mail.compose', 'Mailbox new message',
   'A new message a staff member writes in the CC Mailbox (Compose) — not a reply. Sent from hello@.',
   'O', 'any', 'manual', 'public.cc_mail_send', 'per message', 'one per human Send press',
   'recipient opted out of load_ops, or is suppressed', 'load_ops', true, '#/mailbox?folder=sent', 'live'),
  ('dispatch.mail.compose', 'Dispatch mailbox new message',
   'A new message written in the CC Mailbox with From = dispatch@ — not a reply.',
   'O', 'any', 'manual', 'public.cc_mail_send', 'per message', 'one per human Send press',
   'recipient opted out of load_ops, or is suppressed', 'load_ops', true, '#/mailbox?folder=sent', 'live'),
  ('billing.mail.compose', 'Billing mailbox new message',
   'A new message written in the CC Mailbox with From = billing@ — not a reply. Opt-out-able like billing reminders.',
   'O', 'any', 'manual', 'public.cc_mail_send', 'per message', 'one per human Send press',
   'recipient opted out of billing reminders, or is suppressed', 'billing', true, '#/mailbox?folder=sent', 'live')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. cc_mail_list — Gmail folders. Same signature as bl_mail_0471; new output keys only.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_list(
  p_limit   integer     default 50,
  p_mailbox text        default null,
  p_search  text        default null,
  p_before  timestamptz default null,
  p_folder  text        default 'inbox'
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare
  v_limit  int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_q      text := nullif(btrim(coalesce(p_search, '')), '');
  v_folder text := case when p_folder in ('inbox', 'system', 'all', 'starred', 'snoozed', 'sent', 'drafts', 'trash')
                        then p_folder else 'inbox' end;
  v_rows   jsonb;
  v_next   timestamptz;
  v_total  int;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with latest as (
    -- inbox / system keep 0471's meaning: the newest message that sits in that folder.
    select distinct on (m.thread_key) m.*
      from app_private.mail_messages m
     where (p_mailbox is null or m.mailbox = p_mailbox)
       and (v_folder not in ('inbox', 'system') or m.folder = v_folder)
     order by m.thread_key, m.created_at desc
  ), filtered as (
    select l.*, s.starred_at, s.snoozed_until, s.archived_at, s.trashed_at,
           (select max(i.created_at) from app_private.mail_messages i
             where i.thread_key = l.thread_key and i.direction = 'in') as last_in_at
      from latest l
      left join app_private.mail_thread_state s on s.thread_key = l.thread_key
     where (
         v_q is null
         or exists (select 1 from app_private.mail_messages q
                     where q.thread_key = l.thread_key
                       and (q.subject ilike '%' || v_q || '%'
                            or q.peer_email ilike '%' || v_q || '%'
                            or q.peer_name  ilike '%' || v_q || '%'
                            or q.body_text  ilike '%' || v_q || '%'))
       )
  ), foldered as (
    select f.* from filtered f
     where case v_folder
       when 'trash'   then f.trashed_at is not null
       when 'drafts'  then exists (select 1 from app_private.mail_messages d where d.thread_key = f.thread_key and d.status = 'draft')
       else f.trashed_at is null and case v_folder
         when 'inbox'   then f.last_in_at is not null
                         and (f.snoozed_until is null or f.snoozed_until <= now())
                         and (f.archived_at is null or f.last_in_at > f.archived_at)
         when 'starred' then f.starred_at is not null
         when 'snoozed' then f.snoozed_until > now()
         when 'sent'    then exists (select 1 from app_private.mail_messages o where o.thread_key = f.thread_key and o.status = 'sent')
         else true      -- system, all
       end
     end
  ), page as (
    select * from foldered
     where (p_before is null or created_at < p_before)
     order by created_at desc
     limit v_limit
  )
  select (select count(*) from foldered),
         (select jsonb_agg(t order by (t->>'last_at') desc) from page p cross join lateral (
            select jsonb_build_object(
              'thread_key', p.thread_key,
              'mailbox',    p.mailbox,
              'folder',     p.folder,
              'mail_class', p.mail_class,
              'peer_email', p.peer_email,
              'peer_name',  p.peer_name,
              'subject',    p.subject,
              'preview',    left(coalesce(p.body_text, ''), 160),
              'direction',  p.direction,
              'status',     p.status,
              'last_at',    p.created_at,
              'unread',     (select count(*) from app_private.mail_messages u
                              where u.thread_key = p.thread_key and u.direction = 'in' and u.read_at is null),
              'msg_count',  (select count(*) from app_private.mail_messages c
                              where c.thread_key = p.thread_key),
              'has_draft',  exists (select 1 from app_private.mail_messages d
                                     where d.thread_key = p.thread_key and d.status = 'draft'),
              'has_sent',   exists (select 1 from app_private.mail_messages o
                                     where o.thread_key = p.thread_key and o.status = 'sent'),
              'has_in',     p.last_in_at is not null,
              'starred',    p.starred_at is not null,
              'snoozed_until', case when p.snoozed_until > now() then p.snoozed_until end,
              'archived',   p.archived_at is not null and (p.last_in_at is null or p.last_in_at <= p.archived_at),
              'trashed',    p.trashed_at is not null
            ) as t) x),
         (select min(created_at) from page)
    into v_total, v_rows, v_next;

  return jsonb_build_object(
    'threads', coalesce(v_rows, '[]'::jsonb),
    'folder', v_folder,
    'total', coalesce(v_total, 0),
    'next_before', case when jsonb_array_length(coalesce(v_rows, '[]'::jsonb)) < v_limit then null else v_next end
  );
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. cc_mail_thread — each message also carries the thread's state (deep links have no list row).
--    Additive keys only; the array shape callers depend on is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_thread(p_thread text, p_mark_read boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare j jsonb; s record;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(p_mark_read, true) then
    update app_private.mail_messages
       set read_at = now()
     where thread_key = p_thread and direction = 'in' and read_at is null;
  end if;
  select * into s from app_private.mail_thread_state where thread_key = p_thread;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'direction', direction, 'mailbox', mailbox,
           'folder', folder, 'mail_class', mail_class, 'envelope_from', envelope_from,
           'peer_email', peer_email, 'peer_name', peer_name, 'subject', subject,
           'body_text', body_text, 'body_html', body_html,
           'status', status, 'attachments', attachments,
           'sent_at', sent_at, 'send_error', send_error,
           'read_at', read_at,
           'created_at', created_at,
           'starred', s.starred_at is not null,
           'snoozed_until', case when s.snoozed_until > now() then s.snoozed_until end,
           'archived', s.archived_at is not null,
           'trashed', s.trashed_at is not null) order by created_at), '[]'::jsonb)
    into j
    from app_private.mail_messages
   where thread_key = p_thread;
  return j;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. cc_mail_thread_action — every Gmail toolbar button, single or bulk
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_thread_action(
  p_threads text[],
  p_action  text,
  p_until   timestamptz default null
) returns integer
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  v_keys text[];
  v_n    int := 0;
  v_perm text;
begin
  v_keys := array(select distinct k from unnest(coalesce(p_threads, '{}'::text[])) k where coalesce(btrim(k), '') <> '');
  if cardinality(v_keys) = 0 then return 0; end if;
  if cardinality(v_keys) > 200 then
    raise exception 'at most 200 conversations per action' using errcode = '22023';
  end if;

  v_perm := case
    when p_action in ('read', 'unread', 'star', 'unstar')               then 'comm.view'
    when p_action in ('archive', 'unarchive', 'snooze', 'unsnooze')     then 'comm.send'
    when p_action in ('trash', 'untrash')                               then 'comm.manage'
  end;
  if v_perm is null then
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;
  if not public.has_global_permission(v_perm) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_action in ('read', 'unread') then
    update app_private.mail_messages
       set read_at = case when p_action = 'read' then now() else null end
     where thread_key = any(v_keys)
       and direction = 'in'
       and (read_at is null) = (p_action = 'read');
    get diagnostics v_n = row_count;
    return v_n;
  end if;

  if p_action = 'snooze' and (p_until is null or p_until <= now() or p_until > now() + interval '1 year') then
    raise exception 'snooze needs a time in the next 12 months' using errcode = '22023';
  end if;

  -- Only threads that exist. A made-up key never creates a state row.
  insert into app_private.mail_thread_state as s (thread_key, updated_by, updated_at)
  select distinct m.thread_key, auth.uid(), now()
    from app_private.mail_messages m
   where m.thread_key = any(v_keys)
  on conflict (thread_key) do nothing;

  update app_private.mail_thread_state s
     set starred_at    = case p_action when 'star' then coalesce(s.starred_at, now()) when 'unstar' then null else s.starred_at end,
         snoozed_until = case p_action when 'snooze' then p_until when 'unsnooze' then null
                                       when 'archive' then null when 'trash' then null else s.snoozed_until end,
         archived_at   = case p_action when 'archive' then now() when 'unarchive' then null
                                       when 'snooze' then null else s.archived_at end,
         trashed_at    = case p_action when 'trash' then coalesce(s.trashed_at, now()) when 'untrash' then null
                                       else s.trashed_at end,
         updated_by    = auth.uid(),
         updated_at    = now()
   where s.thread_key = any(v_keys);
  get diagnostics v_n = row_count;

  if p_action in ('archive', 'unarchive', 'snooze', 'unsnooze', 'trash', 'untrash') and v_n > 0 then
    perform app_private.log_audit(
      'comm.mail_' || p_action, 'mail_thread', v_keys[1], null,
      p_action || ' ' || v_n || ' conversation(s)',
      jsonb_build_object('threads', to_jsonb(v_keys), 'until', p_until), null);
  end if;

  return v_n;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. cc_mail_compose_save — a NEW message, saved as a draft. Never sends.
--    thread_key uses cc_mail_ingest's formula (peer:subject without Re:/Fwd:), so when the person
--    answers with the same subject the reply lands in the same conversation, like Gmail.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_compose_save(
  p_from      text,
  p_to        text,
  p_subject   text,
  p_body_html text,
  p_draft_id  uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  v_from text := lower(btrim(coalesce(p_from, '')));
  v_to   text := lower(btrim(coalesce(p_to, '')));
  v_subj text := nullif(btrim(coalesce(p_subject, '')), '');
  v_key  text;
  v_id   uuid;
  v_old  record;
begin
  if not public.has_global_permission('comm.send') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_from not in ('hello@loadboot.com', 'dispatch@loadboot.com', 'billing@loadboot.com') then
    raise exception 'From must be hello@, dispatch@ or billing@loadboot.com' using errcode = '22023';
  end if;
  if v_to !~ '^[^@\s<>,;"]+@[^@\s<>,;"]+\.[a-z]{2,}$' then
    raise exception 'Enter one valid email address in To' using errcode = '22023';
  end if;
  if coalesce(btrim(regexp_replace(coalesce(p_body_html, ''), '<[^>]*>|&nbsp;', '', 'g')), '') = '' then
    raise exception 'Write the message first' using errcode = '22023';
  end if;

  v_subj := coalesce(v_subj, '(no subject)');
  v_key  := v_to || ':' || regexp_replace(lower(v_subj), '^((re|fwd?)\s*:\s*)+', '', 'i');

  if p_draft_id is not null then
    select * into v_old from app_private.mail_messages where id = p_draft_id for update;
    if v_old.id is null or v_old.status <> 'draft' or coalesce(v_old.mail_class, '') <> 'compose' then
      raise exception 'that draft was already sent or discarded' using errcode = '22023';
    end if;
  end if;

  -- One open draft per conversation (cc_mail_reply replaces drafts thread-wide; never let it eat this one silently).
  if exists (select 1 from app_private.mail_messages d
              where d.thread_key = v_key and d.status = 'draft' and d.id is distinct from p_draft_id) then
    raise exception 'This conversation already has an unsent draft — open it from Drafts' using errcode = '22023';
  end if;

  if p_draft_id is not null then
    update app_private.mail_messages
       set mailbox = v_from, peer_email = v_to, subject = v_subj, body_html = p_body_html,
           body_text = left(btrim(regexp_replace(regexp_replace(p_body_html, '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), 4000),
           thread_key = v_key, created_at = now()
     where id = p_draft_id
     returning id into v_id;
    -- carry any star/label state across a To/Subject edit is not needed: drafts have none yet.
  else
    insert into app_private.mail_messages(
      direction, mailbox, peer_email, peer_name, subject, body_html, body_text,
      thread_key, created_by, status, folder, mail_class)
    values ('out', v_from, v_to, null, v_subj, p_body_html,
            left(btrim(regexp_replace(regexp_replace(p_body_html, '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), 4000),
            v_key, auth.uid(), 'draft', 'inbox', 'compose')
    returning id into v_id;
  end if;

  perform app_private.log_audit(
    'comm.mail_draft_saved', 'mail_message', v_id::text, null,
    'new message draft to ' || v_to || ' (not sent)',
    jsonb_build_object('thread_key', v_key, 'mailbox', v_from, 'sent', false, 'compose', true), null);

  return jsonb_build_object('id', v_id, 'thread_key', v_key);
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. cc_mail_send — compose keys + the unsubscribe gate BEFORE anything is marked sent.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_send(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_d record; v_tpl text; v_gate jsonb;
begin
  -- Deliberately stricter than comm.send: only owner / operations_admin hold comm.manage,
  -- so a dispatcher can prepare a reply but cannot put it on the wire.
  if not public.has_global_permission('comm.manage') then
    raise exception 'not authorized to send mail' using errcode = '42501';
  end if;

  select * into v_d from app_private.mail_messages where id = p_draft_id for update;
  if v_d.id is null then
    raise exception 'draft not found' using errcode = '22023';
  end if;
  if v_d.status <> 'draft' then
    -- Idempotent: re-clicking Send on an already-sent draft is a no-op, not a second email.
    return jsonb_build_object('ok', false, 'reason', 'not a draft', 'status', v_d.status);
  end if;
  if coalesce(btrim(v_d.peer_email), '') = '' then
    raise exception 'draft has no recipient' using errcode = '22023';
  end if;

  v_tpl := case
             when v_d.mailbox like 'dispatch@%' then 'dispatch.mail.'
             when v_d.mailbox like 'billing@%'  then 'billing.mail.'
             else 'mail.'
           end
           || case when v_d.mail_class = 'compose' then 'compose' else 'reply' end;

  -- sys_email drops an unsubscribed recipient without an error. Ask the same gate first so the
  -- person pressing Send is told why, and the draft is NOT marked sent (CLAUDE.md §6.5).
  v_gate := app_private.email_gate(v_tpl, lower(btrim(v_d.peer_email)), null);
  if v_gate is not null and (v_gate->>'allowed') = 'false' then
    raise exception '%', coalesce(v_gate->>'reason', 'This address has unsubscribed from this kind of email.')
      using errcode = 'P0001', hint = 'unsubscribed';
  end if;

  perform app_private.sys_email(
    v_d.peer_email, v_tpl, v_d.subject, v_d.body_html, null,
    'mailreply:' || v_d.id::text);   -- idempotency key: the worker will not double-send

  update app_private.mail_messages
     set status = 'sent', sent_at = now(), sent_by = auth.uid(), send_error = null
   where id = v_d.id;

  perform app_private.log_audit(
    'comm.mail_sent', 'mail_message', v_d.id::text, null,
    (case when v_d.mail_class = 'compose' then 'new message sent to ' else 'reply sent to ' end) || v_d.peer_email,
    jsonb_build_object('thread_key', v_d.thread_key, 'mailbox', v_d.mailbox,
                       'template_key', v_tpl, 'subject', v_d.subject), null);

  return jsonb_build_object('ok', true, 'id', v_d.id, 'to', v_d.peer_email, 'template_key', v_tpl);
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. cc_mail_stats — adds 'folders' (Gmail rail counts). Every old key is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare j jsonb; f jsonb;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with t as (
    select m.thread_key,
           bool_or(m.direction = 'in' and m.folder = 'inbox')                              as in_inbox,
           bool_or(m.direction = 'in' and m.folder = 'system')                             as in_system,
           count(*) filter (where m.direction = 'in' and m.read_at is null and m.folder = 'inbox')  as unread_inbox,
           count(*) filter (where m.direction = 'in' and m.read_at is null and m.folder = 'system') as unread_system,
           max(m.created_at) filter (where m.direction = 'in')                             as last_in_at,
           bool_or(m.status = 'draft')                                                     as has_draft,
           bool_or(m.status = 'sent')                                                      as has_sent
      from app_private.mail_messages m
     group by m.thread_key
  ), ts as (
    select t.*, s.starred_at, s.snoozed_until, s.archived_at, s.trashed_at
      from t left join app_private.mail_thread_state s on s.thread_key = t.thread_key
  )
  select jsonb_build_object(
    'inbox_unread', count(*) filter (where in_inbox and unread_inbox > 0 and trashed_at is null
                                       and (snoozed_until is null or snoozed_until <= now())
                                       and (archived_at is null or last_in_at > archived_at)),
    'inbox',        count(*) filter (where in_inbox and trashed_at is null
                                       and (snoozed_until is null or snoozed_until <= now())
                                       and (archived_at is null or last_in_at > archived_at)),
    'starred',      count(*) filter (where starred_at is not null and trashed_at is null),
    'snoozed',      count(*) filter (where snoozed_until > now() and trashed_at is null),
    'sent',         count(*) filter (where has_sent and trashed_at is null),
    'drafts',       count(*) filter (where has_draft),
    'system',       count(*) filter (where in_system and trashed_at is null),
    'system_unread',count(*) filter (where in_system and unread_system > 0 and trashed_at is null),
    'all',          count(*) filter (where trashed_at is null),
    'trash',        count(*) filter (where trashed_at is not null)
  ) into f from ts;

  select jsonb_build_object(
    'threads',  (select count(distinct thread_key) from app_private.mail_messages where folder = 'inbox'),
    'unread',   (select count(*) from app_private.mail_messages where direction = 'in' and read_at is null and folder = 'inbox'),
    'system',   (select count(distinct thread_key) from app_private.mail_messages where folder = 'system'),
    'system_30d', (select count(*) from app_private.mail_messages where folder = 'system' and direction = 'in' and created_at > now() - interval '30 days'),
    'drafts',   (select count(*) from app_private.mail_messages where status = 'draft'),
    'sent',     (select count(*) from app_private.mail_messages where status = 'sent'),
    'can_send', public.has_global_permission('comm.manage'),
    'can_draft', public.has_global_permission('comm.send'),
    'folders',  f,
    'mailboxes', coalesce((
      select jsonb_agg(x order by x->>'mailbox')
        from (
          select jsonb_build_object(
                   'mailbox', mailbox,
                   'total',   count(*) filter (where folder = 'inbox'),
                   'unread',  count(*) filter (where direction = 'in' and read_at is null and folder = 'inbox'),
                   'system',  count(*) filter (where folder = 'system')
                 ) as x
            from app_private.mail_messages
           where mailbox is not null
           group by mailbox
        ) m
    ), '[]'::jsonb)
  ) into j;

  return j;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Grants — authenticated only. Explicit anon revoke (Supabase default ACL, CLAUDE.md §4).
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.cc_mail_thread_action(text[], text, timestamptz)        from public, anon;
revoke all on function public.cc_mail_compose_save(text, text, text, text, uuid)      from public, anon;
revoke all on function public.cc_mail_list(integer, text, text, timestamptz, text)    from public, anon;
revoke all on function public.cc_mail_thread(text, boolean)                           from public, anon;
revoke all on function public.cc_mail_send(uuid)                                      from public, anon;
revoke all on function public.cc_mail_stats()                                         from public, anon;

grant execute on function public.cc_mail_thread_action(text[], text, timestamptz)     to authenticated, service_role;
grant execute on function public.cc_mail_compose_save(text, text, text, text, uuid)   to authenticated, service_role;
grant execute on function public.cc_mail_list(integer, text, text, timestamptz, text) to authenticated, service_role;
grant execute on function public.cc_mail_thread(text, boolean)                        to authenticated, service_role;
grant execute on function public.cc_mail_send(uuid)                                   to authenticated, service_role;
grant execute on function public.cc_mail_stats()                                      to authenticated, service_role;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual)
-- ─────────────────────────────────────────────────────────────────────────────
-- begin;
--   drop function if exists public.cc_mail_thread_action(text[], text, timestamptz);
--   drop function if exists public.cc_mail_compose_save(text, text, text, text, uuid);
--   -- re-create cc_mail_list / cc_mail_stats from bl_mail_0471_system_folder.sql,
--   -- cc_mail_thread from bl_mail_0471b, cc_mail_send from bl_mail_0335_cc_mailbox_hardening.sql.
--   -- Compose drafts (mail_class='compose', status='draft') are harmless rows; delete them if wanted.
--   drop table if exists app_private.mail_thread_state;
--   delete from app_private.email_catalog where key in ('mail.compose','dispatch.mail.compose','billing.mail.compose') and sends_total = 0;
-- commit;
