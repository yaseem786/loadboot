-- cvr_pipeline_health.sql
-- Reliability capstone: one read that surfaces backlog across every async queue the comms pipeline uses —
-- message deliveries, webhook deliveries, and the durable domain-event log — so a stuck fan-out, an unsent
-- webhook backlog, or a dead-letter build-up is visible at a glance. Staff-gated (can_manage_comms), anon revoked.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pipeline_health()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'message_deliveries', coalesce((select jsonb_object_agg(status,c) from (select status,count(*) c from app_private.message_deliveries group by status) s), '{}'::jsonb),
    'webhook_deliveries', coalesce((select jsonb_object_agg(status,c) from (select status,count(*) c from app_private.webhook_deliveries group by status) s), '{}'::jsonb),
    'domain_events', jsonb_build_object(
      'pending',   (select count(*) from app_private.domain_events where status='pending'),
      'processed', (select count(*) from app_private.domain_events where status='processed')),
    'suppressions', (select count(*) from app_private.suppressions),
    'campaigns_in_flight', (select count(*) from app_private.campaigns where status in ('sending','scheduled'))
  );
end; $$;
revoke execute on function public.cc_pipeline_health() from anon, public;
grant  execute on function public.cc_pipeline_health() to authenticated;
