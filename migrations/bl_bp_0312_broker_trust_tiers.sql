-- bl_bp_0312 — Broker tiered trust: post in minutes on a live FMCSA authority check,
-- documents move to the point where they matter (first booking / first payment).
--
-- WHY (2 Sep 2026 audit): no real broker has ever posted a load. Portal posting was
-- hard-gated on an 8-document packet + human review; even LoadBoot's own agents could
-- not post. Meanwhile the strongest anti-fraud signal — FMCSA L&I broker authority
-- (which FMCSA only keeps ACTIVE while a $75k BMC-84/85 is on file) — was already being
-- fetched by fmcsa-verify and never used as a gate.
--
-- WHAT:
--   app_private.broker_screenings   one row per org: the server-side FMCSA screen (pg_net → fmcsa-verify)
--   app_private.broker_trust        facts: agent-under-parent, parent confirmation, staff hold
--   app_private.broker_tier(org)    DERIVED, never stored: verified | screened | agent_confirmed |
--                                   agent_pending | hold | new   (self-heals the moment facts change)
--   app_private.broker_can_post()   the ONE posting rule (limits: 3 active until first delivery, 10
--                                   until verified, unlimited when the packet is verified)
--   loads trigger                   loads from a not-yet-verified brokerage carry verification_state
--                                   'partial' + details.source_notice; they book ONLY through
--                                   request-to-book or a broker-sent offer — never instant.
--   agent-under-parent              agent declares parent MC → parent screened → one-click confirm
--                                   email to the FMCSA-listed address (falls back to agent-supplied
--                                   address + staff approve) → anon-by-token confirm page.
--   cc_partner_submit_load          string-surgery: org.status='active' check → assert_broker_can_post
--   cc_partner_set_status           string-surgery: park/approve also hold/release trust
--   enforce_partner_onboarded       now delegates to broker_can_post (keeps the api_client bypass)
--
-- SCHEMA-AGNOSTIC: staging lacks bl_soft_0279–0284 (no partner_loads.verification_state, no
-- enforce_unverified_source_not_bookable) and bl_auth (no fmcsa_config / authority_checks /
-- org_docket). Everything here creates what it needs and touches nothing it does not own.
--
-- STAGING FIRST. Prod only on Yaseen's OK.

-- ---------------------------------------------------------------------------
-- 0. prerequisites that prod has and staging may not
-- ---------------------------------------------------------------------------
-- organizations.mc_number / dot_number exist on prod since bl_ob_0286; staging lacked them (found 2 Sep).
alter table public.organizations add column if not exists mc_number text;
alter table public.organizations add column if not exists dot_number text;

create table if not exists app_private.fmcsa_config (
  id boolean primary key default true check (id),
  function_url text not null,
  auth_key text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1. tables
-- ---------------------------------------------------------------------------
create table if not exists app_private.broker_screenings (
  org_id            uuid primary key references public.organizations(id) on delete cascade,
  mc_number         text,
  dot_number        text,
  request_id        bigint,
  requested_at      timestamptz,
  checked_at        timestamptz,
  outcome           text not null default 'pending'
                    check (outcome in ('pending','pass','fail','unknown','not_found','error')),
  broker_authority  boolean,
  carrier_authority boolean,
  legal_name        text,
  entity_type       text,
  phone             text,
  fmcsa_email       text,
  domain_match      boolean,
  authority_source  text,
  safer_text        text,
  reason            text,
  attempts          int not null default 0,
  raw               jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists broker_screenings_pending_idx
  on app_private.broker_screenings (requested_at) where request_id is not null;

create table if not exists app_private.broker_trust (
  org_id                 uuid primary key references public.organizations(id) on delete cascade,
  is_agent               boolean not null default false,
  parent_mc              text,
  parent_legal_name      text,
  parent_contact_email   text,
  parent_contact_source  text check (parent_contact_source in ('fmcsa','agent_supplied','staff')),
  parent_confirm_token   uuid,
  parent_confirm_sent_at timestamptz,
  parent_reminded_at     timestamptz,
  parent_confirmed_at    timestamptz,
  parent_confirmed_by    text,
  parent_declined_at     timestamptz,
  parent_note            text,
  hold_reason            text,
  held_at                timestamptz,
  posting_limit_override int,
  updated_at             timestamptz not null default now()
);
create unique index if not exists broker_trust_confirm_token_idx
  on app_private.broker_trust (parent_confirm_token) where parent_confirm_token is not null;

-- ---------------------------------------------------------------------------
-- 2. derived tier + the single posting rule
-- ---------------------------------------------------------------------------
create or replace function app_private.broker_tier(p_org uuid)
returns text
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare t app_private.broker_trust; s app_private.broker_screenings; v_kind text;
begin
  select kind into v_kind from public.organizations where id = p_org;
  if v_kind is null then return 'new'; end if;
  select * into t from app_private.broker_trust where org_id = p_org;
  if t.org_id is not null and t.hold_reason is not null then return 'hold'; end if;
  if app_private.org_onboarding_complete(p_org) then return 'verified'; end if;
  select * into s from app_private.broker_screenings where org_id = p_org;
  if s.org_id is null or s.outcome <> 'pass' then return 'new'; end if;
  if coalesce(t.is_agent, false) then
    return case when t.parent_confirmed_at is not null then 'agent_confirmed' else 'agent_pending' end;
  end if;
  return 'screened';
end $$;

create or replace function app_private.broker_can_post(p_org uuid)
returns table(ok boolean, tier text, reason text, posting_limit int, active_postings int,
              agreement_ok boolean, first_delivered boolean)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_tier text; v_agr boolean; v_active int; v_lim int; v_deliv boolean; t app_private.broker_trust;
        s app_private.broker_screenings;
begin
  v_tier := app_private.broker_tier(p_org);
  select * into t from app_private.broker_trust where org_id = p_org;
  select * into s from app_private.broker_screenings where org_id = p_org;
  v_agr := exists (select 1 from app_private.org_agreement_acceptances a
                    where a.org_id = p_org and a.kind = 'broker_carrier');
  select count(*) into v_active from app_private.partner_loads pl
   where pl.broker_org = p_org and coalesce(pl.status,'') in ('submitted','accepted','posted');
  v_deliv := exists (select 1 from app_private.trips tr join public.loads l on l.id = tr.load_id
                      where l.broker_org = p_org and tr.status = 'delivered');
  v_lim := coalesce(t.posting_limit_override, case when v_deliv then 10 else 3 end);

  ok := false; tier := v_tier; posting_limit := v_lim; active_postings := v_active;
  agreement_ok := v_agr; first_delivered := v_deliv;

  if v_tier = 'verified' then
    ok := true; posting_limit := null; reason := null;
  elsif v_tier = 'hold' then
    reason := 'Posting is on hold: ' || coalesce(t.hold_reason, 'contact support');
  elsif v_tier = 'agent_pending' then
    reason := 'Waiting for ' || coalesce(t.parent_legal_name, 'your brokerage') ||
              ' to confirm you post under their authority (one-click email sent to their FMCSA contact).';
  elsif v_tier = 'new' then
    reason := case coalesce(s.outcome, 'none')
      when 'pending'   then 'FMCSA screening is running — usually under a minute.'
      when 'fail'      then 'FMCSA screening did not pass: ' || coalesce(s.reason, 'no active broker authority found for this MC.')
      when 'not_found' then 'FMCSA has no record for that MC yet. New authorities take weeks to appear — our team will verify it by hand.'
      when 'unknown'   then 'FMCSA did not give a readable answer — our team is verifying your authority by hand.'
      when 'error'     then 'FMCSA lookup failed — retry the screening or our team will verify by hand.'
      else 'Enter your broker MC number so we can screen it against FMCSA.' end;
  elsif not v_agr then
    reason := 'Accept the LoadBoot Master Broker Agreement (one click) before posting.';
  elsif v_active >= v_lim then
    reason := 'You have ' || v_active || ' open postings — the limit is ' || v_lim ||
              case when v_deliv then ' until your documents are verified.' else ' until your first load delivers.' end ||
              ' Complete your packet under Onboarding to lift the limit.';
  else
    ok := true; reason := null;
  end if;
  return next;
end $$;

create or replace function app_private.assert_broker_can_post(p_org uuid)
returns void
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare r record;
begin
  select * into r from app_private.broker_can_post(p_org);
  if not r.ok then
    raise exception '%', coalesce(r.reason, 'posting is not available for this account yet') using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. the posting gates: partner_loads trigger + cc_partner_submit_load surgery
-- ---------------------------------------------------------------------------
create or replace function app_private.enforce_partner_onboarded()
returns trigger
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; j jsonb; v_src text;
begin
  j := to_jsonb(NEW);
  v_org := coalesce(nullif(j->>'broker_org','')::uuid, nullif(j->>'shipper_org','')::uuid);
  v_src := coalesce(nullif(j->>'source_type',''), nullif(current_setting('loadboot.load_source', true), ''));
  -- Syndicated freight (bl_soft_0279) lands before verification; the booking gate handles it.
  if v_src = 'api_client' then return NEW; end if;
  if v_org is null then return NEW; end if;
  -- Brokers: the tiered rule. Shippers/facilities: unchanged (full packet).
  if exists (select 1 from public.organizations o where o.id = v_org and o.kind = 'broker') then
    perform app_private.assert_broker_can_post(v_org);
    return NEW;
  end if;
  if not app_private.org_onboarding_complete(v_org) then
    raise exception 'Complete onboarding first — all required documents must be verified before you can post loads.' using errcode='42501';
  end if;
  return NEW;
end $$;

create or replace function app_private.broker_trust_hold(p_org uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  insert into app_private.broker_trust(org_id, hold_reason, held_at)
  values (p_org, coalesce(nullif(trim(p_reason),''), 'account parked by LoadBoot'), now())
  on conflict (org_id) do update set hold_reason = excluded.hold_reason, held_at = now(), updated_at = now();
end $$;

create or replace function app_private.broker_trust_release(p_org uuid)
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  update app_private.broker_trust set hold_reason = null, held_at = null, updated_at = now() where org_id = p_org;
end $$;

-- cc_partner_submit_load: replace the org.status='active' line with the tiered assert.
-- String surgery on the live definition so no other line of that function can drift.
do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cc_partner_submit_load';
  if v_def is null then raise exception 'cc_partner_submit_load missing'; end if;
  v_old := $q$  if not exists (select 1 from public.organizations o where o.id=v_org and o.status='active') then
    raise exception 'broker account is not active — complete onboarding before posting loads' using errcode='42501'; end if;$q$;
  v_new := $q$  -- bl_bp_0312: tiered trust replaces the org.status='active' gate (FMCSA-screened brokers post with limits)
  perform app_private.assert_broker_can_post(v_org);$q$;
  if position(v_old in v_def) = 0 then
    if position('assert_broker_can_post' in v_def) > 0 then
      raise notice 'cc_partner_submit_load already patched';
      return;
    end if;
    raise exception 'cc_partner_submit_load: expected status line not found — refusing to patch blind';
  end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- cc_partner_set_status: park → hold, approve → release (same surgery pattern).
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cc_partner_set_status';
  if v_def is null then raise notice 'cc_partner_set_status missing — skipped'; return; end if;
  if position('broker_trust_hold' in v_def) > 0 then raise notice 'cc_partner_set_status already patched'; return; end if;
  if position($q$update public.organizations set status = 'pending' where id = p_org;$q$ in v_def) = 0
     or position($q$update public.organizations set status = 'active' where id = p_org;$q$ in v_def) = 0 then
    raise exception 'cc_partner_set_status: expected lines not found — refusing to patch blind';
  end if;
  v_def := replace(v_def, $q$update public.organizations set status = 'pending' where id = p_org;$q$,
                          $q$update public.organizations set status = 'pending' where id = p_org;
    perform app_private.broker_trust_hold(p_org, p_reason);$q$);
  v_def := replace(v_def, $q$update public.organizations set status = 'active' where id = p_org;$q$,
                          $q$update public.organizations set status = 'active' where id = p_org;
    perform app_private.broker_trust_release(p_org);$q$);
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 4. loads: label + booking gate for not-yet-verified brokerages (portal loads)
-- ---------------------------------------------------------------------------
create or replace function app_private.trust_label_load()
returns trigger
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_tier text; t app_private.broker_trust; v_name text; v_mc text;
begin
  -- Portal-posted broker loads only. Staff/dispatcher-entered and syndicated loads keep their own rules.
  if NEW.broker_org is null or coalesce(NEW.source_type,'partner_portal') <> 'partner_portal' then return NEW; end if;
  if not exists (select 1 from public.organizations o where o.id = NEW.broker_org and o.kind = 'broker') then return NEW; end if;
  v_tier := app_private.broker_tier(NEW.broker_org);
  if v_tier = 'verified' then
    -- self-heal: a load posted while the brokerage was still 'partial' clears once they verify
    if NEW.verification_state = 'partial' then
      NEW.verification_state := 'verified';
      NEW.details := coalesce(NEW.details,'{}'::jsonb) - 'source_notice';
    end if;
    return NEW;
  end if;
  select * into t from app_private.broker_trust where org_id = NEW.broker_org;
  select nullif(regexp_replace(coalesce(mc_number,''),'\D','','g'),'') into v_mc from public.organizations where id = NEW.broker_org;
  v_name := case when coalesce(t.is_agent,false) then coalesce(t.parent_legal_name, 'their brokerage') else null end;
  NEW.verification_state := 'partial';
  NEW.details := coalesce(NEW.details,'{}'::jsonb) || jsonb_build_object('source_notice', jsonb_build_object(
    'provider', case when v_name is not null then 'an agent of ' || v_name else 'a new LoadBoot brokerage' end,
    'bookable', true,
    'request_only', true,
    'tier', v_tier,
    'label', case when v_name is not null
      then 'Posted by an agent under ' || v_name || coalesce(' (MC-' || t.parent_mc || ')','')
           || ' — authority confirmed on FMCSA and by the brokerage. Booking goes through request-to-book: LoadBoot dispatch confirms the rate confirmation with the brokerage before you roll.'
      else 'New brokerage on LoadBoot — broker authority' || coalesce(' MC-' || v_mc, '') || ' verified live on FMCSA (bond on file). '
           || 'Booking goes through request-to-book: the broker approves and LoadBoot dispatch confirms the rate confirmation before you roll.' end));
  return NEW;
end $$;

drop trigger if exists trg_loads_zz_trust_label on public.loads;
create trigger trg_loads_zz_trust_label
  before insert or update of broker_org, verification_state on public.loads
  for each row execute function app_private.trust_label_load();

-- Booking gate: 'partial' loads never book instantly. A carrier gets them only through
-- request-to-book (broker approves) or a broker-sent offer (broker chose the carrier).
-- Independent of bl_soft_0279's api_client gate — both may run; neither knows the other.
create or replace function app_private.enforce_trust_gate_not_bookable()
returns trigger
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_tier text;
begin
  if OLD.status is distinct from 'available' or NEW.status is not distinct from OLD.status
     or NEW.status in ('cancelled','canceled','expired') then return NEW; end if;
  if NEW.broker_org is null or coalesce(NEW.source_type,'partner_portal') <> 'partner_portal' then return NEW; end if;
  if not exists (select 1 from public.organizations o where o.id = NEW.broker_org and o.kind = 'broker') then return NEW; end if;
  v_tier := app_private.broker_tier(NEW.broker_org);
  if v_tier = 'verified' then
    if NEW.verification_state = 'partial' then NEW.verification_state := 'verified'; end if;
    return NEW;
  end if;
  if v_tier in ('hold','agent_pending','new') then
    raise exception 'This brokerage is not cleared to book right now (%). LoadBoot dispatch has been notified.', v_tier using errcode = '42501';
  end if;
  -- screened / agent_confirmed: broker-approved paths only
  if exists (select 1 from app_private.load_book_requests r
              where r.load_id = NEW.id and r.status in ('pending','approved')
                and (NEW.assigned_to is null or r.carrier_user = NEW.assigned_to))
     or exists (select 1 from app_private.load_offers o
                 join public.organization_memberships om on om.org_id = o.carrier_id and om.status = 'active'
                where o.load_id = NEW.id and o.status in ('sent','viewed','accepted','countered')
                  and (NEW.assigned_to is null or om.user_id = NEW.assigned_to)) then
    return NEW;
  end if;
  raise exception 'This load is from a new brokerage — book it with "Request to book" (the broker approves within 30 minutes and LoadBoot confirms the rate confirmation). Instant booking unlocks once the brokerage completes verification.' using errcode = '42501';
end $$;

drop trigger if exists trg_loads_zz_trust_gate on public.loads;
create trigger trg_loads_zz_trust_gate
  before update on public.loads
  for each row execute function app_private.enforce_trust_gate_not_bookable();

-- ---------------------------------------------------------------------------
-- 5. screening: request (portal) → pg_net → fmcsa-verify → collect (cron)
-- ---------------------------------------------------------------------------
create or replace function app_private.broker_screen_request(p_org uuid, p_mc text, p_dot text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare cfg record; v_mc text; v_dot text; v_req bigint; s app_private.broker_screenings;
begin
  v_mc  := nullif(regexp_replace(coalesce(p_mc,''),  '[^0-9]', '', 'g'), '');
  v_dot := nullif(regexp_replace(coalesce(p_dot,''), '[^0-9]', '', 'g'), '');
  if v_mc is null and v_dot is null then raise exception 'MC or USDOT number is required' using errcode='22023'; end if;
  if v_mc is not null and length(v_mc) > 8 then raise exception 'MC number is at most 8 digits' using errcode='22023'; end if;
  select * into s from app_private.broker_screenings where org_id = p_org;
  if s.org_id is not null and s.request_id is not null and s.requested_at > now() - interval '2 minutes' then
    return jsonb_build_object('queued', false, 'outcome', 'pending', 'note', 'a screening is already running');
  end if;
  select * into cfg from app_private.fmcsa_config where id;
  if not found or not cfg.enabled then
    insert into app_private.broker_screenings(org_id, mc_number, dot_number, outcome, reason, checked_at, attempts)
    values (p_org, v_mc, v_dot, 'error', 'FMCSA screening is not configured on this environment', now(), 1)
    on conflict (org_id) do update set mc_number = excluded.mc_number, dot_number = excluded.dot_number,
      outcome = 'error', reason = excluded.reason, checked_at = now(), request_id = null, attempts = app_private.broker_screenings.attempts + 1, updated_at = now();
    return jsonb_build_object('queued', false, 'outcome', 'error', 'note', 'not configured');
  end if;
  select net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || cfg.auth_key),
    body := case when v_dot is not null then jsonb_build_object('dot', v_dot) else jsonb_build_object('mc', v_mc) end,
    timeout_milliseconds := 30000) into v_req;
  insert into app_private.broker_screenings(org_id, mc_number, dot_number, request_id, requested_at, outcome, attempts)
  values (p_org, v_mc, v_dot, v_req, now(), 'pending', 1)
  on conflict (org_id) do update set mc_number = excluded.mc_number, dot_number = excluded.dot_number,
    request_id = excluded.request_id, requested_at = now(), outcome = 'pending', reason = null,
    attempts = app_private.broker_screenings.attempts + 1, updated_at = now();
  return jsonb_build_object('queued', true, 'outcome', 'pending');
end $$;

-- Reads pg_net responses. Every path writes an outcome; nothing is a silent no-op.
create or replace function app_private.broker_screen_collect()
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare r record; resp record; body jsonb; car jsonb; v_out text; v_reason text; v_src text;
        v_ba boolean; v_ca boolean; v_safer_st text; v_safer_tx text; v_read int := 0; v_pass int := 0;
        v_owner_email text; v_fmcsa_email text; v_dm boolean; t app_private.broker_trust; v_org_name text;
begin
  for r in select * from app_private.broker_screenings
            where request_id is not null and requested_at < now() - interval '8 seconds'
  loop
    select id, status_code, content into resp from net._http_response where id = r.request_id;
    if not found then
      if r.requested_at < now() - interval '10 minutes' then
        update app_private.broker_screenings set request_id = null, checked_at = now(), outcome = 'error',
               reason = 'No response from FMCSA lookup within 10 minutes.', updated_at = now() where org_id = r.org_id;
      end if;
      continue;
    end if;
    v_read := v_read + 1;
    begin body := resp.content::jsonb; exception when others then body := null; end;
    car := body->'carrier';
    v_out := 'unknown'; v_reason := null; v_src := null; v_ba := null; v_ca := null; v_dm := null;
    if resp.status_code = 404 or (body is not null and coalesce(body->>'ok','') = 'false') then
      v_out := 'not_found';
      v_reason := coalesce(body->>'error', 'FMCSA has no record for this number yet.');
    elsif resp.status_code is null or resp.status_code >= 400 or car is null then
      v_out := 'error';
      v_reason := left(coalesce(body->>'error', 'HTTP ' || coalesce(resp.status_code::text,'?')), 300);
    else
      v_ba := nullif(car->>'brokerAuthority','')::boolean;
      v_ca := nullif(car->>'carrierAuthority','')::boolean;
      v_safer_st := car->>'saferAuthorityStatus'; v_safer_tx := car->>'saferAuthorityText';
      v_src := car->>'authoritySource';
      if v_ba is true then
        v_out := 'pass';
      elsif v_ba is false then
        v_out := 'fail';
        v_reason := case when v_ca then 'This MC holds CARRIER authority, not broker authority. Loads can only be posted under a property-broker authority.'
                         else 'FMCSA Licensing & Insurance shows no ACTIVE broker authority for this MC.' end;
      elsif v_safer_st = 'authorized' and v_safer_tx ilike '%broker%' then
        v_out := 'pass'; v_src := coalesce(v_src, 'fmcsa-safer');
      elsif v_safer_st = 'authorized' then
        v_out := 'fail';
        v_reason := 'FMCSA SAFER shows this entity is authorized as a carrier, not a broker (' || coalesce(v_safer_tx,'') || ').';
      elsif v_safer_st in ('not_authorized','out_of_service') then
        v_out := 'fail';
        v_reason := 'FMCSA shows this authority as ' || replace(v_safer_st,'_',' ') || ' (' || coalesce(v_safer_tx,'') || ').';
      else
        v_out := 'unknown';
        v_reason := 'FMCSA did not give a readable authority answer. UNKNOWN is not a negative finding — staff verify by hand.';
      end if;
      if coalesce(upper(car->>'allowedToOperate'),'') = 'N' then
        v_out := 'fail'; v_reason := 'FMCSA reports this entity is NOT allowed to operate.';
      end if;
      v_fmcsa_email := nullif(lower(trim(car->>'email')),'');
      select lower(u.email) into v_owner_email from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = r.org_id;
      if v_fmcsa_email is not null and v_owner_email is not null then
        v_dm := split_part(v_fmcsa_email,'@',2) = split_part(v_owner_email,'@',2);
      end if;
    end if;

    update app_private.broker_screenings
       set request_id = null, checked_at = now(), outcome = v_out, reason = v_reason,
           broker_authority = v_ba, carrier_authority = v_ca,
           legal_name = car->>'legalName', entity_type = car->>'entityType',
           phone = car->>'phone', fmcsa_email = v_fmcsa_email, domain_match = v_dm,
           authority_source = v_src, safer_text = v_safer_tx,
           dot_number = coalesce(dot_number, nullif(car->>'dotNumber','')),
           raw = car, updated_at = now()
     where org_id = r.org_id;

    select name into v_org_name from public.organizations where id = r.org_id;
    select * into t from app_private.broker_trust where org_id = r.org_id;

    if v_out = 'pass' then
      v_pass := v_pass + 1;
      if coalesce(t.is_agent,false) and t.parent_confirmed_at is null then
        perform app_private.broker_parent_confirm_send(r.org_id);
      else
        perform app_private.notify_partner(r.org_id, '✅ FMCSA screening passed — you can post now',
          'Broker authority ' || coalesce('MC-' || r.mc_number, '') || ' is active on FMCSA. Accept the Master Broker Agreement and post your first load — up to 3 open postings until your first delivery.',
          'success', '/app/partner/#post');
      end if;
    elsif v_out = 'fail' then
      perform app_private.notify_partner(r.org_id, 'FMCSA screening did not pass', coalesce(v_reason,''), 'warning', '/app/partner/#onboarding');
    end if;

    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','broker.screened', jsonb_build_object(
        'title', case v_out when 'pass' then '🟢 Broker screened — ' when 'fail' then '🔴 Broker screening FAILED — ' else '🟡 Broker screening needs a human — ' end || coalesce(v_org_name,'?'),
        'body', coalesce('MC-' || r.mc_number || ' · ', '') || coalesce(car->>'legalName','') || ' · ' || coalesce(v_reason, 'broker authority active') ||
                case when v_dm is false then ' · ⚠ signup email domain does not match FMCSA record' else '' end,
        'tone', case v_out when 'pass' then 'info' when 'fail' then 'urgent' else 'action' end,
        'url', '/app/command-center/#/broker-trust', 'org_id', r.org_id), 'sent', now());
    exception when others then null; end;
    perform app_private.log_audit('broker.screened','org', r.org_id::text, r.org_id,
      'FMCSA broker screening: ' || v_out || coalesce(' — ' || v_reason,''), jsonb_build_object('mc', r.mc_number, 'source', v_src), null);
  end loop;

  -- parent-confirmation reminder after 48 h, once
  for r in select bt.org_id from app_private.broker_trust bt
            where bt.is_agent and bt.parent_confirmed_at is null and bt.parent_declined_at is null
              and bt.parent_confirm_sent_at < now() - interval '48 hours' and bt.parent_reminded_at is null
              and bt.parent_confirm_token is not null
  loop
    perform app_private.broker_parent_confirm_send(r.org_id, true);
  end loop;

  return jsonb_build_object('read', v_read, 'passed', v_pass, 'ran_at', now());
end $$;

-- ---------------------------------------------------------------------------
-- 6. agent under a parent brokerage
-- ---------------------------------------------------------------------------
create or replace function app_private.broker_parent_confirm_send(p_org uuid, p_reminder boolean default false)
returns void
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare t app_private.broker_trust; s app_private.broker_screenings; v_to text; v_src text; v_agent text; v_agent_email text;
        v_url text; v_html text;
begin
  select * into t from app_private.broker_trust where org_id = p_org;
  select * into s from app_private.broker_screenings where org_id = p_org;
  if t.org_id is null or not t.is_agent then return; end if;
  if t.parent_confirm_token is null then
    update app_private.broker_trust set parent_confirm_token = gen_random_uuid(), updated_at = now() where org_id = p_org returning * into t;
  end if;
  -- FMCSA-listed address wins; the agent-supplied one is a fallback that staff must sanity-check.
  v_to := coalesce(s.fmcsa_email, t.parent_contact_email);
  v_src := case when s.fmcsa_email is not null then 'fmcsa' when t.parent_contact_email is not null then 'agent_supplied' else null end;
  update app_private.broker_trust set parent_contact_email = coalesce(parent_contact_email, s.fmcsa_email),
         parent_contact_source = coalesce(v_src, parent_contact_source), parent_legal_name = coalesce(parent_legal_name, s.legal_name),
         updated_at = now() where org_id = p_org;
  if v_to is null then
    perform app_private.notify_partner(p_org, 'We need a contact at your brokerage',
      'FMCSA lists no email for ' || coalesce(s.legal_name, 'your brokerage') || '. Add the brokerage''s official email under Onboarding so they can confirm you with one click.', 'warning', '/app/partner/#onboarding');
    return;
  end if;
  select o.name, u.email into v_agent, v_agent_email from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = p_org;
  v_url := 'https://loadboot.com/agent-confirm.html?t=' || t.parent_confirm_token::text;
  v_html :=
    '<h2 style="margin:0 0 10px;font-size:22px">Does ' || coalesce(v_agent,'this person') || ' post freight under your authority?</h2>'
    || '<p style="font-size:15px;color:#334155">' || coalesce(v_agent,'An agent') || ' (' || coalesce(v_agent_email,'') || ') has asked to post loads on LoadBoot as an agent of <b>'
    || coalesce(s.legal_name, t.parent_legal_name, 'your brokerage') || '</b>' || coalesce(' (MC-' || t.parent_mc || ')','') || '.</p>'
    || '<p style="font-size:15px;color:#334155">Until you confirm, none of their postings can be booked. One click either way — no account needed.</p>'
    || '<p style="margin:18px 0"><a href="' || v_url || '" style="background:#0883F7;color:#fff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:800">Review &amp; confirm →</a></p>'
    || '<p style="font-size:12px;color:#94a3b8">This address came from ' || case when v_src = 'fmcsa' then 'your FMCSA registration' else 'the agent' end
    || '. If you do not know this person, click the link and choose "Not our agent" — that blocks them.</p>';
  perform app_private.sys_email(v_to, 'broker.parent_confirm',
    case when p_reminder then 'Reminder: ' else '' end || 'Confirm your agent on LoadBoot — ' || coalesce(v_agent,''),
    v_html, null, 'agentconfirm:' || p_org::text || ':' || case when p_reminder then 'r' else '1' end);
  update app_private.broker_trust
     set parent_confirm_sent_at = coalesce(parent_confirm_sent_at, now()),
         parent_reminded_at = case when p_reminder then now() else parent_reminded_at end, updated_at = now()
   where org_id = p_org;
  perform app_private.notify_partner(p_org, case when p_reminder then 'Reminder sent to your brokerage' else '📧 Confirmation sent to your brokerage' end,
    'We emailed ' || v_to || ' to confirm you post under ' || coalesce(s.legal_name, t.parent_legal_name, 'their authority') || '. Posting unlocks the moment they click confirm.', 'info', '/app/partner/#onboarding');
end $$;

-- ---------------------------------------------------------------------------
-- 7. portal-facing RPCs (authenticated)
-- ---------------------------------------------------------------------------
create or replace function public.partner_broker_screen(p_mc text, p_dot text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_mc text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null or not exists (select 1 from public.organizations where id = v_org and kind = 'broker') then
    raise exception 'not a broker account' using errcode='42501'; end if;
  v_mc := nullif(regexp_replace(coalesce(p_mc,''), '[^0-9]', '', 'g'), '');
  if v_mc is not null then
    update public.organizations set mc_number = coalesce(mc_number, v_mc) where id = v_org;
  end if;
  insert into app_private.broker_trust(org_id) values (v_org) on conflict do nothing;
  return app_private.broker_screen_request(v_org, v_mc, p_dot);
end $$;
revoke all on function public.partner_broker_screen(text, text) from public, anon;
grant execute on function public.partner_broker_screen(text, text) to authenticated;

create or replace function public.partner_agent_declare(p_parent_mc text, p_parent_company text, p_contact_email text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_mc text; v_email text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null then raise exception 'not a broker account' using errcode='42501'; end if;
  v_mc := nullif(regexp_replace(coalesce(p_parent_mc,''), '[^0-9]', '', 'g'), '');
  if v_mc is null then raise exception 'the brokerage MC number is required' using errcode='22023'; end if;
  v_email := nullif(lower(trim(p_contact_email)),'');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'contact email looks wrong' using errcode='22023'; end if;
  insert into app_private.broker_trust(org_id, is_agent, parent_mc, parent_legal_name, parent_contact_email, parent_contact_source)
  values (v_org, true, v_mc, nullif(trim(p_parent_company),''), v_email, case when v_email is not null then 'agent_supplied' end)
  on conflict (org_id) do update set is_agent = true, parent_mc = excluded.parent_mc,
    parent_legal_name = coalesce(excluded.parent_legal_name, app_private.broker_trust.parent_legal_name),
    parent_contact_email = coalesce(excluded.parent_contact_email, app_private.broker_trust.parent_contact_email),
    parent_contact_source = coalesce(excluded.parent_contact_source, app_private.broker_trust.parent_contact_source),
    parent_confirmed_at = case when app_private.broker_trust.parent_mc is distinct from excluded.parent_mc then null else app_private.broker_trust.parent_confirmed_at end,
    parent_declined_at = null, parent_confirm_sent_at = null, parent_reminded_at = null, updated_at = now();
  perform app_private.log_audit('broker.agent_declared','org', v_org::text, v_org,
    'Declared as agent of MC-' || v_mc || coalesce(' ' || nullif(trim(p_parent_company),''),''), null, null);
  return app_private.broker_screen_request(v_org, v_mc, null);
end $$;
revoke all on function public.partner_agent_declare(text, text, text) from public, anon;
grant execute on function public.partner_agent_declare(text, text, text) to authenticated;

create or replace function public.partner_trust_status()
returns jsonb
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; c record; s app_private.broker_screenings; t app_private.broker_trust; o record;
        v_packet jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode='42501'; end if;
  v_org := app_private.my_partner_org('broker');
  if v_org is null then return jsonb_build_object('has_org', false); end if;
  select * into o from public.organizations where id = v_org;
  select * into c from app_private.broker_can_post(v_org);
  select * into s from app_private.broker_screenings where org_id = v_org;
  select * into t from app_private.broker_trust where org_id = v_org;
  select coalesce(jsonb_agg(jsonb_build_object('key', tp.item_key, 'tag', tp.status_tag, 'status', coalesce(i.status,'pending')) order by
           case tp.status_tag when 'legal' then 0 when 'required' then 1 when 'conditional' then 2 else 3 end, tp.item_key), '[]'::jsonb)
    into v_packet
    from app_private.onboarding_packet_templates tp
    left join app_private.org_onboarding_items i on i.org_id = v_org and i.item_key = tp.item_key
   where tp.org_kind = o.kind;
  return jsonb_build_object(
    'has_org', true, 'org', v_org, 'company', o.name, 'kind', o.kind, 'org_status', o.status,
    'mc', o.mc_number, 'dot', o.dot_number,
    'tier', c.tier, 'can_post', c.ok, 'reason', c.reason, 'posting_limit', c.posting_limit,
    'active_postings', c.active_postings, 'agreement_ok', c.agreement_ok, 'first_delivered', c.first_delivered,
    'screening', case when s.org_id is null then null else jsonb_build_object(
        'outcome', s.outcome, 'mc', s.mc_number, 'dot', s.dot_number, 'legal_name', s.legal_name,
        'broker_authority', s.broker_authority, 'carrier_authority', s.carrier_authority,
        'source', s.authority_source, 'safer_text', s.safer_text, 'reason', s.reason,
        'checked_at', s.checked_at, 'requested_at', s.requested_at, 'pending', s.request_id is not null,
        'fmcsa_phone', s.phone, 'domain_match', s.domain_match) end,
    'agent', case when t.org_id is null or not t.is_agent then null else jsonb_build_object(
        'parent_mc', t.parent_mc, 'parent_legal_name', t.parent_legal_name,
        'contact_email', t.parent_contact_email, 'contact_source', t.parent_contact_source,
        'sent_at', t.parent_confirm_sent_at, 'confirmed_at', t.parent_confirmed_at,
        'declined_at', t.parent_declined_at, 'note', t.parent_note) end,
    'hold_reason', t.hold_reason,
    'packet', v_packet,
    'packet_required_total', (select count(*) from jsonb_array_elements(v_packet) e where e->>'tag' in ('legal','required')),
    'packet_required_done', (select count(*) from jsonb_array_elements(v_packet) e where e->>'tag' in ('legal','required') and e->>'status' in ('verified','waived')));
end $$;
revoke all on function public.partner_trust_status() from public, anon;
grant execute on function public.partner_trust_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. parent-confirm page: anon by token (same pattern as broker-claim / broker-ping)
-- ---------------------------------------------------------------------------
create or replace function public.partner_agent_confirm_get(p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare t app_private.broker_trust; s app_private.broker_screenings; v_agent text; v_agent_email text; v_since timestamptz;
begin
  if p_token is null then return jsonb_build_object('ok', false, 'error', 'missing token'); end if;
  select * into t from app_private.broker_trust where parent_confirm_token = p_token;
  if t.org_id is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid or has already been used.'); end if;
  select * into s from app_private.broker_screenings where org_id = t.org_id;
  select o.name, u.email, o.created_at into v_agent, v_agent_email, v_since
    from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = t.org_id;
  return jsonb_build_object('ok', true,
    'agent_name', v_agent, 'agent_email', v_agent_email, 'agent_since', v_since,
    'parent_legal_name', coalesce(s.legal_name, t.parent_legal_name), 'parent_mc', t.parent_mc,
    'contact_source', t.parent_contact_source,
    'decided', t.parent_confirmed_at is not null or t.parent_declined_at is not null,
    'confirmed', t.parent_confirmed_at is not null, 'declined', t.parent_declined_at is not null);
end $$;

create or replace function public.partner_agent_confirm(p_token uuid, p_decision text, p_name text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare t app_private.broker_trust; v_org_name text;
begin
  if p_token is null then raise exception 'missing token' using errcode='22023'; end if;
  if p_decision not in ('confirm','decline') then raise exception 'decision must be confirm or decline' using errcode='22023'; end if;
  select * into t from app_private.broker_trust where parent_confirm_token = p_token for update;
  if t.org_id is null then raise exception 'This link is not valid or has already been used.' using errcode='22023'; end if;
  if t.parent_confirmed_at is not null or t.parent_declined_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'confirmed', t.parent_confirmed_at is not null);
  end if;
  select name into v_org_name from public.organizations where id = t.org_id;
  if p_decision = 'confirm' then
    update app_private.broker_trust set parent_confirmed_at = now(), parent_confirmed_by = left(coalesce(nullif(trim(p_name),''),'brokerage contact'),120),
           parent_note = left(nullif(trim(p_note),''),500), updated_at = now() where org_id = t.org_id;
    perform app_private.notify_partner(t.org_id, '✅ ' || coalesce(t.parent_legal_name,'Your brokerage') || ' confirmed you',
      'You can post loads under their authority now — up to 3 open postings until your first delivery.', 'success', '/app/partner/#post');
  else
    update app_private.broker_trust set parent_declined_at = now(), parent_confirmed_by = left(coalesce(nullif(trim(p_name),''),'brokerage contact'),120),
           parent_note = left(nullif(trim(p_note),''),500), hold_reason = 'the brokerage you named said you are not their agent', held_at = now(), updated_at = now()
     where org_id = t.org_id;
    perform app_private.notify_partner(t.org_id, 'Your brokerage declined the confirmation',
      'Posting is on hold. If this is a mistake, contact support with proof of your agent agreement.', 'urgent', '/app/partner/#onboarding');
  end if;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','broker.parent_decided', jsonb_build_object(
      'title', case when p_decision='confirm' then '🤝 Parent brokerage CONFIRMED agent — ' else '⛔ Parent brokerage DECLINED agent — ' end || coalesce(v_org_name,'?'),
      'body', coalesce(t.parent_legal_name,'') || coalesce(' MC-' || t.parent_mc,'') || ' · by ' || coalesce(nullif(trim(p_name),''),'(no name)') || coalesce(' · ' || nullif(trim(p_note),''),''),
      'tone', case when p_decision='confirm' then 'info' else 'urgent' end, 'url', '/app/command-center/#/broker-trust', 'org_id', t.org_id), 'sent', now());
  exception when others then null; end;
  perform app_private.log_audit('broker.parent_' || p_decision, 'org', t.org_id::text, t.org_id,
    'Parent brokerage ' || p_decision || 'ed agent via token page', jsonb_build_object('by', p_name, 'note', p_note), null);
  return jsonb_build_object('ok', true, 'confirmed', p_decision = 'confirm');
end $$;
-- token-gated, deliberately anon (the parent has no LoadBoot account)
grant execute on function public.partner_agent_confirm_get(uuid) to anon, authenticated;
grant execute on function public.partner_agent_confirm(uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Command Center
-- ---------------------------------------------------------------------------
create or replace function public.cc_broker_trust_queue()
returns jsonb
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not (public.has_global_permission('partners.manage') or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(x)::jsonb order by x.sort_key, x.created_at desc) from (
    select o.id as org_id, o.name, o.status as org_status, o.mc_number, o.created_at,
           (select u.email from auth.users u where u.id = o.owner_user_id) as owner_email,
           c.tier, c.ok as can_post, c.reason, c.posting_limit, c.active_postings, c.agreement_ok, c.first_delivered,
           s.outcome as screening, s.legal_name as fmcsa_legal_name, s.broker_authority, s.carrier_authority,
           s.authority_source, s.reason as screening_reason, s.checked_at as screened_at, s.domain_match, s.fmcsa_email, s.phone as fmcsa_phone,
           t.is_agent, t.parent_mc, t.parent_legal_name, t.parent_contact_email, t.parent_contact_source,
           t.parent_confirm_sent_at, t.parent_confirmed_at, t.parent_declined_at, t.parent_confirmed_by, t.parent_note,
           t.hold_reason,
           (select count(*) from app_private.partner_loads pl where pl.broker_org = o.id) as loads_total,
           (select count(*) from app_private.partner_loads pl where pl.broker_org = o.id and pl.status = 'submitted') as loads_awaiting_review,
           (select count(*) from app_private.onboarding_packet_templates tp left join app_private.org_onboarding_items i on i.org_id = o.id and i.item_key = tp.item_key
             where tp.org_kind = 'broker' and tp.status_tag in ('legal','required') and coalesce(i.status,'pending') in ('verified','waived')) as packet_done,
           (select count(*) from app_private.onboarding_packet_templates tp where tp.org_kind = 'broker' and tp.status_tag in ('legal','required')) as packet_total,
           case c.tier when 'agent_pending' then 0 when 'new' then 1 when 'hold' then 2 when 'screened' then 3 when 'agent_confirmed' then 3 else 4 end as sort_key
      from public.organizations o
      left join lateral app_private.broker_can_post(o.id) c on true
      left join app_private.broker_screenings s on s.org_id = o.id
      left join app_private.broker_trust t on t.org_id = o.id
     where o.kind = 'broker' and coalesce(o.status,'') <> 'archived'
       and not coalesce((to_jsonb(o)->>'is_demo')::boolean, false)
  ) x), '[]'::jsonb);
end $$;
revoke all on function public.cc_broker_trust_queue() from public, anon;
grant execute on function public.cc_broker_trust_queue() to authenticated;

create or replace function public.cc_broker_trust_set(p_org uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare t app_private.broker_trust; v_name text;
begin
  if not (public.has_global_permission('partners.manage') or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  if not exists (select 1 from public.organizations where id = p_org and kind = 'broker') then
    raise exception 'broker not found' using errcode='22023'; end if;
  insert into app_private.broker_trust(org_id) values (p_org) on conflict do nothing;
  select name into v_name from public.organizations where id = p_org;
  if p_action = 'hold' then
    if coalesce(trim(p_note),'') = '' then raise exception 'a written reason is required to hold' using errcode='22023'; end if;
    perform app_private.broker_trust_hold(p_org, p_note);
    perform app_private.notify_partner(p_org, '⛔ Posting paused', p_note || '  Contact support to resolve it.', 'urgent', '/app/partner/#onboarding');
  elsif p_action = 'release' then
    perform app_private.broker_trust_release(p_org);
    perform app_private.notify_partner(p_org, '✅ Posting restored', coalesce(nullif(trim(p_note),''), 'The hold on your account was lifted.'), 'success', '/app/partner/#post');
  elsif p_action = 'pass' then
    -- staff verified the authority by hand (unknown / not_found outcomes)
    insert into app_private.broker_screenings(org_id, outcome, reason, checked_at, authority_source, attempts)
    values (p_org, 'pass', 'Verified by staff: ' || coalesce(nullif(trim(p_note),''),'manual FMCSA check'), now(), 'staff', 1)
    on conflict (org_id) do update set outcome = 'pass', reason = excluded.reason, checked_at = now(), request_id = null,
      authority_source = 'staff', broker_authority = true, updated_at = now();
    select * into t from app_private.broker_trust where org_id = p_org;
    if coalesce(t.is_agent,false) and t.parent_confirmed_at is null then perform app_private.broker_parent_confirm_send(p_org);
    else perform app_private.notify_partner(p_org, '✅ Authority verified — you can post now', 'Accept the Master Broker Agreement and post your first load.', 'success', '/app/partner/#post'); end if;
  elsif p_action = 'confirm_parent' then
    update app_private.broker_trust set parent_confirmed_at = now(), parent_confirmed_by = 'staff', parent_note = left(nullif(trim(p_note),''),500),
           parent_declined_at = null, updated_at = now() where org_id = p_org;
    perform app_private.notify_partner(p_org, '✅ Your brokerage relationship is confirmed', 'You can post loads under their authority now.', 'success', '/app/partner/#post');
  elsif p_action = 'resend_parent' then
    update app_private.broker_trust set parent_reminded_at = null where org_id = p_org;
    perform app_private.broker_parent_confirm_send(p_org, true);
  elsif p_action = 'rescreen' then
    select * into t from app_private.broker_trust where org_id = p_org;
    perform app_private.broker_screen_request(p_org,
      coalesce(case when coalesce(t.is_agent,false) then t.parent_mc end, (select mc_number from public.organizations where id = p_org)),
      (select dot_number from public.organizations where id = p_org));
  elsif p_action = 'set_limit' then
    update app_private.broker_trust set posting_limit_override = nullif(regexp_replace(coalesce(p_note,''),'\D','','g'),'')::int, updated_at = now() where org_id = p_org;
  else
    raise exception 'unknown action' using errcode='22023';
  end if;
  perform app_private.log_audit('broker.trust.' || p_action, 'org', p_org::text, p_org, coalesce(p_note, p_action), null, null);
  return jsonb_build_object('ok', true, 'tier', app_private.broker_tier(p_org));
end $$;
revoke all on function public.cc_broker_trust_set(uuid, text, text) from public, anon;
grant execute on function public.cc_broker_trust_set(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. cron: collect screening responses every minute (idempotent)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'lb-broker-screen-collect') then
      perform cron.schedule('lb-broker-screen-collect', '* * * * *', $c$select app_private.broker_screen_collect();$c$);
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11. ACL re-check (the CREATE OR REPLACE trap): only the two token RPCs may be anon.
-- ---------------------------------------------------------------------------
do $$
declare r record; bad text := '';
begin
  for r in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('partner_broker_screen','partner_agent_declare','partner_trust_status','cc_broker_trust_queue','cc_broker_trust_set')
              and has_function_privilege('anon', p.oid, 'execute')
  loop bad := bad || r.proname || ' '; end loop;
  if bad <> '' then raise exception 'ACL leak: anon can execute %', bad; end if;
end $$;
