-- bl_train_0548 — Carrier training sandbox (first user: Andrew Higgins).
--
-- WHAT: a reusable "training world" — a fully onboarded demo carrier, a demo broker and demo
-- loads in every state a carrier can see — that a new dispatcher logs into to learn the carrier
-- portal, and that his own dispatcher account can work from the dispatcher workspace.
--   app_private.training_seed(email, label [, dispatcher])  → jsonb (ids + one-time password)
--   app_private.training_reset(org)                          → wipe + re-seed the loads/trips/offers
--   public.cc_training_worlds / cc_training_seed / cc_training_reset / cc_training_set_dispatcher
--     (staff-only Command Center wrappers)
--   public.cc_session_demo_state(p_org)  → {is_demo, training, label, demo_orgs[]} for the UI banner
--
-- ZERO SIDE EFFECTS. Everything a training world does stays inside the database:
--   * app_private.training_worlds is the registry. Every guard below keys on it — NOT on
--     organizations.is_demo — because hello@loadboot.com is the only member of the demo org
--     "LOADBOOT TEST CARRIER (internal)" and receives ~200 real emails a month. A blanket
--     "no mail to demo-org users" rule would have cut the owner's own inbox off.
--   * Outbound queues (message_deliveries = email/SMS, push_outbox, wa_auto_outbox,
--     webhook_deliveries, lb_stripe_queue where it exists) get a BEFORE INSERT guard that MARKS
--     the row as never-to-send (status suppressed / skipped, sent_at set) instead of dropping it,
--     because several writers use `insert … returning id`. Every block is written to
--     app_private.training_blocked_log.
--   * Interactive sends to a training carrier (dispatcher SMS, WhatsApp, outbound call log,
--     Riley call plans) raise a clear "TRAINING ACCOUNT" error instead.
--   * FMCSA: fmcsa_authority_request / fmcsa_snapshot_queue skip demo orgs (the training MC/DOT
--     are fake — a lookup would come back "not found" and could flip the carrier to inactive).
--
-- NEVER VISIBLE TO REAL USERS:
--   * session_is_demo() now also honours app.dispatch_as (set by disp_act_as). Before this, a real
--     dispatcher acting for a demo carrier saw REAL loads and could request one for a fake carrier.
--   * training_load_ok(): a training carrier sees only its own world's broker loads; nobody else
--     (real carriers, the Play-review demo accounts, other training worlds) sees them.
--   * KPI / investor / dispatcher-scorecard functions read through app_live.* views (same table
--     names, non-demo rows only). inv_growth_metrics already excluded demo ORGS but counted demo
--     loads, trips and fee invoices — a training world would have inflated investor numbers.
--
-- PART C (trainee dispatcher works his training carrier):
--   * cc_dispatcher_assign: capacity counts (trial_max_carriers, waivers, max_carriers, max_trucks,
--     proof_loads) count only non-demo carriers, and assigning a demo carrier never uses a slot.
--   * disp_trial_stats / disp_trial_daily_build (the daily performance email), disp_kpis
--     (scorecards), cc_dispatchers_stats, dispatcher_capacity, disp_choice_eligibility read app_live.*.
--   * dispatcher_commission rows are never created for demo carriers.
--
-- SANDBOX-ONLY EXCEPTIONS (both keyed on the training registry, so no real carrier changes):
--   * carrier_capacity() +5 for training carriers, so one van can hold the upcoming, ready and
--     in-transit trips at the same time and still book a board load and accept an offer.
--     match_eligibility now calls carrier_capacity() (identical result for every other carrier).
--   * Training invoices are due 30 days after issue — loadboot.com/pricing says Net-30. NOTE FOR
--     THE OWNER: prod auto_invoice_on_delivery still issues real fee invoices on Net-15
--     (current_date + 15, email "net 15"); staging is already Net-30. Not changed here.
--
-- Patches read each function's CURRENT definition and replace one anchor (a missing anchor aborts).
-- Helpers are pg_temp functions, so nothing needs to be dropped afterwards.
-- Anon SECURITY DEFINER surface: unchanged (every new public function revokes public + anon).

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- §1  Registry
-- ═══════════════════════════════════════════════════════════════════════════════════════════
create table if not exists app_private.training_worlds (
  id               uuid primary key default gen_random_uuid(),
  label            text not null,
  carrier_org      uuid not null unique references public.organizations(id) on delete cascade,
  broker_org       uuid not null references public.organizations(id) on delete cascade,
  carrier_user     uuid not null,
  broker_user      uuid not null,
  carrier_email    text not null,
  phone            text not null,
  dispatcher_user  uuid,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  reset_at         timestamptz,
  reset_by         uuid,
  last_seed        jsonb not null default '{}'::jsonb
);
comment on table app_private.training_worlds is
  'bl_train_0548: carrier training sandboxes. Every outbound guard keys on this registry.';
alter table app_private.training_worlds enable row level security;
revoke all on app_private.training_worlds from public, anon, authenticated;

create table if not exists app_private.training_blocked_log (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  channel       text,
  target        text,
  template_key  text,
  reason        text,
  ref           jsonb
);
comment on table app_private.training_blocked_log is
  'bl_train_0548: every email / push / WhatsApp / webhook / Stripe job a training world tried to send, and why it was held.';
alter table app_private.training_blocked_log enable row level security;
revoke all on app_private.training_blocked_log from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- §2  Predicates
-- ═══════════════════════════════════════════════════════════════════════════════════════════
create or replace function app_private.is_demo_org(p_org uuid)
returns boolean language sql stable security definer set search_path to 'app_private, public' as $fn$
  select coalesce((select o.is_demo from public.organizations o where o.id = p_org), false);
$fn$;

create or replace function app_private.is_demo_only_user(p_user uuid)
returns boolean language sql stable security definer set search_path to 'app_private, public' as $fn$
  select exists (select 1 from public.organization_memberships om join public.organizations o on o.id = om.org_id
                  where om.user_id = p_user and o.is_demo)
     and not exists (select 1 from public.organization_memberships om join public.organizations o on o.id = om.org_id
                      where om.user_id = p_user and not o.is_demo);
$fn$;

create or replace function app_private.training_org_ids()
returns uuid[] language sql stable security definer set search_path to 'app_private, public' as $fn$
  select coalesce(array_agg(x), '{}'::uuid[]) from (
    select carrier_org x from app_private.training_worlds union select broker_org from app_private.training_worlds) s;
$fn$;

create or replace function app_private.training_user_ids()
returns uuid[] language sql stable security definer set search_path to 'app_private, public' as $fn$
  select coalesce(array_agg(x), '{}'::uuid[]) from (
    select carrier_user x from app_private.training_worlds union select broker_user from app_private.training_worlds) s;
$fn$;

create or replace function app_private.is_training_org(p_org uuid)
returns boolean language sql stable security definer set search_path to 'app_private, public' as $fn$
  select p_org is not null and exists (select 1 from app_private.training_worlds w where p_org in (w.carrier_org, w.broker_org));
$fn$;

create or replace function app_private.training_world_of_org(p_org uuid)
returns uuid language sql stable security definer set search_path to 'app_private, public' as $fn$
  select w.id from app_private.training_worlds w where p_org is not null and p_org in (w.carrier_org, w.broker_org) limit 1;
$fn$;

-- The training world the current session is acting in: a dispatcher working a training carrier
-- (app.dispatch_as, set by disp_act_as), or a member of a training org.
create or replace function app_private.training_world_of_session()
returns uuid language sql stable security definer set search_path to 'app_private, public' as $fn$
  select coalesce(
    (select w.id from app_private.training_worlds w
       join app_private.dispatcher_assignments a on a.carrier_org_id = w.carrier_org
      where w.carrier_org::text = nullif(current_setting('app.dispatch_as', true), '')
        and a.dispatcher_user_id = auth.uid() and a.status = 'active' limit 1),
    (select w.id from app_private.training_worlds w
       join public.organization_memberships om on om.org_id in (w.carrier_org, w.broker_org)
      where om.user_id = auth.uid() and om.status = 'active' limit 1));
$fn$;

-- Board rule on top of the symmetric demo rule: a training world sees only its own broker's
-- loads, and a training load is seen only from inside its world. With no worlds this is `true`.
create or replace function app_private.training_load_ok(p_broker uuid, p_shipper uuid)
returns boolean language sql stable security definer set search_path to 'app_private, public' as $fn$
  select case when not exists (select 1 from app_private.training_worlds) then true
              else app_private.training_world_of_session()
                   is not distinct from coalesce(app_private.training_world_of_org(p_broker), app_private.training_world_of_org(p_shipper))
         end;
$fn$;

create or replace function app_private.training_org_ok(p_org uuid)
returns boolean language sql stable security definer set search_path to 'app_private, public' as $fn$
  select case when not exists (select 1 from app_private.training_worlds) then true
              else app_private.training_world_of_session() is not distinct from app_private.training_world_of_org(p_org) end;
$fn$;

-- Any uuid that belongs to a training world (org, user, load, trip, offer, booking, assignment,
-- invoice, book request, accessorial, document).
create or replace function app_private.is_training_ref(p uuid)
returns boolean language sql stable security definer set search_path to 'app_private, public' as $fn$
  select p is not null and exists (
    select 1 from (select app_private.training_org_ids() ids, app_private.training_user_ids() us) o
     where p = any(o.ids) or p = any(o.us)
        or exists (select 1 from app_private.training_worlds w where w.id = p)
        or exists (select 1 from public.loads l where l.id = p and (l.broker_org = any(o.ids) or l.shipper_org = any(o.ids)))
        or exists (select 1 from app_private.trips t where t.id = p and t.carrier_id = any(o.ids))
        or exists (select 1 from app_private.load_offers x where x.id = p and x.carrier_id = any(o.ids))
        or exists (select 1 from app_private.dispatcher_bookings x where x.id = p and x.carrier_org_id = any(o.ids))
        or exists (select 1 from app_private.dispatcher_assignments x where x.id = p and x.carrier_org_id = any(o.ids))
        or exists (select 1 from app_private.fin_invoices x where x.id = p and x.carrier_id = any(o.ids))
        or exists (select 1 from app_private.load_book_requests x where x.id = p and x.carrier_org = any(o.ids))
        or exists (select 1 from app_private.trip_accessorials x join app_private.trips t on t.id = x.trip_id
                    where x.id = p and t.carrier_id = any(o.ids))
        or exists (select 1 from public.documents d where d.id = p and d.carrier_id = any(o.us)));
$fn$;

create or replace function app_private.uuids_in(p text)
returns uuid[] language sql immutable as $fn$
  select coalesce(array_agg(distinct m[1]::uuid), '{}'::uuid[])
    from regexp_matches(coalesce(p, ''), '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', 'g') m;
$fn$;

-- A real customer: active member of a non-demo carrier/broker/shipper/facility, not staff.
create or replace function app_private.is_live_customer(p_user uuid, p_email text)
returns boolean language sql stable security definer set search_path to 'app_private, public' as $fn$
  with u as (select coalesce(p_user, (select id from auth.users where lower(email) = lower(btrim(coalesce(p_email,''))) limit 1)) id)
  select exists (select 1 from public.organization_memberships om join public.organizations o on o.id = om.org_id
                  where om.user_id = (select id from u) and om.status = 'active' and not o.is_demo
                    and o.kind in ('carrier','broker','shipper','facility'))
     and not exists (select 1 from app_private.staff_members s where s.user_id = (select id from u) and s.status = 'active');
$fn$;

-- Why an outbound message must be held (null = send normally).
create or replace function app_private.training_outbound_reason(p_user uuid, p_email text, p_ids uuid[], p_text text)
returns text language plpgsql stable security definer set search_path to 'app_private, public' as $fn$
declare v_orgs uuid[]; v_users uuid[]; v_as text := nullif(current_setting('app.dispatch_as', true), '');
begin
  -- seed/reset first: the very first seed runs before its registry row exists
  if current_setting('lb.training_ctx', true) = 'on' then return 'training seed/reset'; end if;
  if not exists (select 1 from app_private.training_worlds) then return null; end if;
  v_orgs := app_private.training_org_ids(); v_users := app_private.training_user_ids();
  if auth.uid() is not null and auth.uid() = any(v_users) then return 'sent while a training account was acting'; end if;
  if v_as ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and v_as::uuid = any(v_orgs) then
    return 'dispatcher working a training carrier';
  end if;
  if p_user is not null and p_user = any(v_users) then return 'recipient is a training account'; end if;
  if coalesce(btrim(p_email), '') <> '' and exists (select 1 from auth.users u where u.id = any(v_users) and lower(u.email) = lower(btrim(p_email))) then
    return 'recipient is a training account';
  end if;
  if exists (select 1 from unnest(coalesce(p_ids, '{}'::uuid[])) x where app_private.is_training_ref(x)) then return 'about a training record'; end if;
  if coalesce(p_text, '') ilike '%TRAINING CARRIER%' or coalesce(p_text, '') ilike '%DEMO BROKER — Training%' then return 'names a training org'; end if;
  if current_setting('lb.training_touch', true) = 'on' and not app_private.is_live_customer(p_user, p_email) then
    return 'same request changed a training record';
  end if;
  return null;
end $fn$;

create or replace function app_private.training_note_block(p_channel text, p_target text, p_template text, p_reason text, p_ref jsonb)
returns void language sql security definer set search_path to 'app_private, public' as $fn$
  insert into app_private.training_blocked_log(channel, target, template_key, reason, ref)
  values (p_channel, p_target, p_template, p_reason, coalesce(p_ref, '{}'::jsonb));
$fn$;

do $rv$ declare f text; begin
  foreach f in array array['app_private.is_demo_org(uuid)','app_private.is_demo_only_user(uuid)','app_private.training_org_ids()',
    'app_private.training_user_ids()','app_private.is_training_org(uuid)','app_private.training_world_of_org(uuid)',
    'app_private.training_world_of_session()','app_private.training_load_ok(uuid,uuid)','app_private.training_org_ok(uuid)',
    'app_private.is_training_ref(uuid)','app_private.uuids_in(text)','app_private.is_live_customer(uuid,text)',
    'app_private.training_outbound_reason(uuid,text,uuid[],text)','app_private.training_note_block(text,text,text,text,jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $rv$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- §3  session_is_demo honours the carrier a dispatcher is acting for
-- ═══════════════════════════════════════════════════════════════════════════════════════════
create or replace function app_private.session_is_demo()
returns boolean language sql stable security definer set search_path to 'app_private, public' as $fn$
  select coalesce(
    -- bl_train_0548: a dispatcher acting for a carrier (disp_act_as → app.dispatch_as) is on THAT carrier's side
    (select o.is_demo from public.organizations o
       join app_private.dispatcher_assignments a on a.carrier_org_id = o.id
      where o.id::text = nullif(current_setting('app.dispatch_as', true), '')
        and a.dispatcher_user_id = auth.uid() and a.status = 'active' limit 1),
    exists (select 1 from public.organization_memberships om join public.organizations o on o.id = om.org_id
             where om.user_id = auth.uid() and o.is_demo));
$fn$;
revoke all on function app_private.session_is_demo() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- §4  app_live — the same tables, demo rows removed (read-only reporting goes through these)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- NOTE: a view's `select *` is expanded when it is created. A column added to one of these tables
-- later must be added here too (re-run the matching `create or replace view`) before a swapped
-- reporting function can use it.
create schema if not exists app_live;
revoke all on schema app_live from public, anon, authenticated;
comment on schema app_live is 'bl_train_0548: non-demo views of operational tables for KPIs, investor metrics and dispatcher scorecards.';

create or replace view app_live.organizations as
  select o.* from public.organizations o where not coalesce(o.is_demo, false);
create or replace view app_live.loads as
  select l.* from public.loads l where not coalesce(l.is_demo, false);
create or replace view app_live.profiles as
  select p.* from public.profiles p where not app_private.is_demo_only_user(p.id);
create or replace view app_live.documents as
  select d.* from public.documents d where d.carrier_id is null or not app_private.is_demo_only_user(d.carrier_id);
create or replace view app_live.trips as
  select t.* from app_private.trips t
   where not app_private.is_demo_org(t.carrier_id)
     and not coalesce((select l.is_demo from public.loads l where l.id = t.load_id), false);
create or replace view app_live.fin_invoices as
  select i.* from app_private.fin_invoices i
   where not app_private.is_demo_org(i.carrier_id)
     and not coalesce((select l.is_demo from public.loads l where l.id = i.load_id), false);
create or replace view app_live.load_book_requests as
  select r.* from app_private.load_book_requests r
   where not app_private.is_demo_org(r.carrier_org)
     and not coalesce((select l.is_demo from public.loads l where l.id = r.load_id), false);
create or replace view app_live.dispatcher_assignments as
  select a.* from app_private.dispatcher_assignments a where not app_private.is_demo_org(a.carrier_org_id);
create or replace view app_live.dispatcher_bookings as
  select b.* from app_private.dispatcher_bookings b where not app_private.is_demo_org(b.carrier_org_id);
create or replace view app_live.dispatcher_commission as
  select c.* from app_private.dispatcher_commission c where not app_private.is_demo_org(c.carrier_org_id);

do $rv$ declare v text; begin
  foreach v in array array['organizations','loads','profiles','documents','trips','fin_invoices','load_book_requests',
                           'dispatcher_assignments','dispatcher_bookings','dispatcher_commission'] loop
    execute format('revoke all on app_live.%I from public, anon, authenticated', v);
  end loop;
end $rv$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- §5  Outbound guards
-- ═══════════════════════════════════════════════════════════════════════════════════════════
create or replace function app_private.trg_training_guard_delivery()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare r text;
begin
  if current_setting('lb.training_ctx', true) is distinct from 'on' and not exists (select 1 from app_private.training_worlds) then return new; end if;
  if new.status not in ('queued','scheduled') then return new; end if;
  -- catalog send_mode 'test' rewrites the recipient to the test inbox; the real one is kept in meta.intended_for
  r := app_private.training_outbound_reason(new.recipient_user, coalesce(nullif(new.meta->>'intended_for', ''), new.recipient_email),
         array_remove(array[new.org_id, new.related_carrier, new.related_partner, new.related_load, new.related_trip, new.correlation_id], null)
           || app_private.uuids_in(coalesce(new.idempotency_key, '') || ' ' || left(coalesce(new.meta->>'body_html', ''), 40000)),
         coalesce(new.meta->>'subject', '') || ' ' || left(coalesce(new.meta->>'body_text', ''), 8000) || ' ' || left(coalesce(new.meta->>'body_html', ''), 40000));
  if r is null then return new; end if;
  new.status := 'suppressed';
  new.failure_reason := 'training sandbox: ' || r;
  new.meta := coalesce(new.meta, '{}'::jsonb) || jsonb_build_object('training_blocked', r);
  perform app_private.training_note_block(coalesce(new.channel, 'email'), coalesce(new.recipient_email, new.recipient_phone), new.template_key, r,
    jsonb_build_object('idempotency_key', new.idempotency_key, 'subject', new.meta->>'subject'));
  return new;
end $fn$;

create or replace function app_private.trg_training_guard_push()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare r text;
begin
  if (current_setting('lb.training_ctx', true) is distinct from 'on' and not exists (select 1 from app_private.training_worlds)) or new.sent_at is not null then return new; end if;
  r := app_private.training_outbound_reason(new.user_id, null,
         app_private.uuids_in(coalesce(new.url, '') || ' ' || coalesce(new.tag, '')),
         coalesce(new.title, '') || ' ' || coalesce(new.body, ''));
  if r is null then return new; end if;
  new.sent_at := now();
  new.result := jsonb_build_object('skipped', 'training sandbox', 'reason', r);
  perform app_private.training_note_block('push', new.user_id::text, new.tag, r, jsonb_build_object('title', new.title));
  return new;
end $fn$;

create or replace function app_private.trg_training_guard_wa_auto()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare r text;
begin
  if current_setting('lb.training_ctx', true) is distinct from 'on' and not exists (select 1 from app_private.training_worlds) then return new; end if;
  r := app_private.training_outbound_reason(null, null,
         array_remove(array[new.carrier_org_id, new.assignment_id], null) || app_private.uuids_in(coalesce(new.vars::text, '')),
         coalesce(new.vars::text, ''));
  if r is null then return new; end if;
  new.status := 'skipped';
  new.note := coalesce(new.note || ' | ', '') || 'training sandbox: ' || r;
  perform app_private.training_note_block('whatsapp', new.carrier_org_id::text, new.template_name, r, jsonb_build_object('event', new.event));
  return new;
end $fn$;

create or replace function app_private.trg_training_guard_webhook()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare r text;
begin
  if (current_setting('lb.training_ctx', true) is distinct from 'on' and not exists (select 1 from app_private.training_worlds)) or coalesce(new.status, 'queued') <> 'queued' then return new; end if;
  r := app_private.training_outbound_reason(null, null, app_private.uuids_in(coalesce(new.payload::text, '')), coalesce(new.payload::text, ''));
  if r is null then return new; end if;
  new.status := 'skipped';
  new.note := 'training sandbox: ' || r;
  perform app_private.training_note_block('webhook', new.endpoint_id::text, new.event_type, r, null);
  return new;
end $fn$;

-- Interactive sends to a training carrier fail loudly, so the dispatcher sees why.
create or replace function app_private.trg_training_guard_interactive()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare v_org uuid; v_num text; v_dir text;
begin
  if not exists (select 1 from app_private.training_worlds) then return new; end if;
  case tg_table_name
    when 'dialer_messages' then v_dir := new.direction; v_org := new.carrier_org_id; v_num := new.counterparty;
    when 'dialer_calls'    then v_dir := new.direction; v_org := new.carrier_org_id; v_num := new.to_number;
    when 'wa_messages'     then v_dir := new.direction;
      select t.carrier_org_id, t.counterparty into v_org, v_num from app_private.wa_threads t where t.id = new.thread_id;
    when 'riley_call_plans' then v_dir := 'outbound'; v_org := new.org_id; v_num := new.to_number;
    else return new;
  end case;
  if coalesce(v_dir, '') not in ('outbound', 'out') then return new; end if;
  if app_private.is_training_org(v_org)
     or exists (select 1 from app_private.training_worlds w
                 where regexp_replace(coalesce(v_num, ''), '[^0-9]', '', 'g') = regexp_replace(w.phone, '[^0-9]', '', 'g')) then
    perform app_private.training_note_block(tg_table_name, v_num, null, 'interactive send to a training carrier refused', null);
    raise exception 'TRAINING ACCOUNT — nothing here is real. Calls, SMS, WhatsApp and Riley are switched off for training carriers; practise the message in the dispatcher thread instead.'
      using errcode = '42501';
  end if;
  return new;
end $fn$;

-- No dispatcher commission is ever earned on a demo carrier.
create or replace function app_private.trg_training_no_demo_commission()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $fn$
begin
  if app_private.is_demo_org(new.carrier_org_id) then
    perform app_private.training_note_block('commission', new.dispatcher_user_id::text, null, 'demo carrier — no commission', jsonb_build_object('booking', new.booking_id, 'amount', new.amount));
    return null;
  end if;
  return new;
end $fn$;

-- Training fee invoices follow the published terms: due 30 days after issue (loadboot.com/pricing).
create or replace function app_private.trg_training_invoice_terms()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $fn$
begin
  if app_private.is_training_org(new.carrier_id) then
    new.due_at := (coalesce(new.issued_at, now()) at time zone 'America/Chicago')::date + 30;
  end if;
  return new;
end $fn$;

-- During seed / reset, in-app notifications to anyone but the training carrier are pre-read
-- (staff "new document" alerts for sample PDFs would otherwise flood the Command Center feed).
create or replace function app_private.trg_training_quiet_notifications()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $fn$
begin
  if current_setting('lb.training_ctx', true) = 'on'
     and (new.recipient_user is null or not (new.recipient_user = any(app_private.training_user_ids()))) then
    new.read_at := coalesce(new.read_at, now());
    new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object('training', true);
  end if;
  return new;
end $fn$;

-- Same-request marker: a user request that changed a training row holds outbound mail to staff and
-- dispatchers in that request (crons are excluded — they batch real and demo rows together).
create or replace function app_private.trg_training_touch()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare v_a uuid; v_b uuid;
begin
  if auth.uid() is null or not exists (select 1 from app_private.training_worlds) then return new; end if;
  case tg_table_name
    when 'loads'                  then v_a := new.broker_org; v_b := new.shipper_org;
    when 'trips'                  then v_a := new.carrier_id;
    when 'load_offers'            then v_a := new.carrier_id;
    when 'dispatcher_bookings'    then v_a := new.carrier_org_id;
    when 'dispatcher_assignments' then v_a := new.carrier_org_id;
    when 'load_book_requests'     then v_a := new.carrier_org;
    when 'fin_invoices'           then v_a := new.carrier_id;
    when 'trip_accessorials'      then select t.carrier_id into v_a from app_private.trips t where t.id = new.trip_id;
    else return new;
  end case;
  if app_private.is_training_org(v_a) or app_private.is_training_org(v_b) then
    perform set_config('lb.training_touch', 'on', true);
  end if;
  return new;
end $fn$;

do $rv$ declare f text; begin
  foreach f in array array['app_private.trg_training_guard_delivery()','app_private.trg_training_guard_push()',
    'app_private.trg_training_guard_wa_auto()','app_private.trg_training_guard_webhook()',
    'app_private.trg_training_guard_interactive()','app_private.trg_training_no_demo_commission()',
    'app_private.trg_training_invoice_terms()','app_private.trg_training_quiet_notifications()',
    'app_private.trg_training_touch()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $rv$;

-- Triggers (created only if missing; `a0_` sorts them before every existing trigger on the table).
do $tg$
declare r record;
begin
  for r in select * from (values
      ('app_private.message_deliveries',   'a0_training_guard',   'before insert',            'app_private.trg_training_guard_delivery()'),
      ('app_private.push_outbox',          'a0_training_guard',   'before insert',            'app_private.trg_training_guard_push()'),
      ('app_private.wa_auto_outbox',       'a0_training_guard',   'before insert',            'app_private.trg_training_guard_wa_auto()'),
      ('app_private.webhook_deliveries',   'a0_training_guard',   'before insert',            'app_private.trg_training_guard_webhook()'),
      ('app_private.dialer_messages',      'a0_training_guard',   'before insert',            'app_private.trg_training_guard_interactive()'),
      ('app_private.dialer_calls',         'a0_training_guard',   'before insert',            'app_private.trg_training_guard_interactive()'),
      ('app_private.wa_messages',          'a0_training_guard',   'before insert',            'app_private.trg_training_guard_interactive()'),
      ('app_private.riley_call_plans',     'a0_training_guard',   'before insert',            'app_private.trg_training_guard_interactive()'),
      ('app_private.dispatcher_commission','a0_training_no_demo', 'before insert',            'app_private.trg_training_no_demo_commission()'),
      ('app_private.fin_invoices',         'a0_training_terms',   'before insert',            'app_private.trg_training_invoice_terms()'),
      ('app_private.notifications',        'a0_training_quiet',   'before insert',            'app_private.trg_training_quiet_notifications()'),
      ('public.loads',                     'a0_training_touch',   'before insert or update',  'app_private.trg_training_touch()'),
      ('app_private.trips',                'a0_training_touch',   'before insert or update',  'app_private.trg_training_touch()'),
      ('app_private.load_offers',          'a0_training_touch',   'before insert or update',  'app_private.trg_training_touch()'),
      ('app_private.dispatcher_bookings',  'a0_training_touch',   'before insert or update',  'app_private.trg_training_touch()'),
      ('app_private.dispatcher_assignments','a0_training_touch',  'before insert or update',  'app_private.trg_training_touch()'),
      ('app_private.load_book_requests',   'a0_training_touch',   'before insert or update',  'app_private.trg_training_touch()'),
      ('app_private.fin_invoices',         'a0_training_touch',   'before insert or update',  'app_private.trg_training_touch()'),
      ('app_private.trip_accessorials',    'a0_training_touch',   'before insert or update',  'app_private.trg_training_touch()')
    ) t(tbl, name, evt, fn)
  loop
    if to_regclass(r.tbl) is not null
       and not exists (select 1 from pg_trigger where tgrelid = r.tbl::regclass and tgname = r.name) then
      execute format('create trigger %I %s on %s for each row execute function %s', r.name, r.evt, r.tbl, r.fn);
    end if;
  end loop;
end $tg$;

-- Staging only (prod has no Stripe fee billing yet): a training invoice is never sent to Stripe.
do $st$
begin
  if to_regclass('app_private.lb_stripe_queue') is not null then
    execute $f$
      create or replace function app_private.trg_training_guard_stripe()
      returns trigger language plpgsql security definer set search_path to 'app_private, public' as $b$
      begin
        if app_private.is_training_org(new.org_id)
           or exists (select 1 from app_private.fin_invoices i where i.id = new.invoice_id and app_private.is_training_org(i.carrier_id)) then
          new.done_at := now();
          new.last_error := 'training sandbox — never sent to Stripe';
          perform app_private.training_note_block('stripe', coalesce(new.invoice_id::text, new.org_id::text), new.op, 'training invoice / org', null);
        end if;
        return new;
      end $b$ $f$;
    execute 'revoke all on function app_private.trg_training_guard_stripe() from public, anon, authenticated';
    if not exists (select 1 from pg_trigger where tgrelid = 'app_private.lb_stripe_queue'::regclass and tgname = 'a0_training_guard') then
      execute 'create trigger a0_training_guard before insert on app_private.lb_stripe_queue for each row execute function app_private.trg_training_guard_stripe()';
    end if;
  end if;
end $st$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- §6  Patches to existing functions
-- ═══════════════════════════════════════════════════════════════════════════════════════════
create or replace function pg_temp.patch(p_schema text, p_name text, p_anchor text, p_replacement text)
returns text language plpgsql as $patch$
declare d text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name limit 1;
  if v_oid is null then raise exception 'patch: %.% not found', p_schema, p_name; end if;
  d := pg_get_functiondef(v_oid);
  if position(p_replacement in d) > 0 then return p_name || ': already'; end if;
  if position(p_anchor in d) = 0 then raise exception 'patch: anchor not found in %.% — refusing to patch blind', p_schema, p_name; end if;
  execute replace(d, p_anchor, p_replacement);
  return p_name || ': patched';
end $patch$;

-- Read-only reporting functions: point every operational table at its app_live view.
create or replace function pg_temp.swap_live(p_schema text, p_name text)
returns text language plpgsql as $sw$
declare d text; d0 text; v_oid oid; t text;
  tbls text[] := array['public.loads','public.organizations','public.profiles','public.documents',
                       'app_private.trips','app_private.fin_invoices','app_private.load_book_requests',
                       'app_private.dispatcher_assignments','app_private.dispatcher_bookings','app_private.dispatcher_commission'];
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name limit 1;
  if v_oid is null then raise exception 'swap_live: %.% not found', p_schema, p_name; end if;
  d := pg_get_functiondef(v_oid); d0 := d;
  foreach t in array tbls loop
    if d ~* ('(insert\s+into|update|delete\s+from)\s+' || replace(t, '.', '\.') || '\M') then
      raise exception 'swap_live: %.% writes %, refusing (only read-only reporting functions may be swapped)', p_schema, p_name, t;
    end if;
    d := regexp_replace(d, '\m' || replace(t, '.', '\.') || '\M', 'app_live.' || split_part(t, '.', 2), 'g');
  end loop;
  if d = d0 then return p_name || ': already'; end if;
  execute d;
  return p_name || ': swapped';
end $sw$;

-- Board rule: add training_load_ok next to every `<alias>.is_demo = app_private.session_is_demo()`.
create or replace function pg_temp.board(p_schema text, p_name text)
returns text language plpgsql as $bd$
declare d text; d0 text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema and p.proname = p_name limit 1;
  if v_oid is null then raise exception 'board: %.% not found', p_schema, p_name; end if;
  d := pg_get_functiondef(v_oid); d0 := d;
  if position('training_load_ok' in d) > 0 then return p_name || ': already'; end if;
  d := regexp_replace(d, '(\m[a-z][a-z0-9_]*)\.is_demo = app_private\.session_is_demo\(\)',
                      '\1.is_demo = app_private.session_is_demo() and app_private.training_load_ok(\1.broker_org, \1.shipper_org)', 'g');
  d := regexp_replace(d, '([^.a-z0-9_])is_demo = app_private\.session_is_demo\(\)',
                      '\1is_demo = app_private.session_is_demo() and app_private.training_load_ok(broker_org, shipper_org)', 'g');
  if d = d0 then raise exception 'board: no demo clause in %.% — refusing to patch blind', p_schema, p_name; end if;
  execute d;
  return p_name || ': patched';
end $bd$;

-- 6a. Board / booking: one training world never sees another's freight, nor the Play-review board.
select pg_temp.board('public', 'cc_pocket_available_loads');
select pg_temp.board('public', 'carrier_assignment_suggestions');
select pg_temp.board('public', 'cc_truck_posting_matches');
select pg_temp.board('public', 'cc_pocket_book_load');
select pg_temp.board('public', 'book_load');
select pg_temp.board('public', 'carrier_fleet_plan');
select pg_temp.board('public', 'cc_request_book_load');
select pg_temp.board('public', 'cc_prebook_check');

-- 6a'. "Best loads" ranking (carrier dashboard, dispatcher workspace, CC) was not demo-aware at all:
-- a real carrier's ranking could list Play-review or training freight. Rank only freight on the
-- TARGET carrier's side (staff call it with p_carrier, so the session alone is not enough).
select pg_temp.patch('public', 'cc_carrier_best_loads',
  E'      and (pickup_date is null or pickup_date >= current_date)\n    order by created_at desc limit 60',
  E'      and (pickup_date is null or pickup_date >= current_date)\n'
  || E'      and is_demo = app_private.is_demo_org(v_target)  -- bl_train_0548\n'
  || E'      and app_private.training_world_of_org(coalesce(broker_org, shipper_org)) is not distinct from app_private.training_world_of_org(v_target)\n'
  || E'    order by created_at desc limit 60');

-- 6b. Broker → carrier directory: a training carrier is listed only inside its own world.
select pg_temp.patch('public', 'cc_partner_carrier_directory',
  'o.is_demo = app_private.session_is_demo() and coalesce(o.broker_visible, false)',
  'o.is_demo = app_private.session_is_demo() and app_private.training_org_ok(o.id) and coalesce(o.broker_visible, false)');
select pg_temp.patch('public', 'cc_partner_eligible_carriers',
  'o.is_demo = app_private.session_is_demo() and coalesce(o.broker_visible, false)',
  'o.is_demo = app_private.session_is_demo() and app_private.training_org_ok(o.id) and coalesce(o.broker_visible, false)');

-- 6c. FMCSA: the training MC/DOT are fake. Never look them up.
select pg_temp.patch('app_private', 'fmcsa_authority_request',
  E'  select * into cfg from app_private.fmcsa_config where id;\n  if not found or not cfg.enabled then return null; end if;',
  E'  if app_private.is_demo_org(p_org) then return null; end if;  -- bl_train_0548: demo/training MC/DOT are not real\n  select * into cfg from app_private.fmcsa_config where id;\n  if not found or not cfg.enabled then return null; end if;');
select pg_temp.patch('app_private', 'fmcsa_snapshot_queue',
  E'     where cs.dot_number ~ \'^[0-9]+$\'',
  E'     where cs.dot_number ~ \'^[0-9]+$\' and not app_private.is_demo_org(cs.carrier_id)  -- bl_train_0548');

-- 6d. Capacity: a training carrier's one van can hold every trip state at once (+5).
select pg_temp.patch('app_private', 'carrier_capacity',
  E'       where t.carrier_id = p_org and coalesce(t.status,\'active\') <> \'inactive\')::int,\n    1);',
  E'       where t.carrier_id = p_org and coalesce(t.status,\'active\') <> \'inactive\')::int,\n    1) + case when app_private.is_training_org(p_org) then 5 else 0 end;  -- bl_train_0548');
select pg_temp.patch('app_private', 'match_eligibility',
  'when c.active_trips >= greatest(c.trucks,1) then',
  'when c.active_trips >= app_private.carrier_capacity(c.id) then');
-- the portal's own "All your trucks are booked (n/cap)" gate reads the same capacity
select pg_temp.patch('public', 'cc_my_capacity',
  '  v_cap := greatest(v_trucks,1);',
  '  v_cap := app_private.carrier_capacity(v_org);  -- bl_train_0548: same rule as trg_trip_capacity');

-- 6e. Part C — cc_dispatcher_assign: count only real carriers; a demo carrier never uses a slot.
select pg_temp.patch('public', 'cc_dispatcher_assign',
  '  declare pol jsonb := app_private.disp_capacity_policy(); v_cur int;',
  '  <<cap>> declare pol jsonb := app_private.disp_capacity_policy(); v_cur int;');
select pg_temp.patch('public', 'cc_dispatcher_assign',
  'decide those before assigning another carrier''); end if;',
  'decide those before assigning another carrier''); end if;'
  || E'\n    exit cap when app_private.is_demo_org(v_org);  -- bl_train_0548: a demo/training carrier never uses a capacity slot');
select pg_temp.patch('public', 'cc_dispatcher_assign',
  'select count(*) into v_cur from app_private.dispatcher_assignments a',
  'select count(*) into v_cur from app_live.dispatcher_assignments a');
select pg_temp.patch('public', 'cc_dispatcher_assign',
  '(select a.carrier_org_id from app_private.dispatcher_assignments a where a.dispatcher_user_id = p_dispatcher',
  '(select a.carrier_org_id from app_live.dispatcher_assignments a where a.dispatcher_user_id = p_dispatcher');
select pg_temp.patch('public', 'cc_dispatcher_assign',
  'select count(*) into v_del from app_private.dispatcher_bookings b',
  'select count(*) into v_del from app_live.dispatcher_bookings b');
select pg_temp.patch('public', 'cc_dispatcher_assign',
  E'  end;\n  begin\n    insert into app_private.dispatcher_assignments',
  E'  end cap;\n  begin\n    insert into app_private.dispatcher_assignments');

-- 6f. Reporting reads app_live.* (KPIs, investor metrics, dispatcher scorecards + daily email).
select pg_temp.swap_live('public', 'cc_get_overview');
select pg_temp.swap_live('public', 'cc_analytics_overview');
select pg_temp.swap_live('app_private', 'inv_growth_metrics');
select pg_temp.swap_live('public', 'inv_growth');
select pg_temp.swap_live('public', 'cc_dispatchers_stats');
select pg_temp.swap_live('app_private', 'disp_trial_stats');
select pg_temp.swap_live('app_private', 'disp_trial_daily_build');
select pg_temp.swap_live('app_private', 'disp_kpis');
select pg_temp.swap_live('public', 'dispatcher_capacity');
select pg_temp.swap_live('app_private', 'disp_choice_eligibility');

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- §7  The training world
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- Act as a staff admin for the rest of this transaction (document filing, approvals and
-- cc_dispatcher_assign all check the caller). In the SQL Editor auth.uid() is null.
create or replace function app_private.training_act_as_staff()
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare v uuid;
begin
  if auth.uid() is not null and public.is_active_staff() and public.is_admin() then return auth.uid(); end if;
  select p.id into v from public.profiles p join app_private.staff_members s on s.user_id = p.id and s.status = 'active'
   where p.role = 'admin' order by p.created_at limit 1;
  if v is null then raise exception 'training: no active admin staff member to act as'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v::text, true);
  return v;
end $fn$;

-- Carrier side of a world: onboarding, compliance, truck, driver, prefs, bank. Idempotent — reset
-- runs it again so anything the trainee changed is back to the seeded state.
create or replace function app_private.training_fill_carrier(p_world uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare
  w app_private.training_worlds; v_staff uuid; v_org text; v_owner text; v_vin text; v_truck uuid; v_driver uuid;
  v_docs jsonb := '{}'::jsonb; v_doc uuid; d record; v_mc text; v_dot text;
  v_note constant text := 'TRAINING SAMPLE — NOT A REAL DOCUMENT. Training account: nothing was submitted or reviewed.';
begin
  select * into w from app_private.training_worlds where id = p_world;
  if w.id is null then raise exception 'training: world % not found', p_world; end if;
  perform set_config('lb.training_ctx', 'on', true);
  v_staff := app_private.training_act_as_staff();
  select name, mc_number, dot_number into v_org, v_mc, v_dot from public.organizations where id = w.carrier_org;
  v_owner := 'Training Owner — ' || w.label;

  update public.organizations set status = 'active', is_demo = true, broker_visible = true where id = w.carrier_org;
  update public.profiles set status = 'active', role = 'carrier', company = v_org, contact_name = v_owner,
         phone = w.phone, mc = v_mc, dot = v_dot, equipment = 'Sprinter Van', equipment_types = array['Sprinter Van','Cargo Van'],
         trucks = '1', truck_count = '1', lanes = 'TX → TX, TX → OK, TX → AR, TX → LA', home_base = 'Dallas, TX',
         authority = 'active', radius_miles = 350, min_rpm = 2.00, max_deadhead = 120, weekend_ok = true, hazmat = false,
         contact_method = 'app', legal_owner_name = v_owner, owner_drives = 'owner', team_drivers = false
   where id = w.carrier_user;

  -- Sample documents (PDFs uploaded by tools/training/upload-samples.mjs to these exact paths)
  for d in select * from (values
      ('authority',          'mc_authority',       'TRAINING-SAMPLE-MC-authority.pdf',      'authority.pdf',          null::int),
      ('insurance',          'insurance_coi',      'TRAINING-SAMPLE-certificate-of-insurance.pdf', 'coi.pdf',      365),
      ('w9',                 'w9',                 'TRAINING-SAMPLE-W-9.pdf',               'w9.pdf',                 null),
      ('mcs150',             'mcs150',             'TRAINING-SAMPLE-MCS-150.pdf',           'mcs150.pdf',             730),
      ('bank_check',         'bank_verification',  'TRAINING-SAMPLE-voided-check.pdf',      'bank.pdf',               null),
      ('dispatch_agreement', 'dispatch_agreement', 'TRAINING-SAMPLE-dispatch-agreement.pdf','dispatch-agreement.pdf', null)
    ) x(doc_type, req, file_name, file, exp_days)
  loop
    select id into v_doc from public.documents where carrier_id = w.carrier_user and type = d.doc_type and source = 'training' limit 1;
    if v_doc is null then
      insert into public.documents (carrier_id, type, file_name, file_path, status, review_note, reviewed_at, uploaded_by, source, source_note)
      values (w.carrier_user, d.doc_type, d.file_name, w.carrier_user::text || '/training/' || d.file, 'approved', v_note, now(),
              w.carrier_user, 'training', v_note)
      returning id into v_doc;
    else
      update public.documents set status = 'approved', review_note = v_note, reviewed_at = now() where id = v_doc;
    end if;
    v_docs := v_docs || jsonb_build_object(d.req, v_doc);
  end loop;

  -- COI with the van scheduled on it (mode scheduled), BEFORE the insurance requirement is valid
  v_vin := coalesce((select vin from app_private.fleet_trucks where carrier_id = w.carrier_org and unit_no = 'TRAIN-1'),
                    'W1YTRNXX00T' || lpad((floor(random() * 1000000))::int::text, 6, '0'));
  insert into app_private.coi_coverage (org_id, mode, document_id, effective_date, expiry_date, source, confirmed_by, confirmed_at, note,
                                        auto_liability_limit, cargo_limit, cargo_deductible, reefer_breakdown, provenance)
  values (w.carrier_org, 'scheduled', (v_docs->>'insurance_coi')::uuid, current_date - 30, current_date + 335, 'staff', v_staff, now(), v_note,
          1000000, 100000, 1000, false, 'carrier')
  on conflict (org_id) do update set mode = 'scheduled', document_id = excluded.document_id, effective_date = excluded.effective_date,
     expiry_date = excluded.expiry_date, source = 'staff', confirmed_by = excluded.confirmed_by, confirmed_at = now(), note = excluded.note,
     auto_liability_limit = excluded.auto_liability_limit, cargo_limit = excluded.cargo_limit, cargo_deductible = excluded.cargo_deductible,
     reefer_breakdown = false, provenance = 'carrier';
  if not exists (select 1 from app_private.coi_vehicles where org_id = w.carrier_org and vin = v_vin) then
    insert into app_private.coi_vehicles (org_id, vin, descr, document_id, added_by)
    values (w.carrier_org, v_vin, '2023 Mercedes-Benz Sprinter 2500 high-roof (TRAINING — VIN is not real)', (v_docs->>'insurance_coi')::uuid, v_staff);
  end if;

  -- Compliance: every mandatory requirement valid
  for d in select * from (values
      ('mc_authority', null::int), ('insurance_coi', 335), ('cargo_insurance', 335), ('w9', null), ('mcs150', 700),
      ('safety_rating', null), ('bank_verification', null), ('dispatch_agreement', null)) x(req, exp_days)
  loop
    insert into app_private.carrier_compliance (carrier_id, requirement_key, status, document_id, effective_date, expiry_date, verified_by, verified_at, note)
    values (w.carrier_org, d.req, 'valid', (v_docs->>(case when d.req = 'cargo_insurance' then 'insurance_coi' else d.req end))::uuid,
            current_date - 30, case when d.exp_days is null then null else current_date + d.exp_days end, v_staff, now(), v_note)
    on conflict (carrier_id, requirement_key) do update set status = 'valid', document_id = excluded.document_id,
       effective_date = excluded.effective_date, expiry_date = excluded.expiry_date, verified_by = excluded.verified_by,
       verified_at = now(), note = excluded.note;
  end loop;

  -- Onboarding packet + approval (same pattern as the store-review accounts, bl_demo_0217)
  insert into app_private.org_onboarding_items (org_id, item_key, status, note, reviewed_at, reviewed_by)
  select w.carrier_org, t.item_key,
         case when t.item_key in ('hazmat_cert','reefer_breakdown','noa_factoring') then 'waived' else 'verified' end,
         case when t.item_key in ('hazmat_cert','reefer_breakdown','noa_factoring')
              then 'Not applicable — the training carrier does not haul hazmat or reefer and does not factor.' else v_note end,
         now(), v_staff
    from app_private.onboarding_packet_templates t where t.org_kind = 'carrier'
  on conflict (org_id, item_key) do update set status = excluded.status, note = excluded.note, reviewed_at = now(), reviewed_by = excluded.reviewed_by;

  insert into app_private.carrier_onboarding (carrier_id, stage, submitted_at, decided_at, decided_by, decision_note, created_by)
  values (w.carrier_org, 'approved', now() - interval '2 days', now() - interval '1 day', v_staff,
          'TRAINING ACCOUNT — approved by training_seed. No real document was reviewed.', v_staff)
  on conflict (carrier_id) do update set stage = 'approved', decided_at = coalesce(app_private.carrier_onboarding.decided_at, now()),
     decided_by = excluded.decided_by, decision_note = excluded.decision_note;

  -- Phone verified (fictional 555-01xx number)
  insert into app_private.carrier_phone_verify (org_id, phone, verified_at, verified_by, method)
  values (w.carrier_org, w.phone, now(), v_staff, 'training')
  on conflict (org_id) do update set phone = excluded.phone, verified_at = now(), verified_by = excluded.verified_by, method = 'training';

  -- Authority / safety (fake MC/DOT — FMCSA lookups for demo orgs are switched off in §6c)
  insert into app_private.carrier_safety (carrier_id, dot_number, mc_number, authority_status, safety_rating, power_units, driver_count,
                                          out_of_service, source, last_checked, updated_by, fmcsa_snapshot, authority_date, authority_date_source, registered_since)
  select w.carrier_org, v_dot, v_mc, 'active', 'none', 1, 1, false, 'manual', now(), v_staff,
         jsonb_build_object('training', true, 'fetched_at', now(), 'legal_name', v_org, 'note', 'TRAINING — not an FMCSA record'),
         current_date - 400, 'staff', current_date - 400
   where not exists (select 1 from app_private.carrier_safety where carrier_id = w.carrier_org);
  update app_private.carrier_safety set authority_status = 'active', out_of_service = false, last_checked = now(),
         fmcsa_snapshot = coalesce(fmcsa_snapshot, '{}'::jsonb) || jsonb_build_object('training', true, 'fetched_at', now())
   where carrier_id = w.carrier_org;
  insert into app_private.authority_checks (org_id, mc_number, dot_number, checked_at, authority_status, allowed_to_operate, legal_name,
                                            safety_rating, out_of_service, consecutive_fail, raw, entity_type, authority_type, mc_active)
  values (w.carrier_org, v_mc, v_dot, now(), 'active', 'Y', v_org, 'Not Rated', false, 0,
          jsonb_build_object('training', true, 'note', 'TRAINING — not an FMCSA record'), 'CARRIER', 'COMMON', true)
  on conflict (org_id) do update set mc_number = excluded.mc_number, dot_number = excluded.dot_number, checked_at = now(), request_id = null,
     authority_status = 'active', allowed_to_operate = 'Y', out_of_service = false, consecutive_fail = 0, last_error = null, mc_active = true;

  -- W-9, dispatch agreement, bank (obviously fake numbers)
  if not exists (select 1 from app_private.w9_submissions where carrier_id = w.carrier_org) then
    insert into app_private.w9_submissions (carrier_id, name, business_name, classification, llc_class, address, city_state_zip, tin, tin_last4,
                                            signer_name, signed_date, signed_at, ref)
    values (w.carrier_org, v_owner, v_org, 'llc', 'S', '100 Training Way (NOT A REAL ADDRESS)', 'Dallas, TX 75201', '00-0000000', '0000',
            v_owner, current_date - 2, now() - interval '2 days', 'TRAINING-SAMPLE');
  end if;
  if not exists (select 1 from app_private.dispatch_agreement_signatures where carrier_id = w.carrier_org) then
    insert into app_private.dispatch_agreement_signatures (carrier_id, signer_name, signed_date, agreement_ref, signed_at)
    values (w.carrier_org, v_owner, to_char(current_date - 2, 'YYYY-MM-DD'), 'TRAINING-SAMPLE', now() - interval '2 days');
  end if;
  insert into app_private.org_payment_profiles (org_id, bank_name, account_title, account_number, routing_number, account_type, payment_method,
                                                verified, verified_by, verified_at, updated_by, factoring_noa, noa_status)
  values (w.carrier_org, 'TRAINING BANK — NOT A REAL ACCOUNT', v_org, '000000000000', '000000000', 'checking', 'ach',
          true, v_staff, now(), v_staff, false, 'none')
  on conflict (org_id) do update set bank_name = excluded.bank_name, account_number = excluded.account_number,
     routing_number = excluded.routing_number, verified = true, verified_by = excluded.verified_by, verified_at = now(),
     factoring_noa = false, noa_status = 'none';

  -- Fleet: one Sprinter, one driver
  select id into v_truck from app_private.fleet_trucks where carrier_id = w.carrier_org and unit_no = 'TRAIN-1';
  if v_truck is null then
    insert into app_private.fleet_trucks (carrier_id, unit_no, plate, vin, equipment, status, payload_lbs, cargo_len_in, cargo_width_in, cargo_height_in,
        capacity_note, vin_make, vin_model, vin_year, vin_body, domicile_city, domicile_state, domicile_zip, door_type, dock_high, liftgate,
        has_pallet_jack, has_etrack, has_load_bars, has_straps, has_blankets, pallet_positions, temp_control, hazmat_placarded, team_driven,
        min_rpm, max_radius_miles, home_time, has_side_door, inspection_exp, next_service_date, spec_note)
    values (w.carrier_org, 'TRAIN-1', 'TRAIN1', v_vin, 'Sprinter Van', 'active', 3500, 170, 70, 72,
        '2 standard pallets or ~3,500 lb', 'Mercedes-Benz', 'Sprinter 2500', '2023', 'High-roof cargo van', 'Dallas', 'TX', '75201', 'swing', false, false,
        false, true, true, true, true, 2, 'none', false, false,
        2.00, 350, 'weekly', true, current_date + 180, current_date + 60, 'TRAINING VAN — VIN, plate and specs are not real.')
    returning id into v_truck;
  else
    update app_private.fleet_trucks set status = 'active', equipment = 'Sprinter Van', vin = v_vin where id = v_truck;
  end if;
  select id into v_driver from app_private.fleet_drivers where carrier_id = w.carrier_org order by created_at limit 1;
  if v_driver is null then
    insert into app_private.fleet_drivers (carrier_id, name, phone, license_no, license_state, license_exp, medical_exp, status, created_by)
    values (w.carrier_org, 'Training Driver (' || w.label || ')', w.phone, 'TRAIN-DL-000000', 'TX', current_date + 730, current_date + 365, 'active', v_staff)
    returning id into v_driver;
  else
    update app_private.fleet_drivers set status = 'active', license_exp = current_date + 730, medical_exp = current_date + 365 where id = v_driver;
  end if;
  -- Today's availability with the driver on the van (the dispatcher's "ready to book" checklist reads this)
  insert into app_private.truck_availability (truck_id, carrier_id, status, empty_at, empty_location, empty_zip, home_location,
                                              overnight_weekdays, overnight_weekends, driver_name, driver_phone, note, updated_by, updated_at)
  select v_truck, w.carrier_org, 'empty', now(), 'Dallas, TX', '75201', 'Dallas, TX', true, false, d0.name, d0.phone,
         'TRAINING — posted by training_seed / training_reset', v_staff, now()
    from app_private.fleet_drivers d0 where d0.id = v_driver
  on conflict (truck_id) do update set status = 'empty', empty_at = now(), empty_location = excluded.empty_location, empty_zip = excluded.empty_zip,
     driver_name = excluded.driver_name, driver_phone = excluded.driver_phone, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  if not exists (select 1 from app_private.emergency_contacts where carrier_id = w.carrier_org) then
    insert into app_private.emergency_contacts (carrier_id, name, relation, phone, created_by)
    values (w.carrier_org, 'Training Emergency Contact', 'Spouse', '+12145550199', v_staff);
  end if;

  -- Dispatch preferences, fully filled
  insert into app_private.carrier_dispatch_prefs (carrier_id, min_rpm, target_rpm, preferred_equipment, preferred_lanes, home_base, max_deadhead_miles,
      notes, updated_by, services, avoid_states, max_weight_lbs, min_trip_miles, max_trip_miles, hazmat, team_drivers, weekend_ok, min_notice_hours,
      available, cost_per_mile, fuel_price, truck_mpg, driver_pay_per_mile, maint_per_mile, fixed_per_mile, factoring_pct, operating_radius_miles,
      home_time, load_size, min_total_rate, facility_likes, facility_dislikes, external_boards, round_trip_pref, weekly_operating_cost,
      weekly_cost_includes_pay, weekly_cost_updated_at, haul_types, min_rpm_basis, dat_seat, dat_seat_note)
  values (w.carrier_org, 2.00, 2.60, array['Sprinter Van','Cargo Van'], array['TX → TX','TX → OK','TX → AR','TX → LA'], 'Dallas, TX', 120,
      'TRAINING CARRIER — practice preferences. Prefers next-day freight, home Friday night.', v_staff, array['expedite','partial'], array['NY','NJ','CA'],
      3500, 80, 650, false, false, true, 4,
      true, 0.95, 3.55, 18, 0.00, 0.12, 0.18, 0, 350,
      'weekly', 'both', 300, array['Dock-level DCs'], array['Ports — long waits'], '{"dat":"active","truckstop":"none"}'::jsonb, 'prefer', 1450,
      false, now(), array['local','regional'], 'loaded', 'yes', 'Training: DAT seat is active (not a real subscription).')
  on conflict (carrier_id) do update set min_rpm = excluded.min_rpm, target_rpm = excluded.target_rpm, preferred_equipment = excluded.preferred_equipment,
      preferred_lanes = excluded.preferred_lanes, home_base = excluded.home_base, max_deadhead_miles = excluded.max_deadhead_miles, notes = excluded.notes,
      services = excluded.services, avoid_states = excluded.avoid_states, max_weight_lbs = excluded.max_weight_lbs, min_trip_miles = excluded.min_trip_miles,
      max_trip_miles = excluded.max_trip_miles, hazmat = false, weekend_ok = true, available = true, operating_radius_miles = excluded.operating_radius_miles,
      home_time = excluded.home_time, load_size = excluded.load_size, min_total_rate = excluded.min_total_rate, external_boards = excluded.external_boards,
      round_trip_pref = excluded.round_trip_pref, haul_types = excluded.haul_types, min_rpm_basis = excluded.min_rpm_basis, dat_seat = 'yes',
      dat_seat_note = excluded.dat_seat_note, updated_at = now();

  return jsonb_build_object('truck', v_truck, 'driver', v_driver, 'vin', v_vin, 'documents', v_docs);
end $fn$;

-- One demo load from the world's broker.
create or replace function app_private.training_mk_load(p_world uuid, p jsonb)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare w app_private.training_worlds; v_id uuid; v_bname text;
begin
  select * into w from app_private.training_worlds where id = p_world;
  select name into v_bname from public.organizations where id = w.broker_org;
  insert into public.loads (origin, destination, origin_full, destination_full, equipment, miles, rate, deadhead, commodity, weight, requirements, hazmat,
      pickup_lat, pickup_lng, delivery_lat, delivery_lng, pickup_date, delivery_date, pickup_time, delivery_time,
      broker, broker_org, status, assigned_to, is_public, published_at, expires_at, source_type, verification_state, confidence, notes, details, accessorials)
  values (p->>'o', p->>'d', p->>'of', p->>'df', coalesce(p->>'eq', 'Sprinter Van'), (p->>'mi')::int, (p->>'rate')::numeric, coalesce((p->>'dh')::int, 15),
      p->>'com', p->>'wt', p->>'req', false,
      (p->>'plat')::float8, (p->>'plng')::float8, (p->>'dlat')::float8, (p->>'dlng')::float8,
      current_date + (p->>'pday')::int, current_date + (p->>'dday')::int, coalesce(p->>'pt', '08:00–12:00'), coalesce(p->>'dt', '13:00–17:00'),
      v_bname, w.broker_org, coalesce(p->>'status', 'available'), case when p->>'status' in ('booked','in_transit','delivered') then w.carrier_user end,
      true, now() - interval '2 hours', now() + interval '14 days', 'partner_portal', 'verified', 'high',
      'TRAINING LOAD — not real freight. Posted by the training broker for dispatcher onboarding.',
      jsonb_build_object('demo', true, 'training', true, 'load_size', coalesce(p->>'size', 'full'),
                         'load_source', jsonb_build_object('name', 'LoadBoot training data', 'kind', 'demo')),
      jsonb_build_object('detention_per_hr', 40, 'detention_free_hours', 2, 'tonu', 150, 'layover_per_day', 150, 'lumper_policy', 'reimbursed with receipt'))
  returning id into v_id;
  return v_id;
end $fn$;

-- A trip on a training load, walked through the real status triggers.
create or replace function app_private.training_mk_trip(p_world uuid, p_load uuid, p_to text, p_pickup timestamptz, p_delivery timestamptz)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare w app_private.training_worlds; l public.loads; v_trip uuid; v_truck uuid; v_drv record; s text;
begin
  select * into w from app_private.training_worlds where id = p_world;
  select * into l from public.loads where id = p_load;
  select id into v_truck from app_private.fleet_trucks where carrier_id = w.carrier_org and unit_no = 'TRAIN-1';
  select id, name, phone into v_drv from app_private.fleet_drivers where carrier_id = w.carrier_org order by created_at limit 1;
  insert into app_private.trips (load_id, carrier_id, status, rate, miles, scheduled_pickup, scheduled_delivery, pickup_lat, pickup_lng,
                                 delivery_lat, delivery_lng, created_by, driver_id, driver_name, driver_phone, truck_id, truck_no,
                                 location_consent, tracking_method, tracking_consent_at, pickup_mode, driven_by_owner)
  values (l.id, w.carrier_org, 'planned', l.rate, l.miles, p_pickup, p_delivery, l.pickup_lat, l.pickup_lng, l.delivery_lat, l.delivery_lng,
          w.carrier_user, v_drv.id, v_drv.name, v_drv.phone, v_truck, 'TRAIN-1', true, 'app', now(), 'appointment', true)
  returning id into v_trip;
  foreach s in array (case p_to when 'planned' then array[]::text[]
                                when 'dispatched' then array['dispatched']
                                when 'in_transit' then array['dispatched','in_transit']
                                when 'delivered' then array['dispatched','in_transit','delivered']
                                when 'invoiced' then array['dispatched','in_transit','delivered'] end) loop
    update app_private.trips set status = s,
           dispatched_at = case when s = 'dispatched' then p_pickup else dispatched_at end,
           started_at    = case when s = 'dispatched' then p_pickup - interval '90 minutes' else started_at end,
           delivered_at  = case when s = 'delivered' then p_delivery else delivered_at end
     where id = v_trip;
  end loop;
  return v_trip;
end $fn$;

-- Loads, offers, trips in every state a carrier can see (PART A §5).
create or replace function app_private.training_fill_loads(p_world uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare
  w app_private.training_worlds; v_staff uuid; v_disp uuid; v_by uuid; v_rc text;
  v_board uuid[] := '{}'; v_l uuid; v_t uuid;
  v_offer uuid; v_offer_l uuid; v_decl uuid; v_decl_l uuid; v_exp uuid; v_exp_l uuid;
  v_up_l uuid; v_up_t uuid; v_rd_l uuid; v_rd_t uuid; v_it_l uuid; v_it_t uuid; v_dl_l uuid; v_dl_t uuid; v_cp_l uuid; v_cp_t uuid;
  v_inv uuid; v_today date := (now() at time zone 'America/Chicago')::date;
  v_ct timestamptz := date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago';  -- today 00:00 Central
begin
  select * into w from app_private.training_worlds where id = p_world;
  perform set_config('lb.training_ctx', 'on', true);
  v_staff := app_private.training_act_as_staff();
  v_disp := (select a.dispatcher_user_id from app_private.dispatcher_assignments a where a.carrier_org_id = w.carrier_org and a.status = 'active' limit 1);
  v_by := coalesce(v_disp, v_staff);

  -- a. Board: matching lane, partial, hotshot, one above the floor, one below it
  v_board := v_board || app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Dallas, TX','d','Houston, TX','of','Dallas, TX 75207','df','Houston, TX 77029','mi',239,'rate',650,
    'com','Auto parts — 6 boxed cartons','wt','1,900 lbs','req','Dock pickup · Liftgate not needed · Call 30 min out',
    'plat',32.7884,'plng',-96.8233,'dlat',29.7602,'dlng',-95.2696,'pday',1,'dday',1,'pt','07:00–09:00','dt','13:00–16:00'));
  v_board := v_board || app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Fort Worth, TX','d','Austin, TX','of','Fort Worth, TX 76106','df','Austin, TX 78744','mi',195,'rate',420,'size','partial',
    'com','PARTIAL — 2 pallets medical supplies (co-load)','wt','1,800 lbs','req','Partial · 2 pallet positions · No touch',
    'plat',32.8090,'plng',-97.3406,'dlat',30.1866,'dlng',-97.7328,'pday',1,'dday',1));
  v_board := v_board || app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Dallas, TX','d','Shreveport, LA','of','Dallas, TX 75212','df','Shreveport, LA 71106','mi',189,'rate',700,'eq','Hotshot',
    'com','Steel pipe — 24 ft lengths','wt','9,500 lbs','req','HOTSHOT ONLY — gooseneck/flatbed, straps + chains. A Sprinter cannot take this load.',
    'plat',32.7766,'plng',-96.8846,'dlat',32.4570,'dlng',-93.7437,'pday',2,'dday',2));
  v_board := v_board || app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Dallas, TX','d','Little Rock, AR','of','Dallas, TX 75247','df','Little Rock, AR 72206','mi',319,'rate',930,
    'com','Expedited electronics — 4 crates','wt','2,400 lbs','req','Expedite · Team not needed · Above your $2.00/mi floor ($2.92/mi)',
    'plat',32.8165,'plng',-96.8800,'dlat',34.7004,'dlng',-92.2654,'pday',2,'dday',2));
  v_board := v_board || app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Dallas, TX','d','Oklahoma City, OK','of','Dallas, TX 75229','df','Oklahoma City, OK 73129','mi',206,'rate',340,
    'com','Retail returns — 10 cartons','wt','1,200 lbs','req','BELOW your $2.00/mi floor ($1.65/mi) — counter or pass',
    'plat',32.8930,'plng',-96.8930,'dlat',35.4300,'dlng',-97.4800,'pday',3,'dday',3));
  v_board := v_board || app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Garland, TX','d','San Antonio, TX','of','Garland, TX 75041','df','San Antonio, TX 78219','mi',285,'rate',760,
    'com','HVAC parts — 3 pallets','wt','2,700 lbs','req','Appointment delivery · Load bars required',
    'plat',32.8960,'plng',-96.6450,'dlat',29.4520,'dlng',-98.4280,'pday',4,'dday',4));

  -- b. Dispatcher offer, pending (Accept / Decline)
  v_offer_l := app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Irving, TX','d','Tulsa, OK','of','Irving, TX 75038','df','Tulsa, OK 74107','mi',258,'rate',720,
    'com','Pharma (ambient) — 5 cases','wt','600 lbs','req','Hot load · Driver must sign chain-of-custody',
    'plat',32.8640,'plng',-96.9640,'dlat',36.1250,'dlng',-96.0270,'pday',1,'dday',1,'pt','10:00–12:00','dt','16:00–18:00'));
  insert into app_private.load_offers (load_id, carrier_id, offered_rate, deadhead, score, status, sent_at, expiry_at, message, created_by, load_version)
  values (v_offer_l, w.carrier_org, 720, 12, 92, 'sent', now(), now() + interval '3 days',
          'From your dispatcher: Irving → Tulsa tomorrow, $720 ($2.79/mi) on your OK lane. Accept if the van is free — I lock it with the broker.', v_by,
          (select version from public.loads where id = v_offer_l))
  returning id into v_offer;

  -- c. One declined, one expired
  v_decl_l := app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Dallas, TX','d','El Paso, TX','of','Dallas, TX 75235','df','El Paso, TX 79927','mi',635,'rate',980,'status','booked',
    'com','Furniture — blanket wrap','wt','2,900 lbs','req','Blanket wrap',
    'plat',32.8270,'plng',-96.8400,'dlat',31.7760,'dlng',-106.4240,'pday',1,'dday',2));
  update public.loads set assigned_to = null where id = v_decl_l;
  insert into app_private.load_offers (load_id, carrier_id, offered_rate, deadhead, score, status, sent_at, expiry_at, responded_at, decline_reason, message, created_by)
  values (v_decl_l, w.carrier_org, 980, 10, 61, 'declined', now() - interval '1 day', now() - interval '23 hours', now() - interval '23 hours 40 minutes',
          'Rate below my floor — $1.54/mi and no reload out of El Paso', 'From your dispatcher: long run to El Paso, $980. Your call.', v_by);
  v_exp_l := app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Plano, TX','d','Waco, TX','of','Plano, TX 75074','df','Waco, TX 76705','mi',125,'rate',380,'status','booked',
    'com','Office supplies — 12 cartons','wt','800 lbs','req','Residential-adjacent delivery',
    'plat',33.0198,'plng',-96.6989,'dlat',31.6100,'dlng',-97.1100,'pday',0,'dday',0));
  update public.loads set assigned_to = null where id = v_exp_l;
  insert into app_private.load_offers (load_id, carrier_id, offered_rate, deadhead, score, status, sent_at, expiry_at, message, created_by)
  values (v_exp_l, w.carrier_org, 380, 18, 74, 'expired', now() - interval '2 days', now() - interval '2 days' + interval '30 minutes',
          'From your dispatcher: quick Plano → Waco, $380. 30 minutes to answer.', v_by);

  -- d. Booked upcoming, rate confirmation ready (My Loads → Upcoming)
  v_up_l := app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Dallas, TX','d','Memphis, TN','of','Dallas, TX 75261','df','Memphis, TN 38118','mi',452,'rate',1180,'status','booked',
    'com','E-commerce parcels — 40 boxes','wt','2,200 lbs','req','Appointment both ends · Scan every box at pickup',
    'plat',32.8998,'plng',-97.0403,'dlat',35.0420,'dlng',-89.9790,'pday',3,'dday',4,'pt','09:00','dt','08:00'));
  v_up_t := app_private.training_mk_trip(p_world, v_up_l, 'planned', v_ct + interval '3 days 9 hours', v_ct + interval '4 days 8 hours');

  -- e. Ready to start (pickup today) — the trainee presses "Start your trip"
  v_rd_l := app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Dallas, TX','d','Fort Worth, TX','of','Dallas, TX 75201','df','Fort Worth, TX 76102','mi',32,'rate',185,'status','booked',
    'com','Catering equipment — 8 cases','wt','700 lbs','req','Same-day · Call consignee 15 min out',
    'plat',32.7876,'plng',-96.7985,'dlat',32.7555,'dlng',-97.3308,'pday',0,'dday',0,'pt','ASAP','dt','by 18:00'));
  v_rd_t := app_private.training_mk_trip(p_world, v_rd_l, 'planned', now() + interval '1 hour', now() + interval '4 hours');
  update app_private.rate_confirmations set acknowledged_by = w.carrier_user, acknowledged_at = now() - interval '2 hours' where trip_id = v_rd_t;

  -- f. In transit, with check calls / tracking points
  v_it_l := app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Dallas, TX','d','Houston, TX','of','Dallas, TX 75220','df','Houston, TX 77032','mi',245,'rate',640,'status','booked',
    'com','Industrial fasteners — 2 pallets','wt','2,100 lbs','req','Deliver by 17:00 · POD with printed name',
    'plat',32.8640,'plng',-96.8730,'dlat',29.9500,'dlng',-95.3300,'pday',0,'dday',0,'pt','06:00–08:00','dt','by 17:00'));
  v_it_t := app_private.training_mk_trip(p_world, v_it_l, 'in_transit', now() - interval '3 hours', now() + interval '2 hours');
  update app_private.rate_confirmations set acknowledged_by = w.carrier_user, acknowledged_at = now() - interval '5 hours' where trip_id = v_it_t;
  insert into app_private.trip_dwell_events (trip_id, stop_type, arrived_at, departed_at, free_minutes, created_by, lat, lng, distance_m)
  values (v_it_t, 'pickup', now() - interval '3 hours 40 minutes', now() - interval '3 hours', 120, w.carrier_user, 32.8641, -96.8731, 35);
  insert into app_private.trip_locations (trip_id, lat, lng, label, source, created_at, accuracy_m, note, created_by) values
    (v_it_t, 32.8641, -96.8731, 'Pickup — Dallas, TX', 'pocket_gps', now() - interval '3 hours 40 minutes', 12, null, w.carrier_user),
    (v_it_t, 32.4870, -96.6890, 'I-45 S near Ennis, TX', 'pocket_gps', now() - interval '2 hours 30 minutes', 15, null, w.carrier_user),
    (v_it_t, 31.9690, -96.4650, 'I-45 S near Corsicana, TX', 'manual_checkin', now() - interval '2 hours', 20, 'Check call: rolling, on time, ETA 15:30', w.carrier_user),
    (v_it_t, 31.4670, -96.0610, 'I-45 S near Buffalo, TX', 'pocket_gps', now() - interval '1 hour 15 minutes', 15, null, w.carrier_user),
    (v_it_t, 30.9900, -95.9100, 'I-45 S near Madisonville, TX', 'manual_checkin', now() - interval '35 minutes', 25, 'Check call: fuel stop done, 95 mi out, ETA 15:20', w.carrier_user),
    (v_it_t, 30.7240, -95.5510, 'I-45 S near Huntsville, TX', 'pocket_gps', now() - interval '10 minutes', 12, null, w.carrier_user);
  update app_private.trips set last_lat = 30.7240, last_lng = -95.5510, last_loc_at = now() - interval '10 minutes' where id = v_it_t;

  -- g. Delivered, waiting for the POD upload
  v_dl_l := app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Arlington, TX','d','Lubbock, TX','of','Arlington, TX 76011','df','Lubbock, TX 79403','mi',318,'rate',840,'status','booked',
    'com','Restaurant equipment — 1 pallet','wt','1,400 lbs','req','POD required within 48 h of delivery',
    'plat',32.7357,'plng',-97.1081,'dlat',33.5900,'dlng',-101.8200,'pday',-1,'dday',-1));
  v_dl_t := app_private.training_mk_trip(p_world, v_dl_l, 'delivered', now() - interval '1 day 8 hours', now() - interval '20 hours');
  insert into app_private.trip_dwell_events (trip_id, stop_type, arrived_at, departed_at, free_minutes, created_by, lat, lng, distance_m) values
    (v_dl_t, 'pickup',   now() - interval '1 day 8 hours 30 minutes', now() - interval '1 day 8 hours', 120, w.carrier_user, 32.7358, -97.1082, 40),
    (v_dl_t, 'delivery', now() - interval '20 hours 30 minutes',      now() - interval '20 hours',      120, w.carrier_user, 33.5901, -101.8201, 55);

  -- h. Completed with detention; LoadBoot fee = 5% of line-haul only, own invoice, Net-30
  v_cp_l := app_private.training_mk_load(p_world, jsonb_build_object(
    'o','Dallas, TX','d','San Antonio, TX','of','Dallas, TX 75236','df','San Antonio, TX 78218','mi',274,'rate',2000,'status','booked',
    'com','Trade-show displays — hot expedite','wt','3,100 lbs','req','Expedite · Detention $40/hr after 2 h free',
    'plat',32.6900,'plng',-96.9200,'dlat',29.4900,'dlng',-98.4000,'pday',-6,'dday',-6));
  v_cp_t := app_private.training_mk_trip(p_world, v_cp_l, 'delivered', now() - interval '6 days 10 hours', now() - interval '6 days 2 hours');
  insert into app_private.trip_dwell_events (trip_id, stop_type, arrived_at, departed_at, free_minutes, created_by, lat, lng, distance_m) values
    (v_cp_t, 'pickup',   now() - interval '6 days 10 hours 30 minutes', now() - interval '6 days 10 hours', 120, w.carrier_user, 32.6901, -96.9201, 30),
    (v_cp_t, 'delivery', now() - interval '6 days 6 hours',             now() - interval '6 days 2 hours',  120, w.carrier_user, 29.4901, -98.4001, 45);
  insert into app_private.document_files (owner_type, owner_id, kind, bucket, path, file_name, content_type, size_bytes, uploaded_by, status, review_note, reviewed_at, reviewed_by)
  values ('trip', v_cp_t::text, 'pod', 'documents', w.carrier_user::text || '/pod/' || v_cp_t::text || '/training-pod.pdf', 'TRAINING-SAMPLE-POD.pdf',
          'application/pdf', 4096, w.carrier_user, 'approved', 'TRAINING SAMPLE — NOT A REAL DOCUMENT', now() - interval '5 days', v_staff);
  insert into app_private.trip_accessorials (trip_id, kind, amount, billable, note, created_by, created_at, status, evidence, decided_by, decided_at,
                                             decision_note, broker_status, broker_decided_at, support_status)
  values (v_cp_t, 'detention', 80, true, 'Detention at delivery: 4 h on site, 2 h free → 2 h × $40', w.carrier_user, now() - interval '6 days',
          'approved', jsonb_build_object('gps_dwell_minutes', 240, 'free_minutes', 120, 'rate_per_hr', 40, 'training', true), v_staff, now() - interval '5 days',
          'GPS dwell verified (training)', 'approved', now() - interval '5 days', 'none');
  select id into v_inv from app_private.fin_invoices where trip_id = v_cp_t and status <> 'void' order by created_at desc limit 1;
  if v_inv is null then  -- auto_invoice_on_delivery did not fire (should not happen) — create it the way it does
    insert into app_private.fin_invoices (invoice_no, carrier_id, load_id, trip_id, gross, fee_pct, fee, net, status, issued_at, due_at, created_by)
    values ('TRN-' || to_char(now(), 'YYYY') || '-' || left(replace(v_cp_t::text, '-', ''), 6), w.carrier_org, v_cp_l, v_cp_t, 2000, 5, 100, 1900, 'sent',
            now() - interval '6 days 2 hours', null, v_staff)
    returning id into v_inv;
    perform app_private.apply_accessorial_to_invoice(a.id) from app_private.trip_accessorials a where a.trip_id = v_cp_t;
  end if;
  update app_private.fin_invoices set status = 'sent', issued_at = now() - interval '6 days 2 hours',
         due_at = ((now() - interval '6 days 2 hours') at time zone 'America/Chicago')::date + 30,
         sent_at = now() - interval '6 days 2 hours' where id = v_inv;
  update app_private.trips set status = 'invoiced' where id = v_cp_t;
  update public.loads set status = 'delivered' where id = v_cp_l;

  -- The dispatcher's side: bookings for the upcoming + ready loads, and a thread
  if v_disp is not null then
    insert into app_private.dispatcher_bookings (dispatcher_user_id, carrier_org_id, truck_id, load_id, trip_id, broker, broker_mc, broker_rep, broker_phone,
        origin, destination, pickup_at, delivery_at, miles, deadhead, gross, commodity, weight_lbs, equipment, rc_number, rc_received_at, status,
        below_min, approved_by, approved_at, decision_note, notes, source)
    select v_disp, w.carrier_org, t.truck_id, l.id, t.id, l.broker, (select mc_number from public.organizations where id = w.broker_org),
           'Training Broker Desk', '+12145550188', l.origin, l.destination, t.scheduled_pickup, t.scheduled_delivery, l.miles, l.deadhead, l.rate,
           l.commodity, nullif(regexp_replace(coalesce(l.weight, ''), '[^0-9]', '', 'g'), '')::int, l.equipment, 'LB-' || left(l.id::text, 8), now() - interval '1 day',
           'approved', false, v_staff, now() - interval '20 hours', 'TRAINING — approved by training_seed', 'Booked by your dispatcher on the LoadBoot board (training)', 'loadboot'
      from public.loads l join app_private.trips t on t.load_id = l.id
     where l.id in (v_up_l, v_rd_l);
    insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_user, sender_role, body, created_at)
    select a.id, w.carrier_org, v_disp, 'dispatcher', m.body, now() - m.ago
      from app_private.dispatcher_assignments a,
           (values ('Hi — I am your dispatcher for this training carrier. I booked Dallas → Memphis for Thursday and a short Dallas → Fort Worth for today.', interval '20 hours'),
                   ('Sent you a load request: Irving → Tulsa tomorrow, $720. Accept or decline it on the Load Board.', interval '2 hours')) m(body, ago)
     where a.carrier_org_id = w.carrier_org and a.status = 'active';
  end if;

  return jsonb_build_object(
    'board', to_jsonb(v_board),
    'offer_pending', jsonb_build_object('offer', v_offer, 'load', v_offer_l),
    'offer_declined', jsonb_build_object('offer', (select id from app_private.load_offers where load_id = v_decl_l and carrier_id = w.carrier_org), 'load', v_decl_l),
    'offer_expired', jsonb_build_object('offer', (select id from app_private.load_offers where load_id = v_exp_l and carrier_id = w.carrier_org), 'load', v_exp_l),
    'upcoming', jsonb_build_object('load', v_up_l, 'trip', v_up_t),
    'ready_to_start', jsonb_build_object('load', v_rd_l, 'trip', v_rd_t),
    'in_transit', jsonb_build_object('load', v_it_l, 'trip', v_it_t),
    'delivered_needs_pod', jsonb_build_object('load', v_dl_l, 'trip', v_dl_t),
    'completed', jsonb_build_object('load', v_cp_l, 'trip', v_cp_t, 'fee_invoice', v_inv,
                                    'invoice', (select jsonb_build_object('invoice_no', invoice_no, 'gross', gross, 'fee_pct', fee_pct, 'fee', fee, 'net', net, 'status', status, 'due_at', due_at)
                                                  from app_private.fin_invoices where id = v_inv)));
end $fn$;

-- Remove a world's loads / trips / offers / bookings (org, users, compliance and the assignment stay).
create or replace function app_private.training_wipe(p_world uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare w app_private.training_worlds; v_loads uuid[]; v_trips uuid[]; n_l int; n_t int;
begin
  select * into w from app_private.training_worlds where id = p_world;
  if w.id is null then raise exception 'training: world % not found', p_world; end if;
  perform set_config('lb.training_ctx', 'on', true);
  select coalesce(array_agg(id), '{}') into v_loads from public.loads where broker_org = w.broker_org or shipper_org = w.broker_org;
  select coalesce(array_agg(id), '{}') into v_trips from app_private.trips where carrier_id = w.carrier_org or load_id = any(v_loads);
  delete from app_private.document_files where owner_type = 'trip' and owner_id = any(select unnest(v_trips)::text);
  delete from app_private.rate_confirmations where trip_id = any(v_trips);
  delete from app_private.fin_invoices where carrier_id = w.carrier_org or trip_id = any(v_trips) or load_id = any(v_loads);
  delete from app_private.fin_settlements where carrier_id = w.carrier_org;
  delete from public.settlements where load_id = any(v_loads);
  delete from app_private.dispatcher_bookings where carrier_org_id = w.carrier_org;
  delete from app_private.load_offers where carrier_id = w.carrier_org or load_id = any(v_loads);
  delete from app_private.load_book_requests where carrier_org = w.carrier_org or load_id = any(v_loads);
  delete from app_private.load_document_checklist where subject_id = any(v_loads) or subject_id = any(v_trips);
  delete from app_private.load_rate_agreements where subject_id = any(v_loads) or subject_id = any(v_trips);
  delete from app_private.trips where id = any(v_trips);
  get diagnostics n_t = row_count;
  delete from public.loads where id = any(v_loads);
  get diagnostics n_l = row_count;
  delete from app_private.notifications where recipient_user = w.carrier_user;
  -- the dispatcher thread restarts from the seeded messages (assignment itself is kept)
  delete from app_private.dispatcher_messages where carrier_org_id = w.carrier_org and sender_role <> 'system';
  return jsonb_build_object('loads_removed', n_l, 'trips_removed', n_t);
end $fn$;

create or replace function app_private.training_seed(p_email text, p_label text, p_dispatcher uuid default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public, extensions' as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_pw text; v_uid uuid := gen_random_uuid(); v_buid uuid := gen_random_uuid(); v_bemail text;
  v_org uuid; v_borg uuid; v_world uuid; v_staff uuid; v_name text; v_bname text;
  v_mc text; v_dot text; v_bmc text; v_phone text; v_assign jsonb; v_fill jsonb; v_loads jsonb; i int := 0;
begin
  if auth.uid() is not null and not public.is_active_staff() then raise exception 'training_seed: staff only' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'training_seed: a valid email address is required'; end if;
  if v_label is null then raise exception 'training_seed: a label is required (e.g. the trainee''s first name)'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'training_seed: % already has a LoadBoot login. Use a NEW address for the training carrier (never the dispatcher''s own login), e.g. name+training@…', v_email;
  end if;
  perform set_config('lb.training_ctx', 'on', true);

  v_name  := 'LOADBOOT TRAINING CARRIER — ' || v_label;
  v_bname := 'DEMO BROKER — Training (' || v_label || ')';
  v_bemail := 'training.broker.' || left(replace(v_buid::text, '-', ''), 10) || '@training.loadboot.invalid';
  -- Fake numbers outside every range FMCSA has issued (MC < 2,000,000, USDOT < 5,000,000 today)
  loop
    v_mc  := (9000000 + floor(random() * 900000))::int::text;
    v_dot := (99000000 + floor(random() * 900000))::int::text;
    v_bmc := (9100000 + floor(random() * 800000))::int::text;
    exit when not exists (select 1 from public.organizations where mc_number in (v_mc, v_bmc) or dot_number = v_dot)
          and not exists (select 1 from public.profiles where mc in (v_mc, v_bmc) or dot = v_dot);
  end loop;
  -- 555-0100…0199 is reserved for fiction in the North American Numbering Plan: it never rings anyone.
  loop
    i := i + 1;
    v_phone := '+1214555' || lpad((100 + floor(random() * 99))::int::text, 4, '0');
    exit when not exists (select 1 from app_private.training_worlds where phone = v_phone) or i > 200;
  end loop;
  v_pw := 'Lb-' || translate(encode(extensions.gen_random_bytes(15), 'base64'), '+/=', 'KzQ') || '-7t';

  -- Auth users (handle_new_user creates the carrier profile + org + owner membership, as on a real signup)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
          extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('company', v_name, 'name', 'Training Owner — ' || v_label, 'training', true),
          now(), now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', null, now(), now());
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', v_buid, 'authenticated', 'authenticated', v_bemail,
          extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('company', v_bname, 'name', 'Training Broker Desk', 'partner_kind', 'broker', 'training', true),
          now(), now(), '', '', '', '', '', '', '', '', false, false);

  select id into v_org from public.organizations where owner_user_id = v_uid and kind = 'carrier' limit 1;
  if v_org is null then
    insert into public.organizations (kind, name, owner_user_id, status, is_demo) values ('carrier', v_name, v_uid, 'active', true) returning id into v_org;
    insert into public.organization_memberships (org_id, user_id, member_role, status) values (v_org, v_uid, 'owner', 'active');
  end if;
  update public.organizations set name = v_name, is_demo = true, status = 'active', broker_visible = true, mc_number = v_mc, dot_number = v_dot where id = v_org;

  insert into public.organizations (kind, name, owner_user_id, status, is_demo, mc_number, broker_visible)
  values ('broker', v_bname, v_buid, 'active', true, v_bmc, false) returning id into v_borg;
  insert into public.organization_memberships (org_id, user_id, member_role, status) values (v_borg, v_buid, 'owner', 'active')
  on conflict (org_id, user_id) do nothing;
  update public.profiles set company = v_bname, contact_name = 'Training Broker Desk', status = 'active' where id = v_buid;

  insert into app_private.training_worlds (label, carrier_org, broker_org, carrier_user, broker_user, carrier_email, phone, created_by)
  values (v_label, v_org, v_borg, v_uid, v_buid, v_email, v_phone, auth.uid())
  returning id into v_world;

  v_staff := app_private.training_act_as_staff();

  -- Broker: verified packet (nothing reviewed — same note pattern as bl_demo_0217)
  insert into app_private.partner_profiles (org_id, contact_name, phone, email, address)
  values (v_borg, 'Training Broker Desk', '+12145550188', v_bemail, '200 Demo Plaza, Dallas, TX 75201 (NOT A REAL ADDRESS)')
  on conflict (org_id) do nothing;
  insert into app_private.org_onboarding_items (org_id, item_key, status, note, reviewed_at, reviewed_by)
  select v_borg, t.item_key, 'verified', 'TRAINING BROKER — demo only. No document was submitted or reviewed.', now(), v_staff
    from app_private.onboarding_packet_templates t where t.org_kind = 'broker'
  on conflict (org_id, item_key) do update set status = 'verified', note = excluded.note, reviewed_at = now();

  v_fill := app_private.training_fill_carrier(v_world);

  -- Dispatcher link through the real assignment RPC (thread, notices, capacity rules)
  if p_dispatcher is not null then
    v_assign := public.cc_dispatcher_assign(p_dispatcher, v_org,
      jsonb_build_object('note', 'TRAINING CARRIER — practice only. Nothing here is real.', 'training', true));
    if v_assign ? 'error' then raise exception 'training_seed: dispatcher assignment failed: %', v_assign->>'error'; end if;
    update app_private.training_worlds set dispatcher_user = p_dispatcher where id = v_world;
  end if;

  v_loads := app_private.training_fill_loads(v_world);
  update app_private.training_worlds set last_seed = jsonb_build_object('at', now(), 'carrier', v_fill, 'loads', v_loads) where id = v_world;

  return jsonb_build_object(
    'world', v_world, 'label', v_label,
    'login', jsonb_build_object('email', v_email, 'password', v_pw, 'portal', 'https://loadboot.com/app/carrier/',
                                'note', 'Shown ONCE. It is not stored anywhere — copy it now.'),
    'carrier_org', v_org, 'carrier_user', v_uid, 'org_name', v_name, 'mc', v_mc, 'dot', v_dot, 'phone', v_phone, 'vin', v_fill->>'vin',
    'broker_org', v_borg, 'broker_user', v_buid, 'broker_name', v_bname,
    'dispatcher', p_dispatcher, 'assignment', v_assign->'assignment',
    'loads', v_loads,
    'sample_upload', jsonb_build_object('documents_bucket_prefix', v_uid::text || '/training/', 'pod_path',
                                        (v_loads #>> '{completed,trip}')));
end $fn$;

create or replace function app_private.training_reset(p_org uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare w app_private.training_worlds; v_wipe jsonb; v_fill jsonb; v_loads jsonb;
begin
  if auth.uid() is not null and not public.is_active_staff() then raise exception 'training_reset: staff only' using errcode = '42501'; end if;
  select * into w from app_private.training_worlds where carrier_org = p_org;
  if w.id is null then raise exception 'training_reset: % is not a training carrier (only orgs created by training_seed can be reset)', p_org; end if;
  perform set_config('lb.training_ctx', 'on', true);
  v_wipe  := app_private.training_wipe(w.id);
  v_fill  := app_private.training_fill_carrier(w.id);
  v_loads := app_private.training_fill_loads(w.id);
  update app_private.training_worlds set reset_at = now(), reset_by = auth.uid(),
         last_seed = jsonb_build_object('at', now(), 'carrier', v_fill, 'loads', v_loads) where id = w.id;
  return jsonb_build_object('world', w.id, 'carrier_org', w.carrier_org, 'wiped', v_wipe, 'loads', v_loads);
end $fn$;

do $rv$ declare f text; begin
  foreach f in array array['app_private.training_act_as_staff()','app_private.training_fill_carrier(uuid)',
    'app_private.training_mk_load(uuid,jsonb)','app_private.training_mk_trip(uuid,uuid,text,timestamptz,timestamptz)',
    'app_private.training_fill_loads(uuid)','app_private.training_wipe(uuid)','app_private.training_seed(text,text,uuid)',
    'app_private.training_reset(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $rv$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- §8  Command Center + UI RPCs (authenticated only — never anon)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.cc_training_worlds()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $fn$
begin
  if not public.is_active_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'world', w.id, 'label', w.label, 'carrier_org', w.carrier_org, 'org_name', o.name, 'login_email', w.carrier_email,
      'broker_org', w.broker_org, 'dispatcher', w.dispatcher_user,
      'dispatcher_name', (select full_name from app_private.dispatcher_profiles where user_id = (select a.dispatcher_user_id from app_private.dispatcher_assignments a where a.carrier_org_id = w.carrier_org and a.status = 'active' limit 1)),
      'created_at', w.created_at, 'reset_at', w.reset_at,
      'blocked_sends_7d', (select count(*) from app_private.training_blocked_log b where b.created_at > now() - interval '7 days')) order by w.created_at)
    from app_private.training_worlds w join public.organizations o on o.id = w.carrier_org), '[]'::jsonb);
end $fn$;

create or replace function public.cc_training_seed(p_email text, p_label text, p_dispatcher uuid default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $fn$
begin
  if not public.is_active_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  return app_private.training_seed(p_email, p_label, p_dispatcher);
end $fn$;

create or replace function public.cc_training_reset(p_org uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $fn$
begin
  if not public.is_active_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  return app_private.training_reset(p_org);
end $fn$;

-- Hand a training carrier to the next trainee's dispatcher account (ends the current assignment).
-- app_private.* is for the SQL Editor (acts as staff, like training_seed); the public one is the CC button.
create or replace function app_private.training_set_dispatcher(p_org uuid, p_dispatcher uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $fn$
declare w app_private.training_worlds; v jsonb;
begin
  if auth.uid() is not null and not public.is_active_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  select * into w from app_private.training_worlds where carrier_org = p_org;
  if w.id is null then raise exception '% is not a training carrier', p_org; end if;
  perform set_config('lb.training_ctx', 'on', true);
  perform app_private.training_act_as_staff();
  update app_private.dispatcher_assignments set status = 'ended', ended_at = now(), end_reason = 'training: handed to the next trainee', updated_at = now()
   where carrier_org_id = p_org and status in ('active','paused');
  v := public.cc_dispatcher_assign(p_dispatcher, p_org, jsonb_build_object('note', 'TRAINING CARRIER — practice only. Nothing here is real.', 'training', true));
  if v ? 'error' then raise exception 'assignment failed: %', v->>'error'; end if;
  update app_private.training_worlds set dispatcher_user = p_dispatcher where id = w.id;
  return v;
end $fn$;
revoke all on function app_private.training_set_dispatcher(uuid, uuid) from public, anon, authenticated;

create or replace function public.cc_training_set_dispatcher(p_org uuid, p_dispatcher uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $fn$
begin
  if not public.is_active_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  return app_private.training_set_dispatcher(p_org, p_dispatcher);
end $fn$;

-- UI: is this session (or the carrier the dispatcher has open) a demo / training account?
create or replace function public.cc_session_demo_state(p_org uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $fn$
declare v_demo boolean := app_private.session_is_demo(); v_world uuid := app_private.training_world_of_session();
begin
  if auth.uid() is null then return jsonb_build_object('is_demo', false); end if;
  return jsonb_build_object(
    'is_demo', v_demo,
    'training', v_world is not null,
    'label', (select label from app_private.training_worlds where id = v_world),
    -- carriers this dispatcher works that are demo (the workspace shows the banner when one is selected)
    'demo_orgs', coalesce((select jsonb_agg(a.carrier_org_id) from app_private.dispatcher_assignments a
                            join public.organizations o on o.id = a.carrier_org_id
                           where a.dispatcher_user_id = auth.uid() and a.status in ('active','paused') and o.is_demo), '[]'::jsonb),
    'org_is_demo', case when p_org is null then null
                        when exists (select 1 from app_private.dispatcher_assignments a where a.carrier_org_id = p_org and a.dispatcher_user_id = auth.uid())
                          or app_private.disp_is_carrier_member(p_org) or public.is_active_staff()
                        then app_private.is_demo_org(p_org) end);
end $fn$;

revoke all on function public.cc_training_worlds() from public, anon;
revoke all on function public.cc_training_seed(text, text, uuid) from public, anon;
revoke all on function public.cc_training_reset(uuid) from public, anon;
revoke all on function public.cc_training_set_dispatcher(uuid, uuid) from public, anon;
revoke all on function public.cc_session_demo_state(uuid) from public, anon;
grant execute on function public.cc_training_worlds() to authenticated;
grant execute on function public.cc_training_seed(text, text, uuid) to authenticated;
grant execute on function public.cc_training_reset(uuid) to authenticated;
grant execute on function public.cc_training_set_dispatcher(uuid, uuid) to authenticated;
grant execute on function public.cc_session_demo_state(uuid) to authenticated;
