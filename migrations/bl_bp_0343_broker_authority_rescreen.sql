-- bl_bp_0343 — Broker authority RE-screen: a one-time FMCSA check is no longer enough.
-- 2026-09-09 · Claude · STAGING FIRST. Prod only on Yaseen's word.
--
-- WHY
--   FMCSA's 16 Jan 2026 rule: if a broker's BMC-84/85 surety drops below $75,000, FMCSA gives
--   7 days and then suspends the operating authority. bl_bp_0312 screens a broker ONCE, stores the
--   answer in app_private.broker_screenings, and app_private.broker_tier() reads that stored row
--   forever. A brokerage screened in March still reads 'pass' in September. Under the new rule that
--   window is 7 days, not 6 months.
--
-- WHAT THIS IS NOT
--   It is NOT a second FMCSA poll. bl_cmp_0324 already runs fmcsa_authority_dispatch(40) at 06:10 UTC
--   and brokers were eligible for it — but that pipeline stores app_private.authority_checks.authority_status,
--   which is CARRIER authority (bl_cmp_0326 documents exactly this: a legal broker-only docket reads
--   'inactive' there). It is the wrong field for a broker and it was never wired into broker_tier.
--   §9 below removes brokers from that dispatch so each kind is checked against the field that means
--   something for it, once a day, not twice against one right field and one wrong one.
--
-- WHAT IT DOES
--   (a) POST-TIME   enforce_partner_onboarded queues a fresh screen when the last successful check is
--                   older than stale_hours (24h). Fire-and-continue — the post is never held waiting
--                   for FMCSA, and "no answer yet" is never treated as a negative.
--   (b) NIGHTLY     app_private.broker_rescreen_sweep() at 07:00 UTC re-screens every stale broker,
--                   raises the day-3 alert, and flags anyone the 14-day gate is now stopping.
--   (c) ON FAIL     new posting stops, CC is alerted, open loads are re-labelled request-to-book.
--                   NOTHING IS CANCELLED. Booked trips, tracking, invoices and payments are untouched.
--                   Yaseen 9 Sep: a broker who ONCE PASSED needs TWO consecutive fails before the
--                   verdict sticks — FMCSA has been wrong on a single read before (Warren's Courier,
--                   Munster, 22 Aug; see project memory fmcsa_verify_limits.md). A broker who has
--                   NEVER passed is unchanged: the first fail stands, exactly as bl_bp_0312 had it.
--   (d) ON UNKNOWN / NOT_FOUND / ERROR — for a broker that has passed before, NOTHING CHANGES.
--                   The facts land (legal name, phone, raw), last_outcome records what came back,
--                   the VERDICT is not touched, and last_pass_at does not advance. An unreadable
--                   answer is not a finding. For a broker that has never passed, these still write
--                   through as they always did — there is no good verdict to protect.
--   (e) ON SILENCE  14 days with no successful check → posting stops (tier 'authority_stale');
--                   CC alerted at day 3. GUARDED: if NO broker anywhere has passed in 48 h, the
--                   staleness gate does not fire at all — that pattern is our lookup failing, not
--                   five brokerages losing their bonds on the same night. See broker_screen_pipeline_healthy().
--
-- HOW (and why it is all string surgery)
--   broker_can_post, broker_screen_collect, trust_label_load, enforce_partner_onboarded and
--   cc_broker_trust_set have each been patched IN PLACE by bl_bp_0313 / 0315 / 0318 / 0319. The live
--   definitions are ahead of every .sql file in this repo. A CREATE OR REPLACE from repo text would
--   silently revert those migrations. Every change below is anchored on the LIVE definition and
--   refuses to patch blind. broker_tier is the one exception — bl_bp_0318 replaced it wholesale and
--   nothing has patched it since, so it is replaced wholesale here too, with 0318's body intact.
--
-- NEW TIERS: 'authority_fail' and 'authority_stale'. They outrank 'verified' — a complete document
--   packet is not an answer to a suspended authority. FRONTEND FOLLOW-UP: app/partner/app.js and the
--   CC broker-trust view switch on tier strings; they will fall through to their default branch and
--   show broker_can_post's reason text, which is written to stand alone. Not a break, but worth a pass.
--
-- KNOWN LIMITATION (stated, not hidden): an agent org has ONE broker_screenings row shared across all
--   its parent brokerages (bl_bp_0318 copies each result out to agent_parents). The strike counter is
--   therefore per agent org, not per parent MC. An agent with several brokerages gets a slightly
--   coarser count than a direct broker. Correct direction, imprecise granularity — fix when agents
--   with multiple live parents actually exist.
--
-- APPLY WITH bl_bp_0343a. This migration makes broker_screen_request() run every night; 0343a stops
--   that request from clobbering a good verdict on the way out. Applying 0343 WITHOUT 0343a would
--   block every passing brokerage for the minute each nightly check is in flight, and permanently
--   if a response never lands. They go together, in that order.
--
-- STAGING: applied 9 Sep 2026 (snslhvmkjusozgjelghi), with 0343a. Verified on throwaway brokers:
--   unknown/not_found/error leave the verdict untouched and do not advance last_pass_at; fail #1
--   alerts CC and blocks nothing; fail #2 → authority_fail, can_post false, CC alert, loads flagged;
--   a later pass restores and clears the strikes; 13 days is inside the window and 20 days is not;
--   the sweep raises the day-3 and 14-day alerts once each and leaves a freshly-passing broker alone;
--   the post-time refresh fires once and then throttles. No live staging broker moved from allowed
--   to blocked (Atlas was already blocked on outcome='fail' — it now reads authority_fail instead
--   of 'new', which is the same gate with an honest reason).
--
-- NOT COVERED (say so rather than imply otherwise): a broker with a VERIFIED packet and NO screening
--   row is never gated here — broker_authority_state returns 'unscreened' and missing data is not
--   evidence. On prod bl_bp_0315 gives every screened broker such a row, so this is only a gap for
--   accounts staff verified entirely by hand.
--
-- TEST:     docs/audit-2026-09/tests/bl_bp_0343_rollback_test.sql
-- ROLLBACK: select app_private.bl_bp_0343_rollback();

-- ============================================================================================
-- 0. baseline — the anon-executable SECURITY DEFINER surface must not move (CLAUDE.md §4)
-- ============================================================================================
-- Nothing here creates a public function. The two public functions it re-executes
-- (cc_broker_trust_set, cc_broker_trust_queue) go through CREATE OR REPLACE, which preserves ACL.
-- §13 asserts the surface afterwards; this only records where we started.
do $$
declare n int; v_anon text := '';
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  raise notice 'bl_bp_0343: anon-executable SECURITY DEFINER in public BEFORE = %', n;
  for v_anon in select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                 where ns.nspname='public' and p.proname in ('cc_broker_trust_set','cc_broker_trust_queue')
                   and has_function_privilege('anon', p.oid, 'execute')
  loop raise exception 'bl_bp_0343: % is ALREADY anon-executable before this migration — stop and investigate', v_anon; end loop;
end $$;

-- ============================================================================================
-- 1. tunables — thresholds live in a row so they can be changed without another migration
-- ============================================================================================
create table if not exists app_private.broker_rescreen_config (
  id           boolean primary key default true check (id),
  enabled      boolean not null default true,
  stale_hours  int     not null default 24,   -- (a)/(b): older than this → queue a fresh screen
  alert_days   int     not null default 3,    -- (e): CC alert when no successful check for this long
  block_days   int     not null default 14,   -- (e): posting stops after this long with no successful check
  fail_strikes int     not null default 2,    -- (c): consecutive definite fails before a PASSING broker is stopped
  sweep_limit  int     not null default 40,   -- (b): screens queued per nightly run
  updated_at   timestamptz not null default now()
);
insert into app_private.broker_rescreen_config(id) values (true) on conflict (id) do nothing;

-- ============================================================================================
-- 2. columns — the freshness clock and the strike counter
-- ============================================================================================
-- broker_screenings.outcome stays what it always was: THE VERDICT broker_tier reads.
-- What is new is that a verdict now only moves on evidence we are willing to act on.
alter table app_private.broker_screenings add column if not exists last_pass_at      timestamptz;
alter table app_private.broker_screenings add column if not exists last_attempt_at   timestamptz;
alter table app_private.broker_screenings add column if not exists last_outcome      text;
alter table app_private.broker_screenings add column if not exists consecutive_fail  int not null default 0;
alter table app_private.broker_screenings add column if not exists fail_since        timestamptz;
alter table app_private.broker_screenings add column if not exists fail_alerted_at   timestamptz;
alter table app_private.broker_screenings add column if not exists stale_alerted_at  timestamptz;
alter table app_private.broker_screenings add column if not exists stale_blocked_at  timestamptz;
alter table app_private.broker_screenings add column if not exists auto_requested_at timestamptz;

alter table app_private.agent_parents add column if not exists last_pass_at     timestamptz;
alter table app_private.agent_parents add column if not exists consecutive_fail int not null default 0;

-- BACKFILL — without this every broker that passed before today would read "never confirmed"
-- and the 14-day gate would stop all of them at once on the first run.
update app_private.broker_screenings
   set last_pass_at = coalesce(checked_at, updated_at, created_at),
       last_outcome = coalesce(last_outcome, outcome),
       last_attempt_at = coalesce(last_attempt_at, checked_at, updated_at)
 where outcome = 'pass' and last_pass_at is null;

update app_private.agent_parents
   set last_pass_at = coalesce(screened_at, updated_at, created_at)
 where screen_outcome = 'pass' and last_pass_at is null;

create index if not exists broker_screenings_stale_idx
  on app_private.broker_screenings (last_pass_at) where request_id is null;

-- ============================================================================================
-- 3. the circuit breaker — "unknown is never negative", applied to the whole pipeline at once
-- ============================================================================================
-- If not one broker anywhere has passed in 48 hours, the thing that is broken is our lookup,
-- not everyone's bond. In that state the staleness gate does not fire. A definite FAIL still does:
-- a fail is an answer FMCSA gave us; staleness is only the absence of one.
create or replace function app_private.broker_screen_pipeline_healthy()
returns boolean
language sql stable security definer set search_path to 'app_private, public'
as $$
  select not exists (select 1 from app_private.broker_screenings where last_pass_at is not null)
      or exists (select 1 from app_private.broker_screenings where last_pass_at > now() - interval '48 hours')
      or exists (select 1 from app_private.agent_parents      where last_pass_at > now() - interval '48 hours');
$$;

-- ============================================================================================
-- 4. the derived authority state: ok | fail | stale | unscreened  (STABLE — broker_tier calls it)
-- ============================================================================================
create or replace function app_private.broker_authority_state(p_org uuid)
returns text
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare cfg record; t app_private.broker_trust; s app_private.broker_screenings;
        v_pass timestamptz; v_any boolean; v_usable boolean;
begin
  select * into cfg from app_private.broker_rescreen_config where id;
  if not found or not cfg.enabled then return 'ok'; end if;
  select * into t from app_private.broker_trust where org_id = p_org;

  if coalesce(t.is_agent, false) then
    -- bl_bp_0318: an agent's authority is its parent brokerages'
    select exists (select 1 from app_private.agent_parents ap
                    where ap.agent_org = p_org and ap.declined_at is null and ap.revoked_at is null)
      into v_any;
    if not v_any then return 'unscreened'; end if;
    select exists (select 1 from app_private.agent_parents ap
                    where ap.agent_org = p_org and ap.declined_at is null and ap.revoked_at is null
                      and coalesce(ap.screen_outcome,'') <> 'fail')
      into v_usable;
    if not v_usable then return 'fail'; end if;   -- every brokerage they post under has failed
    select max(ap.last_pass_at) into v_pass
      from app_private.agent_parents ap
     where ap.agent_org = p_org and ap.declined_at is null and ap.revoked_at is null
       and coalesce(ap.screen_outcome,'') <> 'fail';
  else
    select * into s from app_private.broker_screenings where org_id = p_org;
    if s.org_id is null then return 'unscreened'; end if;
    if s.outcome = 'fail' then return 'fail'; end if;
    if s.outcome <> 'pass' then return 'unscreened'; end if;   -- pending/unknown/not_found/error → 0312's own path
    v_pass := s.last_pass_at;
  end if;

  if v_pass is null then return 'ok'; end if;                  -- missing data is not evidence against anyone
  if now() - v_pass <= make_interval(days => cfg.block_days) then return 'ok'; end if;
  if not app_private.broker_screen_pipeline_healthy() then return 'ok'; end if;
  return 'stale';
end $$;

-- ============================================================================================
-- 5. CC alerts and the open-loads flag
-- ============================================================================================
create or replace function app_private.broker_authority_alert(p_org uuid, p_kind text, p_body text)
returns void
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_name text;
begin
  select name into v_name from public.organizations where id = p_org;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','broker.authority.' || p_kind, jsonb_build_object(
      'title', case p_kind
                 when 'fail_1'        then '🟠 FMCSA fail 1 of 2 — '
                 when 'blocked'       then '🔴 Posting paused, FMCSA authority — '
                 when 'stale_3'       then '🟡 No FMCSA answer for days — '
                 when 'stale_blocked' then '🔴 Posting paused, authority unconfirmed — '
                 when 'restored'      then '🟢 Authority confirmed again — '
                 else '🟡 Broker authority — ' end || coalesce(v_name,'?'),
      'body', p_body,
      'tone', case when p_kind in ('blocked','stale_blocked') then 'urgent'
                   when p_kind = 'restored' then 'info' else 'action' end,
      'url', '/app/command-center/#/broker-trust', 'org_id', p_org), 'sent', now());
  exception when others then null; end;
  begin
    perform app_private.log_audit('broker.authority.' || p_kind, 'org', p_org::text, p_org, p_body, null, null);
  exception when others then null; end;
end $$;

-- Re-label a brokerage's OPEN loads. This never cancels, never hides and never touches a booked load.
-- Assigning verification_state fires trg_loads_zz_trust_label, which rewrites the carrier-facing notice
-- for the CURRENT tier — and self-heals the load back to 'verified' once the tier is verified again.
create or replace function app_private.broker_authority_flag_loads(p_org uuid, p_on boolean)
returns int
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_n int;
begin
  update public.loads
     set verification_state = case when p_on then 'partial' else verification_state end
   where broker_org = p_org
     and coalesce(source_type,'partner_portal') = 'partner_portal'
     and coalesce(status,'') = 'available';
  get diagnostics v_n = row_count;
  return coalesce(v_n, 0);
end $$;

-- ============================================================================================
-- 6. the verdict rule — called by broker_screen_collect instead of its blanket UPDATE
-- ============================================================================================
-- Returns the EFFECTIVE outcome (what broker_tier will now read), which is not always the raw answer.
create or replace function app_private.broker_screen_apply(
  p_org uuid, p_raw text, p_reason text, p_ba boolean, p_ca boolean,
  p_car jsonb, p_src text, p_safer text, p_email text, p_dm boolean)
returns text
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare cfg record; s app_private.broker_screenings; v_strikes int; v_name text;
begin
  select * into cfg from app_private.broker_rescreen_config where id;
  select * into s   from app_private.broker_screenings      where org_id = p_org;
  select name into v_name from public.organizations where id = p_org;
  if s.org_id is null then return coalesce(p_raw,'pending'); end if;

  -- FACTS from this answer always land. Only the verdict is handled carefully.
  update app_private.broker_screenings
     set request_id = null, checked_at = now(), auto_requested_at = null,
         last_attempt_at = now(), last_outcome = p_raw,
         broker_authority  = coalesce(p_ba, broker_authority),
         carrier_authority = coalesce(p_ca, carrier_authority),
         legal_name        = coalesce(p_car->>'legalName',  legal_name),
         entity_type       = coalesce(p_car->>'entityType', entity_type),
         phone             = coalesce(p_car->>'phone',      phone),
         fmcsa_email       = coalesce(p_email,  fmcsa_email),
         domain_match      = coalesce(p_dm,     domain_match),
         authority_source  = coalesce(p_src,    authority_source),
         safer_text        = coalesce(p_safer,  safer_text),
         dot_number        = coalesce(dot_number, nullif(p_car->>'dotNumber','')),
         raw               = coalesce(p_car, raw),
         updated_at = now()
   where org_id = p_org;

  -- ---- PASS ----------------------------------------------------------------------------
  if p_raw = 'pass' then
    update app_private.broker_screenings
       set outcome = 'pass', reason = p_reason, last_pass_at = now(),
           consecutive_fail = 0, fail_since = null,
           fail_alerted_at = null, stale_alerted_at = null, stale_blocked_at = null,
           updated_at = now()
     where org_id = p_org;
    if coalesce(s.outcome,'') = 'fail' then
      perform app_private.broker_authority_flag_loads(p_org, false);
      perform app_private.broker_authority_alert(p_org, 'restored',
        coalesce(v_name,'This brokerage') || ' passed FMCSA again — posting restored, open loads re-labelled.');
      begin
        perform app_private.notify_partner(p_org, '✅ Authority confirmed again — posting restored',
          'Today''s FMCSA check confirms your broker authority is active. Posting is back on.',
          'success', '/app/partner/#post');
      exception when others then null; end;
    end if;
    return 'pass';
  end if;

  -- ---- UNKNOWN / NOT_FOUND / ERROR ----------------------------------------------------
  if coalesce(p_raw,'') <> 'fail' then
    -- Never screened successfully → there is no good verdict to protect; write through as bl_bp_0312 did.
    if s.last_pass_at is null and coalesce(s.outcome,'') <> 'pass' then
      update app_private.broker_screenings set outcome = p_raw, reason = p_reason, updated_at = now()
       where org_id = p_org;
      return p_raw;
    end if;
    -- Has passed before → an unreadable answer changes NOTHING. last_pass_at does not advance,
    -- so §(e) will still notice if this keeps happening.
    return s.outcome;
  end if;

  -- ---- FAIL ---------------------------------------------------------------------------
  -- Never passed: the first fail stands, unchanged from bl_bp_0312.
  if s.last_pass_at is null or coalesce(s.outcome,'') <> 'pass' then
    update app_private.broker_screenings
       set outcome = 'fail', reason = p_reason,
           consecutive_fail = coalesce(consecutive_fail,0) + 1,
           fail_since = coalesce(fail_since, now()), updated_at = now()
     where org_id = p_org;
    return 'fail';
  end if;

  -- Has passed before: count the strike first.
  update app_private.broker_screenings
     set consecutive_fail = coalesce(consecutive_fail,0) + 1, reason = p_reason, updated_at = now()
   where org_id = p_org
  returning consecutive_fail into v_strikes;

  if v_strikes < coalesce(cfg.fail_strikes, 2) then
    if s.fail_alerted_at is null then
      update app_private.broker_screenings set fail_alerted_at = now() where org_id = p_org;
      perform app_private.broker_authority_alert(p_org, 'fail_1',
        coalesce(v_name,'A brokerage') || ' failed one FMCSA authority check: ' || coalesce(p_reason,'no reason given')
        || ' — nothing is blocked. A second consecutive fail pauses new posting. FMCSA has been wrong on a single read before.');
    end if;
    return 'pass';   -- verdict unchanged
  end if;

  update app_private.broker_screenings
     set outcome = 'fail', fail_since = coalesce(fail_since, now()), updated_at = now()
   where org_id = p_org;
  perform app_private.broker_authority_flag_loads(p_org, true);
  perform app_private.broker_authority_alert(p_org, 'blocked',
    coalesce(v_name,'A brokerage') || ' failed ' || v_strikes || ' FMCSA authority checks in a row: '
    || coalesce(p_reason,'no reason given')
    || ' — new posting paused, open loads are request-to-book only. Nothing was cancelled; booked trips, tracking, invoices and payments are untouched.');
  return 'fail';
end $$;

-- ============================================================================================
-- 7. broker_tier — bl_bp_0318's body, with the authority gate ahead of 'verified'
-- ============================================================================================
create or replace function app_private.broker_tier(p_org uuid)
returns text
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare t app_private.broker_trust; s app_private.broker_screenings; idn app_private.broker_identity;
        v_kind text; v_auth text;
begin
  select kind into v_kind from public.organizations where id = p_org;
  if v_kind is null then return 'new'; end if;
  select * into t from app_private.broker_trust where org_id = p_org;
  if t.org_id is not null and t.hold_reason is not null then return 'hold'; end if;
  -- bl_bp_0343: a repeated definite FMCSA answer, or 14 days of silence, outranks a verified packet.
  -- 'unknown' / 'not_found' / 'error' never reach here — broker_screen_apply does not let them stick.
  v_auth := app_private.broker_authority_state(p_org);
  if v_auth = 'fail'  then return 'authority_fail';  end if;
  if v_auth = 'stale' then return 'authority_stale'; end if;
  if app_private.org_onboarding_complete(p_org) then return 'verified'; end if;
  if coalesce(t.is_agent, false) then
    -- bl_bp_0318: per-brokerage rows
    if exists (select 1 from app_private.agent_parents ap where ap.agent_org = p_org and ap.confirmed_at is not null and ap.declined_at is null and ap.revoked_at is null) then return 'agent_confirmed'; end if;
    if exists (select 1 from app_private.agent_parents ap where ap.agent_org = p_org and ap.screen_outcome = 'pass' and ap.declined_at is null and ap.revoked_at is null) then return 'agent_pending'; end if;
    return 'new';
  end if;
  select * into s from app_private.broker_screenings where org_id = p_org;
  if s.org_id is null or s.outcome <> 'pass' then return 'new'; end if;
  select * into idn from app_private.broker_identity where org_id = p_org;
  if idn.org_id is null or idn.status <> 'verified' then return 'unclaimed'; end if;
  return 'screened';
end $$;

-- ============================================================================================
-- 8. surgery on the live definitions (each anchored; each refuses to patch blind)
-- ============================================================================================

-- 8a. broker_can_post — two new branches, right after 'hold'
do $mig$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='app_private' and p.proname='broker_can_post';
  if v_def is null then raise exception 'bl_bp_0343: broker_can_post missing'; end if;
  if position('authority_fail' in v_def) > 0 then raise notice 'bl_bp_0343: broker_can_post already patched'; return; end if;
  v_old := E'  elsif v_tier = ''hold'' then\n    reason := ''Posting is on hold: '' || coalesce(t.hold_reason, ''contact support'');\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: broker_can_post hold anchor not found — refusing to patch blind'; end if;
  v_new := v_old ||
E'  elsif v_tier = ''authority_fail'' then\n' ||
E'    reason := ''FMCSA no longer shows active broker authority for this MC''\n' ||
E'              || coalesce('' — '' || s.reason, '''')\n' ||
E'              || ''. New posting is paused. Nothing already booked was cancelled — trips, tracking, invoices and payments keep running.''\n' ||
E'              || '' Send us the current FMCSA record and we will restore posting the same day.'';\n' ||
E'  elsif v_tier = ''authority_stale'' then\n' ||
E'    reason := ''We have not been able to confirm your broker authority with FMCSA since ''\n' ||
E'              || coalesce(to_char(s.last_pass_at, ''Mon FMDD''), ''the last successful check'')\n' ||
E'              || ''. Posting is paused until a check succeeds. This is usually our lookup rather than anything on your side — contact support and we will verify it by hand.'';\n';
  execute replace(v_def, v_old, v_new);
end $mig$;

-- 8b. trust_label_load — an honest carrier-facing notice. The existing label claims
--     "broker authority verified live on FMCSA (bond on file)" — that sentence must never
--     appear on a load whose authority we can no longer confirm.
do $mig$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='app_private' and p.proname='trust_label_load';
  if v_def is null then raise exception 'bl_bp_0343: trust_label_load missing'; end if;
  if position('bl_bp_0343' in v_def) > 0 then raise notice 'bl_bp_0343: trust_label_load already patched'; return; end if;
  v_old := E'           || ''Booking goes through request-to-book: the broker approves and LoadBoot dispatch confirms the rate confirmation before you roll.'' end));\n  return NEW;\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: trust_label_load label anchor not found — refusing to patch blind'; end if;
  v_new :=
E'           || ''Booking goes through request-to-book: the broker approves and LoadBoot dispatch confirms the rate confirmation before you roll.'' end));\n' ||
E'  -- bl_bp_0343: never claim a live FMCSA verification we no longer have\n' ||
E'  if v_tier in (''authority_fail'',''authority_stale'') then\n' ||
E'    NEW.details := coalesce(NEW.details,''{}''::jsonb) || jsonb_build_object(''source_notice'', jsonb_build_object(\n' ||
E'      ''provider'', coalesce(''an agent of '' || v_name, ''this brokerage''),\n' ||
E'      ''bookable'', true, ''request_only'', true, ''tier'', v_tier,\n' ||
E'      ''label'', case when v_tier = ''authority_fail''\n' ||
E'        then ''LoadBoot could not confirm this brokerage''''s broker authority on its two most recent FMCSA checks. The load stays on the board, but booking is by request only and LoadBoot dispatch confirms the rate confirmation with the brokerage before you roll.''\n' ||
E'        else ''LoadBoot has not been able to reach FMCSA to re-confirm this brokerage''''s authority recently. Booking is by request only until we can. This is a LoadBoot lookup problem, not a finding against the brokerage.'' end));\n' ||
E'  end if;\n  return NEW;\n';
  execute replace(v_def, v_old, v_new);
end $mig$;

-- 8c. enforce_trust_gate_not_bookable — the two new tiers must never book instantly
do $mig$
declare v_def text; v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='app_private' and p.proname='enforce_trust_gate_not_bookable';
  if v_def is null then raise exception 'bl_bp_0343: enforce_trust_gate_not_bookable missing'; end if;
  if position('authority_fail' in v_def) > 0 then raise notice 'bl_bp_0343: trust gate already patched'; return; end if;
  v_old := E'  if v_tier in (''hold'',''agent_pending'',''new'') then\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: trust gate anchor not found — refusing to patch blind'; end if;
  execute replace(v_def, v_old,
    E'  if v_tier in (''hold'',''agent_pending'',''new'',''authority_fail'',''authority_stale'') then  -- bl_bp_0343\n');
end $mig$;

-- 8d. enforce_partner_onboarded — (a) post-time refresh, fire-and-continue
do $mig$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='app_private' and p.proname='enforce_partner_onboarded';
  if v_def is null then raise exception 'bl_bp_0343: enforce_partner_onboarded missing'; end if;
  if position('broker_screen_refresh_if_stale' in v_def) > 0 then raise notice 'bl_bp_0343: enforce_partner_onboarded already patched'; return; end if;
  v_old := E'  if exists (select 1 from public.organizations o where o.id = v_org and o.kind = ''broker'') then\n    perform app_private.assert_broker_can_post(v_org);\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: enforce_partner_onboarded broker anchor not found — refusing to patch blind'; end if;
  v_new :=
E'  if exists (select 1 from public.organizations o where o.id = v_org and o.kind = ''broker'') then\n' ||
E'    -- bl_bp_0343: last successful FMCSA check older than the staleness window → queue a fresh one.\n' ||
E'    -- Fire and continue. The answer lands within a minute via broker_screen_collect; a post is never\n' ||
E'    -- held waiting for FMCSA and "no answer yet" is never read as a negative.\n' ||
E'    begin perform app_private.broker_screen_refresh_if_stale(v_org); exception when others then null; end;\n' ||
E'    perform app_private.assert_broker_can_post(v_org);\n';
  execute replace(v_def, v_old, v_new);
end $mig$;

-- 8e. broker_screen_collect — four anchors. The blanket "outcome = v_out" becomes the verdict rule.
do $mig$
declare v_def text; v_old text; v_new text; v_hits int := 0;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='app_private' and p.proname='broker_screen_collect';
  if v_def is null then raise exception 'bl_bp_0343: broker_screen_collect missing'; end if;
  if position('broker_screen_apply' in v_def) > 0 then raise notice 'bl_bp_0343: broker_screen_collect already patched'; return; end if;

  -- (1) two new locals
  v_old := E'        v_owner_email text; v_fmcsa_email text; v_dm boolean; t app_private.broker_trust; v_org_name text;\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: collect declare anchor not found — refusing to patch blind'; end if;
  v_def := replace(v_def, v_old, v_old || E'        v_prev text; v_prev_raw text; v_eff text;  -- bl_bp_0343\n');

  -- (2) the blanket verdict UPDATE → the verdict rule
  v_old :=
E'    update app_private.broker_screenings\n' ||
E'       set request_id = null, checked_at = now(), outcome = v_out, reason = v_reason,\n' ||
E'           broker_authority = v_ba, carrier_authority = v_ca,\n' ||
E'           legal_name = car->>''legalName'', entity_type = car->>''entityType'',\n' ||
E'           phone = car->>''phone'', fmcsa_email = v_fmcsa_email, domain_match = v_dm,\n' ||
E'           authority_source = v_src, safer_text = v_safer_tx,\n' ||
E'           dot_number = coalesce(dot_number, nullif(car->>''dotNumber'','''')),\n' ||
E'           raw = car, updated_at = now()\n' ||
E'     where org_id = r.org_id;\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: collect UPDATE anchor not found — refusing to patch blind'; end if;
  v_new :=
E'    -- bl_bp_0343: the raw answer no longer writes straight through. broker_screen_apply lands the\n' ||
E'    -- facts, then decides whether the VERDICT moves: unknown/not_found/error never demote a broker\n' ||
E'    -- that has passed before, and a fail needs two in a row before it stops one.\n' ||
E'    select outcome, last_outcome into v_prev, v_prev_raw from app_private.broker_screenings where org_id = r.org_id;\n' ||
E'    v_eff := app_private.broker_screen_apply(r.org_id, v_out, v_reason, v_ba, v_ca, car, v_src, v_safer_tx, v_fmcsa_email, v_dm);\n';
  v_def := replace(v_def, v_old, v_new);

  -- (3) MC-collision is deterministic, not a flaky FMCSA read: it blocks at once and must still notify
  v_old := E'            update app_private.broker_screenings set outcome = v_out, reason = v_reason, updated_at = now() where org_id = r.org_id;\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: collect MC-collision anchor not found — refusing to patch blind'; end if;
  v_def := replace(v_def, v_old, v_old ||
E'            v_eff := ''fail''; v_prev := null;  -- bl_bp_0343: duplicate MC is deterministic, no second strike needed\n');

  -- (4) notify the broker on a CHANGE of verdict, not on every nightly re-confirmation
  v_old := E'    if v_out = ''pass'' then\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: collect pass-branch anchor not found — refusing to patch blind'; end if;
  v_def := replace(v_def, v_old, E'    if v_eff = ''pass'' and v_prev is distinct from ''pass'' then  -- bl_bp_0343: only on change\n');

  v_old := E'    elsif v_out = ''fail'' then\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: collect fail-branch anchor not found — refusing to patch blind'; end if;
  v_def := replace(v_def, v_old, E'    elsif v_eff = ''fail'' and v_prev is distinct from ''fail'' then  -- bl_bp_0343: only on change\n');


  -- (5) the staff row: a nightly re-confirmation that changes nothing is not news
  v_old :=
E'    begin\n' ||
E'      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)\n' ||
E'      values (''staff'',''in_app'',''broker.screened'', jsonb_build_object(\n' ||
E'        ''title'', case v_out when ''pass'' then ''🟢 Broker screened — '' when ''fail'' then ''🔴 Broker screening FAILED — '' else ''🟡 Broker screening needs a human — '' end || coalesce(v_org_name,''?''),\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: collect staff-notification anchor not found — refusing to patch blind'; end if;
  v_new :=
E'    -- bl_bp_0343: staff hear about a first screening, a change of verdict, a change in what FMCSA\n' ||
E'    -- said, or a domain mismatch. A clean nightly re-confirmation is silent.\n' ||
E'    if v_prev is null or v_prev is distinct from v_eff or v_prev_raw is distinct from v_out or v_dm is false then\n' ||
E'    begin\n' ||
E'      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)\n' ||
E'      values (''staff'',''in_app'',''broker.screened'', jsonb_build_object(\n' ||
E'        ''title'', case when v_out = ''pass'' and v_prev = ''pass'' then ''🟢 Broker re-screened — ''\n' ||
E'                       when v_out = ''pass'' then ''🟢 Broker screened — ''\n' ||
E'                       when v_out = ''fail'' and v_eff is distinct from ''fail'' then ''🟠 FMCSA fail 1 of 2, nothing blocked — ''\n' ||
E'                       when v_out = ''fail'' then ''🔴 Broker screening FAILED — ''\n' ||
E'                       else ''🟡 Broker screening needs a human — '' end || coalesce(v_org_name,''?''),\n';
  v_def := replace(v_def, v_old, v_new);

  v_old := E'        ''tone'', case v_out when ''pass'' then ''info'' when ''fail'' then ''urgent'' else ''action'' end,\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: collect tone anchor not found — refusing to patch blind'; end if;
  v_def := replace(v_def, v_old,
E'        ''tone'', case when v_out = ''fail'' and v_eff = ''fail'' then ''urgent''\n' ||
E'                      when v_out = ''pass'' then ''info'' else ''action'' end,  -- bl_bp_0343\n');

  v_old := E'    exception when others then null; end;\n    perform app_private.log_audit(''broker.screened'',''org'', r.org_id::text, r.org_id,\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: collect staff-notification close anchor not found — refusing to patch blind'; end if;
  v_def := replace(v_def, v_old,
E'    exception when others then null; end;\n    end if;  -- bl_bp_0343\n    perform app_private.log_audit(''broker.screened'',''org'', r.org_id::text, r.org_id,\n');

  execute v_def;
end $mig$;

-- 8f. agent_parent_screened — carry the clock and the strike count out to the per-brokerage rows
do $mig$
declare v_def text; v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='app_private' and p.proname='agent_parent_screened';
  if v_def is null then raise notice 'bl_bp_0343: agent_parent_screened missing — skipped'; return; end if;
  if position('bl_bp_0343' in v_def) > 0 then raise notice 'bl_bp_0343: agent_parent_screened already patched'; return; end if;
  v_old := E'     set screen_outcome = s.outcome, screen_reason = s.reason, screen_source = s.authority_source, screened_at = coalesce(s.checked_at, now()),\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: agent_parent_screened anchor not found — refusing to patch blind'; end if;
  execute replace(v_def, v_old, v_old ||
E'         last_pass_at = case when s.outcome = ''pass'' then coalesce(s.last_pass_at, now()) else last_pass_at end,  -- bl_bp_0343\n' ||
E'         consecutive_fail = coalesce(s.consecutive_fail, 0),\n');
end $mig$;

-- 8g. cc_broker_trust_set 'pass' (staff verified by hand) must clear the fail and un-flag the loads
do $mig$
declare v_def text; v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='cc_broker_trust_set';
  if v_def is null then raise exception 'bl_bp_0343: cc_broker_trust_set missing'; end if;
  if position('bl_bp_0343' in v_def) > 0 then raise notice 'bl_bp_0343: cc_broker_trust_set already patched'; return; end if;
  v_old :=
E'    on conflict (org_id) do update set outcome = ''pass'', reason = excluded.reason, checked_at = now(), request_id = null,\n' ||
E'      authority_source = ''staff'', broker_authority = true, updated_at = now();\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: cc_broker_trust_set pass anchor not found — refusing to patch blind'; end if;
  execute replace(v_def, v_old,
E'    on conflict (org_id) do update set outcome = ''pass'', reason = excluded.reason, checked_at = now(), request_id = null,\n' ||
E'      authority_source = ''staff'', broker_authority = true, updated_at = now(),\n' ||
E'      last_pass_at = now(), last_attempt_at = now(), last_outcome = ''pass'',  -- bl_bp_0343\n' ||
E'      consecutive_fail = 0, fail_since = null, fail_alerted_at = null, stale_alerted_at = null, stale_blocked_at = null;\n' ||
E'    perform app_private.broker_authority_flag_loads(p_org, false);  -- bl_bp_0343: staff verdict clears the flag\n');
end $mig$;

-- 8h. cc_broker_trust_queue — sort the two new tiers to the top of the staff queue (cosmetic)
do $mig$
declare v_def text; v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='cc_broker_trust_queue';
  if v_def is null then raise notice 'bl_bp_0343: cc_broker_trust_queue missing — skipped'; return; end if;
  if position('authority_fail' in v_def) > 0 then raise notice 'bl_bp_0343: cc queue already patched'; return; end if;
  v_old := E'case c.tier when ''agent_pending'' then 0';
  if position(v_old in v_def) = 0 then
    raise notice 'bl_bp_0343: cc_broker_trust_queue sort anchor not found — ordering left as-is (cosmetic only)';
    return;
  end if;
  execute replace(v_def, v_old, E'case c.tier when ''authority_fail'' then -1 when ''authority_stale'' then -1 when ''agent_pending'' then 0');
end $mig$;

-- ============================================================================================
-- 9. brokers leave the carrier poll — one kind, one field, one check a day
-- ============================================================================================
do $mig$
declare v_def text; v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='app_private' and p.proname='fmcsa_authority_dispatch';
  if v_def is null then raise notice 'bl_bp_0343: fmcsa_authority_dispatch missing — skipped'; return; end if;
  if position('bl_bp_0343' in v_def) > 0 then raise notice 'bl_bp_0343: dispatch already patched'; return; end if;
  v_old := E'     where o.kind in (''broker'',''carrier'')\n';
  if position(v_old in v_def) = 0 then raise exception 'bl_bp_0343: fmcsa_authority_dispatch kind anchor not found — refusing to patch blind'; end if;
  execute replace(v_def, v_old,
E'     where o.kind = ''carrier''  -- bl_bp_0343: brokers are re-screened by broker_rescreen_sweep().\n' ||
E'                                --   authority_checks.authority_status is CARRIER authority (see bl_cmp_0326):\n' ||
E'                                --   a legal broker-only docket reads ''inactive'' there. Wrong field for a broker.\n');
end $mig$;

-- ============================================================================================
-- 10. (a) post-time refresh  and  (b) the nightly sweep
-- ============================================================================================
create or replace function app_private.broker_rescreen_agent_mc(p_org uuid)
returns text
language sql stable security definer set search_path to 'app_private, public'
as $$
  select ap.parent_mc from app_private.agent_parents ap
   where ap.agent_org = p_org and ap.declined_at is null and ap.revoked_at is null
   order by coalesce(ap.last_pass_at, ap.screened_at, to_timestamp(0)) asc, ap.created_at asc
   limit 1;
$$;

create or replace function app_private.broker_screen_refresh_if_stale(p_org uuid)
returns boolean
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare cfg record; s app_private.broker_screenings; t app_private.broker_trust; v_mc text;
begin
  select * into cfg from app_private.broker_rescreen_config where id;
  if not found or not cfg.enabled then return false; end if;
  select * into s from app_private.broker_screenings where org_id = p_org;
  if s.org_id is null then return false; end if;                                   -- never screened: onboarding owns that
  if s.request_id is not null then return false; end if;                           -- one already in flight
  if s.auto_requested_at > now() - interval '1 hour' then return false; end if;    -- a burst of posts must not become a burst of lookups
  if s.last_pass_at > now() - make_interval(hours => cfg.stale_hours) then return false; end if;

  select * into t from app_private.broker_trust where org_id = p_org;
  v_mc := coalesce(case when coalesce(t.is_agent,false) then app_private.broker_rescreen_agent_mc(p_org) end,
                   s.mc_number,
                   (select mc_number from public.organizations where id = p_org));
  if v_mc is null and s.dot_number is null then return false; end if;

  update app_private.broker_screenings set auto_requested_at = now() where org_id = p_org;
  begin
    perform app_private.broker_screen_request(p_org, v_mc, s.dot_number);
  exception when others then
    return false;   -- a re-screen must never be the reason a load could not be posted
  end;
  return true;
end $$;

create or replace function app_private.broker_rescreen_sweep(p_limit int default null)
returns jsonb
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare cfg record; r record; t app_private.broker_trust;
        v_sent int := 0; v_alert int := 0; v_block int := 0; v_lim int; v_mc text;
begin
  select * into cfg from app_private.broker_rescreen_config where id;
  if not found or not cfg.enabled then
    return jsonb_build_object('status','disabled','note','app_private.broker_rescreen_config missing or disabled.');
  end if;
  v_lim := greatest(1, least(coalesce(p_limit, cfg.sweep_limit, 40), 200));

  -- 1. queue a fresh screen for every broker whose last SUCCESSFUL check is stale
  for r in
    select s.org_id, s.mc_number, s.dot_number
      from app_private.broker_screenings s
      join public.organizations o on o.id = s.org_id
     where o.kind = 'broker'
       and not coalesce(o.is_demo, false)
       and coalesce(o.status,'') <> 'archived'
       and s.request_id is null
       and coalesce(s.outcome,'') in ('pass','fail','unknown','not_found','error')
       and coalesce(s.auto_requested_at, to_timestamp(0)) < now() - make_interval(hours => cfg.stale_hours)
       and coalesce(s.last_pass_at,      to_timestamp(0)) < now() - make_interval(hours => cfg.stale_hours)
     order by coalesce(s.last_pass_at, to_timestamp(0)) asc
     limit v_lim
  loop
    select * into t from app_private.broker_trust where org_id = r.org_id;
    v_mc := coalesce(case when coalesce(t.is_agent,false) then app_private.broker_rescreen_agent_mc(r.org_id) end,
                     r.mc_number, (select mc_number from public.organizations where id = r.org_id));
    if v_mc is null and r.dot_number is null then continue; end if;
    update app_private.broker_screenings set auto_requested_at = now() where org_id = r.org_id;
    begin
      perform app_private.broker_screen_request(r.org_id, v_mc, r.dot_number);
      v_sent := v_sent + 1;
    exception when others then null; end;
  end loop;

  -- 2. day-N alert: still passing, but we have not been able to re-confirm it
  for r in
    select s.org_id from app_private.broker_screenings s
      join public.organizations o on o.id = s.org_id
     where o.kind = 'broker' and not coalesce(o.is_demo,false) and coalesce(o.status,'') <> 'archived'
       and s.outcome = 'pass' and s.last_pass_at is not null
       and s.last_pass_at < now() - make_interval(days => cfg.alert_days)
       and s.stale_alerted_at is null
  loop
    update app_private.broker_screenings set stale_alerted_at = now() where org_id = r.org_id;
    perform app_private.broker_authority_alert(r.org_id, 'stale_3',
      'No successful FMCSA authority check for ' || cfg.alert_days || '+ days. Nothing is blocked. Posting pauses at day '
      || cfg.block_days || ' if it still cannot be confirmed — check fmcsa-verify and its FMCSA_WEBKEY before blaming the brokerage.');
    v_alert := v_alert + 1;
  end loop;

  -- 3. the 14-day gate has started stopping someone: flag their open loads, tell CC. Never cancel.
  for r in
    select s.org_id from app_private.broker_screenings s
      join public.organizations o on o.id = s.org_id
     where o.kind = 'broker' and not coalesce(o.is_demo,false) and coalesce(o.status,'') <> 'archived'
       and app_private.broker_authority_state(s.org_id) = 'stale'
       and coalesce(s.stale_blocked_at, to_timestamp(0)) < now() - interval '7 days'
  loop
    update app_private.broker_screenings set stale_blocked_at = now() where org_id = r.org_id;
    perform app_private.broker_authority_flag_loads(r.org_id, true);
    perform app_private.broker_authority_alert(r.org_id, 'stale_blocked',
      'New posting paused: no successful FMCSA authority check for ' || cfg.block_days || '+ days. Open loads are request-to-book only, nothing was cancelled. '
      || 'If FMCSA is the problem rather than the brokerage, clear it with Verify by hand in the broker-trust queue.');
    v_block := v_block + 1;
  end loop;

  return jsonb_build_object('status','ok','requeued',v_sent,'stale_alerts',v_alert,'stale_blocks',v_block,
                            'pipeline_healthy', app_private.broker_screen_pipeline_healthy(), 'ran_at', now());
end $$;


-- Explicit revokes on the new app_private helpers. Not strictly required — anon has no USAGE on
-- app_private, which is the real barrier (238 of 355 existing app_private functions carry the
-- default EXECUTE-to-PUBLIC and are unreachable for exactly that reason) — but these are the
-- functions that decide whether a brokerage can post, so they get the belt as well as the braces.
revoke all on function app_private.broker_screen_pipeline_healthy()                                     from public, anon;
revoke all on function app_private.broker_authority_state(uuid)                                          from public, anon;
revoke all on function app_private.broker_authority_alert(uuid, text, text)                              from public, anon;
revoke all on function app_private.broker_authority_flag_loads(uuid, boolean)                            from public, anon;
revoke all on function app_private.broker_screen_apply(uuid, text, text, boolean, boolean, jsonb, text, text, text, boolean) from public, anon;
revoke all on function app_private.broker_rescreen_agent_mc(uuid)                                        from public, anon;
revoke all on function app_private.broker_screen_refresh_if_stale(uuid)                                  from public, anon;
revoke all on function app_private.broker_rescreen_sweep(int)                                            from public, anon;

-- ============================================================================================
-- 11. cron — 07:00 UTC, after bl_cmp_0324's 06:10 carrier dispatch, so the two never share a minute.
--     Collection is already handled: lb-broker-screen-collect runs every minute (bl_bp_0312).
-- ============================================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'lb-broker-rescreen-sweep') then
      perform cron.schedule('lb-broker-rescreen-sweep', '0 7 * * *', $c$select app_private.broker_rescreen_sweep();$c$);
    end if;
  else
    raise notice 'bl_bp_0343: pg_cron absent — schedule broker_rescreen_sweep() by hand on this environment';
  end if;
end $$;

-- ============================================================================================
-- 12. rollback
-- ============================================================================================
create or replace function app_private.bl_bp_0343_rollback()
returns text
language plpgsql security definer set search_path to 'app_private, public'
as $$
begin
  update app_private.broker_rescreen_config set enabled = false, updated_at = now() where id;
  begin
    if exists (select 1 from cron.job where jobname = 'lb-broker-rescreen-sweep') then
      perform cron.unschedule('lb-broker-rescreen-sweep');
    end if;
  exception when others then null; end;
  -- With enabled=false, broker_authority_state() returns 'ok' for everyone, so broker_tier never
  -- returns authority_fail / authority_stale and every gate above is inert. The columns, the strike
  -- history and the sticky-verdict rule stay (they are strictly safer than the blanket overwrite);
  -- outcome='fail' rows set by a second strike are cleared with the CC "Verify by hand" action.
  return 'bl_bp_0343 disabled: config off, nightly sweep unscheduled, all new tiers inert.';
end $$;

-- bl_bp_0343 fix (9 Sep 2026): this revoke used to sit in the block above, before the function
-- it names existed. On any database without it the migration aborted with 42883.
revoke all on function app_private.bl_bp_0343_rollback() from public, anon;

-- ============================================================================================
-- 13. guards
-- ============================================================================================
do $$
declare n int; r record; bad text := '';
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  raise notice 'bl_bp_0343: anon-executable SECURITY DEFINER in public AFTER = % (this must equal the BEFORE notice; CLAUDE.md §4''s documented 27 is stale — prod read 33 and staging 34 on 9 Sep 2026, untriaged)', n;
  for r in select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname='public' and p.proname in ('cc_broker_trust_set','cc_broker_trust_queue')
              and has_function_privilege('anon', p.oid, 'execute')
  loop raise exception 'bl_bp_0343: CREATE OR REPLACE trap — % became anon-executable', r.proname; end loop;

  -- app_private is walled off by SCHEMA USAGE, not by per-function EXECUTE: PostgreSQL grants
  -- EXECUTE to PUBLIC by default, so has_function_privilege('anon', ...) is true for most of the
  -- schema and means nothing on its own. The invariant that matters is that anon cannot enter it.
  if has_schema_privilege('anon', 'app_private', 'usage') then
    raise exception 'bl_bp_0343: anon has USAGE on app_private — the whole private schema is exposed';
  end if;
  for r in select p.proname from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'app_private'
              and p.proname in ('broker_screen_apply','broker_authority_state','broker_rescreen_sweep',
                                'broker_screen_refresh_if_stale','broker_authority_flag_loads','broker_authority_alert')
              and pg_catalog.array_to_string(p.proacl, ',') like '%anon=X%'
  loop bad := bad || r.proname || ' '; end loop;
  if bad <> '' then raise exception 'bl_bp_0343: ACL leak — anon is granted EXECUTE explicitly on %', bad; end if;
end $$;

-- sanity: every patch landed
do $$
declare miss text := '';
begin
  if (select position('authority_fail' in pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname='broker_can_post') = 0 then miss := miss || 'broker_can_post '; end if;
  if (select position('bl_bp_0343' in pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname='trust_label_load') = 0 then miss := miss || 'trust_label_load '; end if;
  if (select position('authority_fail' in pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname='enforce_trust_gate_not_bookable') = 0 then miss := miss || 'trust_gate '; end if;
  if (select position('broker_screen_refresh_if_stale' in pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname='enforce_partner_onboarded') = 0 then miss := miss || 'enforce_partner_onboarded '; end if;
  if (select position('broker_screen_apply' in pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname='broker_screen_collect') = 0 then miss := miss || 'broker_screen_collect '; end if;
  if miss <> '' then raise exception 'bl_bp_0343: these patches did not land: %', miss; end if;
  raise notice 'bl_bp_0343: all patches verified present';
end $$;
