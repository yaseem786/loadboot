-- bl_mail_0471 — CC Mailbox: a `system` folder, so Unread means "a human is waiting".
--
-- Plan: docs/livechat/LIVECHAT-CLAUDE-BRAIN-PLAN.md §4 "plumbing" (§12 step 3). Staging 27 Sep 2026, prod 27 Sep 2026.
--
-- WHY
--   §1 counted 93 inbound rows in app_private.mail_messages over 30 days, all on loads@, and 86 of them were not
--   customers: the Namecheap forwarder rewrites every forwarded sender to postmaster@*.jellyfish.systems (75 rows),
--   our own outbound copies land back (10), plus bounces, no-reply notifications and receipts. The Mailbox showed
--   all of it as "Unread — need a reply", so the counters meant nothing and real mail was buried.
--
-- WHAT THIS ADDS
--   mail_messages.folder        inbox | system   (not null, default inbox, check constraint)
--   mail_messages.mail_class    why it was filed: human | bounce | noreply | receipt | auto_reply | own_copy |
--                               forwarder_rewrite | spam | unsubscribe | manual
--   mail_messages.envelope_from the raw SRS sender when peer_email was unwrapped (srs0=…@fwd.privateemail.com)
--   app_private.mail_unwrap_srs(text)        srs0=<hash>=<tt>=<domain>=<local>@fwd… → local@domain
--   app_private.mail_decode_words(text)      RFC 2047 =?charset?Q|B?…?= subjects → plain text (used by the classifier)
--   app_private.mail_classify(from, subject, body) → the mail_class above; 'human' is the only class that goes to inbox
--   public.cc_mail_ingest(jsonb)             now unwraps SRS, classifies, files, auto-reads system mail, and only
--                                            raises the staff in-app notification for inbox mail. service_role only.
--   public.cc_mail_stats()                   threads/unread count the inbox only; new `system` + `system_30d`
--   public.cc_mail_list(..., p_folder)       default 'inbox'; 'system' | 'all' on request. Old 4-arg signature dropped.
--   public.cc_mail_set_folder(thread, folder) staff (comm.manage) moves a thread; mail_class becomes 'manual'; audited.
--   Backfill: every existing inbound row is unwrapped, classified and filed; outbound rows follow their thread.
--
-- INVARIANTS (asserted at the bottom; the migration refuses to commit if any fails)
--   - anon SECURITY DEFINER surface unchanged (36 prod / 35 staging, CLAUDE.md §4) — no new anon name, none removed.
--   - cc_mail_ingest stays service_role-only (the inbound-mail edge function is the only caller).
--   - every row has a folder; the SRS unwrap and the classifier reproduce the shapes seen on prod.
--
-- NOT in this file: the brain on email (§4 second half, §12 step 5) and the Needs-you / Waiting / Done folders.
-- The UI change that goes with it is app/command-center/views/mailbox.js (Inbox / System / All folder switch).

create temp table _bl0471_secdef_before as
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

alter table app_private.mail_messages
  add column if not exists folder        text,
  add column if not exists mail_class    text,
  add column if not exists envelope_from text;

comment on column app_private.mail_messages.folder is
  'inbox = a human may be waiting on us | system = bounces, receipts, our own copies, auto-replies; auto-read, never counted as unread. bl_mail_0471.';
comment on column app_private.mail_messages.mail_class is
  'Why it was filed there: human | bounce | noreply | receipt | auto_reply | own_copy | forwarder_rewrite | spam | unsubscribe | manual (moved by staff). bl_mail_0471.';
comment on column app_private.mail_messages.envelope_from is
  'The raw sender as it arrived when peer_email was unwrapped from an SRS forward (srs0=...@fwd.privateemail.com). Null when nothing was unwrapped.';

create or replace function app_private.mail_unwrap_srs(p_email text)
returns text
language sql
immutable
set search_path to 'app_private, public'
as $$
  select case
    when lower(coalesce(p_email,'')) ~ '^srs0[=+-][^=@]*=[^=@]*=[^=@]+=[^@]+@'
      then regexp_replace(lower(p_email), '^srs0[=+-][^=@]*=[^=@]*=([^=@]+)=([^@]+)@.*$', '\2@\1')
    else lower(coalesce(p_email,''))
  end;
$$;
revoke execute on function app_private.mail_unwrap_srs(text) from public, anon, authenticated;

create or replace function app_private.mail_decode_words(p text)
returns text
language plpgsql
immutable
set search_path to 'app_private, public'
as $$
declare
  v_out text := coalesce(p, '');
  m text[]; v_cs text; v_enc text; v_txt text; v_dec text; v_hex text; v_i int; v_c text;
begin
  if v_out !~ '=\?[^?]+\?[bBqQ]\?[^?]*\?=' then return v_out; end if;
  for m in select regexp_matches(v_out, '=\?([^?]+)\?([bBqQ])\?([^?]*)\?=', 'g') loop
    v_cs := m[1]; v_enc := upper(m[2]); v_txt := m[3];
    begin
      if v_enc = 'B' then
        v_dec := convert_from(decode(v_txt, 'base64'), v_cs);
      else
        v_hex := ''; v_i := 1;
        while v_i <= length(v_txt) loop
          v_c := substr(v_txt, v_i, 1);
          if v_c = '=' and substr(v_txt, v_i + 1, 2) ~ '^[0-9A-Fa-f]{2}$' then
            v_hex := v_hex || substr(v_txt, v_i + 1, 2); v_i := v_i + 3;
          elsif v_c = '_' then
            v_hex := v_hex || '20'; v_i := v_i + 1;
          else
            v_hex := v_hex || encode(convert_to(v_c, 'UTF8'), 'hex'); v_i := v_i + 1;
          end if;
        end loop;
        v_dec := convert_from(decode(v_hex, 'hex'), v_cs);
      end if;
    exception when others then
      v_dec := null;
    end;
    if v_dec is not null then
      v_out := replace(v_out, '=?' || m[1] || '?' || m[2] || '?' || m[3] || '?=', v_dec);
    end if;
  end loop;
  return v_out;
exception when others then
  return coalesce(p, '');
end;
$$;
revoke execute on function app_private.mail_decode_words(text) from public, anon, authenticated;

create or replace function app_private.mail_classify(p_from text, p_subject text, p_body text default null)
returns text
language plpgsql
immutable
set search_path to 'app_private, public'
as $$
declare
  v_from  text := app_private.mail_unwrap_srs(p_from);
  v_local text := split_part(v_from, '@', 1);
  v_dom   text := split_part(v_from, '@', 2);
  v_subj  text := lower(app_private.mail_decode_words(coalesce(p_subject, '')));
  v_body  text := lower(left(coalesce(p_body, ''), 6000));
begin
  if v_subj like '[loads@ spam]%'                       then return 'spam'; end if;
  if v_subj like '[unsubscribe]%'                       then return 'unsubscribe'; end if;

  if v_subj ~ '^(\[loads@ [a-z_]+\] )?\[test (→|->) '      then return 'own_copy'; end if;
  if v_dom in ('loadboot.com', 'send.loadboot.com', 'in.loadboot.com') then return 'own_copy'; end if;
  if v_body ~ '(loadboot · support: https://loadboot\.com|wa\.me/18153651168|prefer to chat\? whatsapp us 24/7)'
                                                        then return 'own_copy'; end if;

  if v_local = 'postmaster' and v_dom ~ '\.jellyfish\.systems$' then return 'forwarder_rewrite'; end if;

  if v_local ~ '^(postmaster|mailer-daemon|mailer_daemon|bounce|bounces|pm_bounces|bounce\+.*|bounces\+.*)$'
     or v_dom ~ '(^|\.)(pm-)?bounces?\.'
     or v_subj ~ '^(undeliver|delivery status notification|mail delivery (failed|subsystem)|returned mail|delivery failure|failure notice)'
                                                        then return 'bounce'; end if;

  if v_subj ~ '^(re: )?(auto(matic)?[ -]?reply|out of (the )?office|automatic reply|autoreply)'
                                                        then return 'auto_reply'; end if;

  if v_local ~ '^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|notify|alerts?|newsletter|news|receipts?|invoices?|mailer|updates?|digest|security)(\+.*)?$'
     or v_from in ('hello@privateemail.com')
                                                        then return 'noreply'; end if;

  if v_subj ~ '(your receipt|receipt from|payment (success|received|unsuccessful|failed|confirmation)|sign-in link|login link|verification code|verify your (email|account)|reset your password|password was changed|account verification|program enrollment|is now verified|two-factor|2fa code|order confirmation|subscription (renewed|will renew)|trial (ends|expires)|weekly (digest|summary)|daily (digest|summary))'
                                                        then return 'receipt'; end if;

  return 'human';
end;
$$;
revoke execute on function app_private.mail_classify(text, text, text) from public, anon, authenticated;

create or replace function public.cc_mail_ingest(p jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  v_id uuid; v_thread text; v_subj text; v_raw_from text; v_from text; v_to text;
  v_class text; v_folder text;
begin
  v_raw_from := lower(coalesce(p->>'from_email',''));
  v_to       := lower(coalesce(p->>'to_email',''));
  if v_raw_from = '' or v_to = '' then raise exception 'from/to required'; end if;
  v_from := app_private.mail_unwrap_srs(v_raw_from);
  v_subj := coalesce(p->>'subject','(no subject)');
  v_thread := v_from || ':' || regexp_replace(lower(v_subj), '^((re|fwd?)\s*:\s*)+', '', 'i');

  v_class  := app_private.mail_classify(v_from, v_subj, p->>'body_text');
  v_folder := case when v_class = 'human' then 'inbox' else 'system' end;

  insert into app_private.mail_messages(direction, mailbox, peer_email, peer_name, subject, body_text, body_html,
                                        provider_message_id, in_reply_to, thread_key,
                                        folder, mail_class, envelope_from, read_at)
    values ('in', v_to, v_from, nullif(p->>'from_name',''), v_subj, p->>'body_text', p->>'body_html',
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
end; $function$;
revoke execute on function public.cc_mail_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.cc_mail_ingest(jsonb) to service_role;

update app_private.mail_messages m
   set peer_email    = app_private.mail_unwrap_srs(m.peer_email),
       envelope_from = nullif(lower(m.peer_email), app_private.mail_unwrap_srs(m.peer_email)),
       thread_key    = app_private.mail_unwrap_srs(m.peer_email) || substr(m.thread_key, position(':' in m.thread_key))
 where m.direction = 'in'
   and m.folder is null
   and lower(m.peer_email) ~ '^srs0[=+-]'
   and position(':' in m.thread_key) > 0;

update app_private.mail_messages m
   set mail_class = c.cls,
       folder     = case when c.cls = 'human' then 'inbox' else 'system' end,
       read_at    = case when c.cls = 'human' then m.read_at else coalesce(m.read_at, now()) end
  from (select id, app_private.mail_classify(peer_email, subject, body_text) as cls
          from app_private.mail_messages where folder is null and direction = 'in') c
 where c.id = m.id;

update app_private.mail_messages m
   set folder = coalesce((select i.folder from app_private.mail_messages i
                           where i.thread_key = m.thread_key and i.direction = 'in' and i.folder is not null
                           order by i.created_at desc limit 1), 'inbox'),
       mail_class = coalesce(m.mail_class, 'human')
 where m.folder is null;

alter table app_private.mail_messages alter column folder set default 'inbox';
alter table app_private.mail_messages alter column folder set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mail_messages_folder_chk') then
    alter table app_private.mail_messages
      add constraint mail_messages_folder_chk check (folder in ('inbox', 'system'));
  end if;
end $$;

create index if not exists idx_mail_folder_created on app_private.mail_messages (folder, created_at desc);
drop index if exists app_private.idx_mail_unread;
create index idx_mail_unread on app_private.mail_messages (thread_key)
  where direction = 'in' and read_at is null and folder = 'inbox';

create or replace function public.cc_mail_stats()
returns jsonb
language plpgsql
stable security definer
set search_path to 'app_private, public'
as $function$
declare j jsonb;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'threads',  (select count(distinct thread_key) from app_private.mail_messages where folder = 'inbox'),
    'unread',   (select count(*) from app_private.mail_messages where direction = 'in' and read_at is null and folder = 'inbox'),
    'system',   (select count(distinct thread_key) from app_private.mail_messages where folder = 'system'),
    'system_30d', (select count(*) from app_private.mail_messages where folder = 'system' and direction = 'in' and created_at > now() - interval '30 days'),
    'drafts',   (select count(*) from app_private.mail_messages where status = 'draft'),
    'sent',     (select count(*) from app_private.mail_messages where status = 'sent'),
    'can_send', public.has_global_permission('comm.manage'),
    'mailboxes', coalesce((
      select jsonb_agg(x order by x->>'mailbox')
        from (
          select jsonb_build_object(
                   'mailbox', mailbox,
                   'total',   count(*) filter (where folder = 'inbox'),
                   'unread',  count(*) filter (where direction = 'in' and read_at is null and folder = 'inbox'),
                   'system',  count(*) filter (where folder = 'system')
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
revoke execute on function public.cc_mail_stats() from public, anon;
grant execute on function public.cc_mail_stats() to authenticated, service_role;

drop function if exists public.cc_mail_list(integer, text, text, timestamptz);
create or replace function public.cc_mail_list(
  p_limit integer default 50, p_mailbox text default null, p_search text default null,
  p_before timestamptz default null, p_folder text default 'inbox')
returns jsonb
language plpgsql
stable security definer
set search_path to 'app_private, public'
as $function$
declare
  v_limit  int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_q      text := nullif(btrim(coalesce(p_search, '')), '');
  v_folder text := case when p_folder in ('inbox', 'system', 'all') then p_folder else 'inbox' end;
  v_rows   jsonb;
  v_next   timestamptz;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with latest as (
    select distinct on (m.thread_key) m.*
      from app_private.mail_messages m
     where (p_mailbox is null or m.mailbox = p_mailbox)
       and (v_folder = 'all' or m.folder = v_folder)
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
                               where d.thread_key = p.thread_key and d.status = 'draft')
      ) as t
    ) x;

  return jsonb_build_object(
    'threads', coalesce(v_rows, '[]'::jsonb),
    'folder', v_folder,
    'next_before', case when jsonb_array_length(coalesce(v_rows, '[]'::jsonb)) < v_limit then null else v_next end
  );
end;
$function$;
revoke execute on function public.cc_mail_list(integer, text, text, timestamptz, text) from public, anon;
grant execute on function public.cc_mail_list(integer, text, text, timestamptz, text) to authenticated, service_role;

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
revoke execute on function public.cc_mail_set_folder(text, text) from public, anon;
grant execute on function public.cc_mail_set_folder(text, text) to authenticated, service_role;

do $$
declare added text; removed text; bad int;
begin
  select string_agg(proname, ',') into added from (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select proname from _bl0471_secdef_before) a;
  select string_agg(proname, ',') into removed from (
    select proname from _bl0471_secdef_before
    except select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) r;
  if added is not null or removed is not null then
    raise exception 'bl_mail_0471: anon secdef surface changed — added [%] removed [%]', coalesce(added,''), coalesce(removed,'');
  end if;
  if has_function_privilege('anon', 'public.cc_mail_ingest(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.cc_mail_ingest(jsonb)', 'execute') then
    raise exception 'bl_mail_0471: cc_mail_ingest must stay service_role only';
  end if;
  select count(*) into bad from app_private.mail_messages where folder is null or folder not in ('inbox','system');
  if bad > 0 then raise exception 'bl_mail_0471: % rows without a folder', bad; end if;
  if app_private.mail_unwrap_srs('srs0=cbnw=hm=email.apple.com=developer@fwd.privateemail.com') <> 'developer@email.apple.com'
     then raise exception 'bl_mail_0471: srs unwrap broken'; end if;
  if app_private.mail_classify('postmaster@out-2uec-a84.jellyfish.systems', '[loads@ other] Reset your password') = 'human'
     or app_private.mail_classify('srs0=hthp=hn=pm-bounces.telnyx.com=pm_bounces@fwd.privateemail.com', 'Re: 10DLC Brand') = 'human'
     or app_private.mail_classify('no-reply@stripe.com', 'Your receipt #1') = 'human'
     or app_private.mail_classify('someone@gmail.com', '[TEST → x@y.com] Welcome') = 'human'
     or app_private.mail_classify('someone@gmail.com', '[loads@ other] =?UTF-8?Q?=5BTEST_=E2=86=92_hello=40loadboot=2Ecom=5D?= Welcome') = 'human'
     or app_private.mail_decode_words('=?UTF-8?Q?=E2=8F=B1_228_min_unanswered?=') <> '⏱ 228 min unanswered'
     or app_private.mail_classify('srs0=rrdv=hm=apple.com=eurodev@fwd.privateemail.com', '[loads@ other] Developer Support', 'Hello Muhammad, thank you for your interest') <> 'human'
     or app_private.mail_classify('john@acmefreight.com', 'Re: setup for our carriers', 'Hi, can we talk tomorrow?') <> 'human'
     then raise exception 'bl_mail_0471: classifier rules do not match the prod shapes'; end if;
  drop table if exists _bl0471_secdef_before;
end $$;
