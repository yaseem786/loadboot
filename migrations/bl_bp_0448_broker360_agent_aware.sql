-- bl_bp_0448 — Broker 360 is agent-aware (audit claude/BROKER-AGENT-AUDIT-2026-09-26.md §3, §7 item 1).
--
-- Before: an agent (broker_trust.is_agent) has no bond / BOC-3 / own MC, yet CC "Approve account"
-- (cc_partner_set_status 'approve') raised unless all 8 non-optional broker packet items were
-- verified/waived. A brokerage-confirmed agent (LinkLane) could only go active by waiving items by hand.
--
-- After:
--   1. cc_partner_set_status('approve') on an agent: the gate is the agent trust tier, not the packet.
--      Allowed when broker_tier() = 'agent_confirmed' (a brokerage confirmed them, not revoked/declined,
--      no hold) or 'verified'. Anything else raises and points staff to Partners -> Broker trust.
--      Non-agent brokers, shippers and facilities: unchanged.
--   2. cc_partner_360 returns an 'agent' block (null for non-agents): tier, hold, Master Broker
--      Agreement accepted, and one row per brokerage (agent_parents) with its confirmation state.
--
-- Posting is still gated by broker_can_post() (tier + Master Broker Agreement + per-brokerage limits);
-- approving the account does not bypass any of that. Both functions keep their existing grants
-- (create or replace), so the anon-executable surface is unchanged.

do $mig$
declare src text; out_src text;
begin
  -- 1. cc_partner_set_status: agent approval gate ----------------------------------------------
  src := pg_get_functiondef('public.cc_partner_set_status(uuid,text,text)'::regprocedure);
  out_src := replace(src,
    'declare o record; v_complete boolean;',
    'declare o record; v_complete boolean; v_agent boolean; v_tier text;');
  if out_src = src then raise exception 'bl_bp_0448: cc_partner_set_status declare line not found'; end if;
  src := out_src;
  out_src := replace(src,
    E'  if p_action = ''approve'' then\n    select not exists (',
    E'  if p_action = ''approve'' then\n'
    || E'    -- bl_bp_0448: an agent posts under a confirmed brokerage''s authority - the packet''s bond/BOC-3/MC\n'
    || E'    -- are the brokerage''s, so the gate is the agent trust tier, not the packet.\n'
    || E'    select o.kind = ''broker'' and coalesce(bt.is_agent, false) into v_agent from app_private.broker_trust bt where bt.org_id = p_org;\n'
    || E'    if coalesce(v_agent, false) then\n'
    || E'      v_tier := app_private.broker_tier(p_org);\n'
    || E'      if v_tier not in (''agent_confirmed'', ''verified'') then\n'
    || E'        raise exception ''broker agent is not confirmed by a brokerage yet (trust tier: %) - confirm or hold it under Partners -> Broker trust first'', v_tier using errcode=''22023'';\n'
    || E'      end if;\n'
    || E'      v_complete := true;\n'
    || E'    else\n'
    || E'    select not exists (');
  if out_src = src then raise exception 'bl_bp_0448: cc_partner_set_status approve anchor not found'; end if;
  src := out_src;
  out_src := replace(src,
    E'    ) into v_complete;\n',
    E'    ) into v_complete;\n    end if;\n');
  if out_src = src then raise exception 'bl_bp_0448: cc_partner_set_status packet-check close not found'; end if;
  execute out_src;

  -- 2. cc_partner_360: agent block ---------------------------------------------------------------
  src := pg_get_functiondef('public.cc_partner_360(uuid)'::regprocedure);
  out_src := replace(src,
    E'    ''health'', (select public.cc_account_health(p_org)),',
    E'    ''health'', (select public.cc_account_health(p_org)),\n'
    || E'    -- bl_bp_0448: agent under a brokerage - null for everyone else\n'
    || E'    ''agent'', (select case when coalesce(bt.is_agent, false) then jsonb_build_object(\n'
    || E'        ''tier'', app_private.broker_tier(p_org),\n'
    || E'        ''hold_reason'', bt.hold_reason,\n'
    || E'        ''agreement_ok'', exists (select 1 from app_private.org_agreement_acceptances a where a.org_id = p_org and a.kind = ''broker_carrier''),\n'
    || E'        ''parents'', coalesce((select jsonb_agg(jsonb_build_object(\n'
    || E'            ''mc'', ap.parent_mc, ''name'', coalesce(ap.fmcsa_legal_name, ap.parent_legal_name), ''declared_name'', ap.parent_legal_name,\n'
    || E'            ''status'', case when ap.revoked_at is not null then ''revoked'' when ap.declined_at is not null then ''declined'' when ap.confirmed_at is not null then ''confirmed''\n'
    || E'                             when ap.screen_outcome = ''pass'' then ''pending'' when ap.screen_outcome = ''fail'' then ''failed''\n'
    || E'                             when ap.screen_outcome in (''not_found'',''unknown'',''error'') then ''needs_human'' else ''screening'' end,\n'
    || E'            ''screen_reason'', ap.screen_reason, ''sent_to'', ap.sent_to, ''sent_at'', ap.sent_at,\n'
    || E'            ''confirmed_at'', ap.confirmed_at, ''confirmed_by'', ap.confirmed_by, ''on_loadboot'', ap.parent_org_id is not null)\n'
    || E'            order by ap.created_at) from app_private.agent_parents ap where ap.agent_org = p_org), ''[]''::jsonb)) end\n'
    || E'      from app_private.broker_trust bt where bt.org_id = p_org),');
  if out_src = src then raise exception 'bl_bp_0448: cc_partner_360 health anchor not found'; end if;
  execute out_src;
end
$mig$;
