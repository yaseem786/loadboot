-- bl_bp_0454 — the four July "(Agent)" broker orgs become real agents (audit claude/BROKER-AGENT-AUDIT-2026-09-26.md §7 item 8,
-- path (a): LoadBoot holds no broker authority, so they post under a partner brokerage or not at all).
--
-- DRAFT — NOT APPLIED. Waits on the owner's path (a)/(b) decision (BROKER-SUPPLY §"YASEEN" item 6). Do not run
-- until that is made; then test on a throwaway broker org first (see the block at the end), then staging, then prod.
--
-- Before (prod, 26 Sep 2026, read-only): four orgs created 18–22 Jul with kind='broker', mc_number/dot_number NULL,
-- NO app_private.broker_trust row (so is_agent reads NULL, not false), no screenings, 0 loads, 0 packet items.
--   Ali Raza (Agent)          active   loadboot90@gmail.com               last sign-in 11 Sep
--   Asim Latif (Agent)        active   asimmr749@gmail.com                last sign-in 25 Sep
--   M Usman Farooq (Agent)    pending  musmanfarooq.dispatch@gmail.com    last sign-in 20 Jul
--   Charanpreet Kaur (Agent)  active   charanpurba99@gmail.com            last sign-in 25 Jul
-- With no trust row the portal shows them the "enter your MC" card (with a small "I'm an agent →" link) and CC 360 shows
-- the 8-item broker packet. That is the kind=broker / no-MC shape the §5 signup picker (bl_bp_0448) now prevents.
--
-- After: every one of the four has a broker_trust row with is_agent=true and no parent yet. The portal then lands them on
-- the agent card (broker-trust.js agentCard) where they declare a brokerage MC themselves via public.partner_agent_declare,
-- which upserts the same row and runs bl_bp_0449's FMCSA screen + nudge as for any agent. CC directory reads "Agent of ?"
-- (bl_bp_0450) and 360 hides the packet (item 1). The two dormant orgs (Usman, Charanpreet) additionally get
-- hold_reason set, so app_private.broker_trust_tier returns 'hold' and any attempt to post shows them the reason;
-- clearing hold_reason (or a brokerage confirming them, which nulls it in parent_decision) lifts it. organizations.status
-- is left alone: nothing on the broker side reads 'paused', and the trust tier already blocks posting.
--
-- Matched by name + kind + NULL mc + no trust row, and the migration fails unless exactly the expected orgs match, so it
-- cannot touch a real broker or run twice by accident. Idempotent: a second run matches 0 rows and exits early.
-- No functions created or changed → anon SECURITY DEFINER surface unchanged (36 prod / 35 staging).

do $$
declare
  v_ids uuid[];
  v_n   int;
  r     record;
begin
  select array_agg(o.id), count(*) into v_ids, v_n
    from public.organizations o
   where o.kind = 'broker'
     and o.mc_number is null
     and o.name in ('Ali Raza (Agent)', 'Asim Latif (Agent)', 'M Usman Farooq (Agent)', 'Charanpreet Kaur (Agent)')
     and not exists (select 1 from app_private.broker_trust t where t.org_id = o.id);

  if v_n = 0 then
    raise notice 'bl_bp_0454: nothing to do (already applied, or no July agent orgs on this DB)';
    return;
  end if;
  -- staging has none of these orgs; prod has exactly four. Any other count means a name matched something unexpected.
  if v_n <> 4 then
    raise exception 'bl_bp_0454: expected 4 July agent orgs, found % — refusing to guess', v_n;
  end if;

  for r in select o.id, o.name from public.organizations o where o.id = any(v_ids) loop
    insert into app_private.broker_trust (org_id, is_agent, hold_reason, held_at)
    values (
      r.id, true,
      case when r.name in ('M Usman Farooq (Agent)', 'Charanpreet Kaur (Agent)')
           then 'july agent placeholder — no brokerage confirmed; declare your brokerage MC or contact support' end,
      case when r.name in ('M Usman Farooq (Agent)', 'Charanpreet Kaur (Agent)') then now() end
    )
    on conflict (org_id) do nothing;

    perform app_private.log_audit('broker.agent_converted', 'org', r.id::text, r.id,
      'July placeholder org converted to agent (bl_bp_0454): is_agent=true, no parent brokerage yet', null, null);
  end loop;

  raise notice 'bl_bp_0454: converted % orgs', v_n;
end $$;

-- Post-check (run by hand after apply):
--   select o.name, t.is_agent, t.hold_reason, app_private.broker_trust_tier(o.id) as tier
--     from public.organizations o join app_private.broker_trust t on t.org_id = o.id
--    where o.name like '%(Agent)' order by o.name;
--   expect: Ali Raza / Asim Latif → tier 'new' (screen not run yet), Usman / Charanpreet → tier 'hold'.

-- Throwaway test (before staging/prod), in one transaction, rolled back:
--   begin;
--   insert into public.organizations (name, kind, status) values ('ZZ Throwaway (Agent)', 'broker', 'active') returning id;
--   -- temporarily add 'ZZ Throwaway (Agent)' to both name lists above, run the block, expect "expected 4 ... found 1" →
--   -- change the guard to v_n <> 1 for the test only, re-run, then check tier = 'new' and the audit row; then
--   rollback;
