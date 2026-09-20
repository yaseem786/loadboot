-- bl_dial_0351 — Dispatcher Dialer (Telnyx WebRTC softphone). STAGING first.
-- One dedicated US number per dispatcher; the dispatcher dials / answers in the portal; every call
-- (outbound, inbound, missed, voicemail) is a row LoadBoot owns. Secrets (Telnyx API key, webhook
-- public key) live ONLY in edge-function env — nothing secret is stored here.
--   client  : dialer_bootstrap · dialer_call_start · dialer_call_update · dialer_call_tag
--             dialer_history · dialer_lookup · dialer_callback_set · dialer_heartbeat
--   edge fn : dialer_hook_event · dialer_token_context · dialer_line_set_credential  (service_role) · dialer_recording_ref (user)
--   staff   : cc_dialer_overview · cc_dialer_calls · cc_dialer_line_upsert · cc_dialer_line_release · cc_dialer_config_set
-- Additive only: no existing table/function is altered.

-- ------------------------------------------------------------------ tables
create table if not exists app_private.dialer_config (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  telnyx_connection_id text,                 -- credential connection that owns the WebRTC credentials
  record_calls boolean not null default true,
  recording_notice boolean not null default true,
  ring_timeout_secs int not null default 25 check (ring_timeout_secs between 5 and 60),
  fallback_number text,                      -- e.g. Riley (Retell). null → voicemail
  voicemail_greeting text not null default 'You have reached LoadBoot dispatch. We are on another call. Please leave your name, number and the load you are calling about after the tone.',
  max_calls_per_hour int not null default 60,
  allow_international boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into app_private.dialer_config (id) values (1) on conflict do nothing;

create table if not exists app_private.dialer_lines (
  id uuid primary key default gen_random_uuid(),
  dispatcher_user_id uuid not null,
  phone_e164 text not null,
  label text,
  telnyx_number_id text,
  credential_id text,
  sip_username text,
  status text not null default 'active' check (status in ('active','released')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
create unique index if not exists dialer_lines_one_active_per_user on app_private.dialer_lines (dispatcher_user_id) where status = 'active';
create unique index if not exists dialer_lines_one_active_per_phone on app_private.dialer_lines (phone_e164) where status = 'active';

create table if not exists app_private.dialer_calls (
  id uuid primary key default gen_random_uuid(),
  dispatcher_user_id uuid not null,
  line_id uuid references app_private.dialer_lines(id),
  direction text not null check (direction in ('outbound','inbound')),
  from_number text, to_number text,
  counterparty text,                         -- the other side, E.164
  status text not null default 'dialing'
    check (status in ('dialing','ringing','active','ended','missed','failed','busy','no_answer','canceled','voicemail','forwarded')),
  started_at timestamptz not null default now(),
  answered_at timestamptz, ended_at timestamptz, duration_sec int,
  hangup_cause text, hangup_source text, sip_code int,
  telnyx_call_control_id text, telnyx_session_id text, telnyx_leg_id text,
  recording jsonb,                           -- {id, url_mp3 (short-lived), duration_ms, at}
  contact_name text, broker_contact_id uuid, booking_id uuid, load_id uuid, carrier_org_id uuid,
  source text,                               -- keypad | click | callback | history | board
  outcome text, note text, tagged_at timestamptz,
  quality jsonb, client_events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists dialer_calls_user_time on app_private.dialer_calls (dispatcher_user_id, started_at desc);
create index if not exists dialer_calls_live on app_private.dialer_calls (status) where status in ('dialing','ringing','active','voicemail');
create index if not exists dialer_calls_session on app_private.dialer_calls (telnyx_session_id);
create index if not exists dialer_calls_ccid on app_private.dialer_calls (telnyx_call_control_id);
create index if not exists dialer_calls_counterparty on app_private.dialer_calls (counterparty, started_at desc);

create table if not exists app_private.dialer_callbacks (
  id uuid primary key default gen_random_uuid(),
  dispatcher_user_id uuid not null,
  call_id uuid references app_private.dialer_calls(id) on delete set null,
  number text not null, contact_name text,
  reason text not null default 'missed' check (reason in ('missed','voicemail','scheduled','forwarded')),
  due_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','done','dismissed')),
  note text, done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists dialer_callbacks_open on app_private.dialer_callbacks (dispatcher_user_id, due_at) where status = 'open';

create table if not exists app_private.dialer_webhook_log (
  id bigserial primary key, event_id text unique, event_type text, at timestamptz not null default now(),
  verified boolean, call_id uuid, payload jsonb, result jsonb
);
create index if not exists dialer_webhook_log_at on app_private.dialer_webhook_log (at desc);

alter table app_private.dialer_config enable row level security;
alter table app_private.dialer_lines enable row level security;
alter table app_private.dialer_calls enable row level security;
alter table app_private.dialer_callbacks enable row level security;
alter table app_private.dialer_webhook_log enable row level security;

-- ------------------------------------------------------------------ helpers
create or replace function app_private.dial_e164(p text) returns text
language sql immutable as $$
  with d as (select regexp_replace(coalesce(p,''), '[^0-9]', '', 'g') as n, left(btrim(coalesce(p,'')),1) = '+' as plus)
  select case
    when length(n) = 10 then '+1' || n
    when length(n) = 11 and left(n,1) = '1' then '+' || n
    when plus and length(n) between 8 and 15 then '+' || n
    else null end from d;
$$;

-- toll-fraud guard: premium + high-cost NANP area codes are refused unless international is switched on
create or replace function app_private.dial_blocked(p_e164 text, p_allow_intl boolean) returns text
language sql immutable as $$
  select case
    when p_e164 is null then 'That is not a valid phone number.'
    when left(p_e164,2) <> '+1' and not p_allow_intl then 'International calls are switched off.'
    when left(p_e164,2) = '+1' and substr(p_e164,3,3) in ('900','976') then 'Premium-rate numbers are blocked.'
    when left(p_e164,2) = '+1' and not p_allow_intl and substr(p_e164,3,3) in
      ('242','246','264','268','284','345','441','473','649','658','664','721','758','767','784','809','829','849','868','869','876')
      then 'Caribbean area codes are blocked (high-cost).'
    when left(p_e164,2) = '+1' and substr(p_e164,3,1) in ('0','1') then 'That is not a valid US number.'
    else null end;
$$;

create or replace function app_private.dial_match(p_user uuid, p_e164 text) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare k text := right(regexp_replace(coalesce(p_e164,''),'[^0-9]','','g'), 10); r jsonb;
begin
  if length(k) < 10 then return '{}'::jsonb; end if;
  select jsonb_build_object('broker_contact_id', id, 'contact_name', broker || coalesce(' · ' || nullif(rep,''), ''), 'broker', broker, 'rep', rep, 'mc', mc, 'new_authority_ok', new_authority_ok, 'last_outcome', last_outcome)
    into r from app_private.broker_contacts
   where dispatcher_user_id = p_user and right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),10) = k
   order by updated_at desc limit 1;
  if r is not null then return r; end if;
  select jsonb_build_object('booking_id', id, 'contact_name', broker || coalesce(' · ' || nullif(broker_rep,''), ''), 'broker', broker, 'rep', broker_rep, 'mc', broker_mc, 'lane', origin || ' → ' || destination)
    into r from app_private.dispatcher_bookings
   where dispatcher_user_id = p_user and right(regexp_replace(coalesce(broker_phone,''),'[^0-9]','','g'),10) = k
   order by created_at desc limit 1;
  return coalesce(r, '{}'::jsonb);
end $$;

create or replace function app_private.dial_call_json(c app_private.dialer_calls) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', c.id, 'direction', c.direction, 'number', c.counterparty, 'status', c.status,
    'started_at', c.started_at, 'answered_at', c.answered_at, 'ended_at', c.ended_at, 'duration_sec', c.duration_sec,
    'contact_name', c.contact_name, 'broker_contact_id', c.broker_contact_id, 'booking_id', c.booking_id, 'load_id', c.load_id,
    'outcome', c.outcome, 'note', c.note, 'source', c.source, 'has_recording', c.recording is not null, 'hangup_cause', c.hangup_cause);
$$;

create or replace function app_private.dial_b64uuid(p text) returns table (call_id uuid, leg text)
language plpgsql immutable as $$
declare s text;
begin
  begin s := convert_from(decode(p, 'base64'), 'UTF8'); exception when others then return; end;
  if s ~ '^b:[0-9a-f-]{36}$' then call_id := substr(s,3)::uuid; leg := 'b'; return next;
  elsif s ~ '^[0-9a-f-]{36}$' then call_id := s::uuid; leg := 'a'; return next; end if;
end $$;

-- ------------------------------------------------------------------ dispatcher RPCs
create or replace function public.dialer_bootstrap() returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); cfg app_private.dialer_config; ln app_private.dialer_lines; v_status text; t0 timestamptz := date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York';
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  select status into v_status from app_private.dispatcher_profiles where user_id = v_uid;
  select * into ln from app_private.dialer_lines where dispatcher_user_id = v_uid and status = 'active';
  if ln.id is not null then update app_private.dialer_lines set last_seen_at = now() where id = ln.id; end if;
  return jsonb_build_object(
    'enabled', coalesce(cfg.enabled,false) and v_status in ('trial','verified','active'),
    'reason', case when not coalesce(cfg.enabled,false) then 'off' when v_status is null or v_status not in ('trial','verified','active') then 'not_active' when ln.id is null then 'no_line' else null end,
    'line', case when ln.id is null then null else jsonb_build_object('id', ln.id, 'number', ln.phone_e164, 'label', ln.label) end,
    'record_calls', cfg.record_calls,
    'calls', coalesce((select jsonb_agg(app_private.dial_call_json(c) order by c.started_at desc) from (select * from app_private.dialer_calls where dispatcher_user_id = v_uid order by started_at desc limit 40) c), '[]'::jsonb),
    'callbacks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'contact_name', contact_name, 'reason', reason, 'due_at', due_at, 'note', note, 'call_id', call_id) order by due_at) from app_private.dialer_callbacks where dispatcher_user_id = v_uid and status = 'open'), '[]'::jsonb),
    'today', (select jsonb_build_object('calls', count(*), 'connected', count(*) filter (where answered_at is not null), 'talk_sec', coalesce(sum(duration_sec),0), 'missed', count(*) filter (where status in ('missed','voicemail','forwarded')), 'untagged', count(*) filter (where answered_at is not null and tagged_at is null))
               from app_private.dialer_calls where dispatcher_user_id = v_uid and started_at >= t0));
end $$;

create or replace function public.dialer_heartbeat() returns jsonb
language sql security definer set search_path = app_private, public as $$
  with u as (update app_private.dialer_lines set last_seen_at = now() where dispatcher_user_id = auth.uid() and status = 'active' returning 1)
  select jsonb_build_object('ok', exists (select 1 from u));
$$;

create or replace function public.dialer_lookup(p_number text) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); e text := app_private.dial_e164(p_number); cfg app_private.dialer_config;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  return jsonb_build_object('e164', e, 'blocked', app_private.dial_blocked(e, cfg.allow_international), 'match', app_private.dial_match(v_uid, e),
    'last', (select app_private.dial_call_json(c) from app_private.dialer_calls c where c.dispatcher_user_id = v_uid and c.counterparty = e order by started_at desc limit 1),
    'count', (select count(*) from app_private.dialer_calls c where c.dispatcher_user_id = v_uid and c.counterparty = e));
end $$;

create or replace function public.dialer_call_start(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); cfg app_private.dialer_config; ln app_private.dialer_lines; v_status text;
  e text := app_private.dial_e164(p->>'to'); blk text; m jsonb; v_id uuid; v_n int;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  if not coalesce(cfg.enabled,false) then return jsonb_build_object('error','The dialer is switched off.'); end if;
  select status into v_status from app_private.dispatcher_profiles where user_id = v_uid;
  if v_status is null or v_status not in ('trial','verified','active') then return jsonb_build_object('error','Your dispatcher account is not active.'); end if;
  select * into ln from app_private.dialer_lines where dispatcher_user_id = v_uid and status = 'active';
  if ln.id is null then return jsonb_build_object('error','No phone line is assigned to you yet. Ask LoadBoot staff.'); end if;
  blk := app_private.dial_blocked(e, cfg.allow_international);
  if blk is not null then return jsonb_build_object('error', blk); end if;
  if e = ln.phone_e164 then return jsonb_build_object('error','That is your own line.'); end if;
  select count(*) into v_n from app_private.dialer_calls where dispatcher_user_id = v_uid and direction = 'outbound' and started_at > now() - interval '1 hour';
  if v_n >= cfg.max_calls_per_hour then return jsonb_build_object('error','Hourly call limit reached ('||cfg.max_calls_per_hour||'). Try again shortly.'); end if;
  -- a stuck "dialing" row from a closed tab must not look live forever
  update app_private.dialer_calls set status = 'failed', ended_at = now(), hangup_cause = 'abandoned_client', updated_at = now()
   where dispatcher_user_id = v_uid and status in ('dialing','ringing') and direction = 'outbound' and started_at < now() - interval '3 minutes';
  m := app_private.dial_match(v_uid, e);
  insert into app_private.dialer_calls (dispatcher_user_id, line_id, direction, from_number, to_number, counterparty, status, source,
      contact_name, broker_contact_id, booking_id, load_id, carrier_org_id)
  values (v_uid, ln.id, 'outbound', ln.phone_e164, e, e, 'dialing', coalesce(nullif(p->>'source',''),'keypad'),
      coalesce(nullif(p->>'contact_name',''), m->>'contact_name'),
      coalesce(nullif(p->>'broker_contact_id','')::uuid, (m->>'broker_contact_id')::uuid),
      coalesce(nullif(p->>'booking_id','')::uuid, (m->>'booking_id')::uuid),
      nullif(p->>'load_id','')::uuid, nullif(p->>'carrier_org_id','')::uuid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'to', e, 'from', ln.phone_e164, 'client_state', encode(convert_to(v_id::text,'UTF8'),'base64'),
    'contact_name', coalesce(nullif(p->>'contact_name',''), m->>'contact_name'), 'match', m);
end $$;

-- client-side mirror of the call state. The webhook is authoritative; this keeps the record honest
-- even if a webhook is late or lost. It never shortens a duration the webhook already wrote.
create or replace function public.dialer_call_update(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); c app_private.dialer_calls; st text := p->>'state';
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  select * into c from app_private.dialer_calls where id = p_id and dispatcher_user_id = v_uid for update;
  if not found then return jsonb_build_object('error','call not found'); end if;
  update app_private.dialer_calls set
    telnyx_call_control_id = coalesce(telnyx_call_control_id, nullif(p->>'call_control_id','')),
    telnyx_session_id = coalesce(telnyx_session_id, nullif(p->>'session_id','')),
    telnyx_leg_id = coalesce(telnyx_leg_id, nullif(p->>'leg_id','')),
    status = case
      when status in ('ended','missed','failed','busy','no_answer','canceled','voicemail','forwarded') then status
      when st = 'ringing' and status = 'dialing' then 'ringing'
      when st = 'active' then 'active'
      when st = 'hangup' then case when coalesce(answered_at, case when c.status = 'active' then c.started_at end) is not null then 'ended'
                                   when direction = 'inbound' then 'missed'
                                   when (p->>'sip_code') = '486' then 'busy' when (p->>'sip_code') in ('480','408') then 'no_answer'
                                   when (p->>'by_me')::boolean is true then 'canceled' else 'failed' end
      else status end,
    answered_at = case when st = 'active' and answered_at is null then now() else answered_at end,
    ended_at = case when st = 'hangup' and ended_at is null then now() else ended_at end,
    duration_sec = case when st = 'hangup' and duration_sec is null and answered_at is not null then greatest(0, extract(epoch from now() - answered_at)::int) else duration_sec end,
    hangup_cause = coalesce(hangup_cause, nullif(p->>'cause','')), sip_code = coalesce(sip_code, nullif(p->>'sip_code','')::int),
    quality = coalesce(p->'quality', quality),
    client_events = case when jsonb_array_length(client_events) < 40 then client_events || jsonb_build_array(jsonb_build_object('at', now(), 's', st)) else client_events end,
    updated_at = now()
  where id = p_id returning * into c;
  return jsonb_build_object('ok', true, 'call', app_private.dial_call_json(c));
end $$;

create or replace function public.dialer_call_tag(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); c app_private.dialer_calls; v_bc uuid;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  select * into c from app_private.dialer_calls where id = p_id and dispatcher_user_id = v_uid;
  if not found then return jsonb_build_object('error','call not found'); end if;
  v_bc := coalesce(nullif(p->>'broker_contact_id','')::uuid, c.broker_contact_id);
  if v_bc is not null and not exists (select 1 from app_private.broker_contacts where id = v_bc and dispatcher_user_id = v_uid) then v_bc := null; end if;
  -- "save to my broker book" straight from the call
  if v_bc is null and coalesce((p->>'save_broker')::boolean,false) and nullif(btrim(p->>'broker'),'') is not null then
    insert into app_private.broker_contacts (dispatcher_user_id, broker, rep, mc, phone, last_contact_at, last_outcome)
    values (v_uid, btrim(p->>'broker'), nullif(p->>'rep',''), nullif(p->>'mc',''), c.counterparty, now(), nullif(p->>'outcome',''))
    returning id into v_bc;
  end if;
  update app_private.dialer_calls set outcome = coalesce(nullif(p->>'outcome',''), outcome), note = coalesce(p->>'note', note),
     contact_name = coalesce(nullif(p->>'contact_name',''), nullif(btrim(coalesce(p->>'broker','') || coalesce(' · ' || nullif(p->>'rep',''), '')),''), contact_name),
     broker_contact_id = v_bc, booking_id = coalesce(nullif(p->>'booking_id','')::uuid, booking_id), tagged_at = now(), updated_at = now()
   where id = p_id returning * into c;
  if v_bc is not null then
    update app_private.broker_contacts set last_contact_at = greatest(coalesce(last_contact_at, c.started_at), c.started_at),
       last_outcome = coalesce(nullif(p->>'outcome',''), last_outcome), updated_at = now() where id = v_bc;
  end if;
  if nullif(p->>'callback_at','') is not null then
    insert into app_private.dialer_callbacks (dispatcher_user_id, call_id, number, contact_name, reason, due_at, note)
    values (v_uid, c.id, c.counterparty, c.contact_name, 'scheduled', (p->>'callback_at')::timestamptz, nullif(p->>'note',''));
  end if;
  return jsonb_build_object('ok', true, 'call', app_private.dial_call_json(c));
end $$;

create or replace function public.dialer_callback_set(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
begin
  if p_status not in ('done','dismissed','open') then return jsonb_build_object('error','bad status'); end if;
  update app_private.dialer_callbacks set status = p_status, done_at = case when p_status = 'open' then null else now() end
   where id = p_id and dispatcher_user_id = auth.uid();
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.dialer_history(p_limit int default 50, p_before timestamptz default null, p_q text default null) returns jsonb
language sql stable security definer set search_path = app_private, public as $$
  select coalesce(jsonb_agg(app_private.dial_call_json(c) order by c.started_at desc), '[]'::jsonb)
  from (select * from app_private.dialer_calls where dispatcher_user_id = auth.uid()
          and (p_before is null or started_at < p_before)
          and (nullif(btrim(p_q),'') is null or counterparty like '%' || regexp_replace(p_q,'[^0-9]','','g') || '%' and regexp_replace(p_q,'[^0-9]','','g') <> ''
               or contact_name ilike '%' || btrim(p_q) || '%' or note ilike '%' || btrim(p_q) || '%')
        order by started_at desc limit least(greatest(coalesce(p_limit,50),1),200)) c;
$$;

-- ------------------------------------------------------------------ edge-function RPCs (service_role only)
create or replace function public.dialer_token_context(p_user uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare cfg app_private.dialer_config; ln app_private.dialer_lines; v_status text; v_name text;
begin
  select * into cfg from app_private.dialer_config where id = 1;
  select status, full_name into v_status, v_name from app_private.dispatcher_profiles where user_id = p_user;
  select * into ln from app_private.dialer_lines where dispatcher_user_id = p_user and status = 'active';
  if not coalesce(cfg.enabled,false) then return jsonb_build_object('error','dialer off'); end if;
  if v_status is null or v_status not in ('trial','verified','active') then return jsonb_build_object('error','dispatcher not active'); end if;
  if ln.id is null then return jsonb_build_object('error','no line'); end if;
  if cfg.telnyx_connection_id is null then return jsonb_build_object('error','telnyx connection not configured'); end if;
  return jsonb_build_object('ok', true, 'line_id', ln.id, 'credential_id', ln.credential_id, 'connection_id', cfg.telnyx_connection_id,
    'name', 'lb-' || left(p_user::text, 8) || '-' || regexp_replace(coalesce(v_name,'dispatcher'), '[^A-Za-z0-9]+', '-', 'g'));
end $$;

create or replace function public.dialer_line_set_credential(p_line uuid, p_credential_id text, p_sip_username text) returns jsonb
language sql security definer set search_path = app_private, public as $$
  with u as (update app_private.dialer_lines set credential_id = p_credential_id, sip_username = p_sip_username, updated_at = now() where id = p_line returning 1)
  select jsonb_build_object('ok', exists (select 1 from u));
$$;

create or replace function public.dialer_recording_ref(p_call uuid) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare c app_private.dialer_calls;
begin
  if auth.uid() is null then return jsonb_build_object('error','not signed in'); end if;
  select * into c from app_private.dialer_calls where id = p_call;
  if not found then return jsonb_build_object('error','not found'); end if;
  if c.dispatcher_user_id <> auth.uid() and not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if c.recording is null then return jsonb_build_object('error','no recording'); end if;
  return jsonb_build_object('ok', true, 'recording_id', c.recording->>'id', 'session_id', c.telnyx_session_id);
end $$;

-- The Telnyx webhook brain. Input = the event's `data` object. Output tells the edge function which
-- Telnyx command (if any) to send next. Idempotent on event id.
create or replace function public.dialer_hook_event(p jsonb, p_verified boolean default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare ev text := p->>'event_type'; pl jsonb := coalesce(p->'payload','{}'::jsonb); v_evid text := p->>'id';
  cfg app_private.dialer_config; c app_private.dialer_calls; ln app_private.dialer_lines;
  v_leg text := 'a'; v_cid uuid; v_cc text := pl->>'call_control_id'; v_sess text := pl->>'call_session_id';
  v_to text := app_private.dial_e164(pl->>'to'); v_from text := app_private.dial_e164(pl->>'from');
  v_cause text := pl->>'hangup_cause'; act jsonb := null; m jsonb; v_log bigint; v_online boolean;
begin
  begin
    insert into app_private.dialer_webhook_log (event_id, event_type, verified, payload) values (v_evid, ev, p_verified, p) returning id into v_log;
  exception when unique_violation then return jsonb_build_object('ok', true, 'dup', true); end;
  select * into cfg from app_private.dialer_config where id = 1;

  select call_id, leg into v_cid, v_leg from app_private.dial_b64uuid(pl->>'client_state');
  v_leg := coalesce(v_leg, 'a');
  if v_cid is not null then select * into c from app_private.dialer_calls where id = v_cid for update; end if;
  if c.id is null and v_sess is not null then select * into c from app_private.dialer_calls where telnyx_session_id = v_sess order by started_at desc limit 1 for update; end if;
  if c.id is null and v_cc is not null then select * into c from app_private.dialer_calls where telnyx_call_control_id = v_cc order by started_at desc limit 1 for update; end if;

  -- ---------- a brand-new inbound PSTN call to one of our lines
  if c.id is null and ev = 'call.initiated' and v_to is not null then
    select * into ln from app_private.dialer_lines where phone_e164 = v_to and status = 'active';
    if ln.id is not null and coalesce(cfg.enabled,false) then
      m := app_private.dial_match(ln.dispatcher_user_id, v_from);
      insert into app_private.dialer_calls (dispatcher_user_id, line_id, direction, from_number, to_number, counterparty, status, source,
          contact_name, broker_contact_id, booking_id, telnyx_call_control_id, telnyx_session_id, telnyx_leg_id)
      values (ln.dispatcher_user_id, ln.id, 'inbound', v_from, v_to, coalesce(v_from, pl->>'from'), 'ringing', 'inbound',
          m->>'contact_name', (m->>'broker_contact_id')::uuid, (m->>'booking_id')::uuid, v_cc, v_sess, pl->>'call_leg_id')
      returning * into c;
      v_online := ln.sip_username is not null and ln.last_seen_at > now() - interval '3 minutes';
      if v_online then
        act := jsonb_build_object('type','transfer','call_control_id', v_cc, 'to', 'sip:' || ln.sip_username || '@sip.telnyx.com',
                 'from', coalesce(v_from, pl->>'from'), 'timeout_secs', cfg.ring_timeout_secs,
                 'client_state', encode(convert_to(c.id::text,'UTF8'),'base64'),
                 'target_leg_client_state', encode(convert_to('b:' || c.id::text,'UTF8'),'base64'));
      else
        act := jsonb_build_object('type','fallback');
      end if;
    end if;

  elsif c.id is not null and ev = 'call.initiated' then        -- our outbound WebRTC call reached Telnyx
    update app_private.dialer_calls set telnyx_call_control_id = coalesce(telnyx_call_control_id, v_cc), telnyx_session_id = coalesce(telnyx_session_id, v_sess),
       telnyx_leg_id = coalesce(telnyx_leg_id, pl->>'call_leg_id'), status = case when status = 'dialing' then 'ringing' else status end, updated_at = now()
     where id = c.id and v_leg = 'a';

  elsif c.id is not null and ev in ('call.answered','call.bridged') then
    if c.status = 'voicemail' and v_leg = 'a' and ev = 'call.answered' then
      act := jsonb_build_object('type','speak','call_control_id', c.telnyx_call_control_id, 'text', cfg.voicemail_greeting, 'client_state', pl->>'client_state');
    elsif c.status in ('dialing','ringing') and (c.direction = 'outbound' or v_leg = 'b') then
      update app_private.dialer_calls set status = 'active', answered_at = coalesce(answered_at, now()), updated_at = now() where id = c.id;
      if cfg.record_calls then
        act := jsonb_build_object('type','record_start','call_control_id', c.telnyx_call_control_id, 'notice', cfg.recording_notice);
      end if;
    end if;

  elsif c.id is not null and ev = 'call.speak.ended' and c.status = 'voicemail' then
    act := jsonb_build_object('type','record_voicemail','call_control_id', c.telnyx_call_control_id);

  elsif c.id is not null and ev = 'call.recording.saved' then
    update app_private.dialer_calls set recording = jsonb_build_object('id', pl->>'recording_id', 'url_mp3', coalesce(pl->'recording_urls'->>'mp3', pl->'public_recording_urls'->>'mp3'),
        'started_at', pl->>'recording_started_at', 'ended_at', pl->>'recording_ended_at', 'channels', pl->>'channels', 'at', now()), updated_at = now() where id = c.id;
    if c.status = 'voicemail' then
      update app_private.dialer_callbacks set reason = 'voicemail' where call_id = c.id and status = 'open';
      act := jsonb_build_object('type','hangup','call_control_id', c.telnyx_call_control_id);
    end if;

  elsif c.id is not null and ev = 'call.hangup' then
    if v_leg = 'b' then
      -- the dispatcher's browser leg ended. If nobody ever answered, the caller is still on leg A → fallback.
      if c.answered_at is null and c.status = 'ringing' then
        act := jsonb_build_object('type','fallback');
      end if;
    else
      update app_private.dialer_calls set ended_at = coalesce(ended_at, now()),
         duration_sec = case when answered_at is not null then greatest(coalesce(duration_sec,0), extract(epoch from now() - answered_at)::int) else duration_sec end,
         hangup_cause = coalesce(v_cause, hangup_cause), hangup_source = coalesce(pl->>'hangup_source', hangup_source),
         sip_code = coalesce(nullif(pl->>'sip_hangup_cause','')::int, sip_code),
         status = case when status in ('voicemail','forwarded','missed') then status
                       when answered_at is not null then 'ended'
                       when direction = 'inbound' then 'missed'
                       when v_cause in ('user_busy','busy') then 'busy'
                       when v_cause in ('timeout','no_answer','no_user_response') then 'no_answer'
                       when v_cause = 'originator_cancel' then 'canceled'
                       when status in ('ended','failed','busy','no_answer','canceled') then status
                       else 'failed' end,
         updated_at = now()
       where id = c.id returning * into c;
      if c.direction = 'inbound' and c.answered_at is null and not exists (select 1 from app_private.dialer_callbacks where call_id = c.id) then
        insert into app_private.dialer_callbacks (dispatcher_user_id, call_id, number, contact_name, reason)
        values (c.dispatcher_user_id, c.id, c.counterparty, c.contact_name, case c.status when 'voicemail' then 'voicemail' when 'forwarded' then 'forwarded' else 'missed' end);
      end if;
    end if;
  end if;

  -- resolve the abstract "fallback" into a concrete command
  if act->>'type' = 'fallback' and c.id is not null then
    if nullif(cfg.fallback_number,'') is not null then
      update app_private.dialer_calls set status = 'forwarded', updated_at = now() where id = c.id;
      act := jsonb_build_object('type','transfer','call_control_id', c.telnyx_call_control_id, 'to', cfg.fallback_number, 'from', c.counterparty,
               'timeout_secs', 30, 'client_state', encode(convert_to(c.id::text,'UTF8'),'base64'));
    else
      update app_private.dialer_calls set status = 'voicemail', updated_at = now() where id = c.id;
      act := jsonb_build_object('type','answer','call_control_id', c.telnyx_call_control_id, 'client_state', encode(convert_to(c.id::text,'UTF8'),'base64'));
    end if;
    if not exists (select 1 from app_private.dialer_callbacks where call_id = c.id) then
      insert into app_private.dialer_callbacks (dispatcher_user_id, call_id, number, contact_name, reason)
      values (c.dispatcher_user_id, c.id, c.counterparty, c.contact_name, case when nullif(cfg.fallback_number,'') is not null then 'forwarded' else 'missed' end);
    end if;
  end if;

  update app_private.dialer_webhook_log set call_id = c.id, result = act where id = v_log;
  return jsonb_build_object('ok', true, 'call_id', c.id, 'action', act);
end $$;

-- ------------------------------------------------------------------ staff (Command Center)
create or replace function public.cc_dialer_overview() returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare t0 timestamptz := date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York';
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  -- sweep: a call cannot stay "live" for ever if both the webhook and the client went silent
  update app_private.dialer_calls set status = case when answered_at is not null then 'ended' else 'failed' end, ended_at = now(),
     hangup_cause = coalesce(hangup_cause,'stale_sweep'), updated_at = now()
   where status in ('dialing','ringing') and started_at < now() - interval '5 minutes'
      or status = 'active' and started_at < now() - interval '4 hours';
  return jsonb_build_object(
    'config', (select to_jsonb(g) - 'id' from app_private.dialer_config g where id = 1),
    'live', coalesce((select jsonb_agg(app_private.dial_call_json(c) || jsonb_build_object('dispatcher', d.full_name, 'dispatcher_user_id', c.dispatcher_user_id, 'line', l.phone_e164) order by c.started_at)
               from app_private.dialer_calls c left join app_private.dispatcher_profiles d on d.user_id = c.dispatcher_user_id left join app_private.dialer_lines l on l.id = c.line_id
              where c.status in ('dialing','ringing','active','voicemail')), '[]'::jsonb),
    'dispatchers', coalesce((select jsonb_agg(x order by x->>'name') from (
        select jsonb_build_object('user_id', d.user_id, 'name', d.full_name, 'status', d.status, 'line_id', l.id, 'number', l.phone_e164, 'label', l.label,
          'online', l.last_seen_at > now() - interval '3 minutes', 'last_seen_at', l.last_seen_at, 'ready', l.sip_username is not null,
          'calls', s.calls, 'connected', s.connected, 'talk_sec', s.talk_sec, 'missed', s.missed, 'untagged', s.untagged,
          'open_callbacks', (select count(*) from app_private.dialer_callbacks b where b.dispatcher_user_id = d.user_id and b.status = 'open')) x
        from app_private.dispatcher_profiles d
        left join app_private.dialer_lines l on l.dispatcher_user_id = d.user_id and l.status = 'active'
        left join lateral (select count(*) calls, count(*) filter (where answered_at is not null) connected, coalesce(sum(duration_sec),0) talk_sec,
                                  count(*) filter (where status in ('missed','voicemail','forwarded')) missed,
                                  count(*) filter (where answered_at is not null and tagged_at is null) untagged
                             from app_private.dialer_calls k where k.dispatcher_user_id = d.user_id and k.started_at >= t0) s on true
        where d.status in ('trial','verified','active') or l.id is not null) q), '[]'::jsonb));
end $$;

create or replace function public.cc_dialer_calls(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_lim int := least(greatest(coalesce((p->>'limit')::int, 50), 1), 200); v_q text := nullif(btrim(p->>'q'),''); v_d text := regexp_replace(coalesce(p->>'q',''),'[^0-9]','','g');
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object('rows', coalesce((select jsonb_agg(r) from (
    select app_private.dial_call_json(c) || jsonb_build_object('dispatcher', d.full_name, 'dispatcher_user_id', c.dispatcher_user_id, 'line', l.phone_e164) r
      from app_private.dialer_calls c left join app_private.dispatcher_profiles d on d.user_id = c.dispatcher_user_id left join app_private.dialer_lines l on l.id = c.line_id
     where (nullif(p->>'dispatcher','') is null or c.dispatcher_user_id = (p->>'dispatcher')::uuid)
       and (nullif(p->>'direction','') is null or c.direction = p->>'direction')
       and (nullif(p->>'status','') is null or c.status = p->>'status' or (p->>'status' = 'connected' and c.answered_at is not null) or (p->>'status' = 'missed' and c.status in ('missed','voicemail','forwarded')))
       and (nullif(p->>'before','') is null or c.started_at < (p->>'before')::timestamptz)
       and (nullif(p->>'days','') is null or c.started_at > now() - ((p->>'days')::int || ' days')::interval)
       and (v_q is null or (v_d <> '' and c.counterparty like '%' || v_d || '%') or c.contact_name ilike '%' || v_q || '%' or c.note ilike '%' || v_q || '%')
     order by c.started_at desc limit v_lim) z), '[]'::jsonb));
end $$;

create or replace function public.cc_dialer_line_upsert(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_user uuid := nullif(p->>'dispatcher_user_id','')::uuid; e text := app_private.dial_e164(p->>'number'); v_id uuid; v_name text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if v_user is null or e is null then return jsonb_build_object('error','dispatcher and a valid number are required'); end if;
  select full_name into v_name from app_private.dispatcher_profiles where user_id = v_user;
  if v_name is null then return jsonb_build_object('error','not a dispatcher'); end if;
  if exists (select 1 from app_private.dialer_lines where phone_e164 = e and status = 'active' and dispatcher_user_id <> v_user) then
    return jsonb_build_object('error','that number is already assigned to another dispatcher'); end if;
  update app_private.dialer_lines set status = 'released', updated_at = now() where dispatcher_user_id = v_user and status = 'active' and phone_e164 <> e;
  select id into v_id from app_private.dialer_lines where dispatcher_user_id = v_user and status = 'active' and phone_e164 = e;
  if v_id is null then
    insert into app_private.dialer_lines (dispatcher_user_id, phone_e164, label, telnyx_number_id, created_by)
    values (v_user, e, nullif(p->>'label',''), nullif(p->>'telnyx_number_id',''), auth.uid()) returning id into v_id;
  else
    update app_private.dialer_lines set label = coalesce(nullif(p->>'label',''), label), telnyx_number_id = coalesce(nullif(p->>'telnyx_number_id',''), telnyx_number_id), updated_at = now() where id = v_id;
  end if;
  perform app_private.disp_audit('dialer.line_assign', 'dispatcher', v_user::text, null, v_name || ': line ' || e, jsonb_build_object('line_id', v_id, 'number', e));
  return jsonb_build_object('ok', true, 'line_id', v_id, 'number', e);
end $$;

create or replace function public.cc_dialer_line_release(p_line uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare ln app_private.dialer_lines;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  update app_private.dialer_lines set status = 'released', updated_at = now() where id = p_line and status = 'active' returning * into ln;
  if ln.id is null then return jsonb_build_object('error','line not found'); end if;
  perform app_private.disp_audit('dialer.line_release', 'dispatcher', ln.dispatcher_user_id::text, null, 'line ' || ln.phone_e164 || ' released', jsonb_build_object('line_id', ln.id));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cc_dialer_config_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_fb text := case when p ? 'fallback_number' then app_private.dial_e164(p->>'fallback_number') end;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  if p ? 'fallback_number' and nullif(btrim(p->>'fallback_number'),'') is not null and v_fb is null then return jsonb_build_object('error','fallback number is not valid'); end if;
  update app_private.dialer_config set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    telnyx_connection_id = case when p ? 'telnyx_connection_id' then nullif(btrim(p->>'telnyx_connection_id'),'') else telnyx_connection_id end,
    record_calls = coalesce((p->>'record_calls')::boolean, record_calls),
    recording_notice = coalesce((p->>'recording_notice')::boolean, recording_notice),
    ring_timeout_secs = coalesce((p->>'ring_timeout_secs')::int, ring_timeout_secs),
    fallback_number = case when p ? 'fallback_number' then v_fb else fallback_number end,
    voicemail_greeting = coalesce(nullif(btrim(p->>'voicemail_greeting'),''), voicemail_greeting),
    max_calls_per_hour = coalesce((p->>'max_calls_per_hour')::int, max_calls_per_hour),
    allow_international = coalesce((p->>'allow_international')::boolean, allow_international),
    updated_at = now(), updated_by = auth.uid() where id = 1;
  perform app_private.disp_audit('dialer.config', 'dialer', '1', null, 'dialer settings changed', p);
  return jsonb_build_object('ok', true, 'config', (select to_jsonb(g) - 'id' from app_private.dialer_config g where id = 1));
end $$;

-- ------------------------------------------------------------------ grants (anon surface unchanged)
do $$
declare f text;
begin
  foreach f in array array[
    'public.dialer_bootstrap()','public.dialer_heartbeat()','public.dialer_lookup(text)','public.dialer_call_start(jsonb)',
    'public.dialer_call_update(uuid,jsonb)','public.dialer_call_tag(uuid,jsonb)','public.dialer_callback_set(uuid,text)',
    'public.dialer_history(int,timestamptz,text)','public.dialer_recording_ref(uuid)','public.cc_dialer_overview()','public.cc_dialer_calls(jsonb)',
    'public.cc_dialer_line_upsert(jsonb)','public.cc_dialer_line_release(uuid)','public.cc_dialer_config_set(jsonb)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.dialer_hook_event(jsonb,boolean)','public.dialer_token_context(uuid)','public.dialer_line_set_credential(uuid,text,text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
