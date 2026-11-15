-- bl_mail_0605_attachments — CC Mailbox: Gmail-style attachments on a NEW message (Compose).
--   1. private bucket mail-attachments (10 MB/file; PDF, JPG, PNG, DOCX, XLSX), staff-only RLS
--   2. app_private.mail_attach_clean(jsonb): server-side check of a draft's attachment list
--   3. cc_mail_compose_save gains p_attachments jsonb  -> mail_messages.attachments
--   4. cc_mail_send copies them to message_deliveries.meta.attachments (delivery-worker v22 sends them)
-- Additive: a message with no attachments takes exactly the old path. No new email key (uses *.mail.compose).

-- 1. bucket + policies ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mail-attachments', 'mail-attachments', false, 10485760,
        array['application/pdf','image/jpeg','image/png',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mail attachments staff read"   on storage.objects;
drop policy if exists "mail attachments staff insert" on storage.objects;
drop policy if exists "mail attachments staff delete" on storage.objects;

create policy "mail attachments staff read" on storage.objects for select to authenticated
  using (bucket_id = 'mail-attachments' and public.has_global_permission('comm.send'));
-- path = <own user id>/<random>/<file name>
create policy "mail attachments staff insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'mail-attachments' and public.has_global_permission('comm.send')
              and (storage.foldername(name))[1] = ((select auth.uid()))::text);
create policy "mail attachments staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'mail-attachments' and public.has_global_permission('comm.send'));

-- 2. validator -----------------------------------------------------------------------------------
-- Takes what the browser sent ([{path, filename, ...}]) and returns [{path, filename, size, content_type}]
-- with size and type read from storage (never trusted from the client). Raises on anything off.
create or replace function app_private.mail_attach_clean(p jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'app_private, public'
as $function$
declare
  v_out jsonb := '[]'::jsonb; v_a jsonb; v_path text; v_name text; v_o record;
  v_size bigint; v_total bigint := 0; v_seen text[] := '{}';
  c_types constant text[] := array['application/pdf','image/jpeg','image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) <> 'array' then
    raise exception 'attachments must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p) = 0 then return null; end if;
  if jsonb_array_length(p) > 10 then
    raise exception 'At most 10 attachments per email' using errcode = '22023';
  end if;
  for v_a in select * from jsonb_array_elements(p) loop
    v_path := btrim(coalesce(v_a->>'path', ''));
    if v_path = '' or v_path ~ '(^/|\.\.|\\)' then
      raise exception 'Attachment path is not valid' using errcode = '22023';
    end if;
    if v_path = any(v_seen) then continue; end if;
    v_seen := v_seen || v_path;
    select o.name, o.metadata into v_o from storage.objects o
     where o.bucket_id = 'mail-attachments' and o.name = v_path;
    if v_o.name is null then
      raise exception 'Attachment "%" is no longer in storage — remove it and attach the file again',
        coalesce(nullif(v_a->>'filename', ''), v_path) using errcode = '22023';
    end if;
    v_size := coalesce((v_o.metadata->>'size')::bigint, 0);
    if v_size <= 0 or v_size > 10485760 then
      raise exception 'Each attachment must be 10 MB or smaller' using errcode = '22023';
    end if;
    if not (coalesce(v_o.metadata->>'mimetype', '') = any(c_types)) then
      raise exception 'Only PDF, JPG, PNG, DOCX and XLSX files can be attached' using errcode = '22023';
    end if;
    v_total := v_total + v_size;
    v_name := left(btrim(regexp_replace(coalesce(nullif(btrim(v_a->>'filename'), ''),
                 regexp_replace(v_path, '^.*/', '')), '[\x00-\x1f/\\"<>|:*?]+', '_', 'g')), 150);
    v_out := v_out || jsonb_build_object('path', v_path, 'filename', v_name,
                                         'size', v_size, 'content_type', v_o.metadata->>'mimetype');
  end loop;
  if v_total > 26214400 then
    raise exception 'Attachments are over 25 MB in total — remove a file' using errcode = '22023';
  end if;
  return v_out;
end;
$function$;
revoke all on function app_private.mail_attach_clean(jsonb) from public, anon, authenticated;

-- 3. compose save (+ p_attachments) -------------------------------------------------------------
drop function if exists public.cc_mail_compose_save(text, text, text, text, uuid);

create or replace function public.cc_mail_compose_save(p_from text, p_to text, p_subject text, p_body_html text,
                                                       p_draft_id uuid default null::uuid,
                                                       p_attachments jsonb default null::jsonb)
 returns jsonb
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
  v_att  jsonb;
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
  v_att := app_private.mail_attach_clean(p_attachments);

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
           thread_key = v_key, created_at = now(), attachments = v_att
     where id = p_draft_id
     returning id into v_id;
  else
    insert into app_private.mail_messages(
      direction, mailbox, peer_email, peer_name, subject, body_html, body_text,
      thread_key, created_by, status, folder, mail_class, attachments)
    values ('out', v_from, v_to, null, v_subj, p_body_html,
            left(btrim(regexp_replace(regexp_replace(p_body_html, '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), 4000),
            v_key, auth.uid(), 'draft', 'inbox', 'compose', v_att)
    returning id into v_id;
  end if;

  perform app_private.log_audit(
    'comm.mail_draft_saved', 'mail_message', v_id::text, null,
    'new message draft to ' || v_to || ' (not sent)',
    jsonb_build_object('thread_key', v_key, 'mailbox', v_from, 'sent', false, 'compose', true,
                       'attachments', coalesce(jsonb_array_length(v_att), 0)), null);

  return jsonb_build_object('id', v_id, 'thread_key', v_key, 'attachments', coalesce(v_att, '[]'::jsonb));
end;
$function$;
revoke all on function public.cc_mail_compose_save(text, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.cc_mail_compose_save(text, text, text, text, uuid, jsonb) to authenticated, service_role;

-- 4. send: hand the attachment list to the delivery row -------------------------------------------
create or replace function public.cc_mail_send(p_draft_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare v_d record; v_tpl text; v_gate jsonb; v_prefix text; v_att jsonb; v_n int;
begin
  if not public.has_global_permission('comm.manage') then
    raise exception 'not authorized to send mail' using errcode = '42501';
  end if;

  select * into v_d from app_private.mail_messages where id = p_draft_id for update;
  if v_d.id is null then
    raise exception 'draft not found' using errcode = '22023';
  end if;
  perform app_private.mail_assert_thread(v_d.thread_key);
  if v_d.status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'not a draft', 'status', v_d.status);
  end if;
  if coalesce(btrim(v_d.peer_email), '') = '' then
    raise exception 'draft has no recipient' using errcode = '22023';
  end if;

  -- bl_mail_0605: files must still be in storage at send time, or nothing goes.
  if v_d.mail_class = 'compose' then
    v_att := app_private.mail_attach_clean(v_d.attachments);
  end if;

  select b.tpl_prefix into v_prefix from app_private.mail_boxes b where b.address = lower(v_d.mailbox);
  v_tpl := coalesce(v_prefix, 'mail.')
           || case when v_d.mail_class = 'compose' then 'compose' else 'reply' end;

  v_gate := app_private.email_gate(v_tpl, lower(btrim(v_d.peer_email)), null);
  if v_gate is not null and (v_gate->>'allowed') = 'false' then
    raise exception '%', coalesce(v_gate->>'reason', 'This address has unsubscribed from this kind of email.')
      using errcode = 'P0001', hint = 'unsubscribed';
  end if;

  perform app_private.sys_email(
    v_d.peer_email, v_tpl, v_d.subject, v_d.body_html, null,
    'mailreply:' || v_d.id::text);

  if v_att is not null then
    update app_private.message_deliveries
       set meta = meta || jsonb_build_object('attachments', v_att)
     where idempotency_key in ('mailreply:' || v_d.id::text, 'mailreply:' || v_d.id::text || ':test')
       and status in ('queued', 'scheduled');
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'This email was not queued (blocked or switched off in the email catalog), so its attachments were not sent. Nothing went out.'
        using errcode = 'P0001';
    end if;
  end if;

  update app_private.mail_messages
     set status = 'sent', sent_at = now(), sent_by = auth.uid(), send_error = null
   where id = v_d.id;

  perform app_private.log_audit(
    'comm.mail_sent', 'mail_message', v_d.id::text, null,
    (case when v_d.mail_class = 'compose' then 'new message sent to ' else 'reply sent to ' end) || v_d.peer_email,
    jsonb_build_object('thread_key', v_d.thread_key, 'mailbox', v_d.mailbox,
                       'template_key', v_tpl, 'subject', v_d.subject,
                       'attachments', coalesce(jsonb_array_length(v_att), 0)), null);

  return jsonb_build_object('ok', true, 'id', v_d.id, 'to', v_d.peer_email, 'template_key', v_tpl,
                            'attachments', coalesce(jsonb_array_length(v_att), 0));
end;
$function$;
