-- bl_mail_0576 — CC mailbox phase 0: sync EVERY IMAP folder, not only Inbox/Sent/Spam/Trash
-- PrivateEmail server rules file mail into folders (Dispatch, Billing, DMARC). CC never synced them, so ~1,050 emails
-- were invisible in CC (the GEICO COI for Prime Freight among them). Now the dmail sync also reads every other
-- selectable IMAP folder. Each such folder is a "box" keyed 'x:<path>' in dmail_accounts.folders and its mail is shown
-- in a CC folder: DMARC / Archive folders → 'archive' (kept, not in Inbox), everything else → 'inbox'.
-- dmail_messages.imap_box remembers the real server folder so flags, moves, deletes and attachments act on the right
-- IMAP folder; NULL means the server folder is the CC folder itself (all existing rows — nothing changes for them).
-- Per-box override: folders->'x:<path>'->>'into' ('inbox' | 'archive') and ->>'sync' = 'false' to skip a box.

alter table app_private.dmail_messages add column if not exists imap_box text;

alter table app_private.dmail_messages drop constraint if exists dmail_messages_folder_check;
alter table app_private.dmail_messages add constraint dmail_messages_folder_check
  check (folder = any (array['inbox','sent','drafts','spam','trash','archive']));

drop index if exists app_private.dmail_messages_uid;
create unique index dmail_messages_uid on app_private.dmail_messages (account_id, (coalesce(imap_box, folder)), uidvalidity, imap_uid)
  where imap_uid is not null;

-- ingest: p_folder is a CC role ('inbox','sent','spam','trash') or a box 'x:<path>'
create or replace function public.dmail_ingest(p_account uuid, p_folder text, p_uidvalidity bigint, p_msgs jsonb)
returns integer language plpgsql security definer set search_path to 'app_private', 'public' as $function$
declare m jsonb; n int := 0; v_thread text; v_mid text; v_refs text[]; v_existing uuid; v_rc int; v_new uuid;
  v_has_alias boolean := exists (select 1 from app_private.dmail_accounts where parent_id = p_account);
  v_box text := case when p_folder like 'x:%' then p_folder end;
  v_folder text;
begin
  if v_box is null then v_folder := p_folder;
  else
    select nullif(folders->p_folder->>'into','') into v_folder from app_private.dmail_accounts where id = p_account;
    v_folder := coalesce(v_folder, case when p_folder ~* '(dmarc|archive)' then 'archive' else 'inbox' end);
    if v_folder not in ('inbox','archive') then v_folder := 'inbox'; end if;
  end if;
  for m in select * from jsonb_array_elements(coalesce(p_msgs,'[]'::jsonb)) loop
    v_mid := nullif(m->>'message_id',''); v_thread := null; v_existing := null; v_new := null;
    v_refs := coalesce(array(select jsonb_array_elements_text(coalesce(m->'refs','[]'::jsonb))), '{}');
    if nullif(m->>'in_reply_to','') is not null then v_refs := v_refs || (m->>'in_reply_to'); end if;
    if v_mid is not null and v_box is null then
      select id into v_existing from dmail_messages where account_id = p_account and folder = p_folder and imap_box is null and imap_uid is null and message_id = v_mid limit 1;
    end if;
    if v_existing is not null then
      update dmail_messages set imap_uid = (m->>'uid')::bigint, uidvalidity = p_uidvalidity, updated_at = now() where id = v_existing;
      if v_has_alias then perform app_private.dmail_route(v_existing); end if;
      continue;
    end if;
    if array_length(v_refs, 1) > 0 then
      select thread_key into v_thread from dmail_messages where account_id = p_account and message_id = any(v_refs) order by msg_date limit 1;
    end if;
    if v_thread is null and v_mid is not null then
      select thread_key into v_thread from dmail_messages where account_id = p_account and refs @> array[v_mid] limit 1;
    end if;
    v_thread := coalesce(v_thread, v_mid, 'uid:' || p_folder || ':' || (m->>'uid'));
    insert into dmail_messages (account_id, folder, imap_box, imap_uid, uidvalidity, message_id, in_reply_to, refs, thread_key, from_name, from_email,
      to_addrs, cc_addrs, bcc_addrs, subject, snippet, body_text, body_html, attachments, has_attach, seen, starred, answered, msg_date, size_bytes, rcpts)
    values (p_account, v_folder, v_box, (m->>'uid')::bigint, p_uidvalidity, v_mid, nullif(m->>'in_reply_to',''), v_refs, v_thread,
      left(m->>'from_name', 300), lower(left(m->>'from_email', 320)), coalesce(m->'to','[]'), coalesce(m->'cc','[]'), coalesce(m->'bcc','[]'),
      left(m->>'subject', 998), left(m->>'snippet', 200), m->>'text', m->>'html', coalesce(m->'attachments','[]'),
      jsonb_array_length(coalesce(m->'attachments','[]')) > 0, coalesce((m->>'seen')::boolean, false) or v_folder = 'sent',
      coalesce((m->>'starred')::boolean, false), coalesce((m->>'answered')::boolean, false),
      coalesce(nullif(m->>'date','')::timestamptz, now()), nullif(m->>'size','')::int,
      coalesce(array(select lower(jsonb_array_elements_text(coalesce(m->'rcpt','[]'::jsonb)))), '{}'))
    on conflict (account_id, (coalesce(imap_box, folder)), uidvalidity, imap_uid) where imap_uid is not null do nothing
    returning id into v_new;
    get diagnostics v_rc = row_count; n := n + v_rc;
    if v_new is not null and v_has_alias then perform app_private.dmail_route(v_new); end if;
  end loop;
  return n;
end $function$;

-- flags / reset address the SERVER folder (role or box)
create or replace function public.dmail_flags_apply(p_account uuid, p_folder text, p_uidvalidity bigint, p_lo bigint, p_hi bigint, p_flags jsonb)
returns void language plpgsql security definer set search_path to 'app_private', 'public' as $function$
declare v_accs uuid[] := array(select p_account union select id from app_private.dmail_accounts where parent_id = p_account);
begin
  update dmail_messages m set seen = (f->>'seen')::boolean, starred = (f->>'starred')::boolean, answered = (f->>'answered')::boolean, updated_at = now()
    from jsonb_array_elements(coalesce(p_flags,'[]'::jsonb)) f
   where m.account_id = any(v_accs) and coalesce(m.imap_box, m.folder) = p_folder and m.uidvalidity = p_uidvalidity and m.imap_uid = (f->>'uid')::bigint
     and (m.seen, m.starred, m.answered) is distinct from ((f->>'seen')::boolean, (f->>'starred')::boolean, (f->>'answered')::boolean);
  delete from dmail_messages m where m.account_id = any(v_accs) and coalesce(m.imap_box, m.folder) = p_folder and m.uidvalidity = p_uidvalidity
     and m.imap_uid between p_lo and p_hi
     and not exists (select 1 from jsonb_array_elements(coalesce(p_flags,'[]'::jsonb)) f where (f->>'uid')::bigint = m.imap_uid);
end $function$;

create or replace function public.dmail_folder_reset(p_account uuid, p_folder text, p_uidvalidity bigint)
returns void language sql security definer set search_path to 'app_private', 'public' as $function$
  delete from dmail_messages where (account_id = p_account or account_id in (select id from dmail_accounts where parent_id = p_account))
    and coalesce(imap_box, folder) = p_folder and imap_uid is not null and uidvalidity is distinct from p_uidvalidity;
$function$;

-- refs: 'folder' = the SERVER folder the edge function acts on; 'cc_folder' = where CC shows it
create or replace function public.dmail_msg_refs(p_account uuid, p_ids uuid[])
returns jsonb language sql stable security definer set search_path to 'app_private', 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'folder', coalesce(imap_box, folder), 'cc_folder', folder, 'uid', imap_uid, 'uidvalidity', uidvalidity,
    'message_id', message_id, 'refs', refs, 'subject', subject, 'thread', thread_key)), '[]'::jsonb) from dmail_messages where account_id = p_account and id = any(p_ids);
$function$;

-- a moved message lives in its destination role folder on the server → imap_box is cleared
create or replace function public.dmail_msg_patch(p_account uuid, p_ids uuid[], p jsonb)
returns void language plpgsql security definer set search_path to 'app_private', 'public' as $function$
begin
  if coalesce((p->>'delete')::boolean, false) then
    delete from dmail_messages where account_id = p_account and id = any(p_ids); return;
  end if;
  update dmail_messages m set
    seen = coalesce((p->>'seen')::boolean, seen), starred = coalesce((p->>'starred')::boolean, starred), answered = coalesce((p->>'answered')::boolean, answered),
    folder = coalesce(nullif(p->>'folder',''), folder),
    imap_box = case when p ? 'folder' then null else imap_box end,
    imap_uid = case when p ? 'folder' then nullif(p->'uidmap'->>(m.imap_uid::text), '')::bigint else imap_uid end,
    uidvalidity = case when p ? 'folder' then nullif(p->>'uidvalidity','')::bigint else uidvalidity end,
    updated_at = now()
  where m.account_id = p_account and m.id = any(p_ids);
end $function$;
