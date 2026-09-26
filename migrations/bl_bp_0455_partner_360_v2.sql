-- bl_bp_0455 — Partner 360 v2: one role-aware read for Broker / Broker Agent / Shipper 360 screens.
--
-- Why: CC had one generic cc_partner_360 for brokers, agents and shippers — it returned the packet, 12 loads,
-- claims and a timeline, and nothing the trust engine knows (FMCSA screen, identity, brokerage confirmations,
-- shipper business check, posting allowance, agreement, emails sent, in-app notices). Staff had to open the
-- trust queue, the email feed and the audit log to answer "where is this account stuck". The directory
-- (cc_partners_accounts) showed a packet fraction that means nothing for agents and shippers.
--
-- What this adds (all reads, staff-gated, nothing anon):
--   app_private.partner_role(org)        → 'broker' | 'agent' | 'shipper' | 'facility'
--   app_private.partner_journey(org)     → ordered onboarding ladder per role, each step done/current/todo/
--                                          blocked with the timestamp and a staff-facing detail, plus
--                                          stage label, next_action and blockers. Same facts the portal's
--                                          trust card shows the customer, so CC and portal never disagree.
--   public.cc_partner_360(org)           → replaced. Keys kept from v1 (org, profile, packet, loads, claims,
--                                          health, agent, timeline) so nothing breaks, plus: role, owner,
--                                          members, trust (role-specific), journey, packet_summary, agreements,
--                                          load_stats, shipments (shipper), offers, invoices, pay, sla,
--                                          brokerage (agents under this broker), comms (emails + in-app +
--                                          blocked), violations, tasks, docket.
--   public.cc_partners_accounts()        → replaced. Keys kept, plus role, tier, stage, stage_tone,
--                                          next_action, owner_email, last_sign_in_at, email_confirmed,
--                                          loads_30d, unread_notices.
--
-- Anon SECURITY DEFINER surface: unchanged. Both public functions are create-or-replace (ACL kept: they were
-- never anon-executable); the two new helpers live in app_private and get an explicit revoke anyway.
-- Verify after apply: docs/audit-2026-09/anon-secdef-baseline.md query → 36 prod / 35 staging, same names.

-- ---------------------------------------------------------------------------------------------------------
-- 1. role
-- ---------------------------------------------------------------------------------------------------------
create or replace function app_private.partner_role(p_org uuid)
returns text
language sql
stable
security definer
set search_path to 'app_private', 'public'
as $$
  select case
           when o.kind = 'broker' and coalesce(bt.is_agent, false) then 'agent'
           else o.kind
         end
    from public.organizations o
    left join app_private.broker_trust bt on bt.org_id = o.id
   where o.id = p_org;
$$;
revoke execute on function app_private.partner_role(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 2. journey ladder
-- ---------------------------------------------------------------------------------------------------------
create or replace function app_private.partner_journey(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private', 'public'
as $$
declare
  o record; u record; v_role text; v_tier text;
  bt app_private.broker_trust; sc app_private.broker_screenings; idn app_private.broker_identity; st app_private.shipper_trust;
  cp record;
  steps jsonb := '[]'::jsonb;
  v_parents int := 0; v_par_pass int := 0; v_par_conf int := 0; v_par_pend int := 0; v_par_fail int := 0; v_par_needs int := 0;
  v_par_first timestamptz; v_par_conf_at timestamptz; v_par_declined int := 0;
  v_agr_kind text; v_agr_at timestamptz; v_agr_pub boolean;
  v_posts int := 0; v_first_post timestamptz; v_ships int := 0; v_first_ship timestamptz;
  v_mand_total int := 0; v_mand_done int := 0; v_awaiting int := 0; v_rejected int := 0; v_packet_at timestamptz;
  v_stage text; v_tone text; v_next text; v_blockers jsonb := '[]'::jsonb;
begin
  select * into o from public.organizations where id = p_org;
  if o is null then return null; end if;
  select id, email, email_confirmed_at, last_sign_in_at, created_at into u from auth.users where id = o.owner_user_id;
  v_role := app_private.partner_role(p_org);
  select * into bt from app_private.broker_trust where org_id = p_org;
  select * into sc from app_private.broker_screenings where org_id = p_org;
  select * into idn from app_private.broker_identity where org_id = p_org;
  select * into st from app_private.shipper_trust where org_id = p_org;

  if v_role in ('broker', 'agent') then
    v_tier := app_private.broker_tier(p_org);
    select * into cp from app_private.broker_can_post(p_org);
    v_agr_kind := 'broker_carrier';
  elsif v_role = 'shipper' then
    v_tier := app_private.shipper_tier(p_org);
    select * into cp from app_private.shipper_can_post(p_org);
    v_agr_kind := 'broker_shipper';
  else
    v_tier := 'new';
    v_agr_kind := null;
    select false as ok, null::text as tier, null::text as reason, null::int as posting_limit, null::int as active_postings, null::boolean as agreement_ok, null::boolean as first_delivered into cp;
  end if;

  if v_agr_kind is not null then
    select max(accepted_at) into v_agr_at from app_private.org_agreement_acceptances where org_id = p_org and kind = v_agr_kind;
    select exists (select 1 from app_private.master_agreements where kind = v_agr_kind and published) into v_agr_pub;
  end if;

  select count(*), min(created_at) into v_posts, v_first_post from app_private.partner_loads where broker_org = p_org;
  select count(*), min(created_at) into v_ships, v_first_ship from app_private.partner_shipments where shipper_org = p_org;

  select count(*) filter (where app_private.packet_tag_mandatory(t.status_tag)),
         count(*) filter (where app_private.packet_tag_mandatory(t.status_tag) and coalesce(i.status,'pending') in ('verified','waived')),
         count(*) filter (where coalesce(i.status,'') = 'submitted'),
         count(*) filter (where coalesce(i.status,'') = 'rejected'),
         max(i.reviewed_at)
    into v_mand_total, v_mand_done, v_awaiting, v_rejected, v_packet_at
    from app_private.onboarding_packet_templates t
    left join app_private.org_onboarding_items i on i.org_id = p_org and i.item_key = t.item_key
   where t.org_kind = o.kind;

  if v_role = 'agent' then
    select count(*),
           count(*) filter (where screen_outcome = 'pass' and declined_at is null and revoked_at is null),
           count(*) filter (where confirmed_at is not null and declined_at is null and revoked_at is null),
           count(*) filter (where screen_outcome = 'pass' and confirmed_at is null and declined_at is null and revoked_at is null),
           count(*) filter (where screen_outcome = 'fail'),
           count(*) filter (where screen_outcome in ('not_found','unknown','error')),
           count(*) filter (where declined_at is not null or revoked_at is not null),
           min(created_at), min(confirmed_at) filter (where declined_at is null and revoked_at is null)
      into v_parents, v_par_pass, v_par_conf, v_par_pend, v_par_fail, v_par_needs, v_par_declined, v_par_first, v_par_conf_at
      from app_private.agent_parents where agent_org = p_org;
  end if;

  -- helper: append a step; the first non-done step becomes 'current' unless it is 'blocked'
  -- (plpgsql has no closures — inline the rule at each append)
  -- state in: 'done' | 'todo' | 'blocked' | 'skipped'
  -- 1. account
  steps := steps || jsonb_build_object('key','account','label','Account created','state','done','at',o.created_at,
             'detail', coalesce(u.email,'no owner user') || case when o.mc_number is not null then ' · MC ' || o.mc_number else '' end);
  -- 2. email confirmed
  if u.email_confirmed_at is not null then
    steps := steps || jsonb_build_object('key','email','label','Email confirmed','state','done','at',u.email_confirmed_at,
               'detail','Last sign-in ' || coalesce(to_char(u.last_sign_in_at at time zone 'utc','DD Mon HH24:MI') || ' UTC','never'));
  else
    steps := steps || jsonb_build_object('key','email','label','Email confirmed','state','blocked','at',null,
               'detail','Supabase confirmation link not clicked yet — they cannot sign in.','action','resend_confirm');
  end if;

  if v_role = 'broker' then
    -- 3. FMCSA screen
    if sc.org_id is null then
      steps := steps || jsonb_build_object('key','screen','label','FMCSA authority screened','state','todo','at',null,
                 'detail','No MC screened yet. The portal asks for it on first login.','action','trust');
    elsif sc.outcome = 'pass' then
      steps := steps || jsonb_build_object('key','screen','label','FMCSA authority screened','state','done','at',coalesce(sc.last_pass_at, sc.checked_at),
                 'detail', coalesce(sc.legal_name,'') || ' · MC ' || coalesce(sc.mc_number,'?') || ' · broker authority ' || case when sc.broker_authority then 'active' else 'not found' end
                           || case when sc.consecutive_fail > 0 then ' · ' || sc.consecutive_fail || ' recent re-screen failures' else '' end);
    elsif sc.outcome = 'pending' then
      steps := steps || jsonb_build_object('key','screen','label','FMCSA authority screened','state','todo','at',sc.requested_at,
                 'detail','Screening running (requested ' || coalesce(to_char(sc.requested_at at time zone 'utc','DD Mon HH24:MI'),'?') || ' UTC). Collector runs every minute.','action','trust');
    elsif sc.outcome = 'fail' then
      steps := steps || jsonb_build_object('key','screen','label','FMCSA authority screened','state','blocked','at',sc.checked_at,
                 'detail','FAILED — ' || coalesce(sc.reason,'no active broker authority for MC ' || coalesce(sc.mc_number,'?')),'action','trust');
    else
      steps := steps || jsonb_build_object('key','screen','label','FMCSA authority screened','state','blocked','at',sc.checked_at,
                 'detail', upper(coalesce(sc.outcome,'?')) || ' — ' || coalesce(sc.reason,'FMCSA gave no usable answer') || '. Needs a human: verify by hand in Trust actions.','action','trust');
    end if;
    -- 4. identity
    if idn.status = 'verified' then
      steps := steps || jsonb_build_object('key','identity','label','Identity confirmed','state','done','at',idn.verified_at,
                 'detail','Method: ' || coalesce(idn.method,'?') || coalesce(' · by ' || idn.verified_by,''));
    elsif idn.declined_at is not null then
      steps := steps || jsonb_build_object('key','identity','label','Identity confirmed','state','blocked','at',idn.declined_at,
                 'detail','The FMCSA-listed contact DECLINED — possible impersonation. ' || coalesce(idn.note,''),'action','trust');
    elsif sc.outcome = 'pass' then
      steps := steps || jsonb_build_object('key','identity','label','Identity confirmed','state','todo','at',idn.email_sent_at,
                 'detail', case when idn.fmcsa_email is null and idn.fmcsa_phone is null then 'FMCSA lists no email or phone for this MC — only staff can confirm identity.'
                                when idn.email_sent_at is not null then 'Claim email sent to the FMCSA-listed address ' || coalesce(to_char(idn.email_sent_at at time zone 'utc','DD Mon HH24:MI'),'') || ' UTC · resends ' || coalesce(idn.email_resends,0)
                                else 'Waiting: claim email / voice code / domain match' end,'action','trust');
    else
      steps := steps || jsonb_build_object('key','identity','label','Identity confirmed','state','todo','at',null,'detail','After the FMCSA screen passes.');
    end if;
  elsif v_role = 'agent' then
    -- 3. brokerage declared
    if v_parents = 0 then
      steps := steps || jsonb_build_object('key','declare','label','Brokerage declared','state','todo','at',null,
                 'detail','No brokerage MC declared yet. The portal agent card asks for it.','action','trust');
    else
      steps := steps || jsonb_build_object('key','declare','label','Brokerage declared','state','done','at',v_par_first,
                 'detail', v_parents || ' brokerage(s) declared' || case when v_par_declined > 0 then ' · ' || v_par_declined || ' declined/revoked' else '' end);
    end if;
    -- 4. brokerage screened
    if v_parents = 0 then
      steps := steps || jsonb_build_object('key','pscreen','label','Brokerage authority screened','state','todo','at',null,'detail','After a brokerage is declared.');
    elsif v_par_pass > 0 or v_par_conf > 0 then
      steps := steps || jsonb_build_object('key','pscreen','label','Brokerage authority screened','state','done','at',null,
                 'detail', (v_par_pass + v_par_conf) || ' brokerage(s) with active broker authority');
    elsif v_par_needs > 0 then
      steps := steps || jsonb_build_object('key','pscreen','label','Brokerage authority screened','state','blocked','at',null,
                 'detail','FMCSA gave no usable answer for the declared MC (not found / unknown). MC nudge email sent to the agent; a human can verify by hand.','action','trust');
    elsif v_par_fail > 0 then
      steps := steps || jsonb_build_object('key','pscreen','label','Brokerage authority screened','state','blocked','at',null,
                 'detail','The declared MC has no active broker authority. Agent was told to declare the right MC.','action','trust');
    else
      steps := steps || jsonb_build_object('key','pscreen','label','Brokerage authority screened','state','todo','at',null,'detail','Screening running.');
    end if;
    -- 5. brokerage confirmed
    if v_par_conf > 0 then
      steps := steps || jsonb_build_object('key','pconfirm','label','Brokerage confirmed the agent','state','done','at',v_par_conf_at,
                 'detail', v_par_conf || ' confirmed');
    elsif v_par_pend > 0 then
      steps := steps || jsonb_build_object('key','pconfirm','label','Brokerage confirmed the agent','state','todo','at',null,
                 'detail','Confirmation email with a 6-digit code sent to the brokerage. Reminder after 48 h. Staff can confirm from Trust actions if the brokerage answers by phone.','action','trust');
    elsif v_par_declined > 0 and v_par_conf = 0 then
      steps := steps || jsonb_build_object('key','pconfirm','label','Brokerage confirmed the agent','state','blocked','at',null,
                 'detail','The brokerage DECLINED or revoked this agent — account is on hold.','action','trust');
    else
      steps := steps || jsonb_build_object('key','pconfirm','label','Brokerage confirmed the agent','state','todo','at',null,'detail','After the brokerage screen passes.');
    end if;
  elsif v_role = 'shipper' then
    -- 3. business check
    if st.verified_at is not null then
      steps := steps || jsonb_build_object('key','business','label','Business confirmed','state','done','at',st.verified_at,
                 'detail','By ' || coalesce(st.verified_by,'?') || coalesce(' · domain ' || st.domain,'') || case when st.site_ok then ' · website ok' else '' end);
    elsif st.org_id is null then
      steps := steps || jsonb_build_object('key','business','label','Business confirmed','state','todo','at',null,'detail','Domain check not started (starts at registration).','action','trust');
    elsif st.check_outcome = 'free_mail' then
      steps := steps || jsonb_build_object('key','business','label','Business confirmed','state','blocked','at',st.checked_at,
                 'detail','Signed up with a free-mail address (' || coalesce(st.domain,'?') || '). They must verify a company email, or staff verify by hand.','action','trust');
    elsif st.request_id is not null and st.checked_at is null then
      steps := steps || jsonb_build_object('key','business','label','Business confirmed','state','todo','at',st.requested_at,'detail','Domain check running.');
    else
      steps := steps || jsonb_build_object('key','business','label','Business confirmed','state','blocked','at',st.checked_at,
                 'detail', upper(coalesce(st.check_outcome,'?')) || ' — ' || coalesce(st.check_reason,'') || ' · attempts ' || coalesce(st.attempts,0) || '. Verify by hand or ask for a company email.','action','trust');
    end if;
    -- 4. company email (only when free-mail)
    if coalesce(st.free_mail,false) then
      if st.email_verified_at is not null then
        steps := steps || jsonb_build_object('key','company_email','label','Company email verified','state','done','at',st.email_verified_at,'detail',coalesce(st.company_email,''));
      else
        steps := steps || jsonb_build_object('key','company_email','label','Company email verified','state','todo','at',null,
                   'detail','No company email verified yet (6-digit code flow).','action','trust');
      end if;
    end if;
  end if;

  -- agreement
  if v_agr_kind is not null then
    if v_agr_at is not null then
      steps := steps || jsonb_build_object('key','agreement','label',case when v_role='shipper' then 'Shipper Agreement accepted' else 'Master Broker Agreement accepted' end,'state','done','at',v_agr_at,'detail','');
    elsif not coalesce(v_agr_pub,false) then
      steps := steps || jsonb_build_object('key','agreement','label',case when v_role='shipper' then 'Shipper Agreement accepted' else 'Master Broker Agreement accepted' end,'state','blocked','at',null,
                 'detail','No published agreement of kind ' || v_agr_kind || ' — nobody can accept it. Publish it under Legal.','action','legal');
    else
      steps := steps || jsonb_build_object('key','agreement','label',case when v_role='shipper' then 'Shipper Agreement accepted' else 'Master Broker Agreement accepted' end,'state','todo','at',null,
                 'detail','One click in the portal. Posting is gated on it.');
    end if;
  end if;

  -- first post / request
  if v_role = 'shipper' then
    if v_ships > 0 or v_posts > 0 then
      steps := steps || jsonb_build_object('key','first','label','First shipment request','state','done','at',least(coalesce(v_first_ship, v_first_post), coalesce(v_first_post, v_first_ship)),'detail', (v_ships + v_posts) || ' request(s) so far');
    else
      steps := steps || jsonb_build_object('key','first','label','First shipment request','state','todo','at',null,'detail', case when coalesce(cp.ok,false) then 'Can request now.' else coalesce(cp.reason,'Not yet allowed to request.') end);
    end if;
  elsif v_role in ('broker','agent') then
    if v_posts > 0 then
      steps := steps || jsonb_build_object('key','first','label','First load posted','state','done','at',v_first_post,'detail', v_posts || ' load(s) submitted so far');
    else
      steps := steps || jsonb_build_object('key','first','label','First load posted','state','todo','at',null,'detail', case when coalesce(cp.ok,false) then 'Can post now (' || coalesce(cp.posting_limit,0) || ' open postings allowed).' else coalesce(cp.reason,'Not yet allowed to post.') end);
    end if;
  end if;

  -- packet
  if v_mand_total > 0 then
    if v_mand_done >= v_mand_total then
      steps := steps || jsonb_build_object('key','packet','label','Onboarding packet verified','state','done','at',v_packet_at,'detail', v_mand_total || ' required items verified or waived');
    elsif v_rejected > 0 then
      steps := steps || jsonb_build_object('key','packet','label','Onboarding packet verified','state','blocked','at',v_packet_at,
                 'detail', v_mand_done || '/' || v_mand_total || ' required · ' || v_rejected || ' rejected, waiting on a re-upload' || case when v_awaiting > 0 then ' · ' || v_awaiting || ' awaiting review' else '' end,'action','packet');
    elsif v_awaiting > 0 then
      steps := steps || jsonb_build_object('key','packet','label','Onboarding packet verified','state','todo','at',null,
                 'detail', v_awaiting || ' item(s) submitted and AWAITING STAFF REVIEW · ' || v_mand_done || '/' || v_mand_total || ' required done','action','packet');
    else
      steps := steps || jsonb_build_object('key','packet','label','Onboarding packet verified','state','todo','at',null,
                 'detail', v_mand_done || '/' || v_mand_total || ' required done' || case when v_role='agent' then ' (bond / BOC-3 / MC are the brokerage''s — only W-9, bank and claims contact apply)' else '' end,'action','packet');
    end if;
  end if;

  -- approved
  if o.status = 'active' then
    steps := steps || jsonb_build_object('key','approved','label','Account approved','state','done','at',null,'detail','organizations.status = active');
  else
    steps := steps || jsonb_build_object('key','approved','label','Account approved','state','todo','at',null,
               'detail', case when v_role='agent' then 'Approve once a brokerage has confirmed them (tier agent_confirmed) — the packet does not gate an agent.'
                              else 'Approve once every required packet item is verified or waived.' end,'action','approve');
  end if;

  -- mark the first open step as current — unless an earlier step is blocked (then nothing is 'current': the blocker owns the screen)
  steps := (select coalesce(jsonb_agg(case when ord = (select min(ord) from jsonb_array_elements(steps) with ordinality z(s2, ord) where (s2->>'state') in ('todo','current'))
                                            and (s->>'state') in ('todo','current')
                                            and not exists (select 1 from jsonb_array_elements(steps) with ordinality z3(s3, o3) where o3 < x.ord and (s3->>'state') = 'blocked')
                                            then s || '{"state":"current"}'::jsonb
                                           when (s->>'state') = 'current' then s || '{"state":"todo"}'::jsonb
                                           else s end order by ord), '[]'::jsonb)
              from jsonb_array_elements(steps) with ordinality as x(s, ord));
  select coalesce(jsonb_agg(jsonb_build_object('key', s->>'key', 'label', s->>'label', 'detail', s->>'detail', 'action', s->>'action')), '[]'::jsonb)
    into v_blockers from jsonb_array_elements(steps) s where (s->>'state') = 'blocked';

  -- stage label + tone (what the directory shows)
  if v_tier = 'hold' or (v_role='shipper' and st.hold_reason is not null) or (v_role in ('broker','agent') and bt.hold_reason is not null) then
    v_stage := 'On hold'; v_tone := 'red';
    v_next := 'Hold: ' || coalesce(bt.hold_reason, st.hold_reason, '?') || '. Release from Trust actions once fixed.';
  elsif v_tier in ('authority_fail','authority_stale') then
    v_stage := case when v_tier='authority_fail' then 'Authority failed' else 'Authority stale' end; v_tone := 'red';
    v_next := 'Nightly FMCSA re-screen ' || case when v_tier='authority_fail' then 'failed repeatedly' else 'has not confirmed the authority for 14+ days' end || '. Posting paused; open loads are request-only.';
  elsif jsonb_array_length(v_blockers) > 0 then
    v_stage := 'Needs a human'; v_tone := 'red';
    v_next := (v_blockers->0->>'label') || ': ' || (v_blockers->0->>'detail');
  elsif o.status = 'active' and v_tier = 'verified' then
    v_stage := 'Verified'; v_tone := 'green'; v_next := 'Nothing pending. Fully verified and approved.';
  elsif v_tier = 'verified' then
    v_stage := 'Ready to approve'; v_tone := 'green'; v_next := 'Packet complete — click Approve account.';
  elsif v_awaiting > 0 then
    v_stage := 'Review ' || v_awaiting || ' item' || case when v_awaiting=1 then '' else 's' end; v_tone := 'amber';
    v_next := v_awaiting || ' packet item(s) waiting for staff review.';
  elsif v_role='agent' and v_tier = 'agent_confirmed' then
    v_stage := 'Confirmed agent'; v_tone := 'green';
    v_next := case when o.status='active' then 'Posting under a confirmed brokerage. Packet (W-9, bank, claims) optional for unlimited postings.' else 'Brokerage confirmed — Approve account now.' end;
  elsif v_role='agent' and v_tier = 'agent_pending' then
    v_stage := 'Awaiting brokerage'; v_tone := 'amber'; v_next := 'Brokerage has the confirmation code. Reminder auto-sends after 48 h; staff can confirm on a phone call.';
  elsif v_role='broker' and v_tier = 'screened' then
    v_stage := 'Can post (limited)'; v_tone := 'blue'; v_next := 'Screened + identity confirmed. Unlimited postings once the packet is verified.';
  elsif v_role='broker' and v_tier = 'unclaimed' then
    v_stage := 'Identity pending'; v_tone := 'amber'; v_next := 'Authority passed; waiting for the FMCSA-listed contact to confirm identity (email / voice code).';
  elsif v_role='shipper' and v_tier = 'business_verified' then
    v_stage := 'Can request'; v_tone := 'blue'; v_next := 'Business confirmed. Packet (billing, claims contact, agreement) unlocks booking.';
  elsif u.email_confirmed_at is null then
    v_stage := 'Email unconfirmed'; v_tone := 'gray'; v_next := 'They never confirmed the signup email — cannot sign in.';
  else
    v_stage := 'New'; v_tone := 'gray';
    v_next := coalesce((select s->>'label' || ': ' || coalesce(s->>'detail','') from jsonb_array_elements(steps) s where (s->>'state') = 'current' limit 1), 'Just signed up.');
  end if;

  return jsonb_build_object(
    'role', v_role, 'tier', v_tier, 'stage', v_stage, 'stage_tone', v_tone, 'next_action', v_next,
    'can_post', coalesce(cp.ok, false), 'can_post_reason', cp.reason,
    'steps', steps, 'blockers', v_blockers,
    'done', (select count(*) from jsonb_array_elements(steps) s where (s->>'state') = 'done'),
    'total', jsonb_array_length(steps));
end $$;
revoke execute on function app_private.partner_journey(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 3. cc_partner_360 v2
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.cc_partner_360(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private', 'public'
as $function$
declare o record; pr record; u record; v_role text; bt app_private.broker_trust; sc app_private.broker_screenings;
        idn app_private.broker_identity; st app_private.shipper_trust; cp record; v_trust jsonb; v_journey jsonb; v_sla jsonb;
begin
  if not (public.has_global_permission('partners.view') or public.has_global_permission('partners.manage') or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  select * into o from public.organizations where id = p_org and kind in ('broker','shipper','facility');
  if o is null then raise exception 'partner not found' using errcode='22023'; end if;
  select * into pr from app_private.partner_profiles where org_id = p_org;
  select id, email, email_confirmed_at, last_sign_in_at, created_at, raw_user_meta_data into u from auth.users where id = o.owner_user_id;
  v_role := app_private.partner_role(p_org);
  select * into bt from app_private.broker_trust where org_id = p_org;
  select * into sc from app_private.broker_screenings where org_id = p_org;
  select * into idn from app_private.broker_identity where org_id = p_org;
  select * into st from app_private.shipper_trust where org_id = p_org;
  v_journey := app_private.partner_journey(p_org);

  if v_role in ('broker','agent') then
    select * into cp from app_private.broker_can_post(p_org);
    v_trust := jsonb_build_object(
      'tier', app_private.broker_tier(p_org),
      'authority_state', app_private.broker_authority_state(p_org),
      'can_post', cp.ok, 'reason', cp.reason, 'posting_limit', cp.posting_limit, 'active_postings', cp.active_postings,
      'agreement_ok', cp.agreement_ok, 'first_delivered', cp.first_delivered,
      'hold_reason', bt.hold_reason, 'held_at', bt.held_at, 'posting_limit_override', bt.posting_limit_override,
      'screening', case when sc.org_id is null then null else jsonb_build_object(
          'mc', sc.mc_number, 'dot', sc.dot_number, 'outcome', sc.outcome, 'last_outcome', sc.last_outcome, 'reason', sc.reason,
          'legal_name', sc.legal_name, 'entity_type', sc.entity_type, 'broker_authority', sc.broker_authority, 'carrier_authority', sc.carrier_authority,
          'authority_source', sc.authority_source, 'fmcsa_email', sc.fmcsa_email, 'fmcsa_phone', sc.phone, 'domain_match', sc.domain_match,
          'requested_at', sc.requested_at, 'checked_at', sc.checked_at, 'last_pass_at', sc.last_pass_at, 'last_attempt_at', sc.last_attempt_at,
          'attempts', sc.attempts, 'consecutive_fail', sc.consecutive_fail, 'fail_since', sc.fail_since,
          'fail_alerted_at', sc.fail_alerted_at, 'stale_alerted_at', sc.stale_alerted_at, 'stale_blocked_at', sc.stale_blocked_at) end,
      'identity', case when idn.org_id is null then null else jsonb_build_object(
          'status', idn.status, 'method', idn.method, 'fmcsa_email', idn.fmcsa_email, 'fmcsa_phone', idn.fmcsa_phone, 'signup_email', idn.signup_email,
          'email_sent_at', idn.email_sent_at, 'email_resends', idn.email_resends, 'verified_at', idn.verified_at, 'verified_by', idn.verified_by,
          'declined_at', idn.declined_at, 'note', idn.note) end,
      'parents', case when v_role = 'agent' then coalesce((select jsonb_agg(jsonb_build_object(
          'id', ap.id, 'mc', ap.parent_mc, 'name', coalesce(ap.fmcsa_legal_name, ap.parent_legal_name), 'declared_name', ap.parent_legal_name,
          'parent_org_id', ap.parent_org_id, 'on_loadboot', ap.parent_org_id is not null,
          'parent_org_name', (select o2.name from public.organizations o2 where o2.id = ap.parent_org_id),
          'screen', ap.screen_outcome, 'screen_reason', ap.screen_reason, 'screened_at', ap.screened_at, 'last_pass_at', ap.last_pass_at, 'consecutive_fail', ap.consecutive_fail,
          'fmcsa_email', ap.fmcsa_email, 'fmcsa_phone', ap.fmcsa_phone, 'contact_email', ap.contact_email, 'contact_source', ap.contact_source,
          'sent_to', ap.sent_to, 'sent_at', ap.sent_at, 'reminded_at', ap.reminded_at, 'mc_nudge_at', ap.mc_nudge_at,
          'confirmed_at', ap.confirmed_at, 'confirmed_by', ap.confirmed_by, 'declined_at', ap.declined_at, 'revoked_at', ap.revoked_at, 'revoked_by', ap.revoked_by, 'note', ap.note,
          'status', case when ap.revoked_at is not null then 'revoked' when ap.declined_at is not null then 'declined' when ap.confirmed_at is not null then 'confirmed'
                         when ap.screen_outcome = 'pass' then 'pending' when ap.screen_outcome = 'fail' then 'failed'
                         when ap.screen_outcome in ('not_found','unknown','error') then 'needs_human' else 'screening' end,
          'loads', (select count(*) from app_private.partner_loads pl where pl.broker_org = p_org and pl.details->>'agent_parent_id' = ap.id::text))
          order by ap.created_at) from app_private.agent_parents ap where ap.agent_org = p_org), '[]'::jsonb) end,
      'invites_received', case when v_role = 'agent' then coalesce((select jsonb_agg(jsonb_build_object('id', bi.id, 'from', o3.name, 'status', bi.status, 'created_at', bi.created_at, 'accepted_at', bi.accepted_at) order by bi.created_at desc)
          from app_private.broker_agent_invites bi join public.organizations o3 on o3.id = bi.parent_org_id where bi.agent_org_id = p_org or lower(bi.email) = lower(u.email)), '[]'::jsonb) end);
  elsif v_role = 'shipper' then
    select * into cp from app_private.shipper_can_post(p_org);
    v_trust := jsonb_build_object(
      'tier', app_private.shipper_tier(p_org), 'can_post', cp.ok, 'reason', cp.reason,
      'hold_reason', st.hold_reason, 'held_at', st.held_at,
      'domain', st.domain, 'free_mail', st.free_mail, 'company_email', st.company_email, 'email_verified_at', st.email_verified_at,
      'check_outcome', st.check_outcome, 'check_reason', st.check_reason, 'mx', st.mx, 'site_ok', st.site_ok, 'site_title', st.site_title, 'site_url', st.site_url,
      'name_match', st.name_match, 'requested_at', st.requested_at, 'checked_at', st.checked_at, 'attempts', st.attempts, 'dot', st.dot_number,
      'verified_at', st.verified_at, 'verified_by', st.verified_by,
      'code_live', exists (select 1 from app_private.verify_codes v where v.org_id = p_org and v.purpose = 'shipper_email' and v.consumed_at is null and v.expires_at > now()));
  else
    v_trust := jsonb_build_object('tier', 'new');
  end if;

  if v_role in ('broker','agent') then
    begin v_sla := public.cc_broker_sla(p_org, 90); exception when others then v_sla := null; end;
  end if;

  return jsonb_build_object(
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'status', o.status, 'created_at', o.created_at,
                              'mc_number', o.mc_number, 'dot_number', o.dot_number, 'is_demo', coalesce(o.is_demo,false), 'logo_path', o.logo_path, 'broker_visible', o.broker_visible),
    'role', v_role,
    'owner', case when u.id is null then null else jsonb_build_object('id', u.id, 'email', u.email, 'email_confirmed_at', u.email_confirmed_at, 'last_sign_in_at', u.last_sign_in_at,
                'signup_at', u.created_at, 'name', u.raw_user_meta_data->>'name', 'signup_kind', u.raw_user_meta_data->>'partner_kind', 'agent_intent', (u.raw_user_meta_data->>'agent_intent')::boolean) end,
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', om.user_id, 'email', au.email, 'status', om.status, 'joined_at', om.created_at, 'last_sign_in_at', au.last_sign_in_at, 'owner', om.user_id = o.owner_user_id) order by om.created_at)
                from public.organization_memberships om left join auth.users au on au.id = om.user_id where om.org_id = p_org), '[]'::jsonb),
    'profile', case when pr is null then '{}'::jsonb else jsonb_build_object('contact_name', pr.contact_name, 'phone', pr.phone, 'email', pr.email, 'address', pr.address, 'updated_at', pr.updated_at) end,
    'journey', v_journey,
    'trust', v_trust,
    'packet', coalesce((select jsonb_agg(jsonb_build_object(
        'key', t.item_key, 'label', t.label, 'tag', t.status_tag, 'mandatory', app_private.packet_tag_mandatory(t.status_tag),
        'status', coalesce(i.status,'pending'), 'ref', i.ref, 'note', i.note,
        'submitted_at', i.submitted_at, 'reviewed_at', i.reviewed_at, 'expires_at', i.expires_at, 'recheck_due', i.recheck_due, 'lapsed_at', i.lapsed_at,
        'reviewed_by', (select au.email from auth.users au where au.id = i.reviewed_by)) order by t.sort)
      from app_private.onboarding_packet_templates t
      left join app_private.org_onboarding_items i on i.org_id = p_org and i.item_key = t.item_key
      where t.org_kind = o.kind), '[]'::jsonb),
    'packet_summary', (select jsonb_build_object(
        'mandatory_total', count(*) filter (where app_private.packet_tag_mandatory(t.status_tag)),
        'mandatory_done', count(*) filter (where app_private.packet_tag_mandatory(t.status_tag) and coalesce(i.status,'pending') in ('verified','waived')),
        'awaiting', count(*) filter (where coalesce(i.status,'') = 'submitted'),
        'rejected', count(*) filter (where coalesce(i.status,'') = 'rejected'),
        'expiring_30d', count(*) filter (where i.status = 'verified' and i.expires_at is not null and i.expires_at < current_date + 30),
        'lapsed', count(*) filter (where i.lapsed_at is not null))
      from app_private.onboarding_packet_templates t
      left join app_private.org_onboarding_items i on i.org_id = p_org and i.item_key = t.item_key
      where t.org_kind = o.kind),
    'agreements', coalesce((select jsonb_agg(jsonb_build_object('kind', a.kind, 'version', a.version, 'accepted_at', a.accepted_at,
        'accepted_by', (select au.email from auth.users au where au.id = a.accepted_by)) order by a.accepted_at desc) from app_private.org_agreement_acceptances a where a.org_id = p_org), '[]'::jsonb),
    'agreements_published', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'version', m.version, 'title', m.title, 'published_at', m.published_at) order by m.kind, m.version desc)
        from app_private.master_agreements m where m.published and m.kind in ('broker_carrier','broker_shipper')), '[]'::jsonb),
    'loads', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'posted_load_id', pl.posted_load_id, 'reference', pl.reference, 'origin', pl.origin, 'destination', pl.destination, 'equipment', pl.equipment,
        'rate', pl.rate, 'miles', pl.miles, 'pickup_date', pl.pickup_date, 'status', pl.status, 'created_at', pl.created_at, 'submitted_at', pl.submitted_at,
        'board_status', l.status, 'verification_state', l.verification_state, 'is_public', l.is_public, 'expires_at', l.expires_at,
        'agent_parent', pl.details->>'agent_parent_name',
        'trip', (select jsonb_build_object('id', t2.id, 'status', t2.status, 'carrier', org2.name, 'carrier_id', org2.id, 'delivered_at', t2.delivered_at, 'scheduled_delivery', t2.scheduled_delivery)
                   from app_private.trips t2 join public.organizations org2 on org2.id = t2.carrier_id where t2.load_id = pl.posted_load_id order by t2.created_at desc limit 1),
        'offers', (select count(*) from app_private.load_offers lo where lo.load_id = pl.posted_load_id),
        'claims', (select count(*) from app_private.trip_accessorials a join app_private.trips t3 on t3.id = a.trip_id where t3.load_id = pl.posted_load_id)
      ) order by pl.created_at desc)
      from (select * from app_private.partner_loads where broker_org = p_org order by created_at desc limit 20) pl
      left join public.loads l on l.id = pl.posted_load_id), '[]'::jsonb),
    'load_stats', (select jsonb_build_object(
        'total', count(*), 'last_30d', count(*) filter (where pl.created_at > now() - interval '30 days'),
        'submitted', count(*) filter (where pl.status = 'submitted'), 'posted', count(*) filter (where pl.posted_load_id is not null),
        'declined', count(*) filter (where pl.status in ('declined','rejected')), 'cancelled', count(*) filter (where pl.status = 'cancelled'),
        'covered', count(*) filter (where exists (select 1 from app_private.trips t where t.load_id = pl.posted_load_id and t.status not in ('cancelled'))),
        'delivered', count(*) filter (where exists (select 1 from app_private.trips t where t.load_id = pl.posted_load_id and t.status in ('delivered','invoiced'))),
        'open_on_board', count(*) filter (where l.status in ('open','available','posted') and l.is_public))
      from app_private.partner_loads pl left join public.loads l on l.id = pl.posted_load_id where pl.broker_org = p_org),
    'shipments', case when v_role = 'shipper' then coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'origin', s.origin, 'destination', s.destination, 'ready_date', s.ready_date, 'equipment', s.equipment, 'commodity', s.commodity, 'weight', s.weight,
        'status', s.status, 'created_at', s.created_at, 'updated_at', s.updated_at, 'quote_amount', s.quote_amount, 'quoted_at', s.quoted_at,
        'assigned_broker', (select o4.name from public.organizations o4 where o4.id = s.assigned_broker), 'assigned_broker_id', s.assigned_broker,
        'tendered_partner_load', s.tendered_partner_load, 'ref_po', s.ref_po, 'appointment_required', s.appointment_required,
        'complete', coalesce(trim(s.facility_notes),'') <> '' and coalesce(trim(s.dock_hours),'') <> '') order by s.created_at desc)
      from (select * from app_private.partner_shipments where shipper_org = p_org order by created_at desc limit 20) s), '[]'::jsonb) end,
    'shipment_stats', case when v_role = 'shipper' then (select jsonb_build_object('total', count(*), 'open', count(*) filter (where coalesce(status,'') not in ('closed','declined','tendered','booked')),
        'quoted', count(*) filter (where quote_amount is not null), 'booked', count(*) filter (where status in ('booked','tendered','accepted')), 'last_30d', count(*) filter (where created_at > now() - interval '30 days'))
      from app_private.partner_shipments where shipper_org = p_org) end,
    'offers', (select jsonb_build_object('sent', count(*), 'accepted', count(*) filter (where lo.status = 'accepted'), 'declined', count(*) filter (where lo.status = 'declined'),
        'expired', count(*) filter (where lo.status = 'expired'), 'pending', count(*) filter (where lo.status in ('sent','pending','viewed')))
      from app_private.load_offers lo join public.loads l on l.id = lo.load_id where l.broker_org = p_org or l.shipper_org = p_org),
    'invoices', (select jsonb_build_object('count', count(*), 'open', count(*) filter (where coalesce(status,'') not in ('paid','void','cancelled')),
        'overdue', count(*) filter (where coalesce(status,'') not in ('paid','void','cancelled') and due_date is not null and due_date < current_date),
        'open_amount', coalesce(sum(amount) filter (where coalesce(status,'') not in ('paid','void','cancelled')), 0),
        'paid_amount', coalesce(sum(amount) filter (where status = 'paid'), 0), 'last_paid_at', max(paid_at))
      from app_private.partner_invoices where partner_org = p_org),
    'claims', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'status', a.status, 'amount', a.amount,
        'broker_status', a.broker_status, 'support_status', a.support_status, 'created_at', a.created_at,
        'origin', l2.origin, 'destination', l2.destination) order by a.created_at desc)
      from app_private.trip_accessorials a
      join app_private.trips t4 on t4.id = a.trip_id
      join public.loads l2 on l2.id = t4.load_id
      where l2.broker_org = p_org limit 15), '[]'::jsonb),
    'pay', case when v_role in ('broker','agent') then app_private.broker_pay_stats(p_org) end,
    'sla', v_sla,
    'health', (select public.cc_account_health(p_org)),
    'violations', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'kind', v.kind, 'severity', v.severity, 'points', v.points, 'note', v.note, 'created_at', v.created_at, 'resolved_at', v.resolved_at) order by v.created_at desc)
      from (select * from app_private.account_violations where org_id = p_org order by created_at desc limit 10) v), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', tk.id, 'type', tk.task_type, 'title', tk.title, 'status', tk.status, 'priority', tk.priority, 'due_at', tk.due_at, 'created_at', tk.created_at) order by tk.created_at desc)
      from (select * from app_private.automation_tasks where related_id = p_org::text and status = 'open' order by created_at desc limit 10) tk), '[]'::jsonb),
    'update_requests_open', (select count(*) from app_private.update_requests ur where ur.partner_org = p_org and ur.status = 'open'),
    -- agents under this brokerage (when this org is a parent)
    'brokerage', case when v_role = 'broker' then jsonb_build_object(
        'agents', coalesce((select jsonb_agg(jsonb_build_object('agent_org_id', ap.agent_org, 'name', o5.name, 'owner_email', (select au.email from auth.users au where au.id = o5.owner_user_id),
            'status', case when ap.revoked_at is not null then 'revoked' when ap.declined_at is not null then 'declined' when ap.confirmed_at is not null then 'confirmed' else 'pending' end,
            'confirmed_at', ap.confirmed_at, 'declined_at', ap.declined_at, 'revoked_at', ap.revoked_at, 'created_at', ap.created_at,
            'loads', (select count(*) from app_private.partner_loads pl where pl.broker_org = ap.agent_org)) order by ap.created_at desc)
          from app_private.agent_parents ap join public.organizations o5 on o5.id = ap.agent_org where ap.parent_org_id = p_org), '[]'::jsonb),
        'invites', coalesce((select jsonb_agg(jsonb_build_object('id', bi.id, 'email', bi.email, 'name', bi.name, 'status', bi.status, 'created_at', bi.created_at, 'accepted_at', bi.accepted_at, 'agent_org_id', bi.agent_org_id) order by bi.created_at desc)
          from app_private.broker_agent_invites bi where bi.parent_org_id = p_org), '[]'::jsonb)) end,
    -- comms: what left the system for this account, and what was blocked
    'comms', jsonb_build_object(
      'emails', coalesce((select jsonb_agg(jsonb_build_object('id', md.id, 'key', md.template_key, 'channel', md.channel, 'status', md.status, 'to', md.recipient_email,
          'created_at', md.created_at, 'sent_at', md.sent_at, 'delivered_at', md.delivered_at, 'opened_at', md.opened_at, 'clicked_at', md.clicked_at, 'failure', md.failure_reason,
          'name', (select ec.name from app_private.email_catalog ec where ec.key = md.template_key)) order by md.created_at desc)
        from (select * from app_private.message_deliveries md0
               where md0.related_partner = p_org or md0.org_id = p_org
                  or md0.recipient_user in (select om.user_id from public.organization_memberships om where om.org_id = p_org)
                  or (u.email is not null and lower(md0.recipient_email) = lower(u.email))
               order by md0.created_at desc limit 30) md), '[]'::jsonb),
      'notices', coalesce((select jsonb_agg(jsonb_build_object('id', pn.id, 'title', pn.title, 'body', pn.body, 'kind', pn.kind, 'url', pn.url, 'read_at', pn.read_at, 'created_at', pn.created_at) order by pn.created_at desc)
        from (select * from app_private.partner_notifications where partner_org = p_org order by created_at desc limit 30) pn), '[]'::jsonb),
      'unread_notices', (select count(*) from app_private.partner_notifications where partner_org = p_org and read_at is null),
      'blocked', coalesce((select jsonb_agg(jsonb_build_object('key', eb.template_key, 'to', eb.recipient_email, 'reason', eb.reason, 'group', eb.group_code, 'code', eb.code, 'created_at', eb.created_at) order by eb.created_at desc)
        from (select * from app_private.email_blocked_log eb0
               where eb0.recipient_user in (select om.user_id from public.organization_memberships om where om.org_id = p_org)
                  or (u.email is not null and lower(eb0.recipient_email) = lower(u.email))
               order by eb0.created_at desc limit 10) eb), '[]'::jsonb),
      'staff_notices', coalesce((select jsonb_agg(jsonb_build_object('key', n.template_key, 'title', n.payload->>'title', 'body', n.payload->>'body', 'created_at', n.created_at, 'read_at', n.read_at) order by n.created_at desc)
        from (select * from app_private.notifications n0 where n0.recipient_role = 'staff' and n0.created_at > now() - interval '120 days' and n0.payload::text ilike '%' || p_org::text || '%' order by n0.created_at desc limit 15) n), '[]'::jsonb)),
    -- kept for v1 callers
    'agent', case when v_role = 'agent' then jsonb_build_object('tier', app_private.broker_tier(p_org), 'hold_reason', bt.hold_reason,
        'agreement_ok', exists (select 1 from app_private.org_agreement_acceptances a where a.org_id = p_org and a.kind = 'broker_carrier'),
        'parents', v_trust->'parents') end,
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('at', g.occurred_at, 'action', g.action, 'summary', g.summary, 'staff', g.actor_is_staff) order by g.occurred_at desc)
      from (select * from app_private.audit_logs
             where target_org_id = p_org or (target_type = 'org' and target_id = p_org::text)
                or (target_type = 'load' and target_id in (select id::text from public.loads where broker_org = p_org or shipper_org = p_org))
             order by occurred_at desc limit 40) g), '[]'::jsonb));
end; $function$;

-- ---------------------------------------------------------------------------------------------------------
-- 4. cc_partners_accounts v2 — directory rows with a stage instead of a packet fraction
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.cc_partners_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private', 'public'
as $function$
begin
  if not (public.has_global_permission('partners.view') or public.has_global_permission('partners.manage') or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'kind', o.kind, 'status', o.status, 'created_at', o.created_at,
      'email', u.email, 'owner_email', u.email, 'last_sign_in_at', u.last_sign_in_at, 'email_confirmed', u.email_confirmed_at is not null,
      'contact', pp.contact_name, 'phone', pp.phone, 'mc_number', o.mc_number,
      'packet_done', (select count(*) from app_private.onboarding_packet_templates t
                      join app_private.org_onboarding_items i on i.org_id = o.id and i.item_key = t.item_key
                      where t.org_kind = o.kind and app_private.packet_tag_mandatory(t.status_tag) and i.status in ('verified','waived')),
      'packet_total', (select count(*) from app_private.onboarding_packet_templates t where t.org_kind = o.kind and app_private.packet_tag_mandatory(t.status_tag)),
      'awaiting', (select count(*) from app_private.org_onboarding_items i where i.org_id = o.id and i.status = 'submitted'),
      'loads', (select count(*) from app_private.partner_loads pl where pl.broker_org = o.id) + (select count(*) from app_private.partner_shipments s where s.shipper_org = o.id),
      'loads_30d', (select count(*) from app_private.partner_loads pl where pl.broker_org = o.id and pl.created_at > now() - interval '30 days')
                 + (select count(*) from app_private.partner_shipments s where s.shipper_org = o.id and s.created_at > now() - interval '30 days'),
      'unread_notices', (select count(*) from app_private.partner_notifications pn where pn.partner_org = o.id and pn.read_at is null),
      'is_demo', coalesce(o.is_demo, false),
      -- bl_bp_0450 keys, kept
      'is_agent', coalesce(bt.is_agent, false),
      'agent_tier', case when coalesce(bt.is_agent, false) then app_private.broker_tier(o.id) end,
      'agent_parents', case when coalesce(bt.is_agent, false) then coalesce((select jsonb_agg(jsonb_build_object(
          'name', coalesce(ap.fmcsa_legal_name, ap.parent_legal_name), 'mc', ap.parent_mc,
          'status', case when ap.revoked_at is not null then 'revoked' when ap.declined_at is not null then 'declined'
                         when ap.confirmed_at is not null then 'confirmed' else 'pending' end)
          order by ap.created_at) from app_private.agent_parents ap where ap.agent_org = o.id), '[]'::jsonb) end,
      -- bl_bp_0455 keys
      'role', j->>'role', 'tier', j->>'tier', 'stage', j->>'stage', 'stage_tone', j->>'stage_tone', 'next_action', j->>'next_action',
      'can_post', (j->>'can_post')::boolean, 'journey_done', (j->>'done')::int, 'journey_total', (j->>'total')::int,
      'blockers', coalesce(jsonb_array_length(j->'blockers'), 0)
    ) order by o.created_at desc)
    from public.organizations o
    left join auth.users u on u.id = o.owner_user_id
    left join app_private.partner_profiles pp on pp.org_id = o.id
    left join app_private.broker_trust bt on bt.org_id = o.id
    cross join lateral (select app_private.partner_journey(o.id) as j) jj
    where o.kind in ('broker','shipper','facility')
      and not exists (select 1 from app_private.agent_profiles ap where ap.user_id = o.owner_user_id)
      and o.name not like '% (Agent)%'), '[]'::jsonb);
end; $function$;

-- Post-check (run after apply, both databases):
--   select count(*), string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
--   → 36 on prod / 35 on staging, names per docs/audit-2026-09/anon-secdef-baseline.md (cc_partner_360 / cc_partners_accounts must NOT appear).
