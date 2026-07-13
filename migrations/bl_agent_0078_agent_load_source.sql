-- bl_agent_0078 — AGENT-POSTED LOADS carry BROKER-GRADE accountability:
-- 1) Agent orgs skip the broker paperwork PACKET (their diligence = agent verification;
--    items are WAIVED, auditable) — so posting unlocks like the owner intended…
-- 2) …but EVERY agent-posted load auto-gets a "LOAD SOURCE" checklist (who really pays):
--    real broker/shipper identity + MC#, their rate confirmation, their billing contact —
--    required_from='broker', riding the EXISTING enforcement engine (2h reminders,
--    4h+ overdue pauses new postings — wd_0033) + dispatch review before it ever posts.
-- 3) is_my_org_agent() so the posting UI can demand source fields up front.

create or replace function app_private.is_agent_org(p_org uuid)
 returns boolean language sql stable
 set search_path to 'app_private, public'
as $$
  select exists (select 1 from public.organizations o
                  join app_private.agent_profiles ap on ap.user_id = o.owner_user_id and ap.status = 'approved'
                 where o.id = p_org and o.kind <> 'carrier');
$$;

create or replace function public.is_my_org_agent()
 returns boolean language sql stable security definer
 set search_path to 'app_private, public'
as $$ select app_private.is_agent_org(app_private.my_partner_org()); $$;
revoke all on function public.is_my_org_agent() from public;
grant execute on function public.is_my_org_agent() to authenticated;

-- packet waivers for all CURRENT agent orgs (new ones get it at approval — trigger below patches decide)
insert into app_private.org_onboarding_items (org_id, item_key, status, note, reviewed_at)
select o.id, t.item_key, 'waived', 'Agent-verified account — broker packet waived; per-load SOURCE docs required instead', now()
from public.organizations o
join app_private.agent_profiles ap on ap.user_id = o.owner_user_id and ap.status = 'approved'
join app_private.onboarding_packet_templates t on t.org_kind = o.kind
where o.kind <> 'carrier'
on conflict (org_id, item_key) do nothing;

-- keep future approvals waived too: wrap in decide (recreate with waiver block)
create or replace function app_private.agent_org_waive_packet(p_org uuid)
 returns void language sql security definer
 set search_path to 'app_private, public'
as $$
  insert into app_private.org_onboarding_items (org_id, item_key, status, note, reviewed_at)
  select p_org, t.item_key, 'waived', 'Agent-verified account — broker packet waived; per-load SOURCE docs required instead', now()
  from app_private.onboarding_packet_templates t
  join public.organizations o on o.id = p_org and t.org_kind = o.kind
  on conflict (org_id, item_key) do nothing;
$$;

-- per-load SOURCE checklist for agent-posted loads
create or replace function app_private.trg_agent_load_source_checklist()
 returns trigger language plpgsql
 set search_path to 'app_private, public'
as $$
begin
  if app_private.is_agent_org(new.broker_org) then
    insert into app_private.load_document_checklist (subject_type, subject_id, doc_key, label, required_from, status, due_at)
    values
      ('partner_load', new.id, 'source_identity', 'LOAD SOURCE — real broker/shipper company name + MC/DOT (who pays this load)', 'broker', 'required', now() + interval '2 hours'),
      ('partner_load', new.id, 'source_rate_con', 'Rate confirmation / tender FROM the source broker-shipper (upload or reference #)', 'broker', 'required', now() + interval '2 hours'),
      ('partner_load', new.id, 'source_billing', 'Source billing contact — AP name, email, phone (invoices go here)', 'broker', 'required', now() + interval '2 hours')
    on conflict do nothing;
  end if;
  return new;
end; $$;
drop trigger if exists trg_agent_load_source_checklist_t on app_private.partner_loads;
create trigger trg_agent_load_source_checklist_t after insert on app_private.partner_loads
for each row execute function app_private.trg_agent_load_source_checklist();

notify pgrst, 'reload schema';
