-- bl_mail_0583 — CC Mailbox Phase 3 #2: "Attach to carrier" from the sender panel.
--
-- Finding (30 Oct 2026): mail_messages.body_text holds the raw MIME but the inbound relay cuts it at 20,000
-- characters, so an attachment's bytes are almost never in the database (33 of 39 attachment mails cut off).
-- The file itself is still on the mail server. A mailbox that is also connected over IMAP in CC
-- (dmail_accounts — today only dispatch@) has every message with its UID and attachment list, and the dmail
-- edge function's existing "attachment" action streams one file to staff (dmail_can → disp_is_staff).
--
-- This RPC is read-only. For one thread it lists the attachments that CAN be fetched that way (match:
-- dmail_accounts.address = mail_messages.mailbox and dmail_messages.message_id = provider_message_id), and for
-- a carrier org it returns the owner's user id — documents.carrier_id is the carrier USER, and
-- cc_staff_upload_document requires the owner. The upload itself goes through the existing, audited
-- uploadDocumentForCarrier + cc_staff_upload_document path (bl_doc_0248), source 'email'; the compliance slot
-- turns 'pending' through trg_doc_upload_compliance as for any upload, and approval stays a human step.
-- Gate: documents.review (same as cc_staff_upload_document).

create or replace function public.cc_mail_attachments(p_thread text, p_org uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public, app_private' as $function$
declare v_items jsonb; v_carrier jsonb := null;
begin
  if not public.has_global_permission('documents.review') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_thread is null or btrim(p_thread) = '' then return jsonb_build_object('items', '[]'::jsonb); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'mail_id', m.id, 'account', d.account_id, 'dmail_id', d.id,
           'idx', (a->>'idx')::int, 'name', a->>'name', 'type', a->>'type', 'size', (a->>'size')::bigint,
           'from', m.peer_email, 'at', m.created_at, 'subject', m.subject)
         order by m.created_at desc, (a->>'idx')::int), '[]'::jsonb)
    into v_items
    from app_private.mail_messages m
    join app_private.dmail_accounts acc on lower(acc.address) = lower(m.mailbox)
    join app_private.dmail_messages d on d.account_id = acc.id and d.message_id = m.provider_message_id
    cross join lateral jsonb_array_elements(coalesce(d.attachments, '[]'::jsonb)) a
   where m.thread_key = p_thread and m.direction = 'in'
     and m.provider_message_id is not null
     and coalesce((a->>'inline')::boolean, false) = false;

  if p_org is not null then
    select jsonb_build_object('user_id', o.owner_user_id, 'name', o.name)
      into v_carrier
      from public.organizations o
     where o.id = p_org and o.kind::text = 'carrier' and o.owner_user_id is not null;
  end if;

  return jsonb_build_object('items', v_items, 'carrier', v_carrier);
end $function$;

revoke execute on function public.cc_mail_attachments(text, uuid) from public, anon;
grant execute on function public.cc_mail_attachments(text, uuid) to authenticated;
