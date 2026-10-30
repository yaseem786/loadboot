-- bl_disp_0572 — dispatcher conduct guard (high restriction)
-- A dispatcher may NOT, in any LoadBoot channel:
--   (a) ask a carrier for / share a personal WhatsApp, phone, email or another chat app, or steer the
--       conversation or payment off LoadBoot;
--   (b) ask or volunteer personal / protected matters (religion, nationality, ethnicity, age, marriage …).
-- Thread, SMS and WhatsApp are BLOCKED before anything leaves (BEFORE INSERT → raise, the send is refused,
-- nothing goes to Telnyx). Email is sent by SMTP before LoadBoot stores it, so email is FLAGGED after the fact.
-- Every block / flag is logged in app_private.contact_guard_hits and staff get an alert (CC bell; first hit of
-- the day per dispatcher also emails dispatch@). Staff and carriers are never checked.
-- The one official WhatsApp (+1 815-365-1168) and every LoadBoot line number are always allowed.

create table if not exists app_private.contact_guard_hits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  channel     text not null,          -- thread | sms | whatsapp | email
  target      text,                   -- assignment id / phone / thread id / recipient
  body        text not null,
  category    text not null,          -- contact | personal
  reason      text not null,
  action      text not null,          -- blocked | flagged | backfill
  created_at  timestamptz not null default now()
);
create index if not exists contact_guard_hits_user_idx on app_private.contact_guard_hits(user_id, created_at desc);
alter table app_private.contact_guard_hits enable row level security;
revoke all on app_private.contact_guard_hits from public, anon, authenticated;

-- dispatchers only (staff and everyone else are exempt)
create or replace function app_private.contact_guard_applies(p_uid uuid)
returns boolean language sql stable security definer
set search_path = app_private, public, pg_temp as $$
  select p_uid is not null
     and not app_private.disp_is_staff_user(p_uid)
     and exists (select 1 from app_private.dispatcher_profiles d where d.user_id = p_uid);
$$;

-- digits are a LoadBoot number? (official WhatsApp or any dialer line)
create or replace function app_private.contact_guard_is_lb_number(p_digits text)
returns boolean language sql stable security definer
set search_path = app_private, public, pg_temp as $$
  select right(p_digits, 10) = '8153651168'
      or exists (select 1 from app_private.dialer_numbers n
                  where right(regexp_replace(coalesce(n.phone_e164, ''), '\D', '', 'g'), 10) = right(p_digits, 10));
$$;

-- returns 'contact|<reason>' or 'personal|<reason>' or null
create or replace function app_private.contact_guard_reason(p_body text)
returns text language plpgsql stable security definer
set search_path = app_private, public, pg_temp as $$
declare
  t text;
  w constant text := '(wh?a?t''?s\s*ap+|watsap+|whatsap+)\M';        -- whatsapp + common misspellings
  m text[];
  d text;
begin
  if p_body is null or btrim(p_body) = '' then return null; end if;
  t := lower(p_body);
  t := translate(t, '’‘`´', '''''''''');
  t := regexp_replace(t, '\s+', ' ', 'g');
  -- SMS rows are stored branded ("LoadBoot: … Reply STOP to opt out.") — the brand is not the dispatcher's words
  t := regexp_replace(t, '^\s*loadboot:\s*', '');
  t := regexp_replace(t, '\s*reply stop to opt out\.?\s*$', '');

  -- ── (b) personal / protected ─────────────────────────────────────────────
  -- (not "islam" / "christian" alone: both are common names)
  if t ~ '\m(muslim|muslims|moslem|islamic|christianity|hindu|jewish|sikh|buddhist|catholic|protestant|atheist|religion|religious|mosque|masjid|namaz|ramadan|ramzan|bible|quran|koran)\M' then
    return 'personal|religion';
  end if;
  if t ~ '\m(are|r)\s+(you|u)\s+(a\s+|an\s+)?(pakistani|indian|arab|desi|mexican|african|somali|nigerian|afghan|bangladeshi|punjabi|ethiopian|russian|ukrainian|uzbek|turkish|haitian|cuban|filipino|chinese|american|immigrant|citizen)\M'
     or t ~ '\mwhere\s+(are|r)\s+(you|u)\s+(originally|really)\s+from\M'
     or t ~ '\mwhere\s+(are|r)\s+(you|u)\s+from\s*(\?|originally|$)'
     or t ~ '\m(which|what)\s+country\s+(are|r)\s+(you|u)\s+from'
     or t ~ '\mwhat\s+(country|nationality|ethnicity|race)\s+(are|r)\s+(you|u)'
     or t ~ '\m(your|ur)\s+(nationality|ethnicity|race|caste|religion|immigration|visa|green card|citizenship)\M'
     or t ~ '\m(your|ur)\s+(name|surname|accent)\s+(sounds|looks|seems|gave|gives)' then
    return 'personal|nationality / ethnicity';
  end if;
  if t ~ '\m(are|r)\s+(you|u)\s+(married|single|divorced|pregnant|gay|straight|dating)\M'
     or t ~ '\mhow\s+old\s+(are|r)\s+(you|u)\M'
     or t ~ '\m(your|ur)\s+(age|wife|husband|girlfriend|boyfriend|marital status)\M'
     or t ~ '\m(personal question|ask you something personal|something personal)\M' then
    return 'personal|private life question';
  end if;

  -- ── (a) off-platform contact ────────────────────────────────────────────
  if t ~ '(wa\.me/|t\.me/|chat\.whatsapp\.com|api\.whatsapp\.com)' then
    return 'contact|personal chat link';
  end if;
  if t ~ '\m(telegram|viber|wechat|botim|snapchat|skype|discord|signal app|imo app)\M'
     or t ~ '\m(your|ur|my|me on|me at|add me on|follow me on)\s+(instagram|insta|facebook|fb|messenger|tiktok|linkedin)\M' then
    return 'contact|other chat / social app';
  end if;
  -- "your WhatsApp" alone is fine (the carrier's chat with LoadBoot's line); asking for the NUMBER, a personal
  -- WhatsApp, or pointing to "my WhatsApp" / "me on WhatsApp" (without LoadBoot's official number) is not.
  if t ~ ('\m(your|ur)\s+(personal\s+|private\s+|own\s+|direct\s+|other\s+)?' || w || '\s*(number|no|num|#|contact|id)')
     or t ~ ('\m(what''?s|what\s+is|whats|send|give|share|drop|need|have)\s+(me\s+)?(your|ur)\s+(\w+\s+)?' || w)
     or t ~ ('\m(your|ur)\s+(personal|private|own|direct|other)\s+' || w)
     or ((t ~ ('\m(my|mine)\s+(\w+\s+)?' || w) or t ~ ('\mme\s+(on|at|via|through|in)\s+(\w+\s+)?' || w))
         and t !~ ('(8153651168|815[ .-]?365[ .-]?1168|\(815\)\s*365[ .-]?1168|loadboot''?s?\s+(official\s+)?(\w+\s+)?' || w || ')')) then
    return 'contact|personal WhatsApp';
  end if;
  if t ~ '\m(your|ur)\s+(personal|private|own|direct|cell|mobile|home|other)\s+(number|no|num|phone|cell|mobile|email|e-mail|gmail|mail|contact)\M'
     or t ~ '\m(what''?s|what\s+is|whats|send|give|share|drop|text)\s+(me\s+)?(your|ur)\s+(phone\s+|cell\s+|mobile\s+|contact\s+)?(number|no|num|phone|cell|mobile|gmail|contact)\M' then
    return 'contact|asked for personal contact';
  end if;
  if t ~ '\mmy\s+(personal|private|own|direct|cell|mobile|home|other)\s+(number|no|num|phone|cell|mobile|email|e-mail|gmail|mail|contact)\M'
     or t ~ '\m(my\s+(\w+\s+)?(e-?mail|gmail|mail)|e-?mail\s+me|mail\s+me|me\s+at)\s*(is|:|at|-)?\s*[a-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|icloud|aol|proton|protonmail|live|ymail|msn|rediffmail)\.'
     or t ~ '\m(call|text|message|msg|reach|contact|ping|dm)\s+me\s+(directly|personally|privately|on my|at my)\M' then
    return 'contact|shared personal contact';
  end if;
  -- "call/text me at <number>" or "my number is <number>" — allowed only when it is a LoadBoot number
  m := regexp_match(t, '(?:\m(?:call|text|reach|contact|message|msg)\s+me\s+(?:on|at)|\mmy\s+(?:\w+\s+){0,2}(?:number|no|num|cell|phone|mobile|line)\s*(?:is|:|-)?)\s*:?\s*(\+?[\d(][\d\s().-]{8,})');
  if m is not null then
    d := regexp_replace(m[1], '\D', '', 'g');
    if length(d) >= 10 and not app_private.contact_guard_is_lb_number(d) then
      return 'contact|shared personal number';
    end if;
  end if;
  if t ~ '\m(outside|off|without|bypass|bypassing|around)\s+(of\s+)?(the\s+)?(loadboot|platform|portal|app)\M'
     or t ~ '\m(don''?t|do not|dont|no need to)\s+(tell|inform|involve|cc|copy|let)\s+(loadboot|the platform|support|the office|them know)'
     or t ~ '\m(work|deal|book|dispatch)\s+(directly|privately|personally)\s+with\s+me\M'
     or t ~ '\mpay\s+me\s+(directly|personally|privately)\M'
     or t ~ '\m(zelle|cash\s*app|venmo|paypal|western union|wise transfer)\M' then
    return 'contact|off-platform deal or payment';
  end if;
  return null;
end $$;

create or replace function app_private.contact_guard_msg(p_rc text)
returns text language sql immutable as $$
  select case split_part(p_rc, '|', 1)
    when 'personal' then
      'BLOCKED — not sent (LoadBoot conduct rule: ' || split_part(p_rc, '|', 2) || '). Do not ask carriers about religion, nationality, ethnicity, age, marriage or other personal matters, and do not share yours. Keep every message about the trucks, loads and paperwork. This attempt has been logged for review.'
    else
      'BLOCKED — not sent (LoadBoot conduct rule: ' || split_part(p_rc, '|', 2) || '). Keep every carrier conversation on LoadBoot: this thread, your LoadBoot line (calls/SMS), your @loadboot.com mailbox, and LoadBoot''s official WhatsApp +1 815-365-1168 (the carrier''s chat there is already assigned to you in the portal). Never ask for or share a personal WhatsApp, phone number, email or other app. This attempt has been logged for review.'
  end;
$$;

-- log + staff alert (never raises)
create or replace function app_private.contact_guard_log(p_uid uuid, p_channel text, p_target text, p_body text, p_rc text, p_action text)
returns void language plpgsql security definer
set search_path = app_private, public, pg_temp as $$
declare v_name text; v_n7 int; v_today int;
begin
  begin
    -- de-duplicate a retry of the same text within 2 minutes
    if exists (select 1 from app_private.contact_guard_hits h where h.user_id = p_uid and h.body = p_body
                and h.channel = p_channel and h.created_at > now() - interval '2 minutes') then return; end if;
    insert into app_private.contact_guard_hits(user_id, channel, target, body, category, reason, action)
    values (p_uid, p_channel, p_target, left(p_body, 2000), split_part(p_rc, '|', 1), split_part(p_rc, '|', 2), p_action);
    if p_action = 'backfill' then return; end if;
    select coalesce(full_name, 'A dispatcher') into v_name from app_private.dispatcher_profiles where user_id = p_uid;
    select count(*) filter (where created_at > now() - interval '7 days'),
           count(*) filter (where created_at > date_trunc('day', now()))
      into v_n7, v_today from app_private.contact_guard_hits where user_id = p_uid and action <> 'backfill';
    perform app_private.disp_notify(
      null, 'staff', 'disp_exception_conduct',
      case when v_n7 >= 3 then 'REPEAT conduct breach: ' else 'Conduct breach: ' end || v_name || ' (' || p_channel || ', ' || p_action || ')',
      'Rule: ' || split_part(p_rc, '|', 2) || E'\n' || 'Message: "' || left(p_body, 400) || '"' || E'\n'
        || v_n7 || ' hit(s) in the last 7 days.',
      '/app/command-center/#dispatchers', v_today = 1);
  exception when others then null; end;
end $$;

-- BEFORE INSERT guard for thread / SMS / WhatsApp
create or replace function app_private.trg_contact_guard()
returns trigger language plpgsql security definer
set search_path = app_private, public, pg_temp as $$
declare v_uid uuid; v_body text; v_rc text;
begin
  if tg_table_name = 'dispatcher_messages' then
    if new.sender_role <> 'dispatcher' then return new; end if;
    v_uid := new.sender_user; v_body := new.body;
  elsif tg_table_name = 'dialer_messages' then
    if new.direction <> 'outbound' then return new; end if;
    v_uid := coalesce(new.sender_user_id, new.dispatcher_user_id); v_body := new.body;
  elsif tg_table_name = 'wa_messages' then
    if new.direction <> 'outbound' then return new; end if;
    v_uid := new.sender_user_id;
    v_body := coalesce(new.body, '') || ' ' || coalesce(new.media->>'caption', '');
  else
    return new;
  end if;
  if not app_private.contact_guard_applies(v_uid) then return new; end if;
  v_rc := app_private.contact_guard_reason(v_body);
  if v_rc is null then return new; end if;
  -- the raise rolls this transaction back, so the log is written by public.contact_guard_report
  -- (called by the edge function / the portal right after the refusal) — it re-checks the text itself.
  raise exception '%', app_private.contact_guard_msg(v_rc) using errcode = '42501';
end $$;

drop trigger if exists a1_contact_guard on app_private.dispatcher_messages;
create trigger a1_contact_guard before insert on app_private.dispatcher_messages
  for each row execute function app_private.trg_contact_guard();
drop trigger if exists a1_contact_guard on app_private.dialer_messages;
create trigger a1_contact_guard before insert on app_private.dialer_messages
  for each row execute function app_private.trg_contact_guard();
drop trigger if exists a1_contact_guard on app_private.wa_messages;
create trigger a1_contact_guard before insert on app_private.wa_messages
  for each row execute function app_private.trg_contact_guard();

-- AFTER INSERT flag for email (already sent by SMTP — cannot be stopped, only flagged)
create or replace function app_private.trg_contact_guard_mail()
returns trigger language plpgsql security definer
set search_path = app_private, public, pg_temp as $$
declare v_rc text;
begin
  if new.folder <> 'sent' or new.sent_by is null then return new; end if;
  if not app_private.contact_guard_applies(new.sent_by) then return new; end if;
  v_rc := app_private.contact_guard_reason(coalesce(new.subject, '') || E'\n' || coalesce(new.body_text, regexp_replace(coalesce(new.body_html, ''), '<[^>]+>', ' ', 'g')));
  if v_rc is not null then
    perform app_private.contact_guard_log(new.sent_by, 'email', left(coalesce(new.to_addrs::text, ''), 300),
      coalesce(new.subject, '') || ' — ' || left(coalesce(new.body_text, ''), 1500), v_rc, 'flagged');
  end if;
  return new;
end $$;
drop trigger if exists zz_contact_guard_mail on app_private.dmail_messages;
create trigger zz_contact_guard_mail after insert on app_private.dmail_messages
  for each row execute function app_private.trg_contact_guard_mail();

-- called by telnyx-sms / telnyx-whatsapp / the portal after a refusal, AS THE DISPATCHER.
-- Re-checks the text server-side, so it can only log what the guard really blocks.
create or replace function public.contact_guard_report(p_channel text, p_body text, p_target text default null)
returns jsonb language plpgsql security definer
set search_path = app_private, public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_rc text;
begin
  if p_channel not in ('thread', 'sms', 'whatsapp') then return jsonb_build_object('ok', false); end if;
  if not app_private.contact_guard_applies(v_uid) then return jsonb_build_object('ok', false); end if;
  v_rc := app_private.contact_guard_reason(p_body);
  if v_rc is null then return jsonb_build_object('ok', false); end if;
  perform app_private.contact_guard_log(v_uid, p_channel, left(p_target, 200), p_body, v_rc, 'blocked');
  return jsonb_build_object('ok', true, 'reason', split_part(v_rc, '|', 2));
end $$;
revoke all on function public.contact_guard_report(text, text, text) from public, anon;
grant execute on function public.contact_guard_report(text, text, text) to authenticated;

-- staff list for Command Center
create or replace function public.cc_contact_guard_hits(p_days int default 30)
returns jsonb language plpgsql stable security definer
set search_path = app_private, public, pg_temp as $$
begin
  if not app_private.disp_is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', h.id, 'at', h.created_at, 'user_id', h.user_id, 'name', d.full_name, 'channel', h.channel,
      'target', h.target, 'category', h.category, 'reason', h.reason, 'action', h.action, 'body', h.body)
      order by h.created_at desc)
    from app_private.contact_guard_hits h left join app_private.dispatcher_profiles d on d.user_id = h.user_id
   where h.created_at > now() - make_interval(days => greatest(1, least(p_days, 365)))), '[]'::jsonb);
end $$;
revoke all on function public.cc_contact_guard_hits(int) from public, anon;
grant execute on function public.cc_contact_guard_hits(int) to authenticated;

-- backfill: last 30 days of messages already sent (log only, no alerts)
do $$
declare r record; v_rc text;
begin
  for r in
    select 'sms' ch, coalesce(m.sender_user_id, m.dispatcher_user_id) uid, m.counterparty tgt, m.body, m.created_at
      from app_private.dialer_messages m where m.direction = 'outbound' and m.created_at > now() - interval '30 days'
    union all
    select 'whatsapp', w.sender_user_id, w.thread_id::text, coalesce(w.body, ''), w.created_at
      from app_private.wa_messages w where w.direction = 'outbound' and w.created_at > now() - interval '30 days'
    union all
    select 'thread', x.sender_user, x.assignment_id::text, x.body, x.created_at
      from app_private.dispatcher_messages x where x.sender_role = 'dispatcher' and x.created_at > now() - interval '30 days'
  loop
    if app_private.contact_guard_applies(r.uid) then
      v_rc := app_private.contact_guard_reason(r.body);
      if v_rc is not null then
        insert into app_private.contact_guard_hits(user_id, channel, target, body, category, reason, action, created_at)
        values (r.uid, r.ch, r.tgt, left(r.body, 2000), split_part(v_rc, '|', 1), split_part(v_rc, '|', 2), 'backfill', r.created_at);
      end if;
    end if;
  end loop;
end $$;
