-- bl_wa_0367 — WhatsApp inbox inside the portal (DIALER-GOLIVE-HANDOFF §6 item 5). STAGING FIRST.
-- Additive: nothing in bl_dial_0351 / 0352 / 0362 changes shape. OFF until dialer_config.wa_enabled = true.
--
-- WHY IT LOOKS DIFFERENT FROM SMS (bl_dial_0352)
--   SMS: one number per dispatcher (dialer_lines) → a thread belongs to whoever owns the line.
--   WhatsApp: Meta caps numbers (2 before business verification, 20 after), so LoadBoot has ONE WABA number
--   (+1 815 365 1168) shared by every dispatcher. A conversation therefore needs an OWNER of its own:
--     * inbound from an unknown number  -> thread with owner_user_id = null (the "Unassigned" pool, visible to all dispatchers)
--     * the first dispatcher who opens / answers it claims it (wa_claim / wa_send_prepare)
--     * Command Center can reassign at any time (cc_wa_assign)
--
-- THE 24-HOUR WINDOW (Meta rule, not ours)
--   Free-form text may only be sent while the customer's last inbound message is < 24 h old. Outside that window
--   ONLY an APPROVED template may be sent. wa_send_prepare enforces this server-side; the dock shows the countdown.
--   Marketing templates to US +1 numbers are paused by Meta (since Apr 2025) -> every LoadBoot template is Utility.
--
-- HONESTY / UNKNOWNS (do not paper over these)
--   * Telnyx's INBOUND WhatsApp webhook payload shape is NOT documented (their docs show an outbound message.sent
--     sample only). wa_hook therefore reads several plausible shapes AND stores every raw event in
--     app_private.wa_webhook_log. The first real inbound message tells us the true shape; adjust then.
--   * Whether Telnyx signs WhatsApp webhooks with the same Ed25519 key is unverified. telnyx-hook keeps refusing
--     unsigned requests (401). The debug switch is the edge-function secret WA_CAPTURE=1: while it is set, an UNSIGNED
--     WhatsApp-looking body is passed to wa_hook with p_verified=false, which LOGS IT AND DOES NOTHING ELSE. Unset the
--     secret again afterwards. (dialer_config.wa_capture_until exists but is NOT read by anything yet - reserved.)
--   * Telnyx per-conversation WhatsApp price: unknown (rates CSV not read). No figure is stored anywhere.
-- Rollback: update app_private.dialer_config set wa_enabled = false;  (tables stay, inert)

alter table app_private.dialer_config
  add column if not exists wa_enabled              boolean not null default false,
  add column if not exists wa_number               text,          -- E.164 of the WABA number (+18153651168)
  add column if not exists wa_phone_number_id      text,          -- Meta phone number id (1293822517154161)
  add column if not exists wa_waba_id              text,          -- Meta WABA id (1620552536337068)
  add column if not exists wa_messaging_profile_id text,          -- Telnyx messaging profile that owns the WA number
  add column if not exists max_wa_per_hour         int not null default 120,
  add column if not exists wa_capture_until        timestamptz;   -- reserved; NOT read by any code yet (see WA_CAPTURE above)

-- ---------------------------------------------------------------- tables
create table if not exists app_private.wa_threads (
  id uuid primary key default gen_random_uuid(),
  wa_number text not null,                       -- our WABA number
  counterparty text not null,                    -- the other side, E.164
  owner_user_id uuid,                            -- null = unassigned pool
  contact_name text,
  contact_kind text,
  carrier_org_id uuid,
  status text not null default 'open' check (status in ('open','closed')),
  unread int not null default 0,
  last_at timestamptz not null default now(),
  last_body text,
  last_direction text,
  last_inbound_at timestamptz,                   -- drives the 24-hour window
  last_outbound_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wa_number, counterparty)
);
create index if not exists wa_threads_owner_ix on app_private.wa_threads (owner_user_id, last_at desc);
create index if not exists wa_threads_pool_ix  on app_private.wa_threads (last_at desc) where owner_user_id is null;

create table if not exists app_private.wa_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references app_private.wa_threads(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  sender_user_id uuid,                           -- which dispatcher / staff sent it (outbound only)
  kind text not null default 'text' check (kind in ('text','template','media','system')),
  body text not null default '',
  media jsonb,
  template_name text,
  template_vars jsonb,
  status text not null default 'queued' check (status in ('queued','sent','delivered','read','failed','received')),
  telnyx_message_id text unique,
  error text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wa_messages_thread_ix on app_private.wa_messages (thread_id, created_at desc);

-- the template registry. Meta approves templates, not us - status here mirrors what Meta shows.
create table if not exists app_private.wa_templates (
  name text primary key,
  category text not null default 'utility',
  language text not null default 'en_US',
  body text not null,
  variables int not null default 0,
  var_labels jsonb,                              -- ["Contact first name","Dispatcher name","Load id"]
  status text not null default 'pending' check (status in ('pending','approved','rejected','paused')),
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists app_private.wa_webhook_log (
  id bigserial primary key, event_id text unique, event_type text, at timestamptz not null default now(),
  verified boolean, thread_id uuid, payload jsonb, result jsonb
);
create index if not exists wa_webhook_log_at on app_private.wa_webhook_log (at desc);

alter table app_private.wa_threads     enable row level security;
alter table app_private.wa_messages    enable row level security;
alter table app_private.wa_templates   enable row level security;
alter table app_private.wa_webhook_log enable row level security;
revoke all on app_private.wa_threads, app_private.wa_messages, app_private.wa_templates, app_private.wa_webhook_log from public, anon, authenticated;

-- The three templates submitted to Meta on 20 Sep 2026 (all Utility, all IN REVIEW -> status 'pending').
-- Bodies are exactly as submitted. Flip status to 'approved' (cc_wa_template_set) only when Meta says Approved.
insert into app_private.wa_templates (name, category, language, body, variables, var_labels, status, note) values
  ('call_follow_up','utility','en_US',
   'Hi {{1}}, this is {{2}} from LoadBoot Dispatch. Update on load {{3}}: as discussed on our call today, we are waiting for your confirmation. Reply here to confirm or if you have a question.',
   3, '["Contact first name","Dispatcher name","Load id"]'::jsonb, 'pending', 'Submitted to Meta 20 Sep 2026'),
  ('load_rc_follow_up','utility','en_US',
   'Hi {{1}}, this is {{2}} from LoadBoot Dispatch. We are waiting for the rate confirmation on load {{3}}. Please send it to {{4}} or reply here.',
   4, '["Contact first name","Dispatcher name","Load id","E-mail address"]'::jsonb, 'pending', 'Submitted to Meta 20 Sep 2026'),
  ('callback_request','utility','en_US',
   'Hi {{1}}, this is {{2}} from LoadBoot Dispatch. We tried to reach you about load {{3}}. Please call or text {{4}}, or reply here with a good time.',
   4, '["Contact first name","Dispatcher name","Load id","Phone number"]'::jsonb, 'pending', 'Submitted to Meta 20 Sep 2026')
on conflict (name) do nothing;

-- ---------------------------------------------------------------- helpers
create or replace function app_private.wa_window_ends(p_last_inbound timestamptz) returns timestamptz
language sql immutable as $$ select case when p_last_inbound is null then null else p_last_inbound + interval '24 hours' end $$;

create or replace function app_private.wa_actor(p_uid uuid) returns text
language plpgsql stable security definer set search_path = app_private, public as $$
begin
  if p_uid is null then return null; end if;
  if app_private.disp_is_staff() then return 'staff'; end if;
  if exists (select 1 from app_private.dispatcher_profiles where user_id = p_uid and status in ('trial','verified','active')) then return 'dispatcher'; end if;
  return null;
end $$;

create or replace function app_private.wa_thread_json(t app_private.wa_threads) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', t.id, 'number', t.counterparty, 'contact_name', t.contact_name, 'contact_kind', t.contact_kind,
    'owner_user_id', t.owner_user_id,
    'owner', (select coalesce(nullif(d.full_name,''), u.email) from auth.users u left join app_private.dispatcher_profiles d on d.user_id = u.id where u.id = t.owner_user_id),
    'status', t.status, 'unread', t.unread, 'last_at', t.last_at, 'last_body', left(coalesce(t.last_body,''), 140),
    'last_direction', t.last_direction, 'carrier_org_id', t.carrier_org_id, 'note', t.note,
    'window_ends', app_private.wa_window_ends(t.last_inbound_at),
    'window_open', t.last_inbound_at is not null and t.last_inbound_at > now() - interval '24 hours')
$$;

create or replace function app_private.wa_msg_json(m app_private.wa_messages) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', m.id, 'direction', m.direction, 'kind', m.kind, 'body', m.body, 'media', m.media,
    'template_name', m.template_name, 'status', m.status, 'error', m.error, 'at', m.created_at,
    'sender_user_id', m.sender_user_id, 'read', m.read_at is not null)
$$;

-- fills {{1}}..{{n}} so the row we store reads like what the person actually receives
create or replace function app_private.wa_fill(p_body text, p_vars jsonb) returns text
language plpgsql immutable as $$
declare s text := coalesce(p_body,''); i int; v text;
begin
  if p_vars is null or jsonb_typeof(p_vars) <> 'array' then return s; end if;
  for i in 1 .. jsonb_array_length(p_vars) loop
    v := coalesce(p_vars->>(i-1), '');
    s := replace(s, '{{' || i || '}}', v);
  end loop;
  return s;
end $$;

-- ---------------------------------------------------------------- dispatcher RPCs
create or replace function public.wa_inbox() returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); cfg app_private.dialer_config; v_role text;
begin
  if v_uid is null then return jsonb_build_object('error','Sign in first.'); end if;
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('enabled', false, 'reason', 'not_active', 'threads', '[]'::jsonb, 'unassigned', '[]'::jsonb); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  return jsonb_build_object(
    'enabled', coalesce(cfg.enabled,false) and coalesce(cfg.wa_enabled,false),
    'reason', case when not coalesce(cfg.enabled,false) then 'off' when not coalesce(cfg.wa_enabled,false) then 'wa_off'
                   when cfg.wa_number is null then 'no_number' else null end,
    'number', cfg.wa_number, 'role', v_role,
    'unread', (select coalesce(sum(unread),0) from app_private.wa_threads where owner_user_id = v_uid),
    'threads', coalesce((select jsonb_agg(app_private.wa_thread_json(t) order by t.last_at desc)
       from app_private.wa_threads t where t.owner_user_id = v_uid and t.status = 'open'), '[]'::jsonb),
    'unassigned', coalesce((select jsonb_agg(app_private.wa_thread_json(t) order by t.last_at desc)
       from app_private.wa_threads t where t.owner_user_id is null and t.status = 'open'), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'body', body, 'variables', variables,
         'var_labels', coalesce(var_labels,'[]'::jsonb), 'language', language) order by name)
       from app_private.wa_templates where status = 'approved'), '[]'::jsonb),
    'templates_pending', (select count(*) from app_private.wa_templates where status = 'pending'));
end $$;

create or replace function public.wa_thread(p_id uuid, p_before timestamptz default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; t app_private.wa_threads;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('error','Not allowed.'); end if;
  select * into t from app_private.wa_threads where id = p_id;
  if t.id is null then return jsonb_build_object('error','That conversation does not exist.'); end if;
  if v_role <> 'staff' and t.owner_user_id is not null and t.owner_user_id <> v_uid then
    return jsonb_build_object('error','Another dispatcher owns this conversation.'); end if;
  if t.owner_user_id = v_uid then
    update app_private.wa_messages set read_at = now() where thread_id = t.id and direction = 'inbound' and read_at is null;
    update app_private.wa_threads set unread = 0, updated_at = now() where id = t.id returning * into t;
  end if;
  return jsonb_build_object('thread', app_private.wa_thread_json(t),
    'match', app_private.dial_match(coalesce(t.owner_user_id, v_uid), t.counterparty),
    'messages', coalesce((select jsonb_agg(app_private.wa_msg_json(m) order by m.created_at) from (
        select * from app_private.wa_messages where thread_id = t.id and (p_before is null or created_at < p_before)
        order by created_at desc limit 60) m), '[]'::jsonb));
end $$;

create or replace function public.wa_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; t app_private.wa_threads;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('error','Not allowed.'); end if;
  update app_private.wa_threads set owner_user_id = v_uid, updated_at = now()
    where id = p_id and owner_user_id is null returning * into t;
  if t.id is null then
    select * into t from app_private.wa_threads where id = p_id;
    if t.id is null then return jsonb_build_object('error','That conversation does not exist.'); end if;
    if t.owner_user_id = v_uid then return jsonb_build_object('ok', true, 'thread', app_private.wa_thread_json(t)); end if;
    return jsonb_build_object('error','Another dispatcher already took this conversation.');
  end if;
  return jsonb_build_object('ok', true, 'thread', app_private.wa_thread_json(t));
end $$;

-- open (or create) a conversation with a number. Creating one does NOT send anything.
create or replace function public.wa_start(p_number text, p_contact_name text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; cfg app_private.dialer_config; e text; t app_private.wa_threads; mt jsonb; blk text;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('error','Not allowed.'); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  if cfg.wa_number is null then return jsonb_build_object('error','No WhatsApp number is configured yet.'); end if;
  e := app_private.dial_e164(p_number);
  if e is null then return jsonb_build_object('error','That is not a valid phone number.'); end if;
  blk := app_private.dial_blocked(e, true);
  if blk is not null then return jsonb_build_object('error', blk); end if;
  if e = cfg.wa_number then return jsonb_build_object('error','That is LoadBoot''s own WhatsApp number.'); end if;
  select * into t from app_private.wa_threads where wa_number = cfg.wa_number and counterparty = e;
  if t.id is null then
    mt := app_private.dial_match(v_uid, e);
    insert into app_private.wa_threads (wa_number, counterparty, owner_user_id, contact_name, contact_kind, carrier_org_id, last_at)
    values (cfg.wa_number, e, case when v_role = 'staff' then null else v_uid end,
            coalesce(nullif(btrim(coalesce(p_contact_name,'')),''), nullif(mt->>'contact_name','')), nullif(mt->>'kind',''),
            nullif(mt->>'carrier_org_id','')::uuid, now())
    returning * into t;
  elsif t.owner_user_id is null and v_role <> 'staff' then
    update app_private.wa_threads set owner_user_id = v_uid, updated_at = now() where id = t.id returning * into t;
  end if;
  return jsonb_build_object('ok', true, 'thread', app_private.wa_thread_json(t));
end $$;

-- Every check runs here, AS THE CALLER, and the queued row exists before anything leaves LoadBoot.
-- p: { thread_id uuid | to text, body text, template { name text, vars [text,...] } }
create or replace function public.wa_send_prepare(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_role text; cfg app_private.dialer_config; t app_private.wa_threads;
  tpl app_private.wa_templates; v_vars jsonb; v_body text; v_open boolean; n int; m app_private.wa_messages;
  v_kind text := 'text'; v_payload jsonb; r jsonb;
begin
  v_role := app_private.wa_actor(v_uid);
  if v_role is null then return jsonb_build_object('ok', false, 'error','Not allowed.'); end if;
  select * into cfg from app_private.dialer_config where id = 1;
  if not (coalesce(cfg.enabled,false) and coalesce(cfg.wa_enabled,false)) then
    return jsonb_build_object('ok', false, 'error','WhatsApp is not switched on yet.'); end if;
  if cfg.wa_number is null then return jsonb_build_object('ok', false, 'error','No WhatsApp number is configured.'); end if;
  if coalesce(cfg.terms_required,false) and v_role <> 'staff'
     and not exists (select 1 from app_private.dialer_terms_acceptances a where a.user_id = v_uid and a.version = coalesce(cfg.terms_version,1)) then
    return jsonb_build_object('ok', false, 'error','Accept the LoadBoot Phone Terms first.'); end if;

  if nullif(p->>'thread_id','') is not null then
    select * into t from app_private.wa_threads where id = (p->>'thread_id')::uuid;
  elsif nullif(p->>'to','') is not null then
    r := public.wa_start(p->>'to', null);
    if r ? 'error' then return jsonb_build_object('ok', false, 'error', r->>'error'); end if;
    select * into t from app_private.wa_threads where id = (r->'thread'->>'id')::uuid;
  end if;
  if t.id is null then return jsonb_build_object('ok', false, 'error','That conversation does not exist.'); end if;
  if v_role <> 'staff' then
    if t.owner_user_id is null then
      update app_private.wa_threads set owner_user_id = v_uid, updated_at = now() where id = t.id and owner_user_id is null returning * into t;
    elsif t.owner_user_id <> v_uid then
      return jsonb_build_object('ok', false, 'error','Another dispatcher owns this conversation.');
    end if;
  end if;
  if t.status <> 'open' then return jsonb_build_object('ok', false, 'error','This conversation is closed.'); end if;

  select count(*) into n from app_private.wa_messages x where x.direction = 'outbound' and x.created_at > now() - interval '1 hour';
  if n >= coalesce(cfg.max_wa_per_hour, 120) then return jsonb_build_object('ok', false, 'error','Hourly WhatsApp limit reached - try again shortly.'); end if;

  v_open := t.last_inbound_at is not null and t.last_inbound_at > now() - interval '24 hours';

  if nullif(p->'template'->>'name','') is not null then
    select * into tpl from app_private.wa_templates where name = p->'template'->>'name';
    if tpl.name is null then return jsonb_build_object('ok', false, 'error','That template does not exist.'); end if;
    if tpl.status <> 'approved' then
      return jsonb_build_object('ok', false, 'error','That template is ' || tpl.status || ' at Meta - it cannot be sent yet.'); end if;
    v_vars := case when jsonb_typeof(p->'template'->'vars') = 'array' then p->'template'->'vars' else '[]'::jsonb end;
    if jsonb_array_length(v_vars) <> tpl.variables then
      return jsonb_build_object('ok', false, 'error','This template needs ' || tpl.variables || ' values.'); end if;
    if exists (select 1 from jsonb_array_elements_text(v_vars) x where btrim(coalesce(x,'')) = '') then
      return jsonb_build_object('ok', false, 'error','Fill in every value first.'); end if;
    v_kind := 'template';
    v_body := app_private.wa_fill(tpl.body, v_vars);
    v_payload := jsonb_build_object('type','template','template',
      jsonb_build_object('name', tpl.name, 'language', jsonb_build_object('policy','deterministic','code', tpl.language))
      || case when tpl.variables = 0 then '{}'::jsonb else jsonb_build_object('components', jsonb_build_array(
           jsonb_build_object('type','body','parameters',
             (select jsonb_agg(jsonb_build_object('type','text','text', x)) from jsonb_array_elements_text(v_vars) x)))) end);
  else
    v_body := btrim(coalesce(p->>'body',''));
    if v_body = '' then return jsonb_build_object('ok', false, 'error','Write a message first.'); end if;
    if length(v_body) > 3000 then return jsonb_build_object('ok', false, 'error','That message is too long (3000 characters max).'); end if;
    if not v_open then
      return jsonb_build_object('ok', false, 'error','The 24-hour window is closed - send an approved template instead.', 'needs_template', true); end if;
    v_payload := jsonb_build_object('type','text','text', jsonb_build_object('body', v_body, 'preview_url', false));
  end if;

  insert into app_private.wa_messages (thread_id, direction, sender_user_id, kind, body, template_name, template_vars, status)
  values (t.id, 'outbound', v_uid, v_kind, v_body, tpl.name, v_vars, 'queued') returning * into m;
  update app_private.wa_threads set last_at = now(), last_body = left(v_body, 300), last_direction = 'outbound',
     last_outbound_at = now(), updated_at = now() where id = t.id;

  return jsonb_build_object('ok', true, 'id', m.id, 'thread_id', t.id, 'from', cfg.wa_number, 'to', t.counterparty,
    'whatsapp_message', v_payload, 'messaging_profile_id', cfg.wa_messaging_profile_id, 'message', app_private.wa_msg_json(m));
end $$;

-- ---------------------------------------------------------------- service-role RPCs (edge functions only)
create or replace function public.wa_mark(p_id uuid, p_status text, p_telnyx_id text default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare m app_private.wa_messages;
begin
  update app_private.wa_messages set
     status = case when p_status in ('queued','sent','delivered','read','failed') then p_status else status end,
     telnyx_message_id = coalesce(p_telnyx_id, telnyx_message_id), error = left(p_error, 300), updated_at = now()
   where id = p_id returning * into m;
  return case when m.id is null then null else app_private.wa_msg_json(m) end;
end $$;

-- Every WhatsApp webhook lands here. The raw event is always logged first: Telnyx's inbound shape is undocumented,
-- so the log is how we learn it. Reading several plausible shapes is deliberate; nothing is invented.
create or replace function public.wa_hook(p jsonb, p_verified boolean default true) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare ev text := p->>'event_type'; pl jsonb := coalesce(p->'payload','{}'::jsonb); v_id text := coalesce(pl->>'id', p->>'id');
  v_from text; v_to text; v_text text; v_dir text; v_status text; cfg app_private.dialer_config;
  t app_private.wa_threads; m app_private.wa_messages; mt jsonb; v_media jsonb; res jsonb;
begin
  insert into app_private.wa_webhook_log (event_id, event_type, verified, payload)
  values (coalesce(v_id, gen_random_uuid()::text), ev, p_verified, p) on conflict (event_id) do nothing;
  if not coalesce(p_verified, false) then return jsonb_build_object('ok', true, 'logged_only', true); end if;
  select * into cfg from app_private.dialer_config where id = 1;

  v_from := app_private.dial_e164(coalesce(pl->'from'->>'phone_number', case when jsonb_typeof(pl->'from') = 'string' then pl->>'from' end));
  v_to   := app_private.dial_e164(coalesce(pl->'to'->0->>'phone_number', pl->'to'->>'phone_number',
                                           case when jsonb_typeof(pl->'to') = 'string' then pl->>'to' end));
  v_text := coalesce(
      case when jsonb_typeof(pl->'text') = 'string' then pl->>'text' when jsonb_typeof(pl->'text') = 'object' then pl->'text'->>'body' end,
      pl->'whatsapp_message'->'text'->>'body', pl->'message'->'text'->>'body', '');
  v_media := case when jsonb_typeof(pl->'media') = 'array' and jsonb_array_length(pl->'media') > 0 then pl->'media' else null end;
  v_dir := lower(coalesce(pl->>'direction',''));

  -- 1) a status update for something we sent
  if v_id is not null and exists (select 1 from app_private.wa_messages where telnyx_message_id = v_id) then
    v_status := lower(coalesce(pl->'to'->0->>'status', pl->>'status', ''));
    update app_private.wa_messages set updated_at = now(),
       status = case when v_status = 'delivered' then 'delivered' when v_status = 'read' then 'read'
                     when v_status in ('sending_failed','delivery_failed','failed') then 'failed'
                     when v_status in ('sent','queued','sending','delivery_unconfirmed') and status = 'queued' then 'sent'
                     when ev = 'message.delivered' then 'delivered' when ev = 'message.read' then 'read'
                     when ev = 'message.failed' then 'failed' when ev = 'message.sent' and status = 'queued' then 'sent'
                     else status end,
       error = case when v_status in ('sending_failed','delivery_failed','failed') or ev = 'message.failed'
                    then left(coalesce(pl->'errors'->0->>'detail', pl->'errors'->0->>'title', nullif(v_status,'')), 300) else error end
     where telnyx_message_id = v_id returning * into m;
    update app_private.wa_webhook_log set result = jsonb_build_object('status_update', true, 'message_id', m.id) where event_id = v_id;
    return jsonb_build_object('ok', true, 'status_update', true);
  end if;

  -- 2) an inbound message
  if ev = 'message.received' or v_dir = 'inbound' then
    if v_from is null then return jsonb_build_object('ok', true, 'skipped','no from'); end if;
    if cfg.wa_number is not null and v_to is not null and v_to <> cfg.wa_number then
      return jsonb_build_object('ok', true, 'skipped','not our WhatsApp number'); end if;
    select * into t from app_private.wa_threads where wa_number = coalesce(cfg.wa_number, v_to) and counterparty = v_from;
    if t.id is null then
      insert into app_private.wa_threads (wa_number, counterparty, owner_user_id, last_at, last_direction)
      values (coalesce(cfg.wa_number, v_to), v_from, null, now(), 'inbound') returning * into t;
    end if;
    if t.owner_user_id is not null and coalesce(t.contact_name,'') = '' then
      mt := app_private.dial_match(t.owner_user_id, v_from);
      if nullif(mt->>'contact_name','') is not null then
        update app_private.wa_threads set contact_name = mt->>'contact_name', contact_kind = nullif(mt->>'kind',''),
          carrier_org_id = nullif(mt->>'carrier_org_id','')::uuid where id = t.id returning * into t;
      end if;
    end if;
    insert into app_private.wa_messages (thread_id, direction, kind, body, media, status, telnyx_message_id)
    values (t.id, 'inbound', case when v_media is not null then 'media' else 'text' end, left(v_text, 4000), v_media, 'received', v_id)
    on conflict (telnyx_message_id) do nothing returning * into m;
    if m.id is null then return jsonb_build_object('ok', true, 'dup', true); end if;
    update app_private.wa_threads set unread = unread + 1, last_at = now(), last_body = left(v_text, 300),
       last_direction = 'inbound', last_inbound_at = now(), status = 'open', updated_at = now() where id = t.id returning * into t;
    res := jsonb_build_object('ok', true, 'thread_id', t.id, 'message_id', m.id, 'unassigned', t.owner_user_id is null);
    if t.owner_user_id is not null then
      res := res || jsonb_build_object('notify', jsonb_build_object('user_id', t.owner_user_id,
        'title', 'WhatsApp from ' || coalesce(nullif(t.contact_name,''), t.counterparty),
        'body', left(coalesce(nullif(v_text,''), 'Sent an attachment'), 120), 'url', '/app/agent/#today'));
    end if;
    update app_private.wa_webhook_log set result = res, thread_id = t.id where event_id = v_id;
    return res;
  end if;

  return jsonb_build_object('ok', true, 'ignored', ev);
end $$;

-- ---------------------------------------------------------------- Command Center
create or replace function public.cc_wa_overview(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare cfg app_private.dialer_config; v_q text := nullif(btrim(coalesce(p->>'q','')),'');
  v_disp uuid := nullif(p->>'dispatcher','')::uuid; v_lim int := least(coalesce((p->>'limit')::int, 100), 300);
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  select * into cfg from app_private.dialer_config where id = 1;
  return jsonb_build_object(
    'enabled', coalesce(cfg.wa_enabled,false), 'number', cfg.wa_number, 'waba_id', cfg.wa_waba_id,
    'phone_number_id', cfg.wa_phone_number_id, 'messaging_profile_id', cfg.wa_messaging_profile_id,
    'capture_until', cfg.wa_capture_until, 'max_per_hour', cfg.max_wa_per_hour,
    'counts', jsonb_build_object(
      'threads', (select count(*) from app_private.wa_threads),
      'unassigned', (select count(*) from app_private.wa_threads where owner_user_id is null and status = 'open'),
      'open_windows', (select count(*) from app_private.wa_threads where last_inbound_at > now() - interval '24 hours'),
      'unread', (select coalesce(sum(unread),0) from app_private.wa_threads),
      'msgs_24h', (select count(*) from app_private.wa_messages where created_at > now() - interval '24 hours'),
      'failed_24h', (select count(*) from app_private.wa_messages where status = 'failed' and created_at > now() - interval '24 hours')),
    'threads', coalesce((select jsonb_agg(app_private.wa_thread_json(t) order by t.last_at desc) from (
        select * from app_private.wa_threads x
         where (v_disp is null or x.owner_user_id = v_disp)
           and (v_q is null or x.counterparty ilike '%'||v_q||'%' or coalesce(x.contact_name,'') ilike '%'||v_q||'%' or coalesce(x.last_body,'') ilike '%'||v_q||'%')
         order by x.last_at desc limit v_lim) t), '[]'::jsonb),
    'dispatchers', coalesce((select jsonb_agg(jsonb_build_object('user_id', d.user_id, 'name', coalesce(nullif(d.full_name,''), u.email)) order by d.full_name)
        from app_private.dispatcher_profiles d join auth.users u on u.id = d.user_id where d.status in ('trial','verified','active')), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'category', category, 'language', language, 'body', body,
        'variables', variables, 'var_labels', coalesce(var_labels,'[]'::jsonb), 'status', status, 'note', note) order by name)
        from app_private.wa_templates), '[]'::jsonb),
    'last_events', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'event_type', l.event_type, 'verified', l.verified, 'result', l.result) order by l.at desc)
        from (select * from app_private.wa_webhook_log order by at desc limit 10) l), '[]'::jsonb));
end $$;

create or replace function public.cc_wa_assign(p_id uuid, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare t app_private.wa_threads;
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  if p_user is not null and not exists (select 1 from app_private.dispatcher_profiles where user_id = p_user and status in ('trial','verified','active')) then
    return jsonb_build_object('error','That dispatcher is not active.'); end if;
  update app_private.wa_threads set owner_user_id = p_user, updated_at = now() where id = p_id returning * into t;
  if t.id is null then return jsonb_build_object('error','That conversation does not exist.'); end if;
  perform app_private.disp_audit('wa.assign', 'wa_thread', t.id::text, null,
    case when p_user is null then 'WhatsApp conversation unassigned' else 'WhatsApp conversation assigned' end,
    jsonb_build_object('thread', t.id, 'owner', p_user, 'number', t.counterparty));
  return jsonb_build_object('ok', true, 'thread', app_private.wa_thread_json(t));
end $$;

create or replace function public.cc_wa_thread_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare t app_private.wa_threads;
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  update app_private.wa_threads set
     status = case when p->>'status' in ('open','closed') then p->>'status' else status end,
     note = case when p ? 'note' then nullif(btrim(p->>'note'),'') else note end,
     contact_name = case when p ? 'contact_name' then nullif(btrim(p->>'contact_name'),'') else contact_name end,
     updated_at = now()
   where id = (p->>'id')::uuid returning * into t;
  if t.id is null then return jsonb_build_object('error','That conversation does not exist.'); end if;
  return jsonb_build_object('ok', true, 'thread', app_private.wa_thread_json(t));
end $$;

-- staff mirror what Meta shows for a template (pending -> approved / rejected / paused), or add a newly approved one
create or replace function public.cc_wa_template_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_name text := nullif(btrim(coalesce(p->>'name','')),'');
begin
  if not app_private.disp_is_staff() then raise exception 'staff only'; end if;
  if v_name is null then return jsonb_build_object('error','A template needs its exact Meta name.'); end if;
  insert into app_private.wa_templates as w (name, category, language, body, variables, var_labels, status, note)
  values (v_name, coalesce(nullif(p->>'category',''),'utility'), coalesce(nullif(p->>'language',''),'en_US'),
          coalesce(p->>'body',''), coalesce((p->>'variables')::int, 0),
          case when jsonb_typeof(p->'var_labels') = 'array' then p->'var_labels' else null end,
          coalesce(nullif(p->>'status',''),'pending'), nullif(btrim(coalesce(p->>'note','')),''))
  on conflict (name) do update set
    category   = case when p ? 'category'   then excluded.category   else w.category end,
    language   = case when p ? 'language'   then excluded.language   else w.language end,
    body       = case when p ? 'body'       then excluded.body       else w.body end,
    variables  = case when p ? 'variables'  then excluded.variables  else w.variables end,
    var_labels = case when p ? 'var_labels' then excluded.var_labels else w.var_labels end,
    status     = case when p ? 'status'     then excluded.status     else w.status end,
    note       = case when p ? 'note'       then excluded.note       else w.note end,
    updated_at = now();
  return jsonb_build_object('ok', true, 'templates', (select jsonb_agg(jsonb_build_object('name', name, 'status', status, 'variables', variables) order by name) from app_private.wa_templates));
end $$;

-- cc_dialer_config_set learns the WhatsApp settings (patched in place, idempotent - same trick as bl_dial_0352)
do $$
declare s text;
begin
  s := pg_get_functiondef('public.cc_dialer_config_set(jsonb)'::regprocedure);
  if position('wa_enabled' in s) = 0 then
    if position('    record_calls = ' in s) = 0 then raise exception 'bl_wa_0367: expected text not found in cc_dialer_config_set'; end if;
    s := replace(s, '    record_calls = ', $n$    wa_enabled = coalesce((p->>'wa_enabled')::boolean, wa_enabled),
    wa_number = case when p ? 'wa_number' then app_private.dial_e164(p->>'wa_number') else wa_number end,
    wa_phone_number_id = case when p ? 'wa_phone_number_id' then nullif(btrim(p->>'wa_phone_number_id'),'') else wa_phone_number_id end,
    wa_waba_id = case when p ? 'wa_waba_id' then nullif(btrim(p->>'wa_waba_id'),'') else wa_waba_id end,
    wa_messaging_profile_id = case when p ? 'wa_messaging_profile_id' then nullif(btrim(p->>'wa_messaging_profile_id'),'') else wa_messaging_profile_id end,
    max_wa_per_hour = coalesce((p->>'max_wa_per_hour')::int, max_wa_per_hour),
    wa_capture_until = case when p ? 'wa_capture_minutes' then
        (case when coalesce((p->>'wa_capture_minutes')::int,0) > 0 then now() + make_interval(mins => least((p->>'wa_capture_minutes')::int, 60)) else null end)
      else wa_capture_until end,
    record_calls = $n$);
    execute s;
  end if;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.wa_inbox() from public, anon;
revoke all on function public.wa_thread(uuid, timestamptz) from public, anon;
revoke all on function public.wa_claim(uuid) from public, anon;
revoke all on function public.wa_start(text, text) from public, anon;
revoke all on function public.wa_send_prepare(jsonb) from public, anon;
revoke all on function public.cc_wa_overview(jsonb) from public, anon;
revoke all on function public.cc_wa_assign(uuid, uuid) from public, anon;
revoke all on function public.cc_wa_thread_set(jsonb) from public, anon;
revoke all on function public.cc_wa_template_set(jsonb) from public, anon;
revoke all on function public.wa_mark(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.wa_hook(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.wa_inbox() to authenticated;
grant execute on function public.wa_thread(uuid, timestamptz) to authenticated;
grant execute on function public.wa_claim(uuid) to authenticated;
grant execute on function public.wa_start(text, text) to authenticated;
grant execute on function public.wa_send_prepare(jsonb) to authenticated;
grant execute on function public.cc_wa_overview(jsonb) to authenticated;
grant execute on function public.cc_wa_assign(uuid, uuid) to authenticated;
grant execute on function public.cc_wa_thread_set(jsonb) to authenticated;
grant execute on function public.cc_wa_template_set(jsonb) to authenticated;
grant execute on function public.wa_mark(uuid, text, text, text) to service_role;
grant execute on function public.wa_hook(jsonb, boolean) to service_role;
