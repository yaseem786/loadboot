-- bl_mail_0606_reply_attachments — CC Mailbox: attachments on a REPLY (inline reply box), same rules as Compose (bl_mail_0605).
--   1. cc_mail_draft_attach(draft id, list): stores the checked attachment list on an unsent reply/compose draft
--   2. cc_mail_send validates and forwards attachments for every draft, not only mail_class = 'compose'
-- Additive: a reply with no attachments takes exactly the old path. cc_mail_reply / cc_mail_draft_save are untouched.
-- Same bucket (mail-attachments), same limits (10 MB/file, 25 MB total, PDF/JPG/PNG/DOCX/XLSX), same delivery-worker path.

-- 1. attach to a draft ---------------------------------------------------------------------------
create or replace function public.cc_mail_draft_attach(p_draft_id uuid, p_attachments jsonb default null::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare v_d record; v_att jsonb;
begin
  if not public.has_global_permission('comm.send') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_d from app_private.mail_messages where id = p_draft_id for update;
  if v_d.id is null or v_d.status <> 'draft' or v_d.direction <> 'out' then
    raise exception 'that draft was already sent or discarded' using errcode = '22023';
  end if;
  perform app_private.mail_assert_thread(v_d.thread_key);
  v_att := app_private.mail_attach_clean(p_attachments);
  update app_private.mail_messages set attachments = v_att where id = v_d.id;
  perform app_private.log_audit(
    'comm.mail_draft_saved', 'mail_message', v_d.id::text, null,
    'draft attachments updated (not sent)',
    jsonb_build_object('thread_key', v_d.thread_key, 'mailbox', v_d.mailbox, 'sent', false,
                       'attachments', coalesce(jsonb_array_length(v_att), 0)), null);
  return jsonb_build_object('id', v_d.id, 'attachments', coalesce(v_att, '[]'::jsonb));
end;
$function$;
revoke all on function public.cc_mail_draft_attach(uuid, jsonb) from public, anon;
grant execute on function public.cc_mail_draft_attach(uuid, jsonb) to authenticated, service_role;

-- 2. send: attachments for replies too -------------------------------------------------------------
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

  -- bl_mail_0605 / 0606: files must still be in storage at send time, or nothing goes (new messages AND replies).
  v_att := app_private.mail_attach_clean(v_d.attachments);

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
