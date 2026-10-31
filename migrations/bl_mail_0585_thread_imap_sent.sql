-- bl_mail_0585 — CC Mailbox: one conversation like Gmail. Replies sent from webmail (PrivateEmail) never reached
-- mail_messages (the relay only captures inbound), so a thread showed only their side. Now that hello@ / dispatch@ /
-- billing@ are connected over IMAP (dmail_accounts, staff hubs), cc_mail_thread also returns that mailbox's Sent
-- messages that belong to the conversation:
--   * In-Reply-To / References point at a message already in the thread, OR
--   * sent to the thread's peer with the same subject once Re:/Fwd: prefixes are stripped.
-- Rows come back as direction 'out', source 'imap', read-only (no actions — they live on the mail server).
-- Dedup: a Sent copy whose Message-ID is already a mail_messages row is skipped. Same gate (comm.view), same signature,
-- grants unchanged (create or replace keeps the ACL). Read-only apart from the existing mark-read.

create or replace function public.cc_mail_thread(p_thread text, p_mark_read boolean default true)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $function$
declare j jsonb; s record; v_peer text; v_subj text;
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
  v_peer := lower(split_part(p_thread, ':', 1));
  v_subj := btrim(substr(p_thread, position(':' in p_thread) + 1));

  with cc as (
    select * from app_private.mail_messages where thread_key = p_thread
  ), ids as (
    select provider_message_id as mid from cc where provider_message_id is not null
  ), boxes as (
    select distinct lower(mailbox) as mb from cc
  ), sent as (
    select d.* from app_private.dmail_messages d
      join app_private.dmail_accounts a on a.id = d.account_id and a.parent_id is null
      join boxes b on b.mb = lower(a.address)
     where d.folder = 'sent'
       and (d.message_id is null or d.message_id not in (select mid from ids))
       and ( d.in_reply_to in (select mid from ids)
          or coalesce(d.refs, '{}'::text[]) && coalesce((select array_agg(mid) from ids), '{}'::text[])
          or ( exists (select 1 from jsonb_array_elements(coalesce(d.to_addrs, '[]'::jsonb)) t where lower(t->>'email') = v_peer)
               and btrim(regexp_replace(lower(coalesce(d.subject, '')), '^\s*((re|fw|fwd|aw)\s*:\s*)+', '', 'g')) = v_subj ) )
  ), rows as (
    select created_at as at, jsonb_build_object(
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
           'trashed', s.trashed_at is not null) as r
      from cc
    union all
    select coalesce(x.msg_date, x.created_at), jsonb_build_object(
           'id', x.id, 'direction', 'out', 'mailbox', (select lower(a.address) from app_private.dmail_accounts a where a.id = x.account_id),
           'folder', 'sent', 'source', 'imap', 'readonly', true,
           'peer_email', v_peer, 'peer_name', null, 'subject', x.subject,
           'body_text', case when coalesce(x.body_html, '') = '' then x.body_text end, 'body_html', nullif(x.body_html, ''),
           'status', 'sent', 'attachments', x.attachments,
           'sent_at', coalesce(x.msg_date, x.created_at), 'send_error', null,
           'read_at', coalesce(x.msg_date, x.created_at),
           'created_at', coalesce(x.msg_date, x.created_at),
           'starred', s.starred_at is not null,
           'snoozed_until', case when s.snoozed_until > now() then s.snoozed_until end,
           'archived', s.archived_at is not null,
           'trashed', s.trashed_at is not null)
      from sent x
  )
  select coalesce(jsonb_agg(r order by at), '[]'::jsonb) into j from rows;
  return j;
end;
$function$;
