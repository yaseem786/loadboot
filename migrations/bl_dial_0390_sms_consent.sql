-- bl_dial_0390 — SMS CONSENT REGISTRY + a hard gate before any outbound text.
--
-- WHY: 10DLC/TCR requires proof that every number we text said yes. Before this, dialer_sms_prepare
-- only checked the STOP list — it would happily text a number lifted off a load board, which is
-- exactly what got campaign CS3VIAJ rejected. Now: no consent row, no text.
--
-- ADDITIVE ONLY. No existing function is redefined. The rule lives in a BEFORE INSERT trigger on
-- app_private.dialer_messages, so it cannot be bypassed by a code path that forgets to check —
-- including the dock, the edge function, or anything built later.
--
-- Four ways consent is created, matching what the Telnyx campaign declares:
--   verbal        — dispatcher read the script on a call and the broker said yes (logged, with the call id)
--   published_cta — the broker's own greeting/IVR/site says "text us at this number" (logged, with the quote)
--   inbound       — they texted us first (recorded automatically below)
--   web_form      — portal signup checkbox (carriers today; brokers when the partner form gets one)
--
-- STAGING FIRST (snslhvmkjusozgjelghi), then production.
-- STAGING: applied 2026-09-22.  PRODUCTION (rwscphuhpjoudvljvmdk): applied 2026-09-24 together with the
-- bl_audit_0360 anon revoke in the same migration; anon SECURITY DEFINER surface verified 33, names unchanged.

create table if not exists app_private.sms_consent (
  number               text primary key,
  kind                 text not null default 'broker' check (kind in ('broker','carrier','driver','shipper','other')),
  method               text not null check (method in ('verbal','published_cta','inbound','web_form')),
  consented_at         timestamptz not null default now(),
  recorded_by          uuid,          -- dispatcher who logged it (null for inbound / web_form)
  script_version       text,          -- which wording was read to them
  evidence             text,          -- call id, the greeting quoted, or the form URL
  company              text,
  contact_name         text,
  confirmation_sent_at timestamptz,   -- when the first (disclosure-bearing) message went out
  revoked_at           timestamptz,   -- STOP, or pulled by staff
  created_at           timestamptz not null default now()
);
alter table app_private.sms_consent enable row level security;
create index if not exists sms_consent_live_ix on app_private.sms_consent (number) where revoked_at is null;

-- The literal script, version-stamped. Kept in config so the wording can change without a deploy —
-- but if it changes here it MUST also change in the Telnyx campaign's Message Flow, word for word.
alter table app_private.dialer_config add column if not exists sms_verbal_script text;
alter table app_private.dialer_config add column if not exists sms_verbal_script_version text;
alter table app_private.dialer_config add column if not exists sms_first_msg_suffix text;

update app_private.dialer_config set
  sms_verbal_script = coalesce(sms_verbal_script,
    'Before I text you — is it OK if LoadBoot sends you text messages at this number about loads and dispatch? '
 || 'That is load details, pickup and delivery info, check calls and paperwork. Message frequency varies, '
 || 'message and data rates may apply, and you can reply STOP at any time to stop them. Do I have your permission?'),
  sms_verbal_script_version = coalesce(sms_verbal_script_version, 'v1-2026-09-21'),
  sms_first_msg_suffix = coalesce(sms_first_msg_suffix,
    ' — LoadBoot dispatch. You agreed to texts about your loads. Msg & data rates may apply. Reply STOP to opt out, HELP for help.');

-- ---------------------------------------------------------------- the gate
create or replace function app_private.sms_consent_guard() returns trigger
language plpgsql security definer set search_path = app_private, public as $$
declare c app_private.sms_consent; sfx text; kw text;
begin
  if new.direction = 'inbound' then
    -- They wrote to us first. Under TCR that is consent to reply — record it, unless it is a STOP.
    kw := upper(btrim(coalesce(new.body,'')));
    if kw in ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT') then
      update app_private.sms_consent set revoked_at = now() where number = new.counterparty;
    else
      insert into app_private.sms_consent (number, kind, method, evidence, contact_name)
      values (new.counterparty, coalesce(nullif(new.contact_kind,''), 'broker'), 'inbound',
              'inbound message ' || coalesce(new.telnyx_message_id, '(no id)'), nullif(new.contact_name,''))
      on conflict (number) do update set revoked_at = null;
    end if;
    return new;
  end if;

  select * into c from app_private.sms_consent where number = new.counterparty and revoked_at is null;
  if c.number is null then
    raise exception 'No SMS consent on file for %. Read the consent script on a call and log their yes, or wait for them to text you first. A number taken off a load board is not consent.', new.counterparty
      using errcode = 'check_violation';
  end if;

  -- First message to this number always carries the brand + STOP/HELP disclosure.
  if c.confirmation_sent_at is null then
    select sms_first_msg_suffix into sfx from app_private.dialer_config limit 1;
    if sfx is not null and position(sfx in new.body) = 0 then
      new.body := left(new.body, greatest(1, 1000 - length(sfx))) || sfx;
    end if;
    update app_private.sms_consent set confirmation_sent_at = now() where number = new.counterparty;
  end if;
  return new;
end $$;

drop trigger if exists sms_consent_guard_t on app_private.dialer_messages;
create trigger sms_consent_guard_t before insert on app_private.dialer_messages
  for each row execute function app_private.sms_consent_guard();

-- ---------------------------------------------------------------- dispatcher RPCs
-- The dock calls this BEFORE showing a composer. No consent -> it shows the script instead of a text box.
create or replace function public.dialer_sms_consent_state(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); e text; c app_private.sms_consent; cfg app_private.dialer_config;
begin
  if v_uid is null then return jsonb_build_object('error','Sign in first.'); end if;
  e := app_private.dial_e164(p->>'number');
  if e is null then return jsonb_build_object('error','That number is not valid.'); end if;
  select * into cfg from app_private.dialer_config limit 1;
  select * into c from app_private.sms_consent where number = e and revoked_at is null;
  return jsonb_build_object(
    'number', e,
    'consented', c.number is not null,
    'method', c.method, 'at', c.consented_at, 'by', c.recorded_by,
    'first_sent', c.confirmation_sent_at is not null,
    'opted_out', exists (select 1 from app_private.dialer_sms_optout where number = e),
    'script', cfg.sms_verbal_script,
    'script_version', cfg.sms_verbal_script_version);
end $$;

-- Dispatcher logs a yes. 'verbal' needs the call it happened on; 'published_cta' needs the quote.
create or replace function public.dialer_sms_consent_record(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); e text; v_method text := coalesce(p->>'method','verbal');
  v_ev text := btrim(coalesce(p->>'evidence','')); cfg app_private.dialer_config;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error','Sign in first.'); end if;
  if not exists (select 1 from app_private.dialer_lines where dispatcher_user_id = v_uid and status = 'active') then
    return jsonb_build_object('ok', false, 'error','No phone line is assigned to you yet.'); end if;
  e := app_private.dial_e164(p->>'number');
  if e is null then return jsonb_build_object('ok', false, 'error','That number is not valid.'); end if;
  if v_method not in ('verbal','published_cta') then
    return jsonb_build_object('ok', false, 'error','A dispatcher can only log verbal consent or a published call-to-action.'); end if;
  if v_ev = '' then
    return jsonb_build_object('ok', false, 'error',
      case when v_method = 'verbal' then 'Say which call this was on — consent with no evidence does not count.'
           else 'Quote what their greeting or website actually says, word for word.' end); end if;
  if exists (select 1 from app_private.dialer_sms_optout where number = e) then
    return jsonb_build_object('ok', false, 'error','This number replied STOP. It cannot be re-opted-in from here — they must text START themselves.'); end if;
  select * into cfg from app_private.dialer_config limit 1;
  insert into app_private.sms_consent (number, kind, method, recorded_by, script_version, evidence, company, contact_name)
  values (e, coalesce(nullif(p->>'kind',''),'broker'), v_method, v_uid,
          case when v_method = 'verbal' then cfg.sms_verbal_script_version else null end,
          left(v_ev, 500), nullif(p->>'company',''), nullif(p->>'contact_name',''))
  on conflict (number) do update set
    method = excluded.method, recorded_by = excluded.recorded_by, script_version = excluded.script_version,
    evidence = excluded.evidence, consented_at = now(), revoked_at = null,
    company = coalesce(excluded.company, app_private.sms_consent.company),
    contact_name = coalesce(excluded.contact_name, app_private.sms_consent.contact_name);
  return jsonb_build_object('ok', true, 'number', e, 'method', v_method);
end $$;

create or replace function public.dialer_sms_consent_revoke(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); e text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error','Sign in first.'); end if;
  e := app_private.dial_e164(p->>'number');
  if e is null then return jsonb_build_object('ok', false, 'error','That number is not valid.'); end if;
  update app_private.sms_consent set revoked_at = now() where number = e and revoked_at is null;
  return jsonb_build_object('ok', true, 'number', e);
end $$;

grant execute on function public.dialer_sms_consent_state(jsonb)  to authenticated;
grant execute on function public.dialer_sms_consent_record(jsonb) to authenticated;
grant execute on function public.dialer_sms_consent_revoke(jsonb) to authenticated;

-- ---------------------------------------------------------------- carriers: the portal checkbox
-- A carrier who ticked the optional SMS box at signup HAS consented, but that yes lives in their
-- auth metadata (app/carrier/app.js writes sms_consent / sms_consent_at / sms_consent_source).
-- This lifts it into the same registry the gate reads, so a dispatcher can text a consented carrier
-- without logging anything by hand. Idempotent; the carrier portal calls it on boot.
create or replace function public.sms_consent_self_sync() returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); md jsonb; e text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error','Sign in first.'); end if;
  select raw_user_meta_data into md from auth.users where id = v_uid;
  if coalesce(md->>'sms_consent','') not in ('true','t','1') then
    return jsonb_build_object('ok', true, 'consented', false); end if;
  e := app_private.dial_e164(coalesce(md->>'phone',''));
  if e is null then return jsonb_build_object('ok', true, 'consented', true, 'note','no usable phone number on the account'); end if;
  if exists (select 1 from app_private.dialer_sms_optout where number = e) then
    return jsonb_build_object('ok', true, 'consented', true, 'note','number is opted out'); end if;
  insert into app_private.sms_consent (number, kind, method, consented_at, evidence, contact_name)
  values (e, 'carrier', 'web_form',
          coalesce((md->>'sms_consent_at')::timestamptz, now()),
          coalesce(nullif(md->>'sms_consent_source',''), 'carrier_portal_signup_checkbox'),
          nullif(md->>'name',''))
  on conflict (number) do nothing;
  return jsonb_build_object('ok', true, 'consented', true, 'number', e);
end $$;

grant execute on function public.sms_consent_self_sync() to authenticated;

-- ---------------------------------------------------------------- carriers who signed up BEFORE the checkbox
-- They never saw an SMS box, so they have NOT consented and nothing may be backfilled on their behalf.
-- Instead the portal asks them once (app/carrier/sms-optin.js) with the same disclosure the signup form
-- carries, and this records their answer. Scoped to the caller's OWN account phone — a carrier cannot
-- opt in some other number, and a dispatcher cannot call this at all.
create or replace function public.sms_consent_set_self(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); md jsonb; e text; v_on boolean := coalesce((p->>'consent')::boolean, false);
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error','Sign in first.'); end if;
  select raw_user_meta_data into md from auth.users where id = v_uid;
  e := app_private.dial_e164(coalesce(md->>'phone',''));
  if e is null then return jsonb_build_object('ok', false, 'error','Add a mobile number to your account first.'); end if;
  if not v_on then
    update app_private.sms_consent set revoked_at = now() where number = e and revoked_at is null;
    return jsonb_build_object('ok', true, 'consent', false, 'number', e);
  end if;
  if exists (select 1 from app_private.dialer_sms_optout where number = e) then
    return jsonb_build_object('ok', false, 'error','This number replied STOP to an earlier message. Text START to +1 469-253-7575 to turn messages back on.'); end if;
  insert into app_private.sms_consent (number, kind, method, evidence, contact_name)
  values (e, 'carrier', 'web_form', 'carrier portal SMS preference, ticked by the account holder', nullif(md->>'name',''))
  on conflict (number) do update set revoked_at = null, method = 'web_form', consented_at = now(),
    evidence = 'carrier portal SMS preference, ticked by the account holder';
  return jsonb_build_object('ok', true, 'consent', true, 'number', e);
end $$;

-- What the portal needs in order to decide whether to ask: is there a number, and has it ever answered?
create or replace function public.sms_consent_self_state() returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); md jsonb; e text; c app_private.sms_consent;
begin
  if v_uid is null then return jsonb_build_object('error','Sign in first.'); end if;
  select raw_user_meta_data into md from auth.users where id = v_uid;
  e := app_private.dial_e164(coalesce(md->>'phone',''));
  if e is null then return jsonb_build_object('has_number', false, 'answered', true); end if;
  select * into c from app_private.sms_consent where number = e;
  return jsonb_build_object('has_number', true, 'number', e,
    'consented', c.number is not null and c.revoked_at is null,
    'answered', c.number is not null or exists (select 1 from app_private.dialer_sms_optout where number = e),
    'opted_out', exists (select 1 from app_private.dialer_sms_optout where number = e));
end $$;

grant execute on function public.sms_consent_set_self(jsonb) to authenticated;
grant execute on function public.sms_consent_self_state()   to authenticated;
