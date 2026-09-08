-- bl_mail_0335_cc_mailbox_hardening.sql
-- CC Mailbox hardening. Additive and reversible.
--
-- WHY: app_private.mail_messages + cc_mail_list/thread/reply shipped backend-only.
-- Nothing in app/shared/api.js calls them and the CC router has no #mailbox route, so
-- cc_mail_ingest's notification ("reply from the CC Mailbox", url /app/command-center/#mailbox)
-- dead-ends on the Action Center. Before wiring a UI on top, four real defects are fixed here:
--
--   1. RBAC   — all three RPCs gated on is_active_staff() only. Any staff member could read
--               billing@/dispatch@ mail and send mail as the company. Now comm.view / comm.send
--               / comm.manage, matching every other CC surface.
--   2. SEND   — cc_mail_reply called app_private.sys_email() directly, i.e. the moment a Reply
--               button existed, staff mail left the building. Owner decision (7 Sep 2026):
--               replies are DRAFTS ONLY. cc_mail_reply no longer sends anything. Dispatch is a
--               separate, explicit, comm.manage-gated call: cc_mail_send(draft_id).
--   3. AUDIT  — no audit trail on outbound mail. Every draft/send/discard now hits log_audit.
--   4. SCALE  — cc_mail_list had no mailbox filter, no search, no pagination, and DISTINCT ON
--               scanned the whole table before LIMIT. Now filtered + keyset-paginated + indexed.
--
-- Also: cc_mail_thread silently marked a whole thread read as a side effect of reading it, with
-- no way back. Read-marking is now opt-in (p_mark_read) plus an explicit cc_mail_mark().
--
-- ROLLBACK: see the commented block at the end of this file. The added columns are nullable /
-- defaulted and no existing row's meaning changes, so a rollback is function-level only.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schema (additive only)
-- ─────────────────────────────────────────────────────────────────────────────

alter table app_private.mail_messages
  add column if not exists status      text,
  add column if not exists attachments jsonb,
  add column if not exists sent_at     timestamptz,
  add column if not exists sent_by     uuid,
  add column if not exists send_error  text;

-- Backfill before the NOT NULL/CHECK so existing rows keep their true meaning:
-- inbound = received, any pre-existing outbound row was really sent.
update app_private.mail_messages
   set status = case when direction = 'out' then 'sent' else 'received' end
 where status is null;

update app_private.mail_messages
   set sent_at = created_at
 where direction = 'out' and status = 'sent' and sent_at is null;

alter table app_private.mail_messages
  alter column status set default 'received';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mail_messages_status_chk'
  ) then
    alter table app_private.mail_messages
      add constraint mail_messages_status_chk
      check (status in ('received', 'draft', 'sent', 'failed'));
  end if;
end $$;

alter table app_private.mail_messages
  alter column status set not null;

comment on column app_private.mail_messages.status is
  'received (inbound) | draft (composed in CC, NOT sent) | sent | failed. A draft never reaches sys_email until cc_mail_send.';
comment on column app_private.mail_messages.attachments is
  'jsonb array of {filename, content_type, size, storage_path}. Populated by ingest; unused until attachment support lands.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Mailbox-scoped listing (the common query once dispatch@/billing@ ingest as well).
create index if not exists idx_mail_mailbox_created
  on app_private.mail_messages (mailbox, created_at desc);

-- Unread badge: partial, so it stays tiny no matter how much mail accumulates.
create index if not exists idx_mail_unread
  on app_private.mail_messages (thread_key)
  where direction = 'in' and read_at is null;

-- Draft lookup for the composer.
create index if not exists idx_mail_draft
  on app_private.mail_messages (thread_key, created_at desc)
  where status = 'draft';

-- Search over subject + peer. pg_trgm is already installed on both projects.
create index if not exists idx_mail_search_trgm
  on app_private.mail_messages
  using gin ((coalesce(subject, '') || ' ' || coalesce(peer_email, '') || ' ' || coalesce(peer_name, '')) gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. cc_mail_list — comm.view, mailbox filter, search, keyset pagination
--    Old signature (integer) is dropped: nothing calls it (no api.js wrapper exists),
--    and leaving an overload behind makes PostgREST resolution ambiguous.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.cc_mail_list(integer);

create or replace function public.cc_mail_list(
  p_limit   integer     default 50,
  p_mailbox text        default null,
  p_search  text        default null,
  p_before  timestamptz default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_q     text := nullif(btrim(coalesce(p_search, '')), '');
  v_rows  jsonb;
  v_next  timestamptz;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with latest as (
    select distinct on (m.thread_key) m.*
      from app_private.mail_messages m
     where (p_mailbox is null or m.mailbox = p_mailbox)
     order by m.thread_key, m.created_at desc
  ), page as (
    select l.*
      from latest l
     where (p_before is null or l.created_at < p_before)
       and (
         v_q is null
         or l.subject    ilike '%' || v_q || '%'
         or l.peer_email ilike '%' || v_q || '%'
         or l.peer_name  ilike '%' || v_q || '%'
         or l.body_text  ilike '%' || v_q || '%'
       )
     order by l.created_at desc
     limit v_limit
  )
  select jsonb_agg(t order by (t->>'last_at') desc), min(p.created_at)
    into v_rows, v_next
    from page p
    cross join lateral (
      select jsonb_build_object(
        'thread_key', p.thread_key,
        'mailbox',    p.mailbox,
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
                               where d.thread_key = p.thread_key and d.status = 'draft')
      ) as t
    ) x;

  return jsonb_build_object(
    'threads', coalesce(v_rows, '[]'::jsonb),
    -- null once the page came back short: the client stops paging.
    'next_before', case when jsonb_array_length(coalesce(v_rows, '[]'::jsonb)) < v_limit then null else v_next end
  );
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. cc_mail_thread — comm.view, read-marking is now opt-in
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.cc_mail_thread(text);

create or replace function public.cc_mail_thread(
  p_thread    text,
  p_mark_read boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare j jsonb;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if coalesce(p_mark_read, true) then
    update app_private.mail_messages
       set read_at = now()
     where thread_key = p_thread and direction = 'in' and read_at is null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'direction', direction, 'mailbox', mailbox,
           'peer_email', peer_email, 'peer_name', peer_name, 'subject', subject,
           'body_text', body_text, 'body_html', body_html,
           'status', status, 'attachments', attachments,
           'sent_at', sent_at, 'send_error', send_error,
           'created_at', created_at) order by created_at), '[]'::jsonb)
    into j
    from app_private.mail_messages
   where thread_key = p_thread;

  return j;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. cc_mail_mark — explicit read/unread, so opening a thread is undoable
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_mark(
  p_thread text,
  p_read   boolean default true
) returns integer
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_n int;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update app_private.mail_messages
     set read_at = case when p_read then now() else null end
   where thread_key = p_thread
     and direction = 'in'
     and (read_at is null) = p_read;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. cc_mail_reply — SAME SIGNATURE, NEW BEHAVIOUR: saves a draft, sends nothing.
--    Any existing caller keeps working but can no longer put mail on the wire.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_reply(
  p_thread    text,
  p_body_html text
) returns uuid
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_last record; v_id uuid; v_subject text;
begin
  if not public.has_global_permission('comm.send') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if coalesce(btrim(p_body_html), '') = '' then
    raise exception 'reply body required' using errcode = '22023';
  end if;

  select * into v_last
    from app_private.mail_messages
   where thread_key = p_thread and direction = 'in'
   order by created_at desc limit 1;
  if v_last.id is null then
    raise exception 'thread not found' using errcode = '22023';
  end if;

  v_subject := 'Re: ' || regexp_replace(coalesce(v_last.subject, ''), '^((re|fwd?)\s*:\s*)+', '', 'i');

  -- One open draft per thread: replace rather than pile up.
  delete from app_private.mail_messages
   where thread_key = p_thread and status = 'draft';

  insert into app_private.mail_messages(
    direction, mailbox, peer_email, peer_name, subject,
    body_html, body_text, thread_key, created_by, status)
  values ('out', v_last.mailbox, v_last.peer_email, v_last.peer_name, v_subject,
          p_body_html, null, p_thread, auth.uid(), 'draft')
  returning id into v_id;

  perform app_private.log_audit(
    'comm.mail_draft_saved', 'mail_message', v_id::text, null,
    'draft reply saved to ' || coalesce(v_last.peer_email, '?') || ' (not sent)',
    jsonb_build_object('thread_key', p_thread, 'mailbox', v_last.mailbox, 'sent', false));

  return v_id;
end;
$function$;

-- Explicit alias so the UI reads as what it does.
create or replace function public.cc_mail_draft_save(
  p_thread    text,
  p_body_html text
) returns uuid
language sql
security definer
set search_path to 'app_private, public'
as $function$
  select public.cc_mail_reply(p_thread, p_body_html);
$function$;

create or replace function public.cc_mail_draft_discard(p_thread text)
returns integer
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_n int;
begin
  if not public.has_global_permission('comm.send') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from app_private.mail_messages where thread_key = p_thread and status = 'draft';
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform app_private.log_audit(
      'comm.mail_draft_discarded', 'mail_thread', p_thread, null,
      'draft reply discarded', jsonb_build_object('thread_key', p_thread));
  end if;
  return v_n;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. cc_mail_send — the ONLY path that puts mail on the wire. comm.manage.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_send(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_d record; v_tpl text;
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
             when v_d.mailbox like 'dispatch@%' then 'dispatch.mail.reply'
             when v_d.mailbox like 'billing@%'  then 'billing.mail.reply'
             else 'mail.reply'
           end;

  perform app_private.sys_email(
    v_d.peer_email, v_tpl, v_d.subject, v_d.body_html, null,
    'mailreply:' || v_d.id::text);   -- idempotency key: the worker will not double-send

  update app_private.mail_messages
     set status = 'sent', sent_at = now(), sent_by = auth.uid(), send_error = null
   where id = v_d.id;

  perform app_private.log_audit(
    'comm.mail_sent', 'mail_message', v_d.id::text, null,
    'reply sent to ' || v_d.peer_email,
    jsonb_build_object('thread_key', v_d.thread_key, 'mailbox', v_d.mailbox,
                       'template_key', v_tpl, 'subject', v_d.subject));

  return jsonb_build_object('ok', true, 'id', v_d.id, 'to', v_d.peer_email, 'template_key', v_tpl);
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. cc_mail_stats — KPI tiles + the mailbox filter list, one round trip
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare j jsonb;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'threads',  (select count(distinct thread_key) from app_private.mail_messages),
    'unread',   (select count(*) from app_private.mail_messages where direction = 'in' and read_at is null),
    'drafts',   (select count(*) from app_private.mail_messages where status = 'draft'),
    'sent',     (select count(*) from app_private.mail_messages where status = 'sent'),
    'can_send', public.has_global_permission('comm.manage'),
    'mailboxes', coalesce((
      select jsonb_agg(x order by x->>'mailbox')
        from (
          select jsonb_build_object(
                   'mailbox', mailbox,
                   'total',   count(*),
                   'unread',  count(*) filter (where direction = 'in' and read_at is null)
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
-- 9. Grants — authenticated only; the permission check inside each body is the real gate.
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.cc_mail_list(integer, text, text, timestamptz)  from public, anon;
revoke all on function public.cc_mail_thread(text, boolean)                   from public, anon;
revoke all on function public.cc_mail_mark(text, boolean)                     from public, anon;
revoke all on function public.cc_mail_reply(text, text)                       from public, anon;
revoke all on function public.cc_mail_draft_save(text, text)                  from public, anon;
revoke all on function public.cc_mail_draft_discard(text)                     from public, anon;
revoke all on function public.cc_mail_send(uuid)                              from public, anon;
revoke all on function public.cc_mail_stats()                                 from public, anon;

grant execute on function public.cc_mail_list(integer, text, text, timestamptz) to authenticated, service_role;
grant execute on function public.cc_mail_thread(text, boolean)                  to authenticated, service_role;
grant execute on function public.cc_mail_mark(text, boolean)                    to authenticated, service_role;
grant execute on function public.cc_mail_reply(text, text)                      to authenticated, service_role;
grant execute on function public.cc_mail_draft_save(text, text)                 to authenticated, service_role;
grant execute on function public.cc_mail_draft_discard(text)                    to authenticated, service_role;
grant execute on function public.cc_mail_send(uuid)                             to authenticated, service_role;
grant execute on function public.cc_mail_stats()                                to authenticated, service_role;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, if ever needed)
-- ─────────────────────────────────────────────────────────────────────────────
-- begin;
--   drop function if exists public.cc_mail_send(uuid);
--   drop function if exists public.cc_mail_stats();
--   drop function if exists public.cc_mail_mark(text, boolean);
--   drop function if exists public.cc_mail_draft_save(text, text);
--   drop function if exists public.cc_mail_draft_discard(text);
--   drop function if exists public.cc_mail_list(integer, text, text, timestamptz);
--   drop function if exists public.cc_mail_thread(text, boolean);
--   -- then re-create the pre-0335 cc_mail_list(integer) / cc_mail_thread(text) /
--   -- cc_mail_reply(text,text) bodies from bl_mail_loads_0176_email_load_ingestion.sql lineage.
--   -- The added columns are safe to leave in place; drop them only if you really want to:
--   -- alter table app_private.mail_messages
--   --   drop constraint if exists mail_messages_status_chk,
--   --   drop column if exists status, drop column if exists attachments,
--   --   drop column if exists sent_at, drop column if exists sent_by, drop column if exists send_error;
-- commit;
