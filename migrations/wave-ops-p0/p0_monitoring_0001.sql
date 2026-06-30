-- P0.5 — OBSERVABILITY / MONITORING.
-- cc_system_health(): one operational health snapshot for owners — automation queue health,
-- scheduled-job (cron) last-run status, notification delivery health, and security events.
-- Read-only, staff-gated, audited via the calling context. Additive, production-safe.
-- Applied to STAGING as ledger name p0_monitoring_0001.

create or replace function public.cc_system_health()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public, cron' as $function$
declare j_cron jsonb;
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;

  -- scheduled job health (latest run per job)
  begin
    select coalesce(jsonb_agg(jsonb_build_object('job',jobname,'schedule',sched,'active',act,'last_status',coalesce(st,'never'),'last_run',rt) order by jobname),'[]'::jsonb)
      into j_cron
    from (
      select distinct on (j.jobname) j.jobname, j.schedule sched, j.active act, d.status st, d.start_time rt
      from cron.job j left join cron.job_run_details d on d.jobid=j.jobid
      order by j.jobname, d.start_time desc nulls last
    ) z;
  exception when others then j_cron := '"cron unavailable"'::jsonb; end;

  return jsonb_build_object(
    'checked_at', now(),
    'automation', jsonb_build_object(
      'events_pending', (select count(*) from app_private.domain_events where status='pending'),
      'events_failed',  (select count(*) from app_private.domain_events where status='failed'),
      'events_dead',    (select count(*) from app_private.domain_events where status='dead'),
      'tasks_open',     (select count(*) from app_private.automation_tasks where status='open'),
      'tasks_escalated',(select count(*) from app_private.automation_tasks where status='open' and escalated),
      'tasks_awaiting_approval', (select count(*) from app_private.automation_tasks where status='open' and requires_approval),
      'rules_enabled',  (select count(*) from app_private.automation_rules where enabled)),
    'notifications', jsonb_build_object(
      'queued', (select count(*) from app_private.notifications where status='queued'),
      'sent',   (select count(*) from app_private.notifications where status='sent'),
      'failed', (select count(*) from app_private.notifications where status='failed')),
    'scheduled_jobs', j_cron,
    'security', jsonb_build_object(
      'events_24h', (select count(*) from app_private.security_events where created_at > now()-interval '24 hours'),
      'events_total', (select count(*) from app_private.security_events)),
    'status', case
      when (select count(*) from app_private.domain_events where status='dead') > 0 then 'attention'
      when (select count(*) from app_private.domain_events where status='failed') > 0 then 'degraded'
      else 'healthy' end);
end; $function$;

revoke all on function public.cc_system_health() from public, anon;
grant execute on function public.cc_system_health() to authenticated;
