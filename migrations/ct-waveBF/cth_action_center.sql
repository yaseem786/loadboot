-- CONTROL TOWER WAVE I — Action Center home. A personalized, priority-ranked
-- "what needs you now" queue aggregated across automation tasks, support tickets,
-- new web forms, plus headline counts (docs pending, compliance expiring, exceptions,
-- settlements). Read-only, staff-gated. Flag action_center_enabled (staging on, prod off).
-- Applied to staging + production.
create or replace function public.cc_action_center()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $function$
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'tasks_open',(select count(*) from app_private.automation_tasks where status='open'),
    'tasks_overdue',(select count(*) from app_private.automation_tasks where status='open' and sla_at is not null and sla_at<now()),
    'docs_pending',(select count(*) from public.documents where status='pending'),
    'exceptions_open',(select count(*) from app_private.trip_exceptions where status='open'),
    'settlements_pending',(select count(*) from app_private.fin_settlements where status in ('pending','approved')),
    'forms_new',(select count(*) from app_private.form_submissions where status='new'),
    'tickets_open',(select count(*) from app_private.support_tickets where status in ('open','pending')),
    'compliance_expiring',(select count(*) from app_private.carrier_compliance where status='valid' and expiry_date is not null and expiry_date between current_date and current_date+30),
    'queue',(select coalesce(jsonb_agg(q),'[]'::jsonb) from (select q from (
        select jsonb_build_object('kind','task','title',title,'priority',coalesce(priority,'normal'),'when',coalesce(sla_at,due_at,created_at),'overdue',(sla_at is not null and sla_at<now()),'related_type',related_type,'related_id',related_id) q,
               case coalesce(priority,'normal') when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end ord, coalesce(sla_at,due_at,created_at) t
          from app_private.automation_tasks where status='open'
        union all
        select jsonb_build_object('kind','ticket','title',ref||' · '||subject,'priority',priority,'when',created_at,'overdue',false,'related_type','support_ticket','related_id',id::text),
               case priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, created_at
          from app_private.support_tickets where status in ('open','pending')
        union all
        select jsonb_build_object('kind','form','title',coalesce(name,email,'Web enquiry'),'priority','high','when',created_at,'overdue',false,'related_type','form_submission','related_id',id::text),
               1, created_at
          from app_private.form_submissions where status='new'
      ) a order by ord, t desc limit 20) b)
  );
end; $function$;
revoke all on function public.cc_action_center() from public, anon;
grant execute on function public.cc_action_center() to authenticated;
insert into app_private.feature_flags(key,enabled,description,environment,audience) values ('action_center_enabled',false,'Enable the personalized Action Center home','all','staff') on conflict (key) do nothing;
