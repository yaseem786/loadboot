-- Recover CC mail missing from the relay using the existing Namecheap IMAP sync.
alter table app_private.mail_messages add column if not exists imap_source_id uuid;

create or replace function app_private.mail_inbound_key(p_message_id text, p_mailbox text)
returns text language sql immutable strict
set search_path = pg_catalog
as $$
  select p_mailbox || ':' || nullif(lower(trim(both '<>' from btrim(p_message_id))), '')
$$;

revoke execute on function app_private.mail_inbound_key(text, text) from public, anon, authenticated;

create index if not exists mail_messages_provider_identity
on app_private.mail_messages (direction, app_private.mail_inbound_key(provider_message_id, mailbox));

create index if not exists dmail_messages_reconcile_date
on app_private.dmail_messages (created_at) where folder in ('inbox', 'sent') and not routed;

CREATE OR REPLACE FUNCTION public.cc_mail_ingest(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare
  v_id uuid; v_thread text; v_subj text; v_raw_from text; v_from text; v_to text;
  v_class text; v_folder text; v_mail_key text;
begin
  p := app_private.mail_normalize_payload(p); -- bl_mail_0601
  v_raw_from := lower(coalesce(p->>'from_email',''));
  v_to       := lower(coalesce(p->>'to_email',''));
  if v_raw_from = '' or v_to = '' then raise exception 'from/to required'; end if;
  v_from := app_private.mail_unwrap_srs(v_raw_from);
  v_subj := coalesce(p->>'subject','(no subject)');
  v_mail_key := app_private.mail_inbound_key(p->>'message_id', v_to);
  if v_mail_key is not null then
    -- Use the same recipient as the existing Yaseen mailbox routing trigger.
    if v_to = 'hello@loadboot.com' and exists (
      select 1 from app_private.dmail_messages d
      join app_private.dmail_accounts a on a.id = d.account_id
      where a.address = v_to and d.message_id = p->>'message_id'
        and d.rcpts @> array['yaseen@loadboot.com']
    ) then
      v_to := 'yaseen@loadboot.com';
      v_mail_key := app_private.mail_inbound_key(p->>'message_id', v_to);
    end if;
    perform pg_advisory_xact_lock(pg_catalog.hashtextextended(v_mail_key, 0));
    select m.id into v_id from app_private.mail_messages m
    where m.direction = 'in'
      and app_private.mail_inbound_key(m.provider_message_id, m.mailbox) = v_mail_key
    order by m.created_at limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  v_thread := v_from || ':' || regexp_replace(lower(v_subj), '^((re|fwd?)\s*:\s*)+', '', 'i');

  v_class  := app_private.mail_classify(v_from, v_subj, p->>'body_text');
  v_folder := case when v_class = 'human' then 'inbox' else 'system' end;

  insert into app_private.mail_messages(raw_mime, direction, mailbox, peer_email, peer_name, subject, body_text, body_html,
                                        provider_message_id, in_reply_to, thread_key,
                                        folder, mail_class, envelope_from, read_at)
    values (p->>'raw_mime', 'in', v_to, v_from, nullif(p->>'from_name',''), v_subj, p->>'body_text', p->>'body_html',
            nullif(p->>'message_id',''), nullif(p->>'in_reply_to',''), v_thread,
            v_folder, v_class, nullif(v_raw_from, v_from),
            case when v_folder = 'system' then now() else null end)
    returning id into v_id;

  if v_folder = 'inbox' then
    begin
      insert into app_private.notifications(recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
      values ('staff', null, 'in_app', 'mail.inbound',
        jsonb_build_object('title', '📧 ' || coalesce(nullif(p->>'from_name',''), v_from), 'body', v_subj || ' — reply from the CC Mailbox.', 'tone', 'action', 'url', '/app/command-center/#mailbox'), 'sent', now());
    exception when others then null; end;
  end if;
  return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION app_private.trg_mail_work_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private', 'public'
AS $function$
declare s app_private.mail_thread_state; v_urg text; v_reason text; v_owner uuid; v_due timestamptz;
begin
  if new.thread_key is null then return new; end if;
  -- Historical imports must not change the state of a conversation with newer mail.
  if new.imap_source_id is not null and exists (
    select 1 from app_private.mail_messages m
    where m.thread_key = new.thread_key and m.id <> new.id
      and coalesce(m.sent_at, m.created_at) > coalesce(new.sent_at, new.created_at)
      and m.status in ('sent', 'received')
  ) then
    return new;
  end if;
  if tg_op = 'INSERT' and new.direction = 'in' and new.folder = 'inbox'
     and coalesce(new.urgency, 'none') in ('urgent','high','normal','low') then
    select default_owner into v_owner from app_private.mail_settings where id = 1;
    insert into app_private.mail_thread_state (thread_key, updated_at) values (new.thread_key, now()) on conflict (thread_key) do nothing;
    select * into s from app_private.mail_thread_state where thread_key = new.thread_key for update;
    if s.work_status = 'open' and s.reply_due_at is not null then
      v_urg := app_private.mail_urgency_up(app_private.greatest_urgency(s.urgency, new.urgency));
      v_reason := 'wrote again before we replied';
      v_due := least(s.reply_due_at, app_private.mail_due_at(new.created_at, v_urg));
      update app_private.mail_thread_state set urgency = v_urg, urgency_reason = v_reason, reply_due_at = v_due,
             last_in_at = new.created_at, owner_user_id = coalesce(owner_user_id, v_owner), updated_at = now()
       where thread_key = new.thread_key;
      if v_urg is distinct from s.urgency then
        insert into app_private.mail_thread_events (thread_key, kind, detail) values (new.thread_key, 'urgency_up', jsonb_build_object('from', s.urgency, 'to', v_urg));
      end if;
    else
      v_due := app_private.mail_due_at(new.created_at, new.urgency);
      update app_private.mail_thread_state set work_status = 'open', urgency = new.urgency, urgency_reason = new.urgency_reason,
             last_in_at = new.created_at, sla_start_at = new.created_at, reply_due_at = v_due, sla_level = 0, follow_up = false,
             archived_at = null, owner_user_id = coalesce(owner_user_id, v_owner), updated_at = now()
       where thread_key = new.thread_key;
      insert into app_private.mail_thread_events (thread_key, kind, detail)
      values (new.thread_key, 'opened', jsonb_build_object('urgency', new.urgency, 'due', v_due, 'role', new.sender_role));
    end if;
  elsif new.direction = 'out' and new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    insert into app_private.mail_thread_state (thread_key, updated_at) values (new.thread_key, now()) on conflict (thread_key) do nothing;
    select * into s from app_private.mail_thread_state where thread_key = new.thread_key for update;
    update app_private.mail_thread_state set work_status = 'waiting', last_out_at = coalesce(new.sent_at, now()),
           first_reply_at = coalesce(first_reply_at, case when last_in_at is not null then coalesce(new.sent_at, now()) end),
           sla_start_at = coalesce(new.sent_at, now()), reply_due_at = null, sla_level = 0, follow_up = false, updated_at = now()
     where thread_key = new.thread_key;
    insert into app_private.mail_thread_events (thread_key, kind, actor, detail)
    values (new.thread_key, 'replied', coalesce(new.sent_by, new.created_by), jsonb_build_object(
      'late', s.reply_due_at is not null and now() > s.reply_due_at,
      'seconds', case when s.work_status = 'open' and s.sla_start_at is not null then extract(epoch from (coalesce(new.sent_at, now()) - s.sla_start_at))::int end));
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.cc_mail_attachments(p_thread text, p_org uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public, app_private'
AS $function$
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
    join lateral (
      select dm.* from app_private.dmail_messages dm
      join app_private.dmail_accounts acc on acc.id = dm.account_id
      where dm.id = m.imap_source_id
         or (m.imap_source_id is null and acc.address = m.mailbox
             and dm.message_id = m.provider_message_id)
      order by (dm.imap_box is null) desc, dm.created_at
      limit 1
    ) d on true
    cross join lateral jsonb_array_elements(coalesce(d.attachments, '[]'::jsonb)) a
   where m.thread_key = p_thread and (m.direction = 'in' or m.imap_source_id is not null)
     and coalesce((a->>'inline')::boolean, false) = false;

  if p_org is not null then
    select jsonb_build_object('user_id', o.owner_user_id, 'name', o.name)
      into v_carrier
      from public.organizations o
     where o.id = p_org and o.kind::text = 'carrier' and o.owner_user_id is not null;
  end if;

  return jsonb_build_object('items', v_items, 'carrier', v_carrier);
end $function$
;


create or replace function app_private.mail_imap_candidates(p_since timestamptz)
returns table (
  source_id uuid, direction text, mailbox text, peer_email text, peer_name text,
  message_id text, reply_id text, subject text, body_text text, body_html text,
  message_at timestamptz, sent_by uuid
)
language sql stable
set search_path = pg_catalog, app_private
as $$
  with synced as (
    select m.*, a.address,
      array(select distinct lower(x->>'email')
            from jsonb_array_elements(m.to_addrs || m.cc_addrs || m.bcc_addrs) x
            where lower(x->>'email') like '%@loadboot.com') as addressed,
      case m.imap_box when 'x:INBOX/Dispatch' then 'dispatch@loadboot.com'
                      when 'x:INBOX/Billing' then 'billing@loadboot.com' end as folder_address
    from app_private.dmail_messages m
    join app_private.dmail_accounts a on a.id = m.account_id and a.parent_id is null
    where a.address in ('hello@loadboot.com', 'dispatch@loadboot.com', 'billing@loadboot.com', 'yaseen@loadboot.com')
      and not m.routed and m.folder in ('inbox', 'sent')
      and (p_since is null or m.created_at >= p_since)
      and m.created_at <= now() - interval '3 minutes'
  ), recipients as (
    select s.*,
      case
        when folder = 'sent' and from_email = address then array[address]
        when folder = 'sent' then '{}'::text[]
        when address = 'hello@loadboot.com' and 'yaseen@loadboot.com' = any(addressed || rcpts)
          then array['yaseen@loadboot.com']
        when folder_address is not null then array[folder_address]
        when address = any(addressed) then array[address]
        when address = 'hello@loadboot.com' and cardinality(addressed) > 0 then '{}'::text[]
        else array[address]
      end as destinations
    from synced s
  ), resolved as (
    select m.id, case when m.folder = 'sent' then 'out' else 'in' end as direction,
      b.address as mailbox,
      case when m.folder = 'sent' then lower(peer.email)
           else app_private.mail_unwrap_srs(lower(m.from_email)) end as peer_email,
      case when m.folder = 'sent' then peer.name else m.from_name end as peer_name,
      coalesce(nullif(m.message_id, ''), '<imap-' || m.id::text || '@loadboot.com>') as message_id,
      m.in_reply_to, m.subject, m.body_text, m.body_html,
      coalesce(m.msg_date, m.created_at) as message_at, m.sent_by,
      b.address = m.address as direct, m.imap_box
    from recipients m
    cross join lateral unnest(m.destinations) as dest(address)
    join app_private.mail_boxes b on b.address = dest.address
      and b.address in ('hello@loadboot.com', 'dispatch@loadboot.com', 'billing@loadboot.com', 'yaseen@loadboot.com')
    left join lateral (
      select x->>'email' email, x->>'name' name
      from jsonb_array_elements(m.to_addrs || m.cc_addrs || m.bcc_addrs) x
      where nullif(x->>'email', '') is not null limit 1
    ) peer on m.folder = 'sent'
  )
  select distinct on (r.direction, app_private.mail_inbound_key(r.message_id, r.mailbox))
    r.id, r.direction, r.mailbox, r.peer_email, r.peer_name, r.message_id,
    r.in_reply_to, r.subject, r.body_text, r.body_html, r.message_at, r.sent_by
  from resolved r
  where nullif(r.peer_email, '') is not null
  order by r.direction, app_private.mail_inbound_key(r.message_id, r.mailbox),
    r.direct desc, (r.imap_box is null) desc, r.id
$$;

revoke execute on function app_private.mail_imap_candidates(timestamptz) from public, anon, authenticated;

create or replace function app_private.mail_reconcile_imap(p_since timestamptz, p_limit integer default 60)
returns integer
language plpgsql
set search_path = pg_catalog, app_private
as $$
declare
  item record;
  mail_key text;
  mail_subject text;
  mail_thread text;
  recovered integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('mail_reconcile_imap', 0)) then
    return 0;
  end if;

  for item in
    select s.* from app_private.mail_imap_candidates(p_since) s
    where not exists (
      select 1 from app_private.mail_messages c
      where c.direction = s.direction
        and app_private.mail_inbound_key(c.provider_message_id, c.mailbox)
          = app_private.mail_inbound_key(s.message_id, s.mailbox)
    )
    order by s.message_at, s.source_id
    limit greatest(1, least(coalesce(p_limit, 60), 200))
  loop
    mail_key := app_private.mail_inbound_key(item.message_id, item.mailbox);
    if not pg_try_advisory_xact_lock(hashtextextended(mail_key, 0)) then
      continue;
    end if;
    if exists (
      select 1 from app_private.mail_messages c
      where c.direction = item.direction
        and app_private.mail_inbound_key(c.provider_message_id, c.mailbox) = mail_key
    ) then
      continue;
    end if;

    mail_subject := coalesce(nullif(item.subject, ''), '(no subject)');
    mail_thread := null;
    if item.reply_id is not null then
      select c.thread_key into mail_thread from app_private.mail_messages c
      where c.mailbox = item.mailbox and c.peer_email = item.peer_email
        and c.provider_message_id = item.reply_id
      order by c.created_at desc limit 1;
    end if;
    mail_thread := coalesce(mail_thread, item.peer_email || ':' ||
      regexp_replace(lower(mail_subject), '^((re|fwd?)\s*:\s*)+', '', 'i'));

    insert into app_private.mail_messages (
      direction, mailbox, peer_email, peer_name, subject, body_text, body_html,
      provider_message_id, in_reply_to, thread_key, created_at, status, folder,
      mail_class, read_at, sent_at, sent_by, imap_source_id
    ) values (
      item.direction, item.mailbox, item.peer_email, item.peer_name, mail_subject,
      item.body_text, item.body_html, item.message_id, item.reply_id,
      mail_thread, item.message_at, case when item.direction = 'in' then 'received' else 'sent' end,
      'inbox', 'manual', case when item.direction = 'out' then item.message_at end,
      case when item.direction = 'out' then item.message_at end, item.sent_by, item.source_id
    );
    recovered := recovered + 1;
  end loop;
  return recovered;
end
$$;

revoke execute on function app_private.mail_reconcile_imap(timestamptz, integer) from public, anon, authenticated;

select cron.schedule('cc-mail-imap-reconcile', '*/2 * * * *',
  $job$select app_private.mail_reconcile_imap(now() - interval '7 days', 60)$job$);
