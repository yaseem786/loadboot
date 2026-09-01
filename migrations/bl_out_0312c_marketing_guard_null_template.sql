-- bl_out_0312c_marketing_guard_null_template
-- 2026-09-01 — campaign deliveries may legitimately have a null template_key.
-- Treat them as marketing by source without requiring an outreach contact row.

create or replace function public.cc_delivery_worker_marketing_allowed(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'app_private, public'
as $function$
  select coalesce((
    select
      d.status = 'claimed'
      and not exists (
        select 1
          from app_private.suppressions s
         where s.channel = d.channel
           and s.address = lower(d.recipient_email)
           and (
             s.reason in ('bounced', 'complained')
             or coalesce(d.template_key like 'outreach.%', false)
             or d.source = 'campaign'
           )
      )
      and (
        not coalesce(d.template_key like 'outreach.%', false)
        or exists (
          select 1
            from app_private.outreach_contacts oc
           where lower(trim(oc.email)) = lower(d.recipient_email)
             and oc.status in ('active', 'completed')
             and oc.replied_at is null
             and oc.converted_at is null
        )
      )
    from app_private.message_deliveries d
    where d.id = p_id
      and d.channel = 'email'
      and (coalesce(d.template_key like 'outreach.%', false) or d.source = 'campaign')
  ), false);
$function$;

revoke all on function public.cc_delivery_worker_marketing_allowed(uuid) from public, anon, authenticated;
grant execute on function public.cc_delivery_worker_marketing_allowed(uuid) to service_role;

