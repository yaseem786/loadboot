-- bl_dial_0352 — dispatcher TEXT MESSAGES (SMS) on the same line as their calls. Additive; nothing in 0351 changes shape.
--   • every text is a row in LoadBoot (app_private.dialer_messages), matched to broker / carrier / driver like calls are
--   • the dispatcher sends from their own number; replies come back to the same number and thread
--   • STOP / START are honoured here too (Telnyx also auto-replies at the messaging-profile level): an opted-out number
--     cannot be texted again until it sends START
--   • US / Canada only, toll-fraud list applies, hourly cap, 1000-char limit. OFF until dialer_config.sms_enabled = true
--     (turn it on only after the 10DLC campaign is approved and the number is attached to it).
-- Flow out: dock → edge fn telnyx-sms → dialer_sms_prepare (AS THE USER: checks + queued row) → Telnyx /v2/messages → dialer_sms_mark.
-- Flow in : Telnyx messaging webhook → telnyx-hook (signed) → dialer_sms_hook → row + web push. STAGING first.

alter table app_private.dialer_config add column if not exists sms_enabled boolean not null default false;
alter table app_private.dialer_config add column if not exists telnyx_messaging_profile_id text;
alter table app_private.dialer_config add column if not exists max_sms_per_hour int not null default 60;

create table if not exists app_private.dialer_messages (
  id uuid primary key default gen_random_uuid(),
  line_id uuid references app_private.dialer_lines(id) on delete set null,
  dispatcher_user_id uuid not null,
  direction text not null check (direction in ('inbound','outbound')),
  counterparty text not null,
  body text not null default '',
  media jsonb,
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed','received')),
  telnyx_message_id text unique,
  error text,
  contact_name text,
  contact_kind text,
  carrier_org_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dialer_messages_thread_ix on app_private.dialer_messages (dispatcher_user_id, counterparty, created_at desc);
create index if not exists dialer_messages_unread_ix on app_private.dialer_messages (dispatcher_user_id) where direction = 'inbound' and read_at is null;

create table if not exists app_private.dialer_sms_optout (
  number text primary key,
  at timestamptz not null default now(),
  keyword text
);

alter table app_private.dialer_messages enable row level security;
alter table app_private.dialer_sms_optout enable row level security;

create or replace function app_private.dial_msg_json(m app_private.dialer_messages) returns jsonb language sql stable as $$
  select jsonb_build_object('id', m.id, 'direction', m.direction, 'number', m.counterparty, 'body', m.body, 'media', m.media,
    'status', m.status, 'error', m.error, 'contact_name', m.contact_name, 'contact_kind', m.contact_kind, 'at', m.created_at, 'read', m.read_at is not null)
$$;

-- ---------------------------------------------------------------- dispatcher RPCs
create or replace function public.dialer_sms_threads() returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); cfg app_private.dialer_config;
begin
  if v_uid is null then return jsonb_build_object('error','Sign in first.'); end if;
  select * into cfg from app_private.dialer_config limit 1;
  return jsonb_build_object('enabled', coalesce(cfg.enabled,false) and coalesce(cfg.sms_enabled,false),
    'unread', (select count(*) from app_private.dialer_messages where dispatcher_user_id = v_uid and direction = 'inbound' and read_at is null),
    'threads', coalesce((select jsonb_agg(t order by (t->>'at') desc) from (
        select distinct on (m.counterparty) jsonb_build_object('number', m.counterparty,
          'contact_name', (select x.contact_name from app_private.dialer_messages x where x.dispatcher_user_id = v_uid and x.counterparty = m.counterparty and x.contact_name is not null order by x.created_at desc limit 1),
          'contact_kind', m.contact_kind, 'body', left(m.body, 140), 'direction', m.direction, 'status', m.status, 'at', m.created_at,
          'unread', (select count(*) from app_private.dialer_messages u where u.dispatcher_user_id = v_uid and u.counterparty = m.counterparty and u.direction = 'inbound' and u.read_at is null),
          'opted_out', exists (select 1 from app_private.dialer_sms_optout o where o.number = m.counterparty)) t
        from app_private.dialer_messages m where m.dispatcher_user_id = v_uid
        order by m.counterparty, m.created_at desc) q), '[]'::jsonb));
end $$;

create or replace function public.dialer_sms_thread(p_number text, p_before timestamptz default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); e text := app_private.dial_e164(p_number); mt jsonb;
begin
  if v_uid is null then return jsonb_build_object('error','Sign in first.'); end if;
  if e is null then return jsonb_build_object('error','That is not a valid number.'); end if;
  update app_private.dialer_messages set read_at = now() where dispatcher_user_id = v_uid and counterparty = e and direction = 'inbound' and read_at is null;
  mt := app_private.dial_match(v_uid, e);
  return jsonb_build_object('number', e, 'match', mt,
    'opted_out', exists (select 1 from app_private.dialer_sms_optout o where o.number = e),
    'messages', coalesce((select jsonb_agg(app_private.dial_msg_json(m) order by m.created_at) from (
        select * from app_private.dialer_messages where dispatcher_user_id = v_uid and counterparty = e
          and (p_before is null or created_at < p_before) order by created_at desc limit 60) m), '[]'::jsonb));
end $$;

-- checks + the queued row. Called by the telnyx-sms edge function WITH THE USER'S JWT, so auth.uid() is the dispatcher.
create or replace function public.dialer_sms_prepare(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); cfg app_private.dialer_config; ln app_private.dialer_lines; e text; why text; mt jsonb;
  v_body text := btrim(coalesce(p->>'body','')); m app_private.dialer_messages; n int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Sign in first.'); end if;
  select * into cfg from app_private.dialer_config limit 1;
  if not (coalesce(cfg.enabled,false) and coalesce(cfg.sms_enabled,false)) then
    return jsonb_build_object('ok', false, 'error', 'Text messaging is not switched on yet.'); end if;
  select * into ln from app_private.dialer_lines where dispatcher_user_id = v_uid and status = 'active';
  if ln.id is null then return jsonb_build_object('ok', false, 'error', 'No phone line is assigned to you yet.'); end if;
  e := app_private.dial_e164(p->>'to');
  if e is null or e !~ '^\+1[2-9][0-9]{9}$' then return jsonb_build_object('ok', false, 'error', 'Texts go to US or Canada mobile numbers only.'); end if;
  why := app_private.dial_blocked(e, false);
  if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  if exists (select 1 from app_private.dialer_lines where phone_e164 = e) then return jsonb_build_object('ok', false, 'error', 'That is a LoadBoot line.'); end if;
  if exists (select 1 from app_private.dialer_sms_optout where number = e) then
    return jsonb_build_object('ok', false, 'error', 'This number replied STOP — it cannot be texted until it sends START.'); end if;
  if v_body = '' then return jsonb_build_object('ok', false, 'error', 'Write a message first.'); end if;
  if length(v_body) > 1000 then return jsonb_build_object('ok', false, 'error', 'That message is too long (1000 characters max).'); end if;
  select count(*) into n from app_private.dialer_messages where dispatcher_user_id = v_uid and direction = 'outbound' and created_at > now() - interval '1 hour';
  if n >= coalesce(cfg.max_sms_per_hour, 60) then return jsonb_build_object('ok', false, 'error', 'Hourly text limit reached — try again shortly.'); end if;
  mt := app_private.dial_match(v_uid, e);
  insert into app_private.dialer_messages (line_id, dispatcher_user_id, direction, counterparty, body, status, contact_name, contact_kind, carrier_org_id)
  values (ln.id, v_uid, 'outbound', e, v_body, 'queued', nullif(mt->>'contact_name',''), nullif(mt->>'kind',''), nullif(mt->>'carrier_org_id','')::uuid)
  returning * into m;
  return jsonb_build_object('ok', true, 'id', m.id, 'from', ln.phone_e164, 'to', e, 'body', v_body, 'messaging_profile_id', cfg.telnyx_messaging_profile_id);
end $$;

-- ---------------------------------------------------------------- service-role RPCs (edge functions only)
create or replace function public.dialer_sms_mark(p_id uuid, p_status text, p_telnyx_id text default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare m app_private.dialer_messages;
begin
  update app_private.dialer_messages set status = case when p_status in ('sent','delivered','failed','queued') then p_status else status end,
     telnyx_message_id = coalesce(p_telnyx_id, telnyx_message_id), error = left(p_error, 300), updated_at = now()
   where id = p_id returning * into m;
  return case when m.id is null then null else app_private.dial_msg_json(m) end;
end $$;

create or replace function public.dialer_sms_hook(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare ev text := p->>'event_type'; pl jsonb := coalesce(p->'payload','{}'::jsonb); v_id text := pl->>'id';
  v_from text; v_to text; v_text text; ln app_private.dialer_lines; mt jsonb; m app_private.dialer_messages; kw text; st text;
begin
  if ev = 'message.received' then
    v_from := app_private.dial_e164(pl->'from'->>'phone_number');
    v_to   := app_private.dial_e164(coalesce(pl->'to'->0->>'phone_number', pl->>'to'));
    v_text := coalesce(pl->>'text','');
    if v_from is null or v_to is null then return jsonb_build_object('ok', true, 'skipped', 'numbers'); end if;
    select * into ln from app_private.dialer_lines where phone_e164 = v_to and status = 'active';
    if ln.id is null then return jsonb_build_object('ok', true, 'skipped', 'no line'); end if;
    if v_id is not null and exists (select 1 from app_private.dialer_messages where telnyx_message_id = v_id) then return jsonb_build_object('ok', true, 'dup', true); end if;
    kw := upper(btrim(v_text));
    if kw in ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT') then
      insert into app_private.dialer_sms_optout (number, keyword) values (v_from, kw) on conflict (number) do update set at = now(), keyword = excluded.keyword;
    elsif kw in ('START','YES','UNSTOP') then
      delete from app_private.dialer_sms_optout where number = v_from;
    end if;
    mt := app_private.dial_match(ln.dispatcher_user_id, v_from);
    insert into app_private.dialer_messages (line_id, dispatcher_user_id, direction, counterparty, body, media, status, telnyx_message_id, contact_name, contact_kind, carrier_org_id)
    values (ln.id, ln.dispatcher_user_id, 'inbound', v_from, left(v_text, 4000),
            case when jsonb_typeof(pl->'media') = 'array' and jsonb_array_length(pl->'media') > 0 then pl->'media' else null end,
            'received', v_id, nullif(mt->>'contact_name',''), nullif(mt->>'kind',''), nullif(mt->>'carrier_org_id','')::uuid)
    returning * into m;
    return jsonb_build_object('ok', true, 'message_id', m.id, 'notify', jsonb_build_object('user_id', ln.dispatcher_user_id,
      'title', 'Text from ' || coalesce(m.contact_name, v_from), 'body', left(v_text, 120), 'url', '/app/agent/#today'));
  elsif ev in ('message.sent','message.finalized') then
    st := lower(coalesce(pl->'to'->0->>'status', ''));
    update app_private.dialer_messages set updated_at = now(),
       status = case when st = 'delivered' then 'delivered'
                     when st in ('sending_failed','delivery_failed','failed') then 'failed'
                     when st in ('sent','queued','sending','delivery_unconfirmed') and status = 'queued' then 'sent' else status end,
       error = case when st in ('sending_failed','delivery_failed','failed') then left(coalesce(pl->'errors'->0->>'detail', pl->'errors'->0->>'title', st), 300) else error end
     where telnyx_message_id = v_id and direction = 'outbound';
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', true, 'ignored', ev);
end $$;

-- ---------------------------------------------------------------- Command Center
create or replace function public.cc_dialer_sms(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_disp uuid := nullif(p->>'dispatcher','')::uuid; v_q text := nullif(btrim(coalesce(p->>'q','')),''); v_lim int := least(coalesce((p->>'limit')::int, 100), 300);
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  return jsonb_build_object('messages', coalesce((select jsonb_agg(app_private.dial_msg_json(m) || jsonb_build_object('dispatcher_user_id', m.dispatcher_user_id,
        'dispatcher', (select coalesce(nullif(pr.contact_name,''), u.email) from auth.users u left join public.profiles pr on pr.id = u.id where u.id = m.dispatcher_user_id)) order by m.created_at desc)
      from (select * from app_private.dialer_messages x where (v_disp is null or x.dispatcher_user_id = v_disp)
              and (v_q is null or x.counterparty ilike '%' || v_q || '%' or x.body ilike '%' || v_q || '%' or x.contact_name ilike '%' || v_q || '%')
             order by x.created_at desc limit v_lim) m), '[]'::jsonb));
end $$;

-- cc_dialer_config_set accepts the two SMS settings (patched in place, idempotent)
do $$
declare s text;
begin
  s := pg_get_functiondef('public.cc_dialer_config_set(jsonb)'::regprocedure);
  if position('sms_enabled' in s) = 0 then
    if position('    record_calls = ' in s) = 0 then raise exception 'bl_dial_0352: expected text not found in cc_dialer_config_set'; end if;
    s := replace(s, '    record_calls = ', $n$    sms_enabled = coalesce((p->>'sms_enabled')::boolean, sms_enabled),
    telnyx_messaging_profile_id = case when p ? 'telnyx_messaging_profile_id' then nullif(btrim(p->>'telnyx_messaging_profile_id'),'') else telnyx_messaging_profile_id end,
    record_calls = $n$);
    execute s;
  end if;
end $$;

revoke all on function public.dialer_sms_threads() from public, anon;
revoke all on function public.dialer_sms_thread(text, timestamptz) from public, anon;
revoke all on function public.dialer_sms_prepare(jsonb) from public, anon;
revoke all on function public.cc_dialer_sms(jsonb) from public, anon;
revoke all on function public.dialer_sms_mark(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.dialer_sms_hook(jsonb) from public, anon, authenticated;
grant execute on function public.dialer_sms_threads() to authenticated;
grant execute on function public.dialer_sms_thread(text, timestamptz) to authenticated;
grant execute on function public.dialer_sms_prepare(jsonb) to authenticated;
grant execute on function public.cc_dialer_sms(jsonb) to authenticated;
grant execute on function public.dialer_sms_mark(uuid, text, text, text) to service_role;
grant execute on function public.dialer_sms_hook(jsonb) to service_role;
