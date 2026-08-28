-- bl_soft_0279 .. bl_soft_0284 — applied to PROD 2026-08-25. Staging: NOT applied
-- (staging lacks the partner-load engine and the demo/source columns these use).
--
-- ===========================================================================
-- THE DECISION
-- ===========================================================================
-- Syndication partners (LoadBoard Network, AscendTMS PostEverywhere, NextLOAD)
-- will send us freight from brokerages that are not LoadBoot-verified. Two ways
-- to handle that:
--
--   strict — refuse the load until the brokerage verifies. Board stays clean,
--            syndication never gets off the ground.
--   soft   — accept it, label it honestly on the board, and refuse the BOOKING
--            until the brokerage verifies.
--
-- Yaseen chose soft, 2026-08-25. This is that.
--
-- The rule in one line: a syndicated load is VISIBLE but not BOOKABLE until the
-- posting brokerage completes LoadBoot verification.
--
-- ===========================================================================
-- WHY THE GATE IS A TRIGGER, NOT A CHECK IN THE BOOKING RPCs
-- ===========================================================================
-- There are at least four booking entry points: cc_pocket_book_load,
-- cc_request_book_load, book_load, cc_decide_book_request. Guarding each means
-- the next entry point someone adds silently bypasses the rule. A BEFORE UPDATE
-- trigger on public.loads is the one choke point every path must pass through.
-- Fail-closed by construction.
--
-- The gate reads LIVE org state (org_onboarding_complete) rather than a stored
-- flag, so it can never go stale: the moment a brokerage finishes verification
-- its already-posted loads become bookable on their own. No flag to flip, no
-- sweep to run. verification_state is the display label; the live check is truth.
--
-- ===========================================================================
-- TWO CORRECTIONS MADE DURING THE BUILD — both caught by live tests
-- ===========================================================================
-- 1. (0280) loads_source_type_check does NOT permit 'partner_api'. The allowed
--    list already contains 'api_client'. bl_api_0277 was emitting 'partner_api',
--    which would have thrown a constraint violation the first time a partner
--    load reached public.loads. Also, loads_verification_check permits only
--    unverified|partial|verified — 'unverified_source' is not legal. Rather than
--    widen constraints on a core table, the gate keys off source_type and reuses
--    the existing 'unverified' label. No schema churn, nothing new to learn.
--
-- 2. (0283) Postgres fires BEFORE triggers in ALPHABETICAL ORDER BY TRIGGER NAME.
--    trg_partner_loads_onboarded sorts before trg_partner_loads_stamp_source
--    ('o' < 's'), so the onboarding gate ran first and still saw source_type
--    NULL — the exception never applied and posting stayed blocked. Fixed by
--    having the onboarding check read the same transaction-local GUC, so it is
--    correct regardless of trigger order, plus a rename as belt-and-braces.
--
-- ===========================================================================
-- TESTED ON PROD (all wrapped in a rolled-back DO block; loads_total unchanged)
-- ===========================================================================
--   A  ordinary portal load still books ................. PASS  (regression guard)
--   B  syndicated load from unverified brokerage blocked . PASS
--   C  cancelling a syndicated load still allowed ........ PASS
--   D  syndicated load from VERIFIED brokerage books ..... PASS
--   E  label self-heals to 'verified' on booking ......... PASS
--   1  unverified brokerage CAN post via the API ......... PASS
--   2  stamped api_client / provider / unverified ........ PASS
--   3  PORTAL load from same unverified brokerage blocked  PASS  (exception is narrow)
--   4  board label written on syndicated, absent on portal PASS
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. partner_loads carries provenance
-- --------------------------------------------------------------------------
alter table app_private.partner_loads
  add column if not exists source_type        text,
  add column if not exists source_provider    text,
  add column if not exists verification_state text;

comment on column app_private.partner_loads.source_type is
  'partner_portal | api_client | staff_entered | email. Set by the posting path.';
comment on column app_private.partner_loads.source_provider is
  'Which syndication network delivered this load, when source_type = api_client.';
comment on column app_private.partner_loads.verification_state is
  'verified | unverified. Display label; the booking gate reads live org state.';

-- --------------------------------------------------------------------------
-- 2. Stamp a partner load with where it came from (bl_soft_0281)
-- --------------------------------------------------------------------------
create or replace function app_private.stamp_partner_load_source()
returns trigger
language plpgsql
as $function$
declare
  v_src  text := nullif(current_setting('loadboot.load_source', true), '');
  v_prov text := nullif(current_setting('loadboot.load_source_provider', true), '');
begin
  if NEW.source_type is null then
    NEW.source_type := coalesce(v_src, 'partner_portal');
  end if;
  if NEW.source_provider is null then
    NEW.source_provider := v_prov;
  end if;
  if NEW.verification_state is null then
    NEW.verification_state := case
      when NEW.source_type = 'api_client'
           and NEW.broker_org is not null
           and not app_private.org_onboarding_complete(NEW.broker_org)
      then 'unverified' else 'verified' end;
  end if;
  return NEW;
end
$function$;

-- Name starts with 00 so it fires before both gates on this table.
drop trigger if exists trg_partner_loads_stamp_source on app_private.partner_loads;
drop trigger if exists partner_loads_00_stamp_source on app_private.partner_loads;
create trigger partner_loads_00_stamp_source
  before insert on app_private.partner_loads
  for each row execute function app_private.stamp_partner_load_source();

-- --------------------------------------------------------------------------
-- 3. Narrow onboarding exception (bl_soft_0281, corrected by bl_soft_0283)
-- --------------------------------------------------------------------------
create or replace function app_private.enforce_partner_onboarded()
returns trigger
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  v_org uuid;
  j     jsonb;
  v_src text;
begin
  j := to_jsonb(NEW);
  v_org := coalesce(nullif(j->>'broker_org','')::uuid, nullif(j->>'shipper_org','')::uuid);

  -- Independent of trigger firing order — see correction 2 in the header.
  v_src := coalesce(
    nullif(j->>'source_type', ''),
    nullif(current_setting('loadboot.load_source', true), '')
  );

  if v_src = 'api_client' then
    return NEW;   -- syndicated: may post unverified, but cannot be booked
  end if;

  if v_org is not null and not app_private.org_onboarding_complete(v_org) then
    raise exception 'Complete onboarding first — all required documents must be verified before you can post loads.' using errcode='42501';
  end if;
  return NEW;
end
$function$;

-- --------------------------------------------------------------------------
-- 4. THE GATE (bl_soft_0279, corrected by bl_soft_0280)
-- --------------------------------------------------------------------------
create or replace function app_private.enforce_unverified_source_not_bookable()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $function$
begin
  if OLD.status is distinct from 'available'
     or NEW.status is not distinct from OLD.status
     or NEW.status in ('cancelled', 'canceled', 'expired') then
    return NEW;
  end if;

  if coalesce(NEW.source_type, '') <> 'api_client' then
    return NEW;   -- portal and staff loads untouched
  end if;

  if NEW.broker_org is not null
     and app_private.org_onboarding_complete(NEW.broker_org) then
    NEW.verification_state := 'verified';   -- self-heal
    return NEW;
  end if;

  raise exception
    'This load came from % and the posting brokerage has not completed LoadBoot verification yet, so it cannot be booked. We have asked them for authority, insurance and bond — you will be notified the moment it clears.',
    coalesce(NEW.source_provider, 'a partner network')
    using errcode = '42501';
end
$function$;

drop trigger if exists trg_loads_unverified_source_gate on public.loads;
create trigger trg_loads_unverified_source_gate
  before update on public.loads
  for each row execute function app_private.enforce_unverified_source_not_bookable();

-- --------------------------------------------------------------------------
-- 5. Board label (bl_soft_0284)
-- --------------------------------------------------------------------------
-- Written into loads.details rather than widening cc_pocket_available_loads'
-- RETURNS TABLE — that RPC is what the live carrier portal calls, and details is
-- already in its result set. Carrier app reads details.source_notice.
create or replace function app_private.label_syndicated_load()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $function$
declare v_ok boolean;
begin
  if coalesce(NEW.source_type, '') <> 'api_client' then
    return NEW;
  end if;

  v_ok := NEW.broker_org is not null
          and app_private.org_onboarding_complete(NEW.broker_org);

  NEW.details := coalesce(NEW.details, '{}'::jsonb) || jsonb_build_object(
    'source_notice', jsonb_build_object(
      'provider', coalesce(NEW.source_provider, 'a partner network'),
      'bookable', v_ok,
      'label',
        case when v_ok
          then 'Posted via ' || coalesce(NEW.source_provider, 'a partner network')
          else 'Posted via ' || coalesce(NEW.source_provider, 'a partner network')
               || ' — this brokerage has not completed LoadBoot verification yet, so this load cannot be booked. We are chasing their authority, insurance and bond.'
        end
    )
  );
  return NEW;
end
$function$;

drop trigger if exists trg_loads_label_syndicated on public.loads;
create trigger trg_loads_label_syndicated
  before insert or update of source_type, source_provider, broker_org on public.loads
  for each row execute function app_private.label_syndicated_load();

-- --------------------------------------------------------------------------
-- 6. Carry provenance through publish (bl_soft_0281)
-- --------------------------------------------------------------------------
-- cc_decide_partner_load is large and working; patched by targeted text
-- replacement on the live definition so nothing else in it is disturbed.
do $mig$
declare
  src text;
  a1  text := ',pickup_time,delivery_date,delivery_time)';
  a1n text := ',pickup_time,delivery_date,delivery_time,source_type,source_provider,verification_state)';
  a2  text := 'l.pickup_window, l.delivery_date, l.delivery_window) returning id into v_load;';
  a2n text := 'l.pickup_window, l.delivery_date, l.delivery_window, l.source_type, l.source_provider, coalesce(l.verification_state,''verified'')) returning id into v_load;';
begin
  src := pg_get_functiondef('public.cc_decide_partner_load(uuid,text)'::regprocedure);
  if position(a1n in src) > 0 then
    raise notice 'cc_decide_partner_load already patched — skipping';
    return;
  end if;
  if position(a1 in src) = 0 then raise exception 'anchor 1 not found — patch by hand'; end if;
  if position(a2 in src) = 0 then raise exception 'anchor 2 not found — patch by hand'; end if;
  src := replace(src, a1, a1n);
  src := replace(src, a2, a2n);
  execute src;
end
$mig$;

-- --------------------------------------------------------------------------
-- 7. dev_post_load announces the source (bl_soft_0282)
-- --------------------------------------------------------------------------
create or replace function public.dev_post_load(p_user uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $function$
declare
  v_std jsonb; v_acc jsonb; v_body jsonb; v_out jsonb; v_prov text;
begin
  if p_user is null then
    raise exception 'p_user is required' using errcode = '22023';
  end if;
  if coalesce(trim(p->>'origin'), '') = '' or coalesce(trim(p->>'destination'), '') = '' then
    raise exception 'origin and destination are required' using errcode = '22023';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);

  v_prov := nullif(btrim(coalesce(p->>'source_provider', '')), '');
  perform set_config('loadboot.load_source', 'api_client', true);
  perform set_config('loadboot.load_source_provider', coalesce(v_prov, ''), true);

  select jsonb_object_agg(key, value) into v_std from app_private.rate_standards;
  v_std := coalesce(v_std, '{}'::jsonb);
  v_acc := v_std || coalesce(p->'accessorials', '{}'::jsonb);

  if not (v_acc ? 'fcfs')
     and not coalesce((p->>'appointment_required')::boolean, false)
     and coalesce(trim(p->>'pickup_window'), '') = '' then
    v_acc := v_acc || jsonb_build_object('fcfs', true);
  end if;

  v_body := p
    || jsonb_build_object('accessorials', v_acc)
    || jsonb_build_object('source_type', 'api_client');

  v_out := public.cc_partner_submit_load(v_body);
  return jsonb_build_object('ok', true, 'result', v_out);
end
$function$;

revoke all on function public.dev_post_load(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.dev_post_load(uuid, jsonb) to service_role;
