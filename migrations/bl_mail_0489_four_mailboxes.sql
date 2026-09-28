-- bl_mail_0489_four_mailboxes.sql
-- CC Mailbox: four separate mailboxes — hello@, dispatch@, billing@, loads@ — each with its own
-- identity, colour, signature, folders, sender and ACCESS (owner ask, 28 Sep 2026: "har ek alag alag,
-- premium advance level"). Additive on top of bl_mail_0488; every RPC keeps its signature and old keys.
--
-- OWNER DECISIONS (28 Sep 2026, asked in session):
--   1. hello@ Compose (mail.compose) leaves 'load_ops'. New preference group 'team_messages'
--      ("Messages from our team"): opt-out-able, but separate from load notifications, so a carrier who
--      switched off load mail still gets a human's message — and can stop those separately.
--   2. Access is per mailbox and enforced HERE, not in the UI:
--        hello@, loads@   → comm.view  (unchanged: dispatcher, marketing, support, operations_admin, owner)
--        dispatch@        → mail.box.dispatch  (owner, operations_admin, dispatcher)
--        billing@         → mail.box.billing   (owner, operations_admin)  — bank details, factoring, payouts
--        any other @loadboot.com address that ever shows up → comm.manage only (fail closed).
--      A conversation is visible only if EVERY message in it is on a mailbox the caller may open
--      (thread keys are peer:subject, so one conversation can in theory span two mailboxes).
--   3. loads@ replies leave FROM loads@ (catalog keys loads.mail.*; delivery-worker v22 adds the
--      'loads' identity — without it DISPATCH_RE would match "load" and send them from dispatch@).
--
-- The registry app_private.mail_boxes is the ONE place a mailbox is defined: label, colour, icon,
-- signature, the permission that opens it, and the catalog key prefix its sends use. cc_mail_stats
-- hands it to the screen, cc_mail_send reads the prefix from it. Adding a fifth mailbox = one row
-- (plus its inbound route and, if it sends, catalog keys + a delivery-worker identity).
--
-- EMAIL LAW (§6): loads.mail.reply / loads.mail.compose are registered here, in the migration that
-- adds the sender. Replies stay account_critical (the person wrote to us); compose honours opt-outs.
--
-- ANON SURFACE: no new public function. Two new app_private helpers, revoked from public/anon/
-- authenticated. Baseline stays 36 prod / 35 staging.
--
-- NOT CODE (owner's dashboards): inbound routing for hello@ / dispatch@ / billing@ → in.loadboot.com
-- (docs/livechat/LIVECHAT-CLAUDE-BRAIN-PLAN.md "Plumbing step 1"). Until then those three mailboxes
-- can SEND and show Sent/Drafts, but received mail only reaches the Mailbox for loads@.
--
-- ROLLBACK: at the end of the file.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Preference group for hand-written team mail (decision 1)
-- ─────────────────────────────────────────────────────────────────────────────

insert into app_private.email_pref_groups (code, label, description, opt_out_allowed, default_on, sort)
values ('team_messages', 'Messages from our team',
        'Personal messages a LoadBoot team member writes to you by hand. Answers to emails you sent us always reach you.',
        true, true, 15)
on conflict (code) do nothing;

update app_private.email_catalog
   set preference_group = 'team_messages',
       purpose = 'A new message a staff member writes in the CC Mailbox (Compose) from hello@ — not a reply. Preference group team_messages (bl_mail_0489).',
       stop_condition = 'recipient opted out of team_messages, or is suppressed'
 where key = 'mail.compose';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Permissions that open the two restricted mailboxes (decision 2)
-- ─────────────────────────────────────────────────────────────────────────────

insert into app_private.permissions (key, description) values
  ('mail.box.dispatch', 'Open the dispatch@ mailbox in CC Mailbox: broker and carrier operations mail, rate confirmations, factoring. bl_mail_0489.'),
  ('mail.box.billing',  'Open the billing@ mailbox in CC Mailbox: invoices, payouts, bank details, settlements. bl_mail_0489.')
on conflict (key) do nothing;

insert into app_private.role_permissions (role_id, permission_id)
select r.id, p.id
  from app_private.roles r
  join app_private.permissions p
    on (p.key = 'mail.box.dispatch' and r.key in ('owner', 'operations_admin', 'dispatcher'))
    or (p.key = 'mail.box.billing'  and r.key in ('owner', 'operations_admin'))
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The mailbox registry
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists app_private.mail_boxes (
  address        text primary key check (address = lower(address) and address like '%@loadboot.com'),
  label          text not null,
  from_name      text not null,
  purpose        text not null,
  color          text not null check (color ~ '^#[0-9a-f]{6}$'),
  icon           text not null,
  view_perm      text not null,
  tpl_prefix     text not null check (tpl_prefix ~ '^([a-z]+\.)*mail\.$'),
  signature_html text,
  sort           integer not null default 100,
  updated_at     timestamptz not null default now()
);
alter table app_private.mail_boxes enable row level security;
revoke all on table app_private.mail_boxes from public, anon, authenticated;

comment on table app_private.mail_boxes is
  'The CC Mailbox mailboxes (bl_mail_0489). One row = one address: who may open it (view_perm), which catalog keys its sends use (tpl_prefix + reply|compose), and how the screen shows it.';

insert into app_private.mail_boxes (address, label, from_name, purpose, color, icon, view_perm, tpl_prefix, signature_html, sort) values
  ('hello@loadboot.com', 'Hello', 'LoadBoot',
   'Front door: carriers, sign-ups, partners, vendors and general questions.',
   '#0b57d0', 'chat', 'comm.view', 'mail.',
   '<p>—<br><b>The LoadBoot Team</b><br>hello@loadboot.com · loadboot.com</p>', 10),
  ('dispatch@loadboot.com', 'Dispatch', 'LoadBoot Dispatch',
   'Operations: brokers, rate confirmations, pickups, deliveries, carrier dispatch.',
   '#e8590c', 'truck', 'mail.box.dispatch', 'dispatch.mail.',
   '<p>—<br><b>LoadBoot Dispatch</b><br>dispatch@loadboot.com · loadboot.com</p>', 20),
  ('billing@loadboot.com', 'Billing', 'LoadBoot Billing',
   'Money: invoices, payouts, settlements, factoring and bank details.',
   '#188038', 'dollar', 'mail.box.billing', 'billing.mail.',
   '<p>—<br><b>LoadBoot Billing</b><br>billing@loadboot.com · loadboot.com</p>', 30),
  ('loads@loadboot.com', 'Loads', 'LoadBoot Loads',
   'Load desk: broker load blasts, availability replies and booking confirmations.',
   '#9334e6', 'boxes', 'comm.view', 'loads.mail.',
   '<p>—<br><b>LoadBoot Load Desk</b><br>loads@loadboot.com · loadboot.com</p>', 40)
on conflict (address) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Visibility helpers (invoker rights: they only ever run inside the SECURITY DEFINER RPCs)
-- ─────────────────────────────────────────────────────────────────────────────

-- The mailboxes the caller may open: registry rows whose permission they hold, plus — for
-- comm.manage only — any address that is not in the registry. A NULL mailbox counts as hello@.
create or replace function app_private.mail_visible_boxes()
returns text[]
language sql
stable
set search_path to 'app_private, public'
as $function$
  select coalesce(array_agg(distinct a), '{}'::text[]) from (
    select b.address as a
      from app_private.mail_boxes b
     where public.has_global_permission(b.view_perm)
    union all
    select lower(m.mailbox)
      from app_private.mail_messages m
     where m.mailbox is not null
       and not exists (select 1 from app_private.mail_boxes b where b.address = lower(m.mailbox))
       and public.has_global_permission('comm.manage')
  ) x;
$function$;

create or replace function app_private.mail_thread_hidden(p_thread text, p_vis text[])
returns boolean
language sql
stable
set search_path to 'app_private, public'
as $function$
  select exists (select 1 from app_private.mail_messages m
                  where m.thread_key = p_thread
                    and not (coalesce(lower(m.mailbox), 'hello@loadboot.com') = any(p_vis)));
$function$;

create or replace function app_private.mail_assert_thread(p_thread text)
returns void
language plpgsql
stable
set search_path to 'app_private, public'
as $function$
begin
  if app_private.mail_thread_hidden(p_thread, app_private.mail_visible_boxes()) then
    raise exception 'not authorized for this mailbox' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function app_private.mail_visible_boxes()               from public, anon, authenticated;
revoke all on function app_private.mail_thread_hidden(text, text[])    from public, anon, authenticated;
revoke all on function app_private.mail_assert_thread(text)            from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Catalog + sender identity for loads@ (decision 3)
-- ─────────────────────────────────────────────────────────────────────────────

insert into app_private.email_catalog
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
   stop_condition, preference_group, unsub_allowed, cc_deep_link, status)
select 'loads.mail.reply', 'Loads mailbox reply',
       'A staff member''s reply, from loads@, to someone who emailed loads@ (a broker answering our load outreach). Sent by a human from the CC Mailbox.',
       c.class, c.audience_role, c.trigger_type, c.trigger_source, c.cadence, c.cap_note,
       c.stop_condition, c.preference_group, c.unsub_allowed, '#/mailbox?label=loads@loadboot.com', c.status
  from app_private.email_catalog c where c.key = 'dispatch.mail.reply'
on conflict (key) do nothing;

insert into app_private.email_catalog
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
   stop_condition, preference_group, unsub_allowed, cc_deep_link, status)
values
  ('loads.mail.compose', 'Loads mailbox new message',
   'A new message written in the CC Mailbox with From = loads@ — not a reply.',
   'O', 'any', 'manual', 'public.cc_mail_send', 'per message', 'one per human Send press',
   'recipient opted out of load_ops, or is suppressed', 'load_ops', true, '#/mailbox?folder=sent&label=loads@loadboot.com', 'live')
on conflict (key) do nothing;

insert into app_private.email_sender_identities (code, from_address, reply_to, note)
values ('loads', 'LoadBoot Loads <loads@loadboot.com>', 'loads@loadboot.com',
        'Load desk replies from the CC Mailbox (loads.mail.*). delivery-worker v22 LOADS_RE. bl_mail_0489.')
on conflict (code) do nothing;

-- DB mirror of delivery-worker categoryOf (CC shows it in the Email catalog). Same order as the worker:
-- loads.mail.* is checked first, before DISPATCH_RE can claim the word "load".
create or replace function app_private.email_sender_for(p_key text, p_source text default 'transactional')
returns text
language sql
immutable
set search_path to 'app_private', 'public', 'extensions', 'pg_temp'
as $function$
  select case
    when coalesce(p_key,'') ~* '^outreach[._-]' then 'marketing'
    when coalesce(p_key,'') ~* '^loads\.mail\.' then 'loads'
    when coalesce(p_key,'') ~* '(billing|invoice|payment|settlement|payout|statement|receipt|factoring)' then 'billing'
    when coalesce(p_key,'') ~* '(load|trip|offer|dispatch|booking|tracking|pod|detention|checkin|carrier|driver|ops\.)' then 'dispatch'
    when coalesce(p_source,'') = 'campaign' then 'marketing'
    else 'support' end
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. cc_mail_list — only threads the caller may open. Same signature/keys as bl_mail_0488.
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
  v_box    text := nullif(lower(btrim(coalesce(p_mailbox, ''))), '');
  v_folder text := case when p_folder in ('inbox', 'system', 'all', 'starred', 'snoozed', 'sent', 'drafts', 'trash')
                        then p_folder else 'inbox' end;
  v_vis    text[];
  v_rows   jsonb;
  v_next   timestamptz;
  v_total  int;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_vis := app_private.mail_visible_boxes();

  with hidden as (
    select distinct h.thread_key
      from app_private.mail_messages h
     where not (coalesce(lower(h.mailbox), 'hello@loadboot.com') = any(v_vis))
  ), latest as (
    -- inbox / system keep 0471's meaning: the newest message that sits in that folder.
    select distinct on (m.thread_key) m.*
      from app_private.mail_messages m
     where (v_box is null or coalesce(lower(m.mailbox), 'hello@loadboot.com') = v_box)
       and (v_folder not in ('inbox', 'system') or m.folder = v_folder)
       and not exists (select 1 from hidden x where x.thread_key = m.thread_key)
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
    'mailbox', v_box,
    'total', coalesce(v_total, 0),
    'next_before', case when jsonb_array_length(coalesce(v_rows, '[]'::jsonb)) < v_limit then null else v_next end
  );
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Thread-level RPCs: one guard line each, nothing else changes
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
  perform app_private.mail_assert_thread(p_thread);
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

create or replace function public.cc_mail_mark(p_thread text, p_read boolean default true)
returns integer
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_n int;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform app_private.mail_assert_thread(p_thread);

  update app_private.mail_messages
     set read_at = case when p_read then now() else null end
   where thread_key = p_thread
     and direction = 'in'
     and (read_at is null) = p_read;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

create or replace function public.cc_mail_reply(p_thread text, p_body_html text)
returns uuid
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_last record; v_id uuid; v_subject text;
begin
  if not public.has_global_permission('comm.send') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform app_private.mail_assert_thread(p_thread);
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
  perform app_private.mail_assert_thread(p_thread);
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

create or replace function public.cc_mail_set_folder(p_thread text, p_folder text)
returns integer
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_n int;
begin
  if not public.has_global_permission('comm.manage') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform app_private.mail_assert_thread(p_thread);
  if p_folder not in ('inbox', 'system') then
    raise exception 'folder must be inbox or system' using errcode = '22023';
  end if;

  update app_private.mail_messages
     set folder     = p_folder,
         mail_class = 'manual',
         read_at    = case when direction <> 'in' then read_at
                           when p_folder = 'system' then coalesce(read_at, now())
                           else null end
   where thread_key = p_thread
     and folder is distinct from p_folder;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform app_private.log_audit(
      'comm.mail_folder_set', 'mail_thread', p_thread, null,
      'thread moved to ' || p_folder,
      jsonb_build_object('thread_key', p_thread, 'folder', p_folder, 'rows', v_n));
  end if;
  return v_n;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. cc_mail_thread_action — every key must be a thread the caller may open
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
  v_vis  text[];
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
  v_vis := app_private.mail_visible_boxes();
  if exists (select 1 from unnest(v_keys) k where app_private.mail_thread_hidden(k, v_vis)) then
    raise exception 'not authorized for this mailbox' using errcode = '42501';
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
-- 9. cc_mail_compose_save — From must be a registry mailbox the caller may open
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
  v_vis  text[];
begin
  if not public.has_global_permission('comm.send') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from app_private.mail_boxes b where b.address = v_from) then
    raise exception 'From must be one of our mailboxes (hello@, dispatch@, billing@ or loads@loadboot.com)' using errcode = '22023';
  end if;
  v_vis := app_private.mail_visible_boxes();
  if not (v_from = any(v_vis)) then
    raise exception 'You cannot send from %', v_from using errcode = '42501';
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
    if app_private.mail_thread_hidden(v_old.thread_key, v_vis) then
      raise exception 'not authorized for this mailbox' using errcode = '42501';
    end if;
  end if;

  -- Never write into a conversation that lives in a mailbox this person cannot open.
  if app_private.mail_thread_hidden(v_key, v_vis) then
    raise exception 'A conversation with this address and subject already exists in a mailbox you cannot open — change the subject' using errcode = '42501';
  end if;

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
-- 10. cc_mail_send — catalog key prefix from the registry; the sender must be able to open the box
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_send(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_d record; v_tpl text; v_gate jsonb; v_prefix text;
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
  perform app_private.mail_assert_thread(v_d.thread_key);
  if v_d.status <> 'draft' then
    -- Idempotent: re-clicking Send on an already-sent draft is a no-op, not a second email.
    return jsonb_build_object('ok', false, 'reason', 'not a draft', 'status', v_d.status);
  end if;
  if coalesce(btrim(v_d.peer_email), '') = '' then
    raise exception 'draft has no recipient' using errcode = '22023';
  end if;

  -- Unknown addresses (not in the registry) keep bl_mail_0488's behaviour: they leave from hello@.
  select b.tpl_prefix into v_prefix from app_private.mail_boxes b where b.address = lower(v_d.mailbox);
  v_tpl := coalesce(v_prefix, 'mail.')
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
-- 11. cc_mail_stats — scoped to visible mailboxes; 'mailboxes' now carries the registry
--     (label, colour, icon, signature…) and each mailbox's own folder counts.
--     Every old key keeps its name and meaning (now: "of the mail you may open").
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cc_mail_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare j jsonb; f jsonb; v_vis text[]; v_boxes jsonb;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_vis := app_private.mail_visible_boxes();

  -- One pass: grouping sets give each mailbox's counts AND the "All inboxes" total (box row = null).
  with t as (
    select m.thread_key,
           (array_agg(coalesce(lower(m.mailbox), 'hello@loadboot.com') order by m.created_at desc))[1] as box,
           bool_and(coalesce(lower(m.mailbox), 'hello@loadboot.com') = any(v_vis))              as visible,
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
     where t.visible
  ), g as (
    select grouping(box) = 1 as is_total, box,
      jsonb_build_object(
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
      ) as folders,
      coalesce(sum(unread_inbox) filter (where trashed_at is null), 0) as unread_msgs,
      count(*) filter (where in_system and trashed_at is null)        as system_threads,
      max(last_in_at)                                                  as last_in_at
    from ts
    group by grouping sets ((box), ())
  ), boxes as (
    select v.a as address, b.label, b.from_name, b.purpose, b.color, b.icon, b.signature_html,
           coalesce(b.sort, 1000) as sort, b.address is not null as known
      from unnest(v_vis) v(a)
      left join app_private.mail_boxes b on b.address = v.a
  )
  select (select g.folders from g where g.is_total),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'mailbox',   x.address,
                    'label',     coalesce(x.label, initcap(split_part(x.address, '@', 1))),
                    'from_name', coalesce(x.from_name, 'LoadBoot'),
                    'purpose',   x.purpose,
                    'color',     coalesce(x.color, '#5f6368'),
                    'icon',      coalesce(x.icon, 'label'),
                    'signature_html', x.signature_html,
                    'known',     x.known,
                    'can_compose', x.known,
                    -- bl_mail_0488 keys, same names
                    'total',     coalesce((p.folders->>'inbox')::int, 0),
                    'unread',    coalesce(p.unread_msgs, 0),
                    'system',    coalesce(p.system_threads, 0),
                    'last_in_at', p.last_in_at,
                    'folders',   coalesce(p.folders, '{}'::jsonb)
                  ) order by x.sort, x.address)
             from boxes x left join g p on not p.is_total and p.box = x.address), '[]'::jsonb)
    into f, v_boxes;

  select jsonb_build_object(
    'threads',  (select count(distinct thread_key) from app_private.mail_messages
                  where folder = 'inbox' and coalesce(lower(mailbox), 'hello@loadboot.com') = any(v_vis)),
    'unread',   (select count(*) from app_private.mail_messages
                  where direction = 'in' and read_at is null and folder = 'inbox'
                    and coalesce(lower(mailbox), 'hello@loadboot.com') = any(v_vis)),
    'system',   (select count(distinct thread_key) from app_private.mail_messages
                  where folder = 'system' and coalesce(lower(mailbox), 'hello@loadboot.com') = any(v_vis)),
    'system_30d', (select count(*) from app_private.mail_messages
                  where folder = 'system' and direction = 'in' and created_at > now() - interval '30 days'
                    and coalesce(lower(mailbox), 'hello@loadboot.com') = any(v_vis)),
    'drafts',   (select count(*) from app_private.mail_messages
                  where status = 'draft' and coalesce(lower(mailbox), 'hello@loadboot.com') = any(v_vis)),
    'sent',     (select count(*) from app_private.mail_messages
                  where status = 'sent' and coalesce(lower(mailbox), 'hello@loadboot.com') = any(v_vis)),
    'can_send', public.has_global_permission('comm.manage'),
    'can_draft', public.has_global_permission('comm.send'),
    'folders',  coalesce(f, '{}'::jsonb),
    'mailboxes', v_boxes
  ) into j;

  return j;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Grants — unchanged surface. Explicit anon revoke (Supabase default ACL, CLAUDE.md §4).
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.cc_mail_list(integer, text, text, timestamptz, text)    from public, anon;
revoke all on function public.cc_mail_thread(text, boolean)                           from public, anon;
revoke all on function public.cc_mail_mark(text, boolean)                             from public, anon;
revoke all on function public.cc_mail_reply(text, text)                               from public, anon;
revoke all on function public.cc_mail_draft_discard(text)                             from public, anon;
revoke all on function public.cc_mail_set_folder(text, text)                          from public, anon;
revoke all on function public.cc_mail_thread_action(text[], text, timestamptz)        from public, anon;
revoke all on function public.cc_mail_compose_save(text, text, text, text, uuid)      from public, anon;
revoke all on function public.cc_mail_send(uuid)                                      from public, anon;
revoke all on function public.cc_mail_stats()                                         from public, anon;

grant execute on function public.cc_mail_list(integer, text, text, timestamptz, text) to authenticated, service_role;
grant execute on function public.cc_mail_thread(text, boolean)                        to authenticated, service_role;
grant execute on function public.cc_mail_mark(text, boolean)                          to authenticated, service_role;
grant execute on function public.cc_mail_reply(text, text)                            to authenticated, service_role;
grant execute on function public.cc_mail_draft_discard(text)                          to authenticated, service_role;
grant execute on function public.cc_mail_set_folder(text, text)                       to authenticated, service_role;
grant execute on function public.cc_mail_thread_action(text[], text, timestamptz)     to authenticated, service_role;
grant execute on function public.cc_mail_compose_save(text, text, text, text, uuid)   to authenticated, service_role;
grant execute on function public.cc_mail_send(uuid)                                   to authenticated, service_role;
grant execute on function public.cc_mail_stats()                                      to authenticated, service_role;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual)
-- ─────────────────────────────────────────────────────────────────────────────
-- begin;
--   -- re-run bl_mail_0488_gmail_mailbox.sql sections 3–8 (list, thread, thread_action, compose_save,
--   -- send, stats); cc_mail_mark / cc_mail_reply / cc_mail_draft_discard / cc_mail_set_folder from
--   -- bl_mail_0335_cc_mailbox_hardening.sql / bl_mail_0471_system_folder.sql (drop the mail_assert_thread line).
--   drop function if exists app_private.mail_assert_thread(text);
--   drop function if exists app_private.mail_thread_hidden(text, text[]);
--   drop function if exists app_private.mail_visible_boxes();
--   drop table if exists app_private.mail_boxes;
--   update app_private.email_catalog set preference_group = 'load_ops' where key = 'mail.compose';
--   delete from app_private.email_catalog where key in ('loads.mail.reply','loads.mail.compose') and sends_total = 0;
--   delete from app_private.role_permissions where permission_id in (select id from app_private.permissions where key in ('mail.box.dispatch','mail.box.billing'));
--   delete from app_private.permissions where key in ('mail.box.dispatch','mail.box.billing');
--   -- team_messages: keep the group if anyone has opted out of it (email_pref_optouts), else delete it.
-- commit;
