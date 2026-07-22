-- bl_fix_0143 — Stop spurious "Review new broker/shipper registration" tasks for AGENTS.
-- Bug: an agent's own broker org (own_broker_org, kind='broker', created so agents could
--   post in the old model) fired trg_emit_partner_submitted → partner.submitted event →
--   partner_submitted_review rule → a partner_review task. But agent orgs are not real
--   partners (broker_visible stays false, they never appear in the Partner directory), so
--   the task dead-ends. Fix: only emit partner.submitted for NON-agent broker/shipper/
--   facility orgs. Additive & reversible. Applied to STAGING then PROD.
create or replace function app_private.trg_emit_partner_submitted()
returns trigger language plpgsql as $function$
begin
  if new.kind in ('broker','shipper','facility')
     and not exists (select 1 from app_private.agent_profiles ap where ap.user_id = new.owner_user_id) then
    perform app_private.emit_event('partner.submitted','partner', new.id::text,
      jsonb_build_object('name', new.name, 'kind', new.kind), 'ptsub:'||new.id::text);
  end if;
  return new;
end $function$;
