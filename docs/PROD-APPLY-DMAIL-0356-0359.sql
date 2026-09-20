-- PROD APPLY — Dispatcher Mailbox bl_dmail_0356 → 0359 (built 20 Sep 2026). Run ONCE in the prod SQL editor (rwscphuhpjoudvljvmdk).
-- Additive only: new dmail_* tables/functions + cron 'dmail-sync-minutely' (does nothing until a mailbox is active).
-- Expected verify row at the end: anon_n=33, anon_hash=d38361ad79aa1a18f193050e1474fdb6, dmail_anon=0, sync_targets_auth=false, cron=1, fn_base=https://rwscphuhpjoudvljvmdk.supabase.co
-- Rollback: drop the dmail_* objects + select cron.unschedule('dmail-sync-minutely');
begin;

-- ===== migrations/bl_dmail_0356_dispatcher_mailbox.sql =====
-- bl_dmail_0356 — Dispatcher Mailbox: a real IMAP/SMTP mailbox (Namecheap Private Email) surfaced
-- inside the dispatcher portal. Staff add the mailbox + password in the Command Center (password goes
-- straight into Supabase Vault and is never returned to any browser), assign it to a dispatcher, and the
-- dispatcher gets a Gmail-style inbox with no login. The dmail edge function (cron sync 1/min +
-- user actions: send / flags / move / attachment / sync-now) do the IMAP+SMTP work.
--
-- SECURITY: every public function here is authenticated-only or service_role-only. NOTHING is granted
-- to anon — the anon-executable SECURITY DEFINER list must be unchanged after this migration.
-- ADDITIVE: new tables + new functions only. Rollback = drop the dmail_* objects + unschedule the cron.

create table if not exists app_private.dmail_config (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  cron_secret text not null default encode(gen_random_bytes(24), 'hex'),
  fn_base text,
  updated_at timestamptz not null default now(), updated_by uuid
);
insert into app_private.dmail_config (id) values (1) on conflict do nothing;

create table if not exists app_private.dmail_accounts (
  id uuid primary key default gen_random_uuid(),
  address text not null unique check (address = lower(address) and address like '%_@_%'),
  display_name text not null,
  signature_html text not null default '',
  imap_host text not null default 'mail.privateemail.com', imap_port int not null default 993,
  smtp_host text not null default 'mail.privateemail.com', smtp_port int not null default 465,
  username text not null,
  secret_id uuid,
  assigned_to uuid references auth.users(id) on delete set null, assigned_at timestamptz, assigned_by uuid,
  status text not null default 'unverified' check (status in ('unverified','active','paused','error')),
  folders jsonb not null default '{}'::jsonb,          -- role -> {path, uidvalidity, last_uid}
  last_sync_at timestamptz, last_ok_at timestamptz, last_error text,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now()
);
create unique index if not exists dmail_accounts_one_per_user on app_private.dmail_accounts (assigned_to) where assigned_to is not null;

create table if not exists app_private.dmail_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app_private.dmail_accounts(id) on delete cascade,
  folder text not null check (folder in ('inbox','sent','drafts','spam','trash')),
  imap_uid bigint, uidvalidity bigint,
  message_id text, in_reply_to text, refs text[] not null default '{}', thread_key text not null,
  from_name text, from_email text,
  to_addrs jsonb not null default '[]', cc_addrs jsonb not null default '[]', bcc_addrs jsonb not null default '[]',
  subject text, snippet text, body_text text, body_html text,
  attachments jsonb not null default '[]', has_attach boolean not null default false,
  seen boolean not null default false, starred boolean not null default false, answered boolean not null default false,
  msg_date timestamptz not null default now(), size_bytes int,
  draft_meta jsonb, sent_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('simple'::regconfig,
    coalesce(subject,'') || ' ' || coalesce(from_name,'') || ' ' || coalesce(from_email,'') || ' ' || left(coalesce(body_text,''), 20000))) stored
);
create unique index if not exists dmail_messages_uid on app_private.dmail_messages (account_id, folder, uidvalidity, imap_uid) where imap_uid is not null;
create index if not exists dmail_messages_list on app_private.dmail_messages (account_id, folder, msg_date desc);
create index if not exists dmail_messages_thread on app_private.dmail_messages (account_id, thread_key);
create index if not exists dmail_messages_mid on app_private.dmail_messages (account_id, message_id);
create index if not exists dmail_messages_refs on app_private.dmail_messages using gin (refs);
create index if not exists dmail_messages_fts on app_private.dmail_messages using gin (fts);

alter table app_private.dmail_config enable row level security;
alter table app_private.dmail_accounts enable row level security;
alter table app_private.dmail_messages enable row level security;

-- ---------- access ----------
create or replace function app_private.dmail_can(p_account uuid) returns boolean
language sql stable security definer set search_path = app_private, public as $$
  select auth.uid() is not null and (app_private.disp_is_staff() or exists (
    select 1 from app_private.dmail_accounts a join app_private.dispatcher_profiles d on d.user_id = a.assigned_to
     where a.id = p_account and a.assigned_to = auth.uid() and a.status <> 'paused' and d.status in ('trial','verified','active')))
     and coalesce((select enabled from app_private.dmail_config where id = 1), false);
$$;

create or replace function app_private.dmail_counts(p_account uuid) returns jsonb
language sql stable security definer set search_path = app_private, public as $$
  select jsonb_build_object(
    'inbox', (select count(distinct thread_key) from dmail_messages where account_id = p_account and folder = 'inbox' and not seen),
    'spam',  (select count(*) from dmail_messages where account_id = p_account and folder = 'spam' and not seen),
    'drafts',(select count(*) from dmail_messages where account_id = p_account and folder = 'drafts'));
$$;

-- ---------- dispatcher / shared RPCs (authenticated) ----------
create or replace function public.dmail_bootstrap(p_account uuid default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare a app_private.dmail_accounts; v_staff boolean := app_private.disp_is_staff();
begin
  if auth.uid() is null then return jsonb_build_object('error','not signed in'); end if;
  if p_account is not null and v_staff then select * into a from dmail_accounts where id = p_account;
  else select * into a from dmail_accounts where assigned_to = auth.uid(); end if;
  if a.id is null then return jsonb_build_object('enabled', false, 'reason', 'no_mailbox'); end if;
  if not app_private.dmail_can(a.id) then return jsonb_build_object('enabled', false, 'reason', case when a.status = 'paused' then 'paused' else 'not_active' end); end if;
  return jsonb_build_object('enabled', true, 'staff_view', v_staff and a.assigned_to is distinct from auth.uid(),
    'account', jsonb_build_object('id', a.id, 'address', a.address, 'display_name', a.display_name, 'signature_html', a.signature_html,
      'status', a.status, 'last_sync_at', a.last_sync_at, 'sync_problem', a.status = 'error'),
    'counts', app_private.dmail_counts(a.id));
end $$;

create or replace function public.dmail_list(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_acc uuid := nullif(p->>'account','')::uuid; v_folder text := coalesce(nullif(p->>'folder',''),'inbox');
  v_q text := nullif(btrim(coalesce(p->>'q','')),''); v_before timestamptz := nullif(p->>'before','')::timestamptz;
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 40), 1), 100); v_rows jsonb;
begin
  if not app_private.dmail_can(v_acc) then return jsonb_build_object('error','not authorized'); end if;
  with base as (
    select m.* from dmail_messages m where m.account_id = v_acc
      and case when v_q is not null then m.folder <> 'spam' or v_folder = 'spam'
               when v_folder = 'starred' then m.starred and m.folder not in ('trash','spam')
               else m.folder = v_folder end
      and (v_q is null or m.fts @@ plainto_tsquery('simple', v_q) or m.subject ilike '%' || v_q || '%' or m.from_email ilike '%' || v_q || '%'
           or m.to_addrs::text ilike '%' || v_q || '%')),
  th as (select thread_key, max(msg_date) last_date, count(*) n, bool_or(not seen) unread, bool_or(starred) starred, bool_or(has_attach) has_attach,
                array_agg(id) ids from base group by thread_key)
  select coalesce(jsonb_agg(r order by (r->>'date') desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('thread', th.thread_key, 'ids', th.ids, 'date', th.last_date, 'unread', th.unread, 'starred', th.starred,
      'has_attach', th.has_attach, 'id', l.id, 'folder', l.folder, 'subject', l.subject, 'snippet', l.snippet,
      'from_name', l.from_name, 'from_email', l.from_email, 'to', l.to_addrs,
      'total', (select count(*) from dmail_messages x where x.account_id = v_acc and x.thread_key = th.thread_key
                 and (x.folder not in ('trash','spam','drafts') or x.folder = v_folder)),
      'names', (select jsonb_agg(distinct coalesce(nullif(x.from_name,''), x.from_email)) from dmail_messages x
                 where x.account_id = v_acc and x.thread_key = th.thread_key and x.folder not in ('trash','spam','drafts'))) r
    from th join lateral (select * from base b where b.thread_key = th.thread_key order by b.msg_date desc limit 1) l on true
    where v_before is null or th.last_date < v_before order by th.last_date desc limit v_limit) s;
  return jsonb_build_object('rows', v_rows, 'counts', app_private.dmail_counts(v_acc),
    'last_sync_at', (select last_sync_at from dmail_accounts where id = v_acc));
end $$;

create or replace function public.dmail_thread(p_account uuid, p_thread text, p_folder text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.dmail_can(p_account) then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object('messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'folder', m.folder, 'message_id', m.message_id,
      'from_name', m.from_name, 'from_email', m.from_email, 'to', m.to_addrs, 'cc', m.cc_addrs, 'bcc', m.bcc_addrs, 'subject', m.subject,
      'snippet', m.snippet, 'text', m.body_text, 'html', m.body_html, 'attachments', m.attachments, 'seen', m.seen, 'starred', m.starred,
      'date', m.msg_date, 'draft_meta', m.draft_meta) order by m.msg_date)
    from dmail_messages m where m.account_id = p_account and m.thread_key = p_thread
      and (case when p_folder in ('trash','spam') then m.folder = p_folder else m.folder not in ('trash','spam') end)), '[]'::jsonb));
end $$;

create or replace function public.dmail_draft_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_acc uuid := nullif(p->>'account','')::uuid; v_id uuid := nullif(p->>'id','')::uuid; v_reply uuid := nullif(p->>'reply_to','')::uuid;
  a app_private.dmail_accounts; v_thread text; v_txt text := left(coalesce(p->>'text',''), 200000);
begin
  if not app_private.dmail_can(v_acc) then return jsonb_build_object('error','not authorized'); end if;
  select * into a from dmail_accounts where id = v_acc;
  if v_reply is not null then select thread_key into v_thread from dmail_messages where id = v_reply and account_id = v_acc; end if;
  if v_id is not null and exists (select 1 from dmail_messages where id = v_id and account_id = v_acc and folder = 'drafts') then
    update dmail_messages set to_addrs = coalesce(p->'to','[]'), cc_addrs = coalesce(p->'cc','[]'), bcc_addrs = coalesce(p->'bcc','[]'),
      subject = left(p->>'subject', 500), body_html = left(p->>'html', 600000), body_text = v_txt, snippet = left(regexp_replace(v_txt, '\s+', ' ', 'g'), 180),
      draft_meta = jsonb_build_object('reply_to', v_reply, 'mode', p->>'mode'), msg_date = now(), updated_at = now() where id = v_id;
  else
    v_id := gen_random_uuid();
    insert into dmail_messages (id, account_id, folder, thread_key, from_name, from_email, to_addrs, cc_addrs, bcc_addrs, subject, body_html, body_text, snippet, seen, draft_meta, sent_by)
    values (v_id, v_acc, 'drafts', coalesce(v_thread, 'draft:' || v_id), a.display_name, a.address, coalesce(p->'to','[]'), coalesce(p->'cc','[]'), coalesce(p->'bcc','[]'),
      left(p->>'subject', 500), left(p->>'html', 600000), v_txt, left(regexp_replace(v_txt, '\s+', ' ', 'g'), 180), true,
      jsonb_build_object('reply_to', v_reply, 'mode', p->>'mode'), auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.dmail_draft_discard(p_id uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_acc uuid;
begin
  select account_id into v_acc from dmail_messages where id = p_id and folder = 'drafts';
  if v_acc is null or not app_private.dmail_can(v_acc) then return jsonb_build_object('error','not authorized'); end if;
  delete from dmail_messages where id = p_id and folder = 'drafts';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.dmail_poll(p_account uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.dmail_can(p_account) then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object('counts', app_private.dmail_counts(p_account),
    'latest', (select max(created_at) from dmail_messages where account_id = p_account),
    'last_sync_at', (select last_sync_at from dmail_accounts where id = p_account),
    'sync_problem', (select status = 'error' from dmail_accounts where id = p_account));
end $$;

create or replace function public.dmail_contacts(p_account uuid, p_q text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_q text := '%' || lower(btrim(coalesce(p_q,''))) || '%';
begin
  if not app_private.dmail_can(p_account) then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'name', name)) from (
    select email, max(name) name, max(d) d from (
      select lower(from_email) email, from_name name, msg_date d from dmail_messages where account_id = p_account and folder = 'inbox' and from_email is not null
      union all
      select lower(t->>'email'), t->>'name', msg_date from dmail_messages, jsonb_array_elements(to_addrs) t where account_id = p_account and folder = 'sent') u
    where email like v_q or lower(coalesce(name,'')) like v_q group by email order by max(d) desc limit 8) c), '[]'::jsonb));
end $$;

-- ---------- Command Center RPCs (staff) ----------
create or replace function public.cc_dmail_overview() returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object(
    'enabled', (select enabled from dmail_config where id = 1),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'address', a.address, 'display_name', a.display_name,
        'signature_html', a.signature_html, 'status', a.status, 'has_password', a.secret_id is not null,
        'assigned_to', a.assigned_to, 'assigned_name', d.full_name, 'assigned_at', a.assigned_at,
        'last_sync_at', a.last_sync_at, 'last_ok_at', a.last_ok_at, 'last_error', a.last_error,
        'imap_host', a.imap_host, 'imap_port', a.imap_port, 'smtp_host', a.smtp_host, 'smtp_port', a.smtp_port, 'username', a.username,
        'unread', (select count(*) from dmail_messages m where m.account_id = a.id and m.folder = 'inbox' and not m.seen),
        'received_7d', (select count(*) from dmail_messages m where m.account_id = a.id and m.folder = 'inbox' and m.msg_date > now() - interval '7 days'),
        'sent_7d', (select count(*) from dmail_messages m where m.account_id = a.id and m.folder = 'sent' and m.msg_date > now() - interval '7 days')) order by a.created_at)
      from dmail_accounts a left join dispatcher_profiles d on d.user_id = a.assigned_to), '[]'::jsonb),
    'dispatchers', coalesce((select jsonb_agg(jsonb_build_object('user_id', d.user_id, 'name', d.full_name, 'status', d.status) order by d.full_name)
      from dispatcher_profiles d where d.status in ('trial','verified','active')), '[]'::jsonb));
end $$;

create or replace function public.cc_dmail_account_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public, vault as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_addr text := lower(btrim(coalesce(p->>'address',''))); v_pw text := nullif(p->>'password','');
  a app_private.dmail_accounts; v_secret uuid;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if v_id is null then
    if v_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('error','a valid email address is required'); end if;
    if nullif(btrim(coalesce(p->>'display_name','')),'') is null then return jsonb_build_object('error','display name is required'); end if;
    if v_pw is null then return jsonb_build_object('error','the mailbox password is required'); end if;
    if exists (select 1 from dmail_accounts where address = v_addr) then return jsonb_build_object('error','that mailbox is already added'); end if;
    insert into dmail_accounts (address, display_name, username, created_by) values (v_addr, btrim(p->>'display_name'), v_addr, auth.uid()) returning * into a;
  else
    select * into a from dmail_accounts where id = v_id;
    if a.id is null then return jsonb_build_object('error','mailbox not found'); end if;
  end if;
  update dmail_accounts set
    display_name = coalesce(nullif(btrim(p->>'display_name'),''), display_name),
    signature_html = case when p ? 'signature_html' then left(coalesce(p->>'signature_html',''), 20000) else signature_html end,
    imap_host = coalesce(nullif(p->>'imap_host',''), imap_host), imap_port = coalesce(nullif(p->>'imap_port','')::int, imap_port),
    smtp_host = coalesce(nullif(p->>'smtp_host',''), smtp_host), smtp_port = coalesce(nullif(p->>'smtp_port','')::int, smtp_port),
    username = coalesce(nullif(p->>'username',''), username), updated_at = now() where id = a.id;
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

create or replace function public.cc_dmail_assign(p_account uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare a app_private.dmail_accounts; v_name text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into a from dmail_accounts where id = p_account;
  if a.id is null then return jsonb_build_object('error','mailbox not found'); end if;
  if p_user is not null then
    select full_name into v_name from dispatcher_profiles where user_id = p_user and status in ('trial','verified','active');
    if v_name is null then return jsonb_build_object('error','not an active dispatcher'); end if;
    if exists (select 1 from dmail_accounts where assigned_to = p_user and id <> p_account) then
      return jsonb_build_object('error','that dispatcher already has a mailbox — unassign it first'); end if;
  end if;
  update dmail_accounts set assigned_to = p_user, assigned_at = case when p_user is null then null else now() end, assigned_by = auth.uid(), updated_at = now() where id = p_account;
  perform app_private.disp_audit('dmail.assign', 'dispatcher', coalesce(p_user, a.assigned_to)::text, null,
    a.address || case when p_user is null then ' unassigned' else ' assigned to ' || v_name end, jsonb_build_object('account', p_account));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_dmail_set_status(p_account uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if p_status not in ('active','paused') then return jsonb_build_object('error','bad status'); end if;
  update dmail_accounts set status = case when p_status = 'active' and secret_id is null then 'unverified' else p_status end, updated_at = now() where id = p_account;
  perform app_private.disp_audit('dmail.status', 'dmail_account', p_account::text, null, p_status, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- service_role only (edge functions) ----------
create or replace function public.dmail_cron_check(p_secret text) returns boolean
language sql stable security definer set search_path = app_private, public as $$
  select coalesce((select enabled and cron_secret = p_secret from dmail_config where id = 1), false);
$$;

create or replace function public.dmail_access(p_account uuid) returns jsonb   -- called WITH the user's JWT
language sql stable security definer set search_path = app_private, public as $$
  select jsonb_build_object('ok', app_private.dmail_can(p_account), 'uid', auth.uid(), 'staff', app_private.disp_is_staff());
$$;

create or replace function public.dmail_sync_targets(p_account uuid default null) returns jsonb
language sql security definer set search_path = app_private, public, vault as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'address', a.address, 'display_name', a.display_name, 'username', a.username,
      'password', s.decrypted_secret, 'imap_host', a.imap_host, 'imap_port', a.imap_port, 'smtp_host', a.smtp_host, 'smtp_port', a.smtp_port,
      'folders', a.folders, 'status', a.status, 'signature_html', a.signature_html)), '[]'::jsonb)
  from dmail_accounts a join vault.decrypted_secrets s on s.id = a.secret_id
  where (select enabled from dmail_config where id = 1)
    and case when p_account is not null then a.id = p_account
             else a.status in ('active','error') and (a.last_sync_at is null or a.last_sync_at < now() - interval '20 seconds') end;
$$;

create or replace function public.dmail_folder_reset(p_account uuid, p_folder text, p_uidvalidity bigint) returns void
language sql security definer set search_path = app_private, public as $$
  delete from dmail_messages where account_id = p_account and folder = p_folder and imap_uid is not null and uidvalidity is distinct from p_uidvalidity;
$$;

create or replace function public.dmail_ingest(p_account uuid, p_folder text, p_uidvalidity bigint, p_msgs jsonb) returns int
language plpgsql security definer set search_path = app_private, public as $$
declare m jsonb; n int := 0; v_thread text; v_mid text; v_refs text[]; v_existing uuid; v_rc int;
begin
  for m in select * from jsonb_array_elements(coalesce(p_msgs,'[]'::jsonb)) loop
    v_mid := nullif(m->>'message_id',''); v_thread := null; v_existing := null;
    v_refs := coalesce(array(select jsonb_array_elements_text(coalesce(m->'refs','[]'::jsonb))), '{}');
    if nullif(m->>'in_reply_to','') is not null then v_refs := v_refs || (m->>'in_reply_to'); end if;
    if v_mid is not null then
      select id into v_existing from dmail_messages where account_id = p_account and folder = p_folder and imap_uid is null and message_id = v_mid limit 1;
    end if;
    if v_existing is not null then
      update dmail_messages set imap_uid = (m->>'uid')::bigint, uidvalidity = p_uidvalidity, updated_at = now() where id = v_existing;
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
      to_addrs, cc_addrs, bcc_addrs, subject, snippet, body_text, body_html, attachments, has_attach, seen, starred, answered, msg_date, size_bytes)
    values (p_account, p_folder, (m->>'uid')::bigint, p_uidvalidity, v_mid, nullif(m->>'in_reply_to',''), v_refs, v_thread,
      left(m->>'from_name', 300), lower(left(m->>'from_email', 320)), coalesce(m->'to','[]'), coalesce(m->'cc','[]'), coalesce(m->'bcc','[]'),
      left(m->>'subject', 998), left(m->>'snippet', 200), m->>'text', m->>'html', coalesce(m->'attachments','[]'),
      jsonb_array_length(coalesce(m->'attachments','[]')) > 0, coalesce((m->>'seen')::boolean, false) or p_folder = 'sent',
      coalesce((m->>'starred')::boolean, false), coalesce((m->>'answered')::boolean, false),
      coalesce(nullif(m->>'date','')::timestamptz, now()), nullif(m->>'size','')::int)
    on conflict (account_id, folder, uidvalidity, imap_uid) where imap_uid is not null do nothing;
    get diagnostics v_rc = row_count; n := n + v_rc;
  end loop;
  return n;
end $$;

-- flags for a uid window [p_lo, p_hi]; rows in that window the server no longer has are removed
create or replace function public.dmail_flags_apply(p_account uuid, p_folder text, p_uidvalidity bigint, p_lo bigint, p_hi bigint, p_flags jsonb) returns void
language plpgsql security definer set search_path = app_private, public as $$
begin
  update dmail_messages m set seen = (f->>'seen')::boolean, starred = (f->>'starred')::boolean, answered = (f->>'answered')::boolean, updated_at = now()
    from jsonb_array_elements(coalesce(p_flags,'[]'::jsonb)) f
   where m.account_id = p_account and m.folder = p_folder and m.uidvalidity = p_uidvalidity and m.imap_uid = (f->>'uid')::bigint
     and (m.seen, m.starred, m.answered) is distinct from ((f->>'seen')::boolean, (f->>'starred')::boolean, (f->>'answered')::boolean);
  delete from dmail_messages m where m.account_id = p_account and m.folder = p_folder and m.uidvalidity = p_uidvalidity
     and m.imap_uid between p_lo and p_hi
     and not exists (select 1 from jsonb_array_elements(coalesce(p_flags,'[]'::jsonb)) f where (f->>'uid')::bigint = m.imap_uid);
end $$;

create or replace function public.dmail_sync_done(p_account uuid, p_folders jsonb, p_error text) returns void
language sql security definer set search_path = app_private, public as $$
  update dmail_accounts set folders = coalesce(p_folders, folders), last_sync_at = now(),
    last_ok_at = case when p_error is null then now() else last_ok_at end, last_error = left(p_error, 500),
    status = case when status = 'paused' then 'paused' when p_error is null then 'active' when status = 'unverified' then 'unverified' else 'error' end,
    updated_at = now() where id = p_account;
$$;

create or replace function public.dmail_msg_refs(p_account uuid, p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = app_private, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'folder', folder, 'uid', imap_uid, 'uidvalidity', uidvalidity, 'message_id', message_id,
    'refs', refs, 'subject', subject, 'thread', thread_key)), '[]'::jsonb) from dmail_messages where account_id = p_account and id = any(p_ids);
$$;

-- after the IMAP operation succeeded: p = {seen?, starred?, answered?, folder?, uidmap?: {old_uid: new_uid}, uidvalidity?, delete?}
create or replace function public.dmail_msg_patch(p_account uuid, p_ids uuid[], p jsonb) returns void
language plpgsql security definer set search_path = app_private, public as $$
begin
  if coalesce((p->>'delete')::boolean, false) then
    delete from dmail_messages where account_id = p_account and id = any(p_ids); return;
  end if;
  update dmail_messages m set
    seen = coalesce((p->>'seen')::boolean, seen), starred = coalesce((p->>'starred')::boolean, starred), answered = coalesce((p->>'answered')::boolean, answered),
    folder = coalesce(nullif(p->>'folder',''), folder),
    imap_uid = case when p ? 'folder' then nullif(p->'uidmap'->>(m.imap_uid::text), '')::bigint else imap_uid end,
    uidvalidity = case when p ? 'folder' then nullif(p->>'uidvalidity','')::bigint else uidvalidity end,
    updated_at = now()
  where m.account_id = p_account and m.id = any(p_ids);
end $$;

create or replace function public.dmail_sent_store(p_account uuid, p_user uuid, p_msg jsonb, p_draft uuid) returns uuid
language plpgsql security definer set search_path = app_private, public as $$
declare v_id uuid; v_thread text; v_refs text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_msg->'refs','[]'::jsonb))), '{}');
begin
  if array_length(v_refs, 1) > 0 then
    select thread_key into v_thread from dmail_messages where account_id = p_account and message_id = any(v_refs) order by msg_date limit 1;
  end if;
  insert into dmail_messages (account_id, folder, imap_uid, uidvalidity, message_id, in_reply_to, refs, thread_key, from_name, from_email, to_addrs, cc_addrs, bcc_addrs,
    subject, snippet, body_text, body_html, attachments, has_attach, seen, msg_date, sent_by)
  values (p_account, 'sent', nullif(p_msg->>'uid','')::bigint, nullif(p_msg->>'uidvalidity','')::bigint, p_msg->>'message_id', nullif(p_msg->>'in_reply_to',''), v_refs,
    coalesce(v_thread, p_msg->>'message_id'), p_msg->>'from_name', lower(p_msg->>'from_email'), coalesce(p_msg->'to','[]'), coalesce(p_msg->'cc','[]'), coalesce(p_msg->'bcc','[]'),
    left(p_msg->>'subject', 998), left(p_msg->>'snippet', 200), p_msg->>'text', p_msg->>'html', coalesce(p_msg->'attachments','[]'),
    jsonb_array_length(coalesce(p_msg->'attachments','[]')) > 0, true, now(), p_user)
  on conflict (account_id, folder, uidvalidity, imap_uid) where imap_uid is not null do nothing returning id into v_id;
  if p_draft is not null then delete from dmail_messages where id = p_draft and account_id = p_account and folder = 'drafts'; end if;
  if nullif(p_msg->>'answered_id','') is not null then update dmail_messages set answered = true where id = (p_msg->>'answered_id')::uuid and account_id = p_account; end if;
  perform app_private.disp_audit('dmail.send', 'dmail_account', p_account::text, null, left(coalesce(p_msg->>'subject','(no subject)'), 120),
    jsonb_build_object('to', p_msg->'to', 'by', p_user, 'message_id', p_msg->>'message_id'));
  return v_id;
end $$;

-- ---------- grants ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public.dmail_bootstrap(uuid)','public.dmail_list(jsonb)','public.dmail_thread(uuid,text,text)','public.dmail_draft_save(jsonb)',
    'public.dmail_draft_discard(uuid)','public.dmail_poll(uuid)','public.dmail_contacts(uuid,text)','public.dmail_access(uuid)',
    'public.cc_dmail_overview()','public.cc_dmail_account_save(jsonb)','public.cc_dmail_assign(uuid,uuid)','public.cc_dmail_set_status(uuid,text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.dmail_cron_check(text)','public.dmail_sync_targets(uuid)','public.dmail_folder_reset(uuid,text,bigint)','public.dmail_ingest(uuid,text,bigint,jsonb)',
    'public.dmail_flags_apply(uuid,text,bigint,bigint,bigint,jsonb)','public.dmail_sync_done(uuid,jsonb,text)','public.dmail_msg_refs(uuid,uuid[])',
    'public.dmail_msg_patch(uuid,uuid[],jsonb)','public.dmail_sent_store(uuid,uuid,jsonb,uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'revoke all on function app_private.dmail_can(uuid) from public, anon';
  execute 'revoke all on function app_private.dmail_counts(uuid) from public, anon';
end $$;

-- ---------- cron: every minute; the project URL is lifted from an existing job so this file is identical on staging and prod ----------
do $$
declare v_base text;
begin
  select substring(command from 'https://[a-z0-9]+\.supabase\.co') into v_base from cron.job where command ~ 'https://[a-z0-9]+\.supabase\.co' limit 1;
  update app_private.dmail_config set fn_base = coalesce(v_base, fn_base) where id = 1;
  if v_base is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dmail-sync-minutely';
    perform cron.schedule('dmail-sync-minutely', '* * * * *',
      $c$select net.http_post(url := (select fn_base from app_private.dmail_config where id = 1) || '/functions/v1/dmail',
           headers := jsonb_build_object('Content-Type','application/json','x-dmail-secret',(select cron_secret from app_private.dmail_config where id = 1)),
           body := '{}'::jsonb)
         where exists (select 1 from app_private.dmail_accounts where status in ('active','error'))$c$);
  end if;
end $$;


-- ===== migrations/bl_dmail_0357_no_delete_cc_activity.sql =====
-- bl_dmail_0357 — Dispatcher Mailbox, owner decisions 20 Sep 2026:
--   1. A DISPATCHER CAN NEVER DELETE MAIL. Only staff can move to Trash or delete forever. dmail_bootstrap now tells the
--      UI (can_delete) and the dmail edge function enforces it (it refuses move→trash / delete unless dmail_access says staff).
--   2. The Command Center sees EVERYTHING: cc_dmail_activity = one feed of every email received / sent / replied across all
--      dispatcher mailboxes, with the mailbox, who it is assigned to, and who pressed Send.
-- Additive. Authenticated-only; nothing granted to anon.

create or replace function public.dmail_bootstrap(p_account uuid default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare a app_private.dmail_accounts; v_staff boolean := app_private.disp_is_staff();
begin
  if auth.uid() is null then return jsonb_build_object('error','not signed in'); end if;
  if p_account is not null and v_staff then select * into a from dmail_accounts where id = p_account;
  else select * into a from dmail_accounts where assigned_to = auth.uid(); end if;
  if a.id is null then return jsonb_build_object('enabled', false, 'reason', 'no_mailbox'); end if;
  if not app_private.dmail_can(a.id) then return jsonb_build_object('enabled', false, 'reason', case when a.status = 'paused' then 'paused' else 'not_active' end); end if;
  return jsonb_build_object('enabled', true, 'staff_view', v_staff and a.assigned_to is distinct from auth.uid(), 'can_delete', v_staff,
    'account', jsonb_build_object('id', a.id, 'address', a.address, 'display_name', a.display_name, 'signature_html', a.signature_html,
      'status', a.status, 'last_sync_at', a.last_sync_at, 'sync_problem', a.status = 'error',
      'assigned_name', (select full_name from dispatcher_profiles where user_id = a.assigned_to)),
    'counts', app_private.dmail_counts(a.id));
end $$;

create or replace function public.cc_dmail_activity(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_acc uuid := nullif(p->>'account','')::uuid; v_dir text := nullif(p->>'dir',''); v_q text := nullif(btrim(coalesce(p->>'q','')),'');
  v_before timestamptz := nullif(p->>'before','')::timestamptz; v_limit int := least(greatest(coalesce((p->>'limit')::int, 60), 1), 200);
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object(
    'today', (select jsonb_build_object('received', count(*) filter (where folder <> 'sent'), 'sent', count(*) filter (where folder = 'sent'),
                'unread', (select count(*) from dmail_messages where folder = 'inbox' and not seen),
                'waiting', (select count(*) from dmail_messages where folder = 'inbox' and not answered and msg_date > now() - interval '7 days'))
              from dmail_messages where folder <> 'drafts' and msg_date >= date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York'),
    'rows', coalesce((select jsonb_agg(r order by (r->>'date') desc) from (
      select jsonb_build_object('id', m.id, 'account', m.account_id, 'address', a.address, 'assigned_name', d.full_name, 'folder', m.folder,
        'dir', case when m.folder = 'sent' then 'out' else 'in' end, 'from_name', m.from_name, 'from_email', m.from_email, 'to', m.to_addrs,
        'subject', m.subject, 'snippet', m.snippet, 'date', m.msg_date, 'thread', m.thread_key, 'seen', m.seen, 'answered', m.answered,
        'has_attach', m.has_attach, 'is_reply', m.in_reply_to is not null,
        'sent_by', case when m.folder = 'sent' then coalesce(sb.full_name, case when m.sent_by is null then 'Webmail / other' else 'LoadBoot staff' end) end) r
      from dmail_messages m join dmail_accounts a on a.id = m.account_id
        left join dispatcher_profiles d on d.user_id = a.assigned_to left join dispatcher_profiles sb on sb.user_id = m.sent_by
      where m.folder <> 'drafts' and (v_acc is null or m.account_id = v_acc)
        and (v_dir is null or (v_dir = 'out') = (m.folder = 'sent'))
        and (v_before is null or m.msg_date < v_before)
        and (v_q is null or m.fts @@ plainto_tsquery('simple', v_q) or m.subject ilike '%' || v_q || '%' or m.from_email ilike '%' || v_q || '%' or m.to_addrs::text ilike '%' || v_q || '%')
      order by m.msg_date desc limit v_limit) s), '[]'::jsonb));
end $$;

revoke all on function public.cc_dmail_activity(jsonb) from public, anon;
grant execute on function public.cc_dmail_activity(jsonb) to authenticated;
revoke all on function public.dmail_bootstrap(uuid) from public, anon;
grant execute on function public.dmail_bootstrap(uuid) to authenticated;


-- ===== migrations/bl_dmail_0358_assign_welcome_email.sql =====
-- bl_dmail_0358 — when staff assign a mailbox to a dispatcher, the dispatcher gets a branded welcome email:
-- what the mailbox is, what it can do, and the RULES (company property, monitored, no deleting, no double brokering,
-- rate cons through LoadBoot, no bulk mail, document handling, security). Sent to the dispatcher's login email AND into
-- the new mailbox itself, so it is the first email they see in the Email tab and the rules are always one search away.
-- Sent only when the assignee actually changes (re-pressing Assign for the same person sends nothing). Never blocks the assign.

create or replace function app_private.dmail_esc(t text) returns text language sql immutable as
$$ select replace(replace(replace(replace(coalesce(t,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $$;

-- one row of the feature / rule lists. p_body is code-defined markup (never user input).
create or replace function app_private.dmail_li(p_title text, p_body text) returns text language sql immutable as
$$ select '<div style="padding:9px 0;border-bottom:1px solid rgba(15,23,42,.07)"><div style="font-weight:700;color:#10223B">' || p_title || '</div><div style="color:#475569;font-size:14px">' || p_body || '</div></div>' $$;

create or replace function app_private.dmail_welcome_html(p_name text, p_address text, p_display text) returns text
language sql stable as $fn$
  select
    '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || '<div style="font-size:11px;letter-spacing:.16em;font-weight:700;color:#0883F7;text-transform:uppercase;margin-bottom:6px">LoadBoot Dispatch &middot; Your company email</div>'
    || '<div style="font-size:24px;font-weight:800;color:#10223B;letter-spacing:-.01em;margin:0 0 14px">Your LoadBoot mailbox is ready</div>'
    || '<p style="margin:0 0 14px">Hi ' || app_private.dmail_esc(coalesce(nullif(p_name,''),'there')) || ', LoadBoot has assigned you a company email address. There is nothing to install and no password to remember &mdash; it lives inside your dispatcher portal.</p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#10223B;border-radius:14px;margin:0 0 18px"><tr><td style="padding:18px 20px">'
    || '<div style="font-size:11px;letter-spacing:.14em;font-weight:700;color:#7fb8ff;text-transform:uppercase">Your address</div>'
    || '<div style="font-size:20px;font-weight:800;color:#ffffff;margin:2px 0 8px">' || app_private.dmail_esc(p_address) || '</div>'
    || '<div style="font-size:13px;color:#b8c7de">Brokers and carriers see your emails as: <b style="color:#fff">' || app_private.dmail_esc(p_display) || '</b></div>'
    || '</td></tr></table>'
    || '<p style="margin:0 0 18px"><a href="https://loadboot.com/app/agent/#dashboard/email" style="display:inline-block;background:#0883F7;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px">Open my inbox</a></p>'
    || '<div style="font-size:11px;letter-spacing:.12em;font-weight:700;color:#64748b;text-transform:uppercase;margin:0 0 8px">What you can do</div>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e9f0;border-radius:12px;margin:0 0 18px"><tr><td style="padding:6px 16px">'
    || app_private.dmail_li('Inbox in your portal', 'Open the <b>Email</b> tab on desktop or on your phone. New email arrives within about a minute.')
    || app_private.dmail_li('Send, reply, reply-all, forward', 'With attachments up to 15 MB per email, and 5 seconds to undo a send.')
    || app_private.dmail_li('Drafts save themselves', 'Close the window any time &mdash; your draft is waiting in Drafts.')
    || app_private.dmail_li('Search, star, mark unread', 'Find any rate con or broker thread in seconds.')
    || app_private.dmail_li('Company signature', 'Added to every email automatically. It is set by LoadBoot and cannot be edited.')
    || '</td></tr></table>'
    || '<div style="font-size:11px;letter-spacing:.12em;font-weight:700;color:#FC5305;text-transform:uppercase;margin:0 0 8px">Rules for this mailbox</div>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:3px solid #FC5305;background:#fff8f2;border-radius:0 12px 12px 0;margin:0 0 18px"><tr><td style="padding:8px 16px">'
    || app_private.dmail_li('1. It belongs to LoadBoot', 'The address and every email in it are company property. Use it for LoadBoot dispatch work only &mdash; never for personal email.')
    || app_private.dmail_li('2. It is monitored', 'LoadBoot staff can see every email you receive and send, for quality, training and compliance.')
    || app_private.dmail_li('3. Nothing is deleted', 'You cannot delete email, and you must not try to work around that. If something should be removed, ask LoadBoot staff.')
    || app_private.dmail_li('4. Keep conversations here', 'Do not move broker or carrier conversations to a personal email address. Every load needs its email trail on this address.')
    || app_private.dmail_li('5. Be honest about who you are', 'You write as a LoadBoot dispatcher acting for the carriers assigned to you. Never claim to be the carrier''s owner, a broker, or to hold authority you do not hold. No double brokering or re-brokering &mdash; ever.')
    || app_private.dmail_li('6. Rate confirmations go through LoadBoot', 'Log every booking and attach the rate con in your portal. A carrier is committed only after LoadBoot approves it.')
    || app_private.dmail_li('7. No bulk or cold blasts', 'Maximum 25 recipients per email, no bought lists, no copy-paste campaigns. One spam complaint damages the address for everyone.')
    || app_private.dmail_li('8. Handle documents carefully', 'Send a carrier''s W-9, insurance certificate or authority letter only to the broker on a live load. Never act on an emailed request to change bank or factoring details &mdash; send it to LoadBoot staff first.')
    || app_private.dmail_li('9. Watch for fraud', 'Do not open unexpected attachments or links. If an email looks wrong, leave it and tell LoadBoot staff.')
    || app_private.dmail_li('10. Stay professional', 'Clear subject lines, polite wording, prompt replies during your shift.')
    || app_private.dmail_li('11. Access follows your assignment', 'If your assignment ends or is paused, access stops immediately and the mailbox stays with LoadBoot.')
    || '</td></tr></table>'
    || '<p style="margin:0 0 16px">Using the mailbox means you accept these rules. Questions? Message your LoadBoot coordinator in the portal.</p>'
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b">Operations</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because LoadBoot staff assigned ' || app_private.dmail_esc(p_address) || ' to your dispatcher account.</p>'
    || '</div>'
$fn$;

create or replace function app_private.dmail_assign_email(p_user uuid, p_account uuid) returns void
language plpgsql security definer set search_path to 'app_private','public' as $fn$
declare v_mail text; v_name text; a app_private.dmail_accounts; v_html text; v_text text; v_key text;
begin
  select u.email into v_mail from auth.users u where u.id = p_user;
  select * into a from app_private.dmail_accounts where id = p_account;
  if a.id is null then return; end if;
  select full_name into v_name from app_private.dispatcher_profiles where user_id = p_user;
  v_html := app_private.dmail_welcome_html(split_part(coalesce(v_name,''), ' ', 1), a.address, a.display_name);
  v_text := 'Hi ' || coalesce(nullif(split_part(coalesce(v_name,''), ' ', 1), ''), 'there') || E',\n\nLoadBoot has assigned you a company email address: ' || a.address
    || E'\nBrokers and carriers see your emails as: ' || a.display_name
    || E'\n\nOpen the Email tab in your dispatcher portal: https://loadboot.com/app/agent/#dashboard/email\nNo password is needed.'
    || E'\n\nRULES: 1) The mailbox and its email belong to LoadBoot - work use only. 2) LoadBoot staff can see every email. 3) You cannot delete email. 4) Keep broker and carrier conversations on this address. 5) You write as a LoadBoot dispatcher for your assigned carriers - never claim authority you do not hold; no double brokering. 6) Every rate con is logged in the portal and approved by LoadBoot. 7) No bulk email - max 25 recipients. 8) Carrier documents only to the broker on a live load; never act on emailed bank/factoring changes - send them to staff. 9) Do not open unexpected attachments or links. 10) Stay professional. 11) Access ends when your assignment ends.'
    || E'\n\nUsing the mailbox means you accept these rules.\n\nLoadBoot Dispatch - Operations';
  v_key := 'dmail.assign:' || p_account::text || ':' || p_user::text || ':' || extract(epoch from now())::bigint::text;
  if v_mail is not null then
    perform app_private.sys_email(v_mail, 'dispatcher.mailbox.assigned', 'Your LoadBoot email address is ready — ' || a.address, v_html, v_text, v_key);
  end if;
  -- and into the mailbox itself, so it is the first thing in their new inbox
  if lower(coalesce(v_mail,'')) <> a.address then
    perform app_private.sys_email(a.address, 'dispatcher.mailbox.assigned', 'Welcome to your LoadBoot mailbox — features and rules', v_html, v_text, v_key || ':inbox');
  end if;
end $fn$;
revoke all on function app_private.dmail_assign_email(uuid, uuid) from public, anon, authenticated;

create or replace function public.cc_dmail_assign(p_account uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare a app_private.dmail_accounts; v_name text; v_mailed boolean := false;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into a from dmail_accounts where id = p_account;
  if a.id is null then return jsonb_build_object('error','mailbox not found'); end if;
  if p_user is not null then
    select full_name into v_name from dispatcher_profiles where user_id = p_user and status in ('trial','verified','active');
    if v_name is null then return jsonb_build_object('error','not an active dispatcher'); end if;
    if exists (select 1 from dmail_accounts where assigned_to = p_user and id <> p_account) then
      return jsonb_build_object('error','that dispatcher already has a mailbox — unassign it first'); end if;
  end if;
  update dmail_accounts set assigned_to = p_user, assigned_at = case when p_user is null then null else now() end, assigned_by = auth.uid(), updated_at = now() where id = p_account;
  perform app_private.disp_audit('dmail.assign', 'dispatcher', coalesce(p_user, a.assigned_to)::text, null,
    a.address || case when p_user is null then ' unassigned' else ' assigned to ' || v_name end, jsonb_build_object('account', p_account));
  if p_user is not null and a.assigned_to is distinct from p_user then
    begin perform app_private.dmail_assign_email(p_user, p_account); v_mailed := true; exception when others then v_mailed := false; end;
  end if;
  return jsonb_build_object('ok', true, 'welcome_email', v_mailed);
end $$;
revoke all on function public.cc_dmail_assign(uuid, uuid) from public, anon;
grant execute on function public.cc_dmail_assign(uuid, uuid) to authenticated;


-- ===== migrations/bl_dmail_0359_identity_signature.sql =====
-- bl_dmail_0359 — sender identity is set BY THE SYSTEM when a mailbox is assigned (owner, 20 Sep 2026):
--   From name  = "LoadBoot Dispatch — <Dispatcher name>"
--   Signature  = the LoadBoot brand signature built for that dispatcher (logo, name, title, their dedicated dialer
--                number if they have one, their address, loadboot.com, tagline). Never an invented phone number.
-- Staff can still edit both afterwards in CC → Dispatcher email → Edit; "Rebuild brand signature" re-applies this.

create or replace function app_private.dmail_signature_html(p_name text, p_address text, p_phone text) returns text
language sql immutable as $fn$
  select '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;color:#10223B"><tr>'
    || '<td style="padding:2px 16px 2px 0;border-right:3px solid #FC5305;vertical-align:middle"><a href="https://loadboot.com" style="text-decoration:none"><img src="https://loadboot.com/email-logo-2x.png" width="124" height="30" alt="LoadBoot" style="display:block;border:0"></a></td>'
    || '<td style="padding:2px 0 2px 16px;vertical-align:middle">'
    || '<div style="font-size:16px;font-weight:700;color:#10223B;line-height:1.25">' || app_private.dmail_esc(p_name) || '</div>'
    || '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0883F7;line-height:1.6">Dispatcher &middot; LoadBoot Dispatch</div>'
    || '<div style="font-size:12.5px;color:#475569;line-height:1.6;margin-top:4px">'
    || case when nullif(p_phone,'') is not null then '<a href="tel:' || app_private.dmail_esc(regexp_replace(p_phone, '[^0-9+]', '', 'g')) || '" style="color:#475569;text-decoration:none">' || app_private.dmail_esc(p_phone) || '</a> &nbsp;|&nbsp; ' else '' end
    || '<a href="mailto:' || app_private.dmail_esc(p_address) || '" style="color:#475569;text-decoration:none">' || app_private.dmail_esc(p_address) || '</a> &nbsp;|&nbsp; '
    || '<a href="https://loadboot.com" style="color:#0883F7;text-decoration:none;font-weight:700">loadboot.com</a></div>'
    || '</td></tr></table>'
    || '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;margin-top:8px">The Operating System for Trucking</div>'
$fn$;

create or replace function app_private.dmail_identity_apply(p_account uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare a app_private.dmail_accounts; v_full text; v_name text; v_e164 text; v_phone text;
begin
  select * into a from dmail_accounts where id = p_account;
  if a.id is null then return jsonb_build_object('error','mailbox not found'); end if;
  select full_name into v_full from dispatcher_profiles where user_id = a.assigned_to;
  -- default = first two words of the dispatcher's name ("Abdul Aziz Shinwari" → "Abdul Aziz"); staff can pass any name
  v_name := coalesce(nullif(btrim(coalesce(p_name,'')), ''), nullif(btrim(split_part(coalesce(v_full,''), ' ', 1) || ' ' || split_part(coalesce(v_full,''), ' ', 2)), ''));
  if v_name is null then return jsonb_build_object('error','assign the mailbox first, or give a name'); end if;
  v_name := left(regexp_replace(v_name, '[<>"\r\n]', '', 'g'), 60);
  select phone_e164 into v_e164 from dialer_lines where dispatcher_user_id = a.assigned_to and status = 'active' limit 1;
  v_phone := case when v_e164 ~ '^\+1[0-9]{10}$' then '(' || substr(v_e164, 3, 3) || ') ' || substr(v_e164, 6, 3) || '-' || substr(v_e164, 9, 4) else v_e164 end;
  update dmail_accounts set display_name = 'LoadBoot Dispatch — ' || v_name,
    signature_html = app_private.dmail_signature_html(v_name, a.address, v_phone), updated_at = now() where id = p_account;
  return jsonb_build_object('ok', true, 'display_name', 'LoadBoot Dispatch — ' || v_name, 'phone', v_phone);
end $$;
revoke all on function app_private.dmail_identity_apply(uuid, text) from public, anon, authenticated;

create or replace function public.cc_dmail_identity_apply(p_account uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  perform app_private.disp_audit('dmail.identity', 'dmail_account', p_account::text, null, coalesce(p_name,'(default name)'), '{}'::jsonb);
  return app_private.dmail_identity_apply(p_account, p_name);
end $$;
revoke all on function public.cc_dmail_identity_apply(uuid, text) from public, anon;
grant execute on function public.cc_dmail_identity_apply(uuid, text) to authenticated;

drop function if exists public.cc_dmail_assign(uuid, uuid);
create or replace function public.cc_dmail_assign(p_account uuid, p_user uuid, p_name text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare a app_private.dmail_accounts; v_name text; v_mailed boolean := false; v_changed boolean;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into a from dmail_accounts where id = p_account;
  if a.id is null then return jsonb_build_object('error','mailbox not found'); end if;
  if p_user is not null then
    select full_name into v_name from dispatcher_profiles where user_id = p_user and status in ('trial','verified','active');
    if v_name is null then return jsonb_build_object('error','not an active dispatcher'); end if;
    if exists (select 1 from dmail_accounts where assigned_to = p_user and id <> p_account) then
      return jsonb_build_object('error','that dispatcher already has a mailbox — unassign it first'); end if;
  end if;
  v_changed := a.assigned_to is distinct from p_user;
  update dmail_accounts set assigned_to = p_user, assigned_at = case when p_user is null then null when v_changed then now() else assigned_at end, assigned_by = auth.uid(), updated_at = now() where id = p_account;
  perform app_private.disp_audit('dmail.assign', 'dispatcher', coalesce(p_user, a.assigned_to)::text, null,
    a.address || case when p_user is null then ' unassigned' else ' assigned to ' || v_name end, jsonb_build_object('account', p_account));
  if p_user is not null and (v_changed or nullif(btrim(coalesce(p_name,'')),'') is not null) then
    perform app_private.dmail_identity_apply(p_account, p_name);      -- From name + brand signature for THIS dispatcher
  end if;
  if p_user is not null and v_changed then
    begin perform app_private.dmail_assign_email(p_user, p_account); v_mailed := true; exception when others then v_mailed := false; end;
  end if;
  return jsonb_build_object('ok', true, 'welcome_email', v_mailed, 'display_name', (select display_name from dmail_accounts where id = p_account));
end $$;
revoke all on function public.cc_dmail_assign(uuid, uuid, text) from public, anon;
grant execute on function public.cc_dmail_assign(uuid, uuid, text) to authenticated;


commit;

select
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')) anon_n,
 (select md5(string_agg(p.proname, ',' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')) anon_hash,
 (select count(*) from pg_proc p where p.proname like '%dmail%' and has_function_privilege('anon',p.oid,'execute')) dmail_anon,
 has_function_privilege('authenticated','public.dmail_sync_targets(uuid)','execute') sync_targets_auth,
 (select count(*) from cron.job where jobname='dmail-sync-minutely') cron,
 (select fn_base from app_private.dmail_config where id=1) fn_base;
