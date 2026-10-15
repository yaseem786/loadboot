-- ============================================================================================================
-- PROD COPY of migrations/bl_sms_0533_sms_inbox_rules.sql — for rwscphuhpjoudvljvmdk (applied by Claude 8 Oct 2026 on the owner's say-so).
-- Prod has NO WhatsApp chain yet (bl_wa_0367…0507 are staging-only), so the four routing helpers the SMS inbox shares
-- with WhatsApp are created here ONLY IF MISSING — byte-for-byte bl_wa_0367's wa_actor and bl_wa_0369's wa_route /
-- wa_can_take / wa_lock_reason. When the WhatsApp chain is applied later, its "create or replace" simply re-states them.
-- sms_enabled stays FALSE on prod: nothing sends; inbound texts to a dispatcher line get a thread + routing as before.
-- ============================================================================================================
do $shim$ begin
  if to_regprocedure('app_private.wa_actor(uuid)') is null then
    execute $f$
create function app_private.wa_actor(p_uid uuid) returns text
language plpgsql stable security definer set search_path = app_private, public as $$
begin
  if p_uid is null then return null; end if;
  if app_private.disp_is_staff() then return 'staff'; end if;
  if exists (select 1 from app_private.dispatcher_profiles where user_id = p_uid and status in ('trial','verified','active')) then return 'dispatcher'; end if;
  return null;
end $$ $f$;
    execute 'revoke all on function app_private.wa_actor(uuid) from public, anon, authenticated';
  end if;
  if to_regprocedure('app_private.wa_route(text)') is null then
    execute $f$
create function app_private.wa_route(p_e164 text) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare k text := right(regexp_replace(coalesce(p_e164,''),'[^0-9]','','g'), 10); v_carrier uuid; v_user uuid;
begin
  if length(k) < 10 then return '{}'::jsonb; end if;
  select o.id into v_carrier from public.organizations o join public.profiles p on p.id = o.owner_user_id
   where o.kind = 'carrier'
     and k in (right(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),10), right(regexp_replace(coalesce(p.whatsapp,''),'[^0-9]','','g'),10))
   limit 1;
  if v_carrier is null then
    select d.carrier_id into v_carrier from app_private.fleet_drivers d
     where coalesce(d.status,'active') <> 'inactive'
       and right(regexp_replace(coalesce(d.phone,''),'[^0-9]','','g'),10) = k limit 1;
  end if;
  if v_carrier is null then return '{}'::jsonb; end if;
  select a.dispatcher_user_id into v_user from app_private.dispatcher_assignments a
   where a.carrier_org_id = v_carrier and a.status = 'active' order by a.assigned_at desc nulls last limit 1;
  return jsonb_build_object('carrier_org_id', v_carrier, 'owner_user_id', v_user, 'why', 'carrier');
end $$ $f$;
    execute 'revoke all on function app_private.wa_route(text) from public, anon, authenticated';
  end if;
  if to_regprocedure('app_private.wa_can_take(uuid,uuid)') is null then
    execute $f$
create function app_private.wa_can_take(p_uid uuid, p_carrier uuid) returns boolean
language sql stable security definer set search_path = app_private, public as $$
  select p_carrier is not null and exists (
    select 1 from app_private.dispatcher_assignments a
     where a.carrier_org_id = p_carrier and a.dispatcher_user_id = p_uid and a.status = 'active')
$$ $f$;
    execute 'revoke all on function app_private.wa_can_take(uuid, uuid) from public, anon, authenticated';
  end if;
  if to_regprocedure('app_private.wa_lock_reason(uuid)') is null then
    execute $f$
create function app_private.wa_lock_reason(p_carrier uuid) returns text
language sql stable security definer set search_path = app_private, public as $$
  select case when p_carrier is null
    then 'On WhatsApp you handle your own carriers and their drivers. Command Center looks after everyone else.'
    else coalesce(
      (select coalesce(nullif(o.name,''), 'That carrier') || ' is assigned to ' ||
              coalesce(nullif(d.full_name,''), u.email, 'another dispatcher') || '.'
         from app_private.dispatcher_assignments a
         join auth.users u on u.id = a.dispatcher_user_id
         left join app_private.dispatcher_profiles d on d.user_id = a.dispatcher_user_id
         left join public.organizations o on o.id = a.carrier_org_id
        where a.carrier_org_id = p_carrier and a.status = 'active'
        order by a.assigned_at desc nulls last limit 1),
      (select coalesce(nullif(o.name,''), 'That carrier') || ' has no dispatcher yet - Command Center hands this one out.'
         from public.organizations o where o.id = p_carrier)) end
$$ $f$;
    execute 'revoke all on function app_private.wa_lock_reason(uuid) from public, anon, authenticated';
  end if;
end $shim$;

-- bl_sms_0533 — SMS inbox = the WhatsApp inbox's rules (owner decision, 8 Oct 2026). STAGING FIRST (snslhvmkjusozgjelghi).
--
-- Reads with docs/WHATSAPP-INBOX-0367-HANDOFF.md (the rules) and migrations/bl_dial_0390_sms_consent.sql (the consent gate).
--
-- WHAT CHANGES
--   1. A text conversation now has an OWNER, like a WhatsApp one: app_private.sms_threads, one row per contact number.
--      Inbound from a carrier's own number or one of its drivers → routed to that carrier's active dispatcher
--      (app_private.wa_route — the same lookup WhatsApp uses). Everything else (brokers, shippers, strangers) stays
--      owner-less: Command Center's queue. CC hands any conversation to anyone (cc_sms_assign); that is the only way a
--      broker ever reaches a dispatcher.
--   2. A dispatcher CANNOT start a text conversation. dialer_sms_prepare refuses a number with no thread (or a thread
--      that is not his / not one of his carriers'). Staff can open one.
--   3. Every outbound text is BRANDED server-side, in dialer_sms_prepare, never only in the browser:
--      "LoadBoot: " in front, " Reply STOP to opt out." at the end — neither added twice. The FIRST text to a number
--      keeps bl_dial_0390's long disclosure instead (dialer_config.sms_first_msg_suffix, still appended by the
--      sms_consent_guard trigger), so the short suffix is skipped on that one.
--   4. The consent gate stays a trigger (bl_dial_0390). dialer_sms_prepare also checks it first so the dispatcher gets
--      the reason as a sentence, not a 500. Brokers: blocked with "Broker texting not enabled yet" until
--      dialer_config.sms_broker_enabled is switched on (after the broker 10DLC campaign is approved).
--   5. Two Telnyx messaging profiles: carrier texts go out on telnyx_messaging_profile_id (NULL today), broker texts
--      on the new telnyx_broker_messaging_profile_id. Chosen by the thread's contact kind. sms_enabled stays FALSE.
--   6. Quoted replies (dialer_messages.reply_to), shown in LoadBoot the way WhatsApp's are (bl_wa_0532). SMS itself
--      cannot carry a quote, so the other side never sees it — it is for the person reading the thread.
--
-- ADDITIVE: new table, new nullable columns, dispatcher_user_id on dialer_messages becomes NULLABLE (a message in the
-- Command Center queue has no dispatcher). dialer_sms_threads / dialer_sms_thread / dialer_sms_prepare / dialer_sms_hook
-- are REPLACED (their live bodies are bl_dial_0352's — verified on staging 8 Oct 2026). cc_dialer_config_set is patched by
-- anchor. New public functions: dialer_sms_claim, cc_sms_threads, cc_sms_assign — authenticated only, never anon:
-- the anon-executable SECURITY DEFINER surface does not change (35 staging / 36 prod). Check the NAMES after applying.

-- ---------------------------------------------------------------- config
alter table app_private.dialer_config
  add column if not exists telnyx_broker_messaging_profile_id text,       -- the broker 10DLC campaign's profile
  add column if not exists sms_broker_enabled boolean not null default false;

-- ---------------------------------------------------------------- threads
create table if not exists app_private.sms_threads (
  id uuid primary key default gen_random_uuid(),
  counterparty text not null unique,                       -- the contact, E.164 — one conversation per number
  line_id uuid references app_private.dialer_lines(id) on delete set null,   -- the LoadBoot number they talk to
  owner_user_id uuid,                                      -- null = Command Center's queue
  contact_name text,
  contact_kind text,
  carrier_org_id uuid,
  status text not null default 'open' check (status in ('open','closed')),
  unread int not null default 0,
  last_at timestamptz not null default now(),
  last_body text,
  last_direction text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  assigned_by uuid,
  assigned_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_private.sms_threads enable row level security;
create index if not exists sms_threads_owner_ix on app_private.sms_threads (owner_user_id, last_at desc);
create index if not exists sms_threads_pool_ix  on app_private.sms_threads (last_at desc) where owner_user_id is null;

alter table app_private.dialer_messages
  add column if not exists thread_id uuid references app_private.sms_threads(id) on delete set null,
  add column if not exists reply_to uuid references app_private.dialer_messages(id) on delete set null,
  add column if not exists sender_user_id uuid;            -- who pressed Send (staff or the dispatcher)
alter table app_private.dialer_messages alter column dispatcher_user_id drop not null;
create index if not exists dialer_messages_thread2_ix on app_private.dialer_messages (thread_id, created_at desc) where thread_id is not null;
create index if not exists dialer_messages_reply_ix   on app_private.dialer_messages (reply_to) where reply_to is not null;

-- existing texts (test rows on staging) get a thread each; the dispatcher who had them keeps them
insert into app_private.sms_threads (counterparty, line_id, owner_user_id, contact_name, contact_kind, carrier_org_id, last_at, last_body, last_direction, last_inbound_at, last_outbound_at)
select distinct on (m.counterparty) m.counterparty, m.line_id, m.dispatcher_user_id, m.contact_name, m.contact_kind, m.carrier_org_id, m.created_at, left(m.body, 300), m.direction,
       (select max(x.created_at) from app_private.dialer_messages x where x.counterparty = m.counterparty and x.direction = 'inbound'),
       (select max(x.created_at) from app_private.dialer_messages x where x.counterparty = m.counterparty and x.direction = 'outbound')
  from app_private.dialer_messages m
 order by m.counterparty, m.created_at desc
on conflict (counterparty) do nothing;
update app_private.dialer_messages m set thread_id = t.id, sender_user_id = coalesce(m.sender_user_id, case when m.direction = 'outbound' then m.dispatcher_user_id end)
  from app_private.sms_threads t where t.counterparty = m.counterparty and m.thread_id is null;

-- ---------------------------------------------------------------- json
create or replace function app_private.sms_thread_json(t app_private.sms_threads) returns jsonb
language sql stable set search_path = app_private, public, pg_temp as $$
  select jsonb_build_object('id', t.id, 'number', t.counterparty, 'contact_name', t.contact_name, 'contact_kind', t.contact_kind,
    'owner_user_id', t.owner_user_id,
    'owner', (select coalesce(nullif(d.full_name,''), nullif(pr.contact_name,''), u.email) from auth.users u
               left join app_private.dispatcher_profiles d on d.user_id = u.id left join public.profiles pr on pr.id = u.id where u.id = t.owner_user_id),
    'carrier_org_id', t.carrier_org_id,
    'carrier', (select o.name from public.organizations o where o.id = t.carrier_org_id),
    'line_id', t.line_id, 'line', (select l.phone_e164 from app_private.dialer_lines l where l.id = t.line_id),
    'status', t.status, 'unread', t.unread, 'last_at', t.last_at, 'last_body', t.last_body, 'last_direction', t.last_direction,
    'last_inbound_at', t.last_inbound_at,
    'opted_out', exists (select 1 from app_private.dialer_sms_optout o where o.number = t.counterparty),
    'consented', exists (select 1 from app_private.sms_consent c where c.number = t.counterparty and c.revoked_at is null),
    'consent_method', (select c.method from app_private.sms_consent c where c.number = t.counterparty and c.revoked_at is null),
    'first_sent', exists (select 1 from app_private.sms_consent c where c.number = t.counterparty and c.confirmation_sent_at is not null),
    'broker_blocked', t.contact_kind = 'broker' and not coalesce((select sms_broker_enabled from app_private.dialer_config where id = 1), false),
    'assigned_at', t.assigned_at)
$$;
revoke all on function app_private.sms_thread_json(app_private.sms_threads) from public, anon;

create or replace function app_private.sms_msg_json(m app_private.dialer_messages) returns jsonb
language sql stable set search_path = app_private, public, pg_temp as $$
  select app_private.dial_msg_json(m) || jsonb_build_object(
    'thread_id', m.thread_id, 'reply_to', m.reply_to, 'sender_user_id', m.sender_user_id,
    'quote', case when m.reply_to is not null then
      coalesce((select jsonb_build_object('id', q.id, 'direction', q.direction, 'body', left(coalesce(nullif(q.body,''), case when q.media is not null then '[picture]' else '' end), 160))
                  from app_private.dialer_messages q where q.id = m.reply_to), jsonb_build_object('missing', true)) end)
$$;
revoke all on function app_private.sms_msg_json(app_private.dialer_messages) from public, anon;

-- the brand + opt-out wording, added once. Returns {body, first}. `first` = this number has never had a text from
-- LoadBoot: bl_dial_0390's trigger appends the long disclosure on insert, so the short suffix is left off.
create or replace function app_private.sms_compose(p_body text, p_number text) returns jsonb
language plpgsql stable set search_path = app_private, public, pg_temp as $$
declare b text := btrim(coalesce(p_body,'')); v_first boolean; sfx text;
begin
  select (c.confirmation_sent_at is null) into v_first from app_private.sms_consent c where c.number = p_number and c.revoked_at is null;
  v_first := coalesce(v_first, true);
  select sms_first_msg_suffix into sfx from app_private.dialer_config where id = 1;
  if b !~* '^\s*loadboot\M' then b := 'LoadBoot: ' || b; end if;   -- \M = end of word (Postgres ARE; \b is NOT a boundary here)
  if v_first then
    -- the trigger adds sfx; if the dispatcher already typed it, the trigger sees it and adds nothing
    null;
  elsif b !~* 'reply\s+stop' then
    b := b || ' Reply STOP to opt out.';
  end if;
  return jsonb_build_object('body', b, 'first', v_first, 'prefix', 'LoadBoot: ',
    'suffix', case when v_first then coalesce(sfx, '') else ' Reply STOP to opt out.' end);
end $$;
revoke all on function app_private.sms_compose(text, text) from public, anon;

-- the one sentence a dispatcher gets when a number is not his to text
create or replace function app_private.sms_lock_reason(p_carrier uuid) returns text
language sql stable security definer set search_path = app_private, public as $$
  select case when p_carrier is null
    then 'Texts go only to contacts Command Center has assigned to you: your carriers and their drivers. Brokers and unknown numbers are Command Center''s.'
    else coalesce(app_private.wa_lock_reason(p_carrier), 'Not allowed.') end
$$;
revoke all on function app_private.sms_lock_reason(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- dispatcher screens
create or replace function public.dialer_sms_threads() returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); cfg app_private.dialer_config; v_role text;
begin
  if v_uid is null then return jsonb_build_object('error','Sign in first.'); end if;
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('enabled', false, 'reason', 'not_active', 'threads', '[]'::jsonb, 'unassigned', '[]'::jsonb); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  return jsonb_build_object(
    'enabled', coalesce(cfg.enabled,false) and coalesce(cfg.sms_enabled,false),
    'broker_enabled', coalesce(cfg.sms_broker_enabled,false), 'role', v_role,
    'unread', (select coalesce(sum(unread),0) from app_private.sms_threads where owner_user_id = v_uid),
    'threads', coalesce((select jsonb_agg(app_private.sms_thread_json(t) order by t.last_at desc)
       from app_private.sms_threads t where t.owner_user_id = v_uid and t.status = 'open'), '[]'::jsonb),
    -- waiting = this dispatcher's own carriers that nobody owns yet (assigned after the text arrived). Never brokers.
    'unassigned', coalesce((select jsonb_agg(app_private.sms_thread_json(t) order by t.last_at desc)
       from app_private.sms_threads t
      where t.owner_user_id is null and t.status = 'open'
        and (v_role = 'staff' or app_private.wa_can_take(v_uid, t.carrier_org_id))), '[]'::jsonb));
end $$;

create or replace function public.dialer_sms_thread(p_number text, p_before timestamptz default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; e text := app_private.dial_e164(p_number); t app_private.sms_threads; mt jsonb; cfg app_private.dialer_config;
begin
  if v_uid is null then return jsonb_build_object('error','Sign in first.'); end if;
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('error','Not allowed.'); end if;
  if e is null then return jsonb_build_object('error','That is not a valid number.'); end if;
  select * into t from app_private.sms_threads where counterparty = e;
  if t.id is null then
    if v_role <> 'staff' then return jsonb_build_object('error', app_private.sms_lock_reason(null), 'no_thread', true); end if;
    return jsonb_build_object('number', e, 'no_thread', true, 'match', app_private.dial_match(v_uid, e), 'messages', '[]'::jsonb,
      'opted_out', exists (select 1 from app_private.dialer_sms_optout o where o.number = e));
  end if;
  if v_role <> 'staff' then
    if t.owner_user_id is not null and t.owner_user_id <> v_uid then
      return jsonb_build_object('error','Another dispatcher owns this conversation.'); end if;
    if t.owner_user_id is null and not app_private.wa_can_take(v_uid, t.carrier_org_id) then
      return jsonb_build_object('error', app_private.sms_lock_reason(t.carrier_org_id)); end if;
  end if;
  if t.owner_user_id = v_uid or v_role = 'staff' and t.owner_user_id is null then
    update app_private.dialer_messages set read_at = now() where thread_id = t.id and direction = 'inbound' and read_at is null;
    update app_private.sms_threads set unread = 0, updated_at = now() where id = t.id returning * into t;
  end if;
  select * into cfg from app_private.dialer_config where id = 1;
  mt := app_private.dial_match(coalesce(t.owner_user_id, v_uid), e);
  return jsonb_build_object('number', e, 'thread', app_private.sms_thread_json(t), 'match', mt,
    'opted_out', exists (select 1 from app_private.dialer_sms_optout o where o.number = e),
    'compose', app_private.sms_compose('', e) - 'body',          -- prefix / suffix / first, for the greyed preview
    'messages', coalesce((select jsonb_agg(app_private.sms_msg_json(m) order by m.created_at) from (
        select * from app_private.dialer_messages where thread_id = t.id
          and (p_before is null or created_at < p_before) order by created_at desc limit 60) m), '[]'::jsonb));
end $$;

-- a dispatcher takes one of his own carriers' waiting conversations (the WhatsApp "Take it")
create or replace function public.dialer_sms_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; t app_private.sms_threads; ln app_private.dialer_lines;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('error','Not allowed.'); end if;
  select * into t from app_private.sms_threads where id = p_id;
  if t.id is null then return jsonb_build_object('error','That conversation does not exist.'); end if;
  if t.owner_user_id = v_uid then return jsonb_build_object('ok', true, 'thread', app_private.sms_thread_json(t)); end if;
  if t.owner_user_id is not null then return jsonb_build_object('error','Another dispatcher already has this conversation.'); end if;
  if v_role <> 'staff' and not app_private.wa_can_take(v_uid, t.carrier_org_id) then
    return jsonb_build_object('error', app_private.sms_lock_reason(t.carrier_org_id)); end if;
  select * into ln from app_private.dialer_lines where dispatcher_user_id = v_uid and status = 'active';
  update app_private.sms_threads set owner_user_id = v_uid, line_id = coalesce(ln.id, line_id), assigned_at = now(), assigned_by = v_uid, updated_at = now()
    where id = p_id and owner_user_id is null returning * into t;
  if t.id is null then return jsonb_build_object('error','Another dispatcher already has this conversation.'); end if;
  update app_private.dialer_messages set dispatcher_user_id = v_uid where thread_id = t.id and dispatcher_user_id is null;
  return jsonb_build_object('ok', true, 'thread', app_private.sms_thread_json(t));
end $$;

-- checks + the queued row. Called by the telnyx-sms edge function WITH THE USER'S JWT. Body returned is FINAL (branded).
create or replace function public.dialer_sms_prepare(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; cfg app_private.dialer_config; ln app_private.dialer_lines; t app_private.sms_threads;
  e text; why text; mt jsonb; rt jsonb; v_body text := btrim(coalesce(p->>'body','')); m app_private.dialer_messages; n int;
  v_kind text; cmp jsonb; v_reply uuid; v_reply_row app_private.dialer_messages; v_from text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'Sign in first.'); end if;
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('ok', false, 'error', 'Not allowed.'); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  if not (coalesce(cfg.enabled,false) and coalesce(cfg.sms_enabled,false)) then
    return jsonb_build_object('ok', false, 'error', 'Text messaging is not switched on yet.'); end if;
  if coalesce(cfg.terms_required,false) and v_role <> 'staff'
     and not exists (select 1 from app_private.dialer_terms_acceptances a where a.user_id = v_uid and a.version = coalesce(cfg.terms_version,1)) then
    return jsonb_build_object('ok', false, 'error','Accept the LoadBoot Phone Terms first.'); end if;

  -- the conversation
  if nullif(p->>'thread_id','') is not null then
    select * into t from app_private.sms_threads where id = (p->>'thread_id')::uuid;
    if t.id is null then return jsonb_build_object('ok', false, 'error', 'That conversation does not exist.'); end if;
    e := t.counterparty;
  else
    e := app_private.dial_e164(p->>'to');
    if e is null then return jsonb_build_object('ok', false, 'error', 'That is not a valid number.'); end if;
    select * into t from app_private.sms_threads where counterparty = e;
  end if;
  if e !~ '^\+1[2-9][0-9]{9}$' then return jsonb_build_object('ok', false, 'error', 'Texts go to US or Canada mobile numbers only.'); end if;
  why := app_private.dial_blocked(e, false);
  if why is not null then return jsonb_build_object('ok', false, 'error', why); end if;
  if exists (select 1 from app_private.dialer_lines where phone_e164 = e) then return jsonb_build_object('ok', false, 'error', 'That is a LoadBoot line.'); end if;

  if t.id is null then
    -- only Command Center opens a conversation; a dispatcher is told why
    if v_role <> 'staff' then return jsonb_build_object('ok', false, 'error', app_private.sms_lock_reason(null)); end if;
    rt := app_private.wa_route(e);
    mt := app_private.dial_match(coalesce(nullif(rt->>'owner_user_id','')::uuid, v_uid), e);
    insert into app_private.sms_threads (counterparty, owner_user_id, carrier_org_id, contact_name, contact_kind, last_at)
    values (e, nullif(rt->>'owner_user_id','')::uuid, coalesce(nullif(rt->>'carrier_org_id','')::uuid, nullif(mt->>'carrier_org_id','')::uuid),
            nullif(mt->>'contact_name',''), nullif(mt->>'kind',''), now()) returning * into t;
  end if;
  if v_role <> 'staff' then
    if t.owner_user_id is null then
      if not app_private.wa_can_take(v_uid, t.carrier_org_id) then
        return jsonb_build_object('ok', false, 'error', app_private.sms_lock_reason(t.carrier_org_id)); end if;
      update app_private.sms_threads set owner_user_id = v_uid, assigned_at = now(), assigned_by = v_uid, updated_at = now()
        where id = t.id and owner_user_id is null returning * into t;
    elsif t.owner_user_id <> v_uid then
      return jsonb_build_object('ok', false, 'error', 'Another dispatcher owns this conversation.');
    end if;
  end if;
  if t.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'This conversation is closed.'); end if;

  -- which LoadBoot number it goes out on: the thread's line, else the sender's own active line
  select * into ln from app_private.dialer_lines where id = t.line_id and status = 'active';
  if ln.id is null then select * into ln from app_private.dialer_lines where dispatcher_user_id = coalesce(t.owner_user_id, v_uid) and status = 'active'; end if;
  if ln.id is null then return jsonb_build_object('ok', false, 'error', case when v_role = 'staff' then 'No LoadBoot line is attached to this conversation yet — assign it to a dispatcher with a line first.' else 'No phone line is assigned to you yet.' end); end if;
  if t.line_id is distinct from ln.id then update app_private.sms_threads set line_id = ln.id, updated_at = now() where id = t.id; end if;
  v_from := ln.phone_e164;

  -- who they are, and the two gates that are not the browser's to decide
  v_kind := coalesce(nullif(t.contact_kind,''), nullif(app_private.dial_match(coalesce(t.owner_user_id, v_uid), e)->>'kind',''));
  if v_kind = 'broker' and not coalesce(cfg.sms_broker_enabled,false) then
    return jsonb_build_object('ok', false, 'error', 'Broker texting not enabled yet', 'broker_blocked', true); end if;
  if exists (select 1 from app_private.dialer_sms_optout where number = e) then
    return jsonb_build_object('ok', false, 'error', 'This number replied STOP — it cannot be texted until it sends START.'); end if;
  if not exists (select 1 from app_private.sms_consent c where c.number = e and c.revoked_at is null) then
    return jsonb_build_object('ok', false, 'error', 'No SMS consent on file for this number. Read the consent script on a call and log their yes, or wait for them to text first. A number taken off a load board is not consent.', 'needs_consent', true); end if;

  if v_body = '' then return jsonb_build_object('ok', false, 'error', 'Write a message first.'); end if;
  cmp := app_private.sms_compose(v_body, e);
  v_body := cmp->>'body';
  if length(v_body) > 1000 then return jsonb_build_object('ok', false, 'error', 'That message is too long (1000 characters max, with the LoadBoot wording added).'); end if;
  select count(*) into n from app_private.dialer_messages where sender_user_id = v_uid and direction = 'outbound' and created_at > now() - interval '1 hour';
  if n >= coalesce(cfg.max_sms_per_hour, 60) then return jsonb_build_object('ok', false, 'error', 'Hourly text limit reached — try again shortly.'); end if;
  if exists (select 1 from app_private.dialer_messages x where x.thread_id = t.id and x.direction = 'outbound' and x.body = v_body and x.created_at > now() - interval '15 seconds') then
    return jsonb_build_object('ok', false, 'error', 'That text just went out a moment ago.'); end if;

  -- a quoted reply must be a message of THIS conversation (shown in LoadBoot only; SMS carries no quote)
  v_reply := nullif(p->>'reply_to','')::uuid;
  if v_reply is not null then
    select * into v_reply_row from app_private.dialer_messages x where x.id = v_reply and x.thread_id = t.id;
    if v_reply_row.id is null then return jsonb_build_object('ok', false, 'error', 'The message you are replying to is not in this conversation.'); end if;
  end if;

  mt := app_private.dial_match(coalesce(t.owner_user_id, v_uid), e);
  insert into app_private.dialer_messages (line_id, dispatcher_user_id, sender_user_id, direction, counterparty, body, status, contact_name, contact_kind, carrier_org_id, thread_id, reply_to)
  values (ln.id, t.owner_user_id, v_uid, 'outbound', e, v_body, 'queued',
          coalesce(t.contact_name, nullif(mt->>'contact_name','')), coalesce(v_kind, nullif(mt->>'kind','')), coalesce(t.carrier_org_id, nullif(mt->>'carrier_org_id','')::uuid),
          t.id, v_reply_row.id)
  returning * into m;                                    -- the trigger may have appended the first-message disclosure: m.body is final
  update app_private.sms_threads set last_at = now(), last_body = left(m.body, 300), last_direction = 'outbound', last_outbound_at = now(),
     contact_name = coalesce(contact_name, nullif(mt->>'contact_name','')), contact_kind = coalesce(contact_kind, v_kind), updated_at = now() where id = t.id;
  return jsonb_build_object('ok', true, 'id', m.id, 'thread_id', t.id, 'from', v_from, 'to', e, 'body', m.body,
    'messaging_profile_id', case when v_kind = 'broker' then cfg.telnyx_broker_messaging_profile_id else cfg.telnyx_messaging_profile_id end,
    'message', app_private.sms_msg_json(m));
end $$;

-- inbound: route it the moment it arrives (carrier/driver → their dispatcher), everything else waits for Command Center
create or replace function public.dialer_sms_hook(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare ev text := p->>'event_type'; pl jsonb := coalesce(p->'payload','{}'::jsonb); v_id text := pl->>'id';
  v_from text; v_to text; v_text text; ln app_private.dialer_lines; mt jsonb; rt jsonb; m app_private.dialer_messages; kw text; st text;
  t app_private.sms_threads; res jsonb;
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
    select * into t from app_private.sms_threads where counterparty = v_from;
    if t.id is null then
      insert into app_private.sms_threads (counterparty, line_id, owner_user_id, last_at, last_direction)
      values (v_from, ln.id, null, now(), 'inbound') returning * into t;
    end if;
    -- bl_sms_0533: the routing step — exactly WhatsApp's. A carrier's own number or a driver's → that carrier's
    -- active dispatcher. A broker, a shipper, a stranger → nobody; Command Center answers or assigns.
    if t.owner_user_id is null or t.carrier_org_id is null then
      rt := app_private.wa_route(v_from);
      if rt <> '{}'::jsonb then
        update app_private.sms_threads set
           carrier_org_id = coalesce(carrier_org_id, nullif(rt->>'carrier_org_id','')::uuid),
           owner_user_id  = coalesce(owner_user_id,  nullif(rt->>'owner_user_id','')::uuid),
           updated_at = now() where id = t.id returning * into t;
      end if;
    end if;
    if t.line_id is null then update app_private.sms_threads set line_id = ln.id where id = t.id returning * into t; end if;
    mt := app_private.dial_match(coalesce(t.owner_user_id, ln.dispatcher_user_id), v_from);
    if coalesce(t.contact_name,'') = '' and nullif(mt->>'contact_name','') is not null then
      update app_private.sms_threads set contact_name = mt->>'contact_name', contact_kind = coalesce(contact_kind, nullif(mt->>'kind','')),
        carrier_org_id = coalesce(carrier_org_id, nullif(mt->>'carrier_org_id','')::uuid) where id = t.id returning * into t;
    end if;
    insert into app_private.dialer_messages (line_id, dispatcher_user_id, direction, counterparty, body, media, status, telnyx_message_id, contact_name, contact_kind, carrier_org_id, thread_id)
    values (ln.id, t.owner_user_id, 'inbound', v_from, left(v_text, 4000),
            case when jsonb_typeof(pl->'media') = 'array' and jsonb_array_length(pl->'media') > 0 then pl->'media' else null end,
            'received', v_id, coalesce(t.contact_name, nullif(mt->>'contact_name','')), coalesce(t.contact_kind, nullif(mt->>'kind','')), coalesce(t.carrier_org_id, nullif(mt->>'carrier_org_id','')::uuid), t.id)
    returning * into m;
    update app_private.sms_threads set unread = unread + 1, last_at = now(), last_body = left(coalesce(nullif(v_text,''), '[picture]'), 300),
       last_direction = 'inbound', last_inbound_at = now(), status = 'open', updated_at = now() where id = t.id returning * into t;
    res := jsonb_build_object('ok', true, 'message_id', m.id, 'thread_id', t.id, 'unassigned', t.owner_user_id is null, 'routed', coalesce(rt->>'why', 'pool'));
    if t.owner_user_id is not null then
      res := res || jsonb_build_object('notify', jsonb_build_object('user_id', t.owner_user_id,
        'title', 'Text from ' || coalesce(nullif(t.contact_name,''), v_from), 'body', left(v_text, 120), 'url', '/app/agent/#today'));
    end if;
    return res;
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

-- ---------------------------------------------------------------- Command Center: the queue, and the one override
create or replace function public.cc_sms_threads(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_q text := nullif(btrim(coalesce(p->>'q','')),''); v_disp uuid := nullif(p->>'dispatcher','')::uuid; v_lim int := least(coalesce((p->>'limit')::int, 200), 500);
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  return jsonb_build_object(
    'unassigned', (select count(*) from app_private.sms_threads where owner_user_id is null and status = 'open'),
    'threads', coalesce((select jsonb_agg(app_private.sms_thread_json(t) order by (t.owner_user_id is null) desc, t.last_at desc) from (
        select * from app_private.sms_threads x
         where x.status = 'open'
           and (v_disp is null or x.owner_user_id = v_disp)
           and (v_q is null or x.counterparty ilike '%' || v_q || '%' or x.contact_name ilike '%' || v_q || '%' or x.last_body ilike '%' || v_q || '%')
         order by (x.owner_user_id is null) desc, x.last_at desc limit v_lim) t), '[]'::jsonb));
end $$;

create or replace function public.cc_sms_assign(p_id uuid, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare t app_private.sms_threads; ln app_private.dialer_lines; v_role text;
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  select * into t from app_private.sms_threads where id = p_id;
  if t.id is null then return jsonb_build_object('error','That conversation does not exist.'); end if;
  if p_user is not null then
    v_role := app_private.wa_actor(p_user);
    if v_role is null then return jsonb_build_object('error','That person is not an active dispatcher or staff member.'); end if;
    select * into ln from app_private.dialer_lines where dispatcher_user_id = p_user and status = 'active';
  end if;
  update app_private.sms_threads set owner_user_id = p_user, line_id = coalesce(ln.id, line_id), assigned_by = auth.uid(), assigned_at = now(), updated_at = now()
    where id = p_id returning * into t;
  update app_private.dialer_messages set dispatcher_user_id = p_user where thread_id = t.id and (dispatcher_user_id is null or p_user is not null);
  return jsonb_build_object('ok', true, 'thread', app_private.sms_thread_json(t));
end $$;

-- cc_dialer_config_set accepts the broker profile + switch (patched in place, idempotent)
do $$
declare s text;
begin
  s := pg_get_functiondef('public.cc_dialer_config_set(jsonb)'::regprocedure);
  if position('sms_broker_enabled' in s) = 0 then
    if position('    record_calls = ' in s) = 0 then raise exception 'bl_sms_0533: expected text not found in cc_dialer_config_set'; end if;
    s := replace(s, '    record_calls = ', $n$    sms_broker_enabled = coalesce((p->>'sms_broker_enabled')::boolean, sms_broker_enabled),
    telnyx_broker_messaging_profile_id = case when p ? 'telnyx_broker_messaging_profile_id' then nullif(btrim(p->>'telnyx_broker_messaging_profile_id'),'') else telnyx_broker_messaging_profile_id end,
    record_calls = $n$);
    execute s;
  end if;
end $$;

-- ---------------------------------------------------------------- grants: authenticated only, never anon
revoke all on function public.dialer_sms_threads() from public, anon;
revoke all on function public.dialer_sms_thread(text, timestamptz) from public, anon;
revoke all on function public.dialer_sms_prepare(jsonb) from public, anon;
revoke all on function public.dialer_sms_claim(uuid) from public, anon;
revoke all on function public.cc_sms_threads(jsonb) from public, anon;
revoke all on function public.cc_sms_assign(uuid, uuid) from public, anon;
revoke all on function public.dialer_sms_hook(jsonb) from public, anon, authenticated;
grant execute on function public.dialer_sms_threads() to authenticated;
grant execute on function public.dialer_sms_thread(text, timestamptz) to authenticated;
grant execute on function public.dialer_sms_prepare(jsonb) to authenticated;
grant execute on function public.dialer_sms_claim(uuid) to authenticated;
grant execute on function public.cc_sms_threads(jsonb) to authenticated;
grant execute on function public.cc_sms_assign(uuid, uuid) to authenticated;
grant execute on function public.dialer_sms_hook(jsonb) to service_role;

-- CHECK after applying (names, not just the count — docs/audit-2026-09/anon-secdef-baseline.md): 35 staging / 36 prod.
