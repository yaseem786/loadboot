-- bl_dmail_0489 — Dispatcher mailbox ALIAS MODE (28 Sep 2026, owner request).
-- Why: every dispatcher needed a paid Namecheap mailbox (~USD 21/yr). Namecheap lets one mailbox carry aliases
-- (Launch plan: 10, no extra cost) and send FROM an alias — but all alias mail lands in the ONE main mailbox.
-- How: the main mailbox ("hub") is added once with its password and stays STAFF-ONLY. Each alias is added as its own
-- account row with parent_id = hub (no password of its own). Only hubs are synced over IMAP. Every hub message is
-- copied ("routed") to the alias account(s) it belongs to:
--   inbox / spam / trash -> the alias is in To / Cc / Bcc or in a Delivered-To / X-Original-To header (rcpts)
--   sent                 -> From = the alias
-- A dispatcher is assigned the ALIAS account, so the existing inbox RPCs (all scoped by account_id) show them only
-- their own mail. Mail that matches no alias stays hub-only (staff see it) — it is never guessed onto a dispatcher.
-- Sending: SMTP login = hub credentials, From = alias (Namecheap allows send-as for the mailbox's own aliases).
-- Guards (trigger): a hub that has aliases can never be assigned to a dispatcher; an alias's parent must be an
-- unassigned hub on the same domain. ADDITIVE + reversible: new columns default to "no alias", and with no alias
-- rows every redefined function behaves exactly as before. Nothing granted to anon.

alter table app_private.dmail_accounts add column if not exists parent_id uuid references app_private.dmail_accounts(id) on delete restrict;
alter table app_private.dmail_messages add column if not exists rcpts text[] not null default '{}';
alter table app_private.dmail_messages add column if not exists routed boolean not null default false;
create index if not exists dmail_accounts_parent on app_private.dmail_accounts (parent_id) where parent_id is not null;

-- ---------- guard trigger ----------
create or replace function app_private.dmail_alias_guard() returns trigger
language plpgsql security definer set search_path = app_private, public as $$
declare h app_private.dmail_accounts;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'an alias cannot point at itself'; end if;
    select * into h from dmail_accounts where id = new.parent_id;
    if h.id is null or h.parent_id is not null then raise exception 'the main mailbox for this alias was not found'; end if;
    if h.assigned_to is not null then raise exception 'the main mailbox % is assigned to a dispatcher — unassign it first (it holds every alias''s mail)', h.address; end if;
    if split_part(new.address, '@', 2) <> split_part(h.address, '@', 2) then raise exception 'an alias must be on the same domain as its main mailbox'; end if;
  end if;
  if new.assigned_to is not null and new.parent_id is null and exists (select 1 from dmail_accounts c where c.parent_id = new.id) then
    raise exception 'this is a main mailbox with aliases — it stays staff-only. Assign one of its aliases instead';
  end if;
  return new;
end $$;
drop trigger if exists trg_dmail_alias_guard on app_private.dmail_accounts;
create trigger trg_dmail_alias_guard before insert or update of parent_id, assigned_to, address on app_private.dmail_accounts
  for each row execute function app_private.dmail_alias_guard();

-- ---------- routing: copy one hub message to every alias it belongs to ----------
create or replace function app_private.dmail_route(p_msg uuid) returns int
language plpgsql security definer set search_path = app_private, public as $$
declare m app_private.dmail_messages; al record; n int := 0; v_rc int; v_thread text; v_existing uuid; v_hit boolean;
begin
  select * into m from dmail_messages where id = p_msg;
  if m.id is null or m.folder = 'drafts' then return 0; end if;
  for al in select a.id, a.address from dmail_accounts a where a.parent_id = m.account_id loop
    if m.folder = 'sent' then v_hit := lower(coalesce(m.from_email,'')) = al.address;
    else v_hit := al.address = any(m.rcpts) or exists (
      select 1 from jsonb_array_elements(coalesce(m.to_addrs,'[]') || coalesce(m.cc_addrs,'[]') || coalesce(m.bcc_addrs,'[]')) x where lower(x->>'email') = al.address);
    end if;
    continue when not v_hit;
    -- a portal-sent copy stored before the IMAP uid was known: attach the uid instead of duplicating it
    v_existing := null;
    if m.message_id is not null then
      select id into v_existing from dmail_messages where account_id = al.id and folder = m.folder and imap_uid is null and message_id = m.message_id limit 1;
    end if;
    if v_existing is not null then
      update dmail_messages set imap_uid = m.imap_uid, uidvalidity = m.uidvalidity, updated_at = now() where id = v_existing;
      update dmail_messages set routed = true where id = m.id; continue;
    end if;
    v_thread := null;
    if array_length(m.refs, 1) > 0 then
      select thread_key into v_thread from dmail_messages where account_id = al.id and message_id = any(m.refs) order by msg_date limit 1;
    end if;
    if v_thread is null and m.message_id is not null then
      select thread_key into v_thread from dmail_messages where account_id = al.id and refs @> array[m.message_id] limit 1;
    end if;
    insert into dmail_messages (account_id, folder, imap_uid, uidvalidity, message_id, in_reply_to, refs, thread_key, from_name, from_email,
      to_addrs, cc_addrs, bcc_addrs, subject, snippet, body_text, body_html, attachments, has_attach, seen, starred, answered, msg_date, size_bytes, rcpts)
    values (al.id, m.folder, m.imap_uid, m.uidvalidity, m.message_id, m.in_reply_to, m.refs, coalesce(v_thread, m.thread_key), m.from_name, m.from_email,
      m.to_addrs, m.cc_addrs, m.bcc_addrs, m.subject, m.snippet, m.body_text, m.body_html, m.attachments, m.has_attach, m.seen, m.starred, m.answered, m.msg_date, m.size_bytes, m.rcpts)
    on conflict (account_id, folder, uidvalidity, imap_uid) where imap_uid is not null do nothing;
    get diagnostics v_rc = row_count; n := n + v_rc;
    update dmail_messages set routed = true where id = m.id;
  end loop;
  return n;
end $$;
revoke all on function app_private.dmail_route(uuid) from public, anon, authenticated;
revoke all on function app_private.dmail_alias_guard() from public, anon, authenticated;

-- ---------- ingest: + rcpts, + route to aliases (body otherwise identical to bl_dmail_0356) ----------
create or replace function public.dmail_ingest(p_account uuid, p_folder text, p_uidvalidity bigint, p_msgs jsonb) returns int
language plpgsql security definer set search_path = app_private, public as $$
declare m jsonb; n int := 0; v_thread text; v_mid text; v_refs text[]; v_existing uuid; v_rc int; v_new uuid;
  v_has_alias boolean := exists (select 1 from app_private.dmail_accounts where parent_id = p_account);
begin
  for m in select * from jsonb_array_elements(coalesce(p_msgs,'[]'::jsonb)) loop
    v_mid := nullif(m->>'message_id',''); v_thread := null; v_existing := null; v_new := null;
    v_refs := coalesce(array(select jsonb_array_elements_text(coalesce(m->'refs','[]'::jsonb))), '{}');
    if nullif(m->>'in_reply_to','') is not null then v_refs := v_refs || (m->>'in_reply_to'); end if;
    if v_mid is not null then
      select id into v_existing from dmail_messages where account_id = p_account and folder = p_folder and imap_uid is null and message_id = v_mid limit 1;
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
    insert into dmail_messages (account_id, folder, imap_uid, uidvalidity, message_id, in_reply_to, refs, thread_key, from_name, from_email,
      to_addrs, cc_addrs, bcc_addrs, subject, snippet, body_text, body_html, attachments, has_attach, seen, starred, answered, msg_date, size_bytes, rcpts)
    values (p_account, p_folder, (m->>'uid')::bigint, p_uidvalidity, v_mid, nullif(m->>'in_reply_to',''), v_refs, v_thread,
      left(m->>'from_name', 300), lower(left(m->>'from_email', 320)), coalesce(m->'to','[]'), coalesce(m->'cc','[]'), coalesce(m->'bcc','[]'),
      left(m->>'subject', 998), left(m->>'snippet', 200), m->>'text', m->>'html', coalesce(m->'attachments','[]'),
      jsonb_array_length(coalesce(m->'attachments','[]')) > 0, coalesce((m->>'seen')::boolean, false) or p_folder = 'sent',
      coalesce((m->>'starred')::boolean, false), coalesce((m->>'answered')::boolean, false),
      coalesce(nullif(m->>'date','')::timestamptz, now()), nullif(m->>'size','')::int,
      coalesce(array(select lower(jsonb_array_elements_text(coalesce(m->'rcpt','[]'::jsonb)))), '{}'))
    on conflict (account_id, folder, uidvalidity, imap_uid) where imap_uid is not null do nothing
    returning id into v_new;
    get diagnostics v_rc = row_count; n := n + v_rc;
    if v_new is not null and v_has_alias then perform app_private.dmail_route(v_new); end if;
  end loop;
  return n;
end $$;

-- ---------- flags / folder reset reach the alias copies too (same IMAP folder + uid) ----------
create or replace function public.dmail_flags_apply(p_account uuid, p_folder text, p_uidvalidity bigint, p_lo bigint, p_hi bigint, p_flags jsonb) returns void
language plpgsql security definer set search_path = app_private, public as $$
declare v_accs uuid[] := array(select p_account union select id from app_private.dmail_accounts where parent_id = p_account);
begin
  update dmail_messages m set seen = (f->>'seen')::boolean, starred = (f->>'starred')::boolean, answered = (f->>'answered')::boolean, updated_at = now()
    from jsonb_array_elements(coalesce(p_flags,'[]'::jsonb)) f
   where m.account_id = any(v_accs) and m.folder = p_folder and m.uidvalidity = p_uidvalidity and m.imap_uid = (f->>'uid')::bigint
     and (m.seen, m.starred, m.answered) is distinct from ((f->>'seen')::boolean, (f->>'starred')::boolean, (f->>'answered')::boolean);
  delete from dmail_messages m where m.account_id = any(v_accs) and m.folder = p_folder and m.uidvalidity = p_uidvalidity
     and m.imap_uid between p_lo and p_hi
     and not exists (select 1 from jsonb_array_elements(coalesce(p_flags,'[]'::jsonb)) f where (f->>'uid')::bigint = m.imap_uid);
end $$;

create or replace function public.dmail_folder_reset(p_account uuid, p_folder text, p_uidvalidity bigint) returns void
language sql security definer set search_path = app_private, public as $$
  delete from dmail_messages where (account_id = p_account or account_id in (select id from dmail_accounts where parent_id = p_account))
    and folder = p_folder and imap_uid is not null and uidvalidity is distinct from p_uidvalidity;
$$;

-- ---------- sync targets: cron = hubs only; an alias resolves to its hub's login with its own identity ----------
create or replace function public.dmail_sync_targets(p_account uuid default null) returns jsonb
language sql security definer set search_path = app_private, public, vault as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'hub_id', h.id, 'is_alias', a.parent_id is not null,
      'address', a.address, 'display_name', a.display_name, 'username', h.username,
      'password', s.decrypted_secret, 'imap_host', h.imap_host, 'imap_port', h.imap_port, 'smtp_host', h.smtp_host, 'smtp_port', h.smtp_port,
      'folders', h.folders, 'status', a.status, 'signature_html', a.signature_html)), '[]'::jsonb)
  from dmail_accounts a join dmail_accounts h on h.id = coalesce(a.parent_id, a.id) join vault.decrypted_secrets s on s.id = h.secret_id
  where (select enabled from dmail_config where id = 1)
    and case when p_account is not null then a.id = p_account
             else a.parent_id is null and a.status in ('active','error') and (a.last_sync_at is null or a.last_sync_at < now() - interval '20 seconds') end;
$$;

-- ---------- access: a paused hub also closes its aliases ----------
create or replace function app_private.dmail_can(p_account uuid) returns boolean
language sql stable security definer set search_path = app_private, public as $$
  select auth.uid() is not null and (app_private.disp_is_staff() or exists (
    select 1 from app_private.dmail_accounts a join app_private.dispatcher_profiles d on d.user_id = a.assigned_to
      left join app_private.dmail_accounts h on h.id = a.parent_id
     where a.id = p_account and a.assigned_to = auth.uid() and a.status <> 'paused' and coalesce(h.status, 'active') <> 'paused'
       and d.status in ('trial','verified','active')))
     and coalesce((select enabled from app_private.dmail_config where id = 1), false);
$$;
revoke all on function app_private.dmail_can(uuid) from public, anon;

-- ---------- CC: add a mailbox OR an alias ----------
create or replace function public.cc_dmail_account_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public, vault as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_addr text := lower(btrim(coalesce(p->>'address',''))); v_pw text := nullif(p->>'password','');
  v_parent uuid := nullif(p->>'parent_id','')::uuid; a app_private.dmail_accounts; h app_private.dmail_accounts; v_secret uuid; v_routed int := 0;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if v_id is null then
    if v_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('error','a valid email address is required'); end if;
    if nullif(btrim(coalesce(p->>'display_name','')),'') is null then return jsonb_build_object('error','display name is required'); end if;
    if exists (select 1 from dmail_accounts where address = v_addr) then return jsonb_build_object('error','that mailbox is already added'); end if;
    if v_parent is not null then
      select * into h from dmail_accounts where id = v_parent and parent_id is null;
      if h.id is null then return jsonb_build_object('error','main mailbox not found'); end if;
      if h.assigned_to is not null then return jsonb_build_object('error', h.address || ' is assigned to a dispatcher — unassign it first. A main mailbox holds every alias''s mail, so it stays staff-only.'); end if;
      if split_part(v_addr,'@',2) <> split_part(h.address,'@',2) then return jsonb_build_object('error','the alias must be on the same domain as ' || h.address); end if;
      insert into dmail_accounts (address, display_name, username, parent_id, imap_host, imap_port, smtp_host, smtp_port, status, created_by)
        values (v_addr, btrim(p->>'display_name'), h.username, h.id, h.imap_host, h.imap_port, h.smtp_host, h.smtp_port, 'active', auth.uid()) returning * into a;
      update dmail_accounts set signature_html = case when p ? 'signature_html' then left(coalesce(p->>'signature_html',''), 20000) else signature_html end where id = a.id;
      -- mail already in the hub for this alias shows up at once
      select coalesce(sum(app_private.dmail_route(m.id)), 0) into v_routed from dmail_messages m where m.account_id = h.id and m.folder <> 'drafts';
      perform app_private.disp_audit('dmail.alias_add', 'dmail_account', a.id::text, null, a.address || ' (alias of ' || h.address || ')', jsonb_build_object('hub', h.id));
      return jsonb_build_object('ok', true, 'id', a.id, 'needs_verify', false, 'alias', true, 'routed', v_routed);
    end if;
    if v_pw is null then return jsonb_build_object('error','the mailbox password is required'); end if;
    insert into dmail_accounts (address, display_name, username, created_by) values (v_addr, btrim(p->>'display_name'), v_addr, auth.uid()) returning * into a;
  else
    select * into a from dmail_accounts where id = v_id;
    if a.id is null then return jsonb_build_object('error','mailbox not found'); end if;
    if a.parent_id is not null then
      if v_pw is not null then return jsonb_build_object('error','an alias has no password of its own — it uses its main mailbox''s login'); end if;
      update dmail_accounts set display_name = coalesce(nullif(btrim(p->>'display_name'),''), display_name),
        signature_html = case when p ? 'signature_html' then left(coalesce(p->>'signature_html',''), 20000) else signature_html end, updated_at = now() where id = a.id;
      perform app_private.disp_audit('dmail.account_save', 'dmail_account', a.id::text, null, a.address || ' (alias)', '{}'::jsonb);
      return jsonb_build_object('ok', true, 'id', a.id, 'needs_verify', false);
    end if;
  end if;
  update dmail_accounts set
    display_name = coalesce(nullif(btrim(p->>'display_name'),''), display_name),
    signature_html = case when p ? 'signature_html' then left(coalesce(p->>'signature_html',''), 20000) else signature_html end,
    imap_host = coalesce(nullif(p->>'imap_host',''), imap_host), imap_port = coalesce(nullif(p->>'imap_port','')::int, imap_port),
    smtp_host = coalesce(nullif(p->>'smtp_host',''), smtp_host), smtp_port = coalesce(nullif(p->>'smtp_port','')::int, smtp_port),
    username = coalesce(nullif(p->>'username',''), username), updated_at = now() where id = a.id;
  -- a hub's host / login change must reach its aliases (they borrow it)
  update dmail_accounts c set imap_host = h2.imap_host, imap_port = h2.imap_port, smtp_host = h2.smtp_host, smtp_port = h2.smtp_port, username = h2.username
    from dmail_accounts h2 where h2.id = a.id and c.parent_id = a.id;
  if v_pw is not null then
    if a.secret_id is null then
      v_secret := vault.create_secret(v_pw, 'dmail:' || a.id::text, 'Dispatcher mailbox password for ' || a.address);
      update dmail_accounts set secret_id = v_secret, status = 'unverified', last_error = null where id = a.id;
    else
      perform vault.update_secret(a.secret_id, v_pw);
      update dmail_accounts set status = 'unverified', last_error = null where id = a.id;
    end if;
  end if;
  perform app_private.disp_audit('dmail.account_save', 'dmail_account', a.id::text, null, a.address || case when v_pw is not null then ' (password set)' else '' end, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', a.id, 'needs_verify', v_pw is not null);
end $$;

create or replace function public.cc_dmail_set_status(p_account uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if p_status not in ('active','paused') then return jsonb_build_object('error','bad status'); end if;
  update dmail_accounts set status = case when p_status = 'active' and secret_id is null and parent_id is null then 'unverified' else p_status end, updated_at = now() where id = p_account;
  perform app_private.disp_audit('dmail.status', 'dmail_account', p_account::text, null, p_status, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- CC overview: + alias fields; an alias shows its hub's connection health ----------
create or replace function public.cc_dmail_overview() returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object(
    'enabled', (select enabled from dmail_config where id = 1),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'address', a.address, 'display_name', a.display_name,
        'signature_html', a.signature_html,
        'status', case when a.parent_id is null or a.status = 'paused' then a.status when h.status = 'paused' then 'paused' else h.status end,
        'has_password', coalesce(h.secret_id, a.secret_id) is not null,
        'parent_id', a.parent_id, 'parent_address', h.address, 'is_alias', a.parent_id is not null,
        'alias_count', (select count(*) from dmail_accounts c where c.parent_id = a.id),
        'aliases', (select coalesce(jsonb_agg(c.address order by c.address), '[]'::jsonb) from dmail_accounts c where c.parent_id = a.id),
        'assigned_to', a.assigned_to, 'assigned_name', d.full_name, 'assigned_at', a.assigned_at,
        'last_sync_at', coalesce(h.last_sync_at, a.last_sync_at), 'last_ok_at', coalesce(h.last_ok_at, a.last_ok_at), 'last_error', coalesce(h.last_error, a.last_error),
        'imap_host', a.imap_host, 'imap_port', a.imap_port, 'smtp_host', a.smtp_host, 'smtp_port', a.smtp_port, 'username', a.username,
        'unread', (select count(*) from dmail_messages m where m.account_id = a.id and m.folder = 'inbox' and not m.seen),
        'received_7d', (select count(*) from dmail_messages m where m.account_id = a.id and m.folder = 'inbox' and m.msg_date > now() - interval '7 days'),
        'sent_7d', (select count(*) from dmail_messages m where m.account_id = a.id and m.folder = 'sent' and m.msg_date > now() - interval '7 days'))
        order by coalesce(h.created_at, a.created_at), a.parent_id nulls first, a.created_at)
      from dmail_accounts a left join dmail_accounts h on h.id = a.parent_id left join dispatcher_profiles d on d.user_id = a.assigned_to), '[]'::jsonb),
    'dispatchers', coalesce((select jsonb_agg(jsonb_build_object('user_id', d.user_id, 'name', d.full_name, 'status', d.status) order by d.full_name)
      from dispatcher_profiles d where d.status in ('trial','verified','active')), '[]'::jsonb));
end $$;

-- ---------- CC activity: the all-mailboxes feed skips hub copies that were routed to an alias (no double rows) ----------
create or replace function public.cc_dmail_activity(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_acc uuid := nullif(p->>'account','')::uuid; v_dir text := nullif(p->>'dir',''); v_q text := nullif(btrim(coalesce(p->>'q','')),'');
  v_before timestamptz := nullif(p->>'before','')::timestamptz; v_limit int := least(greatest(coalesce((p->>'limit')::int, 60), 1), 200);
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object(
    'today', (select jsonb_build_object('received', count(*) filter (where folder <> 'sent'), 'sent', count(*) filter (where folder = 'sent'),
                'unread', (select count(*) from dmail_messages where folder = 'inbox' and not seen and not routed),
                'waiting', (select count(*) from dmail_messages where folder = 'inbox' and not answered and not routed and msg_date > now() - interval '7 days'))
              from dmail_messages where folder <> 'drafts' and not routed and msg_date >= date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York'),
    'rows', coalesce((select jsonb_agg(r order by (r->>'date') desc) from (
      select jsonb_build_object('id', m.id, 'account', m.account_id, 'address', a.address, 'assigned_name', d.full_name, 'folder', m.folder,
        'dir', case when m.folder = 'sent' then 'out' else 'in' end, 'from_name', m.from_name, 'from_email', m.from_email, 'to', m.to_addrs,
        'subject', m.subject, 'snippet', m.snippet, 'date', m.msg_date, 'thread', m.thread_key, 'seen', m.seen, 'answered', m.answered,
        'has_attach', m.has_attach, 'is_reply', m.in_reply_to is not null,
        'sent_by', case when m.folder = 'sent' then coalesce(sb.full_name, case when m.sent_by is null then 'Webmail / other' else 'LoadBoot staff' end) end) r
      from dmail_messages m join dmail_accounts a on a.id = m.account_id
        left join dispatcher_profiles d on d.user_id = a.assigned_to left join dispatcher_profiles sb on sb.user_id = m.sent_by
      where m.folder <> 'drafts' and (v_acc is null or m.account_id = v_acc) and (v_acc is not null or not m.routed)
        and (v_dir is null or (v_dir = 'out') = (m.folder = 'sent'))
        and (v_before is null or m.msg_date < v_before)
        and (v_q is null or m.fts @@ plainto_tsquery('simple', v_q) or m.subject ilike '%' || v_q || '%' or m.from_email ilike '%' || v_q || '%' or m.to_addrs::text ilike '%' || v_q || '%')
      order by m.msg_date desc limit v_limit) s), '[]'::jsonb));
end $$;

revoke all on function public.cc_dmail_activity(jsonb) from public, anon;
grant execute on function public.cc_dmail_activity(jsonb) to authenticated;
revoke all on function public.cc_dmail_overview() from public, anon;
grant execute on function public.cc_dmail_overview() to authenticated;
revoke all on function public.cc_dmail_account_save(jsonb) from public, anon;
grant execute on function public.cc_dmail_account_save(jsonb) to authenticated;
revoke all on function public.cc_dmail_set_status(uuid,text) from public, anon;
grant execute on function public.cc_dmail_set_status(uuid,text) to authenticated;
do $$ declare f text; begin
  foreach f in array array['public.dmail_ingest(uuid,text,bigint,jsonb)','public.dmail_flags_apply(uuid,text,bigint,bigint,bigint,jsonb)',
    'public.dmail_folder_reset(uuid,text,bigint)','public.dmail_sync_targets(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
notify pgrst, 'reload schema';
