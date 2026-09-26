-- bl_bp_0450 — Partners -> Directory: label broker agents "Agent of <brokerage>" instead of "x/8 verified"
-- (audit 26 Sep 2026 §7 item 4, claude/BROKER-AGENT-AUDIT-2026-09-26.md)
--
-- Before: cc_partners_accounts returned every broker org with packet_done/packet_total, so a broker AGENT
-- (broker_trust.is_agent - no bond, BOC-3 or MC of their own) read "0/8 verified" in the directory like a
-- brokerage that never sent its packet. The bl_ops_0205 exclusion only catches DISPATCH agents
-- (agent_profiles / '(Agent)' in the name), a different thing.
--
-- After: three extra keys per row, null/false for everyone who is not a broker agent:
--   is_agent        boolean  broker_trust.is_agent
--   agent_tier      text     app_private.broker_tier(org)  (new / agent_pending / agent_confirmed / ...)
--   agent_parents   jsonb    [{name, mc, status}] one per declared brokerage, oldest first;
--                            name = FMCSA legal name when the screen resolved one, else what the agent typed;
--                            status = confirmed | declined | revoked | pending (pending = not decided yet,
--                            whatever the screen said - the directory is not the trust queue).
-- partners.js renders the Packet cell from these for agents ("Agent of X", "Agent of X · awaiting brokerage",
-- "Agent · no brokerage yet") and leaves brokerages/shippers/facilities exactly as before.
--
-- Full create-or-replace, not an anchor patch: staging never received bl_ops_0205 (prod-only, 3 Aug 2026), so
-- the two bodies differed only by the dispatch-agent exclusion in the where clause. This ships the prod body
-- (the superset) to both, so they read the same afterwards.
-- Permissions: authenticated-only (has_global_permission gate), anon revoked explicitly below.
-- Anon SECURITY DEFINER surface: unchanged (34 prod / 33 staging) - verified by name after apply.

create or replace function public.cc_partners_accounts() returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
begin
  if not (public.has_global_permission('partners.view') or public.has_global_permission('partners.manage') or public.has_global_permission('dispatch.manage')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'kind', o.kind, 'status', o.status, 'created_at', o.created_at,
      'email', u.email,
      'contact', pp.contact_name, 'phone', pp.phone,
      'packet_done', (select count(*) from app_private.onboarding_packet_templates t
                      join app_private.org_onboarding_items i on i.org_id = o.id and i.item_key = t.item_key
                      where t.org_kind = o.kind and t.status_tag <> 'optional' and i.status in ('verified','waived')),
      'packet_total', (select count(*) from app_private.onboarding_packet_templates t where t.org_kind = o.kind and t.status_tag <> 'optional'),
      'awaiting', (select count(*) from app_private.org_onboarding_items i where i.org_id = o.id and i.status = 'submitted'),
      'loads', (select count(*) from public.loads l where l.broker_org = o.id),
      -- bl_bp_0450: broker agent under a brokerage - false / null for everyone else
      'is_agent', coalesce(bt.is_agent, false),
      'agent_tier', case when coalesce(bt.is_agent, false) then app_private.broker_tier(o.id) end,
      'agent_parents', case when coalesce(bt.is_agent, false) then coalesce((select jsonb_agg(jsonb_build_object(
          'name', coalesce(ap.fmcsa_legal_name, ap.parent_legal_name), 'mc', ap.parent_mc,
          'status', case when ap.revoked_at is not null then 'revoked' when ap.declined_at is not null then 'declined'
                         when ap.confirmed_at is not null then 'confirmed' else 'pending' end)
          order by ap.created_at) from app_private.agent_parents ap where ap.agent_org = o.id), '[]'::jsonb) end
    ) order by o.created_at desc)
    from public.organizations o
    left join auth.users u on u.id = o.owner_user_id
    left join app_private.partner_profiles pp on pp.org_id = o.id
    left join app_private.broker_trust bt on bt.org_id = o.id
    where o.kind in ('broker','shipper','facility')
      and not exists (select 1 from app_private.agent_profiles ap where ap.user_id = o.owner_user_id)
      and o.name not like '% (Agent)%'), '[]'::jsonb);
end; $$;

revoke execute on function public.cc_partners_accounts() from public, anon;
grant execute on function public.cc_partners_accounts() to authenticated;
